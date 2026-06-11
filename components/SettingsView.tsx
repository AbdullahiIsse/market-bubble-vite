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

type Notice = { kind: 'ok' | 'warn' | 'err'; text: string } | null;

// API responses carry extra keys (status, reconnected, persisted) — keep only
// the editable state in the form so save diffs stay clean.
function pickState(data: StreamsState): StreamsState {
  return {
    twitchChannels: data.twitchChannels,
    kickSlugs: data.kickSlugs,
    kickChatroomIds: data.kickChatroomIds,
    xBroadcastIds: data.xBroadcastIds,
    xEnabled: data.xEnabled,
    xCookiesSet: data.xCookiesSet,
  };
}

function dot(status: string) {
  return <span className={'set-status-dot set-' + status} title={status} />;
}

// Owners paste either the bare kick name or a kick.com/<name> URL.
function kickSlugFrom(raw: string): string {
  const m = raw.trim().match(/kick\.com\/([A-Za-z0-9_-]+)/i);
  return (m ? m[1] : raw.trim()).replace(/\//g, '');
}

// Browser-side chatroom-id lookup. kick.com reflects the Origin header (CORS ok),
// and the owner's residential IP gets past the bot wall that usually blocks the
// server's datacenter IP — so the browser is the reliable place to resolve this.
async function lookupKickChatroomId(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { chatroom?: { id?: number } };
    return data.chatroom?.id ? String(data.chatroom.id) : null;
  } catch {
    return null;
  }
}

type KickLookup = { state: 'loading' | 'ok' | 'err'; text: string };

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
  const [reconnecting, setReconnecting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [loaded, setLoaded] = useState<StreamsState | null>(null);
  const [kickLookup, setKickLookup] = useState<Partial<Record<Host, KickLookup>>>({});
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
          const state = pickState(data);
          setForm(state);
          setLoaded(state);
        }
      })
      .catch(() => {
        if (alive) setFetchError(true);
      });
    return () => {
      alive = false;
    };
  }, [onUnauthorized]);

  async function resolveKickId(host: Host): Promise<string | null> {
    if (!form) return null;
    const slug = kickSlugFrom(form.kickSlugs[host]);
    if (!slug) {
      setKickLookup((s) => ({ ...s, [host]: { state: 'err', text: 'enter the kick name first' } }));
      return null;
    }
    setKickLookup((s) => ({ ...s, [host]: { state: 'loading', text: 'looking up…' } }));
    const id = await lookupKickChatroomId(slug);
    if (id) {
      setForm((f) =>
        f
          ? {
              ...f,
              kickSlugs: { ...f.kickSlugs, [host]: slug },
              kickChatroomIds: { ...f.kickChatroomIds, [host]: id },
            }
          : f,
      );
      setKickLookup((s) => ({ ...s, [host]: { state: 'ok', text: `chatroom ${id} ✓` } }));
    } else {
      setKickLookup((s) => ({
        ...s,
        [host]: { state: 'err', text: `lookup failed — open kick.com/api/v2/channels/${slug} and paste chatroom.id` },
      }));
    }
    return id;
  }

  async function save() {
    if (!form || !loaded || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setNotice(null);

    // Auto-fill kick chatroom ids in the browser when the kick name changed and
    // the id wasn't hand-edited — typing just the name is enough to save.
    const work: StreamsState = {
      ...form,
      kickSlugs: { ...form.kickSlugs },
      kickChatroomIds: { ...form.kickChatroomIds },
    };
    for (const host of HOSTS) {
      const slug = kickSlugFrom(work.kickSlugs[host]);
      work.kickSlugs[host] = slug;
      const slugChanged = slug !== loaded.kickSlugs[host];
      const idEdited = work.kickChatroomIds[host].trim() !== loaded.kickChatroomIds[host].trim();
      if (slug && slugChanged && !idEdited) {
        setKickLookup((s) => ({ ...s, [host]: { state: 'loading', text: 'looking up…' } }));
        const id = await lookupKickChatroomId(slug);
        // a stale id must not follow the new slug — empty lets the server re-resolve
        work.kickChatroomIds[host] = id ?? '';
        setKickLookup((s) => ({
          ...s,
          [host]: id
            ? { state: 'ok', text: `chatroom ${id} ✓` }
            : { state: 'err', text: 'auto-lookup failed — chat may need the id pasted' },
        }));
      }
    }
    setForm(work);

    const patch: StreamPatch = {};
    const hostKeys: HostMapKey[] = ['twitchChannels', 'kickSlugs', 'kickChatroomIds', 'xBroadcastIds'];
    for (const key of hostKeys) {
      const cur = work[key];
      const was = loaded[key];
      const diff: Partial<Record<Host, string>> = {};
      for (const host of HOSTS) if (cur[host] !== was[host]) diff[host] = cur[host];
      if (Object.keys(diff).length) patch[key] = diff;
    }
    if (work.xEnabled !== loaded.xEnabled) patch.xEnabled = work.xEnabled;
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
      const data = (await res.json()) as StreamsState & {
        error?: string;
        reconnected?: string[];
        persisted?: boolean;
      };
      if (!res.ok) {
        setNotice({ kind: 'err', text: data.error || 'save failed' });
      } else {
        const state = pickState(data);
        setForm(state);
        setLoaded(state);
        setAuthToken('');
        setCt0('');
        if (data.persisted === false) {
          setNotice({
            kind: 'warn',
            text: 'Saved & reconnected — but writing to disk failed, settings reset on restart',
          });
        } else {
          setNotice({
            kind: 'ok',
            text: data.reconnected?.length ? `Saved — reconnected ${data.reconnected.join(', ')} ✓` : 'Saved ✓',
          });
        }
      }
    } catch {
      setNotice({ kind: 'err', text: 'network error' });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function reconnectAll() {
    if (reconnecting) return;
    setReconnecting(true);
    setNotice(null);
    try {
      const res = await fetch('/api/streams/reconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform: 'all' }),
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      setNotice(res.ok ? { kind: 'ok', text: 'Reconnected ✓' } : { kind: 'err', text: 'reconnect failed' });
    } catch {
      setNotice({ kind: 'err', text: 'network error' });
    } finally {
      setReconnecting(false);
    }
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
            <div className="settings-row">
              <input
                id={`kickroom-${host}`}
                value={form.kickChatroomIds[host]}
                onChange={(e) => setHost('kickChatroomIds', host, e.target.value)}
                placeholder="found from the kick name on save — or paste it"
              />
              <button
                type="button"
                className="settings-find"
                disabled={kickLookup[host]?.state === 'loading'}
                onClick={() => void resolveKickId(host)}
              >
                {kickLookup[host]?.state === 'loading' ? 'Finding…' : 'Find id'}
              </button>
            </div>
            {kickLookup[host] && kickLookup[host].state !== 'loading' && (
              <span className={'settings-hint ' + (kickLookup[host].state === 'ok' ? 'hint-ok' : 'hint-err')}>
                {kickLookup[host].text}
              </span>
            )}

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
          <button type="button" className="settings-reconnect" disabled={reconnecting} onClick={reconnectAll}>
            {reconnecting ? 'Reconnecting…' : 'Reconnect all'}
          </button>
          {notice && (
            <span
              className={
                notice.kind === 'ok' ? 'settings-saved' : notice.kind === 'warn' ? 'settings-warn' : 'settings-error'
              }
            >
              {notice.text}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

export const SettingsView = memo(SettingsViewImpl);
