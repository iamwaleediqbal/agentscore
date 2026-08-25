"use client";

import { FlaskConical } from "lucide-react";
import Link from "next/link";

import { Metric } from "@/components/harness/metric";
import { SpaceComparison } from "@/components/harness/space-comparison";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TASKS } from "@/lib/harness/tasks";
import { useRuns } from "@/hooks/use-runs";
import { summarise, totals } from "@/lib/harness/analytics";
import { formatCost } from "@/lib/harness/runs";

/**
 * What has actually been measured, above anything anyone can do.
 *
 * The page used to lead with a form that no visitor can submit — starting a run
 * spends a model call, so it is owner-only. Leading with a locked control tells
 * a reader nothing about the project; leading with the results tells them
 * everything it is for.
 */
export function Dashboard() {
  const { runs, ready, measured } = useRuns();

  if (!ready) return <Skeleton className="h-64 w-full" />;

  const all = totals(runs);
  const computer = summarise(runs, "computer");
  const tool = summarise(runs, "tool");
  const covered = new Set(runs.map((r) => r.taskId)).size;

  return (
    <div className="space-y-4">
      {!measured && (
        <Alert>
          <FlaskConical className="size-4" />
          <AlertDescription>
            These are scripted sample runs, shown so the platform is not an empty shell. They
            are marked <span className="font-medium text-foreground">sample</span> everywhere
            they appear and retire the moment real runs are published.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Runs recorded"
          value={String(all.runs)}
          sub={`${covered} of ${TASKS.length} tasks covered`}
          hint="Every recorded attempt, in both action spaces. A task run both ways counts as two, because they are two different measurements."
        />
        <Metric
          label="Passed"
          value={`${computer.passed + tool.passed} of ${computer.scored + tool.scored}`}
          sub="counts, not a rate"
          hint="Runs where every required change happened and nothing else moved. Shown as a count on purpose: a percentage over a sample this small reads as a precision the evidence does not have."
          tone={computer.passed + tool.passed > 0 ? "good" : undefined}
        />
        <Metric
          label="Total cost"
          value={formatCost(all.cost)}
          sub={`${all.tokens.toLocaleString()} tokens`}
          hint="What the provider charged for every recorded run combined. Free models report zero; a paid run records what it actually cost."
        />
        <Metric
          label="Turns spent"
          value={String(all.turns)}
          sub={all.models.length === 1 ? all.models[0] : `${all.models.length} models`}
          hint="One turn is one screenshot in and one action out. A task that exhausts its turn budget without finishing is recorded as incomplete, not as a crash."
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <SpaceComparison summary={computer} />
        <SpaceComparison summary={tool} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3">
        <p className="max-w-[62ch] text-xs leading-relaxed text-muted-foreground">
          The gap between those two is the point. Both use the same tasks, the same starting
          mailbox and the same grader, and differ only in what the model is shown. So a task
          that passes with a named action and fails with a coordinate did not fail because the
          model misunderstood it.
        </p>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/tasks">Tasks</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/runs">All runs</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
