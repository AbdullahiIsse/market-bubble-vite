import { memo, useMemo } from 'react';
import type { ChatMessage as Msg, Platform, StatusMap } from '@/shared/protocol';
import { PLATFORM_META } from '@/shared/meta';
import { PlatformIcon } from './PlatformIcon';
import { ChatFeed } from './ChatFeed';

const SOURCES: Platform[] = ['twitch', 'kick', 'x'];

function toggleTitle(on: boolean, p: Platform, status: string): string {
  const base = (on ? 'Hide ' : 'Show ') + PLATFORM_META[p].name;
  if (status === 'reconnecting') return base + ' (reconnecting…)';
  if (status === 'unavailable') return base + ' (unavailable)';
  return base;
}

// The combined chat column: source filter toggles with live connection dots,
// pop-out / hide tools, and the merged feed. Read-only by design — chatting
// happens in the hosts' own Twitch/Kick/X channels.
// memo: skips re-renders from unrelated app-shell state (e.g. viewer updates).
export const ChatColumn = memo(function ChatColumn({
  messages,
  sources,
  status,
  onToggleSource,
  onHide,
  onPopout,
}: {
  messages: Msg[];
  sources: Record<Platform, boolean>;
  status: StatusMap;
  onToggleSource: (p: Platform) => void;
  onHide?: () => void;
  onPopout?: () => void;
}) {
  // stable identity unless messages/sources actually change, so ChatFeed's
  // scroll-anchoring layout effect only fires on real feed changes
  const visible = useMemo(() => messages.filter((m) => sources[m.platform]), [messages, sources]);
  return (
    <aside className="chat-col">
      <div className="chat-head">
        <span className="chat-head-title">Combined Chat</span>
        <span className="chat-head-right">
          <span className="chat-head-srcs">
            {SOURCES.map((p) => (
              <button
                key={p}
                className={
                  'src-toggle' +
                  (sources[p] ? ' is-on' : '') +
                  (status[p] === 'unavailable' ? ' is-unavailable' : '')
                }
                onClick={() => onToggleSource(p)}
                title={toggleTitle(sources[p], p, status[p])}
                aria-pressed={sources[p]}
              >
                <PlatformIcon platform={p} size={12} />
                <span className={'conn-dot conn-' + status[p]} />
              </button>
            ))}
          </span>
          {(onPopout || onHide) && <span className="chat-head-sep" />}
          {onPopout && (
            <button className="chat-tool" onClick={onPopout} title="Pop out chat">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42L17.59 5H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z" />
              </svg>
            </button>
          )}
          {onHide && (
            <button className="chat-tool" onClick={onHide} title="Hide chat">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6.4 6 11 12l-4.6 6H8.9l4.6-6L8.9 6H6.4zm6.5 0 4.6 6-4.6 6h2.5l4.6-6-4.6-6h-2.5z" />
              </svg>
            </button>
          )}
        </span>
      </div>
      <ChatFeed messages={visible} />
    </aside>
  );
});
