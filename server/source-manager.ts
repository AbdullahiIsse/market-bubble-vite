// Owns each platform's source (chat adapter + viewer poller). Lets the API
// restart ONE platform with fresh config without restarting the process.
import type { AppConfig } from './config';
import type { Hub } from './hub';
import type { Platform } from '../shared/protocol';
import type { RuntimeConfig } from './runtime-config';
import { scoped } from './lib/log';

const log = scoped('source-manager');
const PLATFORMS: Platform[] = ['twitch', 'kick', 'x'];

// A starter boots one platform and returns its stop function.
export type SourceStarter = (hub: Hub, config: AppConfig) => () => void | Promise<void>;

export interface SourceManager {
  startAll(): void;
  restart(platform: Platform): Promise<void>;
  stopAll(): Promise<void>;
}

export function createSourceManager(
  hub: Hub,
  runtime: RuntimeConfig,
  starters: Record<Platform, SourceStarter>,
): SourceManager {
  const stops: Partial<Record<Platform, () => void | Promise<void>>> = {};

  // start/stop must never throw into the API request that triggered a restart:
  // a failed platform degrades to "not running" (next restart retries it).
  function startOne(p: Platform) {
    if (stops[p]) return; // already running — don't overwrite/leak the existing stop handle
    try {
      stops[p] = starters[p](hub, runtime.getConfig());
    } catch (err) {
      log.error(`start ${p} failed`, (err as Error).message);
    }
  }
  async function stopOne(p: Platform) {
    const stop = stops[p];
    if (!stop) return;
    delete stops[p];
    try {
      await stop();
    } catch (err) {
      log.warn(`stop ${p} failed`, (err as Error).message);
    }
  }

  return {
    startAll() {
      for (const p of PLATFORMS) startOne(p);
    },
    async restart(p) {
      await stopOne(p);
      startOne(p);
    },
    async stopAll() {
      await Promise.all(PLATFORMS.map((p) => stopOne(p)));
    },
  };
}
