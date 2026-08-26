"use client";

import Link from "next/link";

import { RunsTable } from "@/components/harness/runs-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRuns } from "@/hooks/use-runs";

export function RecentRuns({ limit }: { limit?: number }) {
  const { runs, ready } = useRuns();
  const shown = limit ? runs.slice(0, limit) : runs;

  return (
    <Card className="overflow-hidden p-0">
      <CardHeader className="flex-row items-center justify-between gap-2 border-b px-4 py-3">
        <CardTitle className="text-sm font-semibold">Recent runs</CardTitle>
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <Link href="/runs">View all</Link>
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {/* No totals row: this is a slice, and the Overview's own metrics
            above already total every run. */}
        <RunsTable runs={shown} ready={ready} totals={false} />
      </CardContent>
    </Card>
  );
}
