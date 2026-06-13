'use client';

import { useState } from 'react';
import { alertDialog } from '@/lib/dialogs';

export default function ReportPrivacyBadge({ id, initialPrivate }: { id: string; initialPrivate: boolean }) {
  const [isPrivate, setIsPrivate] = useState(initialPrivate);
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    const next = !isPrivate;
    setBusy(true);
    setIsPrivate(next);
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(id)}/privacy`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ private: next }),
      });
      if (!res.ok) {
        let msg = `Failed (${res.status})`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
        setIsPrivate(!next);
        await alertDialog({ title: 'Privacy update failed', message: msg, tone: 'danger' });
      }
    } catch (e) {
      setIsPrivate(!next);
      await alertDialog({ title: 'Privacy update failed', message: e instanceof Error ? e.message : String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  const label = isPrivate ? 'Private' : 'Public';
  const tip = isPrivate
    ? 'Private - only you can view this report. Click to make public.'
    : 'Public - anyone with the link can view. Click to make private.';

  return (
    <button
      onClick={onClick}
      disabled={busy}
      data-tooltip={tip}
      aria-label={isPrivate ? 'Make report public' : 'Make report private'}
      className={`shrink-0 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider rounded border px-2 py-1 leading-none whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-wait ${
        isPrivate
          ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25'
          : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25'
      }`}
    >
      {busy ? (
        <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
      ) : isPrivate ? (
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 018 0v4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 017.5-1.8" />
        </svg>
      )}
      {label}
    </button>
  );
}
