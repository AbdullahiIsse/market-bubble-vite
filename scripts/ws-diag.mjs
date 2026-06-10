// Quick WS diagnostic: trace the /ws socket lifecycle + frame rate + console.
import { chromium } from 'playwright';

const base = process.env.AUDIT_BASE || 'http://localhost:3001';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}] ${m.text().slice(0, 200)}`);
});
page.on('pageerror', (err) => console.log(`[pageerror] ${String(err).slice(0, 300)}`));
page.on('websocket', (ws) => {
  if (!ws.url().endsWith('/ws')) return;
  let frames = 0;
  const t0 = Date.now();
  console.log(`[ws] opened ${ws.url()} @${t0 % 100000}`);
  ws.on('framereceived', () => {
    frames++;
  });
  ws.on('close', () => console.log(`[ws] CLOSED after ${Date.now() - t0}ms, ${frames} frames received`));
  setInterval(() => {
    if (!ws.isClosed()) console.log(`[ws] alive ${Math.round((Date.now() - t0) / 1000)}s, frames=${frames}`);
  }, 3000).unref?.();
});

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.msg', { timeout: 20000 }).catch(() => console.log('NO .msg within 20s'));

for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(3000);
  const stats = await page.evaluate(() => ({
    msgs: document.querySelectorAll('.msg').length,
    banner: document.querySelector('.conn-banner')?.textContent?.trim() || null,
    visibility: document.visibilityState,
  }));
  console.log(`[page] t=${(i + 1) * 3}s msgs=${stats.msgs} banner=${JSON.stringify(stats.banner)} vis=${stats.visibility}`);
}

await browser.close();
