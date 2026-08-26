"use client";

/**
 * What the runs say about each model.
 *
 * This page used to render a committed JSON file that was sample data, badged
 * as such. A fabricated leaderboard on a page whose whole argument is
 * "evaluation done honestly" is the one thing this project cannot ship, so it
 * is gone: every number here is derived from the same run records the runs
 * section renders, and every one of them is one click from the trajectory it
 * came from.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

import { FilterBar, FilterGroup } from "@/components/harness/filter-bar";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRuns } from "@/hooks/use-runs";
import { byModelSpace, rankByInterval, type ModelSpaceRow } from "@/lib/harness/models";
import type { Convention } from "@/lib/environment/computer";
import { formatCost } from "@/lib/harness/runs";
import { VERDICT } from "@/lib/harness/verdict-meta";
import type { VerdictKey } from "@/lib/harness/analytics";
import { cn } from "@/lib/utils";

const pct = (n: number) => `${Math.round(n * 100)}%`;

const SPACE_LABEL: Record<string, string> = {
  computer: "Computer use",
  tool: "Tool calling",
};

/** Ordered worst-to-best left-to-right is wrong; ordered as read is right. */
const BREAKDOWN: VerdictKey[] = ["pass", "overreach", "incomplete", "both", "unscored"];

const CONVENTION_LABEL: Record<Convention, string> = {
  pixels: "pixels",
  grid1000: "0–1000 grid",
  fraction: "fractions",
};

/**
 * Which coordinate space this model turned out to answer in.
 *
 * Providers disagree about this and none of them announce it in the reply.
 * Anthropic and OpenAI document pixels of the image supplied; Gemini and the
 * Qwen-family grounding models answer on a 0–1000 grid whatever the image size.
 * Reading a grid answer as pixels puts every click in the top-left quarter of
 * the screen, which is not a model that cannot see — it is a harness that
 * cannot listen. So the space is read off the numbers and written down, and
 * this column is that record rather than an assumption.
 */
