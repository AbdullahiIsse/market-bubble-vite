# Settings Stream Config + Live Reconnect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Settings" nav tab where the owner edits all three platforms' stream targets (Twitch channel, Kick slug + chatroom id, X broadcast URL) for both host slots, persists them, and reconnects only the changed source — no server restart.

**Architecture:** A new `runtime-config` module layers a persisted, editable overlay on top of the env-derived `AppConfig`. A `source-manager` owns each platform's adapter+poller and can restart one platform independently. New `GET/POST /api/streams` endpoints read/write the overlay (cookies write-only) and drive per-source restarts. A React `SettingsView` renders the form and reads live status from the existing `/ws` aggregator.

**Tech Stack:** TypeScript, Node `http` (raw, custom server), `ws`, `zod`, React 19, Vite. Tests are standalone scripts under `scripts/` (`npx tsx scripts/<name>.ts` for unit, `node scripts/<name>.mjs` for Playwright/black-box). No formal test runner.

---

## Conventions for this plan

- **Git:** the repo has no git yet. Task 0 sets it up so the `Commit` steps work and secrets are protected first. If you decline git, skip Task 0 and treat each `Commit` step as a manual checkpoint.
- **Running a test script that imports TS:** `npx tsx scripts/<name>.ts`. It prints `PASS`/`FAIL` lines and exits non-zero on failure (mirrors `scripts/audit.mjs`).
- **Type checking after each task:** `npm run typecheck` (runs `tsc --noEmit` for client and server).
- Commit message trailer for every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```

## File structure (created / modified)

| File | Responsibility |
|---|---|
| `.gitignore` (create) | Keep secrets (`.env.local`, `server/streams.local.json`) and build output out of git |
| `server/runtime-config.ts` (create) | Mutable, persisted overlay of editable stream settings on top of `AppConfig`; validation; secret-aware public view |
| `server/source-manager.ts` (create) | Owns each platform's start/stop; `restart(platform)` and `stopAll()` |
| `server/sources-real.ts` (modify) | Build the per-platform starters and a `SourceManager` instead of starting sources inline |
| `server/sources.ts` (modify) | Return `{ stop, manager }`; route sim vs real; take `RuntimeConfig` |
| `server/hub.ts` (modify) | Add `statusSnapshot(): StatusMap` |
| `server/index.ts` (modify) | Create `RuntimeConfig`; JSON body reader; `GET/POST /api/streams`, `POST /api/streams/reconnect`; wire manager |
| `components/TopBar.tsx` (modify) | Add `'settings'` to `Mode` + a "Settings" tab |
| `components/MarketBubbleApp.tsx` (modify) | Restore/route the `settings` mode; render `SettingsView` |
| `components/SettingsView.tsx` (create) | The settings form: per-host fields, X-account section, save + reconnect, live status dots |
| `src/globals.css` (modify) | Styles for the settings page |
| `scripts/runtime-config-test.ts` (create) | Unit test for the overlay/merge/persist/secret semantics |
| `scripts/hub-status-test.ts` (create) | Unit test for `statusSnapshot()` |
| `scripts/source-manager-test.ts` (create) | Unit test for restart bookkeeping with fake starters |
| `scripts/streams-api-test.mjs` (create) | Black-box: spawn server (sim), exercise `/api/streams` GET/POST/reconnect + persistence |
| `scripts/settings-ui-test.mjs` (create) | Self-hosted Playwright: Settings tab renders, loads, saves |

---

## Task 0: Version control setup (recommended)

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Create `.gitignore` (protect secrets BEFORE any `git add`)**

```gitignore
node_modules/
dist/
*.tsbuildinfo
.env
.env.local
server/streams.local.json
scripts/audit-shots/
```

- [ ] **Step 2: Initialize the repo and verify secrets are ignored**

Run:
```bash
git init
git check-ignore .env.local server/streams.local.json
```
Expected: both paths echoed back (proves they are ignored). If `git check-ignore` prints nothing, STOP and fix `.gitignore` before continuing.

- [ ] **Step 3: Initial commit of current state, then branch**

Run:
```bash
git add -A
git status   # confirm .env.local is NOT listed
git commit -m "chore: initial commit of market-bubble-vite

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git checkout -b feat/settings-stream-config
```
Expected: commit succeeds; `.env.local` absent from the commit.

---

## Task 1: Runtime config overlay (`server/runtime-config.ts`)

**Files:**
- Create: `server/runtime-config.ts`
- Test: `scripts/runtime-config-test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/runtime-config-test.ts`:
```ts
// Unit test for the runtime stream-settings overlay. Run: npx tsx scripts/runtime-config-test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRuntimeConfig } from '../server/runtime-config';

const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

const dir = mkdtempSync(path.join(tmpdir(), 'mb-rc-'));
const file = path.join(dir, 'streams.local.json');

