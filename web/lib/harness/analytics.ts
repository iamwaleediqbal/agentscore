/**
 * What the recorded runs add up to.
 *
 * Kept as pure functions over a run list so the numbers on the dashboard can be
 * tested without rendering anything — a wrong figure on a portfolio is worse
 * than a missing one.
 *
 * One deliberate omission: there is no headline pass-rate percentage. Six runs
 * per action space cannot support one. "17%" reads as a measurement; "1 of 6"
 * reads as what it is, and the difference matters more here than anywhere,
 * because the thing being demonstrated is evaluation done honestly.
 */

import { isActionEntry } from "./entries.ts";
import { type RunRecord, isScored } from "./runs.ts";

export type Space = "computer" | "tool";

/** The actions that carry a coordinate, and so can miss. */
const AIMED_AT_A_POINT = new Set(["click", "double_click", "right_click", "drag", "move"]);
export type VerdictKey = "pass" | "incomplete" | "overreach" | "both" | "unscored";

export interface SpaceSummary {
  space: Space;
  /** Runs that reached a model. Infrastructure failures are absent, not zero. */
  scored: number;
  /** Attempts that never reached a model and are therefore not evidence. */
  unscored: number;
  passed: number;
  verdicts: Record<VerdictKey, number>;
  turns: number;
  tokens: number;
  cost: number;
  /** Coordinate actions that landed on nothing. Computer use only. */
  missedClicks: number;
  /**
   * Actions that aimed at a point, which is the only population a miss rate
   * can be taken over. `actions` includes typing and finishing, so using it as
   * the denominator reported "0 of 291 clicks" over 236 clicks and 55 things
   * that were never clicks.
   */
  clicks: number;
  actions: number;
}

const EMPTY_VERDICTS = (): Record<VerdictKey, number> => ({
  pass: 0,
  incomplete: 0,
  overreach: 0,
  both: 0,
  unscored: 0,
});

function spaceOf(run: RunRecord): Space {
  return run.mode === "computer" ? "computer" : "tool";
}

export function summarise(runs: RunRecord[], space: Space): SpaceSummary {
  const mine = runs.filter((run) => spaceOf(run) === space);
  const summary: SpaceSummary = {
    space,
    scored: 0,
    unscored: 0,
    passed: 0,
    verdicts: EMPTY_VERDICTS(),
    turns: 0,
    tokens: 0,
    cost: 0,
    missedClicks: 0,
    clicks: 0,
    actions: 0,
  };

  for (const run of mine) {
    summary.turns += run.turns;
    summary.tokens += run.tokens.total;
    summary.cost += run.cost;

    for (const entry of run.entries) {
      if (!isActionEntry(entry)) continue;
      summary.actions += 1;
      if (!AIMED_AT_A_POINT.has(entry.action_name)) continue;
      summary.clicks += 1;
      // "hit nothing" is the signature of a grounding miss: the model chose a
      // point and no control was under it. The driver writes it on the entry
      // (`driver.ts`, "the click landed on nothing").
      if (entry.metadata?.hit === "nothing") summary.missedClicks += 1;
    }

    if (!isScored(run)) {
      summary.unscored += 1;
      summary.verdicts.unscored += 1;
      continue;
    }

    summary.scored += 1;
    const key = (run.verdict?.status ?? "unscored") as VerdictKey;
    summary.verdicts[key] += 1;
    if (key === "pass") summary.passed += 1;
  }

  return summary;
}

export interface Totals {
  runs: number;
  tasks: number;
  turns: number;
  tokens: number;
  cost: number;
  models: string[];
}

export function totals(runs: RunRecord[]): Totals {
  return {
    runs: runs.length,
    tasks: new Set(runs.map((run) => run.taskId)).size,
    turns: runs.reduce((sum, run) => sum + run.turns, 0),
    tokens: runs.reduce((sum, run) => sum + run.tokens.total, 0),
    cost: runs.reduce((sum, run) => sum + run.cost, 0),
    models: [...new Set(runs.map((run) => run.model))].sort(),
  };
}

/**
 * The newest run of one task, in one action space, by one model.
 *
 * The model is required rather than optional, and that is the whole point of
 * the signature. With more than one model recorded, "the newest run of this
 * task in this space" is a question with an answer that changes depending on
 * which model was recorded last — so a caller that forgot the model did not
 * get a slightly worse answer, it got a different model's verdict rendered in
 * a place that implied a single one. Making it impossible to omit is cheaper
 * than remembering to pass it.
 */
export function cell(
  runs: RunRecord[],
  taskId: string,
  space: Space,
  model: string,
): RunRecord | undefined {
  return runs
    .filter((run) => run.taskId === taskId && run.model === model && spaceOf(run) === space)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
}

export interface TaskRow {
  model: string;
  computer?: RunRecord;
  tool?: RunRecord;
}

/**
 * Every model that has attempted one task, with its latest run in each space.
 *
 * One row per model, always — never a single "the run for this task", which is
 * only well defined while exactly one model has been recorded. A model that has
 * attempted one space and not the other keeps its row with a gap in it, because
 * a missing measurement and a failed one are different facts and the table has
 * to be able to show both.
 *
 * Ordered by how much each model has attempted, so the model with the most
 * evidence reads first rather than whichever happened to run last.
 */
export function byTaskAndModel(runs: RunRecord[], taskId: string): TaskRow[] {
  const forTask = runs.filter((run) => run.taskId === taskId);
  const models = [...new Set(forTask.map((run) => run.model))];

  return models
    .map((model) => ({
      model,
      computer: cell(forTask, taskId, "computer", model),
      tool: cell(forTask, taskId, "tool", model),
    }))
    .sort((a, b) => {
      const count = (row: TaskRow) => (row.computer ? 1 : 0) + (row.tool ? 1 : 0);
      return count(b) - count(a) || a.model.localeCompare(b.model);
    });
}
