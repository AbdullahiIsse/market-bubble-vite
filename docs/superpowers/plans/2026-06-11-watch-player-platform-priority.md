# Watch Player Platform Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Watch-tab player picks the embed per host by priority — Twitch if that host is live on Twitch, else Kick, never X — with a sticky fallback so poll blips don't reload the iframe.

**Architecture:** Per-host liveness is derived client-side from the viewer matrix the websocket already delivers (`null` = unknown, `0` = known offline, `>0` = live). The only wire addition is `kickSlugs` next to `twitchChannels` (in `/api/config`, the `snapshot` event, and the `config` event). A pure helper `shared/player-source.ts` encodes the priority + stickiness rule; `StreamPlayer` uses it to build either the existing Twitch embed or a `player.kick.com` embed, and shows a small platform icon in the player tag.

**Tech Stack:** TypeScript, React 19, Vite, `ws`, `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-06-11-watch-player-platform-priority-design.md`

---

## File map

| File | Change |
|---|---|
| `shared/player-source.ts` | **Create** — `pickPlayerPlatform` pure helper |
| `shared/player-source.test.ts` | **Create** — helper unit tests |
| `package.json` | Widen `test` glob to include `shared/**/*.test.ts` |
| `shared/protocol.ts` | `snapshot` + `config` events gain `kickSlugs` |
| `server/hub.ts` | `setTwitchChannels` → `setChannels` (twitch + kick maps) |
| `server/hub.test.ts` | Tests for the extended snapshot/config events |
| `server/index.ts` | `/api/config` ships `kickSlugs`; both `setChannels` call sites |
| `src/main.tsx` | Bootstrap fetches `kickSlugs` |
| `hooks/useAggregator.ts` | Tracks `kickSlugs` identity-stably |
| `components/MarketBubbleApp.tsx` | Threads `kickSlugs` down |
| `components/WatchView.tsx` | Passes `viewers` + `kickSlugs` to the player |
| `components/StreamPlayer.tsx` | Platform selection, Kick embed, platform badge |
| `src/globals.css` | `.tag-platform` style |

---

### Task 1: `pickPlayerPlatform` helper

**Files:**
- Create: `shared/player-source.ts`
- Test: `shared/player-source.test.ts`
- Modify: `package.json` (test glob)

- [ ] **Step 1: Widen the test glob so shared/ tests run**

In `package.json`, change the `test` script:

```json
"test": "tsx --test \"server/**/*.test.ts\" \"shared/**/*.test.ts\"",
```

- [ ] **Step 2: Write the failing tests**

Create `shared/player-source.test.ts`:

