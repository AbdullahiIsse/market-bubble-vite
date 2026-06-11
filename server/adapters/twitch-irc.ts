// Twitch chat reader over anonymous IRC-via-WebSocket. No credentials required:
// we log in as justinfan<random> and JOIN both host channels.
import { WebSocket } from 'ws';
import type { Host } from '../../shared/protocol';
import type { AdapterCallbacks, SourceAdapter } from './types';
import { createBackoff } from '../lib/backoff';
import { scoped } from '../lib/log';

const log = scoped('twitch');
const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
const WATCHDOG_MS = 6 * 60 * 1000; // Twitch pings ~every 5min; reconnect if silent

interface IrcLine {
  tags: Record<string, string>;
  prefix: string;
  command: string;
  params: string[];
}

function unescapeTag(v: string): string {
  return v
    .replace(/\\s/g, ' ')
    .replace(/\\:/g, ';')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\\\/g, '\\');
}

export function parseIrcLine(line: string): IrcLine {
  let rest = line;
  const tags: Record<string, string> = {};
  if (rest[0] === '@') {
    const sp = rest.indexOf(' ');
    for (const kv of rest.slice(1, sp).split(';')) {
      const eq = kv.indexOf('=');
      if (eq < 0) tags[kv] = '';
      else tags[kv.slice(0, eq)] = unescapeTag(kv.slice(eq + 1));
    }
    rest = rest.slice(sp + 1);
  }
  let prefix = '';
  if (rest[0] === ':') {
    const sp = rest.indexOf(' ');
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }
  const sp = rest.indexOf(' ');
  if (sp < 0) return { tags, prefix, command: rest, params: [] };
  const command = rest.slice(0, sp);
  const pstr = rest.slice(sp + 1);
  const params: string[] = [];
  if (pstr[0] === ':') {
    params.push(pstr.slice(1));
  } else {
    const tr = pstr.indexOf(' :');
    if (tr >= 0) {
      params.push(...pstr.slice(0, tr).split(' '));
      params.push(pstr.slice(tr + 2));
    } else {
      params.push(...pstr.split(' '));
    }
  }
  return { tags, prefix, command, params };
}

function loginFromPrefix(prefix: string): string {
  const bang = prefix.indexOf('!');
  return bang > 0 ? prefix.slice(0, bang) : prefix;
}

export function createTwitchIrcAdapter(
  channelToHost: Record<string, Host>, // lowercased login -> host
  cb: AdapterCallbacks,
): SourceAdapter {
  const channels = Object.keys(channelToHost);
  let ws: WebSocket | null = null; // the *current* socket; stale ones must not act
  let stopped = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const backoff = createBackoff(1000, 30000);

  function armWatchdog() {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      log.warn('watchdog: no traffic, reconnecting');
      try {
        ws?.terminate();
      } catch {
        /* onclose reconnects */
      }
    }, WATCHDOG_MS);
  }

  function scheduleReconnect() {
    if (stopped) return;
    cb.onStatus('reconnecting');
    const delay = backoff.next();
    reconnectTimer = setTimeout(connect, delay);
  }

  function connect() {
    if (stopped) return;
    const sock = new WebSocket(IRC_URL);
    ws = sock;

    sock.on('open', () => {
      if (sock !== ws) return;
      const nick = 'justinfan' + Math.floor(10000 + Math.random() * 80000);
      sock.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      sock.send('NICK ' + nick);
      sock.send('JOIN #' + channels.join(',#'));
      armWatchdog();
    });

    sock.on('message', (raw) => {
      if (sock !== ws) return;
      armWatchdog();
      const text = raw.toString('utf8');
      for (const line of text.split('\r\n')) {
        if (line) handleLine(line);
      }
    });

    sock.on('close', () => {
      if (sock !== ws) return; // a stale socket closing must not reconnect
      if (watchdog) clearTimeout(watchdog);
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

  function handleLine(line: string) {
    const msg = parseIrcLine(line);
    switch (msg.command) {
      case 'PING':
        ws?.send('PONG :' + (msg.params[0] ?? 'tmi.twitch.tv'));
        break;
      case 'RECONNECT':
        log('server asked us to reconnect');
        try {
          ws?.close();
        } catch {
          /* noop */
        }
        break;
      case '001': // logged in
        backoff.reset();
        cb.onStatus('ok');
        break;
      case 'PRIVMSG': {
        const channel = (msg.params[0] || '').replace(/^#/, '').toLowerCase();
        const host = channelToHost[channel];
        if (!host) break;
        let text = msg.params[1] || '';
        // unwrap /me actions (CTCP framing: \x01ACTION <text>\x01)
        const action = text.match(/^ACTION (.*)$/);
        if (action) text = action[1];
        const user = msg.tags['display-name'] || loginFromPrefix(msg.prefix);
        const id = msg.tags['id'] || 'twitch-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        const ts = msg.tags['tmi-sent-ts'] ? Number(msg.tags['tmi-sent-ts']) : Date.now();
        cb.onMessage({ id: 'twitch:' + id, platform: 'twitch', host, user, text, ts });
        break;
      }
      case 'CLEARMSG': {
        const targetId = msg.tags['target-msg-id'];
        if (targetId) cb.onRemove?.({ ids: ['twitch:' + targetId] });
        break;
      }
      case 'CLEARCHAT': {
        // params[1] (trailing) is the banned/timed-out user, if any
        const user = msg.params[1];
        if (user) cb.onRemove?.({ user });
        break;
      }
    }
  }

  return {
    platform: 'twitch',
    start() {
      stopped = false;
      log('connecting, channels:', channels.join(', '));
      connect();
    },
    stop() {
      stopped = true;
      if (watchdog) clearTimeout(watchdog);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* noop */
      }
    },
  };
}
