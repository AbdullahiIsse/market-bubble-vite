// Market Bubble — shared UI components
const { useState, useEffect, useRef, useMemo } = React;

const PLATFORM_META = {
  twitch: { name: 'Twitch', color: '#a970ff', accent: '#a970ff' },
  kick:   { name: 'Kick',   color: '#52ff8f', accent: '#52ff8f' },
  x:      { name: 'X',      color: '#d8d5cc', accent: '#ffffff' },
  bubble: { name: 'Bubble', color: '#e8ff9c', accent: '#e8ff9c' }
};

const HOST_META = {
  banks: { name: 'Banks', initial: 'B', color: '#e8ff9c' },
  ansem: { name: 'Ansem', initial: 'Z', color: '#8ab4ff' }
};

function PlatformIcon({ platform, size = 14, fill }) {
  const c = fill || PLATFORM_META[platform].color;
  if (platform === 'twitch') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={c} aria-label="Twitch">
        <path d="M6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0H6zm14.572 11.143-3.429 3.428h-3.429l-3 3v-3H6.857V1.714h13.715v9.429zM16.286 4.714H18v5.143h-1.714V4.714zm-4.715 0h1.715v5.143h-1.715V4.714z"></path>
      </svg>
    );
  }
  if (platform === 'kick') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={c} aria-label="Kick">
        <path d="M3 2h6v6h2V6h2V4h2V2h6v7h-2v2h-2v2h2v2h2v7h-6v-2h-2v-2h-2v-2h-2v6H3V2z"></path>
      </svg>
    );
  }
  if (platform === 'bubble') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Bubble">
        <circle cx="12" cy="12" r="8.2" fill="none" stroke={c} strokeWidth="2"></circle>
        <circle cx="9.2" cy="8.8" r="2.1" fill={c}></circle>
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={c} aria-label="X">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z"></path>
    </svg>
  );
}

function num(n) { return n.toLocaleString('en-US'); }

// ——— Logo ———
function Logo() {
  return (
    <div className="mb-logo">
      <div className="mb-logo-word">Market&nbsp;Bubble</div>
      <div className="mb-logo-sub">Presented by Polymarket</div>
    </div>
  );
}

// ——— Mode tabs ———
function ModeTabs({ mode, onChange }) {
  return (
    <nav className="mode-tabs" aria-label="View mode">
      {[['watch', 'Watch'], ['dashboard', 'Dashboard']].map(([k, label]) => (
        <button key={k} className={'mode-tab' + (mode === k ? ' is-active' : '')} onClick={() => onChange(k)}>{label}</button>
      ))}
    </nav>
  );
}

// ——— Combined viewer pill with channel-matrix tooltip ———
function ViewerPill({ viewers, up }) {
  const total = MBSim.totalViewers(viewers);
  const channels = [];
  MBSim.PLATFORMS.forEach((p) => MBSim.HOSTS.forEach((h) => channels.push([p, h])));
  const max = Math.max(...channels.map(([p, h]) => viewers[p][h]));
  return (
    <div className={'viewer-pill-wrap' + (up ? ' up' : '')}>
      <div className="viewer-pill" tabIndex={0}>
        <span className="live-dot"></span>
        <span className="viewer-total">{num(total)}</span>
        <span className="viewer-label">watching</span>
      </div>
      <div className="viewer-tooltip" role="tooltip">
        <div className="vt-title">Viewers by channel</div>
        {channels.map(([p, h]) => {
          const v = viewers[p][h];
          const share = total ? Math.round((v / total) * 100) : 0;
          return (
            <div className="vt-row" key={p + h}>
              <PlatformIcon platform={p} size={13} />
              <span className="vt-host" style={{ color: HOST_META[h].color, borderColor: HOST_META[h].color }}>{HOST_META[h].initial}</span>
              <span className="vt-name">{HOST_META[h].name}</span>
              <span className="vt-bar"><span className="vt-bar-fill" style={{ width: (max ? (v / max) * 100 : 0) + '%', background: PLATFORM_META[p].color }}></span></span>
              <span className="vt-count">{num(v)}</span>
              <span className="vt-share">{share}%</span>
            </div>
          );
        })}
        <div className="vt-foot"><span>Combined</span><span>{num(total)}</span></div>
      </div>
    </div>
  );
}

// ——— Sparkline ———
function Sparkline({ data, color, width = 120, height = 28 }) {
  if (!data || data.length < 2) return <svg width={width} height={height}></svg>;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (width - 2) + 1;
    const y = height - 3 - ((v - min) / span) * (height - 6);
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return (
    <svg width={width} height={height} className="sparkline">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.9"></polyline>
    </svg>
  );
}

