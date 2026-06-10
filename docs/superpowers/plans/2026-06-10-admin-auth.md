# Admin-Password Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the Settings page and its `/api/streams` endpoints behind an admin password (signed-cookie session), hidden from viewers, with a `/admin` login — safe to deploy publicly.

**Architecture:** A dependency-free `server/lib/admin-auth.ts` mints/verifies an HMAC-signed session cookie (using `SESSION_SECRET`), gauges the gate state (open/required/disabled), and rate-limits logins. `server/index.ts` adds login/logout/session routes and gates the streams routes. The React client fetches `/api/admin/session`, shows the Settings tab only when allowed, and routes `/admin` to a login form.

**Tech Stack:** TypeScript, Node `http` + `crypto` (no new deps), `zod`, React 19, Vite. Tests: standalone scripts (`npx tsx … .ts` for unit, `node … .mjs` for black-box/Playwright).

---

## Conventions

- Working dir: `C:\Users\abdul\Desktop\market-bubble-vite` (Windows, bash). Repo is on branch `master` with git configured. Branch for this work: `feat/admin-auth` (Task 0).
- Self-hosted test servers MUST use the Windows-safe pattern already in `scripts/streams-api-test.mjs`: spawn `process.execPath` with `['node_modules/tsx/dist/cli.mjs','server/index.ts']` (no shell), await the child `exit` on teardown, set `process.exitCode` (never `process.exit()`).
- **Gate-state crucial fact:** with `ADMIN_PASSWORD` set → `required`; unset + dev → `open`; unset + prod → `disabled`. Black-box server tests therefore run in **dev mode** (`NODE_ENV=development`) so the `Secure` cookie flag is off (cookies work over http) and an un-passworded server is `open` (not `disabled`).
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```

## File structure

| File | Responsibility |
|---|---|
| `server/lib/admin-auth.ts` (create) | Sign/verify session cookie, parse cookie header, constant-time compare, gate-state, login rate-limiter |
| `server/config.ts` (modify) | Parse `ADMIN_PASSWORD` + `SESSION_SECRET`; expose `config.admin` |
| `server/index.ts` (modify) | `/api/admin/{login,logout,session}` routes; gate `/api/streams*`; cookie + client-IP helpers |
| `components/AdminLogin.tsx` (create) | Password login form for `/admin` |
| `components/MarketBubbleApp.tsx` (modify) | Fetch session, `/admin` routing, `showSettings`, gate settings mode, logout/401 wiring |
| `components/TopBar.tsx` (modify) | Render Settings tab only when `showSettings` |
| `components/SettingsView.tsx` (modify) | Log out button + handle `401` from its API calls |
| `src/globals.css` (modify) | Login card styles |
| `.env.example` (modify) | Document `ADMIN_PASSWORD` + `SESSION_SECRET` |
| `scripts/admin-auth-unit-test.ts` (create) | Unit test for the auth lib |
| `scripts/admin-config-test.ts` (create) | Unit test for config parsing |
| `scripts/admin-auth-test.mjs` (create) | Black-box test of the gated server |
| `scripts/admin-ui-test.mjs` (create) | Playwright: viewer has no tab; `/admin` login reveals it; logout hides it |
| `scripts/streams-api-test.mjs` (modify) | Switch to dev mode so it stays in `open` state |

---

## Task 0: Branch

- [ ] **Step 1: Create the feature branch**

Run:
```bash
cd "C:\Users\abdul\Desktop\market-bubble-vite"
git checkout -b feat/admin-auth
git branch --show-current
```
Expected: `feat/admin-auth`.

---

## Task 1: Auth library (`server/lib/admin-auth.ts`)

**Files:**
- Create: `server/lib/admin-auth.ts`
- Test: `scripts/admin-auth-unit-test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/admin-auth-unit-test.ts`:
```ts
// Run: npx tsx scripts/admin-auth-unit-test.ts
import {
  signSession,
  verifySession,
  parseCookie,
  constantTimeEqual,
  gateState,
  createLoginLimiter,
} from '../server/lib/admin-auth';

const fails: string[] = [];
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) fails.push(name);
};

const SECRET = 'unit-secret';

// sign/verify round-trip
const tok = signSession(SECRET, 60_000);
check('valid token verifies', verifySession(SECRET, tok) === true);
check('wrong secret fails', verifySession('other', tok) === false);
check('undefined fails', verifySession(SECRET, undefined) === false);
check('garbage fails', verifySession(SECRET, 'not.a.token') === false);
check('tampered payload fails', verifySession(SECRET, 'AAAA.' + tok.split('.')[1]) === false);
check('tampered sig fails', verifySession(SECRET, tok.split('.')[0] + '.AAAA') === false);
check('expired token fails', verifySession(SECRET, signSession(SECRET, -1000)) === false);

