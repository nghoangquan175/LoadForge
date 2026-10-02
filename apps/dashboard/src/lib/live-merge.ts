import type { InstanceMetrics, LivePoint, MetricPoint } from './types';

/**
 * A chart joins three sources, newest wins:
 *
 *   CloudWatch, 1-minute points | Defenders' 15 s steps          | 1 s points
 *   (servers gone, before the   | (each Defender's own hour,     | (the last 2
 *    Watcher saw them)          |  read by the Watcher)          |  minutes)
 *
 * Every point is measured: nothing is filled in between.
 */

/** The last stretch drawn from 1 s points. */
const SECONDS_SPAN_MS = 2 * 60_000;
const STEP_MS = 15_000;

const KEYS = ['cpu', 'requests', 'latencyMs', 'errors5xx'] as const;

/** Defender counts are per second or per 15 s step; the charts show requests and 5xx per minute. */
function toSeries(points: LivePoint[], perMinute: number): InstanceMetrics {
  return {
    cpu: points.map((p) => ({ t: p.t, v: p.cpu })),
    requests: points.map((p) => ({ t: p.t, v: p.requests * perMinute })),
    latencyMs: points.map((p) => ({ t: p.t, v: p.latencyMs })),
    errors5xx: points.map((p) => ({ t: p.t, v: p.errors5xx * perMinute })),
  };
}

export interface Sources {
  /** CloudWatch's last hour, 1-minute points */
  cloudwatch: InstanceMetrics;
  /** Defenders' 15 s steps */
  steps?: LivePoint[];
  /** Defenders' seconds */
  seconds?: LivePoint[];
  /** Steps before this are incomplete (a group missing servers that are gone): CloudWatch there. */
  stepsFrom?: number;
}

/** The joined series, and where the 1 s part starts (the chart draws it wider). */
export function joinSources({ cloudwatch, steps = [], seconds = [], stepsFrom = -Infinity }: Sources): {
  metrics: InstanceMetrics;
  liveFrom?: number;
} {
  const usableSteps = steps.filter((p) => p.t >= stepsFrom);
  const stepsEnd = usableSteps.length ? usableSteps[usableSteps.length - 1].t + STEP_MS : -Infinity;
  // 1 s points for the last 2 minutes, on a step boundary; further back only if steps lag behind.
  const newestSecond = seconds[seconds.length - 1]?.t;
  const liveFrom =
    newestSecond === undefined
      ? undefined
      : Math.max(seconds[0].t, Math.min(Math.floor((newestSecond - SECONDS_SPAN_MS) / STEP_MS) * STEP_MS, stepsEnd));
  const stepsStart = usableSteps[0]?.t ?? liveFrom ?? Infinity;

  const fromSteps = toSeries(usableSteps.filter((p) => p.t < (liveFrom ?? Infinity)), 4);
  const fromSeconds = toSeries(liveFrom === undefined ? [] : seconds.filter((p) => p.t >= liveFrom), 60);
  const metrics = {} as InstanceMetrics;
  for (const k of KEYS) {
    const past: MetricPoint[] = cloudwatch[k].filter((p) => p.t < stepsStart);
    metrics[k] = [...past, ...fromSteps[k], ...fromSeconds[k]];
  }
  return { metrics, liveFrom };
}

/**
 * A group's points from its servers' points at the same times: average CPU,
 * total requests and 5xx, response time weighted by requests. The newest
 * times are left out until every server still reporting has them, so a slow
 * reply does not dip the total.
 */
export function groupPoints(byServer: Record<string, LivePoint[]>): LivePoint[] {
  const byTime = new Map<number, LivePoint[]>();
  let newest = -Infinity;
  for (const points of Object.values(byServer)) {
    for (const p of points) {
      const at = byTime.get(p.t);
      if (at) at.push(p);
      else byTime.set(p.t, [p]);
      newest = Math.max(newest, p.t);
    }
  }
  const sorted = [...byTime].sort(([a], [b]) => a - b);
  // Still reporting: has a point near the newest. A server that is gone stops counting.
  const gap = sorted.length > 1 ? sorted[sorted.length - 1][0] - sorted[sorted.length - 2][0] : 0;
  const reporting = Object.values(byServer).filter((ps) => (ps[ps.length - 1]?.t ?? -Infinity) >= newest - 3 * gap).length;
  while (sorted.length && sorted[sorted.length - 1][1].length < reporting) sorted.pop();

  return sorted.map(([t, ps]) => {
    const requests = ps.reduce((s, p) => s + p.requests, 0);
    return {
      t,
      cpu: Math.round((ps.reduce((s, p) => s + p.cpu, 0) / ps.length) * 10) / 10,
      requests,
      latencyMs: requests ? Math.round(ps.reduce((s, p) => s + p.latencyMs * p.requests, 0) / requests) : 0,
      errors5xx: ps.reduce((s, p) => s + p.errors5xx, 0),
    };
  });
}
