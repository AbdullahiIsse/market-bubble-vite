import { memo, useEffect, useRef, useState } from 'react';
import type { Host, StatusMap } from '@/shared/protocol';

interface StreamsState {
  twitchChannels: Record<Host, string>;
  kickSlugs: Record<Host, string>;
  kickChatroomIds: Record<Host, string>;
  xBroadcastIds: Record<Host, string>;
  xEnabled: boolean;
  xCookiesSet: boolean;
}

type HostMapKey = 'twitchChannels' | 'kickSlugs' | 'kickChatroomIds' | 'xBroadcastIds';

interface StreamPatch {
  twitchChannels?: Partial<Record<Host, string>>;
  kickSlugs?: Partial<Record<Host, string>>;
  kickChatroomIds?: Partial<Record<Host, string>>;
  xBroadcastIds?: Partial<Record<Host, string>>;
  xEnabled?: boolean;
  xAuthToken?: string;
  xCt0?: string;
}

const HOSTS: Host[] = ['banks', 'ansem'];
const HOST_LABEL: Record<Host, string> = { banks: 'Banks', ansem: 'Ansem' };

function dot(status: string) {
  return <span className={'set-status-dot set-' + status} title={status} />;
}

function SettingsViewImpl({
  status,
  onLogout,
  onUnauthorized,
}: {
  status: StatusMap;
  onLogout: () => void;
  onUnauthorized: () => void;
}) {
  const [form, setForm] = useState<StreamsState | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [authToken, setAuthToken] = useState('');
  const [ct0, setCt0] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState<StreamsState | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/streams')
      .then((r) => {
        if (r.status === 401) {
          if (alive) onUnauthorized();
          return null;
        }
        return r.json();
      })
      .then((data: StreamsState | null) => {
        if (alive && data) {
          setForm(data);
          setLoaded(data);
        }
      })
      .catch(() => {
        if (alive) setFetchError(true);
      });
    return () => {
      alive = false;
    };
  }, [onUnauthorized]);

  async function save() {
    if (!form || !loaded || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaved(false);
    setError('');
    const patch: StreamPatch = {};
    const hostKeys: HostMapKey[] = ['twitchChannels', 'kickSlugs', 'kickChatroomIds', 'xBroadcastIds'];
    for (const key of hostKeys) {
      const cur = form[key];
      const was = loaded[key];
      const diff: Partial<Record<Host, string>> = {};
      for (const host of HOSTS) if (cur[host] !== was[host]) diff[host] = cur[host];
      if (Object.keys(diff).length) patch[key] = diff;
    }
    if (form.xEnabled !== loaded.xEnabled) patch.xEnabled = form.xEnabled;
    if (authToken) patch.xAuthToken = authToken; // omit when empty => keep existing
    if (ct0) patch.xCt0 = ct0;

    try {
      const res = await fetch('/api/streams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'save failed');
      } else {
        setForm(data);
        setLoaded(data);
        setAuthToken('');
        setCt0('');
        setSaved(true);
      }
    } catch {
      setError('network error');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function reconnectAll() {
    await fetch('/api/streams/reconnect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'all' }),
    }).catch(() => {});
  }

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
      <div className="settings-head">
        <h1 className="settings-title">Stream settings</h1>
        <button type="button" className="settings-logout" onClick={onLogout}>
          Log out
        </button>
      </div>
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

        <div className="settings-actions">
          <button type="button" className="settings-save" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save & reconnect'}
          </button>
          <button type="button" className="settings-reconnect" onClick={reconnectAll}>
            Reconnect all
          </button>
          {saved && <span className="settings-saved">Saved ✓</span>}
          {error && <span className="settings-error">{error}</span>}
        </div>
      </form>
    </div>
  );
}

export const SettingsView = memo(SettingsViewImpl);
