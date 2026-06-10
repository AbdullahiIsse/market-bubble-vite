// Real platform sources behind a SourceManager so each platform can be
// reconnected independently when the owner edits its target in Settings.
import type { Hub } from './hub';
import type { Host } from '../shared/protocol';
import type { RuntimeConfig } from './runtime-config';
import { createSourceManager, type SourceManager, type SourceStarter } from './source-manager';
import { createTwitchIrcAdapter } from './adapters/twitch-irc';
import { createKickPusherAdapter } from './adapters/kick-pusher';
import { startTwitchViewerPoller } from './pollers/twitch-viewers';
import { startKickViewerPoller } from './pollers/kick-viewers';
import { startXSource } from './adapters/x-broadcast';
import { scoped } from './lib/log';

const log = scoped('sources');

const twitchStarter: SourceStarter = (hub, config) => {
  const channels: Record<string, Host> = {
    [config.twitchChannels.banks.toLowerCase()]: 'banks',
    [config.twitchChannels.ansem.toLowerCase()]: 'ansem',
  };
  const adapter = createTwitchIrcAdapter(channels, {
    onMessage: (m) => hub.ingestMessage(m),
    onStatus: (s) => hub.setStatus('twitch', s),
    onRemove: (sel) => hub.removeMessages('twitch', sel),
  });
  adapter.start();
  const stopPoller = startTwitchViewerPoller(hub, config);
  return () => {
    adapter.stop();
    stopPoller();
  };
};

const kickStarter: SourceStarter = (hub, config) => {
  const adapter = createKickPusherAdapter(config, {
    onMessage: (m) => hub.ingestMessage(m),
    onStatus: (s) => hub.setStatus('kick', s),
    onRemove: (sel) => hub.removeMessages('kick', sel),
  });
  adapter.start();
  const stopPoller = startKickViewerPoller(hub, config);
  return () => {
    adapter.stop();
    stopPoller();
  };
};

// startXSource already owns BOTH X chat and X viewer polling.
const xStarter: SourceStarter = (hub, config) => startXSource(hub, config);

export function startRealSources(hub: Hub, runtime: RuntimeConfig): SourceManager {
  const manager = createSourceManager(hub, runtime, {
    twitch: twitchStarter,
    kick: kickStarter,
    x: xStarter,
  });
  manager.startAll();
  log('real sources started');
  return manager;
}
