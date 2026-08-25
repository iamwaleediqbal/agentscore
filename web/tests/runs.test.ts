import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { ActionEntry, TimelineEntry } from "../lib/harness/entries.ts";
import { type RunRecord, loadRuns, mergeRecorded, saveRun } from "../lib/harness/runs.ts";

/** A localStorage that refuses writes past a byte budget, the way a real one does. */
function fakeStorage(budget: number) {
  const map = new Map<string, string>();
  return {
    store: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (value.length > budget) {
          const error = new Error("QuotaExceededError");
          error.name = "QuotaExceededError";
          throw error;
        }
        map.set(key, value);
      },
      removeItem: (key: string) => void map.delete(key),
    },
    written: () => map.get("agentscore.runs.v1") ?? null,
  };
}

function install(budget: number) {
  const fake = fakeStorage(budget);
  (globalThis as { window?: unknown }).window = { localStorage: fake.store };
  return fake;
}

function makeRun(id: string, shotBytes: number): RunRecord {
  const entries: TimelineEntry[] = [
    {
      id: `${id}-act`,
      entry_type: "action",
      turn: 1,
      at: 1,
      action_name: "open",
      args: {},
      status: "applied",
      screenshot: `data:image/jpeg;base64,${"A".repeat(shotBytes)}`,
      requestId: 2,
      metadata: {},
    } satisfies ActionEntry,
  ];
  return {
    id,
    taskId: "t",
    taskTitle: "T",
    model: "m",
    runner: "browser",
    status: "completed",
    startedAt: 1,
    durationMs: 1,
    turns: 1,
    maxTurns: 6,
    tokens: { input: 0, output: 0, total: 0 },
    cost: 0,
    entries,
    verdict: null,
  };
}

function shotsIn(runs: RunRecord[]): number {
  return runs.flatMap((r) => r.entries).filter((e) => e.entry_type === "action" && e.screenshot)
    .length;
}

test("a run that fits is stored whole, screenshots included", () => {
  const fake = install(1_000_000);
  const saved = saveRun(makeRun("a", 500));

  assert.equal(shotsIn(saved), 1);
  assert.equal(shotsIn(loadRuns()), 1);
  assert.ok(fake.written());
});

test("when space runs short the newest run keeps its screenshots and older ones lose theirs", () => {
  // Roomy enough for one run's pictures, nowhere near enough for five.
  install(4_000);
  for (const id of ["a", "b", "c", "d", "e"]) saveRun(makeRun(id, 800));

  const stored = loadRuns();
  assert.equal(stored.length, 5, "every run survives");
  assert.equal(stored[0].id, "e", "newest first");
  assert.equal(shotsIn([stored[0]]), 1, "the run just watched keeps its screenshots");
  assert.ok(shotsIn(stored) < 5, "older runs gave theirs up to make room");
});

test("a run is never lost just because its screenshots do not fit", () => {
  install(1_200);
  const saved = saveRun(makeRun("big", 20_000));

  assert.equal(saved.length, 1);
  assert.equal(loadRuns().length, 1, "the record persisted without its picture");
  assert.equal(shotsIn(loadRuns()), 0);
});

test("storage that rejects everything does not throw, it just does not persist", () => {
  install(0);
  const saved = saveRun(makeRun("x", 10));

  assert.equal(saved.length, 1, "the caller still gets the run to render");
  assert.equal(loadRuns().length, 0);
});

/* -------------------------------------------------------------------- */
/* Recording one task at a time                                          */
/* -------------------------------------------------------------------- */

function stub(taskId: string, mode: "tool" | "computer", marker: string): RunRecord {
  return { ...makeRun(marker, 1), taskId, mode };
}

test("a re-recorded task replaces only itself", () => {
  const existing = [stub("a", "computer", "old-a"), stub("b", "computer", "old-b")];
  const merged = mergeRecorded(existing, [stub("a", "computer", "new-a")]);

  assert.equal(merged.length, 2);
  assert.equal(merged.find((r) => r.taskId === "a")?.id, "new-a", "a was replaced");
  assert.equal(merged.find((r) => r.taskId === "b")?.id, "old-b", "b was left alone");
});

test("the same task in the other action space is a separate measurement", () => {
  // A computer-use run and a tool-calling run of one task are not comparable,
  // so recording one must never delete the other.
  const existing = [stub("a", "tool", "tool-a")];
  const merged = mergeRecorded(existing, [stub("a", "computer", "computer-a")]);

  assert.equal(merged.length, 2);
  assert.ok(merged.some((r) => r.id === "tool-a"));
  assert.ok(merged.some((r) => r.id === "computer-a"));
});

test("recording into an empty index just writes the new run", () => {
  const merged = mergeRecorded([], [stub("a", "computer", "new-a")]);

  assert.deepEqual(merged.map((r) => r.id), ["new-a"]);
});

test("a run recorded before the mode field existed is treated as tool calling", () => {
  // Records written by an earlier version have no `mode`. Re-recording that
  // task in tool mode should replace it, not leave a duplicate behind.
  const legacy = { ...makeRun("legacy", 1), taskId: "a" };
  delete (legacy as { mode?: unknown }).mode;

  const merged = mergeRecorded([legacy], [stub("a", "tool", "fresh")]);
  assert.deepEqual(merged.map((r) => r.id), ["fresh"]);
});

test("recording several tasks in sequence accumulates all of them", () => {
  let index: RunRecord[] = [];
  for (const id of ["a", "b", "c"]) {
    index = mergeRecorded(index, [stub(id, "computer", `run-${id}`)]);
  }

  assert.deepEqual(index.map((r) => r.taskId), ["a", "b", "c"]);
});

test("both action spaces for a task survive in one index", () => {
  // What MODE=both produces: two trajectories per task, kept side by side
  // because they are different measurements of the same thing.
  let index: RunRecord[] = [];
  for (const id of ["a", "b"]) {
    for (const mode of ["computer", "tool"] as const) {
      index = mergeRecorded(index, [stub(id, mode, `${id}-${mode}`)]);
    }
  }

  assert.equal(index.length, 4);
  assert.deepEqual(
    index.map((r) => r.id).sort(),
    ["a-computer", "a-tool", "b-computer", "b-tool"],
  );
});

test("re-recording one space leaves the other in place", () => {
  // The comparison is worthless if refreshing the computer-use run silently
  // drops the tool-calling run it is meant to be compared against.
  let index = mergeRecorded([], [stub("a", "computer", "old-computer")]);
  index = mergeRecorded(index, [stub("a", "tool", "the-tool-run")]);
  index = mergeRecorded(index, [stub("a", "computer", "new-computer")]);

  assert.equal(index.length, 2);
  assert.ok(index.some((r) => r.id === "the-tool-run"), "the other space survived");
  assert.ok(index.some((r) => r.id === "new-computer"));
  assert.ok(!index.some((r) => r.id === "old-computer"));
});
