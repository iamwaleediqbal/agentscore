"use client";

/**
 * Moving between a task's two trajectories.
 *
 * Computer use and tool calling are recorded as separate runs, deliberately:
 * they observe different things and take different actions, so folding them
 * into one record would imply a single measurement where there are two. But
 * separate records with no path between them means the comparison exists only
 * in aggregate, and the interesting version of it is one task at a time —
 * the same instruction, the same grader, one passing and one not.
 *
 * So the other space is always one click away, and when it has not been
 * recorded the control says so rather than disappearing.
 */

import { Eye, FileText } from "lucide-react";
import Link from "next/link";

import { VerdictBadge } from "@/components/harness/verdict-badge";
import { useRuns } from "@/hooks/use-runs";
import { type RunRecord, formatCost } from "@/lib/harness/runs";
import { cn } from "@/lib/utils";

const SPACES = [
  { mode: "computer" as const, label: "Computer use", Icon: Eye },
  { mode: "tool" as const, label: "Tool calling", Icon: FileText },
];

export function ModeSwitch({ run }: { run: RunRecord }) {
  const { runs } = useRuns();
  const current = run.mode ?? "tool";

  return (
    <div className="flex flex-wrap gap-2">
      {SPACES.map(({ mode, label, Icon }) => {
        const active = mode === current;
        // Newest first, so the control points at the most recent attempt.
        const sibling = active
          ? run
          : runs
              .filter((r) => r.taskId === run.taskId && (r.mode ?? "tool") === mode)
              .sort((a, b) => b.startedAt - a.startedAt)[0];

        const body = (
          <div
            className={cn(
              "flex min-w-0 items-center gap-2.5 rounded-md border px-3 py-2 transition-colors",
              active && "border-primary/45 bg-primary/[0.07]",
              !active && sibling && "hover:border-primary/40",
              !active && !sibling && "border-dashed opacity-70",
            )}
          >
            <Icon
              className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")}
              aria-hidden
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={cn("text-sm", active && "font-medium")}>{label}</span>
                {active && <span className="text-[11px] text-muted-foreground">· showing</span>}
              </div>
              {sibling ? (
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <VerdictBadge status={sibling.verdict?.status ?? null} size="sm" />
                  <span className="tabular text-[11px] text-muted-foreground">
                    {sibling.turns}/{sibling.maxTurns} turns · {formatCost(sibling.cost)}
                  </span>
                </div>
              ) : (
                <div className="mt-0.5 text-[11px] text-muted-foreground">not recorded</div>
              )}
            </div>
          </div>
        );

        if (active || !sibling) return <div key={mode}>{body}</div>;
        return (
          <Link key={mode} href={`/runs/${sibling.id}`} className="block">
            {body}
          </Link>
        );
      })}
    </div>
  );
}
