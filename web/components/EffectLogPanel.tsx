'use client';

import { useMemo } from 'react';
import type { EffectLogEntry } from '@/lib/types';

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function EffectLogPanel({ entries }: { entries?: EffectLogEntry[] | null }) {
  const sorted = useMemo(() => {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    return [...entries].sort((a, b) => a.elapsed - b.elapsed);
  }, [entries]);

  if (sorted.length === 0) return null;

  const uniqueEntities = new Set(sorted.map(e => e.entityId)).size;

  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-5">
      <div className="flex items-end justify-between gap-3 mb-1 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Effect / Status Changes</h3>
        <span className="text-[11px] text-gray-400">
          {sorted.length} events · {uniqueEntities} entities
        </span>
      </div>
      <p className="text-[11px] text-gray-400 mb-3">
        0x030 EFFECT packet capture. Primarily surfaces crafting animation state changes; entity
        server-status field can mark engagement transitions.
      </p>

      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-row-even">
            <tr className="text-gray-400 border-b border-white/10">
              <th className="text-right pb-1.5 font-semibold w-16 pl-2">Time</th>
              <th className="text-right pb-1.5 font-semibold w-24">Entity</th>
              <th className="text-right pb-1.5 font-semibold w-20">Effect</th>
              <th className="text-right pb-1.5 font-semibold w-16">Type</th>
              <th className="text-right pb-1.5 font-semibold w-16">Status</th>
              <th className="text-right pb-1.5 font-semibold w-16">Timer</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 200).map((e, i) => (
              <tr key={i} className="border-b border-white/[0.04] last:border-0">
                <td className="py-1 text-right font-mono text-gray-400 pl-2">{fmtTime(e.elapsed)}</td>
                <td className="py-1 text-right font-mono text-gray-300">{e.entityId}</td>
                <td className="py-1 text-right font-mono text-gray-300">{e.effectNum}</td>
                <td className="py-1 text-right font-mono text-gray-400">{e.type}</td>
                <td className="py-1 text-right font-mono text-gray-400">{e.status}</td>
                <td className="py-1 text-right font-mono text-gray-400">{e.timer}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length > 200 && (
          <div className="text-[10px] text-gray-400 mt-2">Showing first 200 of {sorted.length} events.</div>
        )}
      </div>
    </div>
  );
}
