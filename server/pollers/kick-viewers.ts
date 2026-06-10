// Polls Kick for live status + viewer counts. Prefers the official channels API
// (app token); falls back to the unofficial web endpoint when no Kick keys.
import type { Hub } from '../hub';
import type { AppConfig, Host } from '../config';
import type { HostCounts } from '../../shared/protocol';
import { getKickAppToken } from '../lib/app-tokens';
import { fetchJson } from '../lib/http';
import { scoped } from '../lib/log';

const log = scoped('kick-viewers');

interface KickOfficialChannels {
  data?: { slug: string; stream?: { is_live?: boolean; viewer_count?: number } }[];
}
interface KickWebChannel {
  livestream?: { is_live?: boolean; viewer_count?: number } | null;
}

export function startKickViewerPoller(hub: Hub, config: AppConfig): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function viaOfficial(token: string): Promise<{ counts: HostCounts; anyLive: boolean } | null> {
    try {
      const url =
        'https://api.kick.com/public/v1/channels?slug=' +
        encodeURIComponent(config.kickSlugs.banks) +
        '&slug=' +
        encodeURIComponent(config.kickSlugs.ansem);
      const data = await fetchJson<KickOfficialChannels>(url, {
        headers: { Authorization: 'Bearer ' + token },
      });
      const counts: HostCounts = { banks: 0, ansem: 0 };
      let anyLive = false;
      for (const c of data.data || []) {
        const slug = (c.slug || '').toLowerCase();
        for (const host of ['banks', 'ansem'] as Host[]) {
          if (slug === config.kickSlugs[host].toLowerCase()) {
            counts[host] = c.stream?.viewer_count ?? 0;
            if (c.stream?.is_live) anyLive = true;
          }
        }
      }
      return { counts, anyLive };
    } catch (err) {
      log.warn('official poll failed, will try web', (err as Error).message);
      return null;
    }
  }

  async function viaWeb(): Promise<{ counts: HostCounts; anyLive: boolean }> {
    const counts: HostCounts = { banks: null, ansem: null };
    let anyLive = false;
    for (const host of ['banks', 'ansem'] as Host[]) {
      try {
        const d = await fetchJson<KickWebChannel>(
          `https://kick.com/api/v2/channels/${encodeURIComponent(config.kickSlugs[host])}`,
          { browserLike: true },
        );
        if (d.livestream && d.livestream.is_live !== false) {
          counts[host] = d.livestream.viewer_count ?? 0;
          anyLive = true;
        } else {
          counts[host] = 0; // resolved channel, just offline
        }
      } catch {
        counts[host] = null; // couldn't reach — unknown
      }
    }
    return { counts, anyLive };
  }

  async function poll() {
    if (stopped) return;
    const token = await getKickAppToken(config);
    let result: { counts: HostCounts; anyLive: boolean } | null = null;
    if (token) result = await viaOfficial(token);
    if (!result) result = await viaWeb();
    if (stopped) return; // a restart/stop during the awaits must not write stale data
    hub.setPlatformViewers('kick', result.counts, result.anyLive);
    if (!stopped) timer = setTimeout(poll, config.viewerPollMs);
  }

  void poll();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