// cookie parsing
check('parseCookie finds value', parseCookie('a=1; mb_admin=xyz; b=2', 'mb_admin') === 'xyz');
check('parseCookie missing -> undefined', parseCookie('a=1', 'mb_admin') === undefined);
check('parseCookie no header -> undefined', parseCookie(undefined, 'mb_admin') === undefined);

// constant-time compare
check('equal strings match', constantTimeEqual('hunter2', 'hunter2') === true);
check('different strings differ', constantTimeEqual('hunter2', 'hunter3') === false);
check('different lengths differ', constantTimeEqual('a', 'abc') === false);

// gate state
check('configured -> required (dev)', gateState({ configured: true, dev: true }) === 'required');
check('configured -> required (prod)', gateState({ configured: true, dev: false }) === 'required');
check('unconfigured dev -> open', gateState({ configured: false, dev: true }) === 'open');
check('unconfigured prod -> disabled', gateState({ configured: false, dev: false }) === 'disabled');

// limiter
const lim = createLoginLimiter(3, 60_000);
check('fresh key not locked', lim.check('ip').locked === false);
lim.fail('ip');
lim.fail('ip');
check('under threshold not locked', lim.check('ip').locked === false);
lim.fail('ip');
check('at threshold locked', lim.check('ip').locked === true);
check('lock reports retryAfter', lim.check('ip').retryAfterMs > 0);
lim.reset('ip');
check('reset clears lock', lim.check('ip').locked === false);

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/admin-auth-unit-test.ts`
Expected: FAIL — `Cannot find module '../server/lib/admin-auth'`.

- [ ] **Step 3: Implement `server/lib/admin-auth.ts`**

```ts
// Admin session auth: HMAC-signed stateless cookie + gate state + login limiter.
// Dependency-free (node:crypto only). Used by server/index.ts to gate Settings.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE = 'mb_admin';

const b64url = (s: string) => Buffer.from(s).toString('base64url');

// cookie value = base64url(JSON{exp}) + "." + base64url(HMAC_SHA256(payload, secret))
export function signSession(secret: string, ttlMs: number): string {
  const payload = b64url(JSON.stringify({ exp: Date.now() + ttlMs }));
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(secret: string, value: string | undefined): boolean {
  if (!value) return false;
  const dot = value.indexOf('.');
  if (dot < 1) return false;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number };
    return typeof obj.exp === 'number' && obj.exp > Date.now();
  } catch {
    return false;
  }
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

// constant-time string compare via fixed-length digests (no length leak)
export function constantTimeEqual(a: string, b: string): boolean {
  const ah = createHash('sha256').update(a).digest();
  const bh = createHash('sha256').update(b).digest();
  return timingSafeEqual(ah, bh);
}

export type GateState = 'open' | 'required' | 'disabled';
export function gateState(opts: { configured: boolean; dev: boolean }): GateState {
  if (opts.configured) return 'required';
  return opts.dev ? 'open' : 'disabled';
}

export interface LoginLimiter {
  check(key: string): { locked: boolean; retryAfterMs: number };
  fail(key: string): void;
  reset(key: string): void;
}

export function createLoginLimiter(maxFails = 5, lockMs = 15 * 60 * 1000): LoginLimiter {
  const map = new Map<string, { fails: number; lockUntil: number }>();
  return {
    check(key) {
      const e = map.get(key);
      if (e && e.lockUntil > Date.now()) return { locked: true, retryAfterMs: e.lockUntil - Date.now() };
      return { locked: false, retryAfterMs: 0 };
    },
    fail(key) {
      const e = map.get(key) ?? { fails: 0, lockUntil: 0 };
      e.fails += 1;
      if (e.fails >= maxFails) e.lockUntil = Date.now() + lockMs;
      map.set(key, e);
    },
    reset(key) {
      map.delete(key);
    },
  };
}

// Stable fallback secret for when admin is enabled but SESSION_SECRET is unset.
export function randomSecret(): string {
  return randomBytes(32).toString('hex');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/admin-auth-unit-test.ts`
Expected: `ALL PASS`.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add server/lib/admin-auth.ts scripts/admin-auth-unit-test.ts
git commit -m "feat(server): admin session auth lib (sign/verify, gate state, limiter)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Config (`server/config.ts`)

**Files:**
- Modify: `server/config.ts`
- Test: `scripts/admin-config-test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/admin-config-test.ts`:
```ts
// Run: npx tsx scripts/admin-config-test.ts
import { loadConfig } from '../server/config';

const fails: string[] = [];
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) fails.push(name);
};

