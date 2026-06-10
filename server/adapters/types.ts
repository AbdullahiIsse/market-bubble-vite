// Contract every chat source implements. One adapter per platform handles both
// host channels. Adapters never throw out of start(); they own their reconnect loop
// and report health via onStatus.
import type { ChatMessage, Platform, SourceStatus } from '../../shared/protocol';

export interface AdapterCallbacks {
  onMessage(msg: ChatMessage): void;
  onStatus(status: SourceStatus): void;
  onRemove?(sel: { ids?: string[]; user?: string }): void;
}

export interface SourceAdapter {
  readonly platform: Platform;
  start(): void;
  stop(): Promise<void> | void;
}
