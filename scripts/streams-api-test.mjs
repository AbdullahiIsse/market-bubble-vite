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

async function stopServer(c) {
  const exited = new Promise((r) => c.once('exit', r));
  c.kill();
  await exited;
}

function startServer() {
  return spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), SIM_MODE: '1', STREAMS_CONFIG_PATH: streamsFile, NODE_ENV: 'development' },
    stdio: 'ignore',
  });
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
  await stopServer(child);
  child = startServer();
  if (!(await waitReady())) throw new Error('server did not restart');
  const afterReboot = await (await fetch(base + '/api/streams')).json();
  check('reboot restores persisted channel', afterReboot.twitchChannels?.banks === 'xqc');
  check('reboot restores xCookiesSet', afterReboot.xCookiesSet === true);
} finally {
  // Wait for the child to fully exit BEFORE removing files / exiting. Calling
  // process.exit() while the child-process handle is still closing tears down
  // the parent's libuv loop mid-close -> Windows UV_HANDLE_CLOSING assertion
  // (exit 127). Awaiting the 'exit' event lets that handle close cleanly.
  const exited = new Promise((res) => child.once('exit', res));
  child.kill();
  await exited;
  rmSync(dir, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
// Set exitCode and let the loop drain instead of process.exit(): forcing exit
// while undici's keep-alive socket (from fetch) is still closing crashes the
// parent libuv loop on Windows (UV_HANDLE_CLOSING assertion -> exit 127).
process.exitCode = fails.length ? 1 : 0;
