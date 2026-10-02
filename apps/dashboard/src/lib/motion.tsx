'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** How long a value takes to glide to a new one. */
export const TWEEN_MS = 600;

const easeOutCubic = (p: number) => 1 - (1 - p) ** 3;
const linear = (p: number) => p;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Runs `frame(progress)` from 0 to 1 over `ms` (next frame when 0); returns a cancel function. */
function animate(ms: number, ease: (p: number) => number, frame: (e: number) => void): () => void {
  const startedAt = performance.now();
  let raf = requestAnimationFrame(function step(now) {
    const e = ms > 0 ? ease(Math.min(1, (now - startedAt) / ms)) : 1;
    frame(e);
    if (e < 1) raf = requestAnimationFrame(step);
  });
  return () => cancelAnimationFrame(raf);
}

/**
 * Glides a set of named numbers to new values (ease-out). A name seen for the
 * first time starts at its value; a new target mid-way starts from what is on
 * screen, so nothing jumps. `duration` 0 follows on the next frame.
 * Read values with `get(name)`, it falls back to the target before the first frame.
 */
export function useTween(target: Record<string, number>, duration = TWEEN_MS) {
  const [shown, setShown] = useState(target);
  const onScreen = useRef(target);
  const goal = useRef(target);
  // The effect below reruns on value changes only, not on every new object.
  const signature = Object.entries(target)
    .map(([k, v]) => `${k}=${v}`)
    .join('|');

  useLayoutEffect(() => {
    goal.current = target;
  });

  useEffect(() => {
    const to = goal.current;
    const from: Record<string, number> = {};
    let moved = false;
    for (const k in to) {
      from[k] = onScreen.current[k] ?? to[k];
      if (from[k] !== to[k]) moved = true;
    }
    // Only new names (a new point every second): they show as they are, nothing to animate.
    if (!moved) {
      onScreen.current = to;
      return;
    }
    return animate(reducedMotion() ? 0 : duration, easeOutCubic, (e) => {
      const next: Record<string, number> = {};
      for (const k in to) next[k] = from[k] + (to[k] - from[k]) * e;
      onScreen.current = next;
      setShown(next);
    });
  }, [signature, duration]);

  return (name: string) => shown[name] ?? target[name];
}

/** A view change the user made: a new object per change. `snap` moves at once (drag, Shift + wheel). */
export interface ViewMove {
  snap: boolean;
}

/**
 * Right edge of a time chart, moved without re-rendering: `onFrame` gets the
 * edge on every animation frame and moves the drawing itself. While following
 * live data it moves at a steady speed, each new point gliding in over the time
 * until the next is due, so it never stops and starts. A user move snaps
 * (drag, wheel) or eases out (live button). Returns a reader for the current edge.
 */
export function useSteadyScroll(end: number, following: boolean, move: ViewMove, onFrame: (edge: number) => void) {
  const onScreen = useRef(end);
  const frame = useRef(onFrame);
  const lastMove = useRef(move);
  /** Wall time of the last new point while following, null after a user move. */
  const lastArrival = useRef<number | null>(null);
  /** Wall time between new points, learned while following. */
  const gap = useRef<number | null>(null);

  useLayoutEffect(() => {
    frame.current = onFrame;
  });

  // Before paint, so a snap lands in the same frame as the redraw.
  useLayoutEffect(() => {
    const now = performance.now();
    const userMoved = move !== lastMove.current;
    lastMove.current = move;

    let ms = TWEEN_MS;
    let ease = easeOutCubic;
    if (userMoved) {
      lastArrival.current = null;
      if (move.snap) ms = 0;
    } else if (following) {
      if (lastArrival.current !== null) gap.current = now - lastArrival.current;
      lastArrival.current = now;
      if (gap.current !== null) {
        // A little longer than the gap: the next point retargets before this glide
        // ends, instead of the chart pausing when data is a bit late.
        ms = Math.min(Math.max(gap.current * 1.1, 200), 120_000);
        ease = linear;
      }
    }
    if (reducedMotion()) ms = 0;

    if (ms === 0) {
      onScreen.current = end;
      frame.current(end);
      return;
    }
    const from = onScreen.current;
    return animate(ms, ease, (e) => {
      onScreen.current = from + (end - from) * e;
      frame.current(onScreen.current);
    });
  }, [end, following, move]);

  return () => onScreen.current;
}
