import { createHmac, timingSafeEqual } from 'node:crypto';

// Single-operator login for the dashboard. Credentials come from env:
//   DASHBOARD_USER, DASHBOARD_PASSWORD, AUTH_SECRET (signs the session cookie)
// With no password set, auth is off in dev and every page is blocked in production.

export const SESSION_COOKIE = 'lf_session';
export const SESSION_TTL_SEC = 60 * 60 * 12;

export type AuthMode =
  | { mode: 'disabled' }
  | { mode: 'misconfigured' }
  | { mode: 'enabled'; user: string; password: string; secret: string };

export function authMode(): AuthMode {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    return process.env.NODE_ENV === 'production' ? { mode: 'misconfigured' } : { mode: 'disabled' };
  }
  return {
    mode: 'enabled',
    user: process.env.DASHBOARD_USER || 'admin',
    password,
    secret: process.env.AUTH_SECRET || password,
  };
}

const hmac = (secret: string, value: string) => createHmac('sha256', secret).update(value).digest();

/** Constant-time compare of two strings of any length. */
function safeEqual(a: string, b: string, secret: string): boolean {
  return timingSafeEqual(hmac(secret, a), hmac(secret, b));
}

export function checkCredentials(auth: Extract<AuthMode, { mode: 'enabled' }>, user: string, password: string) {
  // Evaluate both so a wrong user takes as long as a wrong password.
  const userOk = safeEqual(user, auth.user, auth.secret);
  const passOk = safeEqual(password, auth.password, auth.secret);
  return userOk && passOk;
}

/** `<base64url(user:exp)>.<base64url(hmac)>` */
export function createSession(secret: string, user: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + SESSION_TTL_SEC;
  const payload = Buffer.from(`${user}:${exp}`).toString('base64url');
  return `${payload}.${hmac(secret, payload).toString('base64url')}`;
}

export function verifySession(secret: string, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = hmac(secret, payload);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const exp = Number(Buffer.from(payload, 'base64url').toString().split(':').pop());
  return Number.isFinite(exp) && exp * 1000 > now;
}

/** Only same-site paths, never `//evil.com`. */
export function safeNext(next: unknown): string {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

/** Absolute URL as the browser sees it (the ALB terminates TLS). */
export function publicUrl(req: Request, path: string): URL {
  const url = new URL(req.url);
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0] ?? url.protocol.slice(0, -1);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
  // Rebuild from scratch: the URL `host` setter keeps the old port.
  return new URL(path, `${proto}://${host}`);
}
