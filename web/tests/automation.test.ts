import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { AUTOMATION_VERSION, GYM_HOME } from "../lib/environment/contract.ts";
import { TASKS, offlineSeed } from "../lib/harness/tasks.ts";

/**
 * The contract between the gym and anything that drives it.
 *
 * The gym is a public web application that holds state. The harness drives it
 * from outside with a real browser, fetches the world before the task starts,
 * fetches it again when the agent stops, and grades one snapshot against the
 * other. Two states in, a verdict out — and the verdict can be recomputed from
 * the pair as often as the grading logic changes, without paying for another
 * model run.
 *
 * What this replaced: the driver read `localStorage` with a key it
 * reconstructed itself. It worked, and it meant the harness knew how the
 * application persists things — so the two could only ever ship together, and
 * "point it at a real app" was a sentence rather than a possibility.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/**
 * The file with its prose removed.
 *
 * Assertions about what a file *does* have to read the code, not the comments.
 * Three separate tests in this suite have now passed or failed on a sentence
 * explaining the very thing they were checking — including one that failed on
 * the comment saying storage is no longer read.
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/**
 * The runner's URL normalisation, replicated rather than imported.
 *
 * `run.ts` starts a browser on import, so a test cannot pull one function out
 * of it. If the two ever disagree, this is the copy that is wrong — which is
 * why the test above also asserts the shape of the expression in run.ts.
 */
const resolve = (raw: string) => {
  const url = new URL(raw);
  const at = url.pathname.replace(/\/+$/, "");
  if (!at.endsWith("/gym")) url.pathname = `${at}/gym`;
  return url.toString();
};



test("the driver reads through the contract, never through storage", () => {
  const driver = code("runner/driver.ts");

  assert.match(driver, /window\.clickmail!\.state\(\)/, "the driver must read through the contract");
  assert.match(driver, /window\.clickmail!\.reset\(\)/, "and reset through it");
  assert.ok(
    !/localStorage|storageKeyFor/.test(driver),
    "the driver is reaching into the application's storage again",
  );
});

test("a run fetches the world before the task and after it", () => {
  // The snapshot pair is the whole basis of a verdict. Skipping the first one
  // means grading against an assumption about what the environment contained.
  const run = read("runner/run.ts");

  const beganAt = run.indexOf("await begin(page)");
  const finalAt = run.indexOf("await readState(page)");
  assert.ok(beganAt !== -1, "the run never fetches the initial state");
  assert.ok(finalAt !== -1, "the run never fetches the final state");
  assert.ok(beganAt < finalAt, "the final snapshot is taken before the initial one");
  assert.match(run, /task\.expected\(initial\)/, "grading must be against the fetched world");
});

test("a task says what changes, never what was there to begin with", () => {
  const tasks = read("lib/harness/tasks.ts");

  assert.ok(!/^\s*seed[?]?:/m.test(tasks), "a task carries its own starting world again");
  for (const task of TASKS) {
    assert.equal(typeof task.expected, "function", `${task.id} does not describe a change`);
  }
});

test("every task's expected change is reachable from whatever the gym reports", () => {
  /*
   * The property that keeps the two repositories honest once they are apart. A
   * task is applied to the state the environment reported — so if the gym's
   * data changes, the task follows it rather than silently grading against a
   * copy that no longer exists.
   */
  const reported = offlineSeed();

  for (const task of TASKS) {
    const golden = task.expected(reported);
    assert.notDeepEqual(golden, reported, `${task.id} asks for no change at all`);
    assert.equal(
      golden.emails.length >= reported.emails.length - 1,
      true,
      `${task.id} produced a world unrelated to the one it was given`,
    );
  }
});

test("the version is checked, so a mismatched pair fails loudly", () => {
  const driver = read("runner/driver.ts");

  assert.equal(typeof AUTOMATION_VERSION, "number");
  assert.match(driver, /AUTOMATION_VERSION/, "the driver never checks the contract version");
  assert.match(driver, /speaks automation v/, "and it should say so in words when they differ");
});

test("a run always lands on the page that publishes the contract", () => {
  /*
   * The mailbox is at /gym. The site root is a landing page — a perfectly good
   * page that publishes no contract, so a run pointed at it fails with "the gym
   * never published its automation contract": a true message about the wrong
   * problem.
   *
   * Copying the address bar out of a browser gives you the bare origin, so that
   * is corrected rather than rejected.
   */
  const run = code("runner/run.ts");

  assert.match(run, /function resolveGymUrl/, "the runner does not normalise the target");
  assert.match(run, /endsWith\("\/gym"\)/, "and it must check for the gym path specifically");
  assert.match(
    run,
    /const GYM_URL = resolveGymUrl\(/,
    "the normalised value has to be the one actually used",
  );

  for (const [given, expected] of [
    ["https://clickmail-sigma.vercel.app", "https://clickmail-sigma.vercel.app/gym"],
    ["https://clickmail-sigma.vercel.app/", "https://clickmail-sigma.vercel.app/gym"],
    ["https://clickmail-sigma.vercel.app/gym", "https://clickmail-sigma.vercel.app/gym"],
    ["http://localhost:3000", "http://localhost:3000/gym"],
  ] as const) {
    assert.equal(resolve(given), expected, `${given} did not resolve to the gym`);
  }
});

test("the default target is the deployed environment", () => {
  // Recording needs nothing running locally: the environment is a public site,
  // and the harness reaches it the way anything else would. Asserted on the
  // shared constant rather than on the runner's source, because the address
  // moved into the contract the day the interface needed to link it too.
  assert.equal(resolve(GYM_HOME), GYM_HOME, "the default target is not already the gym page");
  assert.match(GYM_HOME, /^https:\/\/[^/]+\/gym$/, "the default target is not a deployed gym page");
});

test("the environment is somewhere else, and every link to it says so", () => {
  // The whole architecture is that the gym is a separate deployment. A link
  // written as a path asserts the opposite, and does it in a form that looks
  // exactly like the six correct internal links beside it — which is how it got
  // there. It resolves against this origin and 404s.
  assert.match(GYM_HOME, /^https:\/\//, "the gym address is not absolute");
  assert.match(GYM_HOME, /\/gym$/, "the gym address does not point at the page that publishes the contract");

  const shell = code("components/app-shell.tsx");
  assert.ok(
    !/href=["'](\/gym|\/environment)/.test(shell),
    "the shell links the environment as one of its own routes",
  );
  assert.match(shell, /GYM_HOME/, "the shell no longer reads the environment address from the contract");
});

test("the runner and the interface agree on where the environment is", () => {
  // One constant, two readers. Two literals would drift the first time the gym
  // is redeployed under a different name, and the drift would be silent on
  // whichever side nobody clicked.
  assert.match(
    code("runner/run.ts"),
    /GYM_URL\s*\?\?\s*GYM_HOME|GYM_HOME/,
    "the runner no longer defaults to the shared gym address",
  );
  assert.ok(
    !/"https:\/\/clickmail[^"]*"/.test(code("runner/run.ts")),
    "the runner has a hardcoded gym URL beside the shared one",
  );
});
