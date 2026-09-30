'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Sends requests from this browser at a steady rate, like k6's
// constant-arrival-rate executor. Browsers cap open connections, so very high
// rates hit MAX_IN_FLIGHT and the achieved rate falls behind the target.
//
// idle --start--> running --stop--> paused --continue--> running --...--> finished
//   ^------------------------- delete (from any state) ----------------------'

export const MAX_RATE = 200;
export const MAX_TOTAL = 200_000;
const MAX_IN_FLIGHT = 300;
const TICK_MS = 50;
const UI_REFRESH_MS = 250;

export type RunStatus = 'idle' | 'running' | 'paused' | 'finished';

/** Per server, from what each response says about itself (servedBy, worker, durationMs). */
export interface ServerStats {
  /** instance id, or why there was no server (e.g. HTTP 502 from the load balancer) */
  id: string;
  done: number;
  failed: number;
  /** recent time spent waiting in line: round trip minus the server's own work */
  waitMs: number;
  /** average time the server spent working on one request */
  workMs: number;
  /** different Node workers seen on this server */
  workers: number;
}

export interface RunStats {
  status: RunStatus;
  total: number;
  rate: number;
  sent: number;
  ok: number;
  failed: number;
  inFlight: number;
  avgMs: number;
  /** time spent running, pauses excluded */
  elapsedMs: number;
  servers: ServerStats[];
}

const IDLE: RunStats = {
  status: 'idle',
  total: 0,
  rate: 0,
  sent: 0,
  ok: 0,
  failed: 0,
  inFlight: 0,
  avgMs: 0,
  elapsedMs: 0,
  servers: [],
};

/** Weight of the newest response in the recent wait; ~last 10 responses. */
const WAIT_ALPHA = 0.1;

interface ServerTally {
  done: number;
  failed: number;
  waitEma: number | null;
  workSum: number;
  workCount: number;
  workers: Set<number>;
}

interface Live extends RunStats {
  url: string;
  latencySum: number;
  /** running time banked before the current run segment */
  bankedMs: number;
  /** start of the current run segment, null while not running */
  resumedAt: number | null;
  tallies: Map<string, ServerTally>;
}

const idleLive = (): Live => ({ ...IDLE, url: '', latencySum: 0, bankedMs: 0, resumedAt: null, tallies: new Map() });

export function useLoadRunner() {
  const [stats, setStats] = useState<RunStats>(IDLE);
  const live = useRef<Live>(idleLive());
  const timers = useRef<{ tick?: ReturnType<typeof setInterval>; ui?: ReturnType<typeof setInterval> }>({});
  const abort = useRef<AbortController | null>(null);

  const activeMs = (s: Live) => s.bankedMs + (s.resumedAt !== null ? Date.now() - s.resumedAt : 0);

  const publish = useCallback(() => {
    const s = live.current;
    const done = s.ok + s.failed;
    setStats({
      status: s.status,
      total: s.total,
      rate: s.rate,
      sent: s.sent,
      ok: s.ok,
      failed: s.failed,
      inFlight: s.inFlight,
      avgMs: done ? s.latencySum / done : 0,
      elapsedMs: activeMs(s),
      servers: [...s.tallies.entries()]
        .map(([id, t]) => ({
          id,
          done: t.done,
          failed: t.failed,
          waitMs: t.waitEma ?? 0,
          workMs: t.workCount ? t.workSum / t.workCount : 0,
          workers: t.workers.size,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
  }, []);

  /**
   * Stop scheduling new requests; ones already sent still finish.
   * While paused the display keeps refreshing so those still count.
   */
  const halt = useCallback((status: RunStatus) => {
    clearInterval(timers.current.tick);
    if (status !== 'paused') clearInterval(timers.current.ui);
    const s = live.current;
    s.bankedMs = activeMs(s);
    s.resumedAt = null;
    s.status = status;
  }, []);

  const run = useCallback(() => {
    const s = live.current;
    s.status = 'running';
    s.resumedAt = Date.now();
    const signal = abort.current!.signal;

    const record = (id: string, roundTripMs: number, ok: boolean, workMs?: number, worker?: number) => {
      let t = s.tallies.get(id);
      if (!t) {
        t = { done: 0, failed: 0, waitEma: null, workSum: 0, workCount: 0, workers: new Set() };
        s.tallies.set(id, t);
      }
      if (ok) t.done++;
      else t.failed++;
      if (workMs !== undefined) {
        t.workSum += workMs;
        t.workCount++;
        const wait = Math.max(0, roundTripMs - workMs);
        t.waitEma = t.waitEma === null ? wait : t.waitEma * (1 - WAIT_ALPHA) + wait * WAIT_ALPHA;
      }
      if (worker !== undefined) t.workers.add(worker);
    };

    const fire = () => {
      s.sent++;
      s.inFlight++;
      const t0 = performance.now();
      fetch(s.url, { cache: 'no-store', signal })
        .then(async (res) => {
          // Our API says which server and worker answered and how long the work took.
          const body = (await res.json().catch(() => ({}))) as { servedBy?: string; worker?: number; durationMs?: number };
          const id = body.servedBy ?? (res.ok ? 'unknown' : `load balancer · HTTP ${res.status}`);
          record(id, performance.now() - t0, res.ok, body.durationMs, body.worker);
          if (res.ok) s.ok++;
          else s.failed++;
        })
        .catch(() => {
          if (signal.aborted) return;
          s.failed++;
          record('no response', performance.now() - t0, false);
        })
        .finally(() => {
          s.inFlight--;
          s.latencySum += performance.now() - t0;
        });
    };

    timers.current.tick = setInterval(() => {
      // Requests that should have gone out by now, counting running time only.
      const due = Math.min(s.total, Math.floor((activeMs(s) / 1000) * s.rate) + 1);
      while (s.sent < due && s.inFlight < MAX_IN_FLIGHT) fire();
      if (s.sent >= s.total && s.inFlight === 0) {
        halt('finished');
        publish();
      }
    }, TICK_MS);
    clearInterval(timers.current.ui);
    timers.current.ui = setInterval(publish, UI_REFRESH_MS);
    publish();
  }, [halt, publish]);

  const start = useCallback(
    (url: string, total: number, rate: number) => {
      halt('idle');
      abort.current?.abort();
      abort.current = new AbortController();
      live.current = { ...idleLive(), url, total, rate };
      run();
    },
    [halt, run],
  );

  const stop = useCallback(() => {
    if (live.current.status !== 'running') return;
    halt('paused');
    publish();
  }, [halt, publish]);

  const resume = useCallback(() => {
    if (live.current.status !== 'paused') return;
    run();
  }, [run]);

  /** Throw the test away: cancel open requests and clear the results. */
  const remove = useCallback(() => {
    halt('idle');
    clearInterval(timers.current.ui);
    abort.current?.abort();
    live.current = idleLive();
    setStats(IDLE);
  }, [halt]);

  useEffect(
    () => () => {
      clearInterval(timers.current.tick);
      clearInterval(timers.current.ui);
      abort.current?.abort();
    },
    [],
  );

  return { stats, start, stop, resume, remove };
}
