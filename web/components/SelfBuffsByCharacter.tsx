'use client';

import { useState, useMemo } from 'react';
import BuffIcon from './BuffIcon';
import type { BuffLogEntry } from '@/lib/types';

function fmtDur(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function buildRows(buffLog: BuffLogEntry[]) {
  const end = buffLog.reduce((m, b) => Math.max(m, b.elapsed), 0);
  const open: Record<number, number> = {};
  const agg: Record<number, { id: number; name: string; secs: number; count: number }> = {};
  for (const b of [...buffLog].sort((a, c) => a.elapsed - c.elapsed)) {
    const a = (agg[b.buffId] ??= { id: b.buffId, name: b.buffName, secs: 0, count: 0 });
    if (b.kind === 'gain') { open[b.buffId] = b.elapsed; a.count += 1; }
    else if (open[b.buffId] != null) { a.secs += Math.max(0, b.elapsed - open[b.buffId]); delete open[b.buffId]; }
  }
  for (const [id, gainAt] of Object.entries(open)) { const a = agg[+id]; if (a) a.secs += Math.max(0, end - gainAt); }
  return Object.values(agg).sort((x, y) => y.secs - x.secs || y.count - x.count);
}

export default function SelfBuffsByCharacter({ gearByPlayer }: {
  gearByPlayer?: Record<string, { buffLog?: BuffLogEntry[] | null }> | null;
}) {
  const chars = useMemo(() => Object.entries(gearByPlayer ?? {})
    .filter(([, g]) => Array.isArray(g.buffLog) && g.buffLog!.length > 0)
    .map(([name, g]) => ({ name, buffLog: g.buffLog! }))
    .sort((a, b) => a.name.localeCompare(b.name)),
    [gearByPlayer]);

  const [sel, setSel] = useState('');

  if (chars.length === 0) return null;

  const activeName = chars.some(c => c.name === sel) ? sel : chars[0].name;
  const active = chars.find(c => c.name === activeName)!;
  const rows = buildRows(active.buffLog);
  const totalSecs = rows.reduce((s, r) => s + r.secs, 0);

  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-5">
      <div className="flex items-end justify-between gap-3 mb-1 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Self-Buffs by Character</h3>
        <span className="text-[11px] text-gray-400">
          {rows.length} {rows.length === 1 ? 'buff' : 'buffs'} · {fmtDur(totalSecs)} total uptime
        </span>
      </div>
      <p className="text-[11px] text-gray-400 mb-3">
        Per-character own-buff uptime + times gained. Each box reports its own buff list
        from packets the server sent it directly - that&apos;s why it&apos;s split by character.
      </p>

      {/* Character tab bar */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mr-1">Character</span>
        {chars.map(c => (
          <button
            key={c.name}
            onClick={() => setSel(c.name)}
            className={`text-xs px-2.5 py-1 rounded border transition-colors ${activeName === c.name ? 'bg-accent/20 border-accent/50 text-accent font-semibold' : 'border-white/10 text-gray-400 hover:bg-white/[0.05]'}`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Buff grid */}
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No buff data captured for this character.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
          {rows.map(r => (
            <div key={r.id} className="flex items-center gap-2 text-sm py-1 border-b border-white/[0.04]">
              <BuffIcon id={r.id} />
              <span className="text-gray-200 truncate flex-1">{r.name}</span>
              <span className="text-gray-400 text-[11px]">×{r.count}</span>
              <span className="font-mono text-violet-300/90 text-xs w-16 text-right">{fmtDur(r.secs)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
