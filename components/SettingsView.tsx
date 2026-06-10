import { memo, useEffect, useState } from 'react';
import type { Host, StatusMap } from '@/shared/protocol';

interface StreamsState {
  twitchChannels: Record<Host, string>;
  kickSlugs: Record<Host, string>;
  kickChatroomIds: Record<Host, string>;
  xBroadcastIds: Record<Host, string>;
  xEnabled: boolean;
  xCookiesSet: boolean;
}

const HOSTS: Host[] = ['banks', 'ansem'];
const HOST_LABEL: Record<Host, string> = { banks: 'Banks', ansem: 'Ansem' };

function dot(status: string) {
  return <span className={'set-status-dot set-' + status} title={status} />;
}

function SettingsViewImpl({ status }: { status: StatusMap }) {
  const [form, setForm] = useState<StreamsState | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [authToken, setAuthToken] = useState('');
  const [ct0, setCt0] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/streams')
      .then((r) => r.json())
      .then((data: StreamsState) => {
        if (alive) setForm(data);
      })
      .catch(() => {
        if (alive) setFetchError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!form) {
    return (
      <div className="settings-view">
        <h1 className="settings-title">Stream settings</h1>
        <p className="settings-sub">{fetchError ? 'Failed to load — refresh to retry.' : 'Loading…'}</p>
      </div>
    );
  }

  const setHost = (key: keyof StreamsState, host: Host, value: string) =>
    setForm((f) => (f ? { ...f, [key]: { ...(f[key] as Record<Host, string>), [host]: value } } : f));

  return (
    <div className="settings-view">
      <h1 className="settings-title">Stream settings</h1>
      <p className="settings-sub">Edit a target and save — only that platform reconnects. No restart.</p>

      <form className="settings-form" onSubmit={(e) => e.preventDefault()}>
        {HOSTS.map((host) => (
          <fieldset className="settings-group" key={host}>
            <legend>{HOST_LABEL[host]} slot</legend>

            <label htmlFor={`twitch-${host}`}>Twitch channel {dot(status.twitch)}</label>
            <input
              id={`twitch-${host}`}
              value={form.twitchChannels[host]}
              onChange={(e) => setHost('twitchChannels', host, e.target.value)}
            />

            <label htmlFor={`kick-${host}`}>Kick slug {dot(status.kick)}</label>
            <input
              id={`kick-${host}`}
              value={form.kickSlugs[host]}
              onChange={(e) => setHost('kickSlugs', host, e.target.value)}
            />

            <label htmlFor={`kickroom-${host}`}>Kick chatroom id</label>
            <input
              id={`kickroom-${host}`}
              value={form.kickChatroomIds[host]}
              onChange={(e) => setHost('kickChatroomIds', host, e.target.value)}
              placeholder="Kick blocks auto-lookup here — paste the id"
            />

            <label htmlFor={`x-${host}`}>X broadcast URL {dot(status.x)}</label>
            <input
              id={`x-${host}`}
              value={form.xBroadcastIds[host]}
              onChange={(e) => setHost('xBroadcastIds', host, e.target.value)}
              placeholder="x.com/i/broadcasts/… or bare id"
            />
          </fieldset>
        ))}

        <fieldset className="settings-group">
          <legend>X account (shared)</legend>

          <label className="settings-check">
            <input
              type="checkbox"
              checked={form.xEnabled}
              onChange={(e) => setForm((f) => (f ? { ...f, xEnabled: e.target.checked } : f))}
            />
            X enabled
          </label>

          <label htmlFor="x-auth-token">auth_token</label>
          <input
            id="x-auth-token"
            type="password"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            placeholder={form.xCookiesSet ? 'saved — type to replace' : 'paste auth_token cookie'}
          />

          <label htmlFor="x-ct0">ct0</label>
          <input
            id="x-ct0"
            type="password"
            value={ct0}
            onChange={(e) => setCt0(e.target.value)}
            placeholder={form.xCookiesSet ? 'saved — type to replace' : 'paste ct0 cookie'}
          />
        </fieldset>
      </form>
    </div>
  );
}

export const SettingsView = memo(SettingsViewImpl);
