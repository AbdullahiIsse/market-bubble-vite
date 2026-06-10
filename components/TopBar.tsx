import { memo } from 'react';

export type Mode = 'watch' | 'dashboard' | 'settings';

function Logo() {
  return (
    <div className="mb-logo">
      <div className="mb-logo-word">Market&nbsp;Bubble</div>
      <div className="mb-logo-sub">Presented by Polymarket</div>
    </div>
  );
}

function ModeTabs({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const tabs: [Mode, string][] = [
    ['watch', 'Watch'],
    ['dashboard', 'Dashboard'],
    ['settings', 'Settings'],
  ];
  return (
    <nav className="mode-tabs" aria-label="View mode">
      {tabs.map(([k, label]) => (
        <button
          key={k}
          className={'mode-tab' + (mode === k ? ' is-active' : '')}
          onClick={() => onChange(k)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

// memo: chat flushes re-render the app shell ~10x/s; the top bar only depends
// on the mode.
export const TopBar = memo(function TopBar({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <header className="topbar">
      <Logo />
      <ModeTabs mode={mode} onChange={onChange} />
      <div className="topbar-schedule">
        Live<span className="dot-sep">&bull;</span>Thursdays<span className="dot-sep">&bull;</span>1PM PST
      </div>
    </header>
  );
});
