import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { Grade } from "../lib/harness/grade.ts";
import { gradeFromSnapshots, regrade } from "../lib/harness/regrade.ts";
import type { RunRecord } from "../lib/harness/runs.ts";

/**
 * Regrading is the reason the snapshots are stored at all. These tests hold it
 * to that: the published verdicts come back exactly from the snapshots alone,
 * nothing reaches the network while it happens, and a change to the grader shows
 * up as a list of the runs it moved.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const INDEX = path.join(ROOT, "public/runs/index.json");

function published(): RunRecord[] {
  return (JSON.parse(readFileSync(INDEX, "utf8")) as { runs: RunRecord[] }).runs;
}

test("every published verdict comes back exactly from the run's own snapshots", () => {
  const runs = published();
  const report = regrade(runs);

  assert.ok(report.checked > 0, "there are published runs to regrade");
  assert.equal(report.checked + report.skipped.length, runs.length, "every run is either checked or skipped");
  assert.deepEqual(report.changed, [], "a regrade with the same grader moved a verdict");
  assert.equal(report.unchanged, report.checked);
});

test("regrading never touches the network", () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    throw new Error("regrading tried to make a request");
  }) as typeof fetch;
  try {
    regrade(published());
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(calls, 0);
});

test("a change to the grader is reported as exactly the runs it moves", () => {
  const runs = published();
  const target = runs.find((run) => run.verdict?.status === "pass");
  assert.ok(target, "the published runs include at least one pass");

  // A stricter rule for one task only: a pass on it now counts as incomplete.
  const stricter = (run: RunRecord): Grade | null => {
    const verdict = gradeFromSnapshots(run);
    if (verdict && run.taskId === target.taskId && verdict.status === "pass") {
      return { ...verdict, status: "incomplete" };
    }
    return verdict;
  };

  const report = regrade(runs, stricter);
  const expected = runs
    .filter((run) => run.taskId === target.taskId && run.verdict?.status === "pass")
    .map((run) => run.id);

  assert.deepEqual(report.changed.map((moved) => moved.id), expected);
  for (const moved of report.changed) {
    assert.equal(moved.before, "pass");
    assert.equal(moved.after, "incomplete");
  }
  assert.equal(report.unchanged, report.checked - expected.length);
});

test("only the verdict changes on a regraded run", () => {
  const runs = published();
  const report = regrade(runs, (run) => {
    const verdict = gradeFromSnapshots(run);
    return verdict && { ...verdict, status: "both" };
  });

  const withoutVerdict = (run: RunRecord) => ({ ...run, verdict: null });
  report.runs.forEach((after, i) => {
    assert.deepEqual(withoutVerdict(after), withoutVerdict(runs[i]), `${after.id} changed beyond its verdict`);
  });
});

test("runs that cannot be regraded are skipped with a reason, not failed", () => {
  const [first] = published();
  const runs: RunRecord[] = [
    { ...first, id: "no-snapshots", snapshots: undefined },
    { ...first, id: "unknown-task", taskId: "no-such-task" },
    { ...first, id: "never-reached-a-model", status: "infrastructure_error", verdict: null },
  ];

  const report = regrade(runs);

  assert.equal(report.checked, 0);
  assert.deepEqual(report.skipped, [
    { id: "no-snapshots", reason: "no snapshots" },
    { id: "unknown-task", reason: "unknown task" },
    { id: "never-reached-a-model", reason: "unscored" },
  ]);
  assert.deepEqual(report.runs, runs, "skipped runs come back untouched");
});

test("npm run regrade leaves the index alone unless told to write", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "regrade-"));
  const copy = path.join(dir, "index.json");
  copyFileSync(INDEX, copy);
  const before = readFileSync(copy, "utf8");

  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", path.join(ROOT, "runner/regrade.ts"), "--file", copy, "--check"],
    { encoding: "utf8" },
  );

  try {
    assert.match(out, /changed:\s+0/);
    assert.equal(readFileSync(copy, "utf8"), before, "the report run rewrote the file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("npm run regrade --write repairs a stale verdict and --check flags it first", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "regrade-"));
  const copy = path.join(dir, "index.json");
  const index = JSON.parse(readFileSync(INDEX, "utf8")) as { runs: RunRecord[] };
  const stale = index.runs.find((run) => run.verdict);
  assert.ok(stale?.verdict);
  const truth = stale.verdict;
  // A verdict saved by an older grader: same snapshots, different status.
  stale.verdict = { ...truth, status: truth.status === "pass" ? "overreach" : "pass" };
  writeFileSync(copy, JSON.stringify(index, null, 2));

  const run = (...extra: string[]) =>
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", path.join(ROOT, "runner/regrade.ts"), "--file", copy, ...extra],
      { encoding: "utf8" },
    );

  try {
    assert.throws(() => run("--check"), "--check should exit non zero when a verdict would change");

    const out = run("--write");
    assert.match(out, /changed:\s+1/);
    assert.match(out, new RegExp(stale.id));

    const saved = (JSON.parse(readFileSync(copy, "utf8")) as { runs: RunRecord[] }).runs;
    assert.deepEqual(saved.find((r) => r.id === stale.id)?.verdict, truth, "the saved verdict is not the regraded one");
    assert.match(run("--check"), /changed:\s+0/, "after --write the index is consistent again");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