// ——— Chat message ———
function ChatMessage({ msg, labelStyle }) {
  const meta = PLATFORM_META[msg.platform];
  const host = msg.host ? HOST_META[msg.host] : null;
  return (
    <div className={'msg src-' + msg.platform + (labelStyle === 'bar' ? ' msg-bar' : '') + (labelStyle === 'badge' ? ' msg-row-badge' : '') + (msg.self ? ' msg-self' : '')}
         style={labelStyle === 'bar' ? { borderLeftColor: meta.color } : null}>
      {labelStyle === 'badge' && (
        <span className={'msg-badge badge-' + msg.platform} title={meta.name + (host ? ' — ' + host.name + "'s channel" : ' — marketbubble.com')}>
          <PlatformIcon platform={msg.platform} size={13} fill={meta.accent} />
          {host && (
            <span className="host-dot" style={{ color: host.color, borderColor: host.color }}>{host.initial}</span>
          )}
        </span>
      )}
      {labelStyle !== 'bar' && labelStyle !== 'badge' && (
        <span className="msg-src" title={meta.name}>
          <PlatformIcon platform={msg.platform} size={12} />
          {labelStyle === 'iconname' && <span className="msg-src-name" style={{ color: meta.color }}>{meta.name}</span>}
        </span>
      )}
      <span className="msg-user" style={{ color: meta.color }}>{msg.user}</span>
      <span className="msg-text">{msg.text}</span>
    </div>
  );
}

// ——— Auto-scrolling chat feed with "new messages" pill ———
function ChatFeed({ messages, labelStyle, density, className }) {
  const ref = useRef(null);
  const pinned = useRef(true);
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (pinned.current) {
      el.scrollTop = el.scrollHeight;
    } else {
      setUnseen((u) => Math.min(u + 1, 99));
    }
  }, [messages]);

  function onScroll() {
    const el = ref.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    if (atBottom && !pinned.current) setUnseen(0);
    pinned.current = atBottom;
  }

  function jumpDown() {
    const el = ref.current;
    el.scrollTop = el.scrollHeight;
    pinned.current = true;
    setUnseen(0);
  }

  return (
    <div className="chat-feed-wrap">
      <div className={'chat-feed density-' + density + (className ? ' ' + className : '')} ref={ref} onScroll={onScroll}>
        {messages.map((m) => <ChatMessage key={m.id} msg={m} labelStyle={labelStyle} />)}
      </div>
      {unseen > 0 && (
        <button className="new-msgs" onClick={jumpDown}>
          ↓ {unseen}{unseen >= 99 ? '+' : ''} new message{unseen === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

// ——— Chat velocity bars ———
function VelocityBars({ buckets }) {
  const max = Math.max(4, ...buckets.map((b) => b.twitch + b.kick + b.x));
  return (
    <div className="velocity">
      {buckets.map((b, i) => {
        const total = b.twitch + b.kick + b.x;
        const h = (total / max) * 100;
        return (
          <div className="vel-col" key={i} title={total + ' msgs'}>
            <div className="vel-stack" style={{ height: h + '%' }}>
              <div style={{ flex: b.twitch || 0.0001, background: PLATFORM_META.twitch.color }}></div>
              <div style={{ flex: b.kick || 0.0001, background: PLATFORM_META.kick.color }}></div>
              <div style={{ flex: b.x || 0.0001, background: PLATFORM_META.x.color }}></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ——— Platform stat card with Banks/Ansem split ———
function PlatformCard({ platform, counts, history, share }) {
  const meta = PLATFORM_META[platform];
  const total = counts.banks + counts.ansem;
  return (
    <div className="stat-card">
      <div className="stat-card-head">
        <PlatformIcon platform={platform} size={15} />
        <span className="stat-card-name">{meta.name}</span>
        <span className="stat-card-share">{share}%</span>
      </div>
      <div className="stat-card-count">{num(total)}</div>
      <div className="stat-hosts">
        {['banks', 'ansem'].map((h) => (
          <span className="stat-host" key={h}>
            <span className="vt-host" style={{ color: HOST_META[h].color, borderColor: HOST_META[h].color }}>{HOST_META[h].initial}</span>
            <span className="stat-host-count">{num(counts[h])}</span>
          </span>
        ))}
      </div>
      <Sparkline data={history} color={meta.color} width={150} height={24} />
    </div>
  );
}

// ——— Composer: type in chat with a linked account ———
function ChatComposer({ linked, identity, onLink, onSelectIdentity, onSend }) {
  const [text, setText] = useState('');
  const anyLinked = linked.twitch || linked.kick || linked.x;

  function submit(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t || !anyLinked) return;
    onSend(t);
    setText('');
  }

  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer-ids">
        {['twitch', 'kick', 'x'].map((p) => (
          <button type="button" key={p}
                  className={'id-chip' + (linked[p] ? ' is-linked' : '') + (identity === p ? ' is-active' : '')}
                  title={linked[p] ? 'Chat as ' + PLATFORM_META[p].name : 'Link ' + PLATFORM_META[p].name + ' to chat'}
                  onClick={() => (linked[p] ? onSelectIdentity(p) : onLink(p))}>
            <PlatformIcon platform={p} size={13} />
            {!linked[p] && <span className="id-plus">+</span>}
          </button>
        ))}
      </div>
      <input
        className="composer-input"
        type="text"
        value={text}
        maxLength={200}
        placeholder={anyLinked ? 'Send a message as @' + (identity ? PLATFORM_META[identity].name.toLowerCase() + '/you' : 'you') : 'Link an account to chat'}
        disabled={!anyLinked}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="composer-send" type="submit" disabled={!anyLinked || !text.trim()} aria-label="Send">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"></path></svg>
      </button>
    </form>
  );
}

Object.assign(window, {
  PLATFORM_META, HOST_META, PlatformIcon, Logo, ModeTabs, ViewerPill, Sparkline,
  ChatMessage, ChatFeed, VelocityBars, PlatformCard, num, ChatComposer
});
