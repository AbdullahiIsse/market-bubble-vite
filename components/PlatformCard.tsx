import { memo } from 'react';
import type { Platform, HostCounts } from '@/shared/protocol';
import { PLATFORM_META, HOST_META, HOSTS, cell } from '@/shared/meta';
import { num, countOrDash } from './format';
import { PlatformIcon } from './PlatformIcon';
import { Sparkline } from './Sparkline';
import { HostGlyph } from './HostGlyph';

// Dashboard stat card: platform total + Banks/Ansem split + sparkline.
// memo: counts/history identities only change on viewer events.
export const PlatformCard = memo(function PlatformCard({
  platform,
  counts,
  history,
  share,
}: {
  platform: Platform;
  counts: HostCounts;
  history: number[];
  share: number;
}) {
  const meta = PLATFORM_META[platform];
  const known = counts.banks != null || counts.ansem != null;
  const total = cell(counts.banks) + cell(counts.ansem);

  return (
    <div className="stat-card">
      <div className="stat-card-head">
        <PlatformIcon platform={platform} size={15} />
        <span className="stat-card-name">{meta.name}</span>
        <span className="stat-card-share">{known ? share + '%' : '—'}</span>
      </div>
      <div className="stat-card-count">{known ? num(total) : '—'}</div>
      <div className="stat-hosts">
        {HOSTS.map((h) => (
          <span className="stat-host" key={h}>
            <span
              className="vt-host"
              style={{ color: HOST_META[h].color, borderColor: HOST_META[h].color }}
            >
              <HostGlyph host={h} />
            </span>
            <span className="stat-host-count">{countOrDash(counts[h])}</span>
          </span>
        ))}
      </div>
      <Sparkline data={history} color={meta.color} width={150} height={24} />
    </div>
  );
});
