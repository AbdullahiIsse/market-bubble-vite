// Market Bubble — chat simulation engine (plain JS, no React)
// Exposes window.MBSim
(function () {
  const USERS = {
    twitch: [
      'bubbleboy_', 'dipbuyer420', 'thetagang_greg', 'polywatcher', 'NYSE_nick',
      'candlestick_carl', 'fazefanatic', 'mods_asleep', 'limit_larry', 'tendies4life',
      'shortsqueezer', 'vix_vicky', 'paperhands_pete', 'bullpen_lurker', 'gamma_gary',
      'oddschecker99', 'liquidity_lou', 'puts_on_everything', 'marketmaker_m', 'spread_steve'
    ],
    kick: [
      'kickdegen', 'greenwire', 'allin_andy', 'leverage_lord', 'bagholder_bob',
      'pump_patrol', 'kick_quant', 'moonboy_max', 'riskon_rita', 'fomo_frank',
      'degenerate_dca', 'stoploss_sam', 'wick_watcher', 'flipmode_fin'
    ],
    x: [
      'MacroMandy', 'BondKing_', 'FedWatcher', 'TickerTalk', 'AlphaSeeker',
      'QuantHusband', 'DealFlowDan', 'CharterCathie', 'YieldCurveYuri', 'BubbleEconomist',
      'PrintMoneyPls', 'SoftLanding_', 'HawkishHelen'
    ],
    bubble: [
      'bubble_og', 'firstbubbler', 'mb_dayone', 'thursdayregular', 'bubblemaxi',
      'sharedchat_enjoyer', 'popwatch', 'mb_floor_trader', 'bubbleeconomy', 'chartreuse_fan'
    ]
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
    'Z with the alpha again', 'both chats agree for once'
  ];

  const RARE = [
    'just put my rent on YES', 'mods ban the doomers', 'first time chatter, love the show',
    'watching from the trading floor lol', 'my boss is in this chat', 'GAMBA',
    'this show is why I owe the IRS', 'subscribe button where',
    'who let the bond guy talk this long', 'audio is crisp today W setup',
    'came from twitch chat, the shared chat is better here'
  ];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // viewers: { twitch: {banks, ansem}, kick: {banks, ansem}, x: {banks, ansem} }
  const INITIAL_VIEWERS = {
    twitch: { banks: 8432, ansem: 6118 },
    kick:   { banks: 2915, ansem: 1407 },
    x:      { banks: 1502, ansem: 2261 }
  };

  const PLATFORMS = ['twitch', 'kick', 'x'];
  const HOSTS = ['banks', 'ansem'];

  function totalViewers(v) {
    let t = 0;
    PLATFORMS.forEach((p) => HOSTS.forEach((h) => { t += v[p][h]; }));
    return t;
  }
  function platformTotal(v, p) { return v[p].banks + v[p].ansem; }

  // Weighted pick across the 6 channels
  function pickChannel(viewers) {
    const total = totalViewers(viewers);
    let r = Math.random() * total;
    for (const p of PLATFORMS) {
      for (const h of HOSTS) {
        if ((r -= viewers[p][h]) < 0) return { platform: p, host: h };
      }
    }
    return { platform: 'twitch', host: 'banks' };
  }

  let idc = 0;
  function generateMessage(viewers) {
    const ch = pickChannel(viewers);
    const user = pick(USERS[ch.platform]);
    const text = Math.random() < 0.06 ? pick(RARE) : pick(LINES);
    return { id: 'm' + (++idc), platform: ch.platform, host: ch.host, user, text, ts: Date.now() };
  }

  function driftViewers(v) {
    const step = (n, mag) => Math.max(50, Math.round(n + (Math.random() - 0.48) * mag));
    return {
      twitch: { banks: step(v.twitch.banks, 90), ansem: step(v.twitch.ansem, 80) },
      kick:   { banks: step(v.kick.banks, 45),  ansem: step(v.kick.ansem, 35) },
      x:      { banks: step(v.x.banks, 30),     ansem: step(v.x.ansem, 35) }
    };
  }

  function seedMessages(viewers, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const m = generateMessage(viewers);
      m.ts = Date.now() - (n - i) * 1800;
      out.push(m);
    }
    return out;
  }

  window.MBSim = {
    generateMessage, driftViewers, INITIAL_VIEWERS, seedMessages, USERS,
    totalViewers, platformTotal, PLATFORMS, HOSTS
  };
})();
