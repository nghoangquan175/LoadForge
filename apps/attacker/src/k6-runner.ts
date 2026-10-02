import { type ChildProcess, spawn } from 'node:child_process';
import type { AttackerConfig } from './config.js';
import type { AttackPlan } from './plan.js';

export type RunState = 'idle' | 'running';

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
