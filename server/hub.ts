// AggregatorHub — in-memory fan-in of all sources and fan-out to websocket clients.
// Holds the message ring buffer, viewer matrix + history, per-source status, and
// the overall live flag. Adapters/pollers push into it; the ws-gateway subscribes.
import type {
  ChatMessage,
  Host,
  HostCounts,
  Platform,
  ServerEvent,
  SourceStatus,
  StatusMap,
  ViewerHistory,
  ViewerMatrix,
} from '../shared/protocol';
import { PLATFORMS, emptyViewerMatrix, platformTotal } from '../shared/meta';

const RING_CAP = 400; // messages retained server-side
const SNAPSHOT_CAP = 220; // messages sent to a new client
const HISTORY_CAP = 60; // sparkline samples per platform
const DEDUPE_CAP = 500; // recent ids kept to drop replays
const VIEWER_DEBOUNCE_MS = 250;
const CHAT_BATCH_MS = 50; // coalesce chat fan-out into ≤20 frames/s per client
// Offline this long after being live = the show really ended (not a mid-show
// stream crash or flaky poll): wipe its chat instead of leaving it under the
// countdown.
const CHAT_CLEAR_GRACE_MS = 2 * 60 * 1000;
// While KNOWN offline, chat silent this long is stale (people who typed into
// the offline channels) — wipe it. Catches what the live→offline grace can't:
// chat that arrives after the wipe, or before any live this server run.
const CHAT_IDLE_CLEAR_MS = 5 * 60 * 1000;

export interface Hub {
  ingestMessage(msg: ChatMessage): void;
  removeMessages(platform: Platform, sel: { ids?: string[]; user?: string }): void;
  setPlatformViewers(platform: Platform, counts: HostCounts, isLive: boolean): void;
  setStatus(platform: Platform, status: SourceStatus): void;
  // seeded at boot, re-pushed after every settings save; broadcasts only on change
  setTwitchChannels(channels: Record<Host, string>): void;
  statusSnapshot(): StatusMap;
  snapshot(): Extract<ServerEvent, { type: 'snapshot' }>;
  subscribe(fn: (event: ServerEvent) => void): () => void;
}

