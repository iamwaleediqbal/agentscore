"use client";

/**
 * What the agent saw, and where it aimed.
 *
 * The screenshot alone tells you the state; the marker tells you the intent.
 * Together they answer the question a run record otherwise cannot: when a
 * computer-use action failed, was the decision wrong or was the aim wrong?
 * A marker sitting two centimetres left of the star is a different bug report
 * from a marker sitting on the trash icon.
 *
 * The marker is placed in percentages of the image, not pixels, so it stays
 * correct at every size the pane is dragged to.
 */

import { Crosshair, ImageOff, MousePointerClick } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { describeArgs, type ActionEntry } from "@/lib/harness/entries";
import { SCREEN } from "@/lib/environment/computer";
import { cn } from "@/lib/utils";

interface Point {
  raw: { x: number; y: number };
  convention: string;
  css: { x: number; y: number };
  label: string;
  outOfBounds: boolean;
}

function pointOf(entry: ActionEntry | null): Point | null {
  const point = entry?.metadata?.point as Point | undefined;
  return point && point.css ? point : null;
}

export function BrowserView({
  action,
  className,
}: {
  action: ActionEntry | null;
  className?: string;
}) {
  const point = pointOf(action);
  const hit = action?.metadata?.hit as string | undefined;

  // Percentages of the environment's own coordinate space, which is what the
  // screenshot is a scaled copy of.
  const left = point ? (point.css.x / SCREEN.width) * 100 : 0;
  const top = point ? (point.css.y / SCREEN.height) * 100 : 0;
  const onScreen = point && !point.outOfBounds && left >= 0 && left <= 100 && top >= 0 && top <= 100;

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-muted/30", className)}>
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Crosshair className="size-3.5" aria-hidden />
          Environment
        </span>
        {action && (
          <Badge
            variant="outline"
            className="max-w-full break-all font-mono text-[11px] font-normal"
          >
            {action.action_name}
            {describeArgs(action.args) ? ` ${describeArgs(action.args)}` : ""}
          </Badge>
        )}
        {point && (
          <span className="break-all font-mono text-[11px] text-muted-foreground">
            {point.label}
          </span>
        )}
        {hit && (
          <span className="min-w-0 break-all text-[11px] text-muted-foreground">
            hit <span className="font-mono text-foreground">{hit}</span>
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
        {action?.screenshot ? (
          <div
            className="relative w-full max-w-[900px] overflow-hidden rounded-md border shadow-sm"
            style={{ aspectRatio: `${SCREEN.width} / ${SCREEN.height}` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={action.screenshot}
              alt={`The screen after ${action.action_name}`}
              className="absolute inset-0 size-full object-cover"
            />
            {onScreen && (
              <span
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${left}%`, top: `${top}%` }}
                aria-hidden
              >
                <span
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-1/2 rounded-full",
                    "size-9 animate-ping opacity-60",
                    action.status === "applied" ? "bg-chart-2/50" : "bg-status-critical/50",
                  )}
                />
                <span
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-background/30",
                    "size-5",
                    action.status === "applied"
                      ? "border-chart-2"
                      : "border-status-critical",
                  )}
                />
              </span>
            )}
          </div>
        ) : (
          <Empty action={action} />
        )}
      </div>
    </div>
  );
}

function Empty({ action }: { action: ActionEntry | null }) {
  if (!action) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <MousePointerClick className="size-4" aria-hidden />
        Pick an action to see the screen it produced.
      </p>
    );
  }
  return (
    <div className="max-w-[36ch] text-center text-sm text-muted-foreground">
      <ImageOff className="mx-auto mb-2 size-5" aria-hidden />
      <p>No screenshot for this action.</p>
      <p className="mt-1 text-xs">
        Capture is best effort — a run that produced no picture is still a run, and one that
        died taking a picture would be worse.
      </p>
    </div>
  );
}
