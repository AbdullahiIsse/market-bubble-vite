# Handoff: Market Bubble Live — Unified Chat Aggregator

## Overview
A live dashboard for **marketbubble.com** (Market Bubble, the prediction-market talk show hosted by **Banks** and **Ansem**, presented by Polymarket). Both hosts simulcast every Thursday 1PM PST on their own channels across **Twitch, Kick, and X** — six channels total. This product merges all six chats into one real-time feed, shows a combined viewer count with a per-channel breakdown, lets viewers watch either host's stream with the merged chat beside it, and gives the owners a Dashboard view of the whole audience.

## About the Design Files
The files in this bundle are **design references created in HTML** — working prototypes that show the intended look and behavior with **simulated data**. They are NOT production code to copy directly. The task is to **recreate these designs in the target codebase's environment** (e.g. Next.js/React for marketbubble.com) using its established patterns — or, if no app environment exists yet, choose an appropriate stack (React + websockets recommended) and implement there.

The chat messages, viewer counts, account linking, and connection statuses in the prototype are all **simulated client-side** (`chat-sim.js`). Production requires real integrations — see "Backend / Integration Requirements" at the end.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and interactions are final and match the existing marketbubble.com brand (extracted from the live Framer site). Recreate pixel-perfectly.

## Design Tokens

### Colors
| Token | Value | Use |
|---|---|---|
| `--bg` | `#0a0a0a` | page background (site token) |
| `--bg-2` | `#0f0f0f` | secondary surface |
| `--panel` | `rgba(255,255,255,.03)` | card fill |
| `--line` | `rgba(255,255,255,.16)` | strong hairline |
| `--line-soft` | `rgba(255,255,255,.08)` | default hairline border |
| `--ivory` | `#ffffff` | primary text |
| `--ivory-dim` | `rgba(255,255,255,.72)` | secondary text |
| `--muted` | `#858585` | tertiary text (site token) |
| `--accent` | `#e8ff9c` | brand chartreuse (site token) — live dot, totals, glows, send button |
| `--accent-soft` | `rgba(232,255,156,.2)` | accent borders/glows |
| Twitch | `#a970ff` | platform color |
| Kick | `#52ff8f` | platform color |
| X | `#d8d5cc` text / `#ffffff` accent | platform color |
| Host Banks | `#e8ff9c` | "B" dot |
| Host Ansem | `#8ab4ff` | "Z" dot |
| Status ok | `#4ade80` | connection |
| Status reconnecting | `#fbbf24` | connection (pulsing) |

### Typography
| Role | Font | Notes |
|---|---|---|
| Display (logo, section titles, schedule) | **Walburn Regular** | the site's custom font: `https://framerusercontent.com/assets/y5thG5ZnTftbpFJvt6t9TWIOS38.woff2`; uppercase, letter-spacing .12–.16em |
| Body / chat | **DM Sans** (Google Fonts) | 13–13.5px chat text |
| Numbers (counts, countdown) | **Host Grotesk** (Google Fonts) | weight 600, tabular feel |

### Surfaces & effects
- Radii: 8px (small chips) / 10–12px (buttons, pills, tooltips) / 14px (player, cards)
- Glassmorphism recipe (chips, pills, ticker): `background: rgba(20,20,20,.35–.45)` + `linear-gradient(135deg, rgba(255,255,255,.06–.08), rgba(255,255,255,.01–.02))` + `backdrop-filter: blur(10px)` + 1px tinted border + colored outer glow
- Hover motion: `transform: translateY(-2px / -3px)` with `cubic-bezier(.2,.8,.2,1)` 200ms, glow intensifies
- **Film grain overlay**: full-viewport repeating noise PNG (site asset `6mcf62RlDfRfU61Yg5vb2pefpi4.png`) at `opacity: .13`, size 153.5px, above content, pointer-events none
- **Hero backdrop**: site hero photo (`ddD68QwxkKIzKFvThRqR9GgDCbw.png`) fixed behind everything at `opacity .22`, masked `linear-gradient(#000 30%, transparent 85%)`
- Respect `prefers-reduced-motion` (disable pulses/entrance animations)

