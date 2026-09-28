import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { BehaviorSubject, filter, type Observable } from 'rxjs';
import { AwsSnapshotProvider } from '../aws/aws.provider.js';
import { MockSnapshotProvider } from '../aws/mock.provider.js';
import type { SnapshotProvider } from '../aws/snapshot-provider.js';
import type { DashboardSnapshot } from '../common/types.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

/**
 * Polls the data source on a timer and fans the latest snapshot out to every
 * SSE client, so AWS is called once per interval no matter how many
 * dashboards are open.
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

  /** Emits the current snapshot right away, then every refresh. */
  readonly snapshots$: Observable<DashboardSnapshot> = this.latest.pipe(
    filter((s): s is DashboardSnapshot => s !== null),
  );

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const wantsAws = config.dataSource === 'aws' || (config.dataSource === 'auto' && !!config.asgName);
    this.aws = wantsAws ? new AwsSnapshotProvider(config) : null;
  }

  async onModuleInit() {
    this.logger.log(
      this.aws
        ? `data source: AWS (asg=${this.config.asgName}, region=${this.config.region})`
        : 'data source: mock (set ASG_NAME to read a real Auto Scaling group)',
    );
    await this.refresh();
    this.schedule();
  }

  onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.latest.complete();
  }

  async current(): Promise<DashboardSnapshot> {
    return this.latest.value ?? (await this.refresh());
  }

  async refresh(): Promise<DashboardSnapshot> {
    const snapshot = await this.fetch();
    this.latest.next(snapshot);
    return snapshot;
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

  private schedule() {
    if (this.stopped) return;
    const delay = this.aws && this.awsHealthy ? this.config.awsPollMs : this.config.mockTickMs;
    this.timer = setTimeout(() => {
      this.refresh()
        .catch((err: unknown) => this.logger.error(err))
        .finally(() => this.schedule());
    }, delay);
  }
}
