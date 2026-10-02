import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { LivePoint, LiveUpdate } from '../common/types.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { SnapshotService } from '../snapshot/snapshot.service.js';

/** Seconds kept per server: covers CloudWatch's 1 to 2 minute delay with room to spare. */
export const LIVE_KEEP_MS = 5 * 60_000;
/** 15 s steps kept per server: the dashboard's hour. */
export const HISTORY_KEEP_MS = 60 * 60_000;
const STEP_MS = 15_000;
/** Sent after each poll: the last seconds, which may correct points sent before. */
const RECENT_MS = 15_000;
/** A Defender slower than this is skipped this time. */
const FETCH_TIMEOUT_MS = 800;

type Buffer = Map<string, Map<number, LivePoint>>;

/** Adds points (a newer read of a time replaces the older one) and drops those older than `keepMs`. */
function store(buffer: Buffer, fresh: Record<string, LivePoint[]>, keepMs: number, now: number) {
  for (const [id, points] of Object.entries(fresh)) {
    let byTime = buffer.get(id);
    if (!byTime) buffer.set(id, (byTime = new Map()));
    for (const p of points) byTime.set(p.t, p);
  }
  for (const [id, byTime] of buffer) {
    for (const t of byTime.keys()) if (t < now - keepMs) byTime.delete(t);
    if (!byTime.size) buffer.delete(id);
  }
}

/** Points from `from` on, oldest first, per instance. */
function since(buffer: Buffer, from: number): Record<string, LivePoint[]> {
  const out: Record<string, LivePoint[]> = {};
  for (const [id, byTime] of buffer) {
    const points = [...byTime.values()].filter((p) => p.t >= from).sort((a, b) => a.t - b.t);
    if (points.length) out[id] = points;
  }
  return out;
}

/** Newest time held for a server, so the next read asks only for what is new. */
const newestOf = (buffer: Buffer, id: string) => Math.max(...(buffer.get(id)?.keys() ?? []));

/**
 * Data from the Defenders themselves, read from each one's `/live` on its
 * health port. That port is served by the Node primary, never a worker, so
 * these reads are not traffic and do not show in the load numbers.
 *
 * - every second, while a dashboard is connected: the last seconds, covering
 *   the 1 to 2 minutes CloudWatch is behind;
 * - every 15 s, always: the last hour in 15 s steps. Always, so the Watcher
 *   still has the steps of a server after it is terminated, and a group total
 *   from here on counts every server (`historySince`).
 *
 * With mock data, the sim answers instead.
 */
