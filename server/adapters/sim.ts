// Dev-only synthetic source. Port of the design handoff's chat-sim.js, wired to
// push through the real hub so the whole client/ws path is exercised without live
// streams. Never imported when SIM_MODE is off. The browser contains no sim code.
import type { Hub } from '../hub';
import type { AppConfig } from '../config';
import type { ChatMessage, Host, Platform, ViewerMatrix } from '../../shared/protocol';
import { scoped } from '../lib/log';

const log = scoped('sim');

const USERS: Record<Platform, string[]> = {
  twitch: [
    'bubbleboy_', 'dipbuyer420', 'thetagang_greg', 'polywatcher', 'NYSE_nick',
    'candlestick_carl', 'fazefanatic', 'mods_asleep', 'limit_larry', 'tendies4life',
    'shortsqueezer', 'vix_vicky', 'paperhands_pete', 'bullpen_lurker', 'gamma_gary',
    'oddschecker99', 'liquidity_lou', 'puts_on_everything', 'marketmaker_m', 'spread_steve',
  ],
  kick: [
    'kickdegen', 'greenwire', 'allin_andy', 'leverage_lord', 'bagholder_bob',
    'pump_patrol', 'kick_quant', 'moonboy_max', 'riskon_rita', 'fomo_frank',
    'degenerate_dca', 'stoploss_sam', 'wick_watcher', 'flipmode_fin',
  ],
  x: [
    'MacroMandy', 'BondKing_', 'FedWatcher', 'TickerTalk', 'AlphaSeeker',
    'QuantHusband', 'DealFlowDan', 'CharterCathie', 'YieldCurveYuri', 'BubbleEconomist',
    'PrintMoneyPls', 'SoftLanding_', 'HawkishHelen',
  ],
};

const LINES = [
  'BANKS IS COOKING', 'ANSEM CALLED IT', 'buy the dip', 'this is not financial advice KEKW',
  'odds just flipped on polymarket', 'WHO SHORTED??', 'polymarket says 73% yes',
  'my portfolio after this segment', 'LULW', 'KEKW', 'PogU', 'the chart agrees',
  'priced in', 'nothing is priced in', 'INVEST IN YOURSELF', 'leverage AI lmao',
  'command attention', 'make money', 'this take is going to age badly',
  'someone clip that', 'CLIP IT', 'W take', 'L take', 'ratio incoming',
  'the fed would never', 'rate cut confirmed??', 'inverse him', 'longing this',
  'shorting this take', 'put it on the board', 'CHAT IS THIS REAL',
  'he just said the quiet part out loud', 'top signal', 'bottom signal',
  'I bought at the top again', 'diamond hands', 'okay that was actually smart',
  'bro is leveraged 20x', 'risk management? never heard of her',
  'the bubble never pops', 'POP THE BUBBLE', 'thursday 1pm we ride',
  'whats the line on this', 'odds moved 8 points during that take',
  'market makers hate him', 'this aged like milk already', 'soft landing copium',
  'print it', 'send it', 'no chance that hits', 'lock of the week',
  'fade the chat', 'chat is always wrong', 'chat is never wrong',
  'I have insider info (I made it up)', 'source: trust me',
  'down bad since the open', 'green dildos only', 'red candles incoming',
  'hedge accordingly', 'the spread is criminal', 'vol is so cheap rn',
  'pulling up the chart', 'zoom out', 'ZOOM IN', 'check the 4hr',
  'wall street wishes they had this alpha', 'better than CNBC fr',
  'banks vs ansem round 2 when', 'run it back', 'double or nothing',
  'Z with the alpha again', 'both chats agree for once',
];

const RARE = [
  'just put my rent on YES', 'mods ban the doomers', 'first time chatter, love the show',
  'watching from the trading floor lol', 'my boss is in this chat', 'GAMBA',
  'this show is why I owe the IRS', 'subscribe button where',
  'who let the bond guy talk this long', 'audio is crisp today W setup',
  'came from twitch chat, the shared chat is better here',
];