try {
  // defaults come from env/config (TWITCH_CHANNEL_BANKS default is 'fazebanks')
  const rc = createRuntimeConfig({ filePath: file });
  check('default twitch banks present', typeof rc.getConfig().twitchChannels.banks === 'string');

  // update a twitch channel -> twitch is the only changed platform
  const r1 = rc.update({ twitchChannels: { banks: 'jynxzi' } });
  check('twitch change -> changedPlatforms=[twitch]', JSON.stringify(r1.changedPlatforms) === '["twitch"]');
  check('getConfig reflects new channel', rc.getConfig().twitchChannels.banks === 'jynxzi');

  // cookies are write-only: publicState hides them, exposes xCookiesSet
  rc.update({ xAuthToken: 'tok', xCt0: 'csrf', xEnabled: true });
  const pub = rc.publicState() as Record<string, unknown>;
  check('publicState hides auth token', !('xAuthToken' in pub) && !('xCt0' in pub));
  check('xCookiesSet true once both set', pub.xCookiesSet === true);
  check('getConfig exposes cookies server-side', rc.getConfig().x.authToken === 'tok');

  // empty cookie value = "keep existing", not "clear"
  rc.update({ xAuthToken: '' });
  check('empty cookie keeps existing', rc.getConfig().x.authToken === 'tok');

  // kick change -> kick platform
  const r2 = rc.update({ kickChatroomIds: { ansem: '999' } });
  check('kick chatroom change -> [kick]', JSON.stringify(r2.changedPlatforms) === '["kick"]');

  // persistence: a fresh store from the same file restores edits (file wins over env)
  const rc2 = createRuntimeConfig({ filePath: file });
  check('persisted twitch channel restored', rc2.getConfig().twitchChannels.banks === 'jynxzi');
  check('persisted cookie restored', rc2.getConfig().x.authToken === 'tok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/runtime-config-test.ts`
Expected: FAIL — `Cannot find module '../server/runtime-config'` (file not created yet).

- [ ] **Step 3: Implement `server/runtime-config.ts`**

```ts
// Mutable overlay of the OWNER-editable stream settings on top of the env-derived
// AppConfig. Precedence: persisted runtime file > .env.local > built-in defaults.
// Cookies (auth_token/ct0) are stored here but are WRITE-ONLY to the API:
// publicState() never returns them, only a boolean `xCookiesSet`.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Host, Platform } from '../shared/protocol';
import { loadConfig, type AppConfig } from './config';

const DEFAULT_FILE = path.resolve('server/streams.local.json');

export interface StreamSettings {
  twitchChannels: Record<Host, string>;
  kickSlugs: Record<Host, string>;
  kickChatroomIds: Record<Host, string>;
  xBroadcastIds: Record<Host, string>;
  xEnabled: boolean;
  xAuthToken: string;
  xCt0: string;
}

export interface StreamPublicState {
  twitchChannels: Record<Host, string>;
  kickSlugs: Record<Host, string>;
  kickChatroomIds: Record<Host, string>;
  xBroadcastIds: Record<Host, string>;
  xEnabled: boolean;
  xCookiesSet: boolean;
}

const hostMap = (inner: z.ZodString) => z.object({ banks: inner, ansem: inner }).partial();

// Patch from the API: every field optional; channels/slugs non-empty when present.
export const StreamPatchSchema = z
  .object({
    twitchChannels: hostMap(z.string().min(1, 'channel required')).optional(),
    kickSlugs: hostMap(z.string().min(1, 'slug required')).optional(),
    kickChatroomIds: hostMap(z.string()).optional(),
    xBroadcastIds: hostMap(z.string()).optional(),
    xEnabled: z.boolean().optional(),
    xAuthToken: z.string().optional(),
    xCt0: z.string().optional(),
  })
  .strict();
export type StreamPatch = z.infer<typeof StreamPatchSchema>;

export interface RuntimeConfig {
  getConfig(): AppConfig;
  publicState(): StreamPublicState;
  update(patch: StreamPatch): { changedPlatforms: Platform[] };
}

export function createRuntimeConfig(opts: { filePath?: string } = {}): RuntimeConfig {
  const filePath = opts.filePath ?? process.env.STREAMS_CONFIG_PATH ?? DEFAULT_FILE;
  const base = loadConfig();

  const settings: StreamSettings = {
    twitchChannels: { ...base.twitchChannels },
    kickSlugs: { ...base.kickSlugs },
    kickChatroomIds: { ...base.kickChatroomIds },
    xBroadcastIds: { ...base.x.broadcastIds },
    xEnabled: base.x.enabled,
    xAuthToken: base.x.authToken,
    xCt0: base.x.ct0,
  };

  // layer the persisted overrides (if any) on top of the env defaults
  if (existsSync(filePath)) {
    try {
      const saved = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<StreamSettings>;
      for (const host of ['banks', 'ansem'] as Host[]) {
        if (saved.twitchChannels?.[host]) settings.twitchChannels[host] = saved.twitchChannels[host]!;
        if (saved.kickSlugs?.[host]) settings.kickSlugs[host] = saved.kickSlugs[host]!;
        if (saved.kickChatroomIds?.[host] != null) settings.kickChatroomIds[host] = saved.kickChatroomIds[host]!;
        if (saved.xBroadcastIds?.[host] != null) settings.xBroadcastIds[host] = saved.xBroadcastIds[host]!;
      }
      if (typeof saved.xEnabled === 'boolean') settings.xEnabled = saved.xEnabled;
      if (saved.xAuthToken) settings.xAuthToken = saved.xAuthToken;
      if (saved.xCt0) settings.xCt0 = saved.xCt0;
    } catch {
      /* corrupt file: ignore, fall back to env defaults */
    }
  }

  function persist() {
    const tmp = filePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
    renameSync(tmp, filePath);
  }

  function getConfig(): AppConfig {
    return {
      ...base,
      twitchChannels: { ...settings.twitchChannels },
      kickSlugs: { ...settings.kickSlugs },
      kickChatroomIds: { ...settings.kickChatroomIds },
      x: {
        ...base.x,
        enabled: settings.xEnabled,
        authToken: settings.xAuthToken,
        ct0: settings.xCt0,
        broadcastIds: { ...settings.xBroadcastIds },
      },
    };
  }

  function publicState(): StreamPublicState {
    return {
      twitchChannels: { ...settings.twitchChannels },
      kickSlugs: { ...settings.kickSlugs },
      kickChatroomIds: { ...settings.kickChatroomIds },
      xBroadcastIds: { ...settings.xBroadcastIds },
      xEnabled: settings.xEnabled,
      xCookiesSet: !!(settings.xAuthToken && settings.xCt0),
    };
  }

  function update(patch: StreamPatch): { changedPlatforms: Platform[] } {
    const changed = new Set<Platform>();

    for (const host of ['banks', 'ansem'] as Host[]) {
      if (patch.twitchChannels?.[host] != null && patch.twitchChannels[host] !== settings.twitchChannels[host]) {
        settings.twitchChannels[host] = patch.twitchChannels[host]!;
        changed.add('twitch');
      }
      if (patch.kickSlugs?.[host] != null && patch.kickSlugs[host] !== settings.kickSlugs[host]) {
        settings.kickSlugs[host] = patch.kickSlugs[host]!;
        changed.add('kick');
      }
      if (patch.kickChatroomIds?.[host] != null && patch.kickChatroomIds[host] !== settings.kickChatroomIds[host]) {
        settings.kickChatroomIds[host] = patch.kickChatroomIds[host]!;
        changed.add('kick');
      }
      if (patch.xBroadcastIds?.[host] != null && patch.xBroadcastIds[host] !== settings.xBroadcastIds[host]) {
        settings.xBroadcastIds[host] = patch.xBroadcastIds[host]!;
        changed.add('x');
      }
    }
    if (typeof patch.xEnabled === 'boolean' && patch.xEnabled !== settings.xEnabled) {
      settings.xEnabled = patch.xEnabled;
      changed.add('x');
    }
    // cookies: only a NON-EMPTY value updates; empty/omitted keeps existing
    if (patch.xAuthToken && patch.xAuthToken !== settings.xAuthToken) {
      settings.xAuthToken = patch.xAuthToken;
      changed.add('x');
    }
    if (patch.xCt0 && patch.xCt0 !== settings.xCt0) {
      settings.xCt0 = patch.xCt0;
      changed.add('x');
    }

    persist();
    return { changedPlatforms: [...changed] };
  }

  return { getConfig, publicState, update };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/runtime-config-test.ts`
Expected: `ALL PASS`, exit 0.

- [ ] **Step 5: Typecheck and commit**

Run:
```bash
npm run typecheck
git add server/runtime-config.ts scripts/runtime-config-test.ts
git commit -m "feat(server): runtime stream-settings overlay with persistence

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
Expected: typecheck clean; commit succeeds.

---

## Task 2: Hub status snapshot (`server/hub.ts`)

**Files:**
- Modify: `server/hub.ts` (interface near line 23-30; impl in the returned object near line 141)
- Test: `scripts/hub-status-test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/hub-status-test.ts`:
```ts
// Run: npx tsx scripts/hub-status-test.ts
import { createHub } from '../server/hub';

const fails: string[] = [];
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) fails.push(name);
};

