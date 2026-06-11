// Brand constants and viewer-math helpers shared by client and server.
// Ported from the design handoff (mb-components.jsx / chat-sim.js).

import type {
  Platform,
  Host,
  ViewerMatrix,
  HostCounts,
} from './protocol';

export const PLATFORMS: Platform[] = ['twitch', 'kick', 'x'];
export const HOSTS: Host[] = ['banks', 'ansem'];

export const PLATFORM_META: Record<
  Platform,
  { name: string; color: string; accent: string }
> = {
  twitch: { name: 'Twitch', color: '#a970ff', accent: '#a970ff' },
  kick: { name: 'Kick', color: '#52ff8f', accent: '#52ff8f' },
  x: { name: 'X', color: '#d8d5cc', accent: '#ffffff' },
};

export const HOST_META: Record<
  Host,
  { name: string; initial: string; color: string }
> = {
  banks: { name: 'Banks', initial: 'B', color: '#e8ff9c' },
  ansem: { name: 'Ansem', initial: 'Z', color: '#8ab4ff' },
};

// The show airs Thursday 1PM in this timezone. Used for the offline countdown.
export const SHOW_TZ = 'America/Los_Angeles';
export const SHOW_WEEKDAY = 4; // Thursday (0=Sun)
export const SHOW_HOUR = 13; // 1PM

// Sum of a platform's two host cells, treating null (unknown) as 0.
export function platformTotal(v: ViewerMatrix, p: Platform): number {
  return cell(v[p].banks) + cell(v[p].ansem);
}

// Combined total across all six channels, treating null as 0.
export function totalViewers(v: ViewerMatrix): number {
  let t = 0;
  for (const p of PLATFORMS) t += platformTotal(v, p);
  return t;
}

export function cell(n: number | null): number {
  return typeof n === 'number' ? n : 0;
}

export function emptyHostCounts(): HostCounts {
  return { banks: null, ansem: null };
}

export function emptyViewerMatrix(): ViewerMatrix {
  return {
    twitch: emptyHostCounts(),
    kick: emptyHostCounts(),
    x: emptyHostCounts(),
  };
}