// no password -> not configured
delete process.env.ADMIN_PASSWORD;
delete process.env.SESSION_SECRET;
let c = loadConfig();
check('unconfigured by default', c.admin.configured === false && c.admin.password === '');

// password set, no session secret -> configured + a generated secret
process.env.ADMIN_PASSWORD = 's3cret';
delete process.env.SESSION_SECRET;
c = loadConfig();
check('configured when password set', c.admin.configured === true && c.admin.password === 's3cret');
check('generates a session secret fallback', c.admin.sessionSecret.length >= 32);

// explicit session secret is used verbatim
process.env.SESSION_SECRET = 'my-explicit-secret';
c = loadConfig();
check('uses explicit session secret', c.admin.sessionSecret === 'my-explicit-secret');

delete process.env.ADMIN_PASSWORD;
delete process.env.SESSION_SECRET;
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/admin-config-test.ts`
Expected: FAIL — `c.admin` is undefined (`Cannot read properties of undefined`).

- [ ] **Step 3: Add admin fields to `server/config.ts`**

Add the import at the top (after the `zod` import):
```ts
import { randomSecret } from './lib/admin-auth';
```
Add these two lines inside the `EnvSchema = z.object({ ... })` (next to the other `str('')` keys, e.g. after `KICK_CLIENT_SECRET`):
```ts
  ADMIN_PASSWORD: str(''),
  SESSION_SECRET: str(''),
```
Add to the `AppConfig` interface (after the `x: {...}` block):
```ts
  admin: {
    password: string;
    sessionSecret: string;
    configured: boolean;
  };
```
Add to the object returned by `loadConfig` (after the `x: {...}` block):
```ts
    admin: {
      password: e.ADMIN_PASSWORD,
      sessionSecret: e.SESSION_SECRET || (e.ADMIN_PASSWORD ? randomSecret() : ''),
      configured: !!e.ADMIN_PASSWORD,
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/admin-config-test.ts`
Expected: `ALL PASS`.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add server/config.ts scripts/admin-config-test.ts
git commit -m "feat(server): parse ADMIN_PASSWORD + SESSION_SECRET into config.admin

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Gate the server (`server/index.ts`)

**Files:**
- Modify: `server/index.ts`
- Modify: `scripts/streams-api-test.mjs` (dev mode)
- Test: `scripts/admin-auth-test.mjs`

- [ ] **Step 1: Switch the existing streams API test to dev mode**

In `scripts/streams-api-test.mjs`, inside `startServer()`, change the env so the un-passworded server is in `open` state (in prod it would now be `disabled` → 503):
- Change `NODE_ENV: 'production'` to `NODE_ENV: 'development'`.
(Leave everything else — `SIM_MODE`, `STREAMS_CONFIG_PATH`, `PORT` — unchanged.)

- [ ] **Step 2: Write the failing black-box test**

Create `scripts/admin-auth-test.mjs`:
```mjs
// Black-box test of the admin gate. Dev mode + ADMIN_PASSWORD set => 'required'
// (Secure cookie flag off in dev, so cookies work over http).
// Run: node scripts/admin-auth-test.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

const dir = mkdtempSync(path.join(tmpdir(), 'mb-admin-'));
const PORT = 3461;
const base = `http://localhost:${PORT}`;
const PASSWORD = 'test-pass-123';

async function stopServer(c) {
  const exited = new Promise((r) => c.once('exit', r));
  c.kill();
  await exited;
}
function startServer() {
  return spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      SIM_MODE: '1',
      NODE_ENV: 'development',
      ADMIN_PASSWORD: PASSWORD,
      SESSION_SECRET: 'fixed-test-secret',
      STREAMS_CONFIG_PATH: path.join(dir, 's.json'),
    },
    stdio: 'ignore',
  });
}
async function waitReady() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/api/admin/session')).ok) return true;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
// undici fetch has no cookie jar — capture mb_admin from Set-Cookie manually.
function cookieFrom(res) {
  const sc = res.headers.get('set-cookie') || '';
  const m = sc.match(/mb_admin=([^;]*)/);
  return m ? `mb_admin=${m[1]}` : '';
}

