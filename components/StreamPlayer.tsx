import { Fragment, memo, useEffect, useState } from 'react';
import type { Host } from '@/shared/protocol';
import { HOST_META } from '@/shared/meta';
import { useCountdown } from '@/hooks/useCountdown';
import { HostGlyph } from './HostGlyph';

const HERO_IMG =
  'https://framerusercontent.com/images/ddD68QwxkKIzKFvThRqR9GgDCbw.png?scale-down-to=2048';

// Main stream with the host-swap tag. Shows the offline hero + live countdown
// when no configured channel is live (the `live` flag comes from the hub's
// real viewer polling, not the schedule).
// memo: the embed subtree must not re-render on every chat flush.
export const StreamPlayer = memo(function StreamPlayer({
  channels,
  mainHost,
  live,
  onSwap,
}: {
  channels: Record<Host, string>;
  mainHost: Host;
  live: boolean;
  onSwap: () => void;
}) {
  const otherHost: Host = mainHost === 'banks' ? 'ansem' : 'banks';
  const countdown = useCountdown();

  // Twitch's embed needs the exact serving hostname as `parent`. Resolve it
  // after mount so server and client render the same initial HTML.
  const [parent, setParent] = useState<string | null>(null);
  useEffect(() => {
    // hydration-safe: render no iframe on the server, attach it post-mount once
    // the real hostname (Twitch's required `parent`) is known.
    setParent(window.location.hostname || 'localhost');
  }, []);

  if (!live) {
    const units: Array<[string, string]> = countdown
      ? [
          [countdown.hours, 'hrs'],
          [countdown.minutes, 'min'],
          [countdown.seconds, 'sec'],
        ]
      : [];
    if (countdown && countdown.days > 0)
      units.unshift([String(countdown.days), countdown.days === 1 ? 'day' : 'days']);
    return (
      <div className="player player-offline">
        <img className="ph-bg" src={HERO_IMG} alt="Market Bubble set" />
        <div className="offline-scrim" />
        <div className="offline-content">
          <div className="offline-label">We&rsquo;re offline</div>
          <div className="offline-count">
            {units.map(([num, label], i) => (
              <Fragment key={label}>
                {i > 0 && (
                  <span className="oc-sep" aria-hidden="true">
                    :
                  </span>
                )}
                <span className="oc-unit">
                  <span className="oc-num">{num}</span>
                  <span className="oc-lab">{label}</span>
                </span>
              </Fragment>
            ))}
          </div>
          <div className="ph-schedule">
            Back<span className="dot-sep">&bull;</span>Thursday<span className="dot-sep">&bull;</span>1PM
            PST
          </div>
        </div>
      </div>
    );
  }

  const embed =
    parent &&
    'https://player.twitch.tv/?channel=' +
      encodeURIComponent(channels[mainHost]) +
      '&parent=' +
      encodeURIComponent(parent) +
      '&muted=true&autoplay=true';

  return (
    <div className="player">
      {embed && (
        <iframe
          src={embed}
          // without an explicit autoplay permission the swapped-in channel
          // loads paused (cross-origin iframes can't autoplay by default)
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          scrolling="no"
          title={HOST_META[mainHost].name + ' stream'}
        />
      )}
      <div className="player-tag">
        <span
          className="vt-host"
          style={{ color: HOST_META[mainHost].color, borderColor: HOST_META[mainHost].color }}
        >
          <HostGlyph host={mainHost} />
        </span>
        <span className="player-tag-text">{HOST_META[mainHost].name}&rsquo;s stream</span>
        <button
          className="tag-swap"
          onClick={onSwap}
          title={'Switch to ' + HOST_META[otherHost].name + '’s stream'}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 7h10v3l5-4-5-4v3H5v6h2V7zm10 10H7v-3l-5 4 5 4v-3h12v-6h-2v4z" />
          </svg>
          <span
            className="vt-host"
            style={{ color: HOST_META[otherHost].color, borderColor: HOST_META[otherHost].color }}
          >
            <HostGlyph host={otherHost} />
          </span>
          <span className="tag-swap-name">{HOST_META[otherHost].name}</span>
        </button>
      </div>
    </div>
  );
});
