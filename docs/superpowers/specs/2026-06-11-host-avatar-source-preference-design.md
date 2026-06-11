# Host avatars: per-host source preference (Banks → Twitch, Ansem → Kick)

**Date:** 2026-06-11
**Status:** Approved

## Problem

`fetchHostAvatars` (server/lib/avatars.ts) is Twitch-first for both hosts:
Kick is only consulted for hosts whose Twitch fetch failed. Ansem's avatar
should come from Kick, but as long as the Twitch fetch succeeds his Kick
picture is never used.

## Goal

Per-host avatar source preference:

- **Banks** — Twitch picture, Kick fallback (unchanged behavior).
- **Ansem** — Kick picture, Twitch fallback.
- Letter fallback (client-side) only when both sources fail for a host.

Fallback to the non-preferred source was an explicit decision: keep the
file's fail-soft philosophy rather than showing the bare letter circle when
the preferred source is down at boot.

## Approach: collect both sources, then resolve by preference

Restructure `fetchHostAvatars` so the priority lives in one readable place
at the end instead of being implicit in fetch ordering:

1. Hardcoded table at the top of the file (mirrors how `HOST_META`
   hardcodes per-host facts; env/config-driven was rejected as YAGNI):

   ```ts
   const AVATAR_PREFERENCE: Record<Host, 'twitch' | 'kick'> = {
     banks: 'twitch',
     ansem: 'kick',
   };
   ```

2. The three existing fetch blocks keep their endpoints, ordering, and
   fail-soft try/catch, but write into two intermediate maps —
   `twitchPics` and `kickPics` — instead of the final `avatars` map.
   - The Twitch Helix block is unconditional on prior results (as today).
   - The Kick official block keeps its `config.kick.configured` gate but
     drops the "only if a host is still missing" condition — it always runs
     when Kick keys are configured (it already fetches both slugs in one
     request, so no extra network cost).
   - The keyless Kick web endpoint (last resort) runs per host only when
     that host's Kick picture is still missing **and** actually needed:
     the host prefers Kick, or prefers Twitch but the Twitch fetch failed.
3. Final resolution per host: preferred source, else the other source,
   else nothing (client letter fallback).

## Scope

`server/lib/avatars.ts` only. No client, protocol, hub, or config changes —
the wire shape (`HostAvatars`) and the boot-only fetch in server/index.ts
are untouched.

## Testing

No existing test covers avatars.ts; the logic stays network-bound and
fail-soft, so this change adds none. Verification: `npm run typecheck`,
`npm run lint`, and a boot log check — the existing
`host avatars resolved: …` line still reports which hosts resolved.