const hub = createHub();
check('defaults to unavailable', hub.statusSnapshot().twitch === 'unavailable');
hub.setStatus('twitch', 'ok');
check('reflects setStatus', hub.statusSnapshot().twitch === 'ok');
const snap = hub.statusSnapshot();
snap.twitch = 'reconnecting';
check('returns a copy (no external mutation)', hub.statusSnapshot().twitch === 'ok');

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/hub-status-test.ts`
Expected: FAIL — `hub.statusSnapshot is not a function`.

- [ ] **Step 3: Add `statusSnapshot` to the `Hub` interface**

In `server/hub.ts`, in the `export interface Hub { ... }` block, add after the `setStatus` line:
```ts
  statusSnapshot(): StatusMap;
```

- [ ] **Step 4: Implement it in the returned object**

In `server/hub.ts`, in the object returned by `createHub`, add a method (next to `setStatus`):
```ts
    statusSnapshot() {
      return { ...status };
    },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx scripts/hub-status-test.ts`
Expected: `ALL PASS`.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add server/hub.ts scripts/hub-status-test.ts
git commit -m "feat(server): expose hub.statusSnapshot()

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Source manager + sources refactor

**Files:**
- Create: `server/source-manager.ts`
- Modify: `server/sources-real.ts` (full rewrite of the body)
- Modify: `server/sources.ts` (full rewrite)
- Test: `scripts/source-manager-test.ts`

- [ ] **Step 1: Write the failing test (restart bookkeeping with fake starters)**

Create `scripts/source-manager-test.ts`:
```ts
// Run: npx tsx scripts/source-manager-test.ts
import { createSourceManager, type SourceStarter } from '../server/source-manager';
import { createRuntimeConfig } from '../server/runtime-config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fails: string[] = [];
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) fails.push(name);
};

const dir = mkdtempSync(path.join(tmpdir(), 'mb-sm-'));
const rc = createRuntimeConfig({ filePath: path.join(dir, 's.json') });

const log: string[] = [];
const seenChannels: string[] = [];
function fake(name: string): SourceStarter {
  return (_hub, config) => {
    log.push('start:' + name);
    if (name === 'twitch') seenChannels.push(config.twitchChannels.banks);
    return () => log.push('stop:' + name);
  };
}

const hub = {} as never; // fakes ignore the hub
const mgr = createSourceManager(hub, rc, {
  twitch: fake('twitch'),
  kick: fake('kick'),
  x: fake('x'),
});

