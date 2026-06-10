import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = process.env.SHOT_DIR || fileURLToPath(new URL('./shots', import.meta.url));
mkdirSync(OUT, { recursive: true });

const base = process.env.AUDIT_BASE || 'http://localhost:3000';
const VW = { width: 1200, height: 720 };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VW, deviceScaleFactor: 1 });
const page = await ctx.newPage();

async function settle(ms = 1500) {
  await page.waitForTimeout(ms);
}

// 1. Watch mode
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.msg', { timeout: 15000 }).catch(() => {});
await settle(2500); // let chat fill + viewer pill populate
await page.screenshot({ path: `${OUT}/01-watch.png` });

// 2. Viewer tooltip (hover the pill)
await page.hover('.viewer-pill').catch(() => {});
await settle(700);
await page.screenshot({ path: `${OUT}/02-tooltip.png` });
// move away to close tooltip
await page.mouse.move(600, 360);
await settle(300);

// 3. Chat hidden
await page.click('.chat-tool[title="Hide chat"]').catch(() => {});
await settle(600);
await page.screenshot({ path: `${OUT}/03-hidden.png` });

// 4. Dashboard
await page.getByRole('button', { name: 'Dashboard' }).click().catch(() => {});
await settle(2500);
await page.screenshot({ path: `${OUT}/04-dashboard.png` });

// 5. Pop-out chat
const pop = await ctx.newPage();
await pop.setViewportSize({ width: 420, height: 760 });
await pop.goto(`${base}/?popout=chat`, { waitUntil: 'domcontentloaded' });
await pop.waitForSelector('.msg', { timeout: 15000 }).catch(() => {});
await pop.waitForTimeout(2000);
await pop.screenshot({ path: `${OUT}/05-popout.png` });

await browser.close();
console.log('shots written to', OUT);
