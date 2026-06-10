import { useState } from 'react';

// Full-screen password gate shown at /admin when not authenticated.
export function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        onSuccess();
        return;
      }
      if (res.status === 429) {
        const d = (await res.json().catch(() => ({}))) as { retryAfter?: number };
        const mins = Math.ceil((d.retryAfter ?? 900_000) / 60_000);
        setError(`Too many attempts. Try again in ~${mins} min.`);
      } else if (res.status === 404 || res.status === 503) {
        setError('Admin is not configured on this server.');
      } else {
        setError('Wrong password.');
      }
    } catch {
      setError('Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-login">
      <form className="admin-login-card" onSubmit={submit}>
        <h1 className="admin-login-title">Admin</h1>
        <label htmlFor="admin-password">Password</label>
        <input
          id="admin-password"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Log in'}
        </button>
        {error && <p className="admin-login-error">{error}</p>}
      </form>
    </div>
  );
}
