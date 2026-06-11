import type { ChatMessage as Msg, Host, Platform, StatusMap, ViewerMatrix } from '@/shared/protocol';
import { StreamPlayer } from './StreamPlayer';
import { ViewerPill } from './ViewerPill';
import { SocialRow } from './SocialRow';
import { ChatColumn } from './ChatColumn';

// Default viewer-facing screen: stage (player + stage bar) beside the chat column.
export function WatchView({
  channels,
  mainHost,
  live,
  onSwap,
  viewers,
  messages,
  sources,
  status,
  onToggleSource,
  chatHidden,
  onHideChat,
  onShowChat,
  onPopout,
}: {
  channels: Record<Host, string>;
  mainHost: Host;
  live: boolean | null;
  onSwap: () => void;
  viewers: ViewerMatrix;
  messages: Msg[];
  sources: Record<Platform, boolean>;
  status: StatusMap;
  onToggleSource: (p: Platform) => void;
  chatHidden: boolean;
  onHideChat: () => void;
  onShowChat: () => void;
  onPopout: () => void;
}) {
  return (
    <div className="watch" data-screen-label="Watch mode">
      <div className="stage">
        <StreamPlayer channels={channels} mainHost={mainHost} live={live} onSwap={onSwap} />
        <div className="stage-bar">
          <ViewerPill viewers={viewers} up />
          <div className="stage-bar-spacer" />
          <SocialRow />
          {chatHidden && (
            <button className="show-chat" onClick={onShowChat} title="Show chat">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm0 14H5.17L4 17.17V4h16v12z" />
              </svg>
              Show chat
            </button>
          )}
        </div>
      </div>
      {!chatHidden && (
        <ChatColumn
          messages={messages}
          sources={sources}
          status={status}
          onToggleSource={onToggleSource}
          onHide={onHideChat}
          onPopout={onPopout}
        />
      )}
    </div>
  );
}
