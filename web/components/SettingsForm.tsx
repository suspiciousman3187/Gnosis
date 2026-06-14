'use client';

import { useEffect, useRef, useState } from 'react';

type Profile = {
  username: string | null;
  avatar_url: string | null;
};

export default function SettingsForm({ initialUsername, initialAvatarUrl }: { initialUsername: string | null; initialAvatarUrl: string | null }) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const [profile, setProfile] = useState<Profile>({ username: initialUsername, avatar_url: initialAvatarUrl });
  const [displayName, setDisplayName] = useState(initialUsername ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/account/token')
      .then((r) => r.json())
      .then((j) => { setToken(j.token); setLoading(false); });
  }, []);

  async function regenerate() {
    setRegenerating(true);
    const res = await fetch('/api/account/token', { method: 'POST' });
    const j = await res.json();
    setToken(j.token);
    setRegenerating(false);
  }

  async function copyToken() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function saveDisplayName() {
    setSavingName(true);
    setNameError(null);
    setNameSaved(false);
    const trimmed = displayName.trim().toLowerCase();
    const payload = trimmed === '' ? { username: null } : { username: trimmed };
    const res = await fetch('/api/account/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSavingName(false);
    if (!res.ok) {
      let msg = `Failed (${res.status})`;
      try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
      setNameError(msg);
      return;
    }
    setProfile(p => ({
      username: trimmed === '' ? null : trimmed,
      avatar_url: p?.avatar_url ?? null,
    }));
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  }

  async function uploadAvatar(file: File) {
    setUploadingAvatar(true);
    setAvatarError(null);
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/account/avatar', { method: 'POST', body: form });
    setUploadingAvatar(false);
    if (!res.ok) {
      let msg = `Failed (${res.status})`;
      try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
      setAvatarError(msg);
      return;
    }
    const j = await res.json() as { avatar_url: string };
    setProfile(p => ({
      username: p?.username ?? null,
      avatar_url: `${j.avatar_url}?t=${Date.now()}`,
    }));
  }

  async function removeAvatar() {
    setUploadingAvatar(true);
    setAvatarError(null);
    const res = await fetch('/api/account/avatar', { method: 'DELETE' });
    setUploadingAvatar(false);
    if (!res.ok && res.status !== 204) {
      setAvatarError(`Failed (${res.status})`);
      return;
    }
    setProfile(p => ({
      username: p?.username ?? null,
      avatar_url: null,
    }));
  }

  return (
    <div className="space-y-6">
        <section className="bg-surface border border-white/10 rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-sm text-gray-400 uppercase tracking-wide">Profile</h2>

          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-surface-raised border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
              {profile?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatar_url} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-500">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
                </svg>
              )}
            </div>
            <div className="flex-1 flex flex-col gap-2">
              <div className="flex gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="text-xs rounded-lg px-3 py-1.5 bg-surface-raised hover:bg-surface-hover border border-white/10 text-gray-200 transition-colors disabled:opacity-40"
                >
                  {uploadingAvatar ? 'Uploading…' : profile?.avatar_url ? 'Change' : 'Upload Picture'}
                </button>
                {profile?.avatar_url && (
                  <button
                    onClick={removeAvatar}
                    disabled={uploadingAvatar}
                    className="text-xs rounded-lg px-3 py-1.5 border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 transition-colors disabled:opacity-40"
                  >
                    Remove
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) void uploadAvatar(f);
                    e.target.value = '';
                  }}
                />
              </div>
              <p className="text-[11px] text-gray-400">JPEG, PNG, GIF, or WebP. Max 2 MB.</p>
              {avatarError && <p className="text-[11px] text-rose-400">{avatarError}</p>}
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-white/[0.06]">
            <label htmlFor="display-name" className="block text-xs text-gray-300 font-medium">Display Name</label>
            <p className="text-[11px] text-gray-400">3-30 lowercase letters, digits, or underscores.</p>
            <div className="flex gap-2">
              <input
                id="display-name"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="man_in_black"
                spellCheck={false}
                className="flex-1 min-w-0 bg-surface-raised border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-accent/60 transition-colors"
              />
              <button
                onClick={saveDisplayName}
                disabled={savingName || displayName.trim().toLowerCase() === (profile?.username ?? '')}
                className="text-sm rounded-lg px-4 py-2 bg-accent hover:bg-accent-hover disabled:bg-gray-700 disabled:text-gray-400 text-gray-900 font-semibold transition-colors disabled:cursor-not-allowed"
              >
                {savingName ? 'Saving…' : nameSaved ? 'Saved!' : 'Save'}
              </button>
            </div>
            {nameError && <p className="text-[11px] text-rose-400">{nameError}</p>}
          </div>
        </section>

        <section className="bg-surface border border-white/10 rounded-xl p-6 space-y-4">
          <div>
            <h2 className="font-semibold text-sm text-gray-400 uppercase tracking-wide">API Token</h2>
            <p className="text-gray-200 text-sm mt-1">
              Connect your Gnosis Viewer with your account using the token generated below. Encounters can still be shared without an account with limited features.
            </p>
          </div>

          {loading ? (
            <p className="text-gray-400/70 text-sm">Loading…</p>
          ) : (
            <>
              <code className="block w-full bg-surface-raised rounded-lg px-3 py-2.5 text-xs text-gray-300 font-mono break-all select-all border border-white/[0.06]">
                {token ?? '(none - click Generate to create one)'}
              </code>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={copyToken}
                  disabled={!token}
                  className="px-4 py-2 bg-emerald-600/80 hover:bg-emerald-600 rounded-lg text-sm text-white font-semibold transition-colors disabled:opacity-40 border border-emerald-500/40"
                >
                  {copied ? 'Copied!' : 'Copy Token'}
                </button>
                <button
                  onClick={regenerate}
                  disabled={regenerating}
                  className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:bg-gray-700 text-gray-900 font-semibold rounded-lg text-sm transition-colors"
                >
                  {regenerating ? 'Regenerating…' : token ? 'Regenerate Token' : 'Generate Token'}
                </button>
              </div>
            </>
          )}

          {token && (
            <p className="text-yellow-600 text-xs">
              Regenerating creates a new token. Any device pasted with your old token will stop authenticating
              uploads - you&apos;ll need to paste the new one in.
            </p>
          )}
        </section>
    </div>
  );
}
