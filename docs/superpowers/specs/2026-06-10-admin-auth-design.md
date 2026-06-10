# Admin-Password Gate for Settings — 2026-06-10

## Context

The Settings page (stream config + live reconnect) and its mutating endpoints
(`POST /api/streams`, `/api/streams/reconnect`) are currently open to anyone who
can reach the server. That's fine for a localhost owner-tool but unacceptable for
the planned public deployment, where a single admin configures the streams for all
viewers. This adds an admin-password gate so only the admin can view/change
Settings; viewers get only Watch/Dashboard.

Deployment note (out of scope to build, but drives the safety model): this app
needs a **long-lived Node process** (persistent WebSocket + in-memory hub +
chat-reader sockets + pollers), so it cannot run on serverless platforms (Vercel).
Host on Railway / Render (Web Service) / Fly.io / a VPS, behind HTTPS.

Confirmed decisions:

- **Visibility:** hidden from viewers — no Settings tab unless logged in; admin
  logs in via a private path `/admin`.
- **Session:** signed **stateless** cookie (HMAC over an expiry using the existing
  `SESSION_SECRET`); survives restarts/redeploys; no server-side session store.
- **Defaults:** 30-day session; 5 failed logins → 15-minute per-IP lockout.
- **Safety:** `ADMIN_PASSWORD` set → always gated. Not set + dev → Settings open
  (today's behavior). Not set + production → Settings **disabled** (never open on a
  public deploy).

## Architecture

### Auth library — `server/lib/admin-auth.ts` (new)

Pure, dependency-free (Node `crypto` only). One clear responsibility: mint/verify
the admin session and gauge the gate state.

- `signSession(secret, ttlMs): string` → cookie value `b64url(payload).b64url(hmac)`
  where `payload = JSON.stringify({ exp: Date.now() + ttlMs })` and `hmac =
  HMAC_SHA256(payload, secret)`.
- `verifySession(secret, value): boolean` → split on `.`, recompute HMAC, compare
  with `crypto.timingSafeEqual`, and require `payload.exp > Date.now()`. Any parse
  error → false.
- `parseCookie(header, name): string | undefined` → minimal cookie-header parser.
- `gateState({ configured, dev }): 'open' | 'required' | 'disabled'` —
  `configured` → `'required'`; `!configured && dev` → `'open'`;
  `!configured && !dev` → `'disabled'`.
- `createLoginLimiter()` → in-memory per-key limiter: `check(key)` returns
  `{ locked, retryAfterMs }`; `fail(key)` increments (≥5 → lock 15 min);
  `reset(key)` clears. Key = client IP.

### Config — `server/config.ts`

Add parsed env:

- `ADMIN_PASSWORD` (`str('')`), `SESSION_SECRET` (`str('')`).
- `AppConfig.admin = { password, sessionSecret, configured }` where
  `configured = !!ADMIN_PASSWORD`.
- If `configured` but `SESSION_SECRET` is empty, generate a random 32-byte hex
  secret at load and `log.warn` that admin sessions reset on restart (so a
  misconfigured prod still works, just re-login after restarts). `.env.local`
  already ships a `SESSION_SECRET`, so this is only a fallback.

### Endpoints — `server/index.ts` (`handleApi`)

Compute `state = gateState({ configured: config.admin.configured, dev })` once.

- `POST /api/admin/login` — same-origin guard; if `state !== 'required'` → `404`
  (login only meaningful when gated). Limiter `check(ip)`; if locked → `429
  { retryAfter }`. Read `{ password }`; `timingSafeEqual` against
  `config.admin.password` (length-guarded). Mismatch → `limiter.fail(ip)` → `401`.
  Match → `limiter.reset(ip)`, `Set-Cookie: mb_admin=<signSession>` → `200 {ok}`.
- `POST /api/admin/logout` — same-origin guard; `Set-Cookie: mb_admin=; Max-Age=0`
  → `200 {ok}`.
- `GET /api/admin/session` → `{ authed: <valid cookie?>, required: state==='required',
  available: state!=='disabled' }`. Never reveals anything secret.
- **Gate** `GET`/`POST /api/streams` and `POST /api/streams/reconnect`: if
  `state==='disabled'` → `503 { error: 'admin not configured' }`; if
  `state==='required'` and the request has no valid `mb_admin` cookie → `401`; if
  `state==='open'` → allow (unchanged dev behavior).
- Cookie attributes: `HttpOnly; Path=/; SameSite=Strict; Max-Age=<ttl>` plus
  `Secure` when `!dev` (production ⇒ HTTPS-only cookie, which also enforces the
  HTTPS recommendation). Client IP from `X-Forwarded-For` (first hop) if present,
  else `req.socket.remoteAddress`.

The existing `/api/config` boot route stays public (it only exposes
`twitchChannels` + `xEnabled` + avatars, already visible in the stream) and is
unchanged.

### Client