## Screens / Views

### 1. Watch mode (default, viewer-facing)
Top bar (66px, hairline bottom border): logo "Market Bubble" (Walburn 23px) + "PRESENTED BY POLYMARKET" (9px, .24em tracking, muted) — center: Watch/Dashboard tabs (Walburn 13px uppercase; active = accent with 1px underline) — right: "LIVE • THURSDAYS • 1PM PST" (Walburn 14px, accent bullets).

Main area = stage (flex 1, 20px padding) + chat column (360px, hairline left border, translucent black + blur).

**Player**: 14px radius, black, hairline border, deep shadow. Twitch embed iframe (`player.twitch.tv/?channel=<ch>&parent=<host>&muted=true&autoplay=true`).
- **Stream tag** (top-left overlay): glass pill — host dot (B/Z ring initial) + "Banks's stream". On hover, a **switch button slides out** (max-width 0→130px, 280ms): swap icon + other host's dot + name, separated by hairline. Click swaps the main stream. Default is ALWAYS Banks on load (no persistence).
- **Offline state** (outside show hours): hero photo fills player, centered "WE'RE OFFLINE" (11px .3em uppercase muted), live countdown `Dd HH:MM:SS` to next Thursday 13:00 PT (Host Grotesk 54px, accent, glow), "BACK • THURSDAY • 1PM PST" in Walburn.

