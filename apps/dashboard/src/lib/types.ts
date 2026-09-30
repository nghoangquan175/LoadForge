// Wire contract between server and dashboard.
// Keep in sync with apps/server/src/common/types.ts.

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
