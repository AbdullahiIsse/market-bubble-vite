// Kick chat reader. Kick has no official websocket for reading chat yet, so we
// use the same undocumented Pusher feed the maintained community libraries use.
// Chatroom ids are resolved from the public channel endpoint (Cloudflare-fronted)
// with an env override fallback. Everything fails soft to `unavailable`.
import { WebSocket } from 'ws';
import type { Host } from '../../shared/protocol';
import type { AdapterCallbacks, SourceAdapter } from './types';
import type { AppConfig } from '../config';
import { fetchJson } from '../lib/http';
import { createBackoff } from '../lib/backoff';
import { scoped } from '../lib/log';

const log = scoped('kick');
const RERESOLVE_MS = 5 * 60 * 1000;

interface KickChannelResp {
  chatroom?: { id: number };
}

function stripEmotes(s: string): string {
  return s.replace(/\[emote:\d+:([^\]]*)\]/g, '$1');
}

async function resolveChatroomId(slug: string): Promise<string | null> {
  try {
    const data = await fetchJson<KickChannelResp>(
      `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
      { browserLike: true, timeoutMs: 12000 },
    );
    const id = data.chatroom?.id;
    return id ? String(id) : null;
  } catch (err) {
    log.warn(`resolve ${slug} failed`, (err as Error).message);
    return null;
  }
}

export function createKickPusherAdapter(config: AppConfig, cb: AdapterCallbacks): SourceAdapter {
  const wsUrl =
    `wss://ws-${config.kickPusher.cluster}.pusher.com/app/${config.kickPusher.key}` +
    `?protocol=7&client=js&version=8.4.0&flash=false`;

  let ws: WebSocket | null = null; // the *current* socket; stale ones must not act
  let stopped = false;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let reresolveTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const backoff = createBackoff(1000, 30000);

  // chatroomId -> host
  let chatroomToHost = new Map<string, Host>();

  async function resolveAll(): Promise<boolean> {
    const map = new Map<string, Host>();
    for (const host of ['banks', 'ansem'] as Host[]) {
      const override = config.kickChatroomIds[host];
      const id = override || (await resolveChatroomId(config.kickSlugs[host]));
      if (id) map.set(id, host);
    }
    chatroomToHost = map;
    return map.size > 0;
  }

  function clearTimers() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
  }

  function scheduleReconnect() {
    if (stopped) return;
    cb.onStatus('reconnecting');
    reconnectTimer = setTimeout(connect, backoff.next());
  }

  function connect() {
    if (stopped) return;
    if (chatroomToHost.size === 0) {
      cb.onStatus('unavailable');
      if (!reresolveTimer) {
        reresolveTimer = setTimeout(async () => {
          reresolveTimer = null;
          if (await resolveAll()) connect();
          else scheduleSlowReresolve();
        }, RERESOLVE_MS);
      }
      return;
    }

    const sock = new WebSocket(wsUrl);
    ws = sock;

    sock.on('message', (raw) => {
      if (sock !== ws) return; // stale socket
      let env: { event?: string; data?: unknown; channel?: string };
      try {
        env = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }
      handleEnvelope(env);
    });

    sock.on('close', () => {
      if (sock !== ws) return; // a stale socket closing must not reconnect
      clearTimers();
      scheduleReconnect();
    });

    sock.on('error', (err) => {
      log.warn('socket error', (err as Error).message);
      try {
        sock.close(); // close *this* socket, never a newer one
      } catch {
        /* close handler reconnects */
      }
    });
  }

  function scheduleSlowReresolve() {
    if (stopped || reresolveTimer) return;
    reresolveTimer = setTimeout(async () => {
      reresolveTimer = null;
      if (await resolveAll()) connect();
      else scheduleSlowReresolve();
    }, RERESOLVE_MS);
  }

  function handleEnvelope(env: { event?: string; data?: unknown; channel?: string }) {
    const event = env.event || '';
    // pusher control frames carry data as an object or JSON string
    if (event === 'pusher:connection_established') {
      const data = parseMaybe(env.data) as { activity_timeout?: number } | null;
      const timeout = (data?.activity_timeout ?? 120) * 1000;
      for (const id of chatroomToHost.keys()) {
        ws?.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${id}.v2` } }));
      }
      backoff.reset();
      cb.onStatus('ok');
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        try {
          ws?.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
        } catch {
          /* close handler will reconnect */
        }
      }, Math.max(30000, timeout - 30000));
      return;
    }
    if (event === 'pusher:ping') {
      ws?.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
      return;
    }
    if (event === 'App\\Events\\ChatMessageEvent') {
      const d = parseMaybe(env.data) as
        | { id?: string; content?: string; created_at?: string; chatroom_id?: number; sender?: { username?: string } }
        | null;
      if (!d) return;
      const host = chatroomToHost.get(String(d.chatroom_id));
      if (!host) return;
      const user = d.sender?.username || 'unknown';
      const id = d.id || 'kick-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      const ts = d.created_at ? Date.parse(d.created_at) || Date.now() : Date.now();
      cb.onMessage({
        id: 'kick:' + id,
        platform: 'kick',
        host,
        user,
        text: stripEmotes(d.content || ''),
        ts,
      });
      return;
    }
    if (event === 'App\\Events\\MessageDeletedEvent') {
      const d = parseMaybe(env.data) as { message?: { id?: string } } | null;
      if (d?.message?.id) cb.onRemove?.({ ids: ['kick:' + d.message.id] });
      return;
    }
    if (event === 'App\\Events\\UserBannedEvent') {
      const d = parseMaybe(env.data) as { user?: { username?: string } } | null;
      if (d?.user?.username) cb.onRemove?.({ user: d.user.username });
      return;
    }
  }

  return {
    platform: 'kick',
    start() {
      stopped = false;
      cb.onStatus('reconnecting');
      void (async () => {
        const ok = await resolveAll();
        if (ok) {
          log('chatrooms:', [...chatroomToHost.entries()].map(([id, h]) => `${h}=${id}`).join(', '));
          connect();
        } else {
          log.warn('no chatrooms resolved (Cloudflare?) — marking unavailable, will retry');
          cb.onStatus('unavailable');
          scheduleSlowReresolve();
        }
      })();
    },
    stop() {
      stopped = true;
      clearTimers();
      if (reresolveTimer) clearTimeout(reresolveTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* noop */
      }
    },
  };
}

function parseMaybe(data: unknown): unknown {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data ?? null;
}
