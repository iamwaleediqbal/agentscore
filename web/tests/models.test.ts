import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { ActionEntry, TimelineEntry } from "../lib/harness/entries.ts";
import type { RunRecord, RunStatus } from "../lib/harness/runs.ts";
import { byModelSpace, rankByInterval, wilson } from "../lib/harness/models.ts";
import { byTaskAndModel, cell } from "../lib/harness/analytics.ts";
import {
  NO_RUN_FILTERS,
  anyActive,
  filterRuns,
  optionsFor,
  outcomeOf,
  verdictOf,
} from "../lib/harness/filters.ts";

type Verdict = "pass" | "incomplete" | "overreach" | "both";

function action(convention: string | null, hit: string): ActionEntry {
  return {
    id: "a",
    entry_type: "action",
    turn: 1,
    at: 1,
    action_name: "click",
    args: {},
    status: "applied",
    metadata: convention
      ? { hit, point: { convention, raw: { x: 1, y: 1 }, css: { x: 1, y: 1 } } }
      : { hit },
  };
}

interface Options {
  verdict?: Verdict | null;
  status?: RunStatus;
  cost?: number;
  at?: number;
  entries?: TimelineEntry[];
}

function run(
  id: string,
  taskId: string,
  mode: "computer" | "tool",
  model: string,
  options: Options = {},
): RunRecord {
  const { verdict = "pass", status = "completed", cost = 0, at = 1, entries = [] } = options;
  return {
    id,
    taskId,
    taskTitle: taskId,
    model,
    runner: "playwright",
    mode,
    status,
    startedAt: at,
    durationMs: 1000,
    turns: 4,
    maxTurns: 12,
    tokens: { input: 10, output: 5, total: 15 },
    cost,
    entries,
    verdict: verdict ? { status: verdict, missing: [], extra: [], summary: "" } as never : null,
  };
}

/* -------------------------------------------------------------------- */
/* Wilson                                                                */
/* -------------------------------------------------------------------- */

test("the interval always contains the point estimate, including at the ends", () => {
  // The two halves of the formula cancel in exact arithmetic at p=0 and p=1 but
  // not in floating point, which is precisely where an eval needs the interval.
  for (const trials of [1, 3, 6, 12, 39]) {
    for (let passes = 0; passes <= trials; passes += 1) {
      const { point, low, high } = wilson(passes, trials);
      assert.ok(low <= point + 1e-12, `low ${low} above point ${point}`);
      assert.ok(high >= point - 1e-12, `high ${high} below point ${point}`);
      assert.ok(low >= 0 && high <= 1, "stays inside the unit range");
    }
  }
});

test("a perfect score is not reported as certainty", () => {
  // The whole reason this is Wilson and not the normal approximation: 6 of 6
  // must not come out as a zero-width interval at 100%.
  const six = wilson(6, 6);
  assert.equal(six.point, 1);
  assert.ok(six.low > 0.6 && six.low < 0.65, `lower bound was ${six.low}`);

  const three = wilson(3, 3);
  assert.ok(three.low < six.low, "fewer attempts means less confidence, not more");
});

test("no attempts is the widest possible interval, not zero percent", () => {
  const none = wilson(0, 0);
  assert.deepEqual([none.low, none.high], [0, 1]);
});

/* -------------------------------------------------------------------- */
/* Aggregation                                                           */
/* -------------------------------------------------------------------- */

test("an attempt that never reached a model is out of the denominator, not scored zero", () => {
  const rows = byModelSpace([
    run("1", "a", "tool", "m", { verdict: "pass" }),
    run("2", "b", "tool", "m", { verdict: "pass" }),
    run("3", "c", "tool", "m", { verdict: null, status: "infrastructure_error" }),
  ]);

  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.attempted, 3, "every attempt is still counted somewhere");
  assert.equal(row.scored, 2, "only two are evidence about the model");
  assert.equal(row.unscored, 1);
  assert.equal(row.passed, 2);
  assert.equal(row.interval.point, 1, "2 of 2, not 2 of 3");
});

test("the two action spaces are never folded into one row", () => {
  const rows = byModelSpace([
    run("1", "a", "computer", "m", { verdict: "overreach" }),
    run("2", "a", "tool", "m", { verdict: "pass" }),
  ]);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.space).sort(), ["computer", "tool"]);
  assert.equal(rows.find((r) => r.space === "computer")?.passed, 0);
  assert.equal(rows.find((r) => r.space === "tool")?.passed, 1);
});

test("two models against the same task are two rows, not one average", () => {
  const rows = byModelSpace([
    run("1", "a", "tool", "cheap", { verdict: "incomplete" }),
    run("2", "a", "tool", "dear", { verdict: "pass", cost: 0.01 }),
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.model === "cheap")?.cost, 0);
  assert.equal(rows.find((r) => r.model === "dear")?.cost, 0.01);
});

