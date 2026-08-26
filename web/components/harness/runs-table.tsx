"use client";

/**
 * The results table.
 *
 * Column order follows the convention every eval console converges on —
 * identity, then outcome, then what it cost — with scores to the left of
 * resource metrics. Cost and tokens sit in the same table as the verdict but
 * are never folded into it: they are a tradeoff axis, not a quality score.
 *
 * The one thing this does that a plain table does not is refuse to draw an
 * unscored attempt as a bad run. An attempt that never reached a model is not
 * evidence about the model, so its row is set back — muted, no verdict colour,
 * the reason spelled out — and the footer counts it separately from the rows
 * that are. Letting an infrastructure failure read as a capability failure is
 * the easiest way for an evaluation to lie.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  type RunRecord,
  formatCost,
  formatDuration,
  formatRelative,
  isScored,
  statusLabel,
} from "@/lib/harness/runs";
import { cn } from "@/lib/utils";

type Key = "started" | "verdict" | "task" | "model" | "turns" | "tokens" | "cost" | "duration";
type Direction = "asc" | "desc";

/** Passing first when sorting by verdict, then near-misses, then absences. */
const VERDICT_ORDER: Record<string, number> = {
  pass: 0,
  overreach: 1,
  incomplete: 2,
  both: 3,
  unscored: 4,
};

function valueOf(run: RunRecord, key: Key): number | string {
  switch (key) {
    case "started":
      return run.startedAt;
    case "verdict":
      return VERDICT_ORDER[isScored(run) ? (run.verdict?.status ?? "unscored") : "unscored"] ?? 9;
    case "task":
      return run.taskTitle;
    case "model":
      return run.model;
    case "turns":
      return run.turns;
    case "tokens":
      return run.tokens.total;
    case "cost":
      return run.cost;
    case "duration":
      return run.durationMs;
  }
}

function sortRuns(runs: RunRecord[], key: Key, direction: Direction): RunRecord[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...runs].sort((a, b) => {
    const left = valueOf(a, key);
    const right = valueOf(b, key);
    if (typeof left === "string" || typeof right === "string") {
      return String(left).localeCompare(String(right)) * sign;
    }
    // A stable tiebreak, so re-sorting on a column full of equal values does
    // not shuffle rows the reader had already found.
    return (left - right) * sign || b.startedAt - a.startedAt;
  });
}

