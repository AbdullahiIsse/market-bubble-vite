// Decides which sources feed the hub: the dev simulator, or the real platform
// adapters + viewer pollers. Returns a stop function.
import type { Hub } from './hub';
import type { AppConfig } from './config';
import { startSim } from './adapters/sim';
import { startRealSources } from './sources-real';

export function startSources(hub: Hub, config: AppConfig): () => void | Promise<void> {
  if (config.sim.mode) return startSim(hub, config);
  return startRealSources(hub, config);
}
