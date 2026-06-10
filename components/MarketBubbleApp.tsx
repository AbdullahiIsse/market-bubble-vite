import { useCallback, useEffect, useState } from 'react';
import type { Host, Platform } from '@/shared/protocol';
import { useAggregator } from '@/hooks/useAggregator';
import { TopBar, type Mode } from './TopBar';
import { WatchView } from './WatchView';
import { DashboardView } from './DashboardView';
import { ChatColumn } from './ChatColumn';
import { SettingsView } from './SettingsView';
import { AdminLogin } from './AdminLogin';

const MODE_KEY = 'mb-mode';

// `twitchChannels` arrives from the config-gated bootstrap in src/main.tsx
// (env-derived via /api/config) so the player embeds the configured channel
// from the very first render.
// Identity stability matters everywhere below: chat flushes re-render this
// component ~10x/s, and the memoized subtrees (player, top bar…) must see
// unchanged props to skip.
export function MarketBubbleApp({ twitchChannels }: { twitchChannels: Record<Host, string> }) {
  const agg = useAggregator();

  const [auth, setAuth] = useState<{ authed: boolean; required: boolean; available: boolean } | null>(null);
  const [isAdminPath, setIsAdminPath] = useState(() => window.location.pathname === '/admin');

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/session')
      .then((r) => r.json())
      .then((d) => {
        if (alive) setAuth({ authed: !!d.authed, required: !!d.required, available: !!d.available });
      })
      .catch(() => {
        if (alive) setAuth({ authed: false, required: false, available: false });
      });
    return () => {
      alive = false;
    };
  }, []);

  // one-time read: the popout flag is part of the window's identity, not state
  const [isPopout] = useState(
    () => new URLSearchParams(window.location.search).get('popout') === 'chat',
  );

  const [mode, setMode] = useState<Mode>('watch');
  const [mainHost, setMainHost] = useState<Host>('banks'); // never persisted
  const [chatHidden, setChatHidden] = useState(false);
  const [sources, setSources] = useState<Record<Platform, boolean>>({
    twitch: true,
    kick: true,
    x: true,
  });

  // Restore the persisted mode after mount. This is deliberately an effect, not
  // a lazy initializer: SSR must render the default so server and client HTML
  // match, then we restore the stored value once on the client.
  useEffect(() => {
    const stored = localStorage.getItem(MODE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === 'watch' || stored === 'dashboard' || stored === 'settings') setMode(stored);
  }, []);

  const changeMode = useCallback((m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* private mode */
    }
  }, []);

  const showSettings = !!auth && auth.available && (auth.authed || !auth.required);

  const onLoginSuccess = useCallback(() => {
    setAuth((a) => (a ? { ...a, authed: true } : { authed: true, required: true, available: true }));
    window.history.replaceState({}, '', '/');
    setIsAdminPath(false);
    changeMode('settings');
  }, [changeMode]);

  const onUnauthorized = useCallback(() => {
    setAuth((a) => (a ? { ...a, authed: false } : a));
    setMode('watch');
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/admin/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => {});
    setAuth((a) => (a ? { ...a, authed: false } : a));
    setMode('watch');
  }, []);

  const swapHost = useCallback(() => {
    setMainHost((h) => (h === 'banks' ? 'ansem' : 'banks'));
  }, []);

  const toggleSource = useCallback((p: Platform) => {
    setSources((s) => {
      const next = { ...s, [p]: !s[p] };
      if (!next.twitch && !next.kick && !next.x) return { twitch: true, kick: true, x: true };
      return next;
    });
  }, []);

  const popoutChat = useCallback(() => {
    window.open(
      window.location.origin + '/?popout=chat',
      'mb-chat',
      'width=420,height=760,resizable=yes',
    );
    setChatHidden(true);
  }, []);

  const hideChat = useCallback(() => setChatHidden(true), []);
  const showChat = useCallback(() => setChatHidden(false), []);

  if (isPopout) {
    return (
      <div className="app popout">
        <ChatColumn
          messages={agg.messages}
          sources={sources}
          status={agg.status}
          onToggleSource={toggleSource}
        />
      </div>
    );
  }

  if (isAdminPath && (!auth || (auth.available && !auth.authed))) {
    return <div className="app">{auth ? <AdminLogin onSuccess={onLoginSuccess} /> : null}</div>;
  }

  if (isAdminPath && auth && !auth.available) {
    return (
      <div className="app">
        <div className="admin-login">
          <div className="admin-login-card">
            <h1 className="admin-login-title">Admin</h1>
            <p className="admin-login-error">
              Admin isn't configured on this server — set ADMIN_PASSWORD to enable it.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const effectiveMode: Mode = mode === 'settings' && !showSettings ? 'watch' : mode;

  return (
    <div className="app">
      <TopBar mode={effectiveMode} onChange={changeMode} showSettings={showSettings} />
      {agg.everConnected && !agg.connected && (
        <div className="conn-banner">
          <span className="live-dot" /> Reconnecting…
        </div>
      )}
      {effectiveMode === 'settings' ? (
        <SettingsView status={agg.status} onLogout={logout} onUnauthorized={onUnauthorized} />
      ) : effectiveMode === 'watch' ? (
        <WatchView
          channels={twitchChannels}
          mainHost={mainHost}
          live={agg.live}
          onSwap={swapHost}
          viewers={agg.viewers}
          messages={agg.messages}
          sources={sources}
          status={agg.status}
          onToggleSource={toggleSource}
          chatHidden={chatHidden}
          onHideChat={hideChat}
          onShowChat={showChat}
          onPopout={popoutChat}
        />
      ) : (
        <DashboardView
          viewers={agg.viewers}
          history={agg.history}
          messages={agg.messages}
          sources={sources}
          msgsPerMin={agg.msgsPerMin}
        />
      )}
    </div>
  );
}
