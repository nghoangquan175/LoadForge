'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Sends requests from this browser at a steady rate, like k6's
// constant-arrival-rate executor. It never sends faster than the rate to make
// up for lost time: a request that could not go out on schedule (too many
// still open, or the tab was asleep) is dropped, not sent later in a burst.
//
// idle --start--> running --stop--> paused --continue--> running --...--> finished
//   ^------------------------- delete (from any state) ----------------------'
//
// While running or paused, `update` changes the total and the rate: the
// schedule goes on from where it is at the new rate, nothing restarts.

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
  /** scheduled but skipped: sending them late would burst above the rate */
  dropped: number;
  ok: number;
  failed: number;
  inFlight: number;
  avgMs: number;
  /** time spent running, pauses excluded */
  elapsedMs: number;
  /** running time and requests sent when the plan last changed (0 at start), for the current rate */
  planChangedAtMs: number;
  sentAtPlanChange: number;
  servers: ServerStats[];
}

const IDLE: RunStats = {
  status: 'idle',
  total: 0,
  rate: 0,
  sent: 0,
  dropped: 0,
  ok: 0,
  failed: 0,
  inFlight: 0,
  avgMs: 0,
  elapsedMs: 0,
  planChangedAtMs: 0,
  sentAtPlanChange: 0,
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
  /** requests scheduled (sent or dropped) when the plan last changed; the current rate counts from there */
  scheduledAtPlanChange: number;
  tallies: Map<string, ServerTally>;
}

const idleLive = (): Live => ({
  ...IDLE,
  url: '',
  latencySum: 0,
  bankedMs: 0,
  resumedAt: null,
  scheduledAtPlanChange: 0,
  tallies: new Map(),
});

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
      dropped: s.dropped,
      ok: s.ok,
      failed: s.failed,
      inFlight: s.inFlight,
      avgMs: done ? s.latencySum / done : 0,
      elapsedMs: activeMs(s),
      planChangedAtMs: s.planChangedAtMs,
      sentAtPlanChange: s.sentAtPlanChange,
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
      // Requests that should have gone out by now, counting running time only;
      // at the current rate since the plan last changed. The first goes out at once.
      const sinceChange = ((activeMs(s) - s.planChangedAtMs) / 1000) * s.rate;
      const due = Math.min(s.total, s.scheduledAtPlanChange + Math.floor(sinceChange) + (s.scheduledAtPlanChange ? 0 : 1));
      // More than a second behind (tab asleep): skip the backlog.
      const behind = due - (s.sent + s.dropped);
      const lateLimit = Math.ceil(s.rate);
      if (behind > lateLimit) s.dropped += behind - lateLimit;
      while (s.sent + s.dropped < due) {
        if (s.inFlight < MAX_IN_FLIGHT) fire();
        else s.dropped++;
      }
      if (s.sent + s.dropped >= s.total && s.inFlight === 0) {
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

  /**
   * New total and rate for the test that is running or paused. Requests
   * already scheduled stay; the new rate counts from now. A total below what
   * was already scheduled ends the test once open requests finish.
   */
  const update = useCallback(
    (total: number, rate: number) => {
      const s = live.current;
      if (s.status !== 'running' && s.status !== 'paused') return;
      s.scheduledAtPlanChange = s.sent + s.dropped;
      s.planChangedAtMs = activeMs(s);
      s.sentAtPlanChange = s.sent;
      s.total = Math.max(total, s.scheduledAtPlanChange);
      s.rate = rate;
      publish();
    },
    [publish],
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

  return { stats, start, update, stop, resume, remove };
}
