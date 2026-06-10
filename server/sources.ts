// Decides which sources feed the hub: the dev simulator (no manager — sim has no
// per-source reconnect), or the real adapters behind a SourceManager.
import type { Hub } from './hub';
import type { RuntimeConfig } from './runtime-config';
import type { SourceManager } from './source-manager';
import { startSim } from './adapters/sim';
import { startRealSources } from './sources-real';

export interface StartedSources {
  stop: () => void | Promise<void>;
  manager: SourceManager | null;
}

export function startSources(hub: Hub, runtime: RuntimeConfig): StartedSources {
  const config = runtime.getConfig();
  if (config.sim.mode) {
    const stop = startSim(hub, config);
    return { stop, manager: null };
  }
  const manager = startRealSources(hub, runtime);
  return { stop: () => manager.stopAll(), manager };
}
