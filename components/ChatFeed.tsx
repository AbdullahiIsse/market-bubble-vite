import { useLayoutEffect, useRef, useState } from 'react';
import type { ChatMessage as Msg } from '@/shared/protocol';
import { ChatMessage } from './ChatMessage';

// How many messages arrived since `prevLastId`? Batched flushes append several
// at once, so walk back from the end instead of counting state changes.
function appendedSince(messages: Msg[], prevLastId: string | null): number {
  if (prevLastId === null) return messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].id === prevLastId) return messages.length - 1 - i;
  }
  return messages.length; // previous tail already capped out of the buffer
}

// Auto-scrolling feed. Stays pinned to the bottom; if the user scrolls up,
// new arrivals don't yank the scroll — a "↓ N new messages" pill appears.
// Density is baked to "cozy" (the prototype default).
export function ChatFeed({ messages, className }: { messages: Msg[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastSeenId = useRef<string | null>(null);
  const [unseen, setUnseen] = useState(0);

  // Layout effect on purpose: when the buffer is at cap, a flush trims rows off
  // the top and scroll anchoring compensates by lowering scrollTop, queueing a
  // scroll event that sits a whole batch (>90px) above the bottom. The re-pin
  // must land in the same commit task — a passive effect can run after that
  // event under load, and onScroll would unpin the feed with no user input.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (pinned.current) {
      el.scrollTop = el.scrollHeight;
      lastSeenId.current = messages.length ? messages[messages.length - 1].id : null;
    } else {
      // lastSeenId stays put while the reader is scrolled up, so this is the
      // running total since they stopped — set it, don't accumulate.
      setUnseen(Math.min(appendedSince(messages, lastSeenId.current), 99));
    }
  }, [messages]);

  function markSeen() {
    lastSeenId.current = messages.length ? messages[messages.length - 1].id : null;
    setUnseen(0);
  }

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    if (atBottom && !pinned.current) markSeen();
    pinned.current = atBottom;
  }

  function jumpDown() {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    pinned.current = true;
    markSeen();
  }

  return (
    <div className="chat-feed-wrap">
      <div
        className={'chat-feed density-cozy' + (className ? ' ' + className : '')}
        ref={ref}
        onScroll={onScroll}
      >
        {messages.map((m) => (
          <ChatMessage key={m.id} msg={m} />
        ))}
      </div>
      {unseen > 0 && (
        <button className="new-msgs" onClick={jumpDown}>
          ↓ {unseen}
          {unseen >= 99 ? '+' : ''} new message{unseen === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}
