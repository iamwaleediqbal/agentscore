/**
 * Regrade recorded runs from their stored snapshots.
 *
 * A verdict is a derivation of two snapshots and a task's expected change, so it
 * can be computed again at any time. This is the code that does it: no model
 * call, no browser, no environment, only the grader over what the run record
 * already holds. Change the grading logic, run this, and every past run is
 * scored by the new rules, with a report of exactly which verdicts moved.
 */

import type { MailState } from "../environment/state.ts";
import { MAILBOX } from "../environment/describe.ts";
import { type Grade, type Status, grade } from "./grade.ts";
import { type RunRecord, isScored } from "./runs.ts";
import { taskById } from "./tasks.ts";

/** Anything that turns a run record into a verdict. The default is the real grader. */
export type Grader = (run: RunRecord) => Grade | null;

export type SkipReason = "no snapshots" | "unknown task" | "unscored";

export interface Moved {
  id: string;
  taskId: string;
  model: string;
  before: Status | null;
  after: Status | null;
}

export interface RegradeReport {
  /** The runs with their verdicts recomputed. Runs that were skipped come back untouched. */
  runs: RunRecord[];
  /** Runs the grader actually ran on. */
  checked: number;
  /** Checked runs whose verdict came out exactly the same, details included. */
  unchanged: number;
  /** Checked runs whose verdict changed in any way, with the status either side. */
  changed: Moved[];
  /** Runs that could not be regraded, and why. They are reported, never failed. */
  skipped: { id: string; reason: SkipReason }[];
}

/** The verdict the runner would give this run today, computed from its snapshots alone. */
export function gradeFromSnapshots(run: RunRecord): Grade | null {
  const task = taskById(run.taskId);
  if (!task || !run.snapshots) return null;
  const initial = run.snapshots.initial as MailState;
  const final = run.snapshots.final as MailState;
  return grade(MAILBOX, initial, task.expected(initial), final);
}

function skipReason(run: RunRecord): SkipReason | null {
  // Same order the runner uses: an attempt that never reached a model has no
  // verdict to recompute, whatever else is on the record.
  if (!isScored(run)) return "unscored";
  if (!run.snapshots) return "no snapshots";
  if (!taskById(run.taskId)) return "unknown task";
  return null;
}

export function regrade(runs: RunRecord[], grader: Grader = gradeFromSnapshots): RegradeReport {
  const report: RegradeReport = { runs: [], checked: 0, unchanged: 0, changed: [], skipped: [] };

  for (const run of runs) {
    const reason = skipReason(run);
    if (reason) {
      report.skipped.push({ id: run.id, reason });
      report.runs.push(run);
      continue;
    }

    const verdict = grader(run);
    report.checked += 1;

    if (JSON.stringify(verdict) === JSON.stringify(run.verdict)) {
      report.unchanged += 1;
      report.runs.push(run);
      continue;
    }

    report.changed.push({
      id: run.id,
      taskId: run.taskId,
      model: run.model,
      before: run.verdict?.status ?? null,
      after: verdict?.status ?? null,
    });
    report.runs.push({ ...run, verdict });
  }

  return report;
}
