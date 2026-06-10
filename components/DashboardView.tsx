import { useMemo } from 'react';
import type {
  ChatMessage as Msg,
  Platform,
  ViewerHistory,
  ViewerMatrix,
} from '@/shared/protocol';
import { PLATFORMS, totalViewers, platformTotal } from '@/shared/meta';
import { num } from './format';
import { Sparkline } from './Sparkline';
import { PlatformCard } from './PlatformCard';
import { ChatFeed } from './ChatFeed';

// Owner-facing dashboard: combined + per-platform stat cards with B/Z splits and
// sparklines, plus the full-width chat wall with a live msgs/min counter.
export function DashboardView({
  viewers,
  history,
  messages,
  sources,
  msgsPerMin,
}: {
  viewers: ViewerMatrix;
  history: ViewerHistory;
  messages: Msg[];
  sources: Record<Platform, boolean>;
  msgsPerMin: number;
}) {
  const total = totalViewers(viewers);
  // stable identity across chat flushes so the combined Sparkline memo holds
  const totalHistory = useMemo(
    () => history.twitch.map((v, i) => v + (history.kick[i] || 0) + (history.x[i] || 0)),
    [history],
  );
  const share = (p: Platform) =>
    total ? Math.round((platformTotal(viewers, p) / total) * 100) : 0;
  const wallMessages = useMemo(
    () => messages.filter((m) => sources[m.platform]),
    [messages, sources],
  );

  return (
    <div className="dash" data-screen-label="Dashboard mode">
      <div className="dash-stats">
        <div className="stat-card stat-card-combined">
          <div className="stat-card-head">
            <span className="live-dot" />
            <span className="stat-card-name">Combined audience</span>
          </div>
          <div className="stat-card-count big" style={{ color: 'var(--accent)' }}>
            {num(total)}
          </div>
          <Sparkline data={totalHistory} color="var(--accent)" width={190} height={30} />
        </div>
        {PLATFORMS.map((p) => (
          <PlatformCard
            key={p}
            platform={p}
            counts={viewers[p]}
            history={history[p]}
            share={share(p)}
          />
        ))}
      </div>
      <div className="dash-main">
        <section className="dash-chat">
          <div className="chat-head">
            <span className="chat-head-title">Combined Chat</span>
            <span className="chat-head-right">
              <span className="chat-head-meta">{msgsPerMin} msgs/min</span>
            </span>
          </div>
          <ChatFeed messages={wallMessages} className="chat-wall" />
        </section>
      </div>
    </div>
  );
}