test("the coordinate space is read back off the actions, not assumed", () => {
  const rows = byModelSpace([
    run("1", "a", "computer", "google/gemini-3.7-flash", {
      entries: [action("grid1000", "star-i5"), action("grid1000", "nothing")],
    }),
  ]);

  const [row] = rows;
  assert.deepEqual(row.grounding.observed, ["grid1000"]);
  assert.equal(row.grounding.declared, "grid1000", "and matches what the provider documents");
  assert.equal(row.grounding.coordinates, 2);
  assert.equal(row.missedClicks, 1, "a click that hit nothing is a grounding miss");
});

test("a model with no declaration still reports what it actually answered in", () => {
  // The point of recording the resolution: an undeclared model is classified
  // from its own coordinates, and the page can say so rather than guessing.
  const rows = byModelSpace([
    run("1", "a", "computer", "dots-studio/dots-3-note-preview:free", {
      entries: [action("pixels", "star-i5")],
    }),
  ]);

  assert.equal(rows[0].grounding.declared, null);
  assert.deepEqual(rows[0].grounding.observed, ["pixels"]);
});

test("tool-calling runs carry no coordinates at all", () => {
  const rows = byModelSpace([
    run("1", "a", "tool", "m", { entries: [action(null, "star-i5")] }),
  ]);

  assert.equal(rows[0].grounding.coordinates, 0);
  assert.deepEqual(rows[0].grounding.observed, []);
});

/* -------------------------------------------------------------------- */
/* Ranking                                                               */
/* -------------------------------------------------------------------- */

test("overlap is not transitive: a chain does not collapse into one tie", () => {
  // The trap this guards: A overlaps B, B overlaps C, and A and C are plainly
  // separated. Comparing each row only with the one above puts C on A's rank.
  const ranked = rankByInterval([
    { interval: { point: 1.0, low: 0.8, high: 1.0 } },
    { interval: { point: 0.7, low: 0.55, high: 0.85 } },
    { interval: { point: 0.4, low: 0.25, high: 0.6 } },
  ]);

  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 1, "overlaps the leader, so it cannot be ordered against it");
  // Rank is "how many rows are demonstrably above me, plus one" — not a dense
  // position. Only the leader is separated from the last row, so it is 2.
  assert.equal(ranked[2].rank, 2, "separated from the leader, so it must not share the top rank");
  assert.notEqual(ranked[2].rank, 1);
  assert.deepEqual(ranked.map((r) => r.tied), [true, true, true]);
});

test("a row nobody overlaps is not marked tied", () => {
  const ranked = rankByInterval([
    { interval: { point: 1.0, low: 0.9, high: 1.0 } },
    { interval: { point: 0.2, low: 0.1, high: 0.3 } },
  ]);

  assert.deepEqual(ranked.map((r) => r.rank), [1, 2]);
  assert.deepEqual(ranked.map((r) => r.tied), [false, false]);
});

test("overlapping intervals share a rank rather than inventing an order", () => {
  const rows = byModelSpace([
    run("1", "a", "tool", "alpha", { verdict: "pass" }),
    run("2", "b", "tool", "alpha", { verdict: "pass" }),
    run("3", "a", "tool", "beta", { verdict: "pass" }),
    run("4", "b", "tool", "beta", { verdict: "incomplete" }),
  ]);

  const ranked = rankByInterval(rows);
  // 2/2 and 1/2 on two attempts each: the intervals overlap enormously, and
  // ordering them would manufacture a difference two runs cannot support.
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 1);
  assert.equal(ranked[1].tied, true);
  assert.equal(ranked[0].tied, true, "a tie has two sides, and both must say so");
});

test("intervals that do not overlap do get an order", () => {
  const many = (model: string, passes: number, total: number) =>
    Array.from({ length: total }, (_, i) =>
      run(`${model}-${i}`, `t${i}`, "tool", model, {
        verdict: i < passes ? "pass" : "incomplete",
      }),
    );

  const ranked = rankByInterval(byModelSpace([...many("good", 30, 30), ...many("bad", 0, 30)]));
  assert.equal(ranked[0].row.model, "good");
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 2);
  assert.equal(ranked[1].tied, false);
});

/* -------------------------------------------------------------------- */
/* Filtering                                                             */
/* -------------------------------------------------------------------- */

const SAMPLE = [
  run("1", "a", "computer", "x", { verdict: "pass", at: 3 }),
  run("2", "a", "tool", "x", { verdict: "incomplete", at: 2 }),
  run("3", "b", "computer", "y", { verdict: null, status: "infrastructure_error", at: 1 }),
];

test("an unscored attempt filters as unscored, never as a failure", () => {
  assert.equal(verdictOf(SAMPLE[2]), "unscored");
  assert.equal(filterRuns(SAMPLE, { ...NO_RUN_FILTERS, verdict: "incomplete" }).length, 1);
  assert.equal(filterRuns(SAMPLE, { ...NO_RUN_FILTERS, verdict: "unscored" })[0].id, "3");
});

