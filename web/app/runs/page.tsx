"use client";

import { useMemo, useState } from "react";

import { FilterBar, FilterGroup } from "@/components/harness/filter-bar";
import { RunsTable } from "@/components/harness/runs-table";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRuns } from "@/hooks/use-runs";
import { formatCost } from "@/lib/harness/runs";
import { totals } from "@/lib/harness/analytics";
import {
  NO_RUN_FILTERS,
  anyActive,
  filterRuns,
  optionsFor,
  type RunFilters,
} from "@/lib/harness/filters";
import { VERDICT } from "@/lib/harness/verdict-meta";
import type { VerdictKey } from "@/lib/harness/analytics";

const VERDICTS: VerdictKey[] = ["pass", "overreach", "incomplete", "both", "unscored"];

export default function Runs() {
  const { runs, ready, measured } = useRuns();
  const [filters, setFilters] = useState<RunFilters>(NO_RUN_FILTERS);

  const set = <K extends keyof RunFilters>(key: K) =>
    (value: string) => setFilters((current) => ({ ...current, [key]: value as RunFilters[K] }));

  const shown = useMemo(() => filterRuns(runs, filters), [runs, filters]);

  const groups = useMemo(() => {
    const models = [...new Set(runs.map((run) => run.model))].sort();
    const tasks = [...new Map(runs.map((run) => [run.taskId, run.taskTitle])).entries()].sort(
      (a, b) => a[1].localeCompare(b[1]),
    );

    return {
      verdict: optionsFor(
        runs,
        filters,
        "verdict",
        VERDICTS.map((value) => ({ value, label: VERDICT[value].short })),
      ),
      space: optionsFor(runs, filters, "space", [
        { value: "computer" as const, label: "Computer use" },
        { value: "tool" as const, label: "Tool calling" },
      ]),
      model: optionsFor(
        runs,
        filters,
        "model",
        // The provider prefix is the same on every row and eats the width the
        // part that differs needs.
        models.map((value) => ({ value, label: value.split("/").pop() ?? value })),
      ),
      task: optionsFor(
        runs,
        filters,
        "task",
        tasks.map(([value, label]) => ({ value, label })),
      ),
    };
  }, [runs, filters]);

  if (!ready) return <Skeleton className="h-72 w-full" />;

  const all = totals(runs);
  const visible = totals(shown);
  const active = anyActive(filters);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
        <p className="max-w-[80ch] text-sm leading-relaxed text-muted-foreground">
          {measured ? (
            <>
              Every recorded evaluation. These were driven by a real Chromium against the live
              application and committed with the deployment, so everyone opening this page sees
              the same evidence. Each row opens the full trajectory: what the model saw, what it
              did, and the two state snapshots its verdict was computed from.
            </>
          ) : (
            <>
              These are scripted sample runs, marked <em>sample</em>, shown so the platform is
              not an empty shell. They retire the moment real runs are published.
            </>
          )}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span className="tabular">
          {active ? `${visible.runs} of ${all.runs}` : all.runs} runs
        </span>
        <span aria-hidden>·</span>
        <span className="tabular">{visible.tasks} tasks</span>
        <span aria-hidden>·</span>
        <span className="tabular">{visible.models.length} models</span>
        <span aria-hidden>·</span>
        <span className="tabular">{visible.tokens.toLocaleString()} tokens</span>
        <span aria-hidden>·</span>
        <span className="tabular">{formatCost(visible.cost)}</span>
      </div>

      <FilterBar
        showing={shown.length}
        total={runs.length}
        active={active}
        onClear={() => setFilters(NO_RUN_FILTERS)}
      >
        <FilterGroup
          label="Verdict"
          options={groups.verdict}
          value={filters.verdict}
          onChange={set("verdict")}
        />
        <FilterGroup
          label="Space"
          options={groups.space}
          value={filters.space}
          onChange={set("space")}
        />
        <FilterGroup
          label="Model"
          options={groups.model}
          value={filters.model}
          onChange={set("model")}
        />
        <FilterGroup label="Task" options={groups.task} value={filters.task} onChange={set("task")} />
      </FilterBar>

      <Card className="overflow-hidden p-0">
        <CardContent className="p-0">
          <RunsTable runs={shown} ready={ready} />
        </CardContent>
      </Card>

      {active && shown.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing matches that combination.{" "}
          <button
            type="button"
            onClick={() => setFilters(NO_RUN_FILTERS)}
            className="underline underline-offset-4 hover:text-foreground"
          >
            Clear the filters
          </button>{" "}
          to see all {all.runs} runs.
        </p>
      )}
    </div>
  );
}