function Grounding({ row }: { row: ModelSpaceRow }) {
  const { declared, observed, coordinates } = row.grounding;

  if (row.space !== "computer") {
    return <span className="text-[11px] text-muted-foreground">n/a</span>;
  }
  if (!coordinates) {
    return <span className="text-[11px] text-muted-foreground">no coordinates</span>;
  }

  const agrees = declared !== null && observed.length === 1 && observed[0] === declared;
  const settled = observed.length === 1;

  return (
    <Tooltip>
      <TooltipTrigger className="cursor-help text-left">
        <span className="whitespace-nowrap text-xs">
          {observed.map((c) => CONVENTION_LABEL[c]).join(" + ")}
        </span>
        <span
          className={cn(
            "block text-[11px]",
            agrees || settled ? "text-muted-foreground" : "text-status-warning",
          )}
        >
          {declared === null
            ? "resolved, not declared"
            : agrees
              ? "as documented"
              : `documented as ${CONVENTION_LABEL[declared]}`}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[300px] text-xs leading-relaxed">
        {declared === null ? (
          <>
            Nothing is documented about this model&rsquo;s coordinate space, so the harness read
            it off the first coordinate that could only be read one way, and hit-tested the
            ambiguous ones against the live page. Neither costs a model turn or a token.
          </>
        ) : agrees ? (
          <>
            Its provider documents {CONVENTION_LABEL[declared]}, and every coordinate it sent was
            consistent with that. The declaration is applied on the first turn as a prior, before
            any coordinate exists to inspect.
          </>
        ) : (
          <>
            Its provider documents {CONVENTION_LABEL[declared]}, but the coordinates it actually
            sent say otherwise. A number that can only be read one way overrides the declaration:
            a model following the prompt instead of its training is answering in the space it
            says it is.
          </>
        )}{" "}
        Read from {coordinates} recorded coordinate{coordinates === 1 ? "" : "s"}.
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The interval drawn to scale.
 *
 * "50%" and "19–81%" say very different things about six runs and only one of
 * them is honest. The bar is the interval; the tick is the point estimate.
 */
function IntervalBar({ row }: { row: ModelSpaceRow }) {
  const { low, high, point } = row.interval;

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-1.5 w-28 shrink-0 rounded-full bg-muted" aria-hidden>
        <div
          className="absolute h-full rounded-full bg-chart-1/45"
          style={{ left: `${low * 100}%`, width: `${Math.max((high - low) * 100, 2)}%` }}
        />
        <div
          className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-chart-1"
          style={{ left: `calc(${point * 100}% - 1px)` }}
        />
      </div>
      <span className="tabular whitespace-nowrap text-xs text-muted-foreground">
        {pct(low)} – {pct(high)}
      </span>
    </div>
  );
}

/** Each verdict as a share of the runs, so the shape of the failure is visible. */
function Breakdown({ row }: { row: ModelSpaceRow }) {
  const total = row.attempted || 1;

  return (
    <div className="flex items-center gap-2">
      <div className="flex h-2 w-28 shrink-0 gap-[2px] overflow-hidden rounded-full" aria-hidden>
        {BREAKDOWN.filter((key) => row.verdicts[key] > 0).map((key) => (
          <span
            key={key}
            className={cn("h-full first:rounded-l-full last:rounded-r-full", VERDICT[key].fill)}
            style={{ width: `${(row.verdicts[key] / total) * 100}%` }}
          />
        ))}
      </div>
      <span className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
        {BREAKDOWN.filter((key) => row.verdicts[key] > 0).map((key) => (
          <Tooltip key={key}>
            <TooltipTrigger className={cn("cursor-help tabular", VERDICT[key].text)}>
              {row.verdicts[key]} {VERDICT[key].short.toLowerCase()}
            </TooltipTrigger>
            <TooltipContent className="max-w-[280px] text-xs leading-relaxed">
              {VERDICT[key].hint}
            </TooltipContent>
          </Tooltip>
        ))}
      </span>
    </div>
  );
}

export function ModelsConsole() {
  const { runs, ready, measured } = useRuns();
  const [space, setSpace] = useState<string>("all");

  const rows = useMemo(() => byModelSpace(runs), [runs]);
  const shown = useMemo(
    () => (space === "all" ? rows : rows.filter((row) => row.space === space)),
    [rows, space],
  );
  const ranked = useMemo(() => rankByInterval(shown), [shown]);

  const spaceOptions = useMemo(
    () => [
      { value: "all", label: "All", count: rows.length },
      {
        value: "computer",
        label: "Computer use",
        count: rows.filter((r) => r.space === "computer").length,
      },
      {
        value: "tool",
        label: "Tool calling",
        count: rows.filter((r) => r.space === "tool").length,
      },
    ],
    [rows],
  );

  if (!ready) return <Skeleton className="h-72 w-full" />;

  const models = new Set(rows.map((row) => row.model)).size;
  const widest = ranked.length
    ? Math.max(...ranked.map(({ row }) => row.interval.high - row.interval.low))
    : 0;
  const anyUnscored = rows.some((row) => row.unscored > 0);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Models</h1>
        <p className="max-w-[72ch] text-sm leading-relaxed text-muted-foreground">
          {models === 0 ? (
            <>No runs have been recorded yet, so there is nothing to compare.</>
          ) : (
            <>
              {models === 1 ? "One model" : `${models} models`} operating a live email client
              through {rows.length === 1 ? "one action space" : "two action spaces"}, scored by
              the same grader against the same tasks. Rates are shown as intervals because a
              handful of runs cannot support a percentage, and the two action spaces are never
              averaged together — they are the comparison, not noise to be folded away.
            </>
          )}
        </p>
      </header>

      {rows.length > 2 && (
        <FilterBar
          showing={shown.length}
          total={rows.length}
          active={space !== "all"}
          onClear={() => setSpace("all")}
          noun="rows"
        >
          <FilterGroup
            label="Action space"
            options={spaceOptions}
            value={space}
            onChange={setSpace}
          />
        </FilterBar>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[72rem] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Rank</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium">Action space</th>
                <th className="px-4 py-3 font-medium">Passed</th>
                <th className="px-4 py-3 font-medium">95% interval</th>
                <th className="px-4 py-3 font-medium">Outcome breakdown</th>
                <th className="px-4 py-3 font-medium">
                  <Tooltip>
                    <TooltipTrigger className="cursor-help uppercase tracking-wide underline decoration-dotted underline-offset-4">
                      Coordinates
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[280px] text-xs leading-relaxed">
                      What coordinate space the model answered in, read back off its recorded
                      actions rather than assumed from its family.
                    </TooltipContent>
                  </Tooltip>
                </th>
                <th className="px-4 py-3 text-right font-medium">Turns</th>
                <th className="px-4 py-3 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ rank, tied, row }) => (
                <tr key={`${row.model}:${row.space}`} className="border-b last:border-0">
                  <td className="px-4 py-3 tabular text-muted-foreground">
                    {tied ? (
                      <Tooltip>
                        <TooltipTrigger className="cursor-help tabular">={rank}</TooltipTrigger>
                        <TooltipContent className="max-w-[280px] text-xs leading-relaxed">
                          Shares this position. Its interval overlaps at least one other row, so
                          the data cannot say which of them is better — and rank counts only the
                          rows it is demonstrably behind.
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      rank
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <div className="font-mono text-[13px]">{row.model}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      {row.cost === 0 ? (
                        <span className="text-status-good">free tier</span>
                      ) : (
                        <span>paid</span>
                      )}
                      {tied && <span>· statistically tied</span>}
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <span className="whitespace-nowrap text-xs">{SPACE_LABEL[row.space]}</span>
                    <div className="text-[11px] text-muted-foreground">
                      {row.tasks} {row.tasks === 1 ? "task" : "tasks"}
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <div className="tabular font-medium">
                      {row.passed} of {row.scored}
                    </div>
                    {row.unscored > 0 && (
                      <Tooltip>
                        <TooltipTrigger className="cursor-help text-[11px] text-status-warning underline decoration-dotted underline-offset-2">
                          {row.unscored} not counted
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[280px] text-xs leading-relaxed">
                          {row.unscored} attempt{row.unscored === 1 ? "" : "s"} never reached a
                          model. Removed from the denominator rather than scored zero — an
                          infrastructure failure read as a capability failure is a lie about the
                          model.
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <IntervalBar row={row} />
                  </td>

                  <td className="px-4 py-3">
                    <Breakdown row={row} />
                  </td>

                  <td className="px-4 py-3">
                    <Grounding row={row} />
                  </td>

                  <td className="px-4 py-3 text-right tabular text-muted-foreground">
                    {row.turns}
                    {row.space === "computer" && row.missedClicks > 0 && (
                      <Tooltip>
                        <TooltipTrigger className="ml-1.5 cursor-help text-[11px] text-status-warning">
                          {row.missedClicks} missed
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[260px] text-xs leading-relaxed">
                          Coordinate actions that landed on no control at all. The signature of a
                          grounding miss rather than a wrong decision.
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right tabular text-muted-foreground">
                    {formatCost(row.cost)}
                  </td>
                </tr>
              ))}

              {ranked.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                    Nothing recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {ranked.length > 0 && (
        <section className="space-y-3 rounded-lg border bg-muted/30 p-5 text-sm leading-relaxed text-muted-foreground">
          <h2 className="text-sm font-semibold text-foreground">How to read this</h2>

          <p>
            <span className="font-medium text-foreground">The interval is the result.</span> Six
            passes out of six is 100% with a lower bound near 61%, which is the correct amount of
            confidence to have in six attempts. The widest interval on this page spans{" "}
            <span className="tabular">{pct(widest)}</span> — quoting its midpoint alone would be
            inventing precision. The bar is the interval; the tick inside it is the point estimate.
          </p>

          <p>
            <span className="font-medium text-foreground">Overlapping intervals share a rank.</span>{" "}
            Ordering them anyway manufactures a difference the data cannot support. It is the same
            reason HELM dropped mean win rate: a ranking that inverts when an unrelated model is
            added was never measuring the models.
          </p>

          <p>
            <span className="font-medium text-foreground">
              The two action spaces are separate rows, never one average.
            </span>{" "}
            A model can label a message with one tool call and still fail to find that message on
            screen. Averaging the two destroys precisely the signal this harness was built to
            produce.
          </p>

          {/* The full coordinate argument lives on /tools and is told once
              there. Told again here in full it was the third copy on the site,
              after the column tooltip and the per-row one. */}
          <p>
            <span className="font-medium text-foreground">
              The coordinate column is a measurement, not a setting.
            </span>{" "}
            The harness reads the space off the numbers a model actually sent rather than
            assuming it, and this column is that record.{" "}
            <Link href="/tools" className="underline underline-offset-4 hover:text-foreground">
              Why it matters
            </Link>
            .
          </p>

          <p>
            <span className="font-medium text-foreground">Cost is beside the score, not in it.</span>{" "}
            Every eval console that reports cost keeps it as a separate column for the same
            reason — it is a tradeoff axis a reader weighs themselves, and a model that passes
            more often for more money has not earned a better score for the money.
          </p>

          {anyUnscored && (
            <p>
              <span className="font-medium text-foreground">
                Attempts that never reached a model are not zeros.
              </span>{" "}
              They are removed from the denominator and reported separately, which is what Inspect
              AI does with errored samples and what keeps a rate-limited afternoon from looking
              like a bad model.
            </p>
          )}

          <p>
            Every rate here is computed from run records you can open.{" "}
            <Link href="/runs" className="underline underline-offset-4 hover:text-foreground">
              The runs
            </Link>{" "}
            carry the full trajectory and the two state snapshots each verdict was derived from,
            so nothing on this page has to be taken on trust.
            {!measured && " These are the sample runs; real ones replace them once recorded."}
          </p>
        </section>
      )}
    </div>
  );
}
