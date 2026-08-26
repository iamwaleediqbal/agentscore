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
import { byTaskAndModel } from "@/lib/harness/analytics";
import { formatCost, statusLabel } from "@/lib/harness/runs";

const SPACES = [
  { space: "computer" as const, label: "Computer use" },
  { space: "tool" as const, label: "Tool calling" },
];

export function TaskDetail({ task }: { task: Task }) {
  const { runs } = useRuns();
  const rows = byTaskAndModel(runs, task.id);
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
            {/* One row per model, never one row per space.
                
                A single "the computer-use run for this task" is well defined
                only while exactly one model has been recorded; the moment a
                second is, it silently means "whichever ran last". So the model
                is the row, both spaces are columns, and a model that attempted
                one space and not the other keeps its row with a gap — because
                a measurement nobody took and a measurement that failed are
                different facts. */}
            <div className="mt-2 space-y-2">
              {rows.length === 0 && (
                <p className="rounded-md border border-dashed px-3 py-2 text-[11px] text-muted-foreground">
                  Nothing recorded for this task yet.
                </p>
              )}

              {rows.map((row) => (
                <div key={row.model} className="rounded-md border px-3 py-2">
                  <div className="font-mono text-[11px] text-muted-foreground">{row.model}</div>

                  <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                    {SPACES.map(({ space, label }) => {
                      const run = row[space];
                      return (
                        <div
                          key={space}
                          className="flex min-w-0 flex-wrap items-center gap-2 rounded bg-muted/40 px-2 py-1.5"
                        >
                          <span className="text-[11px] text-muted-foreground">{label}</span>
                          {run ? (
                            <>
                              <VerdictBadge status={run.verdict?.status ?? null} size="sm" />
                              <span className="tabular text-[11px] text-muted-foreground">
                                {run.turns}/{run.maxTurns} · {formatCost(run.cost)}
                              </span>
                              <Button
                                asChild
                                size="sm"
                                variant="ghost"
                                className="ml-auto h-6 px-2 text-[11px]"
                              >
                                <Link href={`/runs/${run.id}`}>Open</Link>
                              </Button>
                            </>
                          ) : (
                            <span className="text-[11px] text-muted-foreground/70">
                              not recorded
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
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
