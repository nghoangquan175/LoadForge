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
  /** how often to read the ASG and CloudWatch (the 60-minute history) */
  awsPollMs: number;
  mockTickMs: number;
  /** how often to read each Defender's /live (the last minutes CloudWatch has not got yet) */
  livePollMs: number;
  /** Defender port serving /live: the Node primary's health port */
  defenderLivePort: number;
  /** Attacker control API base (http://ip:4200), or undefined when no load generator is wired */
  attackerUrl?: string;
  /** bearer token for the Attacker's /control/* */
  attackerToken?: string;
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
    port: int(env.PORT, 4100),
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
    livePollMs: int(env.LIVE_POLL_MS, 1_000),
    defenderLivePort: int(env.DEFENDER_LIVE_PORT, 4001),
    attackerUrl: env.ATTACKER_URL || undefined,
    attackerToken: env.ATTACKER_TOKEN || undefined,
  };
}
