// Market Bubble — main app
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "layout": "classic",
  "density": "cozy",
  "labelStyle": "badge",
  "accent": "#e8ff9c",
  "rate": 90,
  "player": "live",
  "broadcast": "live",
  "channelBanks": "fazebanks",
  "channelAnsem": "ansem"
}/*EDITMODE-END*/;

const MAX_MSGS = 220;
const BUCKET_MS = 5000;
const BUCKET_COUNT = 48;

function emptyBucket() { return { twitch: 0, kick: 0, x: 0 }; }

function useSimulation(rate) {
  const [messages, setMessages] = React.useState(() => MBSim.seedMessages(MBSim.INITIAL_VIEWERS, 28));
  const [viewers, setViewers] = React.useState(MBSim.INITIAL_VIEWERS);
  const [history, setHistory] = React.useState(() => ({
    twitch: [MBSim.platformTotal(MBSim.INITIAL_VIEWERS, 'twitch')],
    kick: [MBSim.platformTotal(MBSim.INITIAL_VIEWERS, 'kick')],
    x: [MBSim.platformTotal(MBSim.INITIAL_VIEWERS, 'x')]
  }));
  const [buckets, setBuckets] = React.useState(() => Array.from({ length: BUCKET_COUNT }, emptyBucket));
  const chatterCounts = React.useRef({});
  const viewersRef = React.useRef(viewers);
  viewersRef.current = viewers;

  // messages
  React.useEffect(() => {
    let alive = true;
    let timer;
    function tick() {
      if (!alive) return;
      const m = MBSim.generateMessage(viewersRef.current);
      chatterCounts.current[m.user] = (chatterCounts.current[m.user] || 0) + 1;
      setMessages((prev) => {
        const next = prev.length >= MAX_MSGS ? prev.slice(prev.length - MAX_MSGS + 1) : prev.slice();
        next.push(m);
        return next;
      });
      setBuckets((prev) => {
        const next = prev.slice();
        const last = Object.assign({}, next[next.length - 1]);
        last[m.platform]++;
        next[next.length - 1] = last;
        return next;
      });
      const base = 60000 / Math.max(5, rate);
      timer = setTimeout(tick, base * (0.4 + Math.random() * 1.2));
    }
    timer = setTimeout(tick, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [rate]);

  // bucket rotation
  React.useEffect(() => {
    const iv = setInterval(() => {
      setBuckets((prev) => prev.slice(1).concat([emptyBucket()]));
    }, BUCKET_MS);
    return () => clearInterval(iv);
  }, []);

  // viewer drift
  React.useEffect(() => {
    const iv = setInterval(() => {
      setViewers((v) => {
        const nv = MBSim.driftViewers(v);
        setHistory((h) => ({
          twitch: h.twitch.concat(MBSim.platformTotal(nv, 'twitch')).slice(-60),
          kick: h.kick.concat(MBSim.platformTotal(nv, 'kick')).slice(-60),
          x: h.x.concat(MBSim.platformTotal(nv, 'x')).slice(-60)
        }));
        return nv;
      });
    }, 2500);
    return () => clearInterval(iv);
  }, []);

  const selfIdc = React.useRef(0);
  function pushMessage(m) {
    m.id = 'self' + (++selfIdc.current);
    m.ts = Date.now();
    setMessages((prev) => {
      const next = prev.length >= MAX_MSGS ? prev.slice(prev.length - MAX_MSGS + 1) : prev.slice();
      next.push(m);
      return next;
    });
  }

  return { messages, viewers, history, buckets, chatterCounts, pushMessage };
}

// ——— Simulated per-source connection status ———
function useConnectionStatus() {
  const [conn, setConn] = React.useState({ twitch: 'ok', kick: 'ok', x: 'ok' });
  React.useEffect(() => {
    const iv = setInterval(() => {
      if (Math.random() < 0.14) {
        const sources = ['twitch', 'kick', 'x'];
        const s = sources[Math.floor(Math.random() * sources.length)];
        setConn((c) => Object.assign({}, c, { [s]: 'reconnecting' }));
        setTimeout(() => setConn((c) => Object.assign({}, c, { [s]: 'ok' })), 3500);
      }
    }, 9000);
    return () => clearInterval(iv);
  }, []);
  return conn;
}

function msgsPerMin(buckets) {
  return buckets.slice(-12).reduce((s, b) => s + b.twitch + b.kick + b.x, 0);
}

function topChatters(counts, n) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function findPlatform(user) {
  for (const p of ['twitch', 'kick', 'x']) {
    if (MBSim.USERS[p].indexOf(user) !== -1) return p;
  }
  return 'twitch';
}

// ——— Countdown to next Thursday 1PM ———
function useCountdown() {
  const [left, setLeft] = React.useState('');
  React.useEffect(() => {
    function tick() {
      const now = new Date();
      const t = new Date(now);
      let add = (4 - now.getDay() + 7) % 7;
      t.setDate(now.getDate() + add);
      t.setHours(13, 0, 0, 0);
      if (t <= now) t.setDate(t.getDate() + 7);
      let s = Math.floor((t - now) / 1000);
      const d = Math.floor(s / 86400); s -= d * 86400;
      const h = Math.floor(s / 3600); s -= h * 3600;
      const m = Math.floor(s / 60); s -= m * 60;
      setLeft((d > 0 ? d + 'd ' : '') + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'));
    }
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);
  return left;
}

const HERO_IMG = 'https://framerusercontent.com/images/ddD68QwxkKIzKFvThRqR9GgDCbw.png?scale-down-to=2048';

// ——— Stream player: main + swappable PiP ———
function StreamPlayer({ t, mainHost, onSwap }) {
  const otherHost = mainHost === 'banks' ? 'ansem' : 'banks';
  const channels = { banks: t.channelBanks, ansem: t.channelAnsem };
  const parent = location.hostname || 'localhost';
  const embed = (ch) => 'https://player.twitch.tv/?channel=' + encodeURIComponent(ch) + '&parent=' + parent + '&muted=true&autoplay=true';
  const countdown = useCountdown();

  if (t.broadcast === 'offline') {
    return (
      <div className="player player-offline">
        <img className="ph-bg" src={HERO_IMG} alt="Market Bubble set" />
        <div className="offline-content">
          <div className="offline-label">We&rsquo;re offline</div>
          <div className="offline-count">{countdown}</div>
          <div className="ph-schedule">Back<span className="dot-sep">&bull;</span>Thursday<span className="dot-sep">&bull;</span>1PM PST</div>
        </div>
      </div>
    );
  }

  return (
    <div className="player">
      {t.player === 'live'
        ? <iframe src={embed(channels[mainHost])} allowFullScreen={true} scrolling="no" title={HOST_META[mainHost].name + ' stream'}></iframe>
        : (
          <div className="player-placeholder">
            <img className="ph-bg" src={HERO_IMG} alt="Market Bubble set" />
            <div className="ph-schedule">Live<span className="dot-sep">&bull;</span>Thursdays<span className="dot-sep">&bull;</span>1PM PST</div>
          </div>
        )}
      <div className="player-tag">
        <span className="vt-host" style={{ color: HOST_META[mainHost].color, borderColor: HOST_META[mainHost].color }}>{HOST_META[mainHost].initial}</span>
        <span className="player-tag-text">{HOST_META[mainHost].name}&rsquo;s stream</span>
        <button className="tag-swap" onClick={onSwap} title={'Switch to ' + HOST_META[otherHost].name + '\u2019s stream'}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10v3l5-4-5-4v3H5v6h2V7zm10 10H7v-3l-5 4 5 4v-3h12v-6h-2v4z"></path></svg>
          <span className="vt-host" style={{ color: HOST_META[otherHost].color, borderColor: HOST_META[otherHost].color }}>{HOST_META[otherHost].initial}</span>
          <span className="tag-swap-name">{HOST_META[otherHost].name}</span>
        </button>
      </div>
    </div>
  );
}

// ——— Social links (same row as the site hero) ———
const MB_SOCIALS = [
  { name: 'Twitch', href: 'https://www.twitch.tv/fazebanks', d: 'M6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0H6zm14.572 11.143-3.429 3.428h-3.429l-3 3v-3H6.857V1.714h13.715v9.429zM16.286 4.714H18v5.143h-1.714V4.714zm-4.715 0h1.715v5.143h-1.715V4.714z' },
  { name: 'Spotify', href: 'https://open.spotify.com/show/00yWnJPE80LSBglGwCrjZI', d: 'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z' },
  { name: 'TikTok', href: 'https://www.tiktok.com/@marketbubble', d: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z' },
  { name: 'X', href: 'https://x.com/marketbubble', d: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z' }
];

function SocialRow() {
  return (
    <div className="social-row">
      {MB_SOCIALS.map((s) => (
        <a key={s.name} className="social-btn" href={s.href} target="_blank" rel="noopener" title={s.name} aria-label={s.name}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d={s.d}></path></svg>
        </a>
      ))}
    </div>
  );
}

// ——— Shared chat column ———
function ChatColumn({ t, sim, conn, sources, onToggleSource, composer, onHide, onPopout }) {
  const visible = sim.messages.filter((m) => sources[m.platform]);
  return (
    <aside className="chat-col">
      <div className="chat-head">
        <span className="chat-head-title">Combined Chat</span>
        <span className="chat-head-right">
          <span className="chat-head-srcs">
            {['twitch', 'kick', 'x'].map((p) => (
              <button key={p}
                      className={'src-toggle' + (sources[p] ? ' is-on' : '')}
                      onClick={() => onToggleSource(p)}
                      title={(sources[p] ? 'Hide ' : 'Show ') + PLATFORM_META[p].name + (conn[p] === 'reconnecting' ? ' (reconnecting…)' : '')}
                      aria-pressed={sources[p]}>
                <PlatformIcon platform={p} size={12} />
                <span className={'conn-dot conn-' + conn[p]}></span>
              </button>
            ))}
          </span>
          {(onPopout || onHide) && <span className="chat-head-sep"></span>}
          {onPopout && (
            <button className="chat-tool" onClick={onPopout} title="Pop out chat">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42L17.59 5H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z"></path></svg>
            </button>
          )}
          {onHide && (
            <button className="chat-tool" onClick={onHide} title="Hide chat">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6.4 6 11 12l-4.6 6H8.9l4.6-6L8.9 6H6.4zm6.5 0 4.6 6-4.6 6h2.5l4.6-6-4.6-6h-2.5z"></path></svg>
            </button>
          )}
        </span>
      </div>
      <ChatFeed messages={visible} labelStyle={t.labelStyle} density={t.density} />
      {composer}
    </aside>
  );
}

// ——— Watch view ———
function WatchView({ t, sim, conn, sources, onToggleSource, composer, mainHost, onSwap, chatHidden, onHideChat, onShowChat, onPopout }) {
  return (
    <div className={'watch layout-' + t.layout} data-screen-label="Watch mode">
      <div className="stage">
        <StreamPlayer t={t} mainHost={mainHost} onSwap={onSwap} />
        <div className="stage-bar">
          <ViewerPill viewers={sim.viewers} up={true} />
          <div className="stage-bar-spacer"></div>
          <SocialRow />
          {chatHidden && (
            <button className="show-chat" onClick={onShowChat} title="Show chat">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm0 14H5.17L4 17.17V4h16v12z"></path></svg>
              Show chat
            </button>
          )}
        </div>
      </div>
      {!chatHidden && (
        <ChatColumn t={t} sim={sim} conn={conn} sources={sources} onToggleSource={onToggleSource}
                    composer={composer} onHide={onHideChat} onPopout={onPopout} />
      )}
    </div>
  );
}

// ——— Dashboard (owner) view ———
function DashboardView({ t, sim, conn, sources, onToggleSource, composer }) {
  const { viewers, history, buckets } = sim;
  const total = MBSim.totalViewers(viewers);
  const totalHistory = history.twitch.map((v, i) => v + (history.kick[i] || 0) + (history.x[i] || 0));
  const share = (p) => (total ? Math.round((MBSim.platformTotal(viewers, p) / total) * 100) : 0);

  return (
    <div className="dash" data-screen-label="Dashboard mode">
      <div className="dash-stats">
        <div className="stat-card stat-card-combined">
          <div className="stat-card-head"><span className="live-dot"></span><span className="stat-card-name">Combined audience</span></div>
          <div className="stat-card-count big" style={{ color: 'var(--accent)' }}>{num(total)}</div>
          <Sparkline data={totalHistory} color="var(--accent)" width={190} height={30} />
        </div>
        {['twitch', 'kick', 'x'].map((p) => (
          <PlatformCard key={p} platform={p} counts={viewers[p]} history={history[p]} share={share(p)} />
        ))}
      </div>
      <div className="dash-main">
        <section className="dash-chat">
          <div className="chat-head">
            <span className="chat-head-title">Combined Chat</span>
            <span className="chat-head-meta">{msgsPerMin(buckets)} msgs/min</span>
          </div>
          <ChatFeed messages={sim.messages.filter((m) => sources[m.platform])} labelStyle={t.labelStyle} density={t.density} className="chat-wall" />
          {composer}
        </section>
      </div>
    </div>
  );
}

// ——— App ———
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const sim = useSimulation(t.rate);
  const conn = useConnectionStatus();
  const isPopout = new URLSearchParams(location.search).get('popout') === 'chat';
  const [mode, setMode] = React.useState(() => localStorage.getItem('mb-mode') || 'watch');
  const [mainHost, setMainHost] = React.useState('banks');
  const [chatHidden, setChatHidden] = React.useState(false);
  const [sources, setSources] = React.useState({ twitch: true, kick: true, x: true });

  // linked accounts (simulated — persists locally)
  const [linked, setLinked] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('mb-linked')) || { twitch: false, kick: false, x: false }; }
    catch (e) { return { twitch: false, kick: false, x: false }; }
  });
  const [identity, setIdentity] = React.useState(() => {
    const v = localStorage.getItem('mb-identity');
    return (v === 'bubble' || !v) ? null : v;
  });

  function changeMode(m) { setMode(m); localStorage.setItem('mb-mode', m); }
  function swapHost() {
    setMainHost((h) => (h === 'banks' ? 'ansem' : 'banks'));
  }
  function toggleSource(p) {
    setSources((s) => {
      const next = Object.assign({}, s, { [p]: !s[p] });
      if (!next.twitch && !next.kick && !next.x) {
        return { twitch: true, kick: true, x: true };
      }
      return next;
    });
  }
  function linkAccount(p) {
    const next = Object.assign({}, linked, { [p]: true });
    setLinked(next);
    localStorage.setItem('mb-linked', JSON.stringify(next));
    selectIdentity(p);
  }
  function selectIdentity(p) {
    setIdentity(p);
    localStorage.setItem('mb-identity', p);
  }
  function sendMessage(text) {
    if (!identity) return;
    // message posts into the channel of the stream you're watching
    sim.pushMessage({ platform: identity, host: mainHost, user: 'you', text: text, self: true });
  }

  function popoutChat() {
    window.open(location.href.split('?')[0] + '?popout=chat', 'mb-chat', 'width=420,height=760,resizable=yes');
    setChatHidden(true);
  }

  const composer = (
    <ChatComposer linked={linked} identity={identity}
                  onLink={linkAccount} onSelectIdentity={selectIdentity} onSend={sendMessage} />
  );

  if (isPopout) {
    return (
      <div className="app popout" style={{ '--accent': t.accent }}>
        <ChatColumn t={t} sim={sim} conn={conn} sources={sources} onToggleSource={toggleSource} composer={composer} />
      </div>
    );
  }

  return (
    <div className="app" style={{ '--accent': t.accent }}>
      <header className="topbar">
        <Logo />
        <ModeTabs mode={mode} onChange={changeMode} />
        <div className="topbar-schedule">Live<span className="dot-sep">&bull;</span>Thursdays<span className="dot-sep">&bull;</span>1PM PST</div>
      </header>
      {mode === 'watch'
        ? <WatchView t={t} sim={sim} conn={conn} sources={sources} onToggleSource={toggleSource}
                     composer={composer} mainHost={mainHost} onSwap={swapHost}
                     chatHidden={chatHidden} onHideChat={() => setChatHidden(true)}
                     onShowChat={() => setChatHidden(false)} onPopout={popoutChat} />
        : <DashboardView t={t} sim={sim} conn={conn} sources={sources} onToggleSource={toggleSource} composer={composer} />}

      <TweaksPanel>
        <TweakSection label="Layout" />
        <TweakRadio label="Watch layout" value={t.layout} options={['classic', 'flipped', 'theater']}
                    onChange={(v) => setTweak('layout', v)} />
        <TweakSection label="Chat" />
        <TweakRadio label="Density" value={t.density} options={['cozy', 'compact', 'ultra']}
                    onChange={(v) => setTweak('density', v)} />
        <TweakSelect label="Source label" value={t.labelStyle}
                     options={[{ value: 'badge', label: 'Badge chip' }, { value: 'icon', label: 'Icon only' }, { value: 'iconname', label: 'Icon + name' }, { value: 'bar', label: 'Edge bar' }]}
                     onChange={(v) => setTweak('labelStyle', v)} />
        <TweakSlider label="Chat speed" value={t.rate} min={15} max={300} step={5} unit="/min"
                     onChange={(v) => setTweak('rate', v)} />
        <TweakSection label="Look" />
        <TweakColor label="Accent" value={t.accent} options={['#e8ff9c', '#ffffff', '#a970ff']}
                    onChange={(v) => setTweak('accent', v)} />
        <TweakSection label="Stream" />
        <TweakRadio label="Show state" value={t.broadcast} options={[{ value: 'live', label: 'Live' }, { value: 'offline', label: 'Offline' }]}
                    onChange={(v) => setTweak('broadcast', v)} />
        <TweakRadio label="Player" value={t.player} options={[{ value: 'live', label: 'Live embed' }, { value: 'placeholder', label: 'Placeholder' }]}
                    onChange={(v) => setTweak('player', v)} />
        <TweakText label="Banks' Twitch" value={t.channelBanks} onChange={(v) => setTweak('channelBanks', v)} />
        <TweakText label="Ansem's Twitch" value={t.channelAnsem} onChange={(v) => setTweak('channelAnsem', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