function SortHead({
  label,
  column,
  sort,
  onSort,
  className,
  hint,
}: {
  label: string;
  column: Key;
  sort: { key: Key; direction: Direction };
  onSort: (key: Key) => void;
  className?: string;
  hint?: string;
}) {
  const active = sort.key === column;
  const Arrow = sort.direction === "asc" ? ArrowUp : ArrowDown;

  const button = (
    <button
      type="button"
      onClick={() => onSort(column)}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {label}
      <Arrow className={cn("size-3", active ? "opacity-100" : "opacity-0")} aria-hidden />
    </button>
  );

  return (
    // `aria-sort` belongs on the header cell, not on the control inside it:
    // the sort state describes the column, and `button` does not support it.
    <TableHead
      className={className}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      {hint ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent className="max-w-[260px] text-xs leading-relaxed">{hint}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
    </TableHead>
  );
}

export function RunsTable({ runs, ready }: { runs: RunRecord[]; ready: boolean }) {
  // Relative times are computed after mount: rendering them on the server
  // produces a different string than the client a moment later.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const [sort, setSort] = useState<{ key: Key; direction: Direction }>({
    key: "started",
    direction: "desc",
  });

  const onSort = (key: Key) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : // Text reads best ascending; every number here reads best largest-first.
          { key, direction: key === "task" || key === "model" ? "asc" : "desc" },
    );

  const rows = useMemo(() => sortRuns(runs, sort.key, sort.direction), [runs, sort]);

  const footer = useMemo(() => {
    const scored = runs.filter(isScored);
    return {
      scored: scored.length,
      unscored: runs.length - scored.length,
      turns: runs.reduce((sum, run) => sum + run.turns, 0),
      tokens: runs.reduce((sum, run) => sum + run.tokens.total, 0),
      cost: runs.reduce((sum, run) => sum + run.cost, 0),
      duration: runs.reduce((sum, run) => sum + run.durationMs, 0),
    };
  }, [runs]);

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
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        No runs match these filters.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortHead label="Verdict" column="verdict" sort={sort} onSort={onSort} />
            <SortHead label="Task" column="task" sort={sort} onSort={onSort} />
            <SortHead
              label="Model"
              column="model"
              sort={sort}
              onSort={onSort}
              className="hidden md:table-cell"
            />
            <TableHead className="hidden lg:table-cell">Action space</TableHead>
            <SortHead
              label="Turns"
              column="turns"
              sort={sort}
              onSort={onSort}
              className="text-right"
              hint="Turns taken against the budget for this task in this action space. Driving pixels costs more turns than naming an action, so the two budgets differ."
            />
            <SortHead
              label="Tokens"
              column="tokens"
              sort={sort}
              onSort={onSort}
              className="hidden text-right sm:table-cell"
            />
            <SortHead
              label="Cost"
              column="cost"
              sort={sort}
              onSort={onSort}
              className="hidden text-right sm:table-cell"
            />
            <SortHead
              label="Duration"
              column="duration"
              sort={sort}
              onSort={onSort}
              className="hidden text-right sm:table-cell"
            />
            <SortHead
              label="Started"
              column="started"
              sort={sort}
              onSort={onSort}
              className="text-right"
            />
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((run) => {
            const scored = isScored(run);

            return (
              <TableRow
                key={run.id}
                className={cn("cursor-pointer", !scored && "bg-muted/30 text-muted-foreground")}
              >
                <TableCell>
                  <Link href={`/runs/${run.id}`} className="block">
                    <VerdictBadge status={scored ? (run.verdict?.status ?? null) : null} size="sm" />
                  </Link>
                </TableCell>

                <TableCell>
                  <Link
                    href={`/runs/${run.id}`}
                    className={cn("block font-medium hover:underline", !scored && "font-normal")}
                  >
                    {run.taskTitle}
                  </Link>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "text-xs",
                        scored ? "text-muted-foreground" : "text-status-warning",
                      )}
                    >
                      {statusLabel(run.status)}
                    </span>
                    {!scored && (
                      <Tooltip>
                        <TooltipTrigger className="cursor-help text-[11px] underline decoration-dotted underline-offset-2">
                          not evidence
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[280px] text-xs leading-relaxed">
                          This attempt never reached a model, so it says nothing about one. It is
                          left out of every rate on the models page rather than averaged in as a
                          zero, which would bias the numbers computed afterwards.
                        </TooltipContent>
                      </Tooltip>
                    )}
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

                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {/* The budget drawn to scale. "9/22" and "9/12" are the
                        same number of turns and very different runs. */}
                    <span
                      className="relative hidden h-1 w-10 shrink-0 overflow-hidden rounded-full bg-muted sm:block"
                      aria-hidden
                    >
                      <span
                        className={cn(
                          "absolute inset-y-0 left-0 rounded-full",
                          run.status === "max_turns" ? "bg-status-warning" : "bg-chart-1",
                        )}
                        style={{
                          width: `${Math.min(100, (run.turns / Math.max(run.maxTurns, 1)) * 100)}%`,
                        }}
                      />
                    </span>
                    <span className="tabular text-sm">
                      {run.turns}
                      <span className="text-muted-foreground">/{run.maxTurns}</span>
                    </span>
                  </div>
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
            );
          })}
        </TableBody>

        {/* Totals for what is on screen, so a filter answers "what did the
            computer-use runs cost" without anyone adding up a column. */}
        <tfoot className="border-t bg-muted/25 text-sm">
          <tr>
            <td className="px-2 py-2.5 text-xs text-muted-foreground" colSpan={2}>
              <span className="tabular font-medium text-foreground">{footer.scored}</span> scored
              {footer.unscored > 0 && (
                <>
                  {" · "}
                  <span className="tabular">{footer.unscored}</span> not evidence
                </>
              )}
            </td>
            <td className="hidden md:table-cell" />
            <td className="hidden lg:table-cell" />
            <td className="px-2 py-2.5 text-right tabular text-muted-foreground">{footer.turns}</td>
            <td className="hidden px-2 py-2.5 text-right tabular text-muted-foreground sm:table-cell">
              {footer.tokens.toLocaleString()}
            </td>
            <td className="hidden px-2 py-2.5 text-right tabular font-medium sm:table-cell">
              {formatCost(footer.cost)}
            </td>
            <td className="hidden px-2 py-2.5 text-right tabular text-muted-foreground sm:table-cell">
              {formatDuration(footer.duration)}
            </td>
            <td />
          </tr>
        </tfoot>
      </Table>
    </div>
  );
}
