// Real platform sources: Twitch IRC + Kick Pusher chat readers and the viewer
// pollers, all wired into the hub. X is handled separately (P4) and stays
// `unavailable` here until enabled. Missing keys degrade gracefully.
import type { Hub } from './hub';
import type { AppConfig } from './config';
import type { Host } from '../shared/protocol';
import { createTwitchIrcAdapter } from './adapters/twitch-irc';
import { createKickPusherAdapter } from './adapters/kick-pusher';
import { startTwitchViewerPoller } from './pollers/twitch-viewers';
import { startKickViewerPoller } from './pollers/kick-viewers';
import { startXSource } from './adapters/x-broadcast';
import { scoped } from './lib/log';

const log = scoped('sources');

export function startRealSources(hub: Hub, config: AppConfig): () => Promise<void> {
  const stops: Array<() => void | Promise<void>> = [];

  // ── Twitch chat: anonymous IRC, no credentials required ──
  const twitchChannels: Record<string, Host> = {
    [config.twitchChannels.banks.toLowerCase()]: 'banks',
    [config.twitchChannels.ansem.toLowerCase()]: 'ansem',
  };
  const twitch = createTwitchIrcAdapter(twitchChannels, {
    onMessage: (m) => hub.ingestMessage(m),
    onStatus: (s) => hub.setStatus('twitch', s),
    onRemove: (sel) => hub.removeMessages('twitch', sel),
  });
  twitch.start();
  stops.push(() => twitch.stop());

  // ── Kick chat: unofficial Pusher feed ──
  const kick = createKickPusherAdapter(config, {
    onMessage: (m) => hub.ingestMessage(m),
    onStatus: (s) => hub.setStatus('kick', s),
    onRemove: (sel) => hub.removeMessages('kick', sel),
  });
  kick.start();
  stops.push(() => kick.stop());

  // ── X chat: experimental, owner-only, default off (fails soft to unavailable) ──
  const x = startXSource(hub, config);
  stops.push(x);

  // ── Viewer pollers (own only the viewer matrix, not source status) ──
  stops.push(startTwitchViewerPoller(hub, config));
  stops.push(startKickViewerPoller(hub, config));

  log('real sources started');
  return async () => {
    for (const s of stops) await s();
  };
}
