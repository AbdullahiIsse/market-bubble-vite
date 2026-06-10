// Client rendering performance probe. Run with the dev server up
// (PORT=3001 SIM_MODE=1 SIM_RATE=3000 npx tsx server/index.ts), then:
//   AUDIT_BASE=http://localhost:3001 node scripts/perf-test.mjs
// Measures, over a fixed window while chat is streaming:
//   - frames per second (rAF-counted)
//   - long tasks (>50ms): count + total main-thread blocked ms
//   - JS heap growth
//   - chat messages appended (DOM mutation count, throughput sanity check)
import { chromium } from 'playwright';

const base = process.env.AUDIT_BASE || 'http://localhost:3001';
const WINDOW_MS = Number(process.env.PERF_WINDOW_MS || 15000);
// 4 ≈ mid-range laptop with a video decoding next to the chat
const CPU_THROTTLE = Number(process.env.PERF_CPU_THROTTLE || 1);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => console.log(`[pageerror] ${String(err).slice(0, 300)}`));

if (CPU_THROTTLE > 1) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
}

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.msg', { timeout: 20000 });
await page.waitForTimeout(2000); // let the feed warm up

const result = await page.evaluate(async (windowMs) => {
  const out = {
    frames: 0,
    fps: 0,
    longTasks: 0,
    longTaskMs: 0,
    worstTaskMs: 0,
    msgsAppended: 0,
    heapBeforeMB: null,
    heapAfterMB: null,
  };

  if (performance.memory) {
    out.heapBeforeMB = performance.memory.usedJSHeapSize / 1048576;
  }

  const lt = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      out.longTasks++;
      out.longTaskMs += e.duration;
      if (e.duration > out.worstTaskMs) out.worstTaskMs = e.duration;
    }
  });
  lt.observe({ type: 'longtask', buffered: false });

  const feed = document.querySelector('.chat-feed');
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList?.contains('msg')) out.msgsAppended++;
      }
    }
  });
  if (feed) mo.observe(feed, { childList: true });

  let raf = 0;
  const onFrame = () => {
    out.frames++;
    raf = requestAnimationFrame(onFrame);
  };
  raf = requestAnimationFrame(onFrame);

  await new Promise((r) => setTimeout(r, windowMs));

  cancelAnimationFrame(raf);
  lt.disconnect();
  mo.disconnect();
  if (performance.memory) {
    out.heapAfterMB = performance.memory.usedJSHeapSize / 1048576;
  }
  out.fps = out.frames / (windowMs / 1000);
  return out;
}, WINDOW_MS);

const fmt = (n) => (n == null ? 'n/a' : typeof n === 'number' ? n.toFixed(1) : n);
console.log(`window:        ${WINDOW_MS / 1000}s @ ${base} (cpu throttle ${CPU_THROTTLE}x)`);
console.log(`fps:           ${fmt(result.fps)}`);
console.log(`long tasks:    ${result.longTasks} (${fmt(result.longTaskMs)}ms blocked, worst ${fmt(result.worstTaskMs)}ms)`);
console.log(`msgs appended: ${result.msgsAppended} (${fmt(result.msgsAppended / (WINDOW_MS / 1000))}/s)`);
console.log(`heap:          ${fmt(result.heapBeforeMB)}MB -> ${fmt(result.heapAfterMB)}MB`);

await browser.close();