try {
  mgr.startAll();
  check('startAll starts all three', log.filter((l) => l.startsWith('start:')).length === 3);

  log.length = 0;
  rc.update({ twitchChannels: { banks: 'newchan' } });
  await mgr.restart('twitch');
  check('restart stops then starts the platform', JSON.stringify(log) === '["stop:twitch","start:twitch"]');
  check('restart uses fresh config', seenChannels[seenChannels.length - 1] === 'newchan');

  log.length = 0;
  await mgr.stopAll();
  check('stopAll stops remaining sources', log.filter((l) => l.startsWith('stop:')).length === 3);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/source-manager-test.ts`
Expected: FAIL — `Cannot find module '../server/source-manager'`.

- [ ] **Step 3: Implement `server/source-manager.ts`**

```ts
// Owns each platform's source (chat adapter + viewer poller). Lets the API
// restart ONE platform with fresh config without restarting the process.
import type { AppConfig } from './config';
import type { Hub } from './hub';
import type { Platform } from '../shared/protocol';
import type { RuntimeConfig } from './runtime-config';

const PLATFORMS: Platform[] = ['twitch', 'kick', 'x'];

// A starter boots one platform and returns its stop function.
export type SourceStarter = (hub: Hub, config: AppConfig) => () => void | Promise<void>;

export interface SourceManager {
  startAll(): void;
  restart(platform: Platform): Promise<void>;
  stopAll(): Promise<void>;
}

export function createSourceManager(
  hub: Hub,
  runtime: RuntimeConfig,
  starters: Record<Platform, SourceStarter>,
): SourceManager {
  const stops: Partial<Record<Platform, () => void | Promise<void>>> = {};

  function startOne(p: Platform) {
    stops[p] = starters[p](hub, runtime.getConfig());
  }
  async function stopOne(p: Platform) {
    const stop = stops[p];
    if (!stop) return;
    delete stops[p];
    await stop();
  }

  return {
    startAll() {
      for (const p of PLATFORMS) startOne(p);
    },
    async restart(p) {
      await stopOne(p);
      startOne(p);
    },
    async stopAll() {
      for (const p of PLATFORMS) await stopOne(p);
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/source-manager-test.ts`
Expected: `ALL PASS`.

- [ ] **Step 5: Rewrite `server/sources-real.ts` to build the starters + manager**

Replace the entire contents of `server/sources-real.ts` with:
```ts
// Real platform sources behind a SourceManager so each platform can be
// reconnected independently when the owner edits its target in Settings.
import type { Hub } from './hub';
import type { Host } from '../shared/protocol';
import type { RuntimeConfig } from './runtime-config';
import { createSourceManager, type SourceManager, type SourceStarter } from './source-manager';
import { createTwitchIrcAdapter } from './adapters/twitch-irc';
import { createKickPusherAdapter } from './adapters/kick-pusher';
import { startTwitchViewerPoller } from './pollers/twitch-viewers';
import { startKickViewerPoller } from './pollers/kick-viewers';
import { startXSource } from './adapters/x-broadcast';
import { scoped } from './lib/log';

const log = scoped('sources');

const twitchStarter: SourceStarter = (hub, config) => {
  const channels: Record<string, Host> = {
    [config.twitchChannels.banks.toLowerCase()]: 'banks',
    [config.twitchChannels.ansem.toLowerCase()]: 'ansem',
  };
  const adapter = createTwitchIrcAdapter(channels, {
    onMessage: (m) => hub.ingestMessage(m),
    onStatus: (s) => hub.setStatus('twitch', s),
    onRemove: (sel) => hub.removeMessages('twitch', sel),
  });
  adapter.start();
  const stopPoller = startTwitchViewerPoller(hub, config);
  return () => {
    adapter.stop();
    stopPoller();
  };
};

const kickStarter: SourceStarter = (hub, config) => {
  const adapter = createKickPusherAdapter(config, {
    onMessage: (m) => hub.ingestMessage(m),
    onStatus: (s) => hub.setStatus('kick', s),
    onRemove: (sel) => hub.removeMessages('kick', sel),
  });
  adapter.start();
  const stopPoller = startKickViewerPoller(hub, config);
  return () => {
    adapter.stop();
    stopPoller();
  };
};

// startXSource already owns BOTH X chat and X viewer polling.
const xStarter: SourceStarter = (hub, config) => startXSource(hub, config);

export function startRealSources(hub: Hub, runtime: RuntimeConfig): SourceManager {
  const manager = createSourceManager(hub, runtime, {
    twitch: twitchStarter,
    kick: kickStarter,
    x: xStarter,
  });
  manager.startAll();
  log('real sources started');
  return manager;
}
```

- [ ] **Step 6: Rewrite `server/sources.ts` to return `{ stop, manager }`**

Replace the entire contents of `server/sources.ts` with:
```ts
// Decides which sources feed the hub: the dev simulator (no manager — sim has no
// per-source reconnect), or the real adapters behind a SourceManager.
import type { Hub } from './hub';
import type { RuntimeConfig } from './runtime-config';
import type { SourceManager } from './source-manager';
import { startSim } from './adapters/sim';
import { startRealSources } from './sources-real';

export interface StartedSources {
  stop: () => void | Promise<void>;
  manager: SourceManager | null;
}

export function startSources(hub: Hub, runtime: RuntimeConfig): StartedSources {
  const config = runtime.getConfig();
  if (config.sim.mode) {
    const stop = startSim(hub, config);
    return { stop, manager: null };
  }
  const manager = startRealSources(hub, runtime);
  return { stop: () => manager.stopAll(), manager };
}
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean. (`server/index.ts` still compiles — it calls `startSources` whose return changed from a function to `{ stop, manager }`; if `tsc` flags `index.ts`, that is fixed in Task 4. If typecheck fails ONLY on `server/index.ts` line ~134 `stopSources`, that is expected here — proceed; Task 4 fixes index.ts. If it fails elsewhere, stop and fix.)

- [ ] **Step 8: Commit**

```bash
git add server/source-manager.ts server/sources-real.ts server/sources.ts scripts/source-manager-test.ts
git commit -m "feat(server): per-platform SourceManager for independent reconnect

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wire RuntimeConfig into the server + `GET /api/streams`

**Files:**
- Modify: `server/index.ts` (full rewrite of the file)
- Test: `scripts/streams-api-test.mjs` (GET portion)

- [ ] **Step 1: Write the failing test (GET shape + no secret leak)**

Create `scripts/streams-api-test.mjs`:
```mjs
// Black-box test of /api/streams. Spawns its own server in SIM mode with an
// isolated streams file, then drives the HTTP surface.
// Run: node scripts/streams-api-test.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

const dir = mkdtempSync(path.join(tmpdir(), 'mb-api-'));
const streamsFile = path.join(dir, 'streams.local.json');
const PORT = 3457;
const base = `http://localhost:${PORT}`;

function startServer() {
  const child = spawn('npx', ['tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), SIM_MODE: '1', STREAMS_CONFIG_PATH: streamsFile, NODE_ENV: 'production' },
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return child;
}
async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(base + '/api/streams');
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let child = startServer();
try {
  if (!(await waitReady())) throw new Error('server did not start');

  const get = await (await fetch(base + '/api/streams')).json();
  check('GET returns twitchChannels', !!get.twitchChannels?.banks);
  check('GET returns xCookiesSet boolean', typeof get.xCookiesSet === 'boolean');
  check('GET never returns cookies', !('xAuthToken' in get) && !('xCt0' in get));
  check('GET returns per-source status', !!get.status && 'twitch' in get.status);

  // ---- POST/persistence assertions are added in Task 5; keep the GET ones here.
} finally {
  child.kill();
  rmSync(dir, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/streams-api-test.mjs`
Expected: FAIL — server starts but `/api/streams` 404s (route not implemented), so `waitReady` times out → "server did not start".

- [ ] **Step 3: Rewrite `server/index.ts`**

Replace the entire contents of `server/index.ts` with:
```ts
import './env'; // must be first: loads .env before anything reads process.env

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import type { ViteDevServer } from 'vite';

import type { HostAvatars, Platform } from '../shared/protocol';
import { createHub, type Hub } from './hub';
import { createGateway } from './ws-gateway';
import { startSources } from './sources';
import { createRuntimeConfig, StreamPatchSchema } from './runtime-config';
import type { RuntimeConfig } from './runtime-config';
import type { SourceManager } from './source-manager';
import { fetchHostAvatars } from './lib/avatars';
import { scoped } from './lib/log';
import { z } from 'zod';

const log = scoped('server');

interface ApiDeps {
  runtime: RuntimeConfig;
  hub: Hub;
  getManager: () => SourceManager | null;
  getAvatars: () => HostAvatars;
}

const ReconnectSchema = z.object({
  platform: z.enum(['twitch', 'kick', 'x', 'all']),
});

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

// Minimal CSRF guard: browsers send Origin on cross-site POSTs; reject mismatches.
// Non-browser clients (our tests, curl) send no Origin and are allowed.
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooBig = false;
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooBig) return reject(new Error('body too large'));
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req: IncomingMessage, res: ServerResponse, deps: ApiDeps): Promise<boolean> {
  let pathname = '/';
  try {
    pathname = new URL(req.url || '/', 'http://internal').pathname;
  } catch {
    /* fall through to '/' */
  }
  if (!pathname.startsWith('/api/')) return false;
  const method = req.method || 'GET';
  const config = deps.runtime.getConfig();

  // boot bootstrap consumed by src/main.tsx
  if (pathname === '/api/config' && (method === 'GET' || method === 'HEAD')) {
    const body = JSON.stringify({
      twitchChannels: config.twitchChannels,
      xEnabled: config.x.enabled,
      hostAvatars: deps.getAvatars(),
    });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(method === 'HEAD' ? undefined : body);
    return true;
  }

  // settings surface: non-secret editable state + live status
  if (pathname === '/api/streams' && (method === 'GET' || method === 'HEAD')) {
    const body = JSON.stringify({ ...deps.runtime.publicState(), status: deps.hub.statusSnapshot() });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(method === 'HEAD' ? undefined : body);
    return true;
  }

  if (pathname === '/api/streams' && method === 'POST') {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'forbidden' }), true;
    let raw: unknown;
    try {
      raw = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: 'invalid json' }), true;
    }
    const parsed = StreamPatchSchema.safeParse(raw);
    if (!parsed.success) {
      return sendJson(res, 400, { error: 'invalid input', fields: parsed.error.flatten().fieldErrors }), true;
    }
    const { changedPlatforms } = deps.runtime.update(parsed.data);
    const mgr = deps.getManager();
    if (mgr) {
      for (const p of changedPlatforms) await mgr.restart(p);
    }
    return sendJson(res, 200, {
      ...deps.runtime.publicState(),
      status: deps.hub.statusSnapshot(),
      reconnected: mgr ? changedPlatforms : [],
    }), true;
  }

  if (pathname === '/api/streams/reconnect' && method === 'POST') {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'forbidden' }), true;
    let raw: unknown;
    try {
      raw = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: 'invalid json' }), true;
    }
    const parsed = ReconnectSchema.safeParse(raw);
    if (!parsed.success) return sendJson(res, 400, { error: 'invalid platform' }), true;
    const mgr = deps.getManager();
    if (mgr) {
      const targets: Platform[] = parsed.data.platform === 'all' ? ['twitch', 'kick', 'x'] : [parsed.data.platform];
      for (const p of targets) await mgr.restart(p);
    }
    return sendJson(res, 200, { ok: true, status: deps.hub.statusSnapshot() }), true;
  }

  const known =
    pathname === '/api/config' || pathname === '/api/streams' || pathname === '/api/streams/reconnect';
  return sendJson(res, known ? 405 : 404, { error: known ? 'Method Not Allowed' : 'Not Found' }), true;
}

