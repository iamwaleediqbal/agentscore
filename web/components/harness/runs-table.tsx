"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { VerdictBadge } from "@/components/harness/verdict-badge";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type RunRecord,
  formatCost,
  formatDuration,
  formatRelative,
  statusLabel,
} from "@/lib/harness/runs";

export function RunsTable({ runs, ready }: { runs: RunRecord[]; ready: boolean }) {
  // Relative times are computed after mount: rendering them on the server
  // produces a different string than the client a moment later.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!ready) {
    return (
      <div className="space-y-2 p-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (!runs.length) {
    return <p className="px-4 py-10 text-center text-sm text-muted-foreground">No runs yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Verdict</TableHead>
            <TableHead>Task</TableHead>
            <TableHead className="hidden md:table-cell">Model</TableHead>
            <TableHead className="hidden lg:table-cell">Action space</TableHead>
            <TableHead className="text-right">Turns</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Tokens</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Cost</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Duration</TableHead>
            <TableHead className="text-right">Started</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id} className="cursor-pointer">
              <TableCell>
                <Link href={`/runs/${run.id}`} className="block">
                  <VerdictBadge status={run.verdict?.status ?? null} size="sm" />
                </Link>
              </TableCell>
              <TableCell>
                <Link href={`/runs/${run.id}`} className="block font-medium hover:underline">
                  {run.taskTitle}
                </Link>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    {statusLabel(run.status)}
                  </span>
                  {run.seeded && (
                    <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">
                      sample
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="hidden max-w-[220px] truncate font-mono text-xs text-muted-foreground md:table-cell">
                <span title={run.model}>{run.model}</span>
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant={run.mode === "computer" ? "default" : "outline"}
                    className="font-normal"
                  >
                    {run.mode === "computer" ? "computer use" : "tool calling"}
                  </Badge>
                  <Badge variant="secondary" className="font-normal">
                    {run.runner === "playwright" ? "Chromium" : "In-page"}
                  </Badge>
                </div>
              </TableCell>
              <TableCell className="text-right tabular text-sm">
                {run.turns}/{run.maxTurns}
              </TableCell>
              <TableCell className="hidden text-right tabular text-sm text-muted-foreground sm:table-cell">
                {run.tokens.total.toLocaleString()}
              </TableCell>
              <TableCell className="hidden text-right tabular text-sm text-muted-foreground sm:table-cell">
                {formatCost(run.cost)}
              </TableCell>
              <TableCell className="hidden text-right tabular text-sm text-muted-foreground sm:table-cell">
                {formatDuration(run.durationMs)}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {now ? formatRelative(run.startedAt, now) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
