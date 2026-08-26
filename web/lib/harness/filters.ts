/**
 * Filtering, as pure functions over a run list.
 *
 * Kept out of the components for the same reason the analytics are: a filter
 * that quietly drops a row is indistinguishable from a filter that works, and
 * the only way to tell them apart is to test the predicate directly.
 *
 * Two decisions worth naming, both taken from how established eval consoles
 * do this rather than invented here:
 *
 * Every option carries the count it would leave behind. LangSmith and
 * Braintrust both put filtering in a toolbar of typed predicates above the
 * table; the counts are the part that makes such a toolbar honest, because
 * they tell you what a filter will do before you click it, and a control that
 * would empty the table can say so instead of leading you to a blank page.
 *
 * "Not scored" is a filter value of its own. An attempt that never reached a
 * model is not a failed run, and a console that files it under one is lying
 * about the model. Inspect AI keeps errored samples out of scoring entirely
 * and surfaces them separately; this does the same, one level up.
 */

import type { RunRecord } from "./runs.ts";
import { isScored } from "./runs.ts";
import type { Space, VerdictKey } from "./analytics.ts";

export const ALL = "all" as const;
export type All = typeof ALL;

export interface RunFilters {
  verdict: VerdictKey | All;
  space: Space | All;
  model: string | All;
  task: string | All;
}

export const NO_RUN_FILTERS: RunFilters = {
  verdict: ALL,
  space: ALL,
  model: ALL,
  task: ALL,
};

/** The verdict a run is filed under, with unscored kept distinct from failed. */
export function verdictOf(run: RunRecord): VerdictKey {
  if (!isScored(run)) return "unscored";
  return (run.verdict?.status ?? "unscored") as VerdictKey;
}

export function spaceOf(run: RunRecord): Space {
  return run.mode === "computer" ? "computer" : "tool";
}

function matches(run: RunRecord, filters: RunFilters): boolean {
  if (filters.verdict !== ALL && verdictOf(run) !== filters.verdict) return false;
  if (filters.space !== ALL && spaceOf(run) !== filters.space) return false;
  if (filters.model !== ALL && run.model !== filters.model) return false;
  if (filters.task !== ALL && run.taskId !== filters.task) return false;
  return true;
}

export function filterRuns(runs: RunRecord[], filters: RunFilters): RunRecord[] {
  return runs.filter((run) => matches(run, filters));
}

export function anyActive(filters: RunFilters): boolean {
  return (Object.values(filters) as string[]).some((value) => value !== ALL);
}

export interface Option<V extends string> {
  value: V;
  label: string;
  /** How many rows would survive if this option were the one selected. */
  count: number;
}

/**
 * Count each option against the *other* filters, not against itself.
 *
 * A dimension counted against its own current selection reports zero for every
 * value except the chosen one, which turns a toolbar into a dead end: the only
 * way to discover the counts is to clear the filter you just set. Counting
 * each value as if it alone were selected keeps the whole row live, so moving
 * between values is one click rather than two.
 */
export function optionsFor<K extends keyof RunFilters>(
  runs: RunRecord[],
  filters: RunFilters,
  key: K,
  values: { value: RunFilters[K]; label: string }[],
): Option<string>[] {
  const others = { ...filters, [key]: ALL } as RunFilters;
  const pool = filterRuns(runs, others);

  return [
    { value: ALL, label: "All", count: pool.length },
    ...values.map(({ value, label }) => ({
      value: value as string,
      label,
      count: filterRuns(pool, { ...others, [key]: value } as RunFilters).length,
    })),
  ];
}

/* -------------------------------------------------------------------- */
/* Tasks                                                                 */
/* -------------------------------------------------------------------- */

/**
 * What the two action spaces did with one task.
 *
 * `split` is the whole reason this project has two action spaces, so it is a
 * filter value rather than something a reader has to spot by scanning two
 * columns for disagreement. It is the single most interesting thing the run
 * table contains: same instruction, same grader, same model, one passing and
 * one not.
 */
export type Outcome = "passed-both" | "failed-both" | "split" | "partial" | "not-run";

export function outcomeOf(runs: RunRecord[], taskId: string, model: string): Outcome {
  // Scoped to one model for the same reason `cell` is: "the two spaces
  // disagree" is a claim about one model answering one task two ways, and
  // computing it across models compares a cheap model's failure with an
  // expensive one's success and calls that a property of the task.
  const forTask = runs.filter((run) => run.taskId === taskId && run.model === model);
  const newest = (space: Space): RunRecord | undefined =>
    forTask
      .filter((run) => spaceOf(run) === space)
      .sort((a, b) => b.startedAt - a.startedAt)[0];

  const computer = newest("computer");
  const tool = newest("tool");
  if (!computer && !tool) return "not-run";
  // One space recorded and not the other is not a comparison yet, and calling
  // it "passed" or "failed" would imply the missing half agreed.
  if (!computer || !tool) return "partial";

  const passed = (run: RunRecord) => verdictOf(run) === "pass";
  if (passed(computer) && passed(tool)) return "passed-both";
  if (!passed(computer) && !passed(tool)) return "failed-both";
  return "split";
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  "passed-both": "Passed in both",
  "failed-both": "Failed in both",
  split: "Spaces disagree",
  partial: "One space only",
  "not-run": "Not run",
};
