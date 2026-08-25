import type { Change } from "@/lib/harness/grade";
import { cn } from "@/lib/utils";

export function ChangeList({
  title,
  changes,
  tone,
}: {
  title: string;
  changes: Change[];
  tone: "missing" | "extra";
}) {
  if (!changes.length) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h4>
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular",
            tone === "missing"
              ? "bg-status-critical/12 text-status-critical"
              : "bg-status-warning/15 text-status-warning",
          )}
        >
          {changes.length}
        </span>
      </div>
      <ul className="space-y-1.5">
        {changes.map((change) => (
          <li key={change.path} className="min-w-0 rounded-md border bg-muted/40 px-3 py-2">
            {/*
              Wrapped, not truncated. `truncate` sets white-space:nowrap, so the
              element demands its full content width — inside a grid or flex
              parent that has not been told it may shrink, it widens the
              container instead of ellipsising, and the clipping happens at the
              real edge where no ellipsis appears.

              A grading path is also the wrong thing to hide: "which field
              changed" is the entire content of the answer.
            */}
            <code className="block break-all font-mono text-[11px] text-muted-foreground">
              {change.path}
            </code>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-1.5 text-xs">
              <span className="break-all text-muted-foreground line-through">
                {format(change.before)}
              </span>
              <span className="text-muted-foreground">&rarr;</span>
              <span className="break-all font-medium">{format(change.after)}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function format(value: unknown): string {
  if (value === undefined || value === null || value === "") return "empty";
  const text = String(value);
  return text.length > 72 ? `${text.slice(0, 72)}…` : text;
}
