// Minimal sparkline, ported from the handoff. Decorative trend line.
// memo: history arrays only change on viewer events, not chat flushes.
import { memo } from 'react';

export const Sparkline = memo(function Sparkline({
  data,
  color,
  width = 120,
  height = 28,
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (!data || data.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * (width - 2) + 1;
      const y = height - 3 - ((v - min) / span) * (height - 6);
      return x.toFixed(1) + ',' + y.toFixed(1);
    })
    .join(' ');
  return (
    <svg width={width} height={height} className="sparkline">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.9"
      />
    </svg>
  );
});
