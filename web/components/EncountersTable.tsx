'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import DeleteShareButton from '@/components/DeleteShareButton';
import PrivacyToggleButton from '@/components/PrivacyToggleButton';
import { classify, CONTENT_COLOR_PALETTE, type ContentDef } from '@/lib/contentRegistry';

type PartyEntry = { name: string; job: string };
type DropEntry = { name: string; count: number };
export type ShareUpload = {
  object_path: string;
  created_at: string;
  content_kind: string | null;
  zone_name: string | null;
  party: PartyEntry[] | null;
  duration_seconds: number | null;
  drops: DropEntry[] | null;
  enemy_names: string[] | null;
  is_private: boolean;
};

const TIMEBOX_OPTIONS = [
  { id: 'all', label: 'All time',  days: null  },
  { id: '3d',  label: 'Last 3d',   days: 3     },
  { id: '7d',  label: 'Last 7d',   days: 7     },
  { id: '30d', label: 'Last 30d',  days: 30    },
  { id: '90d', label: 'Last 90d',  days: 90    },
] as const;
type TimeboxId = typeof TIMEBOX_OPTIONS[number]['id'];

function shareIdFrom(objectPath: string): string {
  return objectPath.replace(/\.json\.gz$/, '');
}

function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDuration(s: number | null): string {
  if (s == null || s <= 0) return '-';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function zoneLabel(r: { zone_name: string | null; content_kind: string | null }): string | null {
  if (r.zone_name) return r.zone_name;
  if (r.content_kind === 'sortie') return "Outer Ra'Kaznar";
  return null;
}

function classifyRow(r: ShareUpload): ContentDef | null {
  const kind: 'sortie' | 'encounter' = r.content_kind === 'sortie' ? 'sortie' : 'encounter';
  const itemNames = new Set<string>();
  for (const d of r.drops ?? []) if (d?.name) itemNames.add(d.name);
  const mobNames = new Set<string>();
  for (const n of r.enemy_names ?? []) if (typeof n === 'string') mobNames.add(n);
  return classify({
    kind,
    zoneId: null,
    zoneName: r.zone_name ?? null,
    mobNames,
    itemNames,
  });
}

function ContentBadge({ def }: { def: ContentDef }) {
  const chip = CONTENT_COLOR_PALETTE[def.color].chip;
  return (
    <span className={`inline-flex items-center justify-center text-[9px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap min-w-[3.5rem] ${chip}`}>
      {def.name}
    </span>
  );
}

function partySummary(party: PartyEntry[] | null): { jobs: string; count: number } {
  if (!party?.length) return { jobs: '', count: 0 };
  const jobs = party.map(p => (p.job || '?').toUpperCase()).join(' / ');
  return { jobs, count: party.length };
}

function dropsSummary(drops: DropEntry[] | null, headN = 3): { head: DropEntry[]; rest: number; total: number } {
  if (!drops?.length) return { head: [], rest: 0, total: 0 };
  const head = drops.slice(0, headN);
  const total = drops.reduce((s, d) => s + (d.count || 0), 0);
  return { head, rest: Math.max(0, drops.length - head.length), total };
}

// Build a flat lowercase string of everything searchable on this row, so
// the typed query is a single substring match - fast and forgiving.
function searchHaystack(r: ShareUpload): string {
  const zone = zoneLabel(r) ?? '';
  const partyNames = r.party?.map(p => p.name).join(' ') ?? '';
  const partyJobs = r.party?.map(p => p.job).join(' ') ?? '';
  const drops = r.drops?.map(d => d.name).join(' ') ?? '';
  const content = classifyRow(r)?.name ?? '';
  return `${zone} ${content} ${partyNames} ${partyJobs} ${drops}`.toLowerCase();
}

export default function EncountersTable({ rows }: { rows: ShareUpload[] }) {
  const [query, setQuery] = useState('');
  const [timebox, setTimebox] = useState<TimeboxId>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cutoffMs = (() => {
      const opt = TIMEBOX_OPTIONS.find(o => o.id === timebox);
      if (!opt || opt.days == null) return null;
      return Date.now() - opt.days * 24 * 60 * 60 * 1000;
    })();
    return rows.filter(r => {
      if (cutoffMs != null && new Date(r.created_at).getTime() < cutoffMs) return false;
      if (q && !searchHaystack(r).includes(q)) return false;
      return true;
    });
  }, [rows, query, timebox]);

  const showingClause = filtered.length === rows.length
    ? `${rows.length} shared`
    : `${filtered.length} of ${rows.length}`;

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400/70 pointer-events-none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by zone, party, or drops…"
            spellCheck={false}
            className="w-full bg-surface border border-white/10 focus:border-accent/60 rounded-lg pl-9 pr-24 py-2 text-sm text-gray-100 placeholder-gray-400/70 focus:outline-none transition-colors"
          />
          {!query && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-400 font-mono pointer-events-none">{showingClause}</span>
          )}
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 transition-colors px-1.5"
            >
              ✕
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 bg-surface border border-white/10 rounded-lg p-1">
          {TIMEBOX_OPTIONS.map(opt => {
            const on = timebox === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setTimebox(opt.id)}
                className={`text-xs px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
                  on ? 'bg-accent/20 text-accent font-semibold' : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        rows.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg">No shared encounters yet.</p>
            <p className="text-sm mt-2 text-gray-400">
              Open an encounter in the Gnosis Viewer and click <span className="text-accent">Share</span> to upload it here.
            </p>
          </div>
        ) : (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg">No matches.</p>
            <p className="text-sm mt-2 text-gray-400">
              Try a different search or expand the time range.
            </p>
          </div>
        )
      ) : (
        <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400/80 bg-white/[0.03] border-b border-white/10">
                <th className="px-4 py-2.5 font-semibold">Zone</th>
                <th className="px-4 py-2.5 font-semibold">Party</th>
                <th className="px-4 py-2.5 font-semibold">Duration</th>
                <th className="px-4 py-2.5 font-semibold">Drops</th>
                <th className="px-4 py-2.5 font-semibold">Uploaded</th>
                <th className="px-4 py-2.5 font-semibold w-10"></th>
                <th className="px-4 py-2.5 font-semibold w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const id = shareIdFrom(r.object_path);
                const { jobs, count } = partySummary(r.party);
                const { head, rest, total } = dropsSummary(r.drops);
                const def = classifyRow(r);
                return (
                  <tr
                    key={r.object_path}
                    className="relative border-b border-white/[0.06] last:border-0 hover:bg-white/[0.05] cursor-pointer transition-colors group"
                  >
                    <td className="px-4 py-3 text-gray-100 group-hover:text-white transition-colors">
                      <Link
                        href={`/r/${id}`}
                        aria-label={`Open shared report ${zoneLabel(r) ?? id}`}
                        className="before:content-[''] before:absolute before:inset-0 before:z-0 focus:outline-none focus-visible:before:ring-2 focus-visible:before:ring-accent/60 focus-visible:before:ring-inset"
                      >
                        <div className="flex flex-col gap-1">
                          {def && <ContentBadge def={def} />}
                          <span>{zoneLabel(r) ?? <span className="text-gray-400">-</span>}</span>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      {count > 0 ? (
                        <span className="font-mono text-xs">
                          {jobs}
                          <span className="text-gray-400 ml-1.5">({count})</span>
                        </span>
                      ) : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-300">{formatDuration(r.duration_seconds)}</td>
                    <td className="px-4 py-3 text-gray-300 max-w-xs">
                      {head.length > 0 ? (
                        <div className="text-xs leading-tight" title={`${total} total drops`}>
                          {head.map((d, i) => (
                            <span key={d.name}>
                              {i > 0 && <span className="text-gray-400">, </span>}
                              <span className="text-gray-200">{d.name}</span>
                              {d.count > 1 && <span className="text-gray-400"> ×{d.count}</span>}
                            </span>
                          ))}
                          {rest > 0 && <span className="text-gray-400 ml-1">+{rest} more</span>}
                        </div>
                      ) : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{timeAgo(r.created_at)}</td>
                    <td className="px-4 py-3 text-right relative z-10">
                      <PrivacyToggleButton id={id} isPrivate={r.is_private} />
                    </td>
                    <td className="px-4 py-3 text-right relative z-10">
                      <DeleteShareButton id={id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
