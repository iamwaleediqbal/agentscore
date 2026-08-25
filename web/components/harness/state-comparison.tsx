import { Check, Minus, Plus } from "lucide-react";

import { formatValue } from "@/components/harness/change-list";
import { Card, CardContent } from "@/components/ui/card";
import type { Change } from "@/lib/harness/grade";
import type { RunRecord } from "@/lib/harness/runs";
import { cn } from "@/lib/utils";

/**
 * The verdict, shown as the comparison it actually is.
 *
 * A run record carries the two worlds the grade was computed from — what the
 * environment reported before the task and what it reported after — and until
 * this existed, neither reached the page. The reader got a word ("Incomplete")
 * and had to take it.
 *
 * So this renders the arithmetic instead of the answer: every change the task
 * required, marked done or missing, and every change the agent made that
 * nobody asked for. Anyone can check the verdict against it without running
 * anything, which is the only version of "graded on final state" a reader has
 * reason to believe.
 */
export function StateComparison({ run }: { run: RunRecord }) {
  const grade = run.verdict;

  if (!grade) {
    return (
      <Card>
        <CardContent className="py-4 text-sm leading-relaxed text-muted-foreground">
          This run has no verdict. It never reached a model, so there is no state to
          compare — an absent measurement rather than a failed one.
        </CardContent>
      </Card>
    );
  }

  const missing = new Set(grade.missing.map((c) => c.path));

  return (
    <div className="space-y-4">
      <Row
        title="What the task required"
        empty="This task requires no change to the mailbox."
        rows={grade.required.map((change) => ({
          change,
          done: !missing.has(change.path),
        }))}
      />
      <Row
        title="What nobody asked for"
        empty="Nothing else moved."
        extra
        rows={grade.extra.map((change) => ({ change, done: false }))}
      />

      {run.snapshots ? (
        <details className="rounded-lg border bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            The two snapshots this was computed from
          </summary>
          <div className="grid gap-3 border-t p-4 lg:grid-cols-2">
            <Snapshot label="Before the task" value={run.snapshots.initial} />
            <Snapshot label="After the agent stopped" value={run.snapshots.final} />
          </div>
          <p className="border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            Kept because a verdict is a derivation, and a derivation you cannot
            recompute is a number you have to trust. Changing the grading logic
            regrades every past run from these two values — no model call, no
            browser, no environment.
          </p>
        </details>
      ) : (
        <p className="px-1 text-xs text-muted-foreground">
          Recorded before snapshots were kept, so this verdict cannot be recomputed.
        </p>
      )}
    </div>
  );
}

function Row({
  title,
  rows,
  empty,
  extra,
}: {
  title: string;
  rows: { change: Change; done: boolean }[];
  empty: string;
  extra?: boolean;
}) {
  return (
    <div className="space-y-2">
      <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(({ change, done }) => (
            <li
              key={change.path}
              className="flex min-w-0 items-start gap-2.5 rounded-md border bg-muted/40 px-3 py-2"
            >
              <Mark done={done} extra={extra} />
              <div className="min-w-0 flex-1">
                {/* Wrapped, never truncated: which field changed is the whole
                    content of the answer. */}
                <code className="block break-all font-mono text-[11px] text-muted-foreground">
                  {change.path}
                </code>
                <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-1.5 text-xs">
                  <span className="break-all text-muted-foreground line-through">
                    {formatValue(change.before)}
                  </span>
                  <span className="text-muted-foreground">&rarr;</span>
                  <span className="break-all font-medium">{formatValue(change.after)}</span>
                </div>
              </div>
              <span
                className={cn(
                  "shrink-0 text-[11px] font-medium",
                  extra
                    ? "text-status-warning"
                    : done
                      ? "text-status-good"
                      : "text-status-critical",
                )}
              >
                {extra ? "unrequested" : done ? "done" : "missing"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Mark({ done, extra }: { done: boolean; extra?: boolean }) {
  const Icon = extra ? Plus : done ? Check : Minus;
  return (
    <Icon
      aria-hidden
      className={cn(
        "mt-0.5 size-3.5 shrink-0",
        extra ? "text-status-warning" : done ? "text-status-good" : "text-status-critical",
      )}
    />
  );
}

function Snapshot({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {/* Its own scroll container. A wide JSON dump must not be allowed to
          widen the page — the body scrolling sideways is a layout bug on every
          other element at once. */}
      <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
