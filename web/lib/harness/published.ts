/**
 * Runs that ship with the deployment.
 *
 * The Playwright runner writes `public/runs/index.json`. Committing that file
 * publishes those runs to every visitor; there is no database and no upload
 * step, just a static asset the console fetches once. A deployment without the
 * file simply has none, which is why the fetch failing is not an error.
 *
 * These are measured, not scripted — real Chromium, real clicks, real
 * screenshots — so unlike the seeded samples they are labelled as evidence.
 */

import type { RunRecord } from "./runs.ts";

export interface PublishedIndex {
  generated_at: string;
  driver: string;
  runs: RunRecord[];
}

function looksLikeRun(value: unknown): value is RunRecord {
  const run = value as Partial<RunRecord> | null;
  return Boolean(
    run &&
      typeof run.id === "string" &&
      typeof run.taskId === "string" &&
      Array.isArray(run.entries),
  );
}

export async function loadPublished(signal?: AbortSignal): Promise<RunRecord[]> {
  try {
    const response = await fetch("/runs/index.json", { signal, cache: "no-store" });
    if (!response.ok) return [];
    const payload = (await response.json()) as Partial<PublishedIndex>;
    if (!Array.isArray(payload.runs)) return [];
    return payload.runs.filter(looksLikeRun).map((run) => ({ ...run, runner: "playwright" }));
  } catch {
    // No file, offline, or malformed. An empty console is the right fallback.
    return [];
  }
}