@Injectable()
export class LiveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveService.name);
  private readonly seconds: Buffer = new Map();
  private readonly steps: Buffer = new Map();
  private readonly updates = new Subject<LiveUpdate>();
  /** Instances whose /live failed, so a server still booting is logged once, not every second. */
  private readonly failing = new Set<string>();
  private historySince: number | undefined;
  private liveTimer: ReturnType<typeof setTimeout> | undefined;
  private historyTimer: ReturnType<typeof setTimeout> | undefined;
  private polling = false;
  private stopped = false;
  private subscribers = 0;

  /** Everything held right away, then what is new after every poll. */
  readonly updates$ = new Observable<LiveUpdate>((subscriber) => {
    this.subscribers++;
    subscriber.next({ points: since(this.seconds, 0), history: since(this.steps, 0), historySince: this.historySince });
    const sub = this.updates.subscribe(subscriber);
    this.startPolling();
    return () => {
      sub.unsubscribe();
      this.subscribers--;
    };
  });

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly snapshots: SnapshotService,
  ) {}

  onModuleInit() {
    void this.historyTick();
  }

  onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.liveTimer);
    clearTimeout(this.historyTimer);
    this.updates.complete();
  }

  /** Adds per-second points; exposed for tests. */
  storeSeconds(fresh: Record<string, LivePoint[]>, now = Date.now()) {
    store(this.seconds, fresh, LIVE_KEEP_MS, now);
  }

  /** Per-second points from `from` on; exposed for tests. */
  secondsSince(from: number): LiveUpdate {
    return { points: since(this.seconds, from) };
  }

  /**
   * Real servers to read: from the last snapshot while it is fresh (a
   * dashboard is open), otherwise asked from AWS (free, no CloudWatch).
   * Null with mock data.
   */
  private async servers(): Promise<{ id: string; privateIp?: string }[] | null> {
    const snapshot = this.snapshots.snapshot;
    if (snapshot?.source === 'aws' && Date.now() - snapshot.ts < 2 * this.config.awsPollMs) return snapshot.instances;
    return this.snapshots.servers();
  }

  /** Reads one route from every real server, or null with mock data. */
  private async readServers(path: (id: string) => string): Promise<Record<string, LivePoint[]> | null> {
    const servers = await this.servers();
    if (!servers) return null;
    const results = await Promise.all(
      servers
        .filter((s) => s.privateIp)
        .map(async ({ id, privateIp }) => {
          try {
            const res = await fetch(`http://${privateIp}:${this.config.defenderLivePort}${path(id)}`, {
              signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = (await res.json()) as { points: LivePoint[] };
            if (this.failing.delete(id)) this.logger.log(`${id}: /live is back`);
            return [id, body.points] as const;
          } catch (err) {
            if (!this.failing.has(id)) {
              this.failing.add(id);
              this.logger.warn(`${id}: /live failed (${err instanceof Error ? err.message : String(err)}), retrying`);
            }
            return null;
          }
        }),
    );
    return Object.fromEntries(results.filter((r) => r !== null));
  }

  /** Each Defender's last seconds; on the first read everything it kept (5 minutes). */
  private async readSeconds(): Promise<Record<string, LivePoint[]>> {
    // Every second: only with a snapshot's server list, never an AWS call per second.
    const snapshot = this.snapshots.snapshot;
    if (!snapshot) return {};
    if (snapshot.source === 'mock') return this.snapshots.mockLive();
    const fresh = await this.readServers((id) => {
      // Again the last seconds, where late worker counts may have changed a point.
      const newest = newestOf(this.seconds, id);
      return Number.isFinite(newest) ? `/live?since=${newest - RECENT_MS}` : '/live';
    });
    return fresh ?? this.snapshots.mockLive();
  }

  /** Each Defender's 15 s steps; on the first read its whole hour. */
  private async readSteps(): Promise<Record<string, LivePoint[]>> {
    const fresh = await this.readServers((id) => {
      const newest = newestOf(this.steps, id);
      return Number.isFinite(newest) ? `/live?step=15&since=${newest - STEP_MS}` : '/live?step=15';
    });
    // Servers terminated before this first read are missing from the hour before it.
    this.historySince ??= Math.ceil(Date.now() / STEP_MS) * STEP_MS;
    return fresh ?? this.snapshots.mockHistory();
  }

  private async historyTick() {
    const started = Date.now();
    try {
      store(this.steps, await this.readSteps(), HISTORY_KEEP_MS, started);
      this.updates.next({ points: {}, history: since(this.steps, started - 2 * STEP_MS), historySince: this.historySince });
    } catch (err) {
      this.logger.error(err);
    }
    if (this.stopped) return;
    this.historyTimer = setTimeout(() => void this.historyTick(), Math.max(0, STEP_MS - (Date.now() - started)));
  }

  private startPolling() {
    if (this.polling || this.stopped) return;
    this.polling = true;
    void this.liveTick();
  }

  private async liveTick() {
    const started = Date.now();
    try {
      this.storeSeconds(await this.readSeconds());
      this.updates.next(this.secondsSince(Date.now() - RECENT_MS));
    } catch (err) {
      this.logger.error(err);
    }
    // Last dashboard closed: stop until the next one connects.
    if (this.stopped || this.subscribers === 0) {
      this.polling = false;
      return;
    }
    this.liveTimer = setTimeout(() => void this.liveTick(), Math.max(0, this.config.livePollMs - (Date.now() - started)));
  }
}
