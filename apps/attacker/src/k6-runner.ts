import { type ChildProcess, spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import type { AttackerConfig } from './config.js';
import type { AttackPlan } from './plan.js';

export type RunState = 'idle' | 'running';

/** What k6 is really doing right now, read live from its REST API. */
export interface LiveMetrics {
  /** the arrival rate we asked k6 to hold (req/s) */
  requestedRate: number;
  /** requests k6 actually sent, per second */
  sentRate: number;
  /** iterations k6 skipped because every VU was busy — never sent (per second) */
  droppedRate: number;
  sentTotal: number;
  droppedTotal: number;
  vus: number;
  vusMax: number;
  avgMs: number;
  p95Ms: number;
}

/** The slice of k6's JSON:API `/v1/metrics` payload we read. */
interface K6Sample {
  count?: number;
  rate?: number;
  value?: number;
  avg?: number;
  'p(95)'?: number;
}
interface K6Metric {
  id?: string;
  attributes?: { sample?: K6Sample };
}
interface K6MetricsResponse {
  data?: K6Metric[];
}

export interface Status {
  state: RunState;
  target: string;
  /** the plan k6 is running, when running */
  plan?: AttackPlan;
  /** epoch ms */
  startedAt?: number;
  endsAt?: number;
  /** last run's end: 'finished' | 'stopped' | 'error: …', or null if none yet */
  lastResult: string | null;
}

/**
 * Runs k6 against the fixed target and keeps one run at a time. Changing the
 * plan while running restarts k6 with the new rate (the arrival-rate executor's
 * rate is fixed for a run), so the generator never stops and starts for long.
 * k6 generates the load; this only starts, stops and reports it.
 */
export class K6Runner {
  private child: ChildProcess | null = null;
  private plan: AttackPlan | null = null;
  private startedAt = 0;
  private endsAt = 0;
  private lastResult: string | null = null;
  /** set while a restart (update) is in flight, so the exit handler does not report 'stopped' */
  private restarting = false;

  constructor(private readonly config: AttackerConfig) {}

  status(): Status {
    const running = this.child !== null;
    return {
      state: running ? 'running' : 'idle',
      target: this.config.target,
      plan: running && this.plan ? this.plan : undefined,
      startedAt: running ? this.startedAt : undefined,
      endsAt: running ? this.endsAt : undefined,
      lastResult: this.lastResult,
    };
  }

  /**
   * Live counters from the running k6 (its REST API on 127.0.0.1:6565), so a
   * caller can see whether k6 is actually holding the requested rate or dropping
   * iterations because the target is too slow for the VU budget. Returns
   * undefined when nothing is running or k6's API is unreachable.
   */
  async metrics(): Promise<LiveMetrics | undefined> {
    if (!this.child || !this.plan) return undefined;
    const body = await this.fetchK6Metrics();
    if (!body || !Array.isArray(body.data)) return undefined;

    const samples = new Map<string, K6Sample>();
    for (const m of body.data) {
      if (m.id && m.attributes?.sample) samples.set(m.id, m.attributes.sample);
    }
    const num = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const reqs = samples.get('http_reqs') ?? {};
    const dropped = samples.get('dropped_iterations') ?? {};
    const dur = samples.get('http_req_duration') ?? {};
    const vus = samples.get('vus') ?? {};
    const vusMax = samples.get('vus_max') ?? {};

    return {
      requestedRate: this.plan.rate,
      sentRate: Math.round(num(reqs.rate)),
      droppedRate: Math.round(num(dropped.rate)),
      sentTotal: Math.round(num(reqs.count)),
      droppedTotal: Math.round(num(dropped.count)),
      vus: num(vus.value),
      vusMax: num(vusMax.value),
      avgMs: Math.round(num(dur.avg)),
      p95Ms: Math.round(num(dur['p(95)'])),
    };
  }

  private fetchK6Metrics(): Promise<K6MetricsResponse | undefined> {
    return new Promise((resolve) => {
      const req = httpGet({ host: '127.0.0.1', port: 6565, path: '/v1/metrics', timeout: 1000 }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(undefined);
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as K6MetricsResponse);
          } catch {
            resolve(undefined);
          }
        });
      });
      req.on('error', () => resolve(undefined));
      req.on('timeout', () => {
        req.destroy();
        resolve(undefined);
      });
    });
  }

  /** Starts a run, replacing any current one. */
  start(plan: AttackPlan): Status {
    this.spawn(plan);
    return this.status();
  }

  /** Changes rate/duration without a gap in state: stop the old k6, start a new one. */
  update(plan: AttackPlan): Status {
    if (!this.child) return this.start(plan);
    this.restarting = true;
    this.kill();
    this.spawn(plan);
    this.restarting = false;
    return this.status();
  }

  /** Stops the run; k6 exits and the state goes idle. */
  stop(): Status {
    if (this.child) {
      this.lastResult = 'stopped';
      this.kill();
    }
    return this.status();
  }

  private spawn(plan: AttackPlan) {
    this.kill();
    this.plan = plan;
    this.startedAt = Date.now();
    this.endsAt = this.startedAt + plan.durationSec * 1000;

    const child = spawn(
      this.config.k6Bin,
      ['run', '--quiet', this.config.script],
      {
        env: {
          ...process.env,
          TARGET: this.config.target,
          RATE: String(plan.rate),
          DURATION: `${plan.durationSec}s`,
          MAX_VUS: String(this.config.maxVus),
        },
        stdio: ['ignore', 'inherit', 'inherit'],
      },
    );
    this.child = child;

    child.on('exit', (code, signal) => {
      // A stale process exiting (already replaced) must not clear the new one.
      if (this.child !== child) return;
      this.child = null;
      this.plan = null;
      if (this.restarting) return;
      if (this.lastResult !== 'stopped') {
        this.lastResult = code === 0 ? 'finished' : `error: k6 exited with ${signal ?? code}`;
      }
    });
    child.on('error', (err) => {
      if (this.child !== child) return;
      this.child = null;
      this.plan = null;
      this.lastResult = `error: ${err.message}`;
    });
  }

  private kill() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    child.kill('SIGTERM');
    // k6 stops promptly on SIGTERM; force it if it lingers.
    setTimeout(() => child.kill('SIGKILL'), 5000).unref();
  }
}