async function main() {
  const runtime = createRuntimeConfig();
  const config = runtime.getConfig();
  const dev = process.env.NODE_ENV !== 'production';
  const hostname = process.env.HOSTNAME || 'localhost';
  const port = config.port;

  const hub = createHub();
  let started: { stop: () => void | Promise<void>; manager: SourceManager | null } | null = null;

  let hostAvatars: HostAvatars = {};
  const avatarsReady = fetchHostAvatars(config)
    .then((a) => {
      hostAvatars = a;
    })
    .catch(() => {
      /* fail-soft: letters */
    });

  const deps: ApiDeps = {
    runtime,
    hub,
    getManager: () => started?.manager ?? null,
    getAvatars: () => hostAvatars,
  };

  let webHandler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => {
    res.statusCode = 503;
    res.end('starting');
  };

  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (await handleApi(req, res, deps)) return;
        webHandler(req, res);
      } catch (err) {
        log.error('request failed', (err as Error).message);
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal' }));
        }
      }
    })();
  });

  let vite: ViteDevServer | null = null;
  if (dev) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    });
    const middlewares = vite.middlewares;
    webHandler = (req, res) =>
      middlewares(req, res, () => {
        res.statusCode = 404;
        res.end('Not Found');
      });
  } else {
    const { default: sirv } = await import('sirv');
    const serve = sirv(path.resolve('dist'), { etag: true, single: true });
    webHandler = (req, res) =>
      serve(req, res, () => {
        res.statusCode = 404;
        res.end('Not Found');
      });
  }

  const wss = new WebSocketServer({ noServer: true });
  const gateway = createGateway(hub);

  server.on('upgrade', (req, socket: Duplex, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url || '/', `http://${req.headers.host || hostname}`).pathname;
    } catch {
      /* fall through to '/' */
    }
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket as Socket, head, (ws) => gateway.handleConnection(ws));
      return;
    }
    if (dev && req.headers['sec-websocket-protocol'] === 'vite-hmr') return;
    socket.destroy();
  });

  started = startSources(hub, runtime);

  await Promise.race([
    avatarsReady,
    new Promise<void>((resolve) => {
      setTimeout(resolve, 5000).unref();
    }),
  ]);

  server.listen(port, () => {
    log(`ready on http://${hostname}:${port}  (dev=${dev}, sim=${config.sim.mode})`);
  });

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received, shutting down`);
    try {
      await started?.stop();
    } catch {
      /* noop */
    }
    gateway.close();
    wss.close();
    try {
      await vite?.close();
    } catch {
      /* noop */
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('fatal', err);
  process.exit(1);
});
```

- [ ] **Step 4: Run the GET test to verify it passes**

Run: `node scripts/streams-api-test.mjs`
Expected: `ALL PASS` (the four GET checks).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add server/index.ts scripts/streams-api-test.mjs
git commit -m "feat(server): GET /api/streams + RuntimeConfig wiring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `POST /api/streams` behavior + persistence (test only — route already built in Task 4)

**Files:**
- Modify: `scripts/streams-api-test.mjs` (add POST + persistence checks)

> The POST and reconnect routes were implemented in Task 4's `index.ts` rewrite. This task proves their behavior and persistence with black-box assertions.

- [ ] **Step 1: Add POST/persistence assertions to the test**

