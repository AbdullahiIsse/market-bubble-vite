// Fetches one profile picture per host at boot. Each host has a preferred
// source — banks: Twitch, ansem: Kick — and the other platform is the
// fallback, so a failed preferred fetch still shows a real face. Sources:
// Twitch Helix (app keys), the official Kick API (app keys; Cloudflare-proof),
// then Kick's keyless web endpoint (often 403s server-side, kept as last
// resort). Fail-soft everywhere: any failure just leaves the client's letter
// fallback. Boot-only by design — a server restart picks up new pictures. (If
// live refresh is ever wanted, re-run this on a long timer and rebroadcast.)
import type { AppConfig } from '../config';
import type { Host, HostAvatars } from '../../shared/protocol';
import { HOSTS } from '../../shared/meta';
import { getKickAppToken, getTwitchAppToken } from './app-tokens';
import { fetchJson } from './http';
import { scoped } from './log';

const log = scoped('avatars');
// short so an offline boot (tests spawn servers repeatedly) fails fast
const TIMEOUT_MS = 4000;

const AVATAR_PREFERENCE: Record<Host, 'twitch' | 'kick'> = {
  banks: 'twitch',
  ansem: 'kick',
};

interface HelixUsers {
  data?: { login?: string; profile_image_url?: string }[];
}
interface KickOfficialChannels {
  data?: { slug?: string; broadcaster_user_id?: number }[];
}
interface KickOfficialUsers {
  data?: { user_id?: number; profile_picture?: string | null }[];
}
interface KickWebChannel {
  user?: { profile_pic?: string | null } | null;
}

export async function fetchHostAvatars(config: AppConfig): Promise<HostAvatars> {
  const twitchPics: HostAvatars = {};
  const kickPics: HostAvatars = {};

  // ── Twitch: both hosts in one Helix call (300x300 profile_image_url) ──
  if (config.twitch.configured) {
    try {
      const token = await getTwitchAppToken(config);
      if (token) {
        const url =
          'https://api.twitch.tv/helix/users?login=' +
          encodeURIComponent(config.twitchChannels.banks) +
          '&login=' +
          encodeURIComponent(config.twitchChannels.ansem);
        const data = await fetchJson<HelixUsers>(url, {
          headers: { 'Client-Id': config.twitch.clientId, Authorization: 'Bearer ' + token },
          timeoutMs: TIMEOUT_MS,
        });
        for (const u of data.data || []) {
          const login = (u.login || '').toLowerCase();
          for (const host of HOSTS) {
            if (login === config.twitchChannels[host].toLowerCase() && u.profile_image_url) {
              twitchPics[host] = u.profile_image_url;
            }
          }
        }
      }
    } catch (err) {
      log.warn('twitch avatar fetch failed', (err as Error).message);
    }
  }

  // ── Kick official API (app keys): channels → broadcaster ids → user pics ──
  if (config.kick.configured) {
    try {
      const token = await getKickAppToken(config);
      if (token) {
        const auth = { Authorization: 'Bearer ' + token };
        const channels = await fetchJson<KickOfficialChannels>(
          'https://api.kick.com/public/v1/channels?slug=' +
            encodeURIComponent(config.kickSlugs.banks) +
            '&slug=' +
            encodeURIComponent(config.kickSlugs.ansem),
          { headers: auth, timeoutMs: TIMEOUT_MS },
        );
        const idToHost = new Map<number, Host>();
        for (const c of channels.data || []) {
          const slug = (c.slug || '').toLowerCase();
          for (const host of HOSTS) {
            if (
              slug === config.kickSlugs[host].toLowerCase() &&
              typeof c.broadcaster_user_id === 'number'
            ) {
              idToHost.set(c.broadcaster_user_id, host);
            }
          }
        }
        if (idToHost.size > 0) {
          const users = await fetchJson<KickOfficialUsers>(
            'https://api.kick.com/public/v1/users?' +
              [...idToHost.keys()].map((id) => 'id=' + id).join('&'),
            { headers: auth, timeoutMs: TIMEOUT_MS },
          );
          for (const u of users.data || []) {
            const host = typeof u.user_id === 'number' ? idToHost.get(u.user_id) : undefined;
            if (host && u.profile_picture) kickPics[host] = u.profile_picture;
          }
        }
      }
    } catch (err) {
      log.warn('kick official avatar fetch failed', (err as Error).message);
    }
  }

  // ── Kick web endpoint, last resort per host whose Kick picture is still
  // missing and actually needed: Kick-preferred, or covering a failed Twitch
  // fetch for a Twitch-preferred host (no keys needed) ──
  for (const host of HOSTS) {
    if (kickPics[host]) continue;
    if (AVATAR_PREFERENCE[host] === 'twitch' && twitchPics[host]) continue;
    try {
      const d = await fetchJson<KickWebChannel>(
        `https://kick.com/api/v2/channels/${encodeURIComponent(config.kickSlugs[host])}`,
        { browserLike: true, timeoutMs: TIMEOUT_MS },
      );
      if (d.user?.profile_pic) kickPics[host] = d.user.profile_pic;
    } catch (err) {
      log.warn(`kick avatar fetch failed (${host})`, (err as Error).message);
    }
  }

  // ── Resolve per host: preferred source, else the other, else letter fallback ──
  const avatars: HostAvatars = {};
  for (const host of HOSTS) {
    const pic =
      AVATAR_PREFERENCE[host] === 'kick'
        ? (kickPics[host] ?? twitchPics[host])
        : (twitchPics[host] ?? kickPics[host]);
    if (pic) avatars[host] = pic;
  }

  const got = (Object.keys(avatars) as Host[]).join(',') || 'none';
  log(`host avatars resolved: ${got}`);
  return avatars;
}
