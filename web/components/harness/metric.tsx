"use client";

/**
 * A number, what it is called, and what it means.
 *
 * The tooltip is not decoration. Every figure on this dashboard is a term of
 * art — "unscored", "overreach", "grounding miss" — and a dashboard that shows
 * a number without saying what it counts is asking to be misread.
 */

import { Info } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function Metric({
  label,
  value,
  sub,
  hint,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  hint: string;
  tone?: "good" | "warning" | "critical";
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground/60 transition-colors hover:text-foreground"
              aria-label={`What ${label} means`}
            >
              <Info className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[260px] text-xs leading-relaxed">
            {hint}
          </TooltipContent>
        </Tooltip>
      </div>

      <div
        className={cn(
          "mt-1 truncate text-2xl font-semibold tabular tracking-tight",
          tone === "good" && "text-status-good",
          tone === "warning" && "text-status-warning",
          tone === "critical" && "text-status-critical",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