const child = startServer();
try {
  if (!(await waitReady())) throw new Error('server did not start');

  // gated before login
  check('GET /api/streams unauthorized', (await fetch(base + '/api/streams')).status === 401);
  const sess0 = await (await fetch(base + '/api/admin/session')).json();
  check('session before login', sess0.authed === false && sess0.required === true && sess0.available === true);

  // wrong password
  const wrong = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'nope' }),
  });
  check('wrong password -> 401', wrong.status === 401, `status=${wrong.status}`);

  // correct password -> cookie (this also resets the limiter for this ip)
  const ok = await fetch(base + '/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  check('correct password -> 200', ok.status === 200, `status=${ok.status}`);
  const cookie = cookieFrom(ok);
  check('login sets mb_admin cookie', cookie.startsWith('mb_admin='));

  // authed requests
  check('GET /api/streams with cookie -> 200', (await fetch(base + '/api/streams', { headers: { cookie } })).status === 200);
  const sess1 = await (await fetch(base + '/api/admin/session', { headers: { cookie } })).json();
  check('session authed with cookie', sess1.authed === true);
  const post = await fetch(base + '/api/streams', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ twitchChannels: { banks: 'xqc' } }),
  });
  check('POST /api/streams with cookie -> 200', post.status === 200, `status=${post.status}`);

  // tampered cookie rejected
  check('tampered cookie -> 401', (await fetch(base + '/api/streams', { headers: { cookie: 'mb_admin=abc.def' } })).status === 401);

  // logout clears the cookie (stateless: it sends a clearing Set-Cookie)
  const logout = await fetch(base + '/api/admin/logout', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}' });
  check('logout -> 200', logout.status === 200);
  check('logout clears cookie', /mb_admin=;/.test(logout.headers.get('set-cookie') || ''));

  // rate limit: limiter was reset by the successful login, so 5 fresh wrong tries lock the 6th
  let got429 = false;
  for (let i = 0; i < 6; i++) {
    const r = await fetch(base + '/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'bad' }),
    });
    if (r.status === 429) got429 = true;
  }
  check('rate-limited after repeated failures (429)', got429);
} finally {
  await stopServer(child);
  rmSync(dir, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exitCode = fails.length ? 1 : 0;
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node scripts/admin-auth-test.mjs`
Expected: FAIL — `/api/admin/session` doesn't exist, so `waitReady` times out → "server did not start".

- [ ] **Step 4: Add the admin imports + helpers to `server/index.ts`**

Add to the imports (after the `runtime-config` imports):
```ts
import {
  signSession,
  verifySession,
  parseCookie,
  constantTimeEqual,
  gateState,
  createLoginLimiter,
  ADMIN_COOKIE,
  type LoginLimiter,
} from './lib/admin-auth';
```
Add a constant near `const log = scoped('server');`:
```ts
const ADMIN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
```
Extend `ApiDeps` (add two fields):
```ts
interface ApiDeps {
  runtime: RuntimeConfig;
  hub: Hub;
  getManager: () => SourceManager | null;
  getAvatars: () => HostAvatars;
  dev: boolean;
  limiter: LoginLimiter;
}
```
Add a login-body schema next to `ReconnectSchema`:
```ts
const LoginSchema = z.object({ password: z.string() });
```
Add these helpers after `readJsonBody`:
```ts
function clientIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function setSessionCookie(res: ServerResponse, value: string, dev: boolean, ttlMs: number) {
  const attrs = [`${ADMIN_COOKIE}=${value}`, 'HttpOnly', 'Path=/', 'SameSite=Strict', `Max-Age=${Math.floor(ttlMs / 1000)}`];
  if (!dev) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res: ServerResponse, dev: boolean) {
  const attrs = [`${ADMIN_COOKIE}=`, 'HttpOnly', 'Path=/', 'SameSite=Strict', 'Max-Age=0'];
  if (!dev) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}
```

- [ ] **Step 5: Add the admin routes + gate inside `handleApi`**

In `handleApi`, right after the line `const config = deps.runtime.getConfig();`, add:
```ts
  const state = gateState({ configured: config.admin.configured, dev: deps.dev });
  const authed = verifySession(config.admin.sessionSecret, parseCookie(req.headers.cookie, ADMIN_COOKIE));

  if (pathname === '/api/admin/session' && (method === 'GET' || method === 'HEAD')) {
    const body = JSON.stringify({ authed, required: state === 'required', available: state !== 'disabled' });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(method === 'HEAD' ? undefined : body);
    return true;
  }

  if (pathname === '/api/admin/login' && method === 'POST') {
    if (!sameOrigin(req)) {
      sendJson(res, 403, { error: 'forbidden' });
      return true;
    }
    if (state !== 'required') {
      sendJson(res, 404, { error: 'admin not configured' });
      return true;
    }
    const ip = clientIp(req);
    const lock = deps.limiter.check(ip);
    if (lock.locked) {
      sendJson(res, 429, { error: 'too many attempts', retryAfter: lock.retryAfterMs });
      return true;
    }
    let raw: unknown;
    try {
      raw = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: 'invalid json' });
      return true;
    }
    const parsed = LoginSchema.safeParse(raw);
    if (!parsed.success) {
      sendJson(res, 400, { error: 'invalid input' });
      return true;
    }
    if (!constantTimeEqual(parsed.data.password, config.admin.password)) {
      deps.limiter.fail(ip);
      sendJson(res, 401, { error: 'wrong password' });
      return true;
    }
    deps.limiter.reset(ip);
    setSessionCookie(res, signSession(config.admin.sessionSecret, ADMIN_TTL_MS), deps.dev, ADMIN_TTL_MS);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    if (!sameOrigin(req)) {
      sendJson(res, 403, { error: 'forbidden' });
      return true;
    }
    clearSessionCookie(res, deps.dev);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // gate the settings surface
  if (pathname === '/api/streams' || pathname === '/api/streams/reconnect') {
    if (state === 'disabled') {
      sendJson(res, 503, { error: 'admin not configured' });
      return true;
    }
    if (state === 'required' && !authed) {
      sendJson(res, 401, { error: 'unauthorized' });
      return true;
    }
  }
```

- [ ] **Step 6: Update the `known` catch-all to include the admin paths**

Replace the `const known = …` line near the end of `handleApi` with:
```ts
  const known =
    pathname === '/api/config' ||
    pathname === '/api/streams' ||
    pathname === '/api/streams/reconnect' ||
    pathname === '/api/admin/session' ||
    pathname === '/api/admin/login' ||
    pathname === '/api/admin/logout';
```

- [ ] **Step 7: Construct the limiter and pass `dev`/`limiter` into deps**

In `main()`, after `const hub = createHub();` add:
```ts
  const limiter = createLoginLimiter();
```
Update the `deps` object to include the two new fields:
```ts
  const deps: ApiDeps = {
    runtime,
    hub,
    getManager: () => started?.manager ?? null,
    getAvatars: () => hostAvatars,
    dev,
    limiter,
  };
```
(`dev` is already computed above as `const dev = process.env.NODE_ENV !== 'production';`.)

- [ ] **Step 8: Run both black-box tests to verify they pass**

Run:
```bash
node scripts/admin-auth-test.mjs; echo "exit=$?"
node scripts/streams-api-test.mjs; echo "exit=$?"
```
Expected: both `ALL PASS` and `exit=0` (the streams test now runs in dev/open state; the admin test exercises the gate).

- [ ] **Step 9: Typecheck, lint, commit**

```bash
npm run typecheck
npm run lint
git add server/index.ts scripts/admin-auth-test.mjs scripts/streams-api-test.mjs
git commit -m "feat(server): gate /api/streams behind admin session + login/logout/session routes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Client session + `/admin` login + conditional tab

**Files:**
- Create: `components/AdminLogin.tsx`
- Modify: `components/TopBar.tsx`
- Modify: `components/MarketBubbleApp.tsx`
- Test: `scripts/admin-ui-test.mjs`

- [ ] **Step 1: Write the failing UI test**

Create `scripts/admin-ui-test.mjs`:
```mjs
// Self-hosted Playwright: with ADMIN_PASSWORD set, a viewer has no Settings tab;
// /admin login reveals it. Dev mode (live client) + Windows-safe teardown.
// Run: node scripts/admin-ui-test.mjs
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

const dir = mkdtempSync(path.join(tmpdir(), 'mb-adminui-'));
const PORT = 3462;
const base = `http://localhost:${PORT}`;
const PASSWORD = 'ui-pass-456';
async function stopServer(c) {
  const exited = new Promise((r) => c.once('exit', r));
  c.kill();
  await exited;
}
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SIM_MODE: '1',
    NODE_ENV: 'development',
    ADMIN_PASSWORD: PASSWORD,
    SESSION_SECRET: 'fixed-ui-secret',
    STREAMS_CONFIG_PATH: path.join(dir, 's.json'),
  },
  stdio: 'ignore',
});
async function waitReady() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/api/admin/session')).ok) return true;
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  // viewer: no Settings tab
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Watch' }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  check('viewer has Watch tab', (await page.getByRole('button', { name: 'Watch' }).count()) === 1);
  check('viewer has NO Settings tab', (await page.getByRole('button', { name: 'Settings' }).count()) === 0);

  // /admin: login form, wrong password shows error
  await page.goto(base + '/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.admin-login', { timeout: 10000 });
  await page.fill('#admin-password', 'wrong');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForSelector('.admin-login-error', { timeout: 5000 });
  check('wrong password shows error', await page.locator('.admin-login-error').isVisible());

  // correct password -> Settings tab appears + form loads
  await page.fill('#admin-password', PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForSelector('.settings-form', { timeout: 10000 });
  check('after login the settings form loads', await page.locator('.settings-form').isVisible());
  check('after login the Settings tab exists', (await page.getByRole('button', { name: 'Settings' }).count()) === 1);
} finally {
  if (browser) await browser.close();
  await stopServer(child);
  rmSync(dir, { recursive: true, force: true });
}
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exitCode = fails.length ? 1 : 0;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/admin-ui-test.mjs`
Expected: FAIL — the viewer currently sees a Settings tab (unconditional), and `.admin-login` doesn't exist.

- [ ] **Step 3: Create `components/AdminLogin.tsx`**

```tsx
import { useState } from 'react';