```ts
// Priority: Twitch if the host is live there, else Kick, else stick with the
// current platform while its cell is unknown (null), else fall back to Twitch.
// X must never be chosen. Cells: null = unknown, 0 = known offline, >0 = live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickPlayerPlatform } from './player-source';
import type { HostCounts, ViewerMatrix } from './protocol';

function matrix(over: Partial<Record<'twitch' | 'kick' | 'x', HostCounts>>): ViewerMatrix {
  return {
    twitch: { banks: null, ansem: null },
    kick: { banks: null, ansem: null },
    x: { banks: null, ansem: null },
    ...over,
  };
}

test('prefers twitch when the host is live there', () => {
  const v = matrix({ twitch: { banks: 1200, ansem: 0 }, kick: { banks: 0, ansem: 0 } });
  assert.equal(pickPlayerPlatform(v, 'banks', 'twitch'), 'twitch');
});

test('twitch wins even when kick is also live', () => {
  const v = matrix({ twitch: { banks: 1200, ansem: 0 }, kick: { banks: 900, ansem: 0 } });
  assert.equal(pickPlayerPlatform(v, 'banks', 'kick'), 'twitch');
});

test('falls through to kick when twitch is known offline', () => {
  const v = matrix({ twitch: { banks: 0, ansem: 0 }, kick: { banks: 800, ansem: 0 } });
  assert.equal(pickPlayerPlatform(v, 'banks', 'twitch'), 'kick');
});

test('selection is per host: banks on twitch, ansem on kick', () => {
  const v = matrix({ twitch: { banks: 1200, ansem: 0 }, kick: { banks: 0, ansem: 800 } });
  assert.equal(pickPlayerPlatform(v, 'banks', 'twitch'), 'twitch');
  assert.equal(pickPlayerPlatform(v, 'ansem', 'twitch'), 'kick');
});

test('x liveness is never considered', () => {
  const v = matrix({ twitch: { banks: 0, ansem: 0 }, kick: { banks: 0, ansem: 0 }, x: { banks: 5000, ansem: 5000 } });
  assert.equal(pickPlayerPlatform(v, 'banks', 'kick'), 'twitch'); // falls back, never 'x'
});

test('sticks with the current platform while its cell is unknown', () => {
  // kick poll failed (null) while twitch reports known offline — do not flap off kick
  const v = matrix({ twitch: { banks: 0, ansem: 0 }, kick: { banks: null, ansem: null } });
  assert.equal(pickPlayerPlatform(v, 'banks', 'kick'), 'kick');
});

test('does not stick when the current platform is known offline', () => {
  const v = matrix({ twitch: { banks: null, ansem: null }, kick: { banks: 0, ansem: 0 } });
  assert.equal(pickPlayerPlatform(v, 'banks', 'kick'), 'twitch');
});

test('falls back to twitch when both are known offline', () => {
  const v = matrix({ twitch: { banks: 0, ansem: 0 }, kick: { banks: 0, ansem: 0 } });
  assert.equal(pickPlayerPlatform(v, 'banks', 'kick'), 'twitch');
});

test('everything unknown keeps the current choice', () => {
  const v = matrix({});
  assert.equal(pickPlayerPlatform(v, 'banks', 'kick'), 'kick');
  assert.equal(pickPlayerPlatform(v, 'banks', 'twitch'), 'twitch');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module` / `ERR_MODULE_NOT_FOUND` for `./player-source` (the existing `server/hub.test.ts` suite still passes).

- [ ] **Step 4: Implement the helper**

Create `shared/player-source.ts`:

```ts
// Which platform the watch player should embed for a host, derived from the
// viewer matrix (null = unknown, 0 = known offline, >0 = live).
// Priority: Twitch, then Kick. X is never embedded. While the currently shown
// platform's cell is unknown (failed poll) the choice sticks, so a blip never
// reloads the iframe; otherwise fall back to Twitch — its embed shows the
// channel's own offline page and recovers the instant the host goes live.
import type { Host, Platform, ViewerMatrix } from './protocol';

export type PlayerPlatform = Extract<Platform, 'twitch' | 'kick'>;

export function pickPlayerPlatform(
  viewers: ViewerMatrix,
  host: Host,
  current: PlayerPlatform,
): PlayerPlatform {
  if (live(viewers.twitch[host])) return 'twitch';
  if (live(viewers.kick[host])) return 'kick';
  if (viewers[current][host] === null) return current;
  return 'twitch';
}

function live(cell: number | null): boolean {
  return typeof cell === 'number' && cell > 0;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all `player-source` tests green, hub tests still green.

- [ ] **Step 6: Commit**

```bash
git add shared/player-source.ts shared/player-source.test.ts package.json
git commit -m "feat(shared): pickPlayerPlatform — twitch-first, kick fallback, sticky on unknown"
```

---

### Task 2: Wire `kickSlugs` through the protocol, hub, and HTTP API

**Files:**
- Modify: `shared/protocol.ts` (snapshot + config events)
- Modify: `server/hub.ts` (interface + state + broadcast)
- Modify: `server/index.ts:195-202` (`/api/config`), `server/index.ts:230` (save push), `server/index.ts:294` (boot seed)
- Test: `server/hub.test.ts` (append)

- [ ] **Step 1: Write the failing hub tests**

In `server/hub.test.ts`, extend the type import:

```ts
import type { ChatMessage, HostCounts, ServerEvent } from '../shared/protocol';
```

Append at the end of the file:

```ts
// Channel maps: snapshot and the config broadcast must carry BOTH the twitch
// channels and the kick slugs, so the player can retarget either embed live.
const TW = { banks: 'fazebanks', ansem: 'ansem' };
const KS = { banks: 'banks-kick', ansem: 'ansem-kick' };

