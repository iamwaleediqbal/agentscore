"use client";

import { useEffect, useMemo, useState } from "react";

import { loadPublished } from "@/lib/harness/published";
import type { RunRecord } from "@/lib/harness/runs";
import { SEEDED_RUNS } from "@/lib/harness/seeded";

/**
 * The runs this console shows, and where they come from.
 *
 * One committed file, `public/runs/index.json`, and nothing else. There is no
 * browser storage in this any more and no way to start a run from the page,
 * because there is nothing here that could: the console is static, holds no
 * key, and cannot reach a model.
 *
 * That is the point rather than a limitation. Every visitor sees exactly the
 * same evidence, and the only way the evidence changes is that somebody
 * recorded a run against the public gym with a real browser and pushed the
 * result. A page that could produce its own numbers is a page whose numbers
 * nobody else can check.
 *
 * The samples that ship in source exist so the console is never an empty shell.
 * They retire the moment real runs are published.
 */
export function useRuns() {
  const [published, setPublished] = useState<RunRecord[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    loadPublished(controller.signal)
      .then(setPublished)
      .catch(() => setPublished([]))
      .finally(() => setReady(true));
    return () => controller.abort();
  }, []);

  const runs = useMemo(() => {
    const measured = published.length ? published : SEEDED_RUNS;
    return [...measured].sort((a, b) => b.startedAt - a.startedAt);
  }, [published]);

  return {
    runs,
    ready,
    /** True when the visible set is the committed file rather than the samples. */
    measured: published.length > 0,
  };
}