- `GET /api/admin/session` is fetched once on load (in `MarketBubbleApp`), yielding
  `{ authed, required, available }`. The **Settings tab shows when `available &&
  (authed || !required)`** — i.e. always in open/dev, only-when-logged-in in
  prod-gated, never when disabled.
- **`components/AdminLogin.tsx`** (new): password form → `POST /api/admin/login`.
  Handles `401` (wrong password), `429` (locked — show retry countdown), `404/503`
  (not configured). On success: set `authed`, `history.replaceState` to `/`, switch
  to the settings view.
- **`components/MarketBubbleApp.tsx`**: holds `auth` state; if
  `location.pathname === '/admin'` and not authed → render `AdminLogin`; gate the
  `settings` mode (fall back to `watch` if not allowed); a `401` from the settings
  API flips `authed=false` → login. Passes `showSettings` to `TopBar`.
- **`components/TopBar.tsx`**: render the Settings tab only when `showSettings`.
- **`components/SettingsView.tsx`**: add a **Log out** button (`POST
  /api/admin/logout` → `authed=false` → watch). On a `401` from its GET/POST, surface
  "session expired — log in again".
- **`src/globals.css`**: styles for the login card (reuse settings tokens).

## Data flow

Viewer: load → `/api/admin/session` → `{authed:false, required:true}` → no Settings
tab; settings APIs return 401 if probed. Admin: `/admin` → password → `POST login`
→ signed cookie → tab appears → edits hit gated APIs with the cookie → reconnect.
Logout clears the cookie.

## Security

- `ADMIN_PASSWORD` / `SESSION_SECRET` are server-only; never sent to the client.
- Cookie is `HttpOnly` (JS can't read it) + `SameSite=Strict` + `Secure` in prod;
  the client learns auth state only via `/api/admin/session`.
- `timingSafeEqual` for the password compare; per-IP lockout for brute force; the
  existing same-origin guard stays as CSRF defense-in-depth on all POSTs.
- Stateless-cookie tradeoff: a logout clears the client cookie but a stolen,
  unexpired cookie stays valid until `exp` (no server revocation). Acceptable for a
  single-admin tool; documented. Rotating `SESSION_SECRET` invalidates all sessions.
- Prod-disabled-when-unconfigured prevents an accidentally wide-open deploy.

## Error handling

- Wrong password → `401` + inline message; ≥5 fails → `429` with `retryAfter`.
- Expired/tampered cookie → treated as unauthenticated (`401` on gated APIs) →
  client returns to login.
- Admin unconfigured in prod → gated APIs `503`; `/admin` explains to set
  `ADMIN_PASSWORD`; Settings tab hidden (`available:false`).
- Malformed login body → `400`.

## Testing

- `scripts/admin-auth-unit-test.ts` — `signSession`/`verifySession` round-trip,
  tampered value rejected, expired value rejected, wrong-secret rejected;
  `gateState` truth table.
- `scripts/admin-auth-test.mjs` (black-box, Windows-safe self-host, `ADMIN_PASSWORD`
  set, SIM): `GET /api/streams` no cookie → 401; `GET /api/admin/session` →
  `{authed:false,required:true,available:true}`; wrong login → 401; correct login →
  `Set-Cookie`; with cookie `GET/POST /api/streams` → 200 and session `authed:true`;
  logout → subsequent `GET /api/streams` → 401; 5 wrong logins → 6th → 429; tampered
  cookie → 401.
- UI (extend `scripts/settings-ui-test.mjs` or new `admin-ui-test.mjs`): with
  `ADMIN_PASSWORD` set, a fresh viewer sees **no** Settings tab; visiting `/admin`,
  entering the password reveals the Settings tab and loads the form. (The existing
  `settings-ui-test.mjs` runs with no `ADMIN_PASSWORD` → `open` state → still passes
  unchanged.)
- `npm run typecheck` + `npm run lint` + existing `audit.mjs` regression.

## Files

| File | Change |
|---|---|
| `server/lib/admin-auth.ts` | NEW — sign/verify, cookie parse, gate state, limiter |
| `server/config.ts` | ADMIN_PASSWORD + SESSION_SECRET + `admin` config |
| `server/index.ts` | login/logout/session routes; gate streams routes; cookies |
| `components/AdminLogin.tsx` | NEW — password form |
| `components/MarketBubbleApp.tsx` | session fetch, `/admin` routing, gate settings mode, 401 handling |
| `components/TopBar.tsx` | conditional Settings tab (`showSettings`) |
| `components/SettingsView.tsx` | Log out button + 401 handling |
| `src/globals.css` | login card styles |
| `.env.example` | document `ADMIN_PASSWORD` + `SESSION_SECRET` |
| `scripts/admin-auth-unit-test.ts`, `scripts/admin-auth-test.mjs` | NEW tests |

## Out of scope (YAGNI)

- Multiple admins, roles, user accounts, password reset, OAuth, 2FA.
- Server-side session store / per-session revocation (stateless cookie chosen).
- Audit logging of admin actions.
- The deployment itself (hosting/HTTPS setup) — separate effort.
