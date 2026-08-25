"use client";

/**
 * The comparison the project exists to make, as a part-to-whole bar per space.
 *
 * A stacked bar rather than a percentage, and counts rather than rates. Six runs
 * per space cannot support "17%" — that reads as a measurement, and a rate
 * printed over a sample this thin is the exact overclaim this project is about
 * refusing. "1 of 6 passed" says the same thing and cannot be misread.
 *
 * Verdicts are status, not categories, so they use the reserved status colours
 * and every segment carries an icon and a label. Colour is never the only thing
 * telling them apart — which is what makes a green/amber/red set legitimate
 * here, since a traffic-light trio cannot pass a categorical CVD check and is
 * not asked to.
 */

import { Eye, FileText } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SpaceSummary } from "@/lib/harness/analytics";
import { VERDICT, type VerdictKey } from "@/lib/harness/verdict-meta";
import { cn } from "@/lib/utils";

/** Order is fixed: best outcome first, unscored last. */
const ORDER: VerdictKey[] = ["pass", "overreach", "incomplete", "both", "unscored"];

export function SpaceComparison({ summary }: { summary: SpaceSummary }) {
  const computer = summary.space === "computer";
  const total = ORDER.reduce((sum, key) => sum + summary.verdicts[key], 0);
  const present = ORDER.filter((key) => summary.verdicts[key] > 0);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {computer ? (
            <Eye className="size-4 text-primary" aria-hidden />
          ) : (
            <FileText className="size-4 text-muted-foreground" aria-hidden />
          )}
          {computer ? "Computer use" : "Tool calling"}
        </h3>
        <span className="text-xs text-muted-foreground">
          {summary.scored
            ? `${summary.passed} of ${summary.scored} passed`
            : "nothing scored yet"}
        </span>
      </div>

      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {computer
          ? "Screenshot in, coordinates out. Finding the control is part of the task."
          : "Named actions with ids already resolved. Deciding what to do, but not where."}
      </p>

      {total > 0 && (
        <>
          {/* 2px surface gaps between segments, so adjacent fills never touch. */}
          <div className="mt-3 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full">
            {present.map((key) => (
              <Tooltip key={key}>
                <TooltipTrigger asChild>
                  <div
                    className={cn("h-full rounded-[3px]", VERDICT[key].fill)}
                    style={{ width: `${(summary.verdicts[key] / total) * 100}%` }}
                    aria-label={`${VERDICT[key].label}: ${summary.verdicts[key]}`}
                  />
                </TooltipTrigger>
                <TooltipContent className="max-w-[260px] text-xs leading-relaxed">
                  <span className="font-medium">
                    {VERDICT[key].label} — {summary.verdicts[key]}
                  </span>
                  <br />
                  {VERDICT[key].hint}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>

          {/* The legend carries the same tooltip as the bar. A reader who is
              puzzled by a label is looking at the word, not at the segment. */}
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {present.map((key) => {
              const meta = VERDICT[key];
              return (
                <li key={key}>
                  <Tooltip>
                    <TooltipTrigger className="flex cursor-help items-center gap-1.5 text-xs">
                      <meta.Icon className={cn("size-3.5 shrink-0", meta.text)} aria-hidden />
                      <span className="text-muted-foreground underline decoration-dotted underline-offset-4">
                        {meta.short}
                      </span>
                      <span className="tabular font-medium">{summary.verdicts[key]}</span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[260px] text-xs leading-relaxed">
                      <span className="font-medium">{meta.label}</span>
                      <br />
                      {meta.hint}
                    </TooltipContent>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-xs sm:grid-cols-3">
        <Cell term="Turns" value={String(summary.turns)} />
        <Cell term="Tokens" value={summary.tokens.toLocaleString()} />
        <Cell
          term={computer ? "Clicks that hit nothing" : "Actions"}
          value={
            computer ? `${summary.missedClicks}/${summary.actions}` : String(summary.actions)
          }
        />
      </dl>
    </div>
  );
}

function Cell({ term, value }: { term: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] leading-snug text-muted-foreground">{term}</dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}
