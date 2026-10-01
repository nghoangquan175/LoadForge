import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { BehaviorSubject, filter, Observable } from 'rxjs';
import { AwsSnapshotProvider } from '../aws/aws.provider.js';
import { MockSnapshotProvider } from '../aws/mock.provider.js';
import type { SnapshotProvider } from '../aws/snapshot-provider.js';
import type { DashboardSnapshot } from '../common/types.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

/**
 * Polls the data source on a timer and fans the latest snapshot out to every
 * SSE client, so AWS is called once per interval no matter how many
 * dashboards are open. Polling only runs while at least one client is
 * connected: CloudWatch GetMetricData is billed per metric requested.
 */
@Injectable()
export class SnapshotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SnapshotService.name);
  private readonly latest = new BehaviorSubject<DashboardSnapshot | null>(null);
  private readonly aws: SnapshotProvider | null;
  private readonly mock = new MockSnapshotProvider();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private awsHealthy = false;
  private stopped = false;
  private polling = false;
  private subscribers = 0;

  /** Emits the current snapshot right away, then every refresh. */
  readonly snapshots$ = new Observable<DashboardSnapshot>((subscriber) => {
    this.subscribers++;
    this.startPolling();
    const sub = this.latest.pipe(filter((s): s is DashboardSnapshot => s !== null)).subscribe(subscriber);
    return () => {
      sub.unsubscribe();
      this.subscribers--;
    };
  });

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const wantsAws = config.dataSource === 'aws' || (config.dataSource === 'auto' && !!config.asgName);
    this.aws = wantsAws ? new AwsSnapshotProvider(config) : null;
  }

  onModuleInit() {
    this.logger.log(
      this.aws
        ? `data source: AWS (asg=${this.config.asgName}, region=${this.config.region})`
        : 'data source: mock (set ASG_NAME to read a real Auto Scaling group)',
    );
  }

  onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.latest.complete();
  }

  /** For REST calls: the cached snapshot while fresh, otherwise a new one. */
  async current(): Promise<DashboardSnapshot> {
    const s = this.latest.value;
    return s && Date.now() - s.ts < this.interval() ? s : this.refresh();
  }

  async refresh(): Promise<DashboardSnapshot> {
    const snapshot = await this.fetch();
    this.latest.next(snapshot);
    return snapshot;
  }

  private interval() {
    return this.aws && this.awsHealthy ? this.config.awsPollMs : this.config.mockTickMs;
  }

  private async fetch(): Promise<DashboardSnapshot> {
    if (!this.aws) return this.mock.fetch();
    try {
      const snapshot = await this.aws.fetch();
      if (!this.awsHealthy) this.logger.log('AWS data source connected');
      this.awsHealthy = true;
      return snapshot;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.awsHealthy || this.latest.value === null) {
        this.logger.warn(`AWS fetch failed: ${message}`);
      }
      this.awsHealthy = false;
      // aws mode: keep showing the last real data; auto mode: fall back to mock.
      if (this.config.dataSource === 'aws' && this.latest.value) return this.latest.value;
      return this.mock.fetch();
    }
  }

  private startPolling() {
    if (this.polling || this.stopped) return;
    this.polling = true;
    this.tick();
  }

  private tick() {
    this.refresh()
      .catch((err: unknown) => this.logger.error(err))
      .finally(() => {
        // Last dashboard closed: stop calling AWS until the next one connects.
        if (this.stopped || this.subscribers === 0) {
          this.polling = false;
          return;
        }
        this.timer = setTimeout(() => this.tick(), this.interval());
      });
  }
}
