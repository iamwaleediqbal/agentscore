import { strict as assert } from "node:assert";
import { test } from "node:test";

import { cell, summarise, totals } from "../lib/harness/analytics.ts";
import type { ActionEntry, TimelineEntry } from "../lib/harness/entries.ts";
import type { RunRecord } from "../lib/harness/runs.ts";

function action(hit: string): ActionEntry {
  return {
    id: `a-${hit}-${Math.round(Math.random() * 1e6)}`,
    entry_type: "action",
    turn: 1,
    at: 1,
    action_name: "click",
    args: {},
    status: hit === "nothing" ? "rejected" : "applied",
    metadata: { hit },
  };
}

function run(
  taskId: string,
  mode: "computer" | "tool",
  verdict: "pass" | "incomplete" | "overreach" | "both" | null,
  extra: Partial<RunRecord> = {},
  entries: TimelineEntry[] = [],
): RunRecord {
  return {
    id: `${taskId}-${mode}-${verdict ?? "none"}`,
    taskId,
    taskTitle: taskId,
    model: "m",
    runner: "playwright",
    mode,
    status: verdict ? "completed" : "infrastructure_error",
    startedAt: 1,
    durationMs: 1,
    turns: 3,
    maxTurns: 12,
    tokens: { input: 10, output: 5, total: 15 },
    cost: 0.01,
    entries,
    verdict: verdict ? { status: verdict, missing: [], extra: [], required: [], actual: [] } : null,
    ...extra,
  };
}

test("an unscored attempt is counted apart from a failure", () => {
  // The whole point: a run that never reached a model is an absent measurement,
  // and folding it in as a zero biases everything computed afterwards.
  const s = summarise([run("a", "computer", "pass"), run("b", "computer", null)], "computer");

  assert.equal(s.scored, 1);
  assert.equal(s.unscored, 1);
  assert.equal(s.passed, 1);
  assert.equal(s.verdicts.incomplete, 0, "an infrastructure failure is not an incomplete");
});

test("each action space is summarised only from its own runs", () => {
  const runs = [run("a", "computer", "incomplete"), run("a", "tool", "pass")];

  assert.equal(summarise(runs, "computer").passed, 0);
  assert.equal(summarise(runs, "tool").passed, 1);
});

test("a run recorded before the mode field existed counts as tool calling", () => {
  const legacy = run("a", "tool", "pass");
  delete (legacy as { mode?: unknown }).mode;

  assert.equal(summarise([legacy], "tool").scored, 1);
  assert.equal(summarise([legacy], "computer").scored, 0);
});

test("clicks that landed on nothing are counted as grounding misses", () => {
  const runs = [
    run("a", "computer", "incomplete", {}, [action("nothing"), action("open-m1"), action("nothing")]),
  ];
  const s = summarise(runs, "computer");

  assert.equal(s.actions, 3);
  assert.equal(s.missedClicks, 2);
});

test("overreach is its own verdict, not lumped with failure", () => {
  const s = summarise([run("a", "computer", "overreach")], "computer");

  assert.equal(s.verdicts.overreach, 1);
  assert.equal(s.verdicts.incomplete, 0);
  assert.equal(s.passed, 0, "doing more than asked is not a pass");
});

test("totals count distinct tasks, not runs", () => {
  // Two action spaces over three tasks is six runs and three tasks.
  const runs = ["a", "b", "c"].flatMap((id) => [
    run(id, "computer", "pass"),
    run(id, "tool", "pass"),
  ]);
  const t = totals(runs);

  assert.equal(t.runs, 6);
  assert.equal(t.tasks, 3);
  assert.equal(Number(t.cost.toFixed(2)), 0.06);
});

test("the matrix cell picks the newest run for that task and space", () => {
  const older = run("a", "computer", "incomplete", { id: "older", startedAt: 1 });
  const newer = run("a", "computer", "pass", { id: "newer", startedAt: 2 });

  assert.equal(cell([older, newer], "a", "computer")?.id, "newer");
  assert.equal(cell([older, newer], "a", "tool"), undefined);
});

test("an empty run list produces zeroes rather than throwing", () => {
  const s = summarise([], "computer");

  assert.equal(s.scored, 0);
  assert.equal(s.actions, 0);
  assert.equal(totals([]).tasks, 0);
});
