'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createSim, SIM_PERIOD_MS, stepSim, toSnapshot, type SimState } from './simulator';
import type { DashboardSnapshot, LivePoint, LiveUpdate } from './types';

export type LinkState = 'connecting' | 'live' | 'fallback';

/** Give the server this long to send its first event before simulating. */
const CONNECT_GRACE_MS = 2500;

/** Live seconds kept, same as the Watcher: more than CloudWatch's delay. */
const LIVE_KEEP_MS = 5 * 60_000;
/** Defenders' 15 s steps kept: the hour. */
const HISTORY_KEEP_MS = 60 * 60_000;

type Buffer = Map<string, Map<number, LivePoint>>;

/** Adds points (a newer read of a time replaces the older one), drops old ones, returns them per instance. */
function merge(buffer: Buffer, fresh: Record<string, LivePoint[]>, keepMs: number): Record<string, LivePoint[]> {
  const oldest = Date.now() - keepMs;
  for (const [id, ps] of Object.entries(fresh)) {
    let byTime = buffer.get(id);
    if (!byTime) buffer.set(id, (byTime = new Map()));
    for (const p of ps) byTime.set(p.t, p);
  }
  const out: Record<string, LivePoint[]> = {};
  for (const [id, byTime] of buffer) {
    for (const t of byTime.keys()) if (t < oldest) byTime.delete(t);
    if (byTime.size) out[id] = [...byTime.values()].sort((a, b) => a.t - b.t);
    else buffer.delete(id);
  }
  return out;
}

export interface LiveData {
  /** per instance, one point per second, oldest first */
  seconds: Record<string, LivePoint[]>;
  /** per instance, 15 s steps, oldest first */
  steps: Record<string, LivePoint[]>;
  /** group steps are complete from here on */
  stepsFrom?: number;
}

const NO_LIVE: LiveData = { seconds: {}, steps: {} };

/** Defenders (load test target). Empty string means same origin: the ALB routes /api/* to them. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Watcher (dashboard data). Empty string means same origin: the ALB routes /monitor/* to it. */
export const WATCHER_URL = process.env.NEXT_PUBLIC_WATCHER_URL ?? 'http://localhost:4100';

/** Absolute API base for display (k6 commands, error messages). Client only. */
export const apiOrigin = () => API_URL || window.location.origin;

/** Absolute Watcher base for display. Client only. */
export const watcherOrigin = () => WATCHER_URL || window.location.origin;

/**
 * Streams dashboard snapshots (ASG, CloudWatch's last hour) and the Defenders'
 * own data (1 s points and 15 s steps from their /live) from the Watcher over SSE.
 * While the server is unreachable, a local simulator keeps the UI alive.
 */
export function useLiveSnapshot() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [link, setLink] = useState<LinkState>('connecting');
  const [live, setLive] = useState<LiveData>(NO_LIVE);

  useEffect(() => {
    let sim: SimState | null = null;
    let simTimer: ReturnType<typeof setInterval> | null = null;
    const secondsBuffer: Buffer = new Map();
    const stepsBuffer: Buffer = new Map();
    let stepsFrom: number | undefined;

    const startFallback = () => {
      if (simTimer) return;
      sim ??= createSim(Date.now());
      secondsBuffer.clear();
      stepsBuffer.clear();
      setLive(NO_LIVE);
      setLink('fallback');
      setSnapshot(toSnapshot(sim));
      simTimer = setInterval(() => {
        stepSim(sim!, Date.now());
        setSnapshot(toSnapshot(sim!));
      }, SIM_PERIOD_MS);
    };

    const stopFallback = () => {
      if (simTimer) clearInterval(simTimer);
      simTimer = null;
    };

    const graceTimer = setTimeout(startFallback, CONNECT_GRACE_MS);

    // EventSource reconnects on its own; we switch back to live on the next event.
    const source = new EventSource(`${WATCHER_URL}/monitor/stream`);
    source.addEventListener('snapshot', (e) => {
      clearTimeout(graceTimer);
      stopFallback();
      setLink('live');
      setSnapshot(JSON.parse((e as MessageEvent<string>).data) as DashboardSnapshot);
    });
    source.addEventListener('live', (e) => {
      const update = JSON.parse((e as MessageEvent<string>).data) as LiveUpdate;
      stepsFrom = update.historySince ?? stepsFrom;
      const seconds = merge(secondsBuffer, update.points, LIVE_KEEP_MS);
      setLive((prev) => ({
        seconds,
        // Steps change every 15 s: keep the same object otherwise.
        steps: update.history ? merge(stepsBuffer, update.history, HISTORY_KEEP_MS) : prev.steps,
        stepsFrom,
      }));
    });
    source.onerror = () => {
      clearTimeout(graceTimer);
      startFallback();
    };

    return () => {
      clearTimeout(graceTimer);
      stopFallback();
      source.close();
    };
  }, []);

  return { snapshot, link, live };
}

// Shared 1s clock. The server snapshot is null so SSR and hydration match.
let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | undefined;
const clockListeners = new Set<() => void>();

function subscribeClock(onChange: () => void) {
  clockListeners.add(onChange);
  if (!clockTimer) {
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    clockListeners.delete(onChange);
    if (!clockListeners.size) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}

/** Ticking clock, client only. */
export function useNow(): number | null {
  return useSyncExternalStore(
    subscribeClock,
    () => (clockNow ||= Date.now()),
    () => null,
  );
}
