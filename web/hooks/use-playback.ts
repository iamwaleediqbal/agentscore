"use client";

/**
 * Stepping through a recorded run.
 *
 * A run is a sequence of actions with real timestamps, so playback advances on
 * the gaps the run actually had rather than a fixed tick. A model that thought
 * for eight seconds and then fired three actions in a row looks like that when
 * replayed, which is information — an even cadence would erase it.
 *
 * Real gaps are also unwatchable at times, so they are clamped: long enough to
 * read, short enough to sit through.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ActionEntry } from "@/lib/harness/entries";

const MIN_STEP_MS = 450;
const MAX_STEP_MS = 2_500;

export const SPEEDS = [0.5, 1, 1.5, 2, 3] as const;

export interface Playback {
  index: number;
  current: ActionEntry | null;
  playing: boolean;
  speed: number;
  atEnd: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  jumpTo: (index: number) => void;
  setSpeed: (speed: number) => void;
}

export function usePlayback(actions: ActionEntry[], live: boolean): Playback {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const count = actions.length;
  const atEnd = index >= count - 1;

  // A run that grows while it is being watched should stay on its newest
  // action, but only until someone takes over by scrubbing.
  useEffect(() => {
    if (live && count > 0) setIndex(count - 1);
  }, [live, count]);

  useEffect(() => {
    if (index > count - 1) setIndex(Math.max(0, count - 1));
  }, [count, index]);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    if (!playing || count === 0) return;
    if (index >= count - 1) {
      setPlaying(false);
      return;
    }

    const here = actions[index];
    const there = actions[index + 1];
    const gap = Math.max(0, (there?.at ?? 0) - (here?.at ?? 0));
    const delay = Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, gap)) / speed;

    timer.current = setTimeout(() => setIndex((i) => Math.min(i + 1, count - 1)), delay);
    return clear;
  }, [playing, index, count, actions, speed, clear]);

  useEffect(() => clear, [clear]);

  const pause = useCallback(() => {
    clear();
    setPlaying(false);
  }, [clear]);

  const play = useCallback(() => {
    if (count === 0) return;
    // Replaying from the end would show one frame and stop, which reads as a
    // broken button rather than a finished run.
    setIndex((i) => (i >= count - 1 ? 0 : i));
    setPlaying(true);
  }, [count]);

  const jumpTo = useCallback(
    (next: number) => {
      pause();
      setIndex(Math.min(Math.max(0, next), Math.max(0, count - 1)));
    },
    [pause, count],
  );

  return useMemo(
    () => ({
      index,
      current: actions[index] ?? null,
      playing,
      speed,
      atEnd,
      play,
      pause,
      toggle: () => (playing ? pause() : play()),
      next: () => jumpTo(index + 1),
      previous: () => jumpTo(index - 1),
      jumpTo,
      setSpeed,
    }),
    [index, actions, playing, speed, atEnd, play, pause, jumpTo],
  );
}
