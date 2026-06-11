import { useEffect, useState } from 'react';
import type {
  ChatMessage as Msg,
  ServerEvent,
  StatusMap,
  ViewerHistory,
  ViewerMatrix,
} from '@/shared/protocol';
import { emptyViewerMatrix, platformTotal } from '@/shared/meta';

const MAX_MSGS = 220;
const HISTORY_CAP = 60;
const BUCKET_MS = 5000;
const BUCKET_COUNT = 48;
// Chat events are buffered and flushed in one state update per window, so the
// render rate stays ~10/s no matter how fast the merged feed runs (the
// configured channels can exceed 100 msgs/s).
const FLUSH_MS = 100;

interface Bucket {
  twitch: number;
  kick: number;
  x: number;
}

export interface AggregatorState {
  messages: Msg[];
  viewers: ViewerMatrix;
  history: ViewerHistory;
  status: StatusMap;
  live: boolean | null; // null until the first server snapshot — "unknown", not "offline"
  connected: boolean;
  everConnected: boolean;
  msgsPerMin: number;
}

function emptyBucket(): Bucket {
  return { twitch: 0, kick: 0, x: 0 };
}

function cap<T>(arr: T[], n: number): T[] {
  return arr.length > n ? arr.slice(arr.length - n) : arr;
}

// Connects to the aggregation server's /ws stream and exposes the merged state.
// Reconnects with jittered backoff; every (re)connect is rehydrated by the
// server snapshot, so no client-side dedupe is needed.
export function useAggregator(): AggregatorState {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [viewers, setViewers] = useState<ViewerMatrix>(emptyViewerMatrix);
  const [history, setHistory] = useState<ViewerHistory>({ twitch: [], kick: [], x: [] });
  const [status, setStatus] = useState<StatusMap>({
    twitch: 'unavailable',
    kick: 'unavailable',
    x: 'unavailable',
  });
  // null = no snapshot yet. Starting at false would flash the offline countdown
  // over a live stream while the websocket connects.
  const [live, setLive] = useState<boolean | null>(null);
  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [buckets, setBuckets] = useState<Bucket[]>(() =>
    Array.from({ length: BUCKET_COUNT }, emptyBucket),
  );

  // websocket lifecycle
  useEffect(() => {
    let ws: WebSocket | null = null; // the *current* socket; older ones must not act
    let closedByUs = false;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    // chat events accumulate here and land in React state once per FLUSH_MS
    let pending: Msg[] = [];
    let pendingCounts = emptyBucket();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function flush() {
      flushTimer = null;
      if (pending.length === 0) return;
      const batch = pending;
      const counts = pendingCounts;
      pending = [];
      pendingCounts = emptyBucket();
      setMessages((prev) => cap([...prev, ...batch], MAX_MSGS));
      setBuckets((prev) => {
        const next = prev.slice();
        const last = { ...next[next.length - 1] };
        last.twitch += counts.twitch;
        last.kick += counts.kick;
        last.x += counts.x;
        next[next.length - 1] = last;
        return next;
      });
    }

    function clearPending() {
      pending = [];
      pendingCounts = emptyBucket();
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
    }

    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const sock = new WebSocket(`${proto}://${window.location.host}/ws`);
      ws = sock;

      sock.onmessage = (ev) => {
        if (sock !== ws) return; // stale socket
        let event: ServerEvent;
        try {
          event = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        handleEvent(event);
      };

      sock.onopen = () => {
        if (sock !== ws) return;
        retry = 0;
      };

      sock.onclose = () => {
        if (sock !== ws) return; // an old socket closing must not reconnect
        setConnected(false);
        if (closedByUs) return;
        const delay = Math.min(10000, 1000 * 2 ** retry) * (0.5 + Math.random() * 0.5);
        retry++;
        reconnectTimer = setTimeout(connect, delay);
      };

      sock.onerror = () => {
        try {
          sock.close(); // close *this* socket, never a newer one
        } catch {
          /* onclose handles reconnect */
        }
      };
    }

    function handleEvent(event: ServerEvent) {
      switch (event.type) {
        case 'snapshot':
          clearPending(); // snapshot replaces everything buffered
          setMessages(event.messages);
          setViewers(event.viewers);
          setHistory(event.history);
          setStatus(event.status);
          setLive(event.live);
          setConnected(true);
          setEverConnected(true);
          break;
        case 'chat_batch': {
          for (const m of event.messages) {
            pending.push(m);
            pendingCounts[m.platform]++;
          }
          if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
          break;
        }
        case 'viewers':
          setViewers(event.viewers);
          setLive(event.live);
          setHistory((h) => ({
            twitch: cap([...h.twitch, platformTotal(event.viewers, 'twitch')], HISTORY_CAP),
            kick: cap([...h.kick, platformTotal(event.viewers, 'kick')], HISTORY_CAP),
            x: cap([...h.x, platformTotal(event.viewers, 'x')], HISTORY_CAP),
          }));
          break;
        case 'status':
          setStatus((s) => ({ ...s, [event.platform]: event.status }));
          break;
        case 'remove': {
          const drop = (m: Msg) => {
            if (m.platform !== event.platform) return false;
            if (event.ids && event.ids.includes(m.id)) return true;
            if (event.user && m.user.toLowerCase() === event.user.toLowerCase()) return true;
            return false;
          };
          pending = pending.filter((m) => !drop(m)); // may not have flushed yet
          setMessages((prev) => prev.filter((m) => !drop(m)));
          break;
        }
      }
    }

    connect();
    return () => {
      closedByUs = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearPending();
      try {
        ws?.close();
      } catch {
        /* noop */
      }
    };
  }, []);

  // rotate the velocity buckets independent of message flow
  useEffect(() => {
    const iv = setInterval(() => {
      setBuckets((prev) => prev.slice(1).concat(emptyBucket()));
    }, BUCKET_MS);
    return () => clearInterval(iv);
  }, []);

  const msgsPerMin = buckets
    .slice(-12)
    .reduce((s, b) => s + b.twitch + b.kick + b.x, 0);

  return {
    messages,
    viewers,
    history,
    status,
    live,
    connected,
    everConnected,
    msgsPerMin,
  };
}
