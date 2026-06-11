# Clear chat when the show goes offline

2026-06-11 — approved

## Problem

When every configured channel transitions from live to offline (show ends, or
the owner retargets settings to offline streamers), the chat from the finished
show lingers: connected clients keep their message list, and new visitors get
the stale ring buffer in the websocket snapshot, displayed under the offline
countdown.

## Behavior

- The hub (`server/hub.ts`) watches the per-platform live flags it already
  tracks (`liveByPlatform`, fed only by real poll results — never the boot
  "unknown" state).
- On the transition "≥1 platform live → none live", start a **2-minute grace
  timer**. If any platform reports live again before it fires, cancel it
  (protects against mid-show stream crashes / flaky polls).
- When the timer fires: clear the server-side chat — message ring buffer,
  queued-but-unsent batch, dedupe set — and rebroadcast a fresh snapshot to all
  connected clients.
- Clients already replace their entire message list on a `snapshot` event (the
  reconnect path), so the wipe reaches every open tab including chat popouts
  with **no protocol or client changes**.
- Chat typed while offline (during the countdown) is never wiped: only the
  live→offline transition arms the timer.

## Out of scope

Viewer history/sparklines are untouched; the client msgs/min counter decays on
its own within a minute.

## Testing

`createHub()` accepts an optional `chatClearGraceMs` override so a one-off
script can verify: clears after the grace window; survives an offline blip
shorter than the grace; never clears when the hub was never live.
