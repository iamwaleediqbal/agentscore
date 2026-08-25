import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { TASKS } from "../lib/harness/tasks.ts";

/**
 * The flags that decide what a batch spends the quota on.
 *
 * This is the part of the runner a workflow dispatch drives, and a dispatch has
 * nobody watching it. The only signal it gives back is what it published — so a
 * selector that quietly falls back to something plausible is worse than one
 * that refuses, because the run looks like it worked.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const source = readFileSync(path.join(ROOT, "runner/run.ts"), "utf8");

test("an unknown action space is refused rather than rounded to computer use", () => {
  /*
   * It read `arg("mode") === "tool" ? "tool" : "computer"`, so `--mode toool`
   * recorded a full computer-use batch and said nothing about it — six tasks of
   * a daily allowance spent on the action space nobody asked for, published as
   * though that had been the intention.
   */
  assert.match(
    source,
    /if \(requestedMode !== "tool" && requestedMode !== "computer"\)/,
    "the mode is not validated",
  );
  assert.match(source, /unknown mode/, "and it must say which value it rejected");
});

test("an unknown task is refused before anything reaches the network", () => {
  assert.match(source, /if \(requestedTask && !TASKS\.some/, "the task id is not validated");

  const validation = source.indexOf("unknown task");
  const firstRun = source.indexOf("await runTask(");
  assert.ok(validation !== -1 && validation < firstRun, "a typo should not cost a request to find");
});

test("naming no task records nothing rather than whichever task is first", () => {
  /*
   * `[arg("task") ?? TASKS[0].id]` meant `npm run agent -- --mode tool` recorded
   * exactly one task, silently, and the person who ran it had asked for all of
   * them. Recording whichever task happens to sit first in the array is not a
   * sensible default for something that spends a quota.
   */
  assert.ok(
    !/arg\("task"\) \?\? TASKS\[0\]/.test(source),
    "the runner still falls back to the first task when none was named",
  );
  assert.match(source, /name a task with --task, or pass --all/);
});

test("the failures above exit distinguishably from a run that simply found nothing", () => {
  // 2 is "you asked for something that does not exist"; 1 is "nothing was
  // recorded"; 3 is "the quota is spent, stop the session".
  assert.match(source, /process\.exit\(2\)/, "a bad flag should not look like an empty batch");
});

test("--list still answers before any of that, because the script depends on it", () => {
  // record-runs.sh calls `--list` with no task and no --all to build its menu.
  // If validation ran first, the script could not start at all.
  const list = source.indexOf('process.argv.includes("--list")');
  const validation = source.indexOf("name a task with --task");
  assert.ok(list !== -1 && list < validation, "--list must be handled before the selectors are checked");
});

test("every task the runner can be asked for is one the console can name", () => {
  const script = readFileSync(path.join(ROOT, "record-runs.sh"), "utf8");
  // Every requested id, checked against the runner's own list, before anything
  // installs a browser. `$want` rather than `$ONLY` since the argument became a
  // list — a typo in the fifth id should not cost two minutes of setup either.
  assert.match(
    script,
    /grep -qx "\$want"/,
    "the script starts a server and Chromium before finding out the task does not exist",
  );
  assert.ok(TASKS.length >= 6, `only ${TASKS.length} tasks — the menu is worth checking against`);
});

test("the recording script rejects an action space it cannot run", () => {
  const script = readFileSync(path.join(ROOT, "record-runs.sh"), "utf8");
  assert.match(script, /computer\|tool\|both\) : ;;/, "MODE is not validated");
  assert.match(script, /MODE must be computer, tool or both/);
});

test("the recorder takes a list of tasks, not just one", () => {
  /*
   * One budget should buy one batch.
   *
   * This accepted a single id, so recording five of the six tasks meant five
   * invocations — and BUDGET is per invocation, so five runs at 0.30 authorise
   * 1.50. The alternative was splitting the ceiling by hand into five figures
   * that mean nothing on their own. A list keeps it one batch under one
   * ceiling, and leaves untouched whatever was recorded for the tasks not named.
   */
  const script = readFileSync(path.join(ROOT, "record-runs.sh"), "utf8");

  assert.match(script, /for arg in "\$@"; do/, "only the first argument is read");
  assert.match(script, /ONLY="\$ONLY \$arg"/, "task ids do not accumulate");

  // Membership, padded, so a short id cannot match inside a longer one.
  assert.match(
    script,
    /case " \$ONLY " in\n\s*\*" \$TASK_ID "\*\)/,
    "the filter compares by equality, so a list can only ever run its last entry",
  );

  // Every name checked before anything installs a browser.
  assert.match(script, /for want in \$ONLY; do/, "a typo in a later id is only found after setup");

  // An unknown flag is refused rather than silently treated as a task name.
  assert.match(script, /-\*\)\s*die "unknown option/, "a mistyped flag becomes a task id");
});
