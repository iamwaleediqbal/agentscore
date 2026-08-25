/**
 * Run records and where they live.
 *
 * There is no database. Runs are kept in local storage, which is the honest
 * choice for a demo that must cost nothing to host: a run belongs to whoever
 * produced it, on the machine that produced it. Seeded runs ship with the app
 * so the platform is never an empty shell.
 */

import type { Grade } from "./grade.ts";
import type { TimelineEntry } from "./entries.ts";

export type RunStatus =
  | "completed"
  | "max_turns"
  | "no_action"
  | "cancelled"
  | "infrastructure_error"
  | "config_error";

export interface RunRecord {
  id: string;
  taskId: string;
  taskTitle: string;
  model: string;
  /** Which driver produced it: the in-page harness, or Chromium via Playwright. */
  runner: "browser" | "playwright";
  /**
   * Which action space it ran in. Absent means the semantic one, which is what
   * every run recorded before the computer-use mode existed used.
   */
  mode?: "tool" | "computer";
  status: RunStatus;
  detail?: string;
  startedAt: number;
  durationMs: number;
  turns: number;
  maxTurns: number;
  tokens: { input: number; output: number; total: number };
  cost: number;
  entries: TimelineEntry[];
  verdict: Grade | null;
  /**
   * The two snapshots a verdict was computed from: the world the environment
   * reported before the task, and the world it reported after.
   *
   * Kept because the verdict is a *derivation*, and a derivation you cannot
   * recompute is a number you have to trust. With the pair on the record, a
   * change to the grading logic is re-run against every past run for nothing —
   * no model call, no browser, no environment — and a reader can see exactly
   * what the agent was looking at and exactly what it left behind.
   *
   * Absent on runs recorded before this existed, which is why it is optional.
   */
  snapshots?: { initial: unknown; final: unknown };
  /** Seeded runs ship with the app and are never overwritten by a live one. */
  seeded?: boolean;
}

/*
 * The harness's own storage, named after the harness.
 *
 * It read `clickmail.runs.v1` — inherited from the copy this repository was
 * made from, and wrong twice over once the two split: these are run records,
 * which the environment knows nothing about, and they live on this origin,
 * which is not the environment's. Renaming orphans any locally recorded run
 * from before the split, which is the correct trade: those runs were recorded
 * against a harness that no longer exists.
 */
const KEY = "agentscore.runs.v1";
const LIMIT = 60;

export function loadRuns(): RunRecord[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RunRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Screenshots are the bulky part of a record; drop them without losing the run. */
function withoutScreenshots(run: RunRecord): RunRecord {
  return {
    ...run,
    entries: run.entries.map((entry) =>
      entry.entry_type === "action" && entry.screenshot
        ? { ...entry, screenshot: undefined }
        : entry,
    ),
  };
}

/** How many of the newest runs keep their pictures when space runs short. */
const KEEP_SHOTS = 3;

export function saveRun(run: RunRecord): RunRecord[] {
  const existing = loadRuns().filter((r) => r.id !== run.id);
  // Newest first, and bounded: a browser store is not an archive, and silently
  // filling someone's quota is a rude thing for a demo to do.
  const next = [run, ...existing].slice(0, LIMIT);

  /**
   * A run with screenshots is roughly fifty times the size of one without, so
   * a handful of them fills a 5MB origin quota. Rather than let the write fail
   * and lose the run on the next refresh, give up the pictures a step at a
   * time: first from the older runs, then from all of them, then shorten the
   * history. The newest run — the one someone just watched — keeps its
   * screenshots longest, because that is the one being shown.
   */
  const attempts: RunRecord[][] = [
    next,
    next.map((r, i) => (i < KEEP_SHOTS ? r : withoutScreenshots(r))),
    [next[0], ...next.slice(1).map(withoutScreenshots)],
    next.map(withoutScreenshots),
    next.slice(0, 12).map(withoutScreenshots),
  ];

  for (const attempt of attempts) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(attempt));
      return attempt;
    } catch {
      // Quota, or storage blocked entirely. Try a smaller payload.
    }
  }

  // Storage is unavailable, not merely full. The run is still on screen; it
  // just will not survive a refresh, which is better than losing it outright.
  return next;
}

export function deleteRun(id: string): RunRecord[] {
  const next = loadRuns().filter((r) => r.id !== id);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* see above */
  }
  return next;
}

/** Live runs first, then seeded ones, each newest first. */
export function mergeWithSeeded(stored: RunRecord[], seeded: RunRecord[]): RunRecord[] {
  const ids = new Set(stored.map((r) => r.id));
  return [...stored, ...seeded.filter((r) => !ids.has(r.id))].sort(
    (a, b) => b.startedAt - a.startedAt,
  );
}

export function statusLabel(status: RunStatus): string {
  switch (status) {
    case "completed":
      return "Completed";
    case "max_turns":
      return "Turn budget spent";
    case "no_action":
      return "Stopped acting";
    case "cancelled":
      return "Cancelled";
    case "infrastructure_error":
      return "Infrastructure";
    case "config_error":
      return "Configuration";
  }
}

/**
 * Whether a run is evidence about the model.
 *
 * An attempt that never reached a model is an absent measurement, not a
 * failure, and averaging it in as one biases every number computed afterwards.
 */
export function isScored(run: RunRecord): boolean {
  return run.status !== "infrastructure_error" && run.status !== "config_error";
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatRelative(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Fold freshly recorded runs into what is already published.
 *
 * Recording one task at a time only has value if each invocation keeps the
 * ones before it. A re-recorded task replaces its own earlier result — matched
 * on task *and* action space, because a computer-use run and a tool-calling run
 * of the same task are different measurements and must not overwrite each
 * other — and every other run is left untouched.
 */
export function mergeRecorded(existing: RunRecord[], fresh: RunRecord[]): RunRecord[] {
  const key = (run: RunRecord) => `${run.taskId}:${run.mode ?? "tool"}`;
  const replaced = new Set(fresh.map(key));
  return [...existing.filter((run) => !replaced.has(key(run))), ...fresh];
}

/**
 * What a run cost, said plainly.
 *
 * Free is not "$0.0000" — it is a different kind of fact, and writing it as a
 * number invites the reader to compare it with a small one. Paid figures are
 * shown to four decimals because a run of this size lands in the third or
 * fourth, and rounding to cents would render every one of them as $0.02.
 */
export function formatCost(credits: number): string {
  if (!credits) return "free";
  if (credits < 0.0001) return "<$0.0001";
  return `$${credits.toFixed(4)}`;
}
