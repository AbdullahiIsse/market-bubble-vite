// Self-hosted Playwright test of the Settings page. Spawns its own SIM-mode
// server (dev mode so Vite serves live source) with an isolated streams file.
// Run: node scripts/settings-ui-test.mjs
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

const dir = mkdtempSync(path.join(tmpdir(), 'mb-ui-'));
const PORT = 3458;
const base = `http://localhost:${PORT}`;

// Correction B: spawn with process.execPath + tsx cli path, no shell:true
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
  // Correction A: NODE_ENV=development so Vite serves live source (not stale dist/)
  env: {
    ...process.env,
    PORT: String(PORT),
    SIM_MODE: '1',
    STREAMS_CONFIG_PATH: path.join(dir, 's.json'),
    NODE_ENV: 'development',
    // pin the open (ungated) state regardless of a password in .env.local
    ADMIN_PASSWORD: '',
  },
  stdio: 'ignore',
});

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base + '/api/streams')).ok) return true;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// Correction B: stopServer helper — await exit event after kill()
async function stopServer(c) {
  const exited = new Promise((r) => c.once('exit', r));
  c.kill();
  await exited;
}

let browser;
let testError;
try {
  if (!(await waitReady())) throw new Error('server did not start');

  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' });

  // Playwright auto-waits for the button to be visible before clicking
  try {
    await page.getByRole('button', { name: 'Settings' }).click();
  } catch (e) {
    check('settings view renders', false, String(e).split('\n')[0]);
    check('settings tab active', false, 'skipped — no Settings button');
    testError = e;
  }

  if (!testError) {
    // Wait for the settings view to appear (covers React mount + Vite cold start)
    await page.waitForSelector('.settings-view', { timeout: 10000 });

    check('settings view renders', await page.locator('.settings-view').isVisible());
    check('settings tab active', (await page.locator('.mode-tab.is-active').textContent())?.trim() === 'Settings');

    await page.waitForSelector('.settings-form', { timeout: 5000 });
    const twitchBanks = await page.inputValue('#twitch-banks');
    check('twitch banks field populated from GET', twitchBanks.length > 0, `value=${twitchBanks}`);
    check('x broadcast field present', await page.locator('#x-banks').count() === 1);
    check('cookie field is password type', (await page.getAttribute('#x-auth-token', 'type')) === 'password');

    await page.fill('#twitch-banks', 'sodapoppin');
    await page.getByRole('button', { name: 'Save & reconnect' }).click();
    await page.waitForSelector('.settings-saved', { timeout: 5000 });
    check('save shows confirmation', await page.locator('.settings-saved').isVisible());
    const persisted = await (await fetch(base + '/api/streams')).json();
    check('save persisted via API', persisted.twitchChannels.banks === 'sodapoppin', `value=${persisted.twitchChannels.banks}`);
  }
} finally {
  // Correction B: close browser first, then await child exit before cleanup
  if (browser) await browser.close();
  await stopServer(child);
  rmSync(dir, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
// Correction B: set exitCode and let loop drain (do NOT call process.exit())
process.exitCode = fails.length ? 1 : 0;