**Stage bar** (under player): left = viewer pill; right = social icon buttons (Twitch / Spotify / TikTok / X → twitch.tv/fazebanks, the show's Spotify, tiktok @marketbubble, x @marketbubble), 38px square, ghost → glass on hover with -2px lift. When chat is hidden, a "Show chat" glass pill also appears here.

**Viewer pill**: glass pill — pulsing accent dot + combined total (Host Grotesk 15.5px) + "WATCHING" (10px .18em uppercase muted). **Hover/focus opens tooltip upward**: title "VIEWERS BY CHANNEL", **6 rows** = platform icon + host dot + host name + horizontal bar (platform color, width relative to max channel) + count + share %. Footer row: "COMBINED" + total in accent. 280px wide, #121212, 12px radius, deep shadow.

**Chat column**:
- Header: "COMBINED CHAT" (Walburn 13px) — right side: 3 source toggle buttons (platform icons; ON = full color + faint bg; OFF = 25% opacity grayscale; clicking filters the feed; turning all off resets all on; tiny amber pulsing dot on a toggle = that source reconnecting) — hairline separator — **pop-out chat** button (opens chat-only window 420×760, hides in-page chat) — **hide chat** button (» icon; collapses column, stream goes full width).
- Feed: auto-scrolls when pinned to bottom. If user scrolls up, new arrivals do NOT yank scroll; instead a floating accent pill "↓ N new messages" appears bottom-center; click = jump to bottom. Entrance: 250ms fade/4px rise per message.
- Message row (inline flow so text wraps full width): **source chip** + username (bold, platform color) + message text (ivory-dim).
- **Source chip** (the signature element): glass pill, min-width 40px, centered platform icon (13px), platform-tinted border + outer glow (Twitch purple / Kick green / X white). **Host dot**: 15px circle overlapping top-right corner, 1px ring + initial in host color ("B" chartreuse / "Z" blue), `#121212` fill. Hover: chip lifts 3px, glow brightens. Tooltip title: "Twitch — Banks's channel".
- Own messages: faint accent background `rgba(232,255,156,.05)`, 8px radius.
- **Composer** (bottom, hairline top border): 3 identity chips (Twitch/Kick/X; unlinked = dimmed grayscale with small "+" badge; click = link account (OAuth in production); linked+active = full color, accent border + glow), text input (glass, accent focus ring, placeholder "Link an account to chat" / "Send a message as @twitch/you"), send button (38px, accent bg, dark icon, disabled at 25% opacity). Sent messages are tagged with the platform identity AND the host channel currently being watched — **there is no separate "native" message type**.

Layout variants (tweakable): classic (chat right), flipped (chat left), theater (full-bleed player, chat overlays right with blur).

### 2. Dashboard mode (owner-facing)
Same top bar. Content (18/24px padding):
- **Stat row** (grid 1.3fr 1fr 1fr 1fr): "COMBINED AUDIENCE" card — pulsing dot, total (Host Grotesk 32px accent), sparkline of combined history. Three platform cards — icon + name + share %, platform total (26px), **B/Z split row** (host dot + count each), sparkline in platform color.
- **Chat wall**: full-width card (14px radius), header "COMBINED CHAT" + live "N msgs/min" counter, the same merged feed at full width, same composer.

### 3. Pop-out chat window (`?popout=chat`)
Chat column only, full viewport: header with source toggles, feed, composer. No top bar/player.

## Interactions & Behavior summary
- Stream swap: hover stream tag → switch button slides out → click swaps Banks↔Ansem
- Viewer breakdown: hover/focus viewer pill → 6-channel matrix tooltip
- Source filtering: toggle Twitch/Kick/X icons in chat header
- Hide chat ↔ Show chat; Pop out chat (separate window)
- Scroll-up freeze + "new messages" pill
- Account link → type → send (message appears with own-message highlight)
- Connection status: per-source dot (amber pulse while reconnecting)
- Offline countdown ticking every second
- Mode tabs persist (localStorage); main stream does NOT persist (always Banks)

## Responsive
- ≤1100px: chat column 300px; dashboard stats 2-col
- ≤760px: page scrolls; player 16:9 fixed; chat stacks below at 60vh full width; schedule + logo subtitle hidden; social buttons 34px

## State Management (production)
- `messages[]` (capped ring buffer ~220 rendered; virtualize for the wall), each: `{id, platform, host, user, text, ts, self?}`
- `viewers` matrix `{twitch:{banks,ansem}, kick:{...}, x:{...}}` + history for sparklines
- `sources` filter set, `mainHost`, `mode`, `chatHidden`, `linked` accounts + `identity`, `conn` per-source status
- Aggregation server fans in all six chat feeds → one websocket to clients

## Backend / Integration Requirements (not in prototype)
1. **Twitch**: chat via IRC/EventSub; viewers via Helix API. Two channels.
2. **Kick**: chat via their websocket (Pusher-based); viewer counts via API. Two channels.
3. **X**: live broadcast chat has no clean public API — validate feasibility early (official partner API or scraping risk). Two accounts.
4. **OAuth** account linking (Twitch/Kick/X) so users can send messages to the host channel they're watching, through the user's own account.
5. Combined viewer polling (~10s) + websocket broadcast of merged chat.
6. Moderation pipeline (drop deleted/banned messages from all sources) — UI for mod tools not designed yet.

## Assets
- Walburn font woff2 (Framer-hosted, listed above) — license check needed for production
- Hero photo + noise texture from framerusercontent.com (site already owns these)
- All icons are inline SVG paths in the design files (Twitch, Kick, X, Spotify, TikTok glyphs, swap/pop-out/hide/send)

## Files
- `Market Bubble Live.html` — page shell, all CSS (tokens, components, responsive)
- `mb-app.jsx` — app logic: views, player + swap, composer wiring, tweaks
- `mb-components.jsx` — ChatMessage/chips, ViewerPill matrix, ChatFeed + new-messages pill, ChatComposer, stat cards
- `chat-sim.js` — the simulation layer to REPLACE with real integrations (its API shows the expected data shapes)

## Screenshots
Reference captures of key states (live simulated data, Twitch embed may show as blank in captures):
- `screenshots/01-watch-mode.png` — Watch mode: player + stream tag, stage bar (viewer pill, socials), combined chat with glass chips & host dots, composer
- `screenshots/02-viewer-breakdown-tooltip.png` — viewer pill focused, 6-channel matrix tooltip open
- `screenshots/03-chat-hidden.png` — chat collapsed, "Show chat" pill in stage bar
- `screenshots/04-dashboard-mode.png` — owner Dashboard: stat cards with B/Z splits + full-width chat wall
