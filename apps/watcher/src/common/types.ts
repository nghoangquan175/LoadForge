// Wire contract between the Watcher and the dashboard.
// Keep in sync with apps/dashboard/src/lib/types.ts.

export type DataSource = 'aws' | 'mock';

export type InstanceLifecycle =
  | 'Pending'
  | 'InService'
  | 'Terminating'
  | 'Terminated'
  | 'Standby';

export type InstanceHealth = 'Healthy' | 'Unhealthy';

export interface Ec2Instance {
  id: string;
  type: string;
  az: string;
  lifecycle: InstanceLifecycle;
  health: InstanceHealth;
  /** epoch ms */
  launchedAt: number;
  /** latest CPUUtilization %, null when CloudWatch has no datapoint yet */
  cpu: number | null;
  privateIp?: string;
}

export interface AsgSummary {
  name: string;
  min: number;
  max: number;
  desired: number;
  inService: number;
  pending: number;
  terminating: number;
}

export interface MetricPoint {
  /** epoch ms */
  t: number;
  v: number;
}

export interface InstanceMetrics {
  /** CPUUtilization, % */
  cpu: MetricPoint[];
  /** requests, per minute */
  requests: MetricPoint[];
  /** response time, ms */
  latencyMs: MetricPoint[];
  /** 5xx responses, per minute */
  errors5xx: MetricPoint[];
}

/**
 * Group level: CPU is the ASG average; requests, latency and 5xx come from
 * the load balancer. byInstance holds the same series for each server
 * (EC2 CPU plus what each API server reports about its own requests).
 */
export interface MetricSeries extends InstanceMetrics {
  /** seconds between points */
  periodSec: number;
  /** keyed by instance id */
  byInstance: Record<string, InstanceMetrics>;
}

export type ActivityKind = 'LAUNCH' | 'TERMINATE' | 'ALARM' | 'INFO';
export type ActivityStatus = 'Successful' | 'InProgress' | 'Failed';

export interface ScalingActivity {
  id: string;
  /** epoch ms */
  time: number;
  kind: ActivityKind;
  status: ActivityStatus;
  instanceId?: string;
  description: string;
  cause?: string;
}

/**
 * One second (or one 15 s step) of one Defender, from its /live route.
 * Same shape as apps/defender/src/live.
 */
export interface LivePoint {
  /** start of the second or step, epoch ms */
  t: number;
  /** whole-machine CPU, % */
  cpu: number;
  /** requests finished in this second or step */
  requests: number;
  /** average response time of those requests, ms */
  latencyMs: number;
  /** 5xx responses in this second or step */
  errors5xx: number;
}

/**
 * `live` stream event, keyed by instance id. The first one after connecting
 * holds everything the Watcher has; later ones only what is new, which may
 * correct points sent before.
 */
export interface LiveUpdate {
  /** one point per second, the last few minutes */
  points: Record<string, LivePoint[]>;
  /** 15 s steps over the last hour, from each Defender's own cache */
  history?: Record<string, LivePoint[]>;
  /**
   * From here on the Watcher has every server's 15 s steps, so a group total
   * or average is right. Before it, a server that is gone may be missing:
   * the dashboard uses CloudWatch there.
   */
  historySince?: number;
}

export interface DashboardSnapshot {
  /** epoch ms */
  ts: number;
  source: DataSource;
  region: string;
  asg: AsgSummary;
  /** target-tracking CPU value the ASG scales on, % */
  targetCpu: number;
  instances: Ec2Instance[];
  metrics: MetricSeries;
  /** newest first */
  activities: ScalingActivity[];
}
