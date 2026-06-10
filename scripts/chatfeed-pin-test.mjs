// ChatFeed bottom-pin regression probe. The feed must stay pinned to the
// bottom while messages stream in and the 220-message buffer trims from the
// top — with ZERO user interaction. Run with a sim server up:
//   PORT=3001 SIM_MODE=1 SIM_RATE=9000 npx tsx server/index.ts
//   AUDIT_BASE=http://localhost:3001 node scripts/chatfeed-pin-test.mjs
// Records every scroll event + DOM mutation batch on .chat-feed so an unpin
// can be attributed (scroll-anchoring adjustment vs user scroll vs effect).
import { chromium } from 'playwright';

const base = process.env.AUDIT_BASE || 'http://localhost:3001';
const WINDOW_MS = Number(process.env.PIN_WINDOW_MS || 12000);
const CPU_THROTTLE = Number(process.env.PIN_CPU_THROTTLE || 1);
const PIN_PX = 90; // ChatFeed's own "at bottom" threshold

const fails = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => console.log(`[pageerror] ${String(err).slice(0, 300)}`));

if (CPU_THROTTLE > 1) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
}

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.chat-feed .msg', { timeout: 30000 });

// wait until the client buffer is at its 220 cap so every flush also trims
await page.waitForFunction(
  () => document.querySelectorAll('.chat-feed .msg').length >= 220,
  { timeout: 60000 },
);
console.log(`buffer at cap, observing ${WINDOW_MS / 1000}s (cpu throttle ${CPU_THROTTLE}x) ...`);

const data = await page.evaluate(
  async ({ windowMs }) => {
    const feed = document.querySelector('.chat-feed');
    const t0 = performance.now();
    const now = () => Math.round(performance.now() - t0);
    const dist = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight;
    const out = { scrolls: [], muts: [], samples: [] };

    feed.addEventListener('scroll', () => {
      out.scrolls.push({ t: now(), top: Math.round(feed.scrollTop), dist: Math.round(dist()) });
    });
    const mo = new MutationObserver((muts) => {
      let added = 0;
      let removed = 0;
      for (const m of muts) {
        added += m.addedNodes.length;
        removed += m.removedNodes.length;
      }
      out.muts.push({ t: now(), added, removed });
    });
    mo.observe(feed, { childList: true });

    const iv = setInterval(() => {
      out.samples.push({
        t: now(),
        dist: Math.round(dist()),
        pill: !!document.querySelector('.new-msgs'),
        msgs: feed.querySelectorAll('.msg').length,
      });
    }, 200);

    await new Promise((r) => setTimeout(r, windowMs));
    clearInterval(iv);
    mo.disconnect();
    return out;
  },
  { windowMs: WINDOW_MS },
);

const { samples, scrolls, muts } = data;
const unpinned = samples.filter((s) => s.dist >= PIN_PX);
const pillSamples = samples.filter((s) => s.pill);
const trims = muts.filter((m) => m.removed > 0);
const lastSample = samples[samples.length - 1];

console.log(
  `samples: ${samples.length}, mutation batches: ${muts.length} (${trims.length} with trims), scroll events: ${scrolls.length}`,
);
console.log(
  `distance-from-bottom: final=${lastSample.dist}px, max=${Math.max(...samples.map((s) => s.dist))}px, ` +
    `unpinned samples: ${unpinned.length}/${samples.length}, pill visible: ${pillSamples.length}/${samples.length}`,
);

// evidence trail: scroll events around the first unpinned moment
if (unpinned.length > 0) {
  const tBad = unpinned[0].t;
  const around = scrolls.filter((s) => s.t >= tBad - 600 && s.t <= tBad + 600).slice(0, 14);
  console.log(`first unpinned sample at t=${tBad}ms; scroll events nearby:`);
  for (const s of around) console.log(`  t=${s.t}ms top=${s.top} dist=${s.dist}`);
  // did scrollTop ever move DOWNWARD (decrease) without user input? → anchoring
  let drops = 0;
  for (let i = 1; i < scrolls.length; i++) {
    if (scrolls[i].top < scrolls[i - 1].top) drops++;
  }
  console.log(`scrollTop decreases (no user input → anchoring adjustments): ${drops}`);
}

check('feed stays pinned (no sample ≥90px from bottom)', unpinned.length === 0);
check('"new messages" pill never appears unprompted', pillSamples.length === 0);
check('feed ends at the bottom', lastSample.dist < PIN_PX, `final dist=${lastSample.dist}px`);

// part 2 — a reader who scrolls up must stay put (no yank), get the pill, and
// be able to jump back down with it.
const box = await page.locator('.chat-feed').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, -1500);
await page.waitForTimeout(1800); // several flushes worth of appends + trims

const up = await page.evaluate(() => {
  const feed = document.querySelector('.chat-feed');
  return {
    dist: Math.round(feed.scrollHeight - feed.scrollTop - feed.clientHeight),
    pill: !!document.querySelector('.new-msgs'),
  };
});
check('scrolled-up reader is not yanked back down', up.dist >= PIN_PX, `dist=${up.dist}px`);
check('pill appears for the scrolled-up reader', up.pill);

if (up.pill) {
  await page.locator('.new-msgs').click();
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => {
    const feed = document.querySelector('.chat-feed');
    return {
      dist: Math.round(feed.scrollHeight - feed.scrollTop - feed.clientHeight),
      pill: !!document.querySelector('.new-msgs'),
    };
  });
  check('pill click re-pins to the bottom', after.dist < PIN_PX, `dist=${after.dist}px`);
  check('pill clears after jumping down', !after.pill);
}

await browser.close();
if (fails.length) {
  console.log(`\n${fails.length} failure(s): ${fails.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('\nall good');
}
