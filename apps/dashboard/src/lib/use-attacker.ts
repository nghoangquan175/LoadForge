'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { WATCHER_URL } from './use-live-snapshot';

/** The Attacker's state, as the Watcher reports it (apps/watcher/src/attack). */
export interface AttackStatus {
  /** false when no Attacker box is wired up */
  configured: boolean;
  online: boolean;
  state: string;
  target?: string;
  plan?: { rate: number; durationSec: number };
  startedAt?: number;
  endsAt?: number;
  lastResult?: string | null;
}

export interface AttackPlan {
  rate: number;
  durationSec: number;
}

const POLL_MS = 2000;

/**
 * Drives the Attacker (the k6 load-generator box) through the Watcher's
 * /monitor/attack/* proxy, so the control token stays on the server and the
 * load comes from the Attacker, not this browser.
 */
export function useAttacker() {
  const [status, setStatus] = useState<AttackStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${WATCHER_URL}/monitor/attack/status`, { cache: 'no-store' });
      if (res.ok) setStatus((await res.json()) as AttackStatus);
    } catch {
      // Keep the last status; the next poll retries.
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    const loop = async () => {
      await poll();
      if (!stopped) timer.current = setTimeout(() => void loop(), POLL_MS);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer.current);
    };
  }, [poll]);

  const control = useCallback(async (action: 'start' | 'update' | 'stop', plan?: AttackPlan) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${WATCHER_URL}/monitor/attack/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: plan ? JSON.stringify(plan) : undefined,
      });
      const json = (await res.json().catch(() => ({}))) as AttackStatus & { error?: string };
      if (!res.ok) {
        setError(json.error ?? `request failed (HTTP ${res.status})`);
        return false;
      }
      setStatus(json);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    status,
    error,
    busy,
    start: (plan: AttackPlan) => control('start', plan),
    update: (plan: AttackPlan) => control('update', plan),
    stop: () => control('stop'),
  };
}