In `scripts/streams-api-test.mjs`, replace the line:
```mjs
  // ---- POST/persistence assertions are added in Task 5; keep the GET ones here.
```
with:
```mjs
  // ---- POST changes a value and GET reflects it
  const post1 = await fetch(base + '/api/streams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ twitchChannels: { banks: 'xqc' } }),
  });
  const post1Body = await post1.json();
  check('POST 200', post1.status === 200, `status=${post1.status}`);
  check('POST echoes new channel', post1Body.twitchChannels?.banks === 'xqc');
  check('POST never echoes cookies', !('xAuthToken' in post1Body));

  // ---- cookies are write-only: set them, GET shows xCookiesSet but not the values
  await fetch(base + '/api/streams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ xAuthToken: 'secret-tok', xCt0: 'secret-csrf', xEnabled: true }),
  });
  const afterCookies = await (await fetch(base + '/api/streams')).json();
  check('xCookiesSet flips true', afterCookies.xCookiesSet === true);
  check('cookies absent from GET after set', !('xAuthToken' in afterCookies) && !('xCt0' in afterCookies));

  // ---- invalid input -> 400
  const bad = await fetch(base + '/api/streams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ twitchChannels: { banks: '' } }),
  });
  check('empty channel -> 400', bad.status === 400, `status=${bad.status}`);

  // ---- reconnect endpoint accepts a valid platform / rejects bad
  const rc = await fetch(base + '/api/streams/reconnect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'x' }),
  });
  check('reconnect 200', rc.status === 200, `status=${rc.status}`);
  const rcBad = await fetch(base + '/api/streams/reconnect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'nope' }),
  });
  check('reconnect bad platform -> 400', rcBad.status === 400, `status=${rcBad.status}`);

  // ---- unknown /api path still 404 (audit.mjs relies on this)
  const gone = await fetch(base + '/api/chat/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  check('unknown /api 404', gone.status === 404, `status=${gone.status}`);

  // ---- persistence: the settings file was written, and a reboot restores it
  check('streams file written', existsSync(streamsFile));
  check('file holds the channel', JSON.parse(readFileSync(streamsFile, 'utf8')).twitchChannels?.banks === 'xqc');
  child.kill();
  await new Promise((r) => setTimeout(r, 1000));
  child = startServer();
  if (!(await waitReady())) throw new Error('server did not restart');
  const afterReboot = await (await fetch(base + '/api/streams')).json();
  check('reboot restores persisted channel', afterReboot.twitchChannels?.banks === 'xqc');
  check('reboot restores xCookiesSet', afterReboot.xCookiesSet === true);
```

- [ ] **Step 2: Run the full black-box test**

Run: `node scripts/streams-api-test.mjs`
Expected: `ALL PASS` (GET, POST, cookies, validation, reconnect, 404, persistence, reboot).

- [ ] **Step 3: Commit**

```bash
git add scripts/streams-api-test.mjs
git commit -m "test(server): POST /api/streams behavior + persistence

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Settings nav tab + view shell

**Files:**
- Modify: `components/TopBar.tsx`
- Modify: `components/MarketBubbleApp.tsx`
- Create: `components/SettingsView.tsx` (shell)
- Test: `scripts/settings-ui-test.mjs` (shell render)

- [ ] **Step 1: Write the failing self-hosted UI test**

Create `scripts/settings-ui-test.mjs`:
```mjs
// Self-hosted Playwright test of the Settings page. Spawns its own SIM-mode
// server with an isolated streams file. Run: node scripts/settings-ui-test.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