export function createHub(
  opts: { chatClearGraceMs?: number; chatIdleClearMs?: number } = {},
): Hub {
  const chatClearGraceMs = opts.chatClearGraceMs ?? CHAT_CLEAR_GRACE_MS;
  const chatIdleClearMs = opts.chatIdleClearMs ?? CHAT_IDLE_CLEAR_MS;
  const messages: ChatMessage[] = [];
  const recentIds = new Set<string>();
  const recentOrder: string[] = [];

  const viewers: ViewerMatrix = emptyViewerMatrix();
  const history: ViewerHistory = { twitch: [], kick: [], x: [] };
  const liveByPlatform: Record<Platform, boolean> = {
    twitch: false,
    kick: false,
    x: false,
  };
  const status: StatusMap = {
    twitch: 'unavailable',
    kick: 'unavailable',
    x: 'unavailable',
  };
  let twitchChannels: Record<Host, string> = { banks: '', ansem: '' };

  const subscribers = new Set<(event: ServerEvent) => void>();
  let viewerTimer: NodeJS.Timeout | null = null;
  let chatQueue: ChatMessage[] = [];
  let chatTimer: NodeJS.Timeout | null = null;
  // live→offline transition tracking for the chat wipe; uses only KNOWN live
  // flags from real polls, so the boot "unknown" state never arms the timer
  let wasAnyLive = false;
  let chatClearTimer: NodeJS.Timeout | null = null;
  // idle wipe while known offline; rearmed by each message, cancelled on live
  let chatIdleTimer: NodeJS.Timeout | null = null;

  function broadcast(event: ServerEvent) {
    for (const fn of subscribers) {
      try {
        fn(event);
      } catch {
        // a misbehaving subscriber must not break fan-out
      }
    }
  }

  function overallLive(): boolean {
    if (PLATFORMS.some((p) => liveByPlatform[p])) return true;
    // If no poller could determine viewers at all (no keys / blocked), every cell
    // is null — we genuinely can't tell, so don't claim "offline" (show the
    // player and let the embed surface its own state). Once any poll succeeds it
    // reports 0 for offline channels, which is "known" and correctly yields false.
    const anyKnown = PLATFORMS.some(
      (p) => viewers[p].banks !== null || viewers[p].ansem !== null,
    );
    return !anyKnown;
  }

  // Chat fan-out is coalesced: instead of one ws frame per message (150+/s at
  // peak rates), queued messages go out as one chat_batch per CHAT_BATCH_MS.
  function flushChat() {
    if (chatTimer) {
      clearTimeout(chatTimer);
      chatTimer = null;
    }
    if (chatQueue.length === 0) return;
    const batch = chatQueue;
    chatQueue = [];
    broadcast({ type: 'chat_batch', messages: batch });
  }

  function buildSnapshot(): Extract<ServerEvent, { type: 'snapshot' }> {
    // Queued chat must not arrive again after a snapshot that already
    // contains it: flush to existing clients first. (The connecting client
    // either isn't subscribed yet, or its snapshot handler clears pending.)
    flushChat();
    return {
      type: 'snapshot',
      messages: messages.slice(-SNAPSHOT_CAP),
      viewers: cloneMatrix(viewers),
      history: {
        twitch: history.twitch.slice(),
        kick: history.kick.slice(),
        x: history.x.slice(),
      },
      status: { ...status },
      live: overallLive(),
      twitchChannels: { ...twitchChannels },
    };
  }

  // Wipe the ended show's chat everywhere: ring buffer, unsent queue, dedupe,
  // then push a fresh snapshot — clients replace their whole message list on
  // snapshot (the reconnect path), so no new protocol event is needed.
  function clearChat() {
    if (messages.length === 0 && chatQueue.length === 0) return;
    messages.length = 0;
    chatQueue = [];
    if (chatTimer) {
      clearTimeout(chatTimer);
      chatTimer = null;
    }
    recentIds.clear();
    recentOrder.length = 0;
    broadcast(buildSnapshot());
  }

  function restartIdleClear() {
    if (chatIdleTimer) clearTimeout(chatIdleTimer);
    chatIdleTimer = setTimeout(() => {
      chatIdleTimer = null;
      clearChat();
    }, chatIdleClearMs);
  }

  function remember(id: string) {
    recentIds.add(id);
    recentOrder.push(id);
    if (recentOrder.length > DEDUPE_CAP) {
      const old = recentOrder.shift();
      if (old !== undefined) recentIds.delete(old);
    }
  }

  return {
    ingestMessage(msg) {
      if (recentIds.has(msg.id)) return; // drop Pusher resubscribe replays etc.
      remember(msg.id);
      messages.push(msg);
      if (messages.length > RING_CAP) messages.splice(0, messages.length - RING_CAP);
      chatQueue.push(msg);
      if (!chatTimer) chatTimer = setTimeout(flushChat, CHAT_BATCH_MS);
      // overallLive() is true while liveness is unknown, so boot-state chat
      // never arms the idle wipe — only KNOWN-offline silence does
      if (!overallLive()) restartIdleClear();
    },

    removeMessages(platform, sel) {
      const ids = sel.ids ? new Set(sel.ids) : null;
      const user = sel.user?.toLowerCase();
      const match = (m: ChatMessage) =>
        m.platform === platform &&
        ((ids ? ids.has(m.id) : false) || (user != null && m.user.toLowerCase() === user));
      for (let i = messages.length - 1; i >= 0; i--) {
        if (match(messages[i])) messages.splice(i, 1);
      }
      // a queued-but-unsent message must not outlive its own removal
      chatQueue = chatQueue.filter((m) => !match(m));
      broadcast({ type: 'remove', platform, ids: sel.ids, user: sel.user });
    },

    setPlatformViewers(platform, counts, isLive) {
      viewers[platform] = counts;
      liveByPlatform[platform] = isLive;
      const arr = history[platform];
      arr.push(platformTotal(viewers, platform));
      if (arr.length > HISTORY_CAP) arr.splice(0, arr.length - HISTORY_CAP);
      const anyLive = PLATFORMS.some((p) => liveByPlatform[p]);
      if (anyLive !== wasAnyLive) {
        wasAnyLive = anyLive;
        if (anyLive) {
          // back before the grace elapsed — the show didn't actually end
          if (chatClearTimer) {
            clearTimeout(chatClearTimer);
            chatClearTimer = null;
          }
        } else {
          chatClearTimer = setTimeout(() => {
            chatClearTimer = null;
            clearChat();
          }, chatClearGraceMs);
        }
      }
      if (overallLive()) {
        if (chatIdleTimer) {
          clearTimeout(chatIdleTimer);
          chatIdleTimer = null;
        }
      } else if (!chatIdleTimer && messages.length > 0) {
        // existing chat with no live stream (e.g. a flap the grace timer let
        // through, or chat retained across restart polls) still goes stale
        restartIdleClear();
      }
      // coalesce: three pollers landing together emit one event
      if (viewerTimer) return;
      viewerTimer = setTimeout(() => {
        viewerTimer = null;
        broadcast({
          type: 'viewers',
          viewers: cloneMatrix(viewers),
          live: overallLive(),
        });
      }, VIEWER_DEBOUNCE_MS);
    },

    setStatus(platform, status_) {
      if (status[platform] === status_) return;
      status[platform] = status_;
      broadcast({ type: 'status', platform, status: status_ });
    },

    setTwitchChannels(channels) {
      if (channels.banks === twitchChannels.banks && channels.ansem === twitchChannels.ansem) return;
      twitchChannels = { ...channels };
      broadcast({ type: 'config', twitchChannels: { ...twitchChannels } });
    },

    statusSnapshot() {
      return { ...status };
    },

    snapshot() {
      return buildSnapshot();
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}

function cloneMatrix(v: ViewerMatrix): ViewerMatrix {
  return {
    twitch: { ...v.twitch },
    kick: { ...v.kick },
    x: { ...v.x },
  };
}
