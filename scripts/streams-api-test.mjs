// Black-box test of /api/streams. Spawns its own server in SIM mode with an
// isolated streams file, then drives the HTTP surface.
// Run: node scripts/streams-api-test.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
  return spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), SIM_MODE: '1', STREAMS_CONFIG_PATH: streamsFile, NODE_ENV: 'production' },
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

  // ---- POST/persistence assertions are added in Task 5; keep the GET ones here.
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
