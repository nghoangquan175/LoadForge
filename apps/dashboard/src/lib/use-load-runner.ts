'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Sends requests from this browser at a steady rate, like k6's
// constant-arrival-rate executor. Browsers cap open connections, so very high
// rates hit MAX_IN_FLIGHT and the achieved rate falls behind the target.

export const MAX_RATE = 200;
export const MAX_TOTAL = 200_000;
const MAX_IN_FLIGHT = 300;
const TICK_MS = 50;
const UI_REFRESH_MS = 250;

export interface RunStats {
  running: boolean;
  total: number;
  rate: number;
  sent: number;
  ok: number;
  failed: number;
  inFlight: number;
  avgMs: number;
  elapsedMs: number;
  startedAt: number | null;
  endedAt: number | null;
}

const IDLE: RunStats = {
  running: false,
  total: 0,
  rate: 0,
  sent: 0,
  ok: 0,
  failed: 0,
  inFlight: 0,
  avgMs: 0,
  elapsedMs: 0,
  startedAt: null,
  endedAt: null,
};

export function useLoadRunner() {
  const [stats, setStats] = useState<RunStats>(IDLE);
  const live = useRef<RunStats & { latencySum: number }>({ ...IDLE, latencySum: 0 });
  const timers = useRef<{ tick?: ReturnType<typeof setInterval>; ui?: ReturnType<typeof setInterval> }>({});
  const abort = useRef<AbortController | null>(null);

  const publish = useCallback(() => {
    const { latencySum, ...s } = live.current;
    const done = s.ok + s.failed;
    const elapsedMs = s.startedAt ? (s.endedAt ?? Date.now()) - s.startedAt : 0;
    setStats({ ...s, avgMs: done ? latencySum / done : 0, elapsedMs });
  }, []);

  const finish = useCallback(() => {
    clearInterval(timers.current.tick);
    clearInterval(timers.current.ui);
    live.current.running = false;
    live.current.endedAt = Date.now();
    publish();
  }, [publish]);

  const stop = useCallback(() => {
    abort.current?.abort();
    finish();
  }, [finish]);

  const start = useCallback(
    (url: string, total: number, rate: number) => {
      stop();
      abort.current = new AbortController();
      const signal = abort.current.signal;
      const startedAt = Date.now();
      live.current = { ...IDLE, running: true, total, rate, startedAt, latencySum: 0 };

      const fire = () => {
        const s = live.current;
        s.sent++;
        s.inFlight++;
        const t0 = performance.now();
        fetch(url, { cache: 'no-store', signal })
          .then((res) => (res.ok ? s.ok++ : s.failed++))
          .catch(() => {
            if (!signal.aborted) s.failed++;
          })
          .finally(() => {
            s.inFlight--;
            s.latencySum += performance.now() - t0;
          });
      };

      timers.current.tick = setInterval(() => {
        const s = live.current;
        // Requests that should have gone out by now, at a steady rate.
        const due = Math.min(total, Math.floor(((Date.now() - startedAt) / 1000) * rate) + 1);
        while (s.sent < due && s.inFlight < MAX_IN_FLIGHT) fire();
        if (s.sent >= total && s.inFlight === 0) finish();
      }, TICK_MS);
      timers.current.ui = setInterval(publish, UI_REFRESH_MS);
      publish();
    },
    [finish, publish, stop],
  );

  useEffect(() => stop, [stop]);

  return { stats, start, stop };
}
