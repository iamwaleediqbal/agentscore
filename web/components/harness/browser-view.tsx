"use client";

/**
 * What the agent saw, where it aimed, and what that produced.
 *
 * The pane claimed to answer "was the decision wrong or was the aim wrong?" and
 * could not, because it had one frame and drew the marker on the wrong one. The
 * only screenshot on a run record was the one taken *after* the action, so the
 * crosshair — which marks where the model aimed on the screen it was looking at
 * — was painted over a screen that no longer existed. Archive a message and the
 * reading pane empties: the marker then sits on a toolbar that is gone, above
 * the words "Select a message". It reads as a model clicking into space, which
 * is the opposite of what happened.
 *
 * So: two frames. The marker goes on **saw**, the screen the model was actually
 * given, because that is the only frame on which an aim means anything. **did**
 * sits beside it unmarked, because the result is a fact about the environment
 * rather than about the model's intent.
 *
 * The marker is placed in percentages of the image, not pixels, so it stays
 * correct at every size the pane is dragged to.
 */

import { useState } from "react";

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
  /*
   * Which frame is on screen, and it stays chosen as you scrub.
   *
   * Side by side halved a 1180x720 screenshot into something you could not read
   * a subject line off, which defeats the point of showing it. One frame at a
   * time, switchable, keeps it legible.
   *
   * `saw` is the default because it is the frame a question is usually being
   * asked about — where did it aim, and was the thing it wanted even visible.
   * The choice is deliberately not reset when the selected action changes: an
   * operator stepping through a run to watch results should not have to press
   * the same button on every turn.
   */
  const [showing, setShowing] = useState<"saw" | "did">("saw");

  const point = pointOf(action);
  const hit = action?.metadata?.hit as string | undefined;

  // An older run has one frame. Ask for `saw` and there is nothing to show, so
  // the request quietly resolves to the frame that exists.
  const frame =
    showing === "saw" && action?.screenshotBefore
      ? { src: action.screenshotBefore, aimed: true }
      : action?.screenshot
        ? { src: action.screenshot, aimed: !action.screenshotBefore }
        : action?.screenshotBefore
          ? { src: action.screenshotBefore, aimed: true }
          : null;

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

        {action?.screenshotBefore && action?.screenshot && (
          <div
            role="group"
            aria-label="Which frame to show"
            className="ml-auto flex shrink-0 items-center gap-0.5 rounded-md border bg-muted/50 p-0.5"
          >
            <Frames showing={showing} onChange={setShowing} />
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
        {frame ? (
          <Shot
            src={frame.src}
            alt={
              frame.aimed
                ? `The screen the model was shown before ${action?.action_name}`
                : `The screen after ${action?.action_name}`
            }
            /*
             * The aim goes on the frame the model was looking at and nowhere
             * else. On the result it would point at whatever now happens to sit
             * under those coordinates — archive a message and the crosshair
             * lands on a toolbar that is gone, which reads as a model clicking
             * into space.
             */
            marker={
              frame.aimed && onScreen
                ? { left, top, applied: action?.status === "applied" }
                : null
            }
          />
        ) : (
          <Empty action={action} />
        )}
      </div>
    </div>
  );
}

/** The two frames, as a segmented control. */
function Frames({
  showing,
  onChange,
}: {
  showing: "saw" | "did";
  onChange: (next: "saw" | "did") => void;
}) {
  return (
    <>
      {(
        [
          ["saw", "the screen the model was given"],
          ["did", "what the action produced"],
        ] as const
      ).map(([key, hint]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={showing === key}
          title={hint}
          className={cn(
            "rounded px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide transition-colors",
            showing === key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {key}
        </button>
      ))}
    </>
  );
}

/** One labelled frame, with the aim on it when the aim belongs on it. */
/** The frame on screen, with the aim on it when the aim belongs on it. */
function Shot({
  src,
  alt,
  marker,
}: {
  src: string;
  alt: string;
  marker: { left: number; top: number; applied: boolean } | null;
}) {
  return (
    <div
      className="relative w-full max-w-[900px] overflow-hidden rounded-md border shadow-sm"
      style={{ aspectRatio: `${SCREEN.width} / ${SCREEN.height}` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="absolute inset-0 size-full object-cover" />
      {marker && (
        <span
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${marker.left}%`, top: `${marker.top}%` }}
          aria-hidden
        >
          <span
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2 rounded-full",
              "size-9 animate-ping opacity-60",
              marker.applied ? "bg-chart-2/50" : "bg-status-critical/50",
            )}
          />
          <span
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-background/30",
              "size-5",
              marker.applied ? "border-chart-2" : "border-status-critical",
            )}
          />
        </span>
      )}
    </div>
  );
}

function Empty({ action }: { action: ActionEntry | null }) {
  if (!action) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <MousePointerClick className="size-4" aria-hidden />
        Pick an action to see what the model was looking at and what it changed.
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
