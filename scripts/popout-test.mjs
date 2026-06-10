// Focused popout regression test: feed scrollable & pinned in the popout window.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const base = process.env.AUDIT_BASE || 'http://localhost:3000';
const OUT = fileURLToPath(new URL('./audit-shots', import.meta.url));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 420, height: 760 } });
const page = await ctx.newPage();

const fails = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
}

await page.goto(`${base}/?popout=chat`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.app.popout .msg', { timeout: 15000 });
await page.waitForTimeout(3500); // let enough messages arrive to overflow 760px

const vp = page.viewportSize();

// 1. feed is an actual scroll container (content overflows, container clipped to viewport)
const feed = await page.locator('.chat-feed').evaluate((el) => ({
  scrollHeight: el.scrollHeight,
  clientHeight: el.clientHeight,
  scrollTop: el.scrollTop,
}));
check(
  'feed scrolls (scrollHeight > clientHeight)',
  feed.scrollHeight > feed.clientHeight + 50,
  `scrollHeight=${feed.scrollHeight} clientHeight=${feed.clientHeight}`,
);
check(
  'feed clipped to viewport (clientHeight <= viewport)',
  feed.clientHeight <= vp.height,
  `clientHeight=${feed.clientHeight} vp=${vp.height}`,
);

// 2. feed pinned to bottom: newest message visible in viewport
const pinned = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 90;
check('feed pinned to bottom', pinned, `delta=${feed.scrollHeight - feed.scrollTop - feed.clientHeight}`);

const lastMsg = await page.locator('.msg').last().boundingBox();
check(
  'newest message visible in viewport',
  !!lastMsg && lastMsg.y >= 0 && lastMsg.y < vp.height,
  lastMsg ? `y=${Math.round(lastMsg.y)}` : 'no last msg box',
);

// 3. new arrivals keep it pinned (auto-scroll alive). scrollTop itself is NOT
// monotonic once the 220-message buffer is at cap (top-trimmed rows change
// scrollHeight), so assert pinned-ness + feed advance, not scrollTop growth.
const before = await page.locator('.chat-feed').evaluate((el) => ({
  scrollTop: el.scrollTop,
  last: el.lastElementChild ? el.lastElementChild.textContent : '',
}));
await page.waitForTimeout(3000);
const after = await page.locator('.chat-feed').evaluate((el) => ({
  scrollTop: el.scrollTop,
  scrollHeight: el.scrollHeight,
  clientHeight: el.clientHeight,
  last: el.lastElementChild ? el.lastElementChild.textContent : '',
}));
check(
  'auto-scroll follows new messages',
  after.scrollHeight - after.scrollTop - after.clientHeight < 90 && after.last !== before.last,
  `scrollTop ${before.scrollTop} -> ${after.scrollTop}, advanced=${after.last !== before.last}`,
);

// 4. chat column is a flex column (layout actually applied)
const display = await page.locator('.app.popout .chat-col').evaluate(
  (el) => getComputedStyle(el).display + '/' + getComputedStyle(el).flexDirection,
);
check('chat-col is flex column', display === 'flex/column', display);

await page.screenshot({ path: `${OUT}/popout-after.png` });
await browser.close();

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
