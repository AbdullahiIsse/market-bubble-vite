// Full functional audit of every interaction in the design handoff.
// Run with the dev server up (npm run dev:sim), then: node scripts/audit.mjs
// Companions: popout-test.mjs (popout layout), reconnect-offline-test.mjs (self-hosted).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./audit-shots', import.meta.url));
mkdirSync(OUT, { recursive: true });
const base = process.env.AUDIT_BASE || 'http://localhost:3000';

const fails = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name + (detail ? ` (${detail})` : ''));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on('pageerror', (err) => console.log(`[pageerror] ${String(err).slice(0, 300)}`));

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.msg', { timeout: 15000 });
await page.waitForTimeout(1500);
check('watch: chat messages arrive', true);
check('watch: stream pane renders', await page.locator('.player').first().isVisible());

// ---- stream swap: hovering the stream reveals the top-center tag; hovering
// the tag itself slides out the switch (raw mouse moves — the tag is
// pointer-events:none while hidden, so page.hover() would refuse it)
async function hoverPlayerMiddle() {
  const box = await page.locator('.player').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400); // tag fade-in
}
async function openSwap() {
  await hoverPlayerMiddle();
  const tb = await page.locator('.player-tag').boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.waitForTimeout(450); // switch slide-out
}
const tagText = () => page.locator('.player-tag-text').textContent();
const beforeSwap = await tagText();
await hoverPlayerMiddle();
check('swap: tag revealed on stream hover',
  (await page.locator('.player-tag').evaluate((el) => getComputedStyle(el).opacity)) === '1');
await openSwap();
await page.locator('.tag-swap').click();
await page.waitForTimeout(400);
check('swap: stream tag swaps host', beforeSwap !== (await tagText()), `${beforeSwap} -> ${await tagText()}`);
await openSwap();
await page.locator('.tag-swap').click(); // back to Banks
await page.waitForTimeout(300);

// ---- viewer tooltip: 6 channel rows + combined footer
await page.hover('.viewer-pill');
await page.waitForTimeout(500);
const rows = await page.locator('.viewer-tooltip .vt-row').count();
const foot = await page.locator('.viewer-tooltip .vt-foot').count();
check('tooltip: 6 channel rows + footer', rows === 6 && foot === 1, `rows=${rows} foot=${foot}`);
await page.mouse.move(640, 420);

// ---- source filtering
const twitchBefore = await page.locator('.chat-feed .msg.src-twitch').count();
await page.locator('.src-toggle').nth(0).click();
await page.waitForTimeout(500);
const twitchAfter = await page.locator('.chat-feed .msg.src-twitch').count();
const othersLeft = await page.locator('.chat-feed .msg').count();
check('filter: toggling Twitch off removes its messages', twitchBefore > 0 && twitchAfter === 0 && othersLeft > 0,
  `before=${twitchBefore} after=${twitchAfter} others=${othersLeft}`);
await page.locator('.src-toggle').nth(0).click();
await page.waitForTimeout(300);

for (let i = 0; i < 3; i++) await page.locator('.src-toggle').nth(i).click();
await page.waitForTimeout(400);
check('filter: all-off resets to all-on', (await page.locator('.src-toggle.is-on').count()) === 3);

// ---- scroll-up freeze + new-messages pill
await page.locator('.chat-feed').evaluate((el) => { el.scrollTop = 0; });
await page.waitForTimeout(2500);
const pillVisible = await page.locator('.new-msgs').isVisible().catch(() => false);
check('feed: scroll-up shows "new messages" pill', pillVisible);
check('feed: scroll position not yanked while reading',
  await page.locator('.chat-feed').evaluate((el) => el.scrollTop < 200));
