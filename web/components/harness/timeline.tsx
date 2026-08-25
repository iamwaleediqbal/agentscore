"use client";

import {
  Brain,
  Check,
  ChevronRight,
  CircleSlash,
  Flag,
  MessageSquare,
  Play,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  type ActionStatus,
  type TimelineEntry,
  countEntries,
  describeArgs,
} from "@/lib/harness/entries";
import { cn } from "@/lib/utils";

const ACTION_LOOK: Record<ActionStatus, { label: string; dot: string; Icon: typeof Check }> = {
  applied: { label: "applied", dot: "bg-status-good", Icon: Check },
  rejected: { label: "rejected", dot: "bg-status-critical", Icon: X },
  unavailable: { label: "no such control", dot: "bg-status-warning", Icon: CircleSlash },
  terminal: { label: "finished", dot: "bg-primary", Icon: Flag },
};

/**
 * A run rendered as what it was: reasoning, replies, and actions, interleaved.
 *
 * Collapsing these into one list of actions loses the distinction that matters
 * most when something goes wrong — whether the model misunderstood the task or
 * understood it and emitted the wrong call.
 */
export function Timeline({
  entries,
  running = false,
  activeActionId,
  onSelectAction,
  follow = false,
  compact = false,
  className,
}: {
  entries: TimelineEntry[];
  running?: boolean;
  /** The action currently shown in the browser pane, highlighted here. */
  activeActionId?: string | null;
  onSelectAction?: (entry: TimelineEntry) => void;
  /** Scroll the active entry into view. Off while someone is reading. */
  follow?: boolean;
  /** Drop the inline thumbnails when a browser pane is already showing them. */
  compact?: boolean;
  className?: string;
}) {
  const [zoom, setZoom] = useState<string | null>(null);
  const counts = countEntries(entries);
  const activeRef = useRef<HTMLLIElement | null>(null);

  // Scrolls the entry into view inside this list only. `block: "nearest"` is
  // what keeps it from dragging the whole page along with it.
  useEffect(() => {
    if (!follow || !activeActionId) return;
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [follow, activeActionId]);

  if (!entries.length) {
    return (
      <div className="grid place-items-center gap-2 px-6 py-16 text-center">
        <Play className="size-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {running ? "Waiting for the first turn…" : "Nothing recorded yet."}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <Badge variant="outline" className="gap-1.5 font-normal">
          <Brain className="size-3" />
          {counts.thinking} thinking
        </Badge>
        <Badge variant="outline" className="gap-1.5 font-normal">
          <MessageSquare className="size-3" />
          {counts.responses} responses
        </Badge>
        <Badge variant="outline" className="gap-1.5 font-normal">
          <Play className="size-3" />
          {counts.actions} actions
        </Badge>
      </div>

      <ScrollArea className={cn("h-[520px]", className)}>
        <ol className="relative px-4 py-3">
          {entries.map((entry, index) => {
            const last = index === entries.length - 1;
            const active = entry.entry_type === "action" && entry.id === activeActionId;
            const selectable = Boolean(onSelectAction) && entry.entry_type === "action";
            return (
              <li
                key={entry.id}
                ref={active ? activeRef : undefined}
                onClick={selectable ? () => onSelectAction?.(entry) : undefined}
                className={cn(
                  "relative flex gap-3 pb-4 last:pb-0",
                  selectable && "cursor-pointer",
                  active && "-mx-2 rounded-md bg-primary/[0.07] px-2 pt-2 ring-1 ring-primary/25",
                )}
              >
                {!last && (
                  <span
                    className="absolute left-[13px] top-7 bottom-0 w-px bg-border"
                    aria-hidden
                  />
                )}
                <Marker entry={entry} />
                <div className="min-w-0 flex-1">
                  {entry.entry_type === "model_thinking" && (
                    <div>
                      <Row
                        label="Reasoning"
                        meta={`${(entry.latencyMs / 1000).toFixed(1)}s · ${entry.usage.input} in · ${entry.usage.output} out`}
                      />
                      <p className="mt-1 text-sm leading-relaxed break-words text-muted-foreground">
                        {entry.text || <span className="italic">no thought returned</span>}
                      </p>
                      {entry.reasoning && <Reasoning text={entry.reasoning} />}
                    </div>
                  )}

                  {entry.entry_type === "model_response" && (
                    <div>
                      <Row label="Reply" meta={entry.parseError ? "unreadable" : undefined} />
                      <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                        {entry.text.slice(0, 600) || "(empty)"}
                      </pre>
                      {entry.parseError && (
                        <p className="mt-1 text-xs text-status-critical">{entry.parseError}</p>
                      )}
                    </div>
                  )}

                  {entry.entry_type === "action" && (
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="font-mono text-sm font-medium">{entry.action_name}</code>
                        {describeArgs(entry.args) && (
                          <code className="break-all font-mono text-xs text-muted-foreground">
                            {describeArgs(entry.args)}
                          </code>
                        )}
                        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span
                            className={cn("size-1.5 rounded-full", ACTION_LOOK[entry.status].dot)}
                            aria-hidden
                          />
                          {ACTION_LOOK[entry.status].label}
                        </span>
                      </div>
                      {entry.error && (
                        <p className="mt-1 text-xs text-status-critical">{entry.error}</p>
                      )}
                      {entry.screenshot && !compact && (
                        <button
                          onClick={() => setZoom(entry.screenshot!)}
                          className="mt-2 block w-full max-w-[280px] overflow-hidden rounded-md border transition-colors hover:border-primary"
                          aria-label={`Screen after turn ${entry.turn}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={entry.screenshot} alt="" loading="lazy" className="block w-full" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </ScrollArea>

      <Dialog open={Boolean(zoom)} onOpenChange={(open) => !open && setZoom(null)}>
        <DialogContent className="max-w-5xl p-2">
          <DialogTitle className="sr-only">Environment screenshot</DialogTitle>
          {zoom && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={zoom} alt="Environment screenshot" className="w-full rounded" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The model's private chain of thought, when a run captured one.
 *
 * Folded away by default and separated from the declared thought above it,
 * because they are different things: one is what the model said it was doing,
 * the other is what it worked through to get there. Presenting them as one
 * block would hide the case worth looking at — where they disagree.
 *
 * Most runs have none. These tokens bill at the output rate and were the great
 * majority of the cost of a turn, so they are captured only when a run is made
 * deliberately with REASONING set.
 */
function Reasoning({ text }: { text: string }) {
  return (
    <details className="group mt-2">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
        <ChevronRight
          className="size-3 transition-transform group-open:rotate-90"
          aria-hidden
        />
        Chain of thought
        <span className="font-normal opacity-70">
          {text.length.toLocaleString()} chars
        </span>
      </summary>
      <p className="mt-2 whitespace-pre-wrap border-l-2 border-dashed py-0.5 pl-3 text-[13px] leading-relaxed text-muted-foreground">
        {text}
      </p>
    </details>
  );
}

function Marker({ entry }: { entry: TimelineEntry }) {
  const Icon =
    entry.entry_type === "model_thinking"
      ? Brain
      : entry.entry_type === "model_response"
        ? MessageSquare
        : ACTION_LOOK[entry.status].Icon;

  return (
    <span
      className={cn(
        "z-10 grid size-[27px] shrink-0 place-items-center rounded-full border bg-card",
        entry.entry_type === "action" && "border-primary/30",
      )}
    >
      <Icon className="size-3.5 text-muted-foreground" />
    </span>
  );
}

function Row({ label, meta }: { label: string; meta?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {meta && <span className="text-[11px] tabular text-muted-foreground">{meta}</span>}
    </div>
  );
}

