'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { alertDialog, confirmDialog, promptDialog } from '@/lib/dialogs';

type PartyEntry = { name: string; job: string };
type DropEntry = { name: string; count: number };

export type AdminShareRow = {
  id: string;
  contentId: string;
  created_at: string;
  uploaderUsername: string | null;
  uploaderIp: string | null;
  zone_name: string | null;
  party: PartyEntry[] | null;
  duration_seconds: number | null;
  drops: DropEntry[] | null;
  flagged_at: string | null;
  flagged_reason: string | null;
  has_implausible: boolean;
  blob_deleted: boolean;
};

const TIMEBOX = [
  { id: 'all', label: 'All',     days: null },
  { id: '24h', label: '24h',     days: 1    },
  { id: '7d',  label: '7d',      days: 7    },
  { id: '30d', label: '30d',     days: 30   },
] as const;
type TimeId = typeof TIMEBOX[number]['id'];

const STATUS = [
  { id: 'all',         label: 'All' },
  { id: 'flagged',     label: 'Flagged' },
  { id: 'implausible', label: 'Implausible' },
  { id: 'clean',       label: 'Clean' },
] as const;
type StatusId = typeof STATUS[number]['id'];

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatDuration(s: number | null): string {
  if (s == null || s <= 0) return '-';
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
function partyJobs(p: PartyEntry[] | null): string {
  if (!p?.length) return '-';
  return p.map(x => (x.job || '?').toUpperCase()).join('/') + ` (${p.length})`;
}
function dropsLabel(d: DropEntry[] | null): string {
  if (!d?.length) return '-';
  const head = d.slice(0, 2).map(x => x.count > 1 ? `${x.name}×${x.count}` : x.name).join(', ');
  return d.length > 2 ? `${head} +${d.length - 2}` : head;
}
function searchHaystack(r: AdminShareRow): string {
  return [
    r.uploaderUsername ?? '',
    r.uploaderIp ?? '',
    r.zone_name ?? '',
    r.party?.map(p => p.name).join(' ') ?? '',
    r.party?.map(p => p.job).join(' ') ?? '',
    r.drops?.map(d => d.name).join(' ') ?? '',
    r.contentId,
  ].join(' ').toLowerCase();
}

export default function AdminSharesTable({ rows }: { rows: AdminShareRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusId>('all');
  const [timebox, setTimebox] = useState<TimeId>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cutoff = (() => {
      const opt = TIMEBOX.find(t => t.id === timebox);
      if (!opt || opt.days == null) return null;
      return Date.now() - opt.days * 86_400_000;
    })();
    return rows.filter(r => {
      if (cutoff != null && new Date(r.created_at).getTime() < cutoff) return false;
      if (status === 'flagged'     && !r.flagged_at) return false;
      if (status === 'implausible' && !r.has_implausible) return false;
      if (status === 'clean'       && (r.flagged_at || r.has_implausible)) return false;
      if (q && !searchHaystack(r).includes(q)) return false;
      return true;
    });
  }, [rows, query, status, timebox]);

  async function onFlag(r: AdminShareRow) {
    setBusyId(r.id);
    try {
      if (r.flagged_at) {
        const ok = await confirmDialog({
          title: 'Remove flag',
          message: 'Remove the flag from this share? Its analytics rows will be moved back to quality=ok.',
        });
        if (!ok) return;
        const res = await fetch(`/api/admin/flag-share?id=${encodeURIComponent(r.contentId)}`, { method: 'DELETE' });
        if (!res.ok) {
          await alertDialog({ title: 'Unflag failed', message: (await safeError(res)) ?? `Unflag failed (${res.status})`, tone: 'danger' });
          return;
        }
      } else {
        const reason = await promptDialog({
          title: 'Flag this share',
          message: 'Why is this share flagged? (visible only to admins, optional)',
          confirmLabel: 'Flag',
          multiline: true,
        });
        if (reason == null) return;
        const res = await fetch(`/api/admin/flag-share?id=${encodeURIComponent(r.contentId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        });
        if (!res.ok) {
          await alertDialog({ title: 'Flag failed', message: (await safeError(res)) ?? `Flag failed (${res.status})`, tone: 'danger' });
          return;
        }
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(r: AdminShareRow) {
    const ok = await confirmDialog({
      title: 'Delete share permanently',
      message: `ID: ${r.contentId}\nZone: ${r.zone_name ?? '-'}\nUploader: ${r.uploaderUsername ?? r.uploaderIp ?? 'anon'}\n\nThis removes the blob, the share_uploads row, and cascade-deletes its analytics rows.`,
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/share?id=${encodeURIComponent(r.contentId)}`, { method: 'DELETE' });
      if (!res.ok) {
        await alertDialog({ title: 'Delete failed', message: (await safeError(res)) ?? `Delete failed (${res.status})`, tone: 'danger' });
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400/70 pointer-events-none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by uploader, zone, party, drops, or content id…"
            spellCheck={false}
            className="w-full bg-surface border border-white/10 focus:border-accent/60 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-100 placeholder-gray-500/60 focus:outline-none transition-colors"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 px-1.5">✕</button>
          )}
        </div>
        <div className="flex items-center gap-1 bg-surface border border-white/10 rounded-lg p-1">
          {STATUS.map(opt => {
            const on = status === opt.id;
            return (
              <button key={opt.id} onClick={() => setStatus(opt.id)} className={`text-xs px-2.5 py-1 rounded transition-colors whitespace-nowrap ${on ? 'bg-accent/20 text-accent font-semibold' : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'}`}>
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1 bg-surface border border-white/10 rounded-lg p-1">
          {TIMEBOX.map(opt => {
            const on = timebox === opt.id;
            return (
              <button key={opt.id} onClick={() => setTimebox(opt.id)} className={`text-xs px-2.5 py-1 rounded transition-colors whitespace-nowrap ${on ? 'bg-accent/20 text-accent font-semibold' : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'}`}>
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-gray-400 mb-3">
        {filtered.length === rows.length ? `${rows.length} total` : `${filtered.length} of ${rows.length}`}
      </p>

      <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400/80 bg-white/[0.03] border-b border-white/10">
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Uploader</th>
              <th className="px-3 py-2 font-semibold">Zone</th>
              <th className="px-3 py-2 font-semibold">Party</th>
              <th className="px-3 py-2 font-semibold">Dur</th>
              <th className="px-3 py-2 font-semibold">Drops</th>
              <th className="px-3 py-2 font-semibold">Uploaded</th>
              <th className="px-3 py-2 font-semibold text-right w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.02]">
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1">
                    {r.flagged_at && (
                      <span title={r.flagged_reason ?? 'Flagged'} className="text-[10px] font-semibold bg-rose-500/15 border border-rose-500/40 text-rose-300 rounded px-1.5 py-0.5">FLAG</span>
                    )}
                    {r.has_implausible && (
                      <span title="Has implausible analytics rows" className="text-[10px] font-semibold bg-amber-500/15 border border-amber-500/40 text-amber-300 rounded px-1.5 py-0.5">IMP</span>
                    )}
                    {r.blob_deleted && (
                      <span title="Blob retention-deleted; analytics rows still alive" className="text-[10px] font-semibold bg-gray-500/15 border border-gray-500/40 text-gray-400 rounded px-1.5 py-0.5">BLOB✕</span>
                    )}
                    {!r.flagged_at && !r.has_implausible && !r.blob_deleted && (
                      <span className="text-[10px] text-gray-400">-</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-gray-300 text-xs font-mono">
                  {r.uploaderUsername ? r.uploaderUsername : <span className="text-gray-400">{r.uploaderIp ?? 'anon'}</span>}
                </td>
                <td className="px-3 py-2.5 text-gray-100">{r.zone_name ?? <span className="text-gray-400">-</span>}</td>
                <td className="px-3 py-2.5 text-gray-300 font-mono text-xs">{partyJobs(r.party)}</td>
                <td className="px-3 py-2.5 font-mono text-gray-300 text-xs">{formatDuration(r.duration_seconds)}</td>
                <td className="px-3 py-2.5 text-gray-300 text-xs max-w-[200px] truncate" title={r.drops?.map(d => `${d.name}${d.count > 1 ? ' ×' + d.count : ''}`).join(', ')}>
                  {dropsLabel(r.drops)}
                </td>
                <td className="px-3 py-2.5 text-gray-400 text-xs">{timeAgo(r.created_at)}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      href={`/admin/shares/${r.contentId}`}
                      className="text-gray-300 hover:text-white text-xs px-2 py-1 rounded hover:bg-white/[0.05] transition-colors"
                      data-tooltip="See per-action analytics - why this share was flagged"
                    >
                      Actions
                    </Link>
                    <Link
                      href={`/r/${r.contentId}`}
                      target="_blank"
                      className="text-accent hover:text-accent-hover text-xs px-2 py-1 rounded hover:bg-accent/10 transition-colors"
                      data-tooltip="Open report in new tab"
                    >
                      Open ↗
                    </Link>
                    <button
                      onClick={() => onFlag(r)}
                      disabled={busyId === r.id}
                      data-tooltip={r.flagged_at ? 'Unflag' : 'Flag this share'}
                      className={`p-1.5 rounded transition-colors disabled:opacity-40 ${r.flagged_at ? 'text-rose-300 hover:bg-rose-500/15' : 'text-amber-300/80 hover:bg-amber-500/10 hover:text-amber-300'}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill={r.flagged_at ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 21V4M4 4h14l-3 5 3 5H4" />
                      </svg>
                    </button>
                    <button
                      onClick={() => onDelete(r)}
                      disabled={busyId === r.id}
                      data-tooltip="Delete this share + cascade analytics"
                      className="p-1.5 rounded text-rose-400/70 hover:bg-rose-500/15 hover:text-rose-400 transition-colors disabled:opacity-40"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 6h18" />
                        <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                        <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-sm text-gray-400">
                  No shares match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function safeError(res: Response): Promise<string | null> {
  try {
    const j = await res.json() as { error?: string };
    return j?.error ?? null;
  } catch { return null; }
}
