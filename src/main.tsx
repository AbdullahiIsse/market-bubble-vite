// Fonts: self-hosted via @fontsource (replaces next/font/google). Walburn (the
// display font) remains an @font-face hotlink inside globals.css, as before.
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/host-grotesk/400.css';
import '@fontsource/host-grotesk/500.css';
import '@fontsource/host-grotesk/600.css';
import '@fontsource/host-grotesk/700.css';
import './fonts.css';
import './globals.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Host, HostAvatars } from '@/shared/protocol';
import { MarketBubbleApp } from '@/components/MarketBubbleApp';
import { setHostAvatars } from '@/components/HostGlyph';

const DEFAULT_CHANNELS: Record<Host, string> = { banks: 'fazebanks', ansem: 'ansem' };

interface BootConfig {
  twitchChannels: Record<Host, string>;
  hostAvatars: HostAvatars;
}

// The channels must be known BEFORE the app's first render: if the player
// mounted with defaults and the real channels arrived later, the Twitch embed
// could stay on the wrong channel (the race the old SSR delivery prevented).
// Host avatars ride along; missing ones fall back to the letter badges.
async function fetchBootConfig(): Promise<BootConfig> {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return { twitchChannels: DEFAULT_CHANNELS, hostAvatars: {} };
    const data = (await res.json()) as {
      twitchChannels?: Partial<Record<Host, string>>;
      hostAvatars?: HostAvatars;
    };
    return {
      twitchChannels: {
        banks: data.twitchChannels?.banks || DEFAULT_CHANNELS.banks,
        ansem: data.twitchChannels?.ansem || DEFAULT_CHANNELS.ansem,
      },
      hostAvatars: data.hostAvatars ?? {},
    };
  } catch {
    return { twitchChannels: DEFAULT_CHANNELS, hostAvatars: {} };
  }
}

const root = createRoot(document.getElementById('root')!);
root.render(<div className="app" />); // parity with the old <Suspense fallback>

fetchBootConfig().then(({ twitchChannels, hostAvatars }) => {
  setHostAvatars(hostAvatars); // before render: components read it during render
  root.render(
    <StrictMode>
      <MarketBubbleApp twitchChannels={twitchChannels} />
    </StrictMode>,
  );
});
