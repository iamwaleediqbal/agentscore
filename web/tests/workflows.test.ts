import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

/*
 * The repository root, not the app directory.
 *
 * This read `web/.github/workflows`, which GitHub has never looked at: the
 * workflows live at the top of the repository and `web/` is a subdirectory of
 * it. There was a stale copy sitting there — two files, one of them waiting on
 * a `/gym` route this app does not have — so every assertion below passed
 * against workflows that could not run, while the ones that do run were
 * unguarded. A test about spending money, pointed at the wrong tree.
 */
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DIR = path.join(ROOT, ".github/workflows");

const files = readdirSync(DIR).filter((name) => name.endsWith(".yml"));
const read = (name: string) => readFileSync(path.join(DIR, name), "utf8");

test("there are workflows to check", () => {
  assert.ok(files.length >= 2, `found ${files.length} workflows in ${DIR}`);
});

test("there is exactly one place workflows live", () => {
  // A second `.github` under the app directory is invisible to GitHub and
  // indistinguishable, to a reader, from the one that runs. The copy that used
  // to sit here is what made every assertion in this file vacuous.
  assert.equal(
    existsSync(path.join(import.meta.dirname, "..", ".github")),
    false,
    "web/.github exists — GitHub ignores it, and this suite would read it instead of the real one",
  );
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
  /*
   * Two paths reach a model from CI and each has its own hard guard, so this
   * accepts either — but every spender must carry one of them.
   *
   *   The TypeScript runner refuses a paid model unless BUDGET is set, so
   *   pinning BUDGET to "0" means adding a paid MODEL input later cannot
   *   quietly enable spending.
   *
   *   The Python suite sends a zero price ceiling with every request, which the
   *   provider enforces by refusing rather than billing. `agentscore` is the
   *   command that does it and `run.py` passes FREE_ONLY on both calls.
   *
   * Both are capabilities rather than checks, which is the property worth
   * protecting: a guard that depends on somebody keeping a model list current
   * fails silently on the day the list goes stale.
   */
  for (const name of spenders()) {
    const source = read(name);
    const guarded = /BUDGET:\s*"0"/.test(source) || /^\s*run:\s*agentscore /m.test(source);
    assert.ok(
      guarded,
      `${name} spends against a key with neither BUDGET="0" nor the zero-price-ceiling suite`,
    );
  }
});

test("the zero price ceiling the Python suite relies on is actually sent", () => {
  // The assertion above accepts `agentscore` as evidence of a guard. This is
  // what makes that acceptable: every completion in the suite carries the
  // ceiling, so the workflow test is not taking a command name on trust.
  const source = readFileSync(
    path.join(ROOT, "src", "agentscore", "run.py"),
    "utf8",
  ).replace(/#.*$/gm, "");

  const calls = source.match(/await client\.complete\(/g)?.length ?? 0;
  const ceilings = source.match(/max_price=FREE_ONLY/g)?.length ?? 0;
  assert.ok(calls > 0, "the suite should still be making completions");
  assert.equal(ceilings, calls, `${calls} completions, ${ceilings} of them price-capped`);
});

test("a recording workflow adds to what is published rather than replacing it", () => {
  /*
   * The bug this exists for: the batch recorded computer use, wrote index.json
   * from its own results, and the prune then deleted the screenshots of
   * everything else. Every tool-calling run disappeared each time it ran — and
   * the gap between the two action spaces is the whole comparison.
   */
  // `npm --prefix web run agent`, not `npm run agent`: the workflow lives at the
  // top of the repository and the app is a subdirectory. Matching the shorter
  // form skipped the only workflow this test exists for, so the assertion below
  // was running zero times.
  const RUNS_A_BATCH = /npm(?: --prefix \S+)? run agent/;
  let checked = 0;

  for (const name of spenders()) {
    const source = read(name);
    if (!RUNS_A_BATCH.test(source)) continue;
    checked += 1;
    assert.match(
      source,
      /npm(?: --prefix \S+)? run agent[^\n]*--append/,
      `${name} runs a batch without --append, which replaces every run it did not record`,
    );
  }

  assert.ok(checked > 0, "no workflow records runs — this test found nothing to check");
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

test("a workflow that needs the environment checks it is there first", () => {
  /*
   * The environment is a deployed application in another repository, so a run
   * can fail for a reason that has nothing to do with the model: the gym is
   * down, or the URL moved. Without a check up front that arrives as a
   * transport error against every task in turn, six times, and reads like a
   * provider outage.
   *
   * This replaced a test about a wait loop — `for i in $(seq 1 60); do curl …`,
   * which exits zero when every attempt failed. That loop no longer exists,
   * because there is no longer a server to start; the test kept passing by
   * matching nothing at all, which is the failure mode it was written to
   * prevent, one level up.
   */
  for (const name of files) {
    const source = read(name);
    if (!/GYM_URL/.test(source)) continue;

    assert.match(
      source,
      /curl -sSf[^\n]*GYM_URL/,
      `${name} drives the gym without checking it answers`,
    );

    // And the check must fail the step. `curl || echo` is not a check.
    const after = source.slice(source.indexOf("curl -sSf"));
    assert.match(
      after.slice(0, 300),
      /exit 1/,
      `${name} checks the gym and carries on regardless`,
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
    // Comments stripped first. The workflow explains, in a comment, exactly why
    // it does not use `npx playwright install` — and a check that reads the
    // explanation as though it were the command fails on the file that is
    // right, which teaches everyone to stop believing it.
    const source = read(name)
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    if (!/playwright install/.test(source)) continue;
    assert.match(
      source,
      // The path is relative to the workflow's working directory, which is the
      // repository root for a workflow at the top of it.
      /(?:\.\/|\.\/web\/)runner\/node_modules\/\.bin\/playwright install/,
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
  // The tools live under `web/`, which is where this suite is. ROOT is the
  // repository, because that is where the workflows are.
  const tools = path.join(import.meta.dirname, "..", "tools");
  for (const tool of readdirSync(tools).filter((f) => f.endsWith("-check.py"))) {
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
