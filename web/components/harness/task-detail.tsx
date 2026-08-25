"use client";

/**
 * One task, in full, on demand.
 *
 * The list is for scanning — which tasks exist, how each one went in each
 * action space. Everything that answers "why is this task here" lives behind
 * the eye, because it is read once and then not again.
 */

import { Eye } from "lucide-react";
import Link from "next/link";

import { VerdictBadge } from "@/components/harness/verdict-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useRuns } from "@/hooks/use-runs";
import { MAILBOX } from "@/lib/environment/describe";
import { diff } from "@/lib/harness/grade";
import { offlineSeed, turnsFor, type Task } from "@/lib/harness/tasks";
import { cell } from "@/lib/harness/analytics";
import { formatCost, formatDuration, statusLabel } from "@/lib/harness/runs";

const SPACES = [
  { space: "computer" as const, label: "Computer use" },
  { space: "tool" as const, label: "Tool calling" },
];

export function TaskDetail({ task }: { task: Task }) {
  const { runs } = useRuns();
  const required = diff(MAILBOX, offlineSeed(), task.expected(offlineSeed()));

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          aria-label={`Open ${task.title}`}
        >
          <Eye className="size-4" />
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task.title}</DialogTitle>
          <DialogDescription>{task.prompt}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="What it catches">{task.probes}</Field>

          <Field label={`Required changes (${required.length})`}>
            <ul className="mt-1 space-y-1.5">
              {required.map((change) => (
                <li key={change.path} className="rounded-md border bg-muted/40 px-3 py-2">
                  <code className="block break-all font-mono text-[11px] text-muted-foreground">
                    {change.path}
                  </code>
                  <div className="mt-0.5 flex flex-wrap items-baseline gap-1.5 text-xs">
                    <span className="break-all text-muted-foreground line-through">
                      {String(change.before ?? "empty")}
                    </span>
                    <span className="text-muted-foreground">&rarr;</span>
                    <span className="break-all font-medium">
                      {String(change.after ?? "empty")}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Field>

          <Separator />

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Recorded runs
            </div>
            <div className="mt-2 space-y-2">
              {SPACES.map(({ space, label }) => {
                const run = cell(runs, task.id, space);
                return (
                  <div
                    key={space}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-sm">{label}</span>
                      {run ? (
                        <VerdictBadge status={run.verdict?.status ?? null} size="sm" />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">not recorded</span>
                      )}
                    </div>
                    {run && (
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="tabular">
                          {run.turns}/{run.maxTurns} turns · {run.tokens.total.toLocaleString()}{" "}
                          tokens · {formatCost(run.cost)} · {formatDuration(run.durationMs)}
                        </span>
                        <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                          <Link href={`/runs/${run.id}`}>Open trajectory</Link>
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Both, because the page is about the task rather than one run,
                and because the difference between them is the point: the same
                task costs a model driving pixels roughly twice the turns. */}
            <Badge variant="secondary" className="font-normal">
              {turnsFor(task, "tool")} turns · tool calling
            </Badge>
            <Badge variant="secondary" className="font-normal">
              {turnsFor(task, "computer")} turns · computer use
            </Badge>
            <Badge variant="secondary" className="font-normal">
              {statusLabel("completed")} is not the same as a pass
            </Badge>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}
