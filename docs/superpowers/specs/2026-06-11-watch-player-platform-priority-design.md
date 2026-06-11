# Watch player: per-host platform priority (Twitch → Kick, never X)

**Date:** 2026-06-11
**Status:** Approved

## Problem

The Watch tab's stream player only ever embeds Twitch. If a host (Banks or
Ansem) is streaming on Kick but not Twitch, the player shows their offline
Twitch channel instead of the live Kick stream. The platforms differ per host:
Banks may be live on Twitch while Ansem is live only on Kick.

## Goal

For whichever host the player is showing, embed the right platform by
priority:

1. **Twitch** — if that host is live on Twitch
2. **Kick** — else, if that host is live on Kick
3. **Fallback** — else, that host's Twitch embed (Twitch's own offline page).
   Matches current behavior and recovers instantly when they go live.

**X is never embedded**, even if it's the only live platform.

The selection is per host and re-evaluated as viewer polls land, so it follows
mid-show platform changes. Each host's choice is independent: swapping between
Banks and Ansem can move the player between Twitch and Kick embeds.

## Decisions made

- Fallback when live on neither Twitch nor Kick: **that host's Twitch offline
  embed** (not the hero image, no auto-switch to the other host).
- The player tag shows a **small platform icon** (existing `PlatformIcon`)
  next to the host name so viewers can tell Twitch from Kick.

## Approach

Derive per-host liveness from the **viewer matrix the client already
receives** (`viewers[platform][host]`), instead of extending the protocol
with a live matrix or having the server pick the platform. The pollers
already guarantee tri-state semantics:

- `null` — poll failed / source unavailable → **unknown**
- `0` — poll succeeded, channel offline → **known offline**
- `> 0` — channel live → **live**

The only wire addition is shipping Kick slugs to viewers (today only
`twitchChannels` crosses the websocket). Known edge: a live stream with
exactly 0 viewers reads as offline — transient (a stream's first seconds)
and self-correcting on the next poll.

## Server / wire changes (additive, deploy-safe)

- **`/api/config`** (server/index.ts, ~line 195): add `kickSlugs` next to
  `twitchChannels` in the boot bootstrap.
- **Hub** (server/hub.ts): generalize `setTwitchChannels` to also accept kick
  slugs (e.g. `setChannels({ twitchChannels, kickSlugs })`). The snapshot and
  the `config` broadcast carry `kickSlugs: Record<Host, string>` alongside
  `twitchChannels`. Broadcast only when either map actually changed.
- **Settings save path** (server/index.ts, ~line 230): push both maps after a
  save, so an admin retargeting a Kick slug retargets open players live,
  exactly as Twitch channel saves do today.
- **Protocol** (shared/protocol.ts): `snapshot` and `config` events gain
  `kickSlugs: Record<Host, string>`. Additive field — old clients ignore it;
  new clients guard against old-server events that lack it.
- **No changes** to pollers, viewer matrix shape, or live computation.

## Client changes

- **Bootstrap** (src/main.tsx): fetch `kickSlugs` from `/api/config` with
  sensible defaults, pass alongside `twitchChannels`.
- **useAggregator** (hooks/useAggregator.ts): track `kickSlugs` with the same
  identity-stable guard as `twitchChannels` (keep the previous reference when
  values are equal; ignore snapshots missing the field, e.g. an old server
  during a deploy).
- **Selection helper** — small pure function in `shared/` (it only depends on
  `ViewerMatrix` from shared/protocol, and shared/ is where pure helpers used
  with wire shapes live), e.g. `shared/player-source.ts`:

  ```ts
  pickPlayerPlatform(viewers, host, current): 'twitch' | 'kick'
  ```

  - `viewers.twitch[host] > 0` → `'twitch'`
  - else `viewers.kick[host] > 0` → `'kick'`
  - else if the cell for the *currently shown* platform is `null` (unknown)
    → keep `current` (stickiness: a poll blip must not reload the iframe)
  - else → `'twitch'` (fallback)
  - X is never considered.

- **StreamPlayer** (components/StreamPlayer.tsx): receives `viewers` and
  `kickSlugs`; holds the sticky current choice in a ref; builds either the
  existing Twitch embed URL or
  `https://player.kick.com/{slug}?autoplay=true&muted=true`. The iframe `src`
  only changes when the resolved URL changes, so React leaves the DOM node
  alone otherwise. The `memo` continues to skip chat-flush re-renders —
  viewer-matrix identity changes only on `viewers` events (~once per poll).
- **Player tag**: platform icon next to "<Host>'s stream" via `PlatformIcon`.

## Error handling

- **First paint, no snapshot:** unchanged — neutral hero until the websocket
  snapshot lands (`live === null`).
- **Mid-show poll failure:** the failing platform's cells go `null` →
  selection sticks with the current platform; no embed flap.
- **Old server during deploy:** snapshot lacks `kickSlugs` → client keeps
  bootstrap/previous values; worst case the player behaves exactly as today
  (Twitch only).

## Testing

- Unit tests for `pickPlayerPlatform`: priority order, tri-state handling,
  stickiness on unknown, fallback, X exclusion.
- Hub tests: extended `config` event / snapshot carry `kickSlugs`; broadcast
  fires when only kick slugs change.
- Run under the existing `tsx --test` setup. The `test` script glob widens
  from `"server/**/*.test.ts"` to also include `"shared/**/*.test.ts"` so the
  helper's test can live next to it.
- `npm run typecheck` and `npm run lint` cover the client wiring.