// Full-screen password gate shown at /admin when not authenticated.
export function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        onSuccess();
        return;
      }
      if (res.status === 429) {
        const d = (await res.json().catch(() => ({}))) as { retryAfter?: number };
        const mins = Math.ceil((d.retryAfter ?? 900_000) / 60_000);
        setError(`Too many attempts. Try again in ~${mins} min.`);
      } else if (res.status === 404 || res.status === 503) {
        setError('Admin is not configured on this server.');
      } else {
        setError('Wrong password.');
      }
    } catch {
      setError('Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-login">
      <form className="admin-login-card" onSubmit={submit}>
        <h1 className="admin-login-title">Admin</h1>
        <label htmlFor="admin-password">Password</label>
        <input
          id="admin-password"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Log in'}
        </button>
        {error && <p className="admin-login-error">{error}</p>}
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Make the Settings tab conditional in `components/TopBar.tsx`**

Replace the `ModeTabs` function and the `TopBar` export with:
```tsx
function ModeTabs({
  mode,
  onChange,
  showSettings,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  showSettings: boolean;
}) {
  const tabs: [Mode, string][] = [
    ['watch', 'Watch'],
    ['dashboard', 'Dashboard'],
    ...(showSettings ? ([['settings', 'Settings']] as [Mode, string][]) : []),
  ];
  return (
    <nav className="mode-tabs" aria-label="View mode">
      {tabs.map(([k, label]) => (
        <button
          key={k}
          className={'mode-tab' + (mode === k ? ' is-active' : '')}
          onClick={() => onChange(k)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

// memo: chat flushes re-render the app shell ~10x/s; the top bar only depends
// on the mode + whether the admin Settings tab should show.
export const TopBar = memo(function TopBar({
  mode,
  onChange,
  showSettings,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  showSettings: boolean;
}) {
  return (
    <header className="topbar">
      <Logo />
      <ModeTabs mode={mode} onChange={onChange} showSettings={showSettings} />
      <div className="topbar-schedule">
        Live<span className="dot-sep">&bull;</span>Thursdays<span className="dot-sep">&bull;</span>1PM PST
      </div>
    </header>
  );
});
```

- [ ] **Step 5: Wire session + routing into `components/MarketBubbleApp.tsx`**

Add the import (next to the other component imports):
```ts
import { AdminLogin } from './AdminLogin';
```
Add state + effect + handlers immediately after `const agg = useAggregator();`:
```tsx
  const [auth, setAuth] = useState<{ authed: boolean; required: boolean; available: boolean } | null>(null);
  const [isAdminPath] = useState(() => window.location.pathname === '/admin');

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/session')
      .then((r) => r.json())
      .then((d) => {
        if (alive) setAuth({ authed: !!d.authed, required: !!d.required, available: !!d.available });
      })
      .catch(() => {
        if (alive) setAuth({ authed: false, required: false, available: false });
      });
    return () => {
      alive = false;
    };
  }, []);

  const showSettings = !!auth && auth.available && (auth.authed || !auth.required);

  const onLoginSuccess = useCallback(() => {
    setAuth((a) => (a ? { ...a, authed: true } : { authed: true, required: true, available: true }));
    window.history.replaceState({}, '', '/');
    setMode('settings');
  }, []);
```
Add the `/admin` branch right after the existing `if (isPopout) { … }` block:
```tsx
  if (isAdminPath && (!auth || !auth.authed)) {
    return <div className="app">{auth ? <AdminLogin onSuccess={onLoginSuccess} /> : null}</div>;
  }
```
Add an effective-mode line right before the final `return (`:
```tsx
  const effectiveMode: Mode = mode === 'settings' && !showSettings ? 'watch' : mode;
```
In the final return, pass `showSettings` to `TopBar` and branch on `effectiveMode` instead of `mode`:
- Change `<TopBar mode={mode} onChange={changeMode} />` to `<TopBar mode={effectiveMode} onChange={changeMode} showSettings={showSettings} />`.
- Change the three-way `{mode === 'settings' ? (…) : mode === 'watch' ? (…) : (…)}` to use `effectiveMode` in all three conditions (i.e. `effectiveMode === 'settings'`, `effectiveMode === 'watch'`).

- [ ] **Step 6: Run the UI test to verify it passes**

Run: `node scripts/admin-ui-test.mjs`
Expected: `ALL PASS` + `exit=0`.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npm run typecheck
npm run lint
git add components/AdminLogin.tsx components/TopBar.tsx components/MarketBubbleApp.tsx scripts/admin-ui-test.mjs
git commit -m "feat(ui): /admin login, session-gated Settings tab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Logout + session-expiry handling

**Files:**
- Modify: `components/MarketBubbleApp.tsx`
- Modify: `components/SettingsView.tsx`
- Modify: `scripts/admin-ui-test.mjs` (logout assertion)

- [ ] **Step 1: Add a logout assertion to the UI test**

In `scripts/admin-ui-test.mjs`, immediately after the `check('after login the Settings tab exists', …)` line, add:
```mjs
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.waitForTimeout(800);
  check('logout removes the Settings tab', (await page.getByRole('button', { name: 'Settings' }).count()) === 0);
  check('logout returns to Watch', (await page.locator('.mode-tab.is-active').textContent())?.trim() === 'Watch');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/admin-ui-test.mjs`
Expected: FAIL — there is no "Log out" button yet.

- [ ] **Step 3: Add logout + onUnauthorized handlers in `components/MarketBubbleApp.tsx`**

Add after the `onLoginSuccess` handler:
```tsx
  const onUnauthorized = useCallback(() => {
    setAuth((a) => (a ? { ...a, authed: false } : a));
    setMode('watch');
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/admin/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => {});
    setAuth((a) => (a ? { ...a, authed: false } : a));
    setMode('watch');
  }, []);
```
Pass them to `SettingsView` — change the settings branch in the render to:
```tsx
      {effectiveMode === 'settings' ? (
        <SettingsView status={agg.status} onLogout={logout} onUnauthorized={onUnauthorized} />
      ) : effectiveMode === 'watch' ? (
```

- [ ] **Step 4: Accept the new props + handle 401 in `components/SettingsView.tsx`**

Change the `SettingsViewImpl` signature to accept the new props:
```tsx
function SettingsViewImpl({
  status,
  onLogout,
  onUnauthorized,
}: {
  status: StatusMap;
  onLogout: () => void;
  onUnauthorized: () => void;
}) {
```
In the mount fetch effect, handle a `401` (session expired) — replace the `.then((r) => r.json())` chain with:
```tsx
    fetch('/api/streams')
      .then((r) => {
        if (r.status === 401) {
          if (alive) onUnauthorized();
          return null;
        }
        return r.json();
      })
      .then((data: StreamsState | null) => {
        if (alive && data) {
          setForm(data);
          setLoaded(data);
        }
      })
      .catch(() => {
        if (alive) setFetchError(true);
      });
```
In `save()`, handle a `401` right after `const res = await fetch(...)` — change the `const data = await res.json();` block to:
```tsx
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
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
```
Add a Log out button — change the title line to a header row with the button:
```tsx
      <div className="settings-head">
        <h1 className="settings-title">Stream settings</h1>
        <button type="button" className="settings-logout" onClick={onLogout}>
          Log out
        </button>
      </div>
```
(Replace the existing bare `<h1 className="settings-title">Stream settings</h1>` in the main `return` — the loading/error branch keeps its own `<h1>` unchanged.)

- [ ] **Step 5: Run the UI test to verify it passes**

Run: `node scripts/admin-ui-test.mjs`
Expected: `ALL PASS` + `exit=0` (login, then logout removes the tab and returns to Watch).

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npm run typecheck
npm run lint
git add components/MarketBubbleApp.tsx components/SettingsView.tsx scripts/admin-ui-test.mjs
git commit -m "feat(ui): admin logout + session-expiry handling in Settings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Styles, docs, final regression

**Files:**
- Modify: `src/globals.css`
- Modify: `.env.example`

- [ ] **Step 1: Append login + logout styles to `src/globals.css`**

Add at the end of `src/globals.css`:
```css
/* ───────── Admin login + logout ───────── */
.admin-login {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.admin-login-card {
  width: 100%;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 28px 26px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.03);
}
.admin-login-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 700;
}
.admin-login-card label {
  font-size: 12px;
  color: var(--muted, #8b8b94);
}
.admin-login-card input {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 10px 12px;
  color: inherit;
  font: inherit;
  font-size: 14px;
}
.admin-login-card input:focus {
  outline: none;
  border-color: rgba(120, 170, 255, 0.7);
}
.admin-login-card button {
  margin-top: 6px;
  border-radius: 8px;
  padding: 10px 16px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  background: #4664ff;
  color: #fff;
}
.admin-login-card button:disabled {
  opacity: 0.6;
  cursor: default;
}
.admin-login-error {
  margin: 2px 0 0;
  font-size: 13px;
  color: #f85149;
}
.settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.settings-logout {
  border-radius: 8px;
  padding: 7px 14px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: transparent;
  color: inherit;
}
```

- [ ] **Step 2: Document the env vars in `.env.example`**

Append to `.env.example`:
```ini

# ───────── Admin gate (for public deploys) ─────────
# Set a password to require admin login for the Settings page + its APIs.
# Unset: Settings is open in local dev, and DISABLED in production (NODE_ENV=production).
# Reach the login at /admin once set.
ADMIN_PASSWORD=
# Signs the admin session cookie. Set a long random value in production so logins
# survive restarts (a random one is generated each boot if left blank).
SESSION_SECRET=
```

- [ ] **Step 3: Full regression**

Run each; confirm the expected result:
```bash
npm run typecheck                              # clean
npm run lint                                   # clean
npx tsx scripts/admin-auth-unit-test.ts        # ALL PASS
npx tsx scripts/admin-config-test.ts           # ALL PASS
npx tsx scripts/runtime-config-test.ts         # ALL PASS
npx tsx scripts/hub-status-test.ts             # ALL PASS
npx tsx scripts/source-manager-test.ts         # ALL PASS
node scripts/admin-auth-test.mjs               # ALL PASS, exit=0
node scripts/streams-api-test.mjs              # ALL PASS, exit=0  (now dev/open state)
node scripts/settings-ui-test.mjs              # ALL PASS, exit=0  (no ADMIN_PASSWORD -> open -> tab shows)
node scripts/admin-ui-test.mjs                 # ALL PASS, exit=0
```
Then the existing functional audit against a fresh sim server (admin unset → open → unchanged):
```bash
SIM_MODE=1 NODE_ENV=development PORT=3011 node node_modules/tsx/dist/cli.mjs server/index.ts > /tmp/audit-srv.log 2>&1 &
SRV=$!
for i in $(seq 1 60); do curl -s http://localhost:3011/api/config >/dev/null 2>&1 && break; sleep 1; done
AUDIT_BASE=http://localhost:3011 node scripts/audit.mjs; AUDIT=$?
kill $SRV 2>/dev/null
echo "AUDIT EXIT=$AUDIT"
```
Expected: audit `ALL PASS`, `AUDIT EXIT=0`.

- [ ] **Step 4: Commit**

```bash
git add src/globals.css .env.example
git commit -m "feat(ui): admin login styles + document ADMIN_PASSWORD/SESSION_SECRET

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to integrate `feat/admin-auth`.

---

## Self-review (completed during planning)

**Spec coverage:**
- Hidden-from-viewers + `/admin` login → Tasks 4 (routing, conditional tab, AdminLogin).
- Signed stateless cookie (HMAC over `SESSION_SECRET`) → Task 1 (`signSession`/`verifySession`), Task 3 (set/clear cookie, TTL 30 days).
- Login/logout/session endpoints + gate `/api/streams*` → Task 3.
- Brute-force lockout (5 fails → 15 min) → Task 1 (`createLoginLimiter` defaults), Task 3 (wired per client IP).
- Safety: configured→required, unset+dev→open, unset+prod→disabled → Task 1 (`gateState`), Task 3 (503 when disabled, 401 when required+unauth).
- Client `showSettings = available && (authed || !required)` → Task 4.
- Logout + 401-expiry handling → Task 5.
- `Secure` cookie in prod, `HttpOnly`, `SameSite=Strict` → Task 3.
- Existing tests preserved: `streams-api-test` moved to dev/open (Task 3 Step 1); `settings-ui-test` already dev/open (unchanged, still passes); audit unaffected (Task 6).
- Docs (`.env.example`) → Task 6.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `gateState`, `signSession`, `verifySession`, `parseCookie`, `constantTimeEqual`, `createLoginLimiter`/`LoginLimiter`, `ADMIN_COOKIE`, `randomSecret` defined in Task 1 and used with identical names/signatures in Tasks 2–3. `config.admin.{password,sessionSecret,configured}` defined in Task 2, used in Task 3. Client `auth` shape `{authed,required,available}` and `showSettings` consistent across Tasks 4–5. `SettingsView` prop additions (`onLogout`, `onUnauthorized`) defined in Task 5 and passed from `MarketBubbleApp` in the same task.

**Known limitation (documented in spec):** stateless cookie can't be server-revoked before expiry; logout clears the client cookie only.
