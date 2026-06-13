'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { alertDialog } from '@/lib/dialogs';

export default function PrivacyToggleButton({ id, isPrivate }: { id: string; isPrivate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [localPrivate, setLocalPrivate] = useState(isPrivate);

  async function onClick() {
    if (busy) return;
    const next = !localPrivate;
    setBusy(true);
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(id)}/privacy`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ private: next }),
      });
      if (!res.ok) {
        let msg = `Failed (${res.status})`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
        await alertDialog({ title: 'Privacy update failed', message: msg, tone: 'danger' });
        setBusy(false);
        return;
      }
      setLocalPrivate(next);
      router.refresh();
    } catch (e) {
      await alertDialog({ title: 'Privacy update failed', message: e instanceof Error ? e.message : String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  const tip = localPrivate
    ? 'Private - only you can view this report. Click to make public.'
    : 'Public - anyone with the link can view. Click to make private.';

  return (
    <button
      onClick={onClick}
      disabled={busy}
      data-tooltip={tip}
      aria-label={localPrivate ? 'Make report public' : 'Make report private'}
      className={`rounded p-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        localPrivate
          ? 'text-amber-400/80 hover:text-amber-300 hover:bg-amber-500/10'
          : 'text-gray-400/60 hover:text-gray-200 hover:bg-white/[0.06]'
      }`}
    >
      {busy ? (
        <span className="inline-block w-3 h-3 rounded-full border-2 border-gray-400/40 border-t-gray-200 animate-spin" />
      ) : localPrivate ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 019.9-1" />
        </svg>
      )}
    </button>
  );
}
