import { memo } from 'react';
import type { ChatMessage as Msg } from '@/shared/protocol';
import { PLATFORM_META, HOST_META } from '@/shared/meta';
import { PlatformIcon } from './PlatformIcon';
import { HostGlyph } from './HostGlyph';

// Single chat row. The signature "badge chip" source label (the prototype's
// default labelStyle) is baked in: glass pill + platform icon + host dot.
function ChatMessageImpl({ msg }: { msg: Msg }) {
  const meta = PLATFORM_META[msg.platform];
  const host = HOST_META[msg.host];
  return (
    <div className={'msg src-' + msg.platform + ' msg-row-badge'}>
      <span
        className={'msg-badge badge-' + msg.platform}
        title={meta.name + ' — ' + host.name + "'s channel"}
      >
        <PlatformIcon platform={msg.platform} size={13} fill={meta.accent} />
        <span className="host-dot" style={{ color: host.color, borderColor: host.color }}>
          <HostGlyph host={msg.host} />
        </span>
      </span>
      <span className="msg-user" style={{ color: meta.color }}>
        {msg.user}
      </span>
      <span className="msg-text">{msg.text}</span>
    </div>
  );
}

export const ChatMessage = memo(ChatMessageImpl);
