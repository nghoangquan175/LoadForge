import {
  type Activity,
  AutoScalingClient,
  DescribeAutoScalingGroupsCommand,
  DescribePoliciesCommand,
  DescribeScalingActivitiesCommand,
} from '@aws-sdk/client-auto-scaling';
import {
  CloudWatchClient,
  GetMetricDataCommand,
  type MetricDataQuery,
  type MetricDataResult,
} from '@aws-sdk/client-cloudwatch';
import { DescribeInstancesCommand, EC2Client, type Instance } from '@aws-sdk/client-ec2';
import type { AppConfig } from '../config/app-config.js';
import type {
  ActivityKind,
  ActivityStatus,
  DashboardSnapshot,
  Ec2Instance,
  InstanceLifecycle,
  InstanceMetrics,
  MetricPoint,
  ScalingActivity,
} from '../common/types.js';
import { METRICS_NAMESPACE } from '../request-stats/request-stats.service.js';
import type { SnapshotProvider } from './snapshot-provider.js';

const PERIOD_SEC = 60;
const WINDOW_MIN = 60;

/** Pending:Wait, Terminating:Proceed, ... -> the five states the dashboard knows. */
export function toLifecycle(state: string | undefined): InstanceLifecycle {
  if (!state || state.startsWith('Pending')) return 'Pending';
  if (state === 'InService') return 'InService';
  if (state === 'Terminated') return 'Terminated';
  if (state.startsWith('Terminating') || state.startsWith('Detach')) return 'Terminating';
  return 'Standby';
}

export function toActivity(a: Activity): ScalingActivity {
  const description = a.Description ?? '';
  const kind: ActivityKind = /^launching/i.test(description)
    ? 'LAUNCH'
    : /^terminating/i.test(description)
      ? 'TERMINATE'
      : 'INFO';
  const status: ActivityStatus =
    a.StatusCode === 'Successful'
      ? 'Successful'
      : a.StatusCode === 'Failed' || a.StatusCode === 'Cancelled'
        ? 'Failed'
        : 'InProgress';
  return {
    id: a.ActivityId ?? `${a.StartTime?.getTime()}`,
    time: (a.EndTime ?? a.StartTime ?? new Date()).getTime(),
    kind,
    status,
    instanceId: /\bi-[0-9a-f]{8,17}\b/.exec(description)?.[0],
    description,
    cause: a.Cause,
  };
}

/**
 * CloudWatch sends no datapoint for a minute with zero requests or zero
 * errors. For count metrics that gap means 0, so fill it in over the window.
 */
export function fillMissing(points: MetricPoint[], start: number, end: number, periodSec: number): MetricPoint[] {
  const step = periodSec * 1000;
  const byPeriod = new Map(points.map((p) => [Math.round(p.t / step) * step, p.v]));
  const filled: MetricPoint[] = [];
  // Only whole periods: the current one is still filling up.
  for (let t = Math.ceil(start / step) * step; t + step <= end; t += step) {
    filled.push({ t, v: byPeriod.get(t) ?? 0 });
  }
  return filled;
}

function toPoints(result: MetricDataResult | undefined, scale = 1): MetricPoint[] {
  const ts = result?.Timestamps ?? [];
  const vs = result?.Values ?? [];
  return ts
    .map((t, i) => ({ t: t.getTime(), v: Math.round((vs[i] ?? 0) * scale * 10) / 10 }))
    .sort((a, b) => a.t - b.t);
}

/** Reads a real Auto Scaling group, its instances and CloudWatch metrics. */
export class AwsSnapshotProvider implements SnapshotProvider {
  readonly source = 'aws' as const;
  private readonly autoscaling: AutoScalingClient;
  private readonly cloudwatch: CloudWatchClient;
  private readonly ec2: EC2Client;

  constructor(private readonly config: AppConfig) {
    if (!config.asgName) throw new Error('ASG_NAME is required for the AWS data source');
    const region = config.region;
    this.autoscaling = new AutoScalingClient({ region });
    this.cloudwatch = new CloudWatchClient({ region });
    this.ec2 = new EC2Client({ region });
  }

