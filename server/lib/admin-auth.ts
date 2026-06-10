// Admin session auth: HMAC-signed stateless cookie + gate state + login limiter.
// Dependency-free (node:crypto only). Used by server/index.ts to gate Settings.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE = 'mb_admin';

const b64url = (s: string) => Buffer.from(s).toString('base64url');

// cookie value = base64url(JSON{exp}) + "." + base64url(HMAC_SHA256(payload, secret))
export function signSession(secret: string, ttlMs: number): string {
  const payload = b64url(JSON.stringify({ exp: Date.now() + ttlMs }));
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(secret: string, value: string | undefined): boolean {
  if (!value) return false;
  const dot = value.indexOf('.');
  if (dot < 1) return false;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number };
    return typeof obj.exp === 'number' && obj.exp > Date.now();
  } catch {
    return false;
  }
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

// constant-time string compare via fixed-length digests (no length leak)
export function constantTimeEqual(a: string, b: string): boolean {
  const ah = createHash('sha256').update(a).digest();
  const bh = createHash('sha256').update(b).digest();
  return timingSafeEqual(ah, bh);
}

export type GateState = 'open' | 'required' | 'disabled';
export function gateState(opts: { configured: boolean; dev: boolean }): GateState {
  if (opts.configured) return 'required';
  return opts.dev ? 'open' : 'disabled';
}

export interface LoginLimiter {
  check(key: string): { locked: boolean; retryAfterMs: number };
  fail(key: string): void;
  reset(key: string): void;
}

export function createLoginLimiter(maxFails = 5, lockMs = 15 * 60 * 1000): LoginLimiter {
  const MAX_KEYS = 5000;
  const map = new Map<string, { fails: number; lockUntil: number }>();
  return {
    check(key) {
      const e = map.get(key);
      if (!e) return { locked: false, retryAfterMs: 0 };
      if (e.lockUntil > Date.now()) return { locked: true, retryAfterMs: e.lockUntil - Date.now() };
      // a real lock (not a still-accumulating count) has expired -> reset the window
      if (e.lockUntil !== 0) map.delete(key);
      return { locked: false, retryAfterMs: 0 };
    },
    fail(key) {
      // memory bound: when the map grows large, shed entries that aren't actively locked
      if (map.size > MAX_KEYS) {
        const now = Date.now();
        for (const [k, v] of map) if (v.lockUntil <= now) map.delete(k);
      }
      const e = map.get(key) ?? { fails: 0, lockUntil: 0 };
      e.fails += 1;
      if (e.fails >= maxFails) e.lockUntil = Date.now() + lockMs;
      map.set(key, e);
    },
    reset(key) {
      map.delete(key);
    },
  };
}

// Ephemeral per-process fallback secret for when admin is enabled but SESSION_SECRET
// is unset. NOTE: regenerated each call/boot, so admin sessions reset on restart.
export function randomSecret(): string {
  return randomBytes(32).toString('hex');
}
