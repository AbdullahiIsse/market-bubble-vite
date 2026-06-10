// Polls Twitch Helix for live status + viewer counts of both host channels.
// Sets the twitch column of the hub's viewer matrix (null when no app keys).
import type { Hub } from '../hub';
import type { AppConfig, Host } from '../config';
import type { HostCounts } from '../../shared/protocol';
import { getTwitchAppToken } from '../lib/app-tokens';
import { fetchJson } from '../lib/http';
import { scoped } from '../lib/log';

const log = scoped('twitch-viewers');

interface HelixStreams {
  data?: { user_login: string; viewer_count: number; type: string }[];
}

export function startTwitchViewerPoller(hub: Hub, config: AppConfig): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function poll() {
    if (stopped) return;
    const token = await getTwitchAppToken(config);
    if (!token) {
      hub.setPlatformViewers('twitch', { banks: null, ansem: null }, false);
    } else {
      try {
        const url =
          'https://api.twitch.tv/helix/streams?user_login=' +
          encodeURIComponent(config.twitchChannels.banks) +
          '&user_login=' +
          encodeURIComponent(config.twitchChannels.ansem);
        const data = await fetchJson<HelixStreams>(url, {
          headers: { 'Client-Id': config.twitch.clientId, Authorization: 'Bearer ' + token },
        });
        const counts: HostCounts = { banks: 0, ansem: 0 }; // queried OK => absent = offline (0)
        let anyLive = false;
        for (const s of data.data || []) {
          const login = s.user_login.toLowerCase();
          for (const host of ['banks', 'ansem'] as Host[]) {
            if (login === config.twitchChannels[host].toLowerCase()) {
              counts[host] = s.viewer_count ?? 0;
              if (s.type === 'live') anyLive = true;
            }
          }
        }
        hub.setPlatformViewers('twitch', counts, anyLive);
      } catch (err) {
        log.warn('poll failed', (err as Error).message);
        hub.setPlatformViewers('twitch', { banks: null, ansem: null }, false);
      }
    }
    if (!stopped) timer = setTimeout(poll, config.viewerPollMs);
  }

  void poll();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