  async fetch(): Promise<DashboardSnapshot> {
    const asgName = this.config.asgName!;

    const [groups, activities, policies] = await Promise.all([
      this.autoscaling.send(new DescribeAutoScalingGroupsCommand({ AutoScalingGroupNames: [asgName] })),
      this.autoscaling.send(new DescribeScalingActivitiesCommand({ AutoScalingGroupName: asgName, MaxRecords: 30 })),
      this.autoscaling.send(new DescribePoliciesCommand({ AutoScalingGroupName: asgName })),
    ]);

    const group = groups.AutoScalingGroups?.[0];
    if (!group) throw new Error(`Auto Scaling group "${asgName}" not found in ${this.config.region}`);

    const members = group.Instances ?? [];
    const ids = members.map((m) => m.InstanceId).filter((id): id is string => !!id);

    const [details, metrics] = await Promise.all([
      this.describeInstances(ids),
      this.getMetrics(asgName, ids),
    ]);

    const instances: Ec2Instance[] = members.map((m) => {
      const id = m.InstanceId ?? 'unknown';
      const ec2 = details.get(id);
      const cpu = metrics.get(`cpu_${ids.indexOf(id)}`);
      return {
        id,
        type: m.InstanceType ?? ec2?.InstanceType ?? 'unknown',
        az: m.AvailabilityZone ?? 'unknown',
        lifecycle: toLifecycle(m.LifecycleState),
        health: m.HealthStatus === 'Unhealthy' ? 'Unhealthy' : 'Healthy',
        launchedAt: ec2?.LaunchTime?.getTime() ?? Date.now(),
        cpu: cpu?.Values?.length ? Math.round(cpu.Values[0] * 10) / 10 : null,
        privateIp: ec2?.PrivateIpAddress,
      };
    });

    const count = (l: InstanceLifecycle) => instances.filter((i) => i.lifecycle === l).length;
    const targetCpu =
      policies.ScalingPolicies?.find((p) => p.TargetTrackingConfiguration)?.TargetTrackingConfiguration
        ?.TargetValue ?? this.config.targetCpu;

    const now = Date.now();
    const windowStart = now - WINDOW_MIN * 60_000;
    const countSeries = (id: string) =>
      this.config.albArnSuffix ? fillMissing(toPoints(metrics.get(id)), windowStart, now, PERIOD_SEC) : [];

    const byInstance: Record<string, InstanceMetrics> = {};
    ids.forEach((id, i) => {
      // Zeros only from launch on, not for minutes before the server existed.
      const since = Math.max(windowStart, details.get(id)?.LaunchTime?.getTime() ?? windowStart);
      byInstance[id] = {
        cpu: toPoints(metrics.get(`cpu_${i}`)),
        requests: fillMissing(toPoints(metrics.get(`req_${i}`)), since, now, PERIOD_SEC),
        latencyMs: toPoints(metrics.get(`lat_${i}`)),
        errors5xx: fillMissing(toPoints(metrics.get(`err_${i}`)), since, now, PERIOD_SEC),
      };
    });

    return {
      ts: now,
      source: 'aws',
      region: this.config.region,
      asg: {
        name: asgName,
        min: group.MinSize ?? 0,
        max: group.MaxSize ?? 0,
        desired: group.DesiredCapacity ?? 0,
        inService: count('InService'),
        pending: count('Pending'),
        terminating: count('Terminating'),
      },
      targetCpu,
      instances,
      metrics: {
        periodSec: PERIOD_SEC,
        cpu: toPoints(metrics.get('cpu')),
        requests: countSeries('req'),
        latencyMs: toPoints(metrics.get('lat'), 1000),
        errors5xx: countSeries('err'),
        byInstance,
      },
      activities: (activities.Activities ?? []).map(toActivity).sort((a, b) => b.time - a.time),
    };
  }

  private async describeInstances(ids: string[]): Promise<Map<string, Instance>> {
    const map = new Map<string, Instance>();
    if (!ids.length) return map;
    const res = await this.ec2.send(new DescribeInstancesCommand({ InstanceIds: ids }));
    for (const r of res.Reservations ?? []) {
      for (const inst of r.Instances ?? []) {
        if (inst.InstanceId) map.set(inst.InstanceId, inst);
      }
    }
    return map;
  }

  private async getMetrics(asgName: string, ids: string[]): Promise<Map<string, MetricDataResult>> {
    const stat = (id: string, namespace: string, metric: string, dims: Record<string, string>, statName: string): MetricDataQuery => ({
      Id: id,
      MetricStat: {
        Metric: {
          Namespace: namespace,
          MetricName: metric,
          Dimensions: Object.entries(dims).map(([Name, Value]) => ({ Name, Value })),
        },
        Period: PERIOD_SEC,
        Stat: statName,
      },
    });

    const queries: MetricDataQuery[] = [
      stat('cpu', 'AWS/EC2', 'CPUUtilization', { AutoScalingGroupName: asgName }, 'Average'),
      ...ids.flatMap((id, i) => [
        stat(`cpu_${i}`, 'AWS/EC2', 'CPUUtilization', { InstanceId: id }, 'Average'),
        // Published by each API server itself (RequestStatsService).
        stat(`req_${i}`, METRICS_NAMESPACE, 'RequestCount', { InstanceId: id }, 'Sum'),
        stat(`lat_${i}`, METRICS_NAMESPACE, 'Latency', { InstanceId: id }, 'Average'),
        stat(`err_${i}`, METRICS_NAMESPACE, 'Http5xxCount', { InstanceId: id }, 'Sum'),
      ]),
    ];
    const alb = this.config.albArnSuffix;
    if (alb) {
      queries.push(
        stat('req', 'AWS/ApplicationELB', 'RequestCount', { LoadBalancer: alb }, 'Sum'),
        stat('lat', 'AWS/ApplicationELB', 'TargetResponseTime', { LoadBalancer: alb }, 'Average'),
        stat('err', 'AWS/ApplicationELB', 'HTTPCode_Target_5XX_Count', { LoadBalancer: alb }, 'Sum'),
      );
    }

    const end = new Date();
    const start = new Date(end.getTime() - WINDOW_MIN * 60_000);
    const res = await this.cloudwatch.send(
      new GetMetricDataCommand({
        MetricDataQueries: queries,
        StartTime: start,
        EndTime: end,
        // newest first, so per-instance CPU is Values[0]
        ScanBy: 'TimestampDescending',
      }),
    );

    return new Map((res.MetricDataResults ?? []).map((r) => [r.Id ?? '', r]));
  }
}