test("filters compose", () => {
  const both = filterRuns(SAMPLE, { ...NO_RUN_FILTERS, space: "computer", model: "x" });
  assert.deepEqual(both.map((r) => r.id), ["1"]);
  assert.equal(anyActive(NO_RUN_FILTERS), false);
  assert.equal(anyActive({ ...NO_RUN_FILTERS, space: "computer" }), true);
});

test("option counts are computed against the other filters, so no row goes dead", () => {
  // With space=computer already chosen, the model row must still report what
  // picking each model would give — otherwise every value but the current one
  // reads zero and the only way out is to clear the filter first.
  const options = optionsFor(SAMPLE, { ...NO_RUN_FILTERS, space: "computer" }, "model", [
    { value: "x", label: "x" },
    { value: "y", label: "y" },
  ]);

  // "All" means every model *under the filters still in force*, so it agrees
  // with what clicking it would actually leave on screen.
  assert.equal(options.find((o) => o.value === "all")?.count, 2);
  assert.equal(options.find((o) => o.value === "x")?.count, 1);
  assert.equal(options.find((o) => o.value === "y")?.count, 1);
});

test("a task the two spaces disagree about is labelled as such", () => {
  assert.equal(outcomeOf(SAMPLE, "a", "x"), "split");
  assert.equal(outcomeOf(SAMPLE, "b", "y"), "partial", "one space recorded is not a comparison");
  assert.equal(outcomeOf(SAMPLE, "never-run", "x"), "not-run");
});

test("the newest run in each space decides the outcome", () => {
  const runs = [
    run("old", "a", "computer", "m", { verdict: "incomplete", at: 1 }),
    run("new", "a", "computer", "m", { verdict: "pass", at: 9 }),
    run("t", "a", "tool", "m", { verdict: "pass", at: 5 }),
  ];
  assert.equal(outcomeOf(runs, "a", "m"), "passed-both");
});

/* -------------------------------------------------------------------- */
/* One model per comparison                                              */
/* -------------------------------------------------------------------- */

test("one model's run never stands in for another's", () => {
  // The bug this pins, seen in production: a free model's tool-calling run was
  // shown beside a paid model's computer-use verdict, on a page whose whole
  // claim is that everything but the action space is held fixed.
  const runs = [
    run("cheap-tool", "a", "tool", "cheap", { verdict: "pass", at: 9 }),
    run("dear-computer", "a", "computer", "dear", { verdict: "overreach", at: 5 }),
  ];

  assert.equal(cell(runs, "a", "computer", "cheap"), undefined, "cheap has no computer run");
  assert.equal(cell(runs, "a", "computer", "dear")?.id, "dear-computer");
  assert.equal(cell(runs, "a", "tool", "dear"), undefined);
});

test("a task's spaces only disagree within one model", () => {
  // Across models this reads as a property of the task. It is not: it is a
  // cheap model failing and an expensive one passing.
  const runs = [
    run("cheap-computer", "a", "computer", "cheap", { verdict: "incomplete" }),
    run("dear-tool", "a", "tool", "dear", { verdict: "pass" }),
  ];

  assert.equal(outcomeOf(runs, "a", "cheap"), "partial");
  assert.equal(outcomeOf(runs, "a", "dear"), "partial");
});

test("every model that attempted a task keeps its own row", () => {
  const runs = [
    run("1", "a", "computer", "alpha", { verdict: "pass" }),
    run("2", "a", "tool", "alpha", { verdict: "pass" }),
    run("3", "a", "tool", "beta", { verdict: "incomplete" }),
    run("4", "b", "tool", "gamma", { verdict: "pass" }),
  ];

  const rows = byTaskAndModel(runs, "a");
  assert.deepEqual(rows.map((r) => r.model), ["alpha", "beta"], "gamma never attempted task a");
  assert.equal(rows[0].computer?.id, "1");
  assert.equal(rows[0].tool?.id, "2");
  // A gap, not a fabricated verdict: beta simply has no computer-use run.
  assert.equal(rows[1].computer, undefined);
  assert.equal(rows[1].tool?.id, "3");
});

test("the newest run per model per space wins, and only within that model", () => {
  const runs = [
    run("old", "a", "tool", "alpha", { verdict: "incomplete", at: 1 }),
    run("new", "a", "tool", "alpha", { verdict: "pass", at: 9 }),
    run("other", "a", "tool", "beta", { verdict: "incomplete", at: 5 }),
  ];

  const rows = byTaskAndModel(runs, "a");
  assert.equal(rows.find((r) => r.model === "alpha")?.tool?.id, "new");
  assert.equal(rows.find((r) => r.model === "beta")?.tool?.id, "other");
});