const dir = mkdtempSync(path.join(tmpdir(), 'mb-ui-'));
const PORT = 3458;
const base = `http://localhost:${PORT}`;
const child = spawn('npx', ['tsx', 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SIM_MODE: '1', STREAMS_CONFIG_PATH: path.join(dir, 's.json'), NODE_ENV: 'production' },
  stdio: 'ignore',
  shell: process.platform === 'win32',
});
async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + '/api/streams')).ok) return true;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let browser;
try {
  if (!(await waitReady())) throw new Error('server did not start');
  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForTimeout(500);
  check('settings view renders', await page.locator('.settings-view').isVisible());
  check('settings tab active', (await page.locator('.mode-tab.is-active').textContent())?.trim() === 'Settings');
} finally {
  if (browser) await browser.close();
  child.kill();
  rmSync(dir, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/settings-ui-test.mjs`
Expected: FAIL — no "Settings" button exists yet.

- [ ] **Step 3: Add `'settings'` to `Mode` and a tab in `components/TopBar.tsx`**

Change the `Mode` type:
```ts
export type Mode = 'watch' | 'dashboard' | 'settings';
```
Change the `tabs` array inside `ModeTabs`:
```ts
  const tabs: [Mode, string][] = [
    ['watch', 'Watch'],
    ['dashboard', 'Dashboard'],
    ['settings', 'Settings'],
  ];
```

- [ ] **Step 4: Create the `components/SettingsView.tsx` shell**

```tsx
import type { StatusMap } from '@/shared/protocol';

// Shell first (Task 6); the form + data loading land in Tasks 7-8.
export function SettingsView({ status }: { status: StatusMap }) {
  return (
    <div className="settings-view">
      <h1 className="settings-title">Stream settings</h1>
      <p className="settings-sub">
        Twitch {status.twitch} · Kick {status.kick} · X {status.x}
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Route the `settings` mode in `components/MarketBubbleApp.tsx`**

Add the import near the other view imports:
```ts
import { SettingsView } from './SettingsView';
```
Update the persisted-mode restore effect so `'settings'` is accepted:
```ts
    if (stored === 'watch' || stored === 'dashboard' || stored === 'settings') setMode(stored);
```
Replace the `mode === 'watch' ? (...) : (<DashboardView ... />)` body with a three-way branch:
```tsx
      {mode === 'settings' ? (
        <SettingsView status={agg.status} />
      ) : mode === 'watch' ? (
        <WatchView
          channels={twitchChannels}
          mainHost={mainHost}
          live={agg.live}
          onSwap={swapHost}
          viewers={agg.viewers}
          messages={agg.messages}
          sources={sources}
          status={agg.status}
          onToggleSource={toggleSource}
          chatHidden={chatHidden}
          onHideChat={hideChat}
          onShowChat={showChat}
          onPopout={popoutChat}
        />
      ) : (
        <DashboardView
          viewers={agg.viewers}
          history={agg.history}
          messages={agg.messages}
          sources={sources}
          msgsPerMin={agg.msgsPerMin}
        />
      )}
```

- [ ] **Step 6: Run the UI test to verify it passes**

Run: `node scripts/settings-ui-test.mjs`
Expected: `ALL PASS` (settings view renders, tab active).

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add components/TopBar.tsx components/MarketBubbleApp.tsx components/SettingsView.tsx scripts/settings-ui-test.mjs
git commit -m "feat(ui): Settings nav tab + view shell

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Settings form — load + render fields

**Files:**
- Modify: `components/SettingsView.tsx` (full rewrite)
- Modify: `scripts/settings-ui-test.mjs` (assert fields populate)

- [ ] **Step 1: Add field-population assertions to the UI test**

In `scripts/settings-ui-test.mjs`, immediately after the existing `check('settings tab active', ...)` line, add:
```mjs
  await page.waitForSelector('.settings-form', { timeout: 5000 });
  const twitchBanks = await page.inputValue('#twitch-banks');
  check('twitch banks field populated from GET', twitchBanks.length > 0, `value=${twitchBanks}`);
  check('x broadcast field present', await page.locator('#x-banks').count() === 1);
  check('cookie field is password type', (await page.getAttribute('#x-auth-token', 'type')) === 'password');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/settings-ui-test.mjs`
Expected: FAIL — `.settings-form` / `#twitch-banks` not found (shell has no form yet).

- [ ] **Step 3: Rewrite `components/SettingsView.tsx` with the form (load only)**

```tsx
import { useEffect, useState } from 'react';
import type { Host, StatusMap } from '@/shared/protocol';

interface StreamsState {
  twitchChannels: Record<Host, string>;
  kickSlugs: Record<Host, string>;
  kickChatroomIds: Record<Host, string>;
  xBroadcastIds: Record<Host, string>;
  xEnabled: boolean;
  xCookiesSet: boolean;
}

const HOSTS: Host[] = ['banks', 'ansem'];
const HOST_LABEL: Record<Host, string> = { banks: 'Banks', ansem: 'Ansem' };

function dot(status: string) {
  return <span className={'set-status-dot set-' + status} title={status} />;
}

export function SettingsView({ status }: { status: StatusMap }) {
  const [form, setForm] = useState<StreamsState | null>(null);
  const [authToken, setAuthToken] = useState('');
  const [ct0, setCt0] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/streams')
      .then((r) => r.json())
      .then((data: StreamsState) => {
        if (alive) setForm(data);
      })
      .catch(() => {
        /* leave loading */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!form) {
    return (
      <div className="settings-view">
        <h1 className="settings-title">Stream settings</h1>
        <p className="settings-sub">Loading…</p>
      </div>
    );
  }

  const setHost = (key: keyof StreamsState, host: Host, value: string) =>
    setForm((f) => (f ? { ...f, [key]: { ...(f[key] as Record<Host, string>), [host]: value } } : f));

  return (
    <div className="settings-view">
      <h1 className="settings-title">Stream settings</h1>
      <p className="settings-sub">Edit a target and save — only that platform reconnects. No restart.</p>

      <form className="settings-form" onSubmit={(e) => e.preventDefault()}>
        {HOSTS.map((host) => (
          <fieldset className="settings-group" key={host}>
            <legend>{HOST_LABEL[host]} slot</legend>

            <label htmlFor={`twitch-${host}`}>Twitch channel {dot(status.twitch)}</label>
            <input
              id={`twitch-${host}`}
              value={form.twitchChannels[host]}
              onChange={(e) => setHost('twitchChannels', host, e.target.value)}
            />

            <label htmlFor={`kick-${host}`}>Kick slug {dot(status.kick)}</label>
            <input
              id={`kick-${host}`}
              value={form.kickSlugs[host]}
              onChange={(e) => setHost('kickSlugs', host, e.target.value)}
            />

            <label htmlFor={`kickroom-${host}`}>Kick chatroom id</label>
            <input
              id={`kickroom-${host}`}
              value={form.kickChatroomIds[host]}
              onChange={(e) => setHost('kickChatroomIds', host, e.target.value)}
              placeholder="Kick blocks auto-lookup here — paste the id"
            />

            <label htmlFor={`x-${host}`}>X broadcast URL {dot(status.x)}</label>
            <input
              id={`x-${host}`}
              value={form.xBroadcastIds[host]}
              onChange={(e) => setHost('xBroadcastIds', host, e.target.value)}
              placeholder="x.com/i/broadcasts/… or bare id"
            />
          </fieldset>
        ))}

        <fieldset className="settings-group">
          <legend>X account (shared)</legend>

          <label className="settings-check">
            <input
              type="checkbox"
              checked={form.xEnabled}
              onChange={(e) => setForm((f) => (f ? { ...f, xEnabled: e.target.checked } : f))}
            />
            X enabled
          </label>

          <label htmlFor="x-auth-token">auth_token</label>
          <input
            id="x-auth-token"
            type="password"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            placeholder={form.xCookiesSet ? 'saved — type to replace' : 'paste auth_token cookie'}
          />

          <label htmlFor="x-ct0">ct0</label>
          <input
            id="x-ct0"
            type="password"
            value={ct0}
            onChange={(e) => setCt0(e.target.value)}
            placeholder={form.xCookiesSet ? 'saved — type to replace' : 'paste ct0 cookie'}
          />
        </fieldset>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run the UI test to verify it passes**

Run: `node scripts/settings-ui-test.mjs`
Expected: `ALL PASS` (fields populate, X field present, cookie field is `password`).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add components/SettingsView.tsx scripts/settings-ui-test.mjs
git commit -m "feat(ui): Settings form loads + renders per-host fields

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Settings form — save + reconnect

**Files:**
- Modify: `components/SettingsView.tsx` (add save logic + buttons)
- Modify: `scripts/settings-ui-test.mjs` (assert save round-trip)

- [ ] **Step 1: Add a save round-trip assertion to the UI test**

In `scripts/settings-ui-test.mjs`, immediately after the `check('cookie field is password type', ...)` line, add:
```mjs
  await page.fill('#twitch-banks', 'sodapoppin');
  await page.getByRole('button', { name: 'Save & reconnect' }).click();
  await page.waitForSelector('.settings-saved', { timeout: 5000 });
  check('save shows confirmation', await page.locator('.settings-saved').isVisible());
  const persisted = await (await fetch(base + '/api/streams')).json();
  check('save persisted via API', persisted.twitchChannels.banks === 'sodapoppin', `value=${persisted.twitchChannels.banks}`);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/settings-ui-test.mjs`
Expected: FAIL — no "Save & reconnect" button / `.settings-saved` yet.

- [ ] **Step 3: Add save state, handler, and buttons to `components/SettingsView.tsx`**

Add these state hooks right after the existing `const [ct0, setCt0] = useState('');` line:
```tsx
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState<StreamsState | null>(null);
```
In the `.then((data: StreamsState) => { ... })` of the existing `useEffect`, set the baseline too — change that block to:
```tsx
      .then((data: StreamsState) => {
        if (alive) {
          setForm(data);
          setLoaded(data);
        }
      })
```
Add the save handler just before the `if (!form)` guard:
```tsx
  async function save() {
    if (!form || !loaded) return;
    setSaving(true);
    setSaved(false);
    setError('');
    const patch: Record<string, unknown> = {};
    const hostKeys: (keyof StreamsState)[] = ['twitchChannels', 'kickSlugs', 'kickChatroomIds', 'xBroadcastIds'];
    for (const key of hostKeys) {
      const cur = form[key] as Record<Host, string>;
      const was = loaded[key] as Record<Host, string>;
      const diff: Partial<Record<Host, string>> = {};
      for (const host of HOSTS) if (cur[host] !== was[host]) diff[host] = cur[host];
      if (Object.keys(diff).length) patch[key] = diff;
    }
    if (form.xEnabled !== loaded.xEnabled) patch.xEnabled = form.xEnabled;
    if (authToken) patch.xAuthToken = authToken; // omit when empty => keep existing
    if (ct0) patch.xCt0 = ct0;

    try {
      const res = await fetch('/api/streams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'save failed');
      } else {
        setForm(data);
        setLoaded(data);
        setAuthToken('');
        setCt0('');
        setSaved(true);
      }
    } catch {
      setError('network error');
    } finally {
      setSaving(false);
    }
  }

  async function reconnectAll() {
    await fetch('/api/streams/reconnect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'all' }),
    }).catch(() => {});
  }
```
Add the action row just before the closing `</form>` tag:
```tsx
        <div className="settings-actions">
          <button type="button" className="settings-save" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save & reconnect'}
          </button>
          <button type="button" className="settings-reconnect" onClick={reconnectAll}>
            Reconnect all
          </button>
          {saved && <span className="settings-saved">Saved ✓</span>}
          {error && <span className="settings-error">{error}</span>}
        </div>
```

- [ ] **Step 4: Run the UI test to verify it passes**

Run: `node scripts/settings-ui-test.mjs`
Expected: `ALL PASS` (save shows confirmation, value persisted via API).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add components/SettingsView.tsx scripts/settings-ui-test.mjs
git commit -m "feat(ui): Settings save sends changed fields + reconnect

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Styles + final regression

**Files:**
- Modify: `src/globals.css` (append a settings section)

- [ ] **Step 1: Append settings styles to `src/globals.css`**

Add at the end of `src/globals.css`:
```css
/* ───────── Settings view ───────── */
.settings-view {
  max-width: 720px;
  margin: 0 auto;
  padding: 28px 20px 60px;
}
.settings-title {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 4px;
}
.settings-sub {
  color: var(--muted, #8b8b94);
  margin: 0 0 22px;
  font-size: 13px;
}
.settings-form {
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.settings-group {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 16px 18px;
  display: grid;
  gap: 8px;
}
.settings-group legend {
  padding: 0 8px;
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--muted, #8b8b94);
}
.settings-group label {
  font-size: 12px;
  color: var(--muted, #8b8b94);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.settings-group input[type='text'],
.settings-group input:not([type]),
.settings-group input[type='password'] {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 9px 11px;
  color: inherit;
  font: inherit;
  font-size: 14px;
}
.settings-group input:focus {
  outline: none;
  border-color: rgba(120, 170, 255, 0.7);
}
.settings-check {
  flex-direction: row !important;
  font-size: 14px !important;
  color: inherit !important;
}
.set-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  background: #7a7a82;
}
.set-status-dot.set-ok {
  background: #3fb950;
}
.set-status-dot.set-reconnecting {
  background: #d29922;
  animation: set-pulse 1s ease-in-out infinite;
}
.set-status-dot.set-unavailable {
  background: #6e6e76;
}
@keyframes set-pulse {
  50% {
    opacity: 0.35;
  }
}
.settings-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 4px;
}
.settings-save,
.settings-reconnect {
  border-radius: 8px;
  padding: 10px 18px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.16);
}
.settings-save {
  background: #4664ff;
  color: #fff;
  border-color: transparent;
}
.settings-save:disabled {
  opacity: 0.6;
  cursor: default;
}
.settings-reconnect {
  background: transparent;
  color: inherit;
}
.settings-saved {
  color: #3fb950;
  font-size: 13px;
}
.settings-error {
  color: #f85149;
  font-size: 13px;
}
```

- [ ] **Step 2: Visual smoke check**

Run: `npm run dev:sim`
Then open `http://localhost:3000`, click **Settings**. Confirm: fields are populated, three groups render, cookie fields show "paste …" placeholders, status dots show green in sim. Stop the dev server (Ctrl+C).

- [ ] **Step 3: Full regression**

Run each and confirm the expected result:
```bash
npm run typecheck            # clean
npm run lint                 # clean
npx tsx scripts/runtime-config-test.ts     # ALL PASS
npx tsx scripts/hub-status-test.ts         # ALL PASS
npx tsx scripts/source-manager-test.ts     # ALL PASS
node scripts/streams-api-test.mjs          # ALL PASS
node scripts/settings-ui-test.mjs          # ALL PASS
```
Then run the existing functional audit against a sim server:
```bash
# terminal 1
npm run dev:sim
# terminal 2
node scripts/audit.mjs       # ALL PASS (existing checks unaffected)
```

- [ ] **Step 4: Commit**

```bash
git add src/globals.css
git commit -m "feat(ui): Settings view styles + final regression

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to decide how to integrate `feat/settings-stream-config` (merge to the initial branch, or leave for review).

---

## Self-review (completed during planning)

**Spec coverage:**
- Settings tab (all 3 platforms × 2 hosts + shared X account) → Tasks 6, 7.
- `runtime-config.ts` overlay + precedence + persistence → Task 1.
- Per-source manager, only changed platform reconnects → Tasks 3, 5.
- `GET`/`POST /api/streams` + write-only cookies (`xCookiesSet`, never the token) → Tasks 4, 5.
- `POST /api/streams/reconnect` → Task 4 (route), Task 5 (test), Task 8 (button).
- Same-origin guard + JSON body cap → Task 4.
- Live status from existing `/ws` feed (`agg.status` passed to `SettingsView`) → Task 6.
- Persistence file is a local secret → Task 0 `.gitignore`.
- Kick chatroom-id stays a manual field → Task 7.
- `STREAMS_CONFIG_PATH` override for isolated tests → Task 1.
- Existing `/api/*` 404/405 behavior preserved (audit) → Task 4 `known` check + Task 5 assertion.

**Placeholder scan:** none — every code/test/command step is concrete.

**Type consistency:** `RuntimeConfig`, `StreamPatch`/`StreamPatchSchema`, `StreamPublicState`, `SourceManager`, `SourceStarter`, `Platform`, `Host`, `StatusMap` are defined in Tasks 1–3 and used identically in Tasks 4–8. The client `StreamsState` mirrors `StreamPublicState`. `hub.statusSnapshot()` is named identically in Task 2 (def) and Tasks 4/6 (use).

**Known limitation (documented in spec):** host avatars are boot-only, so changing a channel won't refresh the avatar until a manual restart.
