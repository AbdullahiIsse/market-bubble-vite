import { memo } from 'react';
import type { ViewerMatrix, Platform, Host } from '@/shared/protocol';
import { PLATFORMS, HOSTS, PLATFORM_META, HOST_META, totalViewers, cell } from '@/shared/meta';
import { num, countOrDash } from './format';
import { PlatformIcon } from './PlatformIcon';
import { HostGlyph } from './HostGlyph';

// Combined viewer count with the 6-channel breakdown tooltip.
// `up` opens the tooltip upward (used under the player in the stage bar).
// memo: `viewers` identity only changes on viewer events, not chat flushes.
export const ViewerPill = memo(function ViewerPill({ viewers, up }: { viewers: ViewerMatrix; up?: boolean }) {
  const total = totalViewers(viewers);
  const channels: [Platform, Host][] = [];
  for (const p of PLATFORMS) for (const h of HOSTS) channels.push([p, h]);
  const max = Math.max(1, ...channels.map(([p, h]) => cell(viewers[p][h])));

  return (
    <div className={'viewer-pill-wrap' + (up ? ' up' : '')}>
      <div className="viewer-pill" tabIndex={0}>
        <span className="live-dot" />
        <span className="viewer-total">{num(total)}</span>
        <span className="viewer-label">watching</span>
      </div>
      <div className="viewer-tooltip" role="tooltip">
        <div className="vt-title">Viewers by channel</div>
        {channels.map(([p, h]) => {
          const raw = viewers[p][h];
          const v = cell(raw);
          const share = total ? Math.round((v / total) * 100) : 0;
          return (
            <div className="vt-row" key={p + h}>
              <PlatformIcon platform={p} size={13} />
              <span
                className="vt-host"
                style={{ color: HOST_META[h].color, borderColor: HOST_META[h].color }}
              >
                <HostGlyph host={h} />
              </span>
              <span className="vt-name">{HOST_META[h].name}</span>
              <span className="vt-bar">
                <span
                  className="vt-bar-fill"
                  style={{ width: (max ? (v / max) * 100 : 0) + '%', background: PLATFORM_META[p].color }}
                />
              </span>
              <span className="vt-count">{countOrDash(raw)}</span>
              <span className="vt-share">{share}%</span>
            </div>
          );
        })}
        <div className="vt-foot">
          <span>Combined</span>
          <span>{num(total)}</span>
        </div>
      </div>
    </div>
  );
});
