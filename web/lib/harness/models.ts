/**
 * What the recorded runs say about each model.
 *
 * The models page used to render a committed JSON file produced by the Python
 * side of this repository. That file was sample data, and a sample leaderboard
 * on a page whose entire argument is "evaluation done honestly" is the one
 * thing this project cannot ship. Everything here is derived from the runs in
 * `public/runs/index.json` — the same records the runs section renders — so a
 * number on this page can always be traced to a trajectory you can open.
 *
 * Three rules the aggregation follows, each of them a documented convention
 * rather than a preference:
 *
 * 1. An attempt that never reached a model is removed from the denominator,
 *    not scored zero. Inspect AI does this — errored samples carry an `error`
 *    field and are excluded from scoring — and it matters because an
 *    infrastructure failure read as a capability failure is a lie about the
 *    model. The coverage figure is reported next to the rate so the reader can
 *    see how much was dropped.
 *
 * 2. Every rate carries a Wilson interval and an explicit n. Six runs cannot
 *    support "50%". They can support "3 of 6, somewhere between 19% and 81%",
 *    which is a different and more useful sentence.
 *
 * 3. The two action spaces are never averaged together. They are different
 *    conditions over the same tasks, which is the comparison this harness
 *    exists to draw; folding them into one number destroys exactly the signal
 *    the page is for.
 */

import { isActionEntry } from "./entries.ts";
import { isScored, type RunRecord } from "./runs.ts";
import type { Space, VerdictKey } from "./analytics.ts";
import { declaredConvention, type Convention } from "../environment/computer.ts";

const Z_95 = 1.959963984540054;

export interface Interval {
  point: number;
  low: number;
  high: number;
}

/**
 * Wilson score interval — the same one the Python side computes, for the same
 * reason.
 *
 * Not the normal approximation most dashboards use. At the sample sizes an
 * eval actually runs, that one puts the bounds outside 0 and 1 and reports a
 * width of exactly zero for 0/6 and 6/6, which is precisely where an interval
 * is most needed. Wilson stays inside the unit range and stays wide when the
 * evidence is thin.
 */
export function wilson(successes: number, trials: number, z: number = Z_95): Interval {
  if (trials <= 0) return { point: 0, low: 0, high: 1 };

  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const centre = p + (z * z) / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));

  // The interval must contain the point estimate. At p=0 and p=1 the halves of
  // the formula cancel in exact arithmetic but not in floating point, which
  // leaves a bound a hair on the wrong side of the estimate.
  return {
    point: p,
    low: Math.max(0, Math.min((centre - margin) / denominator, p)),
    high: Math.min(1, Math.max((centre + margin) / denominator, p)),
  };
}

const EMPTY_VERDICTS = (): Record<VerdictKey, number> => ({
  pass: 0,
  incomplete: 0,
  overreach: 0,
  both: 0,
  unscored: 0,
});

export interface ModelSpaceRow {
  model: string;
  space: Space;
  /** Every recorded attempt, including the ones that never reached a model. */
  attempted: number;
  /** Attempts that are evidence about the model. The denominator. */
  scored: number;
  unscored: number;
  passed: number;
  verdicts: Record<VerdictKey, number>;
  interval: Interval;
  tasks: number;
  turns: number;
  tokens: number;
  cost: number;
  /** Coordinate actions that landed on no control. Computer use only. */
  missedClicks: number;
  actions: number;
  /** How this model's coordinates were read. Computer use only. */
  grounding: Grounding;
}

/**
 * What coordinate space a model turned out to answer in.
 *
 * `declared` is the provider's documented convention, applied on the first
 * turn as a prior before any coordinate exists to inspect. `observed` is what
 * the runner actually resolved, read back off the recorded actions — so a
 * model that ignores its family's convention shows up as a disagreement rather
 * than as a run of missed clicks nobody can explain.
 *
 * A model with no declaration is not a problem to be solved by guessing. Its
 * first unambiguous coordinate settles the question, and an ambiguous one is
 * hit-tested against the live DOM — neither of which costs a model turn or a
 * token, so an unknown model is slower to classify but not more expensive.
 */
export interface Grounding {
  declared: Convention | null;
  /** Distinct conventions actually resolved, commonest first. */
  observed: Convention[];
  /** Actions that carried a coordinate at all. */
  coordinates: number;
}

export interface ModelSummary {
  model: string;
  /** One row per action space the model was actually run in. */
  rows: ModelSpaceRow[];
  scored: number;
  passed: number;
  tokens: number;
  cost: number;
  tasks: number;
  /** Nothing was charged for any of its runs. */
  free: boolean;
  /** Newest run, so the table can be ordered by when the evidence was taken. */
  latest: number;
}

function spaceOf(run: RunRecord): Space {
  return run.mode === "computer" ? "computer" : "tool";
}

function emptyRow(model: string, space: Space): ModelSpaceRow {
  return {
    model,
    space,
    attempted: 0,
    scored: 0,
    unscored: 0,
    passed: 0,
    verdicts: EMPTY_VERDICTS(),
    interval: { point: 0, low: 0, high: 1 },
    tasks: 0,
    turns: 0,
    tokens: 0,
    cost: 0,
    missedClicks: 0,
    actions: 0,
    grounding: { declared: declaredConvention(model), observed: [], coordinates: 0 },
  };
}

/** The convention the runner recorded for one action, if it carried a point. */
function conventionOf(metadata: Record<string, unknown> | undefined): Convention | null {
  const point = metadata?.point as { convention?: string } | undefined;
  const convention = point?.convention;
  return convention === "pixels" || convention === "grid1000" || convention === "fraction"
    ? convention
    : null;
}

