// Wire protocol shared by the aggregation server and the browser client.
// This is the single source of truth for the shapes that cross the websocket.

export type Platform = 'twitch' | 'kick' | 'x';
export type Host = 'banks' | 'ansem';

// One profile-picture URL per host, fetched server-side at boot (Twitch first,
// Kick fallback) and shipped via /api/config. Absent key => the client renders
// the HOST_META letter instead.
export type HostAvatars = Partial<Record<Host, string>>;

// 'ok'          — socket up, at least one channel subscribed
// 'reconnecting'— socket down and retrying (drives the amber pulsing dot)
// 'unavailable' — disabled by config or permanently failed (grayed in the UI)
export type SourceStatus = 'ok' | 'reconnecting' | 'unavailable';

// Exact shape the design prototype's chat-sim.js produced — preserved so the
// ported UI components need no reshaping.
export interface ChatMessage {
  id: string; // `${platform}:${platformMsgId}` (falls back to a generated id)
  platform: Platform;
  host: Host;
  user: string; // display name
  text: string;
  ts: number; // epoch ms
}

// null => the count is unknown (source unavailable) and renders as "—",
// and is excluded from totals/shares.
export interface HostCounts {
  banks: number | null;
  ansem: number | null;
}

export interface ViewerMatrix {
  twitch: HostCounts;
  kick: HostCounts;
  x: HostCounts;
}

// Per-platform total history for the dashboard sparklines (capped to 60 samples).
export interface ViewerHistory {
  twitch: number[];
  kick: number[];
  x: number[];
}

export type StatusMap = Record<Platform, SourceStatus>;

// Server -> client. The client never sends — the app is a read-only viewer;
// chatting happens in the hosts' own channels on each platform.
export type ServerEvent =
  | {
      type: 'snapshot';
      messages: ChatMessage[];
      viewers: ViewerMatrix;
      history: ViewerHistory;
      status: StatusMap;
      live: boolean;
      twitchChannels: Record<Host, string>;
    }
  // chat fan-out is coalesced server-side (~50ms window) so the wire carries
  // batches, not one frame per message
  | { type: 'chat_batch'; messages: ChatMessage[] }
  | { type: 'viewers'; viewers: ViewerMatrix; live: boolean }
  | { type: 'status'; platform: Platform; status: SourceStatus }
  | { type: 'remove'; platform: Platform; ids?: string[]; user?: string }
  // admin retargeted a stream slot — the player must swap embeds without a reload
  | { type: 'config'; twitchChannels: Record<Host, string> };
