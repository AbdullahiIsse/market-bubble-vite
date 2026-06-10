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

function ModeTabs({
  mode,
  onChange,
  showSettings,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  showSettings: boolean;
}) {
  const tabs: [Mode, string][] = [
    ['watch', 'Watch'],
    ['dashboard', 'Dashboard'],
    ...(showSettings ? ([['settings', 'Settings']] as [Mode, string][]) : []),
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
// on the mode + whether the admin Settings tab should show.
export const TopBar = memo(function TopBar({
  mode,
  onChange,
  showSettings,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  showSettings: boolean;
}) {
  return (
    <header className="topbar">
      <Logo />
      <ModeTabs mode={mode} onChange={onChange} showSettings={showSettings} />
      <div className="topbar-schedule">
        Live<span className="dot-sep">&bull;</span>Thursdays<span className="dot-sep">&bull;</span>1PM PST
      </div>
    </header>
  );
});
