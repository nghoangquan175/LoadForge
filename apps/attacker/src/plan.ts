import type { AttackerConfig } from './config.js';

/** What a control request may choose: how hard, and for how long. Never the target. */
export interface AttackPlan {
  /** requests per second */
  rate: number;
  /** seconds */
  durationSec: number;
}

/**
 * Checks a requested plan against the box's ceilings. Returns the plan to run
 * (unchanged if it was in range) or an error message. Nothing is silently
 * clamped: an out-of-range ask is refused, so the caller knows.
 */
export function checkPlan(body: unknown, config: AttackerConfig): { plan: AttackPlan } | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'body must be a JSON object with rate and durationSec' };
  const { rate, durationSec } = body as Record<string, unknown>;

  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    return { error: 'rate must be a number above 0' };
  }
  if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec <= 0) {
    return { error: 'durationSec must be a number above 0' };
  }
  if (rate > config.maxRate) return { error: `rate must be at most ${config.maxRate} (this box's limit)` };
  if (durationSec > config.maxDurationSec) {
    return { error: `durationSec must be at most ${config.maxDurationSec} (this box's limit)` };
  }
  return { plan: { rate: Math.round(rate), durationSec: Math.round(durationSec) } };
}
