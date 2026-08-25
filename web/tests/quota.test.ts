import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * Guards on how a rate limit is handled.
 *
 * A 429 is a statement about the account, not the request: every free model
 * draws on the same pool. Treating it as a transient error meant three retries
 * with backoff, then the same again against the next model in the chain, then
 * the whole thing repeated for each remaining task — roughly thirty requests
 * spent discovering a limit that the first response had already reported.
 *
 * These read the source rather than exercising the network, because the
 * behaviour worth protecting is a policy decision that is easy to undo by
 * adding one number back to a set.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

test("a 429 is not retried, because every free model draws on the same pool", () => {
  /*
   * A rate limit is a statement about the account, not the request. Treating it
   * as transient meant three retries with backoff, then the same against the
   * next model in the chain, then the whole thing again for each remaining task
   * — roughly thirty requests spent discovering a limit the first response had
   * already reported.
   */
  const source = read("runner/run.ts");

  assert.match(source, /429/, "the runner must recognise the status");
  assert.match(
    source,
    /throw new QuotaError\(`\$\{model\} reported 429/,
    "and stop on it rather than trying the next model",
  );
});

test("a quota failure is recognised as one rather than as a transport error", () => {
  /*
   * There is one caller now. The console used to proxy model calls through an
   * API route and this asserted on both; the console is static and holds no
   * key, so the runner is the only thing that can be throttled.
   */
  const source = read("runner/run.ts");

  assert.match(source, /429/, "the runner must recognise the status");
  assert.match(source, /QuotaError/, "and treat it as a quota stop, not a retry");
});

test("the runner throws a dedicated error for quota rather than continuing", () => {
  const source = read("runner/run.ts");

  assert.match(source, /class QuotaError/);
  assert.match(source, /throw new QuotaError/);
});

test("the runner checks the quota before spending any of it", () => {
  const source = read("runner/run.ts");

  assert.match(source, /auth\/key/, "the free limits endpoint does not draw on the quota");
  assert.match(source, /await checkQuota\(\)/, "and it has to actually be called");
});

test("a batch stops after the first infrastructure failure", () => {
  const source = read("runner/run.ts");

  // Five more tasks failing the same way is not five more measurements.
  assert.match(source, /stopping the batch/);
});

test("a batch that measured nothing does not overwrite what was published", () => {
  const source = read("runner/run.ts");

  assert.match(
    source,
    /index\.json is left as it was/,
    "six infrastructure failures must not replace real recorded runs",
  );
});

test("a spent quota ends the whole session, not just the task that discovered it", () => {
  /*
   * The recording script runs this process once per task, so a quota stop that
   * only breaks the batch loop inside one invocation is not a stop at all: the
   * next task starts a fresh process, spends a request finding out the quota is
   * gone, and does it again for every task left. Under --all there is nobody at
   * the keyboard to notice.
   */
  const runner = read("runner/run.ts");
  const script = read("record-runs.sh");

  assert.match(
    runner,
    /process\.exit\(stopKind === "quota" \? 3 : 1\)/,
    "a quota stop must be distinguishable from a batch that merely recorded nothing",
  );
  assert.match(
    runner,
    /if \(stopKind === "quota"\) \{[\s\S]*process\.exit\(3\)/,
    "and it must still exit 3 after keeping the runs that did complete",
  );
  assert.match(
    script,
    /RUN_STATUS" -eq 3/,
    "the recording script never reads the exit code that tells it to stop",
  );
  assert.ok(
    /-eq 3 \][\s\S]{0,400}?STOP="yes"/.test(script),
    "reading the code is not the same as acting on it",
  );
});

test("screenshots from a run that recorded nothing are not left behind", () => {
  /*
   * The failure this exists for is on disk right now as this is written: a run
   * wrote its screenshots, failed before it reached a model, and exited on the
   * path that leaves index.json alone. The prune only ran on the success path,
   * so 380KB of images stayed in public/runs/shots — committed, deployed, and
   * unreachable, because no run in the index refers to them.
   */
  const source = read("runner/run.ts");

  assert.match(source, /async function pruneShots/, "the prune should be callable from both paths");
  const nothingRecorded = source.slice(0, source.indexOf("index.json is left as it was"));
  assert.match(
    nothingRecorded.slice(-1200),
    /await pruneShots\(published\)/,
    "the path that records nothing must still clean up after itself",
  );
});

test("no preflight step reports success it did not verify", () => {
  // Two green ticks were printed unconditionally. `[ -d node_modules ] || npm
  // install` printed "app dependencies" whether or not the install worked —
  // npm creates the directory before it starts fetching, so a failed install
  // leaves exactly the evidence that line read as success. And the Chromium
  // step printed its warning and then a tick underneath it, which reads as
  // recovered. A run that starts on a broken install fails much later and
  // blames something else.
  const script = read("record-runs.sh");

  assert.match(
    script,
    /node_modules\/next\/package\.json \][\s\S]{0,8}\|\| die/,
    "the app install is reported without checking a file was actually written",
  );
  assert.match(
    script,
    /npm install --no-audit --no-fund \|\| die/,
    "a failed app install does not stop the script",
  );
  // Anchored at `if ` with nothing between it and the command, so a negated
  // condition — `if ! playwright install …` with the tick still underneath —
  // does not match. The first version of this assertion did match it, which is
  // the same defect it was written to catch, one level up.
  assert.match(
    script,
    /\n\s*if \.\/runner\/node_modules\/\.bin\/playwright install chromium[^\n]*then\n\s*ok "Chromium"/,
    "the Chromium tick is printed outside the branch that earned it",
  );
});
