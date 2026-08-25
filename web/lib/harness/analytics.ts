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
    actions: 0,
  };

  for (const run of mine) {
    summary.turns += run.turns;
    summary.tokens += run.tokens.total;
    summary.cost += run.cost;

    for (const entry of run.entries) {
      if (!isActionEntry(entry)) continue;
      summary.actions += 1;
      // "hit nothing" is the signature of a grounding miss: the model chose a
      // point and no control was under it.
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

/** The newest run for one task in one action space, or nothing. */
export function cell(runs: RunRecord[], taskId: string, space: Space): RunRecord | undefined {
  return runs
    .filter((run) => run.taskId === taskId && spaceOf(run) === space)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
}
