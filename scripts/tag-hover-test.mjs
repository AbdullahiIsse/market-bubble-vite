// Stream tag: top-center, shown while hovering anywhere over the stream, hidden otherwise.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const base = process.env.AUDIT_BASE || 'http://localhost:3000';
const OUT = fileURLToPath(new URL('./audit-shots', import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const fails = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
}

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.msg', { timeout: 15000 });
await page.waitForTimeout(800);

const tagOpacity = () => page.locator('.player-tag').evaluate((el) => getComputedStyle(el).opacity);
const playerBox = await page.locator('.player').boundingBox();
const cx = playerBox.x + playerBox.width / 2;
const cy = playerBox.y + playerBox.height / 2;

// 1. hidden when the mouse is outside the stream
await page.mouse.move(20, 760);
await page.waitForTimeout(400);
check('tag hidden when not hovering stream', (await tagOpacity()) === '0', `opacity=${await tagOpacity()}`);

// 2. top-center of the player
const tagBox = await page.locator('.player-tag').boundingBox();
const tagCx = tagBox.x + tagBox.width / 2;
const topGap = tagBox.y - playerBox.y;
check('tag horizontally centered', Math.abs(tagCx - cx) < 8, `tagCx=${Math.round(tagCx)} cx=${Math.round(cx)}`);
check('tag at top of player', topGap > 6 && topGap < 30, `gap=${Math.round(topGap)}px`);

// 3. hovering anywhere over the stream reveals it (corner, middle, bottom)
const spots = [
  ['corner', playerBox.x + 30, playerBox.y + 30],
  ['middle', cx, cy],
  ['bottom', cx, playerBox.y + playerBox.height - 20],
];
for (const [label, x, y] of spots) {
  await page.mouse.move(x, y);
  await page.waitForTimeout(350);
  check(`hover ${label} of stream reveals tag`, (await tagOpacity()) === '1', `opacity=${await tagOpacity()}`);
}
await page.screenshot({ path: `${OUT}/tag-hover.png` });

// 4. swap still works from the revealed tag (hover the pill to slide out the switch)
const before = await page.locator('.player-tag-text').textContent();
await page.mouse.move(tagCx, tagBox.y + tagBox.height / 2);
await page.waitForTimeout(450);
await page.locator('.tag-swap').click();
await page.waitForTimeout(400);
const after = await page.locator('.player-tag-text').textContent();
check('swap works from revealed tag', before !== after, `${before} -> ${after}`);

// 5. leaving the stream hides it again (mouse-click focus must not pin it)
await page.mouse.move(20, 760);
await page.waitForTimeout(450);
check('tag hides when mouse leaves stream', (await tagOpacity()) === '0', `opacity=${await tagOpacity()}`);

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
