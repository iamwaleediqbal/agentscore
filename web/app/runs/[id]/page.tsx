"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { GradingDialog } from "@/components/harness/grading-dialog";
import { ModeSwitch } from "@/components/harness/mode-switch";
import { RunMonitor } from "@/components/harness/run-monitor";
import { StateComparison } from "@/components/harness/state-comparison";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRuns } from "@/hooks/use-runs";
import { TASKS } from "@/lib/harness/tasks";
import { formatCost, formatDuration, statusLabel } from "@/lib/harness/runs";

export default function RunDetail() {
  const params = useParams<{ id: string }>();
  const { runs, ready } = useRuns();
  const run = runs.find((r) => r.id === params.id);
  const task = TASKS.find((t) => t.id === run?.taskId);

  if (!ready) return <Skeleton className="h-64 w-full" />;

  if (!run) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Run not found</h1>
        <p className="max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
          Every run this console shows is committed with the deployment, so a link to one opens
          the same trajectory for everybody. An id that is not here belongs to a run that was
          never published — or to one that has since been replaced by a newer recording of the
          same task, model and action space.
        </p>
        <Button asChild variant="outline">
          <Link href="/runs">
            <ArrowLeft className="size-3.5" />
            All runs
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <Link href="/runs">
            <ArrowLeft className="size-3.5" />
            All runs
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{run.taskTitle}</h1>
          {run.seeded && (
            <Badge variant="outline" className="font-normal">
              sample run
            </Badge>
          )}
        </div>
        {task && <p className="max-w-[80ch] text-sm text-muted-foreground">{task.prompt}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Outcome" value={statusLabel(run.status)} />
        <Stat label="Model" value={run.model} mono />
        <Stat label="Turns" value={`${run.turns}/${run.maxTurns}`} />
        <Stat label="Tokens" value={run.tokens.total.toLocaleString()} />
        <Stat label="Cost" value={formatCost(run.cost)} />
        <Stat label="Duration" value={formatDuration(run.durationMs)} />
      </div>

      {/* The same task in the other action space, one click away. They are
          separate runs on purpose — different observations, different actions —
          so they get separate records rather than one row with two verdicts. */}
      <ModeSwitch run={run} />

      {run.detail && (
        <Card>
          <CardContent className="py-4 text-sm leading-relaxed break-words text-muted-foreground">
            {run.detail}
          </CardContent>
        </Card>
      )}

      {/* The verdict before the trajectory, because they answer different
          questions and this is the one a reader came for. What changed is the
          measurement; how it got there is the story behind it. */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <h2 className="text-sm font-semibold">What changed</h2>
          <GradingDialog verdict={run.verdict} task={task} size="sm" />
        </div>
        <StateComparison run={run} />
      </div>

      {/* Full width. The trajectory is the thing being read; the verdict is a
          two-line answer that was taking half the pane and squeezing it. */}
      <div className="space-y-2">
        <h2 className="px-1 text-sm font-semibold">Action timeline</h2>
        <RunMonitor entries={run.entries} />
      </div>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    // min-w-0 lets the card shrink below its content, which is what makes the
    // truncate below actually truncate instead of widening the grid row.
    <div className="min-w-0 rounded-lg border bg-card px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`mt-0.5 truncate text-sm font-medium tabular ${mono ? "font-mono text-xs" : ""}`}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
