// Cached client-credentials (app) tokens for the viewer pollers. These are
// server-to-server tokens, distinct from per-user OAuth tokens used for sending.
import type { AppConfig } from '../config';
import { fetchJson } from './http';
import { scoped } from './log';

const log = scoped('app-token');

interface Cached {
  token: string;
  expiresAt: number; // epoch ms
}

const cache = new Map<string, Cached>();
// concurrent misses (both pollers waking together) share one fetch
const inFlight = new Map<string, Promise<string | null>>();

function form(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');
}

async function getCached(
  key: string,
  fetcher: () => Promise<{ access_token: string; expires_in: number }>,
): Promise<string | null> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt - now > 60000) return hit.token;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = (async () => {
    try {
      const res = await fetcher();
      cache.set(key, {
        token: res.access_token,
        expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000,
      });
      return res.access_token;
    } catch (err) {
      log.warn(`${key} token fetch failed`, (err as Error).message);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, p);
  return p;
}

// Twitch app access token (client credentials). null if Twitch keys absent.
export async function getTwitchAppToken(config: AppConfig): Promise<string | null> {
  if (!config.twitch.configured) return null;
  return getCached('twitch', () =>
    fetchJson('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({
        client_id: config.twitch.clientId,
        client_secret: config.twitch.clientSecret,
        grant_type: 'client_credentials',
      }),
    }),
  );
}

// Kick app access token (client credentials). null if Kick keys absent.
export async function getKickAppToken(config: AppConfig): Promise<string | null> {
  if (!config.kick.configured) return null;
  return getCached('kick', () =>
    fetchJson('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({
        client_id: config.kick.clientId,
        client_secret: config.kick.clientSecret,
        grant_type: 'client_credentials',
      }),
    }),
  );
}
