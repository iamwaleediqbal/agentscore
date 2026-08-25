"use client";

import { RunsTable } from "@/components/harness/runs-table";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRuns } from "@/hooks/use-runs";
import { formatCost } from "@/lib/harness/runs";
import { totals } from "@/lib/harness/analytics";

export default function Runs() {
  const { runs, ready, measured } = useRuns();

  if (!ready) return <Skeleton className="h-72 w-full" />;

  const all = totals(runs);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
        <p className="max-w-[80ch] text-sm leading-relaxed text-muted-foreground">
          {measured ? (
            <>
              Every recorded evaluation, newest first. These were driven by a real Chromium
              against the live application and committed with the deployment, so everyone
              opening this page sees the same evidence.
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
        <span className="tabular">{all.runs} runs</span>
        <span aria-hidden>·</span>
        <span className="tabular">{all.tasks} tasks</span>
        <span aria-hidden>·</span>
        <span className="tabular">{all.tokens.toLocaleString()} tokens</span>
        <span aria-hidden>·</span>
        <span className="tabular">{formatCost(all.cost)}</span>
      </div>

      <Card className="overflow-hidden p-0">
        <CardContent className="p-0">
          <RunsTable runs={runs} ready={ready} />
        </CardContent>
      </Card>
    </div>
  );
}
