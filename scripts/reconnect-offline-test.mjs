// Orchestrated test: ws reconnect banner + recovery, then offline hero + countdown.
// Spawns the server as a direct node child (no cmd wrappers) so kills are reliable.
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
const PORT = process.env.PORT || '3000';
const base = process.env.AUDIT_BASE || `http://localhost:${PORT}`;

const fails = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
}

async function portUp() {
  try {
    const r = await fetch(base + '/api/config', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

function startServer(extraEnv = {}) {
  // direct node child: node node_modules/tsx/dist/cli.mjs server/index.ts
  const proc = spawn(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'],
    { cwd: ROOT, env: { ...process.env, SIM_MODE: '1', PORT, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  proc.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
  proc.stderr.on('data', (d) => process.stdout.write('[server:err] ' + d));
  return proc;
}

async function waitUp(proc, timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (proc.exitCode !== null) return false; // died (e.g. port conflict)
    if (await portUp()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function killTree(proc) {
  spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    if (!(await portUp())) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ---- pre-flight: port must be free
if (await portUp()) {
  console.log(`FATAL: something is already on :${PORT} — aborting to avoid false results`);
  process.exit(2);
}

// ---- phase 1: live sim, page connects
let server = startServer({ SIM_BROADCAST: 'live' });
check('server (live sim) starts', await waitUp(server));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.msg', { timeout: 30000 });
check('connected: messages flowing', true);
check('connected: no reconnect banner', !(await page.locator('.conn-banner').isVisible().catch(() => false)));

// ---- phase 2: kill server -> banner appears
check('disconnect: server tree killed, port freed', await killTree(server));
const bannerShown = await page
  .waitForSelector('.conn-banner', { timeout: 45000 })
  .then(() => true)
  .catch(() => false);
check('disconnect: "Reconnecting…" banner appears', bannerShown);
await page.screenshot({ path: `${ROOT}/scripts/audit-shots/reconnect-banner.png` });

// ---- phase 3: restart in offline-broadcast mode -> client auto-reconnects
server = startServer({ SIM_BROADCAST: 'offline' });
check('server (offline sim) restarts', await waitUp(server));

// client reconnect backoff caps at 10s + jitter; allow up to 60s
const bannerGone = await page
  .waitForSelector('.conn-banner', { state: 'detached', timeout: 60000 })
  .then(() => true)
  .catch(() => false);
check('reconnect: banner clears after server returns', bannerGone);

// snapshot rehydrates with live=false -> offline hero with ticking countdown
const offlineHero = await page
  .waitForSelector('.player-offline', { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
check('offline: hero shown when broadcast offline', offlineHero);

if (offlineHero) {
  const c1 = await page.locator('.offline-count').textContent();
  await page.waitForTimeout(2300);
  const c2 = await page.locator('.offline-count').textContent();
  check('offline: countdown ticking', !!c1 && !!c2 && c1 !== c2, `${c1} -> ${c2}`);
  check('offline: countdown format Dd HH:MM:SS', /^(\d+d )?\d{2}:\d{2}:\d{2}$/.test((c2 || '').trim()), c2 || '');
  await page.screenshot({ path: `${ROOT}/scripts/audit-shots/offline-hero.png` });
}

// messages still flow in offline mode (chat continues between shows)
const msgsStillFlow = await page
  .waitForSelector('.msg', { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
check('offline: chat still aggregates', msgsStillFlow);

await browser.close();
await killTree(server);

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
