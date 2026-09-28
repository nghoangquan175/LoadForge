// Wire contract between server and dashboard.
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

export interface MetricSeries {
  /** seconds between points */
  periodSec: number;
  /** ASG average CPUUtilization, % */
  cpu: MetricPoint[];
  /** load balancer requests, per minute */
  requests: MetricPoint[];
  /** load balancer target response time, ms */
  latencyMs: MetricPoint[];
  /** target 5xx responses, per minute */
  errors5xx: MetricPoint[];
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
