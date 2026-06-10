// X (Twitter) live-broadcast chat — EXPERIMENTAL, owner-only, default OFF.
//
// X exposes no public API for live-broadcast chat. This reader only runs when
// the OWNER opts in (X_ENABLED=1) and supplies their own session cookies plus the
// live broadcast ids (X_BROADCAST_ID_BANKS/ANSEM — the bare id or the full
// x.com/i/broadcasts/<id> URL, refreshed each time the host goes live). It is
// descended from the Periscope API and is inherently
// fragile — so EVERY step is wrapped and any failure degrades the source to
// `unavailable` on a slow retry, never affecting Twitch/Kick or the rest of the app.
// No visitor credentials are ever collected; posting to X chat is never offered.
import { WebSocket } from 'ws';
import type { Hub } from '../hub';
import type { AppConfig } from '../config';
import type { Host, HostCounts } from '../../shared/protocol';
import { fetchJson } from '../lib/http';
import { scoped } from '../lib/log';

const log = scoped('x');
const RETRY_MS = 5 * 60 * 1000;
const SHOW_POLL_MS = 30 * 1000;
// Public web bearer used by x.com when unauthenticated-ish calls are made.
const DEFAULT_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7' +
  'ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// show.json returns a map keyed by broadcast id; total_watching arrives as a
// string. The chat token is NOT here — it comes from live_video_stream/status.
interface ShowResp {
  broadcasts?: Record<
    string,
    { state?: string; total_watching?: string | number; media_key?: string }
  >;
}

const showUrl = (id: string) =>
  `https://api.x.com/1.1/broadcasts/show.json?ids=${encodeURIComponent(id)}`;

