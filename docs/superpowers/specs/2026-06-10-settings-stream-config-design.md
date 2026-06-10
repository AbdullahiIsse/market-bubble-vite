# In-App Settings — Live Stream Config + Reconnect — 2026-06-10

## Context

Changing which channels the app reads (Twitch channel, Kick slug, X broadcast id)
today means editing `.env.local` and restarting the server. The X broadcast id is
the worst case: it is per-stream and expires when the host ends a broadcast, so
every new go-live needs a fresh paste + restart.

Goal: a new **Settings** page (third nav tab) where the owner edits all three
platforms' targets for both host slots, and the server applies changes live,
restarting **only the affected source** — no process restart. The X pain is fixed
as a side effect: paste the new broadcast URL → X reconnects.

Confirmed decisions:

- **Scope** — all 3 platforms (Twitch channel, Kick slug + chatroom id, X broadcast
  URL), both host slots (banks/ansem), plus the shared X account (enabled flag +
  cookies).
- **X cookies** (`auth_token`, `ct0`) — editable in the UI but **write-only**: saved
  server-side, never returned to the browser, overwritable anytime.
- **Persistence** — editable values persist to a runtime file; `.env.local` is the
  seed default.
- **Reconnect** — per-source (only the changed platform reconnects).
- **Nav label** — "Settings".

## Architecture

### Runtime config store — `server/runtime-config.ts` (new)

Wraps the env-derived `AppConfig` with a mutable overlay persisted to
`server/streams.local.json`.

- On boot: `loadConfig()` (env) → merge overrides from `streams.local.json` if
  present. Precedence: **runtime file > `.env.local` > built-in defaults**.
- Editable surface (`StreamSettings`): `twitchChannels{banks,ansem}`,
  `kickSlugs{banks,ansem}`, `kickChatroomIds{banks,ansem}`,
  `xBroadcastIds{banks,ansem}`, `xEnabled`, and secrets `xAuthToken`, `xCt0`.
- API: `getConfig()` returns the current effective `AppConfig`; `update(patch)`
  validates, merges, persists, and returns `{ changedPlatforms }` so the caller
  knows which sources to restart. Secrets in a patch apply only when present and
  non-empty (omitted/empty = keep existing).
- Persistence: the file holds the full edited subset incl. secrets; written
  atomically (temp file + rename) so a crash mid-save can't corrupt it. Treated as
  a local secret — gitignored, never logged.

### Per-source manager — refactor `server/sources-real.ts`

Currently starts twitch, kick, x, and the two viewer pollers once and returns one
aggregate stop. Refactor into a manager that owns each handle and can restart them
individually.

- `createSourceManager(hub, runtimeConfig)` starts all sources (unchanged boot
  behavior) and exposes `restart(platform)` for `'twitch' | 'kick' | 'x'` plus
  `stopAll()`.
- Source ownership (from current code):
  - **X** — `startXSource` owns *both* chat and viewer polling, so `restart('x')`
    restarts the one handle.
  - **Twitch** — IRC chat adapter + separate `startTwitchViewerPoller`;
    `restart('twitch')` restarts both.
  - **Kick** — Pusher chat adapter + separate `startKickViewerPoller`;
    `restart('kick')` restarts both.
- Each adapter already returns a stop fn and reads config at start, so restart =
  stop old + start new with `runtimeConfig.getConfig()`. No adapter internals
  change.
- Sim mode unaffected: `server/sources.ts` still routes to the simulator when
  `config.sim.mode`. Settings writes persist but only take effect for real sources;
  the page notes when sim mode is active.

### API — extend `handleApi` in `server/index.ts`

Add a small JSON body reader (the server is raw `node:http`, no parser today). New
routes under the existing `/api/*` gate:

- `GET /api/streams` → `200`, non-secret editable state + per-source status:
  ```jsonc
  {
    "twitchChannels": {...}, "kickSlugs": {...},
    "kickChatroomIds": {...}, "xBroadcastIds": {...},
    "xEnabled": true,
    "xCookiesSet": true,                 // true if both cookies stored — never the values
    "status": { "twitch": "ok", "kick": "ok", "x": "unavailable" }
  }
  ```
- `POST /api/streams` → body = partial `StreamSettings` (zod-validated; same-origin
  guard). Applies via `runtimeConfig.update`, calls `sourceManager.restart(p)` for
  each changed platform, returns the same shape as `GET`. Empty/omitted cookie
  fields leave the stored cookies unchanged.
