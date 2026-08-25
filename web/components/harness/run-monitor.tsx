"use client";

/**
 * Watching a run, live or afterwards.
 *
 * Two panes that answer different questions. The timeline says what the model
 * decided and why; the browser pane says what the screen looked like when it
 * decided it. Reading either alone is how a wrong conclusion gets drawn — a
 * model that "clicked the wrong thing" is often a model that clicked the right
 * thing on a screen that had not updated yet, and only the pair shows that.
 *
 * While a run is live the view follows its newest action. Touching the
 * timeline or the controls hands it over to whoever is reading, and it stays
 * handed over until they ask for the live edge back — a view that yanks itself
 * forward mid-sentence is unusable.
 */

import { ChevronDown, Gauge, Pause, Play, Radio, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { BrowserView } from "@/components/harness/browser-view";
import { Timeline } from "@/components/harness/timeline";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { SPEEDS, usePlayback } from "@/hooks/use-playback";
import { type ActionEntry, type TimelineEntry, isActionEntry } from "@/lib/harness/entries";
import { cn } from "@/lib/utils";

const MIN_SPLIT = 26;
const MAX_SPLIT = 58;
const DEFAULT_SPLIT = 40;
const SPLIT_KEY = "agentscore.split.v1";

const clampSplit = (value: number) => Math.min(Math.max(value, MIN_SPLIT), MAX_SPLIT);

export function RunMonitor({
  entries,
  live = false,
  className,
}: {
  entries: TimelineEntry[];
  live?: boolean;
  className?: string;
}) {
  const actions = useMemo(() => entries.filter(isActionEntry), [entries]);
  const [detached, setDetached] = useState(false);
  const following = live && !detached;
  const playback = usePlayback(actions, following);

  const [split, setSplit] = useState(DEFAULT_SPLIT);
  // Read after mount: local storage is not available while rendering on the
  // server, and reading it in the initial state would not match.
  useEffect(() => {
    try {
      const saved = Number.parseFloat(window.localStorage.getItem(SPLIT_KEY) ?? "");
      if (Number.isFinite(saved)) setSplit(clampSplit(saved));
    } catch {
      /* private windows throw; the default is fine */
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(SPLIT_KEY, String(split));
    } catch {
      /* see above */
    }
  }, [split]);

  // A finished run resets to being followable, so reopening it is not stuck in
  // whatever state the last viewing left it.
  useEffect(() => {
    if (!live) setDetached(false);
  }, [live]);

  const takeOver = useCallback(() => {
    if (live) setDetached(true);
  }, [live]);

  const onSelect = useCallback(
    (entry: TimelineEntry) => {
      if (!isActionEntry(entry)) return;
      takeOver();
      const index = actions.findIndex((a) => a.id === entry.id);
      if (index !== -1) playback.jumpTo(index);
    },
    [actions, playback, takeOver],
  );

  const drag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = event.currentTarget.parentElement;
    if (!container) return;
    const bounds = container.getBoundingClientRect();

    const move = (moveEvent: PointerEvent) => {
      const percent = ((moveEvent.clientX - bounds.left) / bounds.width) * 100;
      setSplit(clampSplit(percent));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  const current: ActionEntry | null = playback.current;
  const speedLabel = `${playback.speed}x`;

  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden rounded-lg border", className)}>
      {live && detached && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-chart-4/15 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            You are looking at an earlier step. The run is still going.
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setDetached(false);
              playback.jumpTo(actions.length - 1);
            }}
          >
            <Radio className="size-3.5" />
            Follow live
          </Button>
        </div>
      )}

      {actions.length > 0 && !following && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-muted/25 px-2 py-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={playback.previous}
            disabled={playback.index === 0}
            aria-label="Previous action"
          >
            <SkipBack className="size-3.5" />
          </Button>
          <Button
            size="icon"
            className="size-8"
            onClick={playback.toggle}
            aria-label={playback.playing ? "Pause" : "Play"}
          >
            {playback.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={playback.next}
            disabled={playback.atEnd}
            aria-label="Next action"
          >
            <SkipForward className="size-3.5" />
          </Button>

          <span className="ml-1 shrink-0 tabular text-xs text-muted-foreground">
            {playback.index + 1} / {actions.length}
          </span>

          <Slider
            className="mx-2 min-w-0 flex-1"
            value={[playback.index]}
            min={0}
            max={Math.max(0, actions.length - 1)}
            step={1}
            disabled={actions.length < 2}
            onValueChange={(next) => {
              takeOver();
              playback.jumpTo(next[0] ?? 0);
            }}
            aria-label="Action"
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0 gap-1 px-2 text-[11px] font-normal"
                aria-label={`Playback speed: ${speedLabel}`}
              >
                <Gauge className="size-3 text-muted-foreground" aria-hidden />
                <span className="tabular font-medium">{speedLabel}</span>
                <ChevronDown className="size-3 opacity-50" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[6rem]">
              <DropdownMenuRadioGroup
                value={String(playback.speed)}
                onValueChange={(value) => playback.setSpeed(Number(value))}
              >
                {SPEEDS.map((speed) => (
                  <DropdownMenuRadioItem key={speed} value={String(speed)} className="text-xs">
                    {speed}x
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Stacked below lg: two panes side by side at phone width would make
          both unreadable, and a draggable divider has nothing to give. */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <BrowserView action={current} className="h-[300px] border-b" />
        <Timeline
          entries={entries}
          running={live}
          activeActionId={current?.id ?? null}
          onSelectAction={onSelect}
          follow={following || playback.playing}
          compact
          className="h-[360px]"
        />
      </div>

      <div className="hidden min-h-0 flex-1 lg:flex">
          <div className="min-h-0 overflow-hidden border-r" style={{ width: `${split}%` }}>
            <Timeline
              entries={entries}
              running={live}
              activeActionId={current?.id ?? null}
              onSelectAction={onSelect}
              follow={following || playback.playing}
              compact
              className="h-[520px]"
            />
          </div>

          <div
            onPointerDown={drag}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panes"
            className="w-1.5 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-border"
          />

          <div className="min-h-0 flex-1">
            <BrowserView action={current} className="h-[520px]" />
          </div>
      </div>
    </div>
  );
}
