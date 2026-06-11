// Which platform the watch player should embed for a host, derived from the
// viewer matrix (null = unknown, 0 = known offline, >0 = live).
// Priority: Twitch, then Kick. X is never embedded. While the currently shown
// platform's cell is unknown (failed poll) the choice sticks, so a blip never
// reloads the iframe; otherwise fall back to Twitch — its embed shows the
// channel's own offline page and recovers the instant the host goes live.
import type { Host, Platform, ViewerMatrix } from './protocol';

export type PlayerPlatform = Extract<Platform, 'twitch' | 'kick'>;

export function pickPlayerPlatform(
  viewers: ViewerMatrix,
  host: Host,
  current: PlayerPlatform,
): PlayerPlatform {
  if (live(viewers.twitch[host])) return 'twitch';
  if (live(viewers.kick[host])) return 'kick';
  if (viewers[current][host] === null) return current;
  return 'twitch';
}

function live(cell: number | null): boolean {
  return typeof cell === 'number' && cell > 0;
}
