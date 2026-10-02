import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

/** What the dashboard sees about the Attacker, whether or not it is configured. */
export interface AttackState {
  /** false when no Attacker box is wired up (ATTACKER_URL unset) */
  configured: boolean;
  /** reachable right now */
  online: boolean;
  /** 'idle' | 'running' from the Attacker, or 'unknown' when offline */
  state: string;
  target?: string;
  plan?: { rate: number; durationSec: number };
  startedAt?: number;
  endsAt?: number;
  lastResult?: string | null;
}

const TIMEOUT_MS = 4000;

/**
 * Proxies the dashboard's load-test controls to the Attacker box (apps/attacker),
 * attaching the control token here so it never reaches the browser, and so an
 * HTTPS dashboard is not blocked calling the Attacker's plain-HTTP control port.
 */
@Injectable()
export class AttackService {
  private readonly logger = new Logger(AttackService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get configured() {
    return !!this.config.attackerUrl;
  }

  async status(): Promise<AttackState> {
    if (!this.config.attackerUrl) return { configured: false, online: false, state: 'unknown' };
    try {
      return this.toState(await this.call('GET', '/control/status'));
    } catch {
      return { configured: true, online: false, state: 'unknown' };
    }
  }

  /** start | update | stop, forwarded to the Attacker. Returns its new status. */
  async control(action: 'start' | 'update' | 'stop', plan?: unknown): Promise<AttackState> {
    if (!this.config.attackerUrl) throw new Error('no Attacker is configured (ATTACKER_URL unset)');
    return this.toState(await this.call('POST', `/control/${action}`, plan));
  }

  /** The Attacker's status JSON, mapped to the dashboard's shape. */
  private toState(body: Record<string, unknown>): AttackState {
    return {
      configured: true,
      online: true,
      state: typeof body.state === 'string' ? body.state : 'unknown',
      target: body.target as string | undefined,
      plan: body.plan as AttackState['plan'],
      startedAt: body.startedAt as number | undefined,
      endsAt: body.endsAt as number | undefined,
      lastResult: body.lastResult as string | null | undefined,
    };
  }

  private async call(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.config.attackerUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.attackerToken ? { Authorization: `Bearer ${this.config.attackerToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new AttackError((json.error as string) ?? `attacker returned HTTP ${res.status}`, res.status);
    }
    return json;
  }
}

/** Carries the Attacker's own status code (e.g. 400 for a rate over its cap) so the controller can relay it. */
export class AttackError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
