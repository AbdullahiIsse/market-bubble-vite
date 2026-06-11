import type { Platform } from '@/shared/protocol';
import { PLATFORM_META } from '@/shared/meta';

// Inline platform glyphs, ported verbatim from the design handoff.
export function PlatformIcon({
  platform,
  size = 14,
  fill,
}: {
  platform: Platform;
  size?: number;
  fill?: string;
}) {
  const c = fill || PLATFORM_META[platform].color;
  if (platform === 'twitch') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={c} aria-label="Twitch">
        <path d="M6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0H6zm14.572 11.143-3.429 3.428h-3.429l-3 3v-3H6.857V1.714h13.715v9.429zM16.286 4.714H18v5.143h-1.714V4.714zm-4.715 0h1.715v5.143h-1.715V4.714z" />
      </svg>
    );
  }
  if (platform === 'kick') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={c} aria-label="Kick">
        <path d="M3 2h6v6h2V6h2V4h2V2h6v7h-2v2h-2v2h2v2h2v7h-6v-2h-2v-2h-2v-2h-2v6H3V2z" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={c} aria-label="X">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z" />
    </svg>
  );
}