test('snapshot and config broadcast carry both channel maps', () => {
  const hub = createHub();
  const events: ServerEvent[] = [];
  hub.subscribe((e) => events.push(e));
  hub.setChannels({ twitchChannels: TW, kickSlugs: KS });
  const cfg = events.find((e) => e.type === 'config');
  assert.deepEqual(cfg, { type: 'config', twitchChannels: TW, kickSlugs: KS });
  const snap = hub.snapshot();
  assert.deepEqual(snap.twitchChannels, TW);
  assert.deepEqual(snap.kickSlugs, KS);
});

test('a kick-only slug change still broadcasts a config event', () => {
  const hub = createHub();
  hub.setChannels({ twitchChannels: TW, kickSlugs: KS });
  const events: ServerEvent[] = [];
  hub.subscribe((e) => events.push(e));
  hub.setChannels({ twitchChannels: TW, kickSlugs: { ...KS, ansem: 'moved' } });
  assert.equal(events.filter((e) => e.type === 'config').length, 1);
});

test('setChannels with unchanged values does not broadcast', () => {
  const hub = createHub();
  hub.setChannels({ twitchChannels: TW, kickSlugs: KS });
  const events: ServerEvent[] = [];
  hub.subscribe((e) => events.push(e));
  hub.setChannels({ twitchChannels: { ...TW }, kickSlugs: { ...KS } });
  assert.equal(events.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `hub.setChannels is not a function` in the three new tests; all previous tests still pass.

- [ ] **Step 3: Extend the protocol**

In `shared/protocol.ts`, the snapshot event gains `kickSlugs` (after `twitchChannels`):

```ts
  | {
      type: 'snapshot';
      messages: ChatMessage[];
      viewers: ViewerMatrix;
      history: ViewerHistory;
      status: StatusMap;
      live: boolean;
      twitchChannels: Record<Host, string>;
      kickSlugs: Record<Host, string>;
    }
```

and the config event becomes:

```ts
  // admin retargeted a stream slot — the player must swap embeds without a reload
  | { type: 'config'; twitchChannels: Record<Host, string>; kickSlugs: Record<Host, string> }
```

- [ ] **Step 4: Generalize the hub**

In `server/hub.ts`:

Interface — replace `setTwitchChannels` (line 38) with:

```ts
  // seeded at boot, re-pushed after every settings save; broadcasts only on change
  setChannels(next: { twitchChannels: Record<Host, string>; kickSlugs: Record<Host, string> }): void;
```

State — next to `let twitchChannels` (line 65), add:

```ts
  let kickSlugs: Record<Host, string> = { banks: '', ansem: '' };
```

`buildSnapshot()` — after `twitchChannels: { ...twitchChannels },` add:

```ts
      kickSlugs: { ...kickSlugs },
```

Implementation — replace the `setTwitchChannels(channels) { ... }` method with:

```ts
    setChannels(next) {
      const twitchSame =
        next.twitchChannels.banks === twitchChannels.banks &&
        next.twitchChannels.ansem === twitchChannels.ansem;
      const kickSame =
        next.kickSlugs.banks === kickSlugs.banks && next.kickSlugs.ansem === kickSlugs.ansem;
      if (twitchSame && kickSame) return;
      twitchChannels = { ...next.twitchChannels };
      kickSlugs = { ...next.kickSlugs };
      broadcast({
        type: 'config',
        twitchChannels: { ...twitchChannels },
        kickSlugs: { ...kickSlugs },
      });
    },
```

- [ ] **Step 5: Update the two call sites and `/api/config` in `server/index.ts`**

Boot seed (line 294):

```ts
  hub.setChannels({ twitchChannels: config.twitchChannels, kickSlugs: config.kickSlugs }); // snapshots carry channels from the first client on
```

Settings-save push (line 230):

```ts
    const updated = deps.runtime.getConfig();
    deps.hub.setChannels({ twitchChannels: updated.twitchChannels, kickSlugs: updated.kickSlugs });
```

`/api/config` (lines 195-202):

```ts
  if (pathname === '/api/config' && (method === 'GET' || method === 'HEAD')) {
    sendJsonGet(res, method, {
      twitchChannels: config.twitchChannels,
      kickSlugs: config.kickSlugs,
      xEnabled: config.x.enabled,
      hostAvatars: deps.getAvatars(),
    });
    return true;
  }
```

- [ ] **Step 6: Run tests and typecheck to verify green**

Run: `npm test`
Expected: PASS — all hub tests including the three new ones.

Run: `npm run typecheck`
Expected: PASS — no remaining `setTwitchChannels` references (the client compiles untouched; the snapshot type's new required field only affects producers, and the hub is the only producer).

- [ ] **Step 7: Commit**

```bash
git add shared/protocol.ts server/hub.ts server/hub.test.ts server/index.ts
git commit -m "feat(server): ship kick slugs in /api/config, snapshot, and config events"
```

---

### Task 3: Client wiring — bootstrap, aggregator, and the player's platform selection

One task because the prop chain (`main.tsx` → `MarketBubbleApp` → `WatchView` → `StreamPlayer`) only typechecks once every link is in place; commit at the end when all gates are green.

**Files:**
- Modify: `src/main.tsx`
- Modify: `hooks/useAggregator.ts`
- Modify: `components/MarketBubbleApp.tsx:21-23`, `:186-200`
- Modify: `components/WatchView.tsx`
- Modify: `components/StreamPlayer.tsx`

- [ ] **Step 1: Bootstrap fetches `kickSlugs` (`src/main.tsx`)**

Below `DEFAULT_CHANNELS` (line 20) add:

```ts
const DEFAULT_KICK_SLUGS: Record<Host, string> = { banks: 'fazebanks', ansem: 'ansem' };
```

Extend `BootConfig` and the fetch:

```ts
interface BootConfig {
  twitchChannels: Record<Host, string>;
  kickSlugs: Record<Host, string>;
  hostAvatars: HostAvatars;
}

// The channels must be known BEFORE the app's first render: if the player
// mounted with defaults and the real channels arrived later, the Twitch embed
// could stay on the wrong channel (the race the old SSR delivery prevented).
// Host avatars ride along; missing ones fall back to the letter badges.
async function fetchBootConfig(): Promise<BootConfig> {
  try {
    const res = await fetch('/api/config');
    if (!res.ok)
      return { twitchChannels: DEFAULT_CHANNELS, kickSlugs: DEFAULT_KICK_SLUGS, hostAvatars: {} };
    const data = (await res.json()) as {
      twitchChannels?: Partial<Record<Host, string>>;
      kickSlugs?: Partial<Record<Host, string>>;
      hostAvatars?: HostAvatars;
    };
    return {
      twitchChannels: {
        banks: data.twitchChannels?.banks || DEFAULT_CHANNELS.banks,
        ansem: data.twitchChannels?.ansem || DEFAULT_CHANNELS.ansem,
      },
      kickSlugs: {
        banks: data.kickSlugs?.banks || DEFAULT_KICK_SLUGS.banks,
        ansem: data.kickSlugs?.ansem || DEFAULT_KICK_SLUGS.ansem,
      },
      hostAvatars: data.hostAvatars ?? {},
    };
  } catch {
    return { twitchChannels: DEFAULT_CHANNELS, kickSlugs: DEFAULT_KICK_SLUGS, hostAvatars: {} };
  }
}
```

And the render call:

```ts
fetchBootConfig().then(({ twitchChannels, kickSlugs, hostAvatars }) => {
  setHostAvatars(hostAvatars); // before render: components read it during render
  root.render(
    <StrictMode>
      <MarketBubbleApp twitchChannels={twitchChannels} kickSlugs={kickSlugs} />
    </StrictMode>,
  );
});
```

- [ ] **Step 2: Aggregator tracks `kickSlugs` (`hooks/useAggregator.ts`)**

In `AggregatorState`, after `twitchChannels` (line 35) add:

```ts
  kickSlugs: Record<Host, string> | null;
```

Next to the `twitchChannels` state (line 64) add:

```ts
  const [kickSlugs, setKickSlugs] = useState<Record<Host, string> | null>(null);
```

Generalize `applyChannels` (lines 150-157) to take the setter — same guard, same identity stability:

```ts
    // keep the old reference when values are equal — the memoized player must
    // not see a new channels identity on every ws reconnect snapshot
    function applyChannels(
      next: Record<Host, string> | undefined,
      set: React.Dispatch<React.SetStateAction<Record<Host, string> | null>>,
    ) {
      if (!next || !next.banks || !next.ansem) return; // old-server snapshot during a deploy
      set((prev) =>
        prev && prev.banks === next.banks && prev.ansem === next.ansem ? prev : next,
      );
    }
```

(`import type React from 'react'` is unnecessary — the `React` namespace types are global to TSX-aware configs; if `tsc` complains, add `import type { Dispatch, SetStateAction } from 'react';` and use those names.)

Update both call sites in `handleEvent` — the existing one-arg `applyChannels(event.twitchChannels)` calls become:

```ts
        case 'snapshot':
          clearPending(); // snapshot replaces everything buffered
          setMessages(event.messages);
          setViewers(event.viewers);
          setHistory(event.history);
          setStatus(event.status);
          setLive(event.live);
          applyChannels(event.twitchChannels, setTwitchChannels);
          applyChannels(event.kickSlugs, setKickSlugs);
          setConnected(true);
          setEverConnected(true);
          break;
```

```ts
        case 'config':
          applyChannels(event.twitchChannels, setTwitchChannels);
          applyChannels(event.kickSlugs, setKickSlugs);
          break;
```

Add `kickSlugs,` to the returned object (after `twitchChannels,`).

- [ ] **Step 3: Thread through `MarketBubbleApp`**

Props (line 21):

```ts
export function MarketBubbleApp({
  twitchChannels,
  kickSlugs,
}: {
  twitchChannels: Record<Host, string>;
  kickSlugs: Record<Host, string>;
}) {
  const agg = useAggregator();
  const channels = agg.twitchChannels ?? twitchChannels;
  const kick = agg.kickSlugs ?? kickSlugs;
```

WatchView call (line 186) gains two props:

```tsx
        <WatchView
          channels={channels}
          kickSlugs={kick}
          mainHost={mainHost}
          ...
```

(everything else unchanged — `viewers={agg.viewers}` is already passed.)

- [ ] **Step 4: `WatchView` forwards to the player**

Add to the props type:

```ts
  kickSlugs: Record<Host, string>;
```

destructure `kickSlugs`, and forward both it and the already-present `viewers`:

```tsx
        <StreamPlayer
          channels={channels}
          kickSlugs={kickSlugs}
          viewers={viewers}
          mainHost={mainHost}
          live={live}
          onSwap={onSwap}
        />
```

- [ ] **Step 5: Platform selection + Kick embed in `StreamPlayer`**

New imports:

```ts
import { Fragment, memo, useRef, useState } from 'react';
import type { Host, ViewerMatrix } from '@/shared/protocol';
import { HOST_META, PLATFORM_META } from '@/shared/meta';
import { pickPlayerPlatform, type PlayerPlatform } from '@/shared/player-source';
```

Props:

```ts
export const StreamPlayer = memo(function StreamPlayer({
  channels,
  kickSlugs,
  viewers,
  mainHost,
  live,
  onSwap,
}: {
  channels: Record<Host, string>;
  kickSlugs: Record<Host, string>;
  viewers: ViewerMatrix;
  mainHost: Host;
  live: boolean | null; // null = not known yet (no server snapshot)
  onSwap: () => void;
}) {
```

After the `const [parent] = useState(...)` line, add the per-host sticky selection (before the early returns is fine — ref reads/writes are cheap and idempotent):

```ts
  // Per-host platform choice. The ref makes it sticky: while a platform's
  // liveness is unknown (failed poll) the previous choice holds, so a blip
  // never reloads the iframe. Idempotent, so the StrictMode double-render
  // and chat-driven parent renders are harmless.
  const chosenRef = useRef<Record<Host, PlayerPlatform>>({ banks: 'twitch', ansem: 'twitch' });
  const platform = pickPlayerPlatform(viewers, mainHost, chosenRef.current[mainHost]);
  chosenRef.current[mainHost] = platform;
```

Replace the embed construction (lines 82-87):

```ts
  // Twitch's embed requires `parent`; Kick's player just takes the slug.
  const embed =
    platform === 'twitch'
      ? 'https://player.twitch.tv/?channel=' +
        encodeURIComponent(channels[mainHost]) +
        '&parent=' +
        encodeURIComponent(parent) +
        '&muted=true&autoplay=true'
      : 'https://player.kick.com/' +
        encodeURIComponent(kickSlugs[mainHost]) +
        '?autoplay=true&muted=true';
```

Update the iframe title so it names the platform:

```tsx
        title={HOST_META[mainHost].name + ' stream on ' + PLATFORM_META[platform].name}
```

Everything else (offline branches, tag, swap button) stays as-is in this task — the badge is Task 4.

- [ ] **Step 6: Verify all gates**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run lint`
Expected: PASS

Run: `npm test`
Expected: PASS (nothing server-side changed in this task; confirms no accidental breakage)

- [ ] **Step 7: Commit**

```bash
git add src/main.tsx hooks/useAggregator.ts components/MarketBubbleApp.tsx components/WatchView.tsx components/StreamPlayer.tsx
git commit -m "feat(watch): per-host platform priority — twitch first, then kick, never x"
```

---

### Task 4: Platform badge in the player tag

**Files:**
- Modify: `components/StreamPlayer.tsx` (player-tag JSX)
- Modify: `src/globals.css` (one rule, near the `.tag-swap svg` rule at ~line 239)

- [ ] **Step 1: Add the icon to the tag**

In `components/StreamPlayer.tsx`, import the icon:

```ts
import { PlatformIcon } from './PlatformIcon';
```

In the player-tag JSX, insert the badge between the tag text and the swap button:

```tsx
        <span className="player-tag-text">{HOST_META[mainHost].name}&rsquo;s stream</span>
        <span className="tag-platform" title={'Watching on ' + PLATFORM_META[platform].name}>
          <PlatformIcon platform={platform} size={12} />
        </span>
        <button
          className="tag-swap"
```

- [ ] **Step 2: Style it**

In `src/globals.css`, after the `.tag-swap svg { flex: none; }` rule (~line 239), add:

```css
  .tag-platform { display: inline-flex; align-items: center; flex: none; }
```

- [ ] **Step 3: Verify gates**

Run: `npm run typecheck && npm run lint`
Expected: PASS for both.

- [ ] **Step 4: Commit**

```bash
git add components/StreamPlayer.tsx src/globals.css
git commit -m "feat(watch): platform icon in the player tag"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated suite**

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

Expected: all four PASS (build confirms the Vite client bundle compiles).

- [ ] **Step 2: Smoke-test in sim mode**

```bash
npm run dev:sim
```

Open the printed local URL and confirm on the Watch tab:
- the player renders an embed (sim marks channels live);
- hovering the player shows the tag with the new platform icon next to "<Host>'s stream";
- swapping hosts via the tag still works;
- `curl -s http://localhost:<port>/api/config` includes both `twitchChannels` and `kickSlugs`.

- [ ] **Step 3: Verify the selection against real data (optional but recommended)**

With real API keys configured (`npm run dev`), set Twitch channels to one live and one offline channel and Kick slugs to a live channel for the "offline on Twitch" host (Settings view). The player should embed Twitch for the first host and Kick for the second, switching live when you save new slugs — no reload.
