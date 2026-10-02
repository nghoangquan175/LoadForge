/**
 * The Attacker is a load generator for LoadForge: it runs k6 against this
 * project's own `/api/load/*` endpoint so you can watch the Defenders scale.
 *
 * Its one safety rule: the **target is fixed here**, from `ATTACK_TARGET`, and
 * a control request can only choose the rate and duration — never the URL. So
 * the box can only ever load-test the LoadForge system it was deployed for.
 */
export interface AttackerConfig {
  /** control API port */
  port: number;
  /** the only URL k6 will hit; set at deploy time, never from a request */
  target: string;
  /** rate ceiling (requests/s) a request may ask for */
  maxRate: number;
  /** duration ceiling (seconds) a request may ask for */
  maxDurationSec: number;
  /** k6 VU ceiling, so a slow target cannot make k6 allocate without bound */
  maxVus: number;
  /** bearer token the caller must send, or empty to allow any caller the network lets through */
  controlToken: string;
  /** browser origins allowed to drive it (the dashboard) */
  corsOrigins: string[];
  /** path to the k6 binary */
  k6Bin: string;
  /** path to the k6 script */
  script: string;
}

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AttackerConfig {
  const target = env.ATTACK_TARGET ?? 'https://loadforge.quannh.xyz/api/load/cpu?limit=300000';
  // A fixed target is the whole safety model, so it must be a real URL.
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error(`ATTACK_TARGET must be a valid URL (got "${target}")`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`ATTACK_TARGET must be http or https (got "${parsed.protocol}")`);
  }

  return {
    port: int(env.PORT, 4200),
    target,
    maxRate: int(env.MAX_RATE, 1000),
    maxDurationSec: int(env.MAX_DURATION_SEC, 1800),
    maxVus: int(env.MAX_VUS, 800),
    controlToken: env.CONTROL_TOKEN ?? '',
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3100')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    k6Bin: env.K6_BIN ?? 'k6',
    script: env.K6_SCRIPT ?? new URL('../k6/attack.js', import.meta.url).pathname,
  };
}
