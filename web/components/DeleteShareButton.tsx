'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { confirmDialog, alertDialog } from '@/lib/dialogs';

export default function DeleteShareButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    const ok = await confirmDialog({
      title: 'Unshare encounter',
      message: 'Remove this uploaded report from the web? The /r/ link will stop working immediately.',
      destructive: true,
      confirmLabel: 'Unshare',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/share?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        let msg = `Failed (${res.status})`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
        await alertDialog({ title: 'Unshare failed', message: msg, tone: 'danger' });
        setBusy(false);
        return;
      }
      router.refresh();
    } catch (e) {
      await alertDialog({ title: 'Unshare failed', message: e instanceof Error ? e.message : String(e), tone: 'danger' });
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      data-tooltip="Unshare - remove this upload from the web"
      aria-label="Unshare uploaded report"
      className="text-rose-400/60 hover:text-rose-400 hover:bg-rose-500/10 rounded p-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {busy ? (
        <span className="inline-block w-3 h-3 rounded-full border-2 border-rose-400/40 border-t-rose-400 animate-spin" />
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      )}
    </button>
  );
}
