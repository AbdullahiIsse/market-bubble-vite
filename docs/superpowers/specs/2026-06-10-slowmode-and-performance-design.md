# Slowmode + Performance/Bugfix Design — 2026-06-10

## Context

User report: "the app is really slow." Plus: find bugs/race conditions, and add a
slowmode feature users can apply to the chat.

Baseline measurement (scripts/perf-test.mjs, sim @150 msgs/s, 4× CPU throttle ≈
mid-range laptop decoding a stream next to chat): **6.4 FPS, main thread blocked
11.3s of 15s, worst task 1165ms**. Root cause: every WebSocket chat message
triggers a React state update in `useAggregator`, re-rendering the entire app
tree (StreamPlayer, TopBar, ViewerPill, both views, 220-row feed reconciliation)
— at 50–150 msgs/s (the configured channels: xqc, jynxzi, knut) the main thread
never breathes.

## Part 1 — Performance

**A. Batch chat ingest (hooks/useAggregator.ts).** Buffer incoming `chat` events
in a ref; flush once per 100ms window into a single `setMessages` +
`setBuckets` update. Caps React render frequency at ~10/s regardless of chat
rate (15 messages arrive as one append at 150/s). `remove` events filter the
pending buffer too; `snapshot` clears it. Chat still feels real-time (≤100ms
added latency).

**B. Memoize static-per-message subtrees.** `memo()` on StreamPlayer, TopBar,
SocialRow, ViewerPill, PlatformCard, Sparkline, ChatColumn, ChatComposer.
Stabilize identities in MarketBubbleApp (`useCallback` handlers, `useMemo`
composer element) and useSession (memoized `linked`/`selfNames`). Result: a
chat flush re-renders only the feed path; viewer/status updates only their
consumers. ChatMessage rows were already memoized.

**C. ChatFeed unseen counter.** Count appended messages by id-delta rather than
+1 per state change (required once flushes batch multiple messages).

Non-goals: virtualization (220 memoized rows is fine), server-side message
coalescing (wire protocol unchanged; per-frame WS sends are not the bottleneck).

## Part 2 — Bug / race fixes

1. **Kick/Twitch OAuth concurrent-refresh race** (`app/lib/*-oauth.ts`): two
   in-flight sends near token expiry both refresh; Kick rotates refresh tokens,
   so the loser gets `invalid_grant` → account spuriously unlinked. Fix:
   per-user in-flight refresh promise dedupe (single process by design).
2. **Shared `ws` variable races** (useAggregator, twitch-irc, kick-pusher): an
   old socket's `error`/`close` handler can act on the *new* socket after
   reconnect (double reconnect → duplicate feeds client-side, where there is no
   dedupe). Fix: capture the socket in a local and guard each handler
   (`if (sock !== ws) return`); track reconnect timers so `stop()` cancels them.
3. **Sim timer leak** (`server/adapters/sim.ts`): every message pushes a dead
   setTimeout handle into an array that only empties on shutdown (~13k/day at
   default rate). Fix: self-removing timer set.
4. **X live-flag flap** (`server/adapters/x-broadcast.ts`): each host's poll
   overwrites the platform-wide live flag with only its own state. Fix: track
   per-host, OR them.
5. **App-token stampede** (`server/lib/app-tokens.ts`): concurrent cache misses
   fetch twice. Fix: cache the in-flight promise.
6. **Poller timers after stop** (both viewer pollers): a `stop()` during the
   in-flight fetch still schedules the next tick. Fix: re-check `stopped` before
   scheduling.
7. **kick-viewers viaWeb live detection**: treats any `livestream` object as
   live; respect `is_live === false`.
8. **ChatComposer error timer** never cleared on unmount.

## Part 3 — Slowmode

Discord-style global slowmode: one cooldown setting for the merged chat,
enforced per user server-side.

- **Protocol** (`shared/protocol.ts`): snapshot gains `slowmode: number`
  (seconds, 0 = off); new event `{ type: 'slowmode'; seconds: number }`.
- **Hub**: holds `slowmodeSeconds`; `setSlowmode()` clamps (0–300s), broadcasts
  on change; exposed in snapshot + `slowmode()` getter.
- **Bridge** (`server/bridge.ts`): the custom server (tsx module graph) and
  Next route handlers (Next module graph) live in one process but separate
  module registries; the hub is shared via `globalThis[Symbol.for('mb.hub')]`.
- **API** (`app/api/chat/slowmode/route.ts`): GET → `{ seconds }`; POST
  `{ seconds: 0..300 }` (zod, same-origin guard) → sets via bridge. **No role
  system exists in this app** (the Dashboard is equally open), so anyone can
  set slowmode — flagged for when auth/roles land.
- **Enforcement** (`app/lib/slowmode.ts` + send route): per-user
  `platform:userId` last-send map. Claim the slot *before* the platform call
  (synchronous = atomic in one process; two parallel sends can't both pass),
  undo the claim if the platform send fails (failed sends don't burn the
  cooldown). Violation → 429 `{ error, retryAfter }`. Layered after the
  existing anti-spam token bucket.
- **Client**: `useAggregator` exposes `slowmodeSeconds`. ChatComposer shows a
  countdown on the send button after each send (input stays typeable —
  Discord behavior), syncs to server `retryAfter` on 429, and shows a
  "slow mode" hint. A `SlowmodeControl` (timer icon + preset menu: Off, 5s,
  10s, 30s, 1m, 2m, 5m) sits in the ChatColumn header and the Dashboard chat
  header; active state shows the current seconds.

Sent-message UX note: messages aren't echoed locally (they return through the
real feed), so the cooldown starts on the 200 response, not on feed arrival.

## Testing

- `scripts/perf-test.mjs` before/after at 150 msgs/s ±4× throttle.
- `scripts/audit.mjs` full regression (existing).
- `scripts/slowmode-test.mjs` (new): set/read the setting via API, verify the
  WS `slowmode` event reaches the page, verify control UI + composer states.
- `npm run typecheck` + `npm run lint`.
