import type { StatusMap } from '@/shared/protocol';

// Shell first (Task 6); the form + data loading land in Tasks 7-8.
export function SettingsView({ status }: { status: StatusMap }) {
  return (
    <div className="settings-view">
      <h1 className="settings-title">Stream settings</h1>
      <p className="settings-sub">
        Twitch {status.twitch} · Kick {status.kick} · X {status.x}
      </p>
    </div>
  );
}
