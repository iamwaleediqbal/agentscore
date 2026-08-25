// Relative, not through Next's `@/` alias.
//
// The Playwright runner typechecks the whole of lib/ — it shares the grader and
// the tasks — under its own tsconfig, which knows nothing about that alias. A
// path only one of the two configs can resolve breaks the other for a file it
// never imports.
import raw from "../../data/leaderboard.json";

/**
 * The model benchmark, committed rather than fetched.
 *
 * Produced by the Python side of this repository — `agentscore <suite>` — which
 * repeats every task, computes Wilson intervals, and marks models whose
 * intervals overlap as tied. The console imports the result at build time, so
 * the page is static and every visitor sees the same numbers.
 *
 * Two different measurements live in this console and they are not
 * interchangeable. This one asks *which free model follows instructions best*,
 * over many repeats of short text tasks. The runs section asks *can a model
 * operate an application*, over a handful of long browser sessions. Putting
 * them on one page without saying so would invite a comparison that means
 * nothing.
 */
export interface ModelResult {
  model: string;
  pass_rate: number;
  ci_low: number;
  ci_high: number;
  passes: number;
  attempts: number;
  tied_with?: string[];
}

export interface Leaderboard {
  suite: string;
  generated_at: string;
  repeats: number;
  task_count: number;
  judge_model: string;
  models: ModelResult[];
  notes?: string[];
  sample?: boolean;
}

export const LEADERBOARD = raw as Leaderboard;

/** Intervals that overlap do not support a ranking, so they share one. */
export function ranked(models: ModelResult[]): { rank: number; model: ModelResult }[] {
  const sorted = [...models].sort((a, b) => b.pass_rate - a.pass_rate);
  const out: { rank: number; model: ModelResult }[] = [];

  sorted.forEach((model, index) => {
    const previous = out[index - 1];
    const tied = previous && previous.model.ci_low <= model.ci_high && model.ci_low <= previous.model.ci_high;
    out.push({ rank: tied ? previous.rank : index + 1, model });
  });
  return out;
}
