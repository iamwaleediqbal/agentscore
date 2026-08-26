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
import { useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";
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
  activeActionId,
  onSelectAction,
  follow = false,
  className,
}: {
  entries: TimelineEntry[];
  /** The action currently shown in the browser pane, highlighted here. */
  activeActionId?: string | null;
  onSelectAction?: (entry: TimelineEntry) => void;
  /** Scroll the active entry into view. Off while someone is reading. */
  follow?: boolean;
  className?: string;
}) {
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
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      </div>
    );
  }

  return (
    <>
      {/* One badge, not three. A model that thinks once, answers once and acts
          once per turn makes all three counts identical, which printed the same
          number three times beside a Turns stat that printed it a fourth. Only
          a count that disagrees with the action count is worth the space. */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <Badge variant="outline" className="gap-1.5 font-normal">
          <Play className="size-3" />
          {counts.actions} {counts.actions === 1 ? "action" : "actions"}
        </Badge>
        {counts.thinking !== counts.actions && (
          <Badge variant="outline" className="gap-1.5 font-normal">
            <Brain className="size-3" />
            {counts.thinking} thinking
          </Badge>
        )}
        {counts.responses !== counts.actions && (
          <Badge variant="outline" className="gap-1.5 font-normal">
            <MessageSquare className="size-3" />
            {counts.responses} responses
          </Badge>
        )}
      </div>

      <ScrollArea className={cn("h-[520px]", className)}>
        <ol className="relative px-4 py-3">
          {entries.map((entry, index) => {
            const last = index === entries.length - 1;
            const active = entry.entry_type === "action" && entry.id === activeActionId;
            const selectable = Boolean(onSelectAction) && entry.entry_type === "action";
            return (
              // Selecting an action is how the browser pane is driven, so it
              // has to be reachable without a mouse: focusable, activated by
              // Enter or Space, and announced as the pressed one.
              <li
                key={entry.id}
                ref={active ? activeRef : undefined}
                onClick={selectable ? () => onSelectAction?.(entry) : undefined}
                onKeyDown={
                  selectable
                    ? (event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        onSelectAction?.(entry);
                      }
                    : undefined
                }
                role={selectable ? "button" : undefined}
                tabIndex={selectable ? 0 : undefined}
                aria-pressed={selectable ? active : undefined}
                className={cn(
                  "relative flex gap-3 pb-4 last:pb-0",
                  selectable &&
                    "cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
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
                      {/*
                        "no thought returned" only when there is genuinely
                        nothing. A tool-calling turn has no prose thought — the
                        deliberation arrives as the provider's reasoning below —
                        so printing the placeholder above it read as a failure on
                        exactly the turns that went best.
                      */}
                      {(entry.text || !entry.reasoning) && (
                        <p className="mt-1 text-sm leading-relaxed break-words text-muted-foreground">
                          {entry.text || <span className="italic">no thought returned</span>}
                        </p>
                      )}
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
                      {/*
                        Where the click actually went, and why.
                        
                        A computer-use run answers in numbers whose meaning is
                        not obvious — the same pair is a legal pixel coordinate
                        and a legal 0-1000 grid coordinate — so the conversion is
                        the difference between "the model missed" and "we
                        converted it wrongly". It was recorded on every action
                        and shown on none of them.
                      */}
                      {aimOf(entry) && (
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                          {aimOf(entry)}
                        </p>
                      )}
                      {entry.error && (
                        <p className="mt-1 text-xs text-status-critical">{entry.error}</p>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </ScrollArea>
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

/**
 * The coordinate conversion for one action, or nothing.
 *
 * `metadata` is deliberately untyped — it carries whatever the driver that
 * produced the run thought was worth keeping — so every field is checked rather
 * than asserted. A run recorded before this was captured simply has no aim.
 */
function aimOf(entry: { metadata?: Record<string, unknown> }): string | null {
  const point = entry.metadata?.point;
  if (!point || typeof point !== "object") return null;

  const { label, calibrated } = point as { label?: unknown; calibrated?: unknown };
  if (typeof label !== "string" || !label) return null;

  return typeof calibrated === "string"
    ? `${label}  ·  space settled as ${calibrated} from the page, and pinned`
    : label;
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

