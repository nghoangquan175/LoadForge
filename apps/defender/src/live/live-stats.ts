import { cpuPercent, cpuTimes } from '../cpu-metrics/cpu-publisher.js';

/**
 * Real-time view of one server, one point per second, for the Watcher's
 * `/live` calls. CloudWatch is 1 to 2 minutes behind; this covers that gap.
 *
 * The workers serve requests and count them; the primary (which serves no
 * traffic) adds them up, measures CPU and answers `/live` on the health port,
 * so polling it never queues behind a CPU-heavy request.
 */

/** One second (or one 15 s step, `/live?step=15`) of one server, as `/live` returns it. */
export interface LivePoint {
  /** start of the second or step, epoch ms */
  t: number;
  /** whole-machine CPU, % (average over the step) */
  cpu: number;
  /** requests finished in this second or step */
  requests: number;
  /** average response time of those requests, ms (0 without requests) */
  latencyMs: number;
  /** 5xx responses in this second or step */
  errors5xx: number;
}

/** Worker to primary: request counts per second since the last message. [t, count, errors, latencySum] */
export interface LiveMessage {
  type: 'loadforge:live';
  buckets: [number, number, number, number][];
}

export const isLiveMessage = (m: unknown): m is LiveMessage =>
  typeof m === 'object' && m !== null && (m as LiveMessage).type === 'loadforge:live';

const SECOND = 1000;
/**
 * Seconds kept: more than CloudWatch's delay, so a Watcher that just started
 * can fill the whole gap. It then asks only for the last seconds (`since`).
 */
const KEEP_SECONDS = 300;
/** A second is served once it ended this long ago, so most worker counts are in. */
const SETTLE_MS = 1000;
/**
 * The last hour in 15 s steps, for the dashboard's history: real 15 s data,
 * where CloudWatch only has 1-minute points. About 25 KB.
 */
export const HISTORY_STEP_MS = 15_000;
const HISTORY_KEEP_MS = 60 * 60_000;
/** How often a worker sends its counts. */
const REPORT_EVERY_MS = 250;

interface Bucket {
  count: number;
  errors: number;
  latencySum: number;
  cpu?: number;
}

interface Step {
  count: number;
  errors: number;
  latencySum: number;
  cpuSum: number;
  cpuSeconds: number;
}

const secondOf = (now: number) => Math.floor(now / SECOND) * SECOND;
const stepOf = (t: number) => Math.floor(t / HISTORY_STEP_MS) * HISTORY_STEP_MS;

/** In the primary: adds up the workers' counts and samples CPU every second. */
export class LiveStats {
  private readonly buckets = new Map<number, Bucket>();
  private readonly steps = new Map<number, Step>();

  private step(t: number): Step {
    const at = stepOf(t);
    let s = this.steps.get(at);
    if (!s) {
      s = { count: 0, errors: 0, latencySum: 0, cpuSum: 0, cpuSeconds: 0 };
      this.steps.set(at, s);
    }
    return s;
  }

  private bucket(t: number): Bucket {
    let b = this.buckets.get(t);
    if (!b) {
      b = { count: 0, errors: 0, latencySum: 0 };
      this.buckets.set(t, b);
    }
    return b;
  }

  add(message: LiveMessage) {
    for (const [t, count, errors, latencySum] of message.buckets) {
      // Counted twice: per second for /live, per 15 s step for the history.
      for (const b of [this.bucket(t), this.step(t)]) {
        b.count += count;
        b.errors += errors;
        b.latencySum += latencySum;
      }
    }
  }

  setCpu(t: number, cpu: number) {
    this.bucket(t).cpu = Math.round(cpu * 10) / 10;
    const s = this.step(t);
    s.cpuSum += cpu;
    s.cpuSeconds++;
  }

  /** Finished 15 s steps after `since`, oldest first, over the last hour. */
  history(now = Date.now(), since = -Infinity): LivePoint[] {
    const newest = stepOf(now - SETTLE_MS) - HISTORY_STEP_MS;
    for (const t of this.steps.keys()) if (t < now - HISTORY_KEEP_MS) this.steps.delete(t);

    const out: LivePoint[] = [];
    for (const [t, s] of [...this.steps].sort(([a], [b]) => a - b)) {
      if (t <= since || t > newest || !s.cpuSeconds) continue;
      out.push({
        t,
        cpu: Math.round((s.cpuSum / s.cpuSeconds) * 10) / 10,
        requests: s.count,
        latencyMs: s.count ? Math.round(s.latencySum / s.count) : 0,
        errors5xx: s.errors,
      });
    }
    return out;
  }

  /** Finished seconds after `since`, oldest first; a second without traffic is still a point. */
  points(now = Date.now(), since = -Infinity): LivePoint[] {
    const newest = secondOf(now - SETTLE_MS) - SECOND;
    const oldest = newest - (KEEP_SECONDS - 1) * SECOND;
    for (const t of this.buckets.keys()) if (t < oldest - SECOND) this.buckets.delete(t);

    const out: LivePoint[] = [];
    let cpu: number | undefined;
    for (let t = oldest; t <= newest; t += SECOND) {
      const b = this.buckets.get(t);
      // A missed CPU tick (timer drift) repeats the one before it.
      cpu = b?.cpu ?? cpu;
      if (cpu === undefined || t <= since) continue;
      out.push({
        t,
        cpu,
        requests: b?.count ?? 0,
        latencyMs: b?.count ? Math.round(b.latencySum / b.count) : 0,
        errors5xx: b?.errors ?? 0,
      });
    }
    return out;
  }

  /** Samples CPU once a second, on the second. Returns a stop function. */
  startCpuSampling(): () => void {
    let prev = cpuTimes();
    let interval: ReturnType<typeof setInterval> | undefined;
    const sample = () => {
      const next = cpuTimes();
      // The second that just ended.
      this.setCpu(secondOf(Date.now()) - SECOND, cpuPercent(prev, next));
      prev = next;
    };
    const start = setTimeout(
      () => {
        sample();
        interval = setInterval(sample, SECOND);
        interval.unref();
      },
      SECOND - (Date.now() % SECOND) + 20,
    );
    start.unref();
    return () => {
      clearTimeout(start);
      clearInterval(interval);
    };
  }
}

/** In a worker: counts finished requests per second and sends them to the primary. */
export class LiveReporter {
  private pending = new Map<number, [number, number, number]>();
  private timer: ReturnType<typeof setInterval> | undefined;

  /** Only in a cluster worker; elsewhere there is no primary to tell. */
  get active() {
    return this.timer !== undefined;
  }

  start(send: (m: LiveMessage) => void) {
    this.timer = setInterval(() => {
      if (!this.pending.size) return;
      send({ type: 'loadforge:live', buckets: [...this.pending].map(([t, [c, e, l]]) => [t, c, e, l]) });
      this.pending.clear();
    }, REPORT_EVERY_MS);
    this.timer.unref();
  }

  record(durationMs: number, status: number, now = Date.now()) {
    if (!this.active) return;
    const t = secondOf(now);
    const b = this.pending.get(t) ?? [0, 0, 0];
    b[0]++;
    if (status >= 500) b[1]++;
    b[2] += durationMs;
    this.pending.set(t, b);
  }
}

/** One per worker process. */
export const liveReporter = new LiveReporter();
