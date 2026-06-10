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
  const sessionDone = page.waitForResponse((r) => r.url().includes('/api/admin/session'), { timeout: 15000 });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await sessionDone; // viewer auth state has resolved before we assert the tab is gated
  await page.getByRole('button', { name: 'Watch' }).waitFor({ timeout: 10000 });
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

  // a logged-in admin who reloads (or after a redeploy, cookie still valid) must
  // land on Watch — Settings is never the persisted landing
  const sess2 = page.waitForResponse((r) => r.url().includes('/api/admin/session'), { timeout: 15000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sess2;
  await page.getByRole('button', { name: 'Watch' }).waitFor({ timeout: 10000 });
  check('reload lands on Watch, not Settings', (await page.locator('.mode-tab.is-active').textContent())?.trim() === 'Watch');
  check('Settings tab still present when authed', (await page.getByRole('button', { name: 'Settings' }).count()) === 1);

  // navigate back into Settings to exercise logout
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForSelector('.settings-form', { timeout: 10000 });

  await page.getByRole('button', { name: 'Log out' }).click();
  // deterministic: wait for the Settings tab to be removed from the DOM after logout
  await page.getByRole('button', { name: 'Settings' }).waitFor({ state: 'detached', timeout: 5000 });
  check('logout removes the Settings tab', (await page.getByRole('button', { name: 'Settings' }).count()) === 0);
  check('logout returns to Watch', (await page.locator('.mode-tab.is-active').textContent())?.trim() === 'Watch');
} finally {
  if (browser) await browser.close();
  await stopServer(child);
  rmSync(dir, { recursive: true, force: true });
}
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exitCode = fails.length ? 1 : 0;
