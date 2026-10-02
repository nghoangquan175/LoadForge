export interface AppConfig {
  port: number;
  corsOrigins: string[];
  /** where request metrics are published */
  region: string;
  /** publish this server's request metrics to CloudWatch (on AWS only) */
  publishMetrics: boolean;
  /** EC2 instance id, set by the deploy script */
  instanceId?: string;
  /** Auto Scaling group this server is in; enables the 10 s CPU metric for the danger alarm */
  asgName?: string;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: int(env.PORT, 4000),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3100')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    region: env.AWS_REGION ?? 'ap-southeast-1',
    publishMetrics: env.PUBLISH_METRICS === 'true',
    instanceId: env.INSTANCE_ID || undefined,
    asgName: env.ASG_NAME || undefined,
  };
}
