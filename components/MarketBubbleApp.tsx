import { useCallback, useEffect, useState } from 'react';
import type { Host, Platform } from '@/shared/protocol';
import { useAggregator } from '@/hooks/useAggregator';
import { TopBar, type Mode } from './TopBar';
import { WatchView } from './WatchView';
import { DashboardView } from './DashboardView';
import { ChatColumn } from './ChatColumn';

const MODE_KEY = 'mb-mode';

// `twitchChannels` arrives from the config-gated bootstrap in src/main.tsx
// (env-derived via /api/config) so the player embeds the configured channel
// from the very first render.
// Identity stability matters everywhere below: chat flushes re-render this
// component ~10x/s, and the memoized subtrees (player, top bar…) must see
// unchanged props to skip.
export function MarketBubbleApp({ twitchChannels }: { twitchChannels: Record<Host, string> }) {
  const agg = useAggregator();

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
    if (stored === 'watch' || stored === 'dashboard') setMode(stored);
  }, []);

  const changeMode = useCallback((m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* private mode */
    }
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

  return (
    <div className="app">
      <TopBar mode={mode} onChange={changeMode} />
      {agg.everConnected && !agg.connected && (
        <div className="conn-banner">
          <span className="live-dot" /> Reconnecting…
        </div>
      )}
      {mode === 'watch' ? (
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
