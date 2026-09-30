import { CloudWatchClient, PutMetricDataCommand, type MetricDatum } from '@aws-sdk/client-cloudwatch';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

export const METRICS_NAMESPACE = 'LoadForge';
const MINUTE = 60_000;
const FLUSH_EVERY_MS = 15_000;
/** Give up on a minute that still fails to send after this long. */
const MAX_AGE_MS = 5 * MINUTE;

interface Bucket {
  count: number;
  errors: number;
  latencySum: number;
  latencyMin: number;
  latencyMax: number;
}

/**
 * Counts this server's own requests per minute. The ALB only reports the
 * whole group, so each API server publishes RequestCount, Latency and
 * Http5xxCount to CloudWatch with its InstanceId, and the dashboard can
 * show one server at a time.
 */
@Injectable()
export class RequestStatsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RequestStatsService.name);
  private readonly buckets = new Map<number, Bucket>();
  private cloudwatch: CloudWatchClient | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  onModuleInit() {
    if (!this.config.publishMetrics) return;
    if (!this.config.instanceId) {
      this.logger.warn('PUBLISH_METRICS is on but INSTANCE_ID is not set, not publishing');
      return;
    }
    this.cloudwatch = new CloudWatchClient({ region: this.config.region });
    this.timer = setInterval(() => void this.flush(), FLUSH_EVERY_MS);
    this.logger.log(`publishing request metrics to CloudWatch ${METRICS_NAMESPACE} as ${this.config.instanceId}`);
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.flush(true);
  }

  record(durationMs: number, status: number, now = Date.now()) {
    const minute = Math.floor(now / MINUTE) * MINUTE;
    const b = this.buckets.get(minute) ?? { count: 0, errors: 0, latencySum: 0, latencyMin: Infinity, latencyMax: 0 };
    b.count++;
    if (status >= 500) b.errors++;
    b.latencySum += durationMs;
    b.latencyMin = Math.min(b.latencyMin, durationMs);
    b.latencyMax = Math.max(b.latencyMax, durationMs);
    this.buckets.set(minute, b);
  }

  /** Metric data for every finished minute (all minutes when `all`). */
  pending(all = false, now = Date.now()): { minute: number; data: MetricDatum[] }[] {
    const current = Math.floor(now / MINUTE) * MINUTE;
    const dimensions = [{ Name: 'InstanceId', Value: this.config.instanceId ?? 'local' }];
    return [...this.buckets.entries()]
      .filter(([minute]) => all || minute < current)
      .map(([minute, b]) => {
        const Timestamp = new Date(minute);
        return {
          minute,
          data: [
            { MetricName: 'RequestCount', Dimensions: dimensions, Timestamp, Value: b.count, Unit: 'Count' },
            { MetricName: 'Http5xxCount', Dimensions: dimensions, Timestamp, Value: b.errors, Unit: 'Count' },
            {
              MetricName: 'Latency',
              Dimensions: dimensions,
              Timestamp,
              Unit: 'Milliseconds',
              StatisticValues: { SampleCount: b.count, Sum: b.latencySum, Minimum: b.latencyMin, Maximum: b.latencyMax },
            },
          ],
        };
      });
  }

  private async flush(all = false) {
    if (!this.cloudwatch) return;
    for (const { minute, data } of this.pending(all)) {
      try {
        await this.cloudwatch.send(new PutMetricDataCommand({ Namespace: METRICS_NAMESPACE, MetricData: data }));
        this.buckets.delete(minute);
      } catch (err) {
        this.logger.warn(`PutMetricData failed: ${err instanceof Error ? err.message : String(err)}`);
        if (Date.now() - minute > MAX_AGE_MS) this.buckets.delete(minute);
      }
    }
  }
}