/** One row per (model, action space) pair that has at least one run. */
export function byModelSpace(runs: RunRecord[]): ModelSpaceRow[] {
  const rows = new Map<string, ModelSpaceRow>();
  const seenTasks = new Map<string, Set<string>>();
  const seenConventions = new Map<string, Map<Convention, number>>();

  for (const run of runs) {
    const space = spaceOf(run);
    const key = `${run.model}:${space}`;
    const row = rows.get(key) ?? emptyRow(run.model, space);
    const tasks = seenTasks.get(key) ?? new Set<string>();
    const conventions = seenConventions.get(key) ?? new Map<Convention, number>();
    tasks.add(run.taskId);

    row.attempted += 1;
    row.turns += run.turns;
    row.tokens += run.tokens.total;
    row.cost += run.cost;

    for (const entry of run.entries) {
      if (!isActionEntry(entry)) continue;
      row.actions += 1;
      if (entry.metadata?.hit === "nothing") row.missedClicks += 1;

      const convention = conventionOf(entry.metadata);
      if (convention) {
        row.grounding.coordinates += 1;
        conventions.set(convention, (conventions.get(convention) ?? 0) + 1);
      }
    }

    if (isScored(run)) {
      row.scored += 1;
      const verdict = (run.verdict?.status ?? "unscored") as VerdictKey;
      row.verdicts[verdict] += 1;
      if (verdict === "pass") row.passed += 1;
    } else {
      row.unscored += 1;
      row.verdicts.unscored += 1;
    }

    rows.set(key, row);
    seenTasks.set(key, tasks);
    seenConventions.set(key, conventions);
  }

  return [...rows.entries()].map(([key, row]) => ({
    ...row,
    tasks: seenTasks.get(key)?.size ?? 0,
    interval: wilson(row.passed, row.scored),
    grounding: {
      ...row.grounding,
      observed: [...(seenConventions.get(key) ?? new Map())]
        .sort((a, b) => b[1] - a[1])
        .map(([convention]) => convention),
    },
  }));
}

/** One entry per model, carrying its per-space rows. */
export function byModel(runs: RunRecord[]): ModelSummary[] {
  const rows = byModelSpace(runs);
  const models = new Map<string, ModelSummary>();

  for (const row of rows) {
    const summary =
      models.get(row.model) ??
      ({
        model: row.model,
        rows: [],
        scored: 0,
        passed: 0,
        tokens: 0,
        cost: 0,
        tasks: 0,
        free: true,
        latest: 0,
      } satisfies ModelSummary);

    summary.rows.push(row);
    summary.scored += row.scored;
    summary.passed += row.passed;
    summary.tokens += row.tokens;
    summary.cost += row.cost;
    models.set(row.model, summary);
  }

  for (const run of runs) {
    const summary = models.get(run.model);
    if (!summary) continue;
    summary.latest = Math.max(summary.latest, run.startedAt);
  }

  const taskCount = new Map<string, Set<string>>();
  for (const run of runs) {
    const set = taskCount.get(run.model) ?? new Set<string>();
    set.add(run.taskId);
    taskCount.set(run.model, set);
  }

  return [...models.values()]
    .map((summary) => ({
      ...summary,
      tasks: taskCount.get(summary.model)?.size ?? 0,
      free: summary.cost === 0,
      // Computer use first: it is the harder condition and the one the
      // comparison is usually read left-to-right from.
      rows: [...summary.rows].sort((a, b) => (a.space === "computer" ? -1 : 1) - (b.space === "computer" ? -1 : 1)),
    }))
    .sort((a, b) => b.scored - a.scored || a.model.localeCompare(b.model));
}

export interface Ranked<T> {
  rank: number;
  /** Statistically indistinguishable from at least one other row. */
  tied: boolean;
  row: T;
}

/** Two intervals that do not overlap. The only pair a ranking may order. */
export function separated(a: Interval, b: Interval): boolean {
  return a.low > b.high || b.low > a.high;
}

/**
 * Rank rows, sharing a rank wherever the intervals overlap.
 *
 * Rank is counted against *every* other row, not against the one above.
 * Comparing only to the neighbour makes overlap transitive: a chain in which
 * each row overlaps the next collapses into one giant tie even when the top
 * and bottom of the chain are plainly different. 100%, 73% and 50% on small
 * samples is exactly that chain — the first and last do not overlap at all,
 * and a neighbour comparison would still put them on the same rank.
 *
 * This is a port of `_mark_ties` in the Python half of this repository, which
 * carries the same note and a test named for the same trap.
 *
 * Ordering overlapping intervals at all is inventing a difference the data
 * cannot support. HELM dropped mean win rate for the same reason: a ranking
 * "sensitive to small variations in scenario scores that invert ranks" was
 * never measuring the models.
 */
export function rankByInterval<T extends { interval: Interval }>(rows: T[]): Ranked<T>[] {
  const sorted = [...rows].sort((a, b) => b.interval.point - a.interval.point);

  return sorted.map((row) => ({
    rank:
      sorted.filter(
        (other) =>
          other !== row &&
          separated(other.interval, row.interval) &&
          other.interval.point > row.interval.point,
      ).length + 1,
    // Overlap, not a rank collision. A row can be statistically
    // indistinguishable from its neighbour and still end up with a rank of its
    // own, and printing that rank unqualified is the claim the interval was
    // drawn to refuse.
    tied: sorted.some((other) => other !== row && !separated(other.interval, row.interval)),
    row,
  }));
}