const INITIAL_VIEWERS: Record<Platform, Record<Host, number>> = {
  twitch: { banks: 8432, ansem: 6118 },
  kick: { banks: 2915, ansem: 1407 },
  x: { banks: 1502, ansem: 2261 },
};

const PLATFORMS: Platform[] = ['twitch', 'kick', 'x'];
const HOSTS: Host[] = ['banks', 'ansem'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

type NumMatrix = Record<Platform, Record<Host, number>>;

function totalOf(v: NumMatrix): number {
  let t = 0;
  for (const p of PLATFORMS) for (const h of HOSTS) t += v[p][h];
  return t;
}

function pickChannel(v: NumMatrix): { platform: Platform; host: Host } {
  let r = Math.random() * totalOf(v);
  for (const p of PLATFORMS) {
    for (const h of HOSTS) {
      if ((r -= v[p][h]) < 0) return { platform: p, host: h };
    }
  }
  return { platform: 'twitch', host: 'banks' };
}

function drift(v: NumMatrix): NumMatrix {
  const step = (n: number, mag: number) =>
    Math.max(50, Math.round(n + (Math.random() - 0.48) * mag));
  return {
    twitch: { banks: step(v.twitch.banks, 90), ansem: step(v.twitch.ansem, 80) },
    kick: { banks: step(v.kick.banks, 45), ansem: step(v.kick.ansem, 35) },
    x: { banks: step(v.x.banks, 30), ansem: step(v.x.ansem, 35) },
  };
}

function toMatrix(v: NumMatrix): ViewerMatrix {
  return {
    twitch: { banks: v.twitch.banks, ansem: v.twitch.ansem },
    kick: { banks: v.kick.banks, ansem: v.kick.ansem },
    x: { banks: v.x.banks, ansem: v.x.ansem },
  };
}

export function startSim(hub: Hub, config: AppConfig): () => void {
  const live = config.sim.broadcast === 'live';
  let viewers: NumMatrix = JSON.parse(JSON.stringify(INITIAL_VIEWERS));
  let idc = 0;
  // one-shot timers remove themselves on fire — the old push-onto-an-array
  // version leaked a dead handle per message for the life of the process
  const timers = new Set<NodeJS.Timeout>();
  let alive = true;

  function after(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  }

  function makeMessage(ts: number): ChatMessage {
    const ch = pickChannel(viewers);
    const user = pick(USERS[ch.platform]);
    const text = Math.random() < 0.06 ? pick(RARE) : pick(LINES);
    return { id: 'sim:' + ++idc, platform: ch.platform, host: ch.host, user, text, ts };
  }

  function pushViewers() {
    const matrix = toMatrix(viewers);
    for (const p of PLATFORMS) hub.setPlatformViewers(p, matrix[p], live);
  }

  // seed backlog with past timestamps
  const now = Date.now();
  for (let i = 0; i < 28; i++) hub.ingestMessage(makeMessage(now - (28 - i) * 1800));
  for (const p of PLATFORMS) hub.setStatus(p, 'ok');
  pushViewers();

  // message loop — rate in msgs/min with the prototype's jitter
  function tick() {
    if (!alive) return;
    hub.ingestMessage(makeMessage(Date.now()));
    const base = 60000 / Math.max(5, config.sim.rate);
    after(base * (0.4 + Math.random() * 1.2), tick);
  }
  after(300, tick);

  // viewer drift every 2.5s
  const driftTimer = setInterval(() => {
    viewers = drift(viewers);
    pushViewers();
  }, 2500);

  // optional connection flapping to exercise the amber dots
  let flapTimer: NodeJS.Timeout | null = null;
  if (config.sim.flap) {
    flapTimer = setInterval(() => {
      if (Math.random() < 0.4) {
        const p = pick(PLATFORMS);
        hub.setStatus(p, 'reconnecting');
        after(3500, () => hub.setStatus(p, 'ok'));
      }
    }, 9000);
  }

  log(`sim source running (rate ${config.sim.rate}/min, broadcast ${config.sim.broadcast})`);

  return () => {
    alive = false;
    for (const t of timers) clearTimeout(t);
    timers.clear();
    clearInterval(driftTimer);
    if (flapTimer) clearInterval(flapTimer);
  };
}