- `POST /api/streams/reconnect` → `{ platform: 'twitch'|'kick'|'x'|'all' }`, forces
  a restart with no value change (the "Reconnect all" / per-row reconnect button).
- Validation failure → `400 { error, fields? }`. Wrong method on these paths →
  `405`. The existing `GET /api/config` boot bootstrap is untouched, and the
  catch-all `404` for other `/api/*` stays — `scripts/audit.mjs` `/api/*`
  assertions must still pass (verify during planning).
- Status comes from the hub (it already tracks per-platform status for `/ws`
  snapshots); add a `hub.statusSnapshot()` getter if one isn't already exposed.

### Client — `components/SettingsView.tsx` (new) + nav

- `components/TopBar.tsx`: `Mode` becomes `'watch' | 'dashboard' | 'settings'`; add
  the "Settings" nav button. `MarketBubbleApp` renders `SettingsView` for that mode.
- `SettingsView`: on mount, `GET /api/streams` to populate the form. Sections per
  host slot + a shared X-account section (the approved sketch). Cookie inputs show a
  "saved — type to replace" placeholder when `xCookiesSet`, empty otherwise; on
  submit, empty cookie fields are omitted from the patch.
- Save → `POST /api/streams` with only changed fields → optimistic "reconnecting…"
  then live status.
- **Live status, no new plumbing:** `SettingsView` reads `agg.status` from the
  existing `useAggregator` hook (passed from `MarketBubbleApp`), so the dots update
  from the same `/ws` feed the rest of the app uses. The `GET /api/streams` status
  is only for first paint.
- Styling: extend `src/globals.css` using existing design tokens; no new design
  system.

## Data model — `server/streams.local.json`

```json
{
  "twitchChannels":  { "banks": "jynxzi", "ansem": "deshaefrost" },
  "kickSlugs":       { "banks": "ddg", "ansem": "deshaefrost" },
  "kickChatroomIds": { "banks": "61792777", "ansem": "38497196" },
  "xBroadcastIds":   { "banks": "1MJgNNydYEwGL", "ansem": "1MJgNNydYEwGL" },
  "xEnabled": true,
  "xAuthToken": "…", "xCt0": "…"
}
```

Only edited keys need be present; missing keys fall back to `.env.local`.
Gitignored.

## Security

- **Cookies write-only:** `GET` never returns them, only `xCookiesSet`. Stored at
  rest in `streams.local.json` (same exposure class as `.env.local` today) —
  gitignored, never logged.
- **No auth/role system exists** in this app (the Dashboard is equally open). The
  Settings page can change targets and cookies, so it inherits the app's "localhost
  owner tool" assumption. Flagged: needs a login gate before any network exposure.
  A same-origin check on POST is the minimal CSRF guard.
- X broadcast URL parsed via the existing `parseBroadcastId` (full URL or bare id).

## Error handling

- Invalid input (empty Twitch channel, malformed values) → inline field errors from
  the `400` response.
- Kick slug change can't auto-resolve the chatroom id (Cloudflare 403s the
  server-side lookup on this machine) → explicit chatroom-id field per host; left
  blank, that host's Kick degrades to `unavailable` (status dot), not a hard error.
- Reconnect with bad X cookies / ended broadcast → source goes `unavailable`; the X
  adapter already logs the reason and retries on its slow timer. MVP surfaces this
  via the status dot.
- **Avatars are boot-only by design** (`server/lib/avatars.ts`): changing a channel
  won't refresh its host avatar until the next restart. Known limitation; optional
  future enhancement to refetch on change.

## Testing

- `scripts/streams-config-test.mjs` (new): boot a server on an ephemeral port;
  assert `GET /api/streams` shape + `xCookiesSet` + no secret leak; `POST` a Twitch
  channel change → adapter restarts (status blips, new channel in effect); `POST`
  cookies → `xCookiesSet` flips true while `GET` still hides them; invalid `POST` →
  400; persistence file written and re-read on reboot.
- `scripts/audit.mjs` regression (existing) — confirm new routes don't break the
  `/api/*` 404/405 assertions.
- `npm run typecheck` + `npm run lint`.

## Out of scope (YAGNI)

- Auto-resolving the X broadcast id from a handle (researched — no stable endpoint
  remains; would be fragile scraping).
- Login/roles (flagged above).
- Editing non-stream settings (port, sim mode, viewer poll interval) — stays in
  `.env.local`.
- Per-source last-error text (status dot only for now).
