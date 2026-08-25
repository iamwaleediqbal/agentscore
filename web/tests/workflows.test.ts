import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * What CI is allowed to do on its own.
 *
 * A workflow is the one place in this repository where code runs with nobody
 * watching, against a real key, with permission to push. That combination is
 * worth a few assertions, because every mistake in it is silent by
 * construction: the first anyone knows is a commit that changed the published
 * numbers, or a quota that was gone before the day started.
 *
 * These read the YAML as text rather than parsing it. The properties worth
 * protecting are the presence or absence of specific lines, and a parser would
 * add a dependency to a suite that deliberately has none.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, ".github/workflows");

const files = readdirSync(DIR).filter((name) => name.endsWith(".yml"));
const read = (name: string) => readFileSync(path.join(DIR, name), "utf8");

test("there are workflows to check", () => {
  assert.ok(files.length >= 2, `found ${files.length} workflows`);
});

/* ------------------------------------------------------------------ */
/* Spending                                                            */
/* ------------------------------------------------------------------ */

/** Workflows that reach a model, found by the key they need to do it. */
function spenders(): string[] {
  return files.filter((name) => read(name).includes("OPENROUTER_API_KEY"));
}

test("nothing spends the quota on a schedule", () => {
  /*
   * It was `cron: "0 4 * * 0"`. Two things are wrong with that and neither is
   * obvious from the file. The free allowance is daily and shared with manual
   * recording, so a batch nobody asked for competes with the run someone is
   * waiting on. And a scheduled job that pushes to main publishes a
   * measurement nobody watched — if a provider reroutes a model on a Sunday
   * morning, the numbers on the page change and the commit log is the only
   * notice.
   */
  for (const name of spenders()) {
    const source = read(name);
    assert.ok(
      !/^\s*schedule:/m.test(source),
      `${name} reaches a model and runs on a schedule — recording is a decision, so a person takes it`,
    );
    assert.ok(
      /workflow_dispatch:/.test(source),
      `${name} has no way to be started by hand`,
    );
  }
});

test("a workflow cannot authorise spending money", () => {
  // A paid model is refused without a budget. Setting it to zero explicitly
  // means adding a paid MODEL input later cannot quietly enable one.
  for (const name of spenders()) {
    assert.match(
      read(name),
      /BUDGET:\s*"0"/,
      `${name} spends against a key without pinning the budget to zero`,
    );
  }
});

test("a recording workflow adds to what is published rather than replacing it", () => {
  /*
   * The bug this exists for: the batch recorded computer use, wrote index.json
   * from its own results, and the prune then deleted the screenshots of
   * everything else. Every tool-calling run disappeared each time it ran — and
   * the gap between the two action spaces is the whole comparison.
   */
  for (const name of spenders()) {
    const source = read(name);
    if (!/npm run agent/.test(source)) continue;
    assert.match(
      source,
      /npm run agent[^\n]*--append/,
      `${name} runs a batch without --append, which replaces every run it did not record`,
    );
  }
});

test("the key is read from secrets and never written down", () => {
  for (const name of files) {
    const source = read(name);
    assert.ok(
      !/sk-or-[A-Za-z0-9]/.test(source),
      `${name} appears to contain a literal API key`,
    );
    if (source.includes("OPENROUTER_API_KEY")) {
      assert.match(
        source,
        /secrets\.OPENROUTER_API_KEY/,
        `${name} uses the key without taking it from secrets`,
      );
    }
  }
});

/* ------------------------------------------------------------------ */
/* Failing usefully                                                    */
/* ------------------------------------------------------------------ */

test("every job has a time limit", () => {
  // The default is six hours. A hung browser should not hold a runner for a
  // working day before anyone finds out.
  for (const name of files) {
    // From `jobs:` to the end, because a two-space key anywhere else is not a
    // job — `workflow_dispatch:` sits at the same indent under `on:`, and
    // counting it made this test fail on a workflow that was already correct.
    const source = read(name);
    const start = source.indexOf("\njobs:\n");
    assert.notEqual(start, -1, `${name} declares no jobs`);
    const body = source.slice(start);

    const jobs = [...body.matchAll(/^ {2}([\w-]+):$/gm)].map((m) => m[1]!);
    const limits = [...body.matchAll(/^ {4}timeout-minutes: *\d+$/gm)].length;
    assert.ok(jobs.length > 0, `${name}: the job scan found nothing`);
    assert.equal(
      limits,
      jobs.length,
      `${name} declares ${jobs.length} job(s) (${jobs.join(", ")}) and ${limits} timeout(s)`,
    );
  }
});

test("a wait loop that never succeeds fails the step", () => {
  /*
   * `for i in $(seq 1 60); do curl … && break; sleep 1; done` exits zero when
   * every attempt failed. The step went green, and the failure surfaced six
   * tasks later as six transport errors against a server that was never up.
   */
  for (const name of files) {
    const source = read(name);
    if (!/seq 1 \d+/.test(source)) continue;

    /*
     * Anchored to what follows the loop, not to a string that appears anywhere
     * in the file. The first version of this test looked for `::error::`
     * across the whole workflow and passed with the loop's failure handling
     * deleted, because a different step also emits one — the same
     * substring-match mistake this suite has been caught by before.
     */
    const after = source.slice(source.indexOf("seq 1"));
    const done = after.indexOf("\n          done");
    assert.notEqual(done, -1, `${name}: could not find the end of the wait loop`);

    const tail = after.slice(done, done + 300);
    assert.match(
      tail,
      /exit 1/,
      `${name} waits for something to come up and exits zero when it never did`,
    );
  }
});

test("a missing key is reported as a missing key", () => {
  for (const name of spenders()) {
    assert.match(
      read(name),
      /if \[ -z "\$\{OPENROUTER_API_KEY\}" \]/,
      `${name} would fail deep inside the runner, where an absent key looks like a transport error`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* Getting the tools it means to use                                   */
/* ------------------------------------------------------------------ */

test("Playwright's browser comes from the runner's own install", () => {
  /*
   * `npx playwright install` with no playwright in the root manifest fetches
   * the newest one from the registry and downloads *its* browser build. The
   * runner then launches the version it pins and cannot find an executable —
   * reported much later, and nowhere near the line that caused it.
   */
  for (const name of files) {
    const source = read(name);
    if (!/playwright install/.test(source)) continue;
    assert.match(
      source,
      /\.\/runner\/node_modules\/\.bin\/playwright install/,
      `${name} installs a browser through npx rather than the pinned binary`,
    );
  }
});

test("the runner is type-checked somewhere, since the app build excludes it", () => {
  const ci = files.map(read).join("\n");
  assert.match(
    ci,
    /npm run typecheck:runner/,
    "runner/ is excluded from the app's tsconfig, so nothing checks it unless CI does",
  );
});

test("CI runs the mutation checks, or the suite only proves it is green", () => {
  const ci = files.map(read).join("\n");
  for (const tool of readdirSync(path.join(ROOT, "tools")).filter((f) => f.endsWith("-check.py"))) {
    assert.ok(
      ci.includes(tool),
      `tools/${tool} is never run by CI, so nothing notices when a guard stops guarding`,
    );
  }
});

test("pushing to main copes with main having moved", () => {
  for (const name of files) {
    const source = read(name);
    if (!/git push/.test(source)) continue;
    assert.match(
      source,
      /git pull --rebase/,
      `${name} pushes without rebasing — a commit landing during the run makes it fail`,
    );
    assert.ok(
      !/--force/.test(source),
      `${name} force-pushes to a branch it does not own`,
    );
  }
});