if (pillVisible) {
  await page.locator('.new-msgs').click();
  await page.waitForTimeout(400);
  check('feed: pill click jumps to bottom', await page.locator('.chat-feed').evaluate(
    (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 90,
  ));
}

// ---- pop-out chat via the real button (popup opens, main chat hides)
const popupPromise = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
await page.locator('.chat-tool[title="Pop out chat"]').click();
const popup = await popupPromise;
check('popout: button opens window', !!popup);
if (popup) {
  await popup.waitForSelector('.app.popout .msg', { timeout: 15000 }).catch(() => {});
  const popMsgs = await popup.locator('.msg').count();
  check('popout: chat renders in popup', popMsgs > 0, `msgs=${popMsgs}`);
  await popup.close();
}
check('popout: main chat hidden after popout',
  !(await page.locator('.chat-col').first().isVisible().catch(() => false)));

// ---- show chat / hide chat
await page.locator('.show-chat').click();
await page.waitForTimeout(400);
check('chat: "Show chat" restores column', await page.locator('.chat-col').first().isVisible());
await page.locator('.chat-tool[title="Hide chat"]').click();
await page.waitForTimeout(400);
check('chat: hide chat collapses column', !(await page.locator('.chat-col').first().isVisible().catch(() => false)));
await page.locator('.show-chat').click();
await page.waitForTimeout(300);

// ---- mode persistence across reload
await page.getByRole('button', { name: 'Dashboard' }).click();
await page.waitForTimeout(800);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
check('mode: dashboard persists across reload',
  (await page.locator('.mode-tab.is-active').textContent())?.trim() === 'Dashboard');

// ---- dashboard contents
check('dashboard: 4 stat cards', (await page.locator('.stat-card').count()) === 4);
check('dashboard: sparklines render', (await page.locator('.stat-card svg').count()) >= 4);
check('dashboard: msgs/min counter', /\d+ msgs\/min/.test((await page.locator('.chat-head-meta').textContent()) || ''));
check('dashboard: chat wall renders',
  (await page.locator('.dash-chat .msg').count()) > 0);
await page.screenshot({ path: `${OUT}/dashboard.png` });
await page.getByRole('button', { name: 'Watch' }).click();
await page.waitForTimeout(600);

// ---- api surface (read-only app: no send/auth endpoints)
for (const ep of ['/api/config']) {
  const r = await page.request.get(base + ep);
  check(`api: GET ${ep}`, r.ok(), `status=${r.status()}`);
}
const sendGone = await page.request.post(`${base}/api/chat/send`, {
  data: { platform: 'twitch', host: 'banks', text: 'hello' },
});
check('api: send endpoint removed (404)', sendGone.status() === 404, `status=${sendGone.status()}`);

// ---- connection dots green in sim
check('status: connection dots ok in sim', (await page.locator('.conn-dot.conn-ok').count()) === 3);

// ---- popout page details
const pop = await ctx.newPage();
await pop.setViewportSize({ width: 420, height: 760 });
await pop.goto(`${base}/?popout=chat`, { waitUntil: 'domcontentloaded' });
await pop.waitForSelector('.msg', { timeout: 15000 });
await pop.locator('.src-toggle').nth(1).click();
await pop.waitForTimeout(400);
check('popout: source toggles work', (await pop.locator('.src-toggle.is-on').count()) === 2);
await pop.locator('.src-toggle').nth(1).click();
check('popout: no hide/popout tools inside popout', (await pop.locator('.chat-tool').count()) === 0);
await pop.screenshot({ path: `${OUT}/popout.png` });
await pop.close();

// ---- responsive ≤760px: chat stacks full width
await page.setViewportSize({ width: 700, height: 900 });
await page.waitForTimeout(600);
const stacked = await page.locator('.watch').evaluate((el) => getComputedStyle(el).flexDirection);
const colWidth = await page.locator('.chat-col').evaluate((el) => el.getBoundingClientRect().width);
check('responsive: chat stacks full-width <=760px', stacked === 'column' && colWidth > 600,
  `direction=${stacked} width=${Math.round(colWidth)}`);

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES:\n - ` + fails.join('\n - ') : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
