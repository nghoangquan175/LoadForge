import { cpus } from 'node:os';
import { CloudWatchClient, PutMetricDataCommand, type MetricDatum } from '@aws-sdk/client-cloudwatch';
import { Logger } from '@nestjs/common';
import { METRICS_NAMESPACE } from '../request-stats/request-stats.service.js';

/** The danger alarm (infra/compute.tf) needs 3 points of 10 s. */
const SAMPLE_EVERY_MS = 10_000;

export interface CpuTimes {
  idle: number;
  total: number;
}

/** Whole-machine CPU time so far, all cores. /proc/stat is not namespaced, so this is the host even inside Docker. */
export function cpuTimes(cores = cpus()): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const { times } of cores) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

/** Busy % between two readings. */
export function cpuPercent(prev: CpuTimes, next: CpuTimes): number {
  const total = next.total - prev.total;
  if (total <= 0) return 0;
  const busy = total - (next.idle - prev.idle);
  return Math.min(100, Math.max(0, (busy / total) * 100));
}

/** One 10 s CPU point, stored at 1 s resolution so an alarm can use a 10 s period. */
export function cpuDatum(asgName: string, percent: number, at = new Date()): MetricDatum {
  return {
    MetricName: 'CPUUtilization',
    // Group only, no InstanceId: every server writes to the same series and
    // its Average is the group average the alarm watches.
    Dimensions: [{ Name: 'AutoScalingGroupName', Value: asgName }],
    Timestamp: at,
    Value: Math.round(percent * 10) / 10,
    Unit: 'Percent',
    StorageResolution: 1,
  };
}

/**
 * Publishes this server's CPU every 10 s for the danger alarm. EC2's own
 * CPUUtilization comes once a minute at best, too slow to react in 30 s.
 * Runs in the Node primary: one publisher per server, not one per worker.
 * Returns a function that stops it.
 */
export function startCpuPublisher(region: string, asgName: string): () => void {
  const logger = new Logger('CpuPublisher');
  const cloudwatch = new CloudWatchClient({ region });
  let prev = cpuTimes();

  const timer = setInterval(() => {
    const next = cpuTimes();
    const datum = cpuDatum(asgName, cpuPercent(prev, next));
    prev = next;
    cloudwatch
      .send(new PutMetricDataCommand({ Namespace: METRICS_NAMESPACE, MetricData: [datum] }))
      .catch((err: unknown) => logger.warn(`PutMetricData failed: ${err instanceof Error ? err.message : String(err)}`));
  }, SAMPLE_EVERY_MS);
  timer.unref();

  logger.log(`publishing CPU every ${SAMPLE_EVERY_MS / 1000} s to CloudWatch ${METRICS_NAMESPACE} for ${asgName}`);
  return () => clearInterval(timer);
}
