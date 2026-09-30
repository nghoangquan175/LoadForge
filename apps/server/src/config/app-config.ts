export type DataSourceMode = 'auto' | 'aws' | 'mock';

export interface AppConfig {
  port: number;
  corsOrigins: string[];
  /** auto: use AWS when ASG_NAME is set and reachable, otherwise mock */
  dataSource: DataSourceMode;
  region: string;
  asgName?: string;
  /** e.g. app/loadforge-alb/0123456789abcdef, enables request/latency/5xx metrics */
  albArnSuffix?: string;
  /** used when the ASG has no target tracking policy */
  targetCpu: number;
  awsPollMs: number;
  mockTickMs: number;
  /** publish this server's request metrics to CloudWatch (on AWS only) */
  publishMetrics: boolean;
  /** EC2 instance id, set by the deploy script */
  instanceId?: string;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mode = env.DATA_SOURCE ?? 'auto';
  if (mode !== 'auto' && mode !== 'aws' && mode !== 'mock') {
    throw new Error(`DATA_SOURCE must be auto, aws or mock (got "${mode}")`);
  }
  return {
    port: int(env.PORT, 4000),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3100')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    dataSource: mode,
    region: env.AWS_REGION ?? 'ap-southeast-1',
    asgName: env.ASG_NAME || undefined,
    albArnSuffix: env.ALB_ARN_SUFFIX || undefined,
    targetCpu: int(env.TARGET_CPU, 60),
    awsPollMs: int(env.AWS_POLL_MS, 15_000),
    mockTickMs: int(env.MOCK_TICK_MS, 2_000),
    publishMetrics: env.PUBLISH_METRICS === 'true',
    instanceId: env.INSTANCE_ID || undefined,
  };
}
