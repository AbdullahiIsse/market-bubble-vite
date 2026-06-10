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
  check('POST /api/streams/reconnect unauthorized',
    (await fetch(base + '/api/streams/reconnect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'all' }),
    })).status === 401);
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

  // Stateless cookie: logout sends a clearing Set-Cookie for the browser to honor;
  // the signed token itself stays valid until exp (no server-side revocation).
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