// Owners paste either the bare id or the whole x.com/i/broadcasts/<id> URL.
export function parseBroadcastId(raw: string): string {
  const m = raw.trim().match(/broadcasts\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : raw.trim();
}

export function startXSource(hub: Hub, config: AppConfig): () => void {
  if (!config.x.enabled) {
    hub.setStatus('x', 'unavailable');
    return () => {};
  }
  if (!config.x.authToken || !config.x.ct0) {
    log.warn('X_ENABLED=1 but X_AUTH_TOKEN / X_CT0 missing — unavailable');
    hub.setStatus('x', 'unavailable');
    return () => {};
  }

  const bearer = config.x.bearer || DEFAULT_BEARER;
  let stopped = false;
  const sockets = new Set<WebSocket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const viewers: HostCounts = { banks: null, ansem: null };
  const liveByHost: Record<Host, boolean> = { banks: false, ansem: false };
  const chatOk: Record<Host, boolean> = { banks: false, ansem: false };

  function setTimer(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
    return t;
  }

  function refreshStatus() {
    hub.setStatus('x', chatOk.banks || chatOk.ansem ? 'ok' : 'unavailable');
  }

  function xHeaders() {
    return {
      Authorization: 'Bearer ' + bearer,
      Cookie: `auth_token=${config.x.authToken}; ct0=${config.x.ct0}`,
      'x-csrf-token': config.x.ct0,
      'x-twitter-auth-type': 'OAuth2Session',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    };
  }

  async function pollShow(host: Host, broadcastId: string) {
    if (stopped) return;
    try {
      const data = await fetchJson<ShowResp>(showUrl(broadcastId), {
        headers: xHeaders(),
        timeoutMs: 12000,
      });
      if (stopped) return; // stopped mid-poll: skip the stale write + don't reschedule
      const b = data.broadcasts?.[broadcastId];
      if (b && b.state === 'RUNNING') {
        const watching = Number(b.total_watching);
        viewers[host] = Number.isFinite(watching) ? watching : 0;
      } else {
        viewers[host] = 0;
      }
      // per-host: one offline host's poll must not clear the live flag the
      // other (still running) host set
      liveByHost[host] = b?.state === 'RUNNING';
      pushViewers();
    } catch (err) {
      if (stopped) return;
      log.warn(`show.json ${host} failed`, (err as Error).message);
      // leave viewers[host] as-is; chat may still be running
    }
    setTimer(() => pollShow(host, broadcastId), SHOW_POLL_MS);
  }

  function pushViewers() {
    hub.setPlatformViewers(
      'x',
      { banks: viewers.banks, ansem: viewers.ansem },
      liveByHost.banks || liveByHost.ansem,
    );
  }

  async function connectChat(host: Host, broadcastId: string) {
    if (stopped) return;
    try {
      // 1) resolve the broadcast's media_key, then its chat token
      const show = await fetchJson<ShowResp>(showUrl(broadcastId), {
        headers: xHeaders(),
        timeoutMs: 12000,
      });
      const mediaKey = show.broadcasts?.[broadcastId]?.media_key;
      if (!mediaKey) throw new Error('no media_key — broadcast ended or id wrong');

      const status = await fetchJson<{ chatToken?: string }>(
        `https://api.x.com/1.1/live_video_stream/status/${encodeURIComponent(mediaKey)}`,
        { headers: xHeaders(), timeoutMs: 12000 },
      );
      if (!status.chatToken) throw new Error('no chatToken');

      // 2) exchange it for a chat access endpoint (Periscope-descended)
      const access = await fetchJson<{ endpoint?: string; access_token?: string; room_id?: string }>(
        'https://proxsee.pscp.tv/api/v2/accessChatPublic',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_token: status.chatToken }),
          timeoutMs: 12000,
        },
      );
      if (!access.endpoint || !access.access_token) throw new Error('no chat endpoint');
      if (stopped) return; // stopped during the handshake: don't open an untracked socket

      // 3) connect the chat websocket: authenticate, then join the room —
      // without the join the socket stays open but silent
      const wsUrl = access.endpoint.replace(/^https?:/, 'wss:') + '/chatapi/v1/chatnow';
      const ws = new WebSocket(wsUrl);
      sockets.add(ws);
      ws.on('open', () => {
        ws.send(JSON.stringify({ payload: JSON.stringify({ access_token: access.access_token }), kind: 3 }));
        ws.send(
          JSON.stringify({
            payload: JSON.stringify({ body: JSON.stringify({ room: access.room_id || broadcastId }), kind: 1 }),
            kind: 2,
          }),
        );
        log(`chat ${host} connected`);
        chatOk[host] = true;
        refreshStatus();
      });
      ws.on('message', (raw) => handleChat(host, raw.toString('utf8')));
      ws.on('close', () => {
        sockets.delete(ws);
        chatOk[host] = false;
        refreshStatus();
        if (!stopped) setTimer(() => connectChat(host, broadcastId), RETRY_MS);
      });
      ws.on('error', () => {
        try {
          ws.close();
        } catch {
          /* close handler retries */
        }
      });
    } catch (err) {
      if (stopped) return;
      log.warn(`chat ${host} unavailable`, (err as Error).message);
      chatOk[host] = false;
      refreshStatus();
      setTimer(() => connectChat(host, broadcastId), RETRY_MS);
    }
  }

  function handleChat(host: Host, text: string) {
    try {
      const env = JSON.parse(text) as { payload?: string; kind?: number };
      if (env.kind !== 1 || !env.payload) return;
      const payload = JSON.parse(env.payload) as {
        body?: string;
        sender?: { username?: string; display_name?: string };
      };
      if (!payload.body) return;
      // user fields live in the inner body, not the envelope payload
      const body = JSON.parse(payload.body) as {
        body?: string;
        username?: string;
        displayName?: string;
        uuid?: string;
      };
      if (!body.body) return; // hearts / joins / presence carry no text
      const user =
        body.displayName ||
        body.username ||
        payload.sender?.display_name ||
        payload.sender?.username ||
        'x-user';
      cbMessage(host, user, body.body, body.uuid);
    } catch {
      /* ignore malformed frames */
    }
  }

  function cbMessage(host: Host, user: string, body: string, uuid?: string) {
    hub.ingestMessage({
      id: 'x:' + (uuid || Date.now() + '-' + Math.random().toString(36).slice(2, 8)),
      platform: 'x',
      host,
      user,
      text: body,
      ts: Date.now(),
    });
  }

  // boot per host (needs an explicit broadcast id — no fragile handle auto-resolve)
  hub.setStatus('x', 'unavailable');
  let anyConfigured = false;
  for (const host of ['banks', 'ansem'] as Host[]) {
    const id = parseBroadcastId(config.x.broadcastIds[host]);
    if (!id) continue;
    anyConfigured = true;
    void pollShow(host, id);
    void connectChat(host, id);
  }
  if (!anyConfigured) {
    log.warn('X enabled but no X_BROADCAST_ID_BANKS/ANSEM set — unavailable');
  }

  return () => {
    stopped = true;
    for (const t of timers) clearTimeout(t);
    timers.clear();
    for (const ws of sockets) {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    }
    sockets.clear();
  };
}
