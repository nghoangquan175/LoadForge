'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createSim, SIM_PERIOD_MS, stepSim, toSnapshot, type SimState } from './simulator';
import type { DashboardSnapshot } from './types';

export type LinkState = 'connecting' | 'live' | 'fallback';

/** Give the server this long to send its first event before simulating. */
const CONNECT_GRACE_MS = 2500;

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Streams dashboard snapshots from the server over SSE.
 * While the server is unreachable, a local simulator keeps the UI alive.
 */
export function useLiveSnapshot() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [link, setLink] = useState<LinkState>('connecting');

  useEffect(() => {
    let sim: SimState | null = null;
    let simTimer: ReturnType<typeof setInterval> | null = null;

    const startFallback = () => {
      if (simTimer) return;
      sim ??= createSim(Date.now());
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
    const source = new EventSource(`${API_URL}/api/stream`);
    source.addEventListener('snapshot', (e) => {
      clearTimeout(graceTimer);
      stopFallback();
      setLink('live');
      setSnapshot(JSON.parse((e as MessageEvent<string>).data) as DashboardSnapshot);
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

  return { snapshot, link };
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
