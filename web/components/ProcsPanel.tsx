'use client';

import { useMemo } from 'react';
import type { ActionLogEntry } from '@/lib/types';
import { decodeBitFlags } from '@/lib/actionBitFlags';

type Counts = { immunobreak: number; cover: number; magicBurst: number; crit: number; total: number };

function emptyCounts(): Counts {
  return { immunobreak: 0, cover: 0, magicBurst: 0, crit: 0, total: 0 };
}

export default function ProcsPanel({ actionLog }: { actionLog?: ActionLogEntry[] | null }) {
  const { perActor, totals, anyFlags } = useMemo(() => {
    const perActor = new Map<string, Counts>();
    const totals = emptyCounts();
    let anyFlags = false;
    if (!Array.isArray(actionLog)) return { perActor, totals, anyFlags };
    for (const a of actionLog) {
      const actor = a.player;
      if (!actor) continue;
      for (const t of a.targets ?? []) {
        if (!t.bitFlags) continue;
        anyFlags = true;
        const f = decodeBitFlags(t.bitFlags);
        let row = perActor.get(actor);
        if (!row) { row = emptyCounts(); perActor.set(actor, row); }
        if (f.immunobreak) { row.immunobreak++; totals.immunobreak++; }
        if (f.cover)       { row.cover++;       totals.cover++; }
        if (f.magicBurst)  { row.magicBurst++;  totals.magicBurst++; }
        if (f.crit)        { row.crit++;        totals.crit++; }
        row.total++;
        totals.total++;
      }
    }
    return { perActor, totals, anyFlags };
  }, [actionLog]);

  if (!anyFlags) return null;

  const rows = [...perActor.entries()].sort((a, b) => b[1].total - a[1].total);

  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-5">
      <div className="flex items-end justify-between gap-3 mb-1 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Procs (Result Flags)</h3>
        <span className="text-[11px] text-gray-400">
          {totals.total.toLocaleString()} flagged hits · {totals.immunobreak} IB · {totals.cover} cover · {totals.magicBurst} MB · {totals.crit} crit
        </span>
      </div>
      <p className="text-[11px] text-gray-400 mb-3">
        Extracted from 0x028 result.bit. Immunobreak lowers a target&apos;s defense after burst damage thresholds.
        Cover marks a tank-redirected hit. Magic Burst / Critical Hit flags double as confirmation of the message-id classification.
      </p>

      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-row-even">
            <tr className="text-gray-400 border-b border-white/10">
              <th className="text-left pb-1.5 font-semibold pl-2">Actor</th>
              <th className="text-right pb-1.5 font-semibold w-20">Immunobreak</th>
              <th className="text-right pb-1.5 font-semibold w-16">Cover</th>
              <th className="text-right pb-1.5 font-semibold w-20">Magic Burst</th>
              <th className="text-right pb-1.5 font-semibold w-14">Crit</th>
              <th className="text-right pb-1.5 font-semibold w-20 pr-2">Total flagged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([actor, c]) => (
              <tr key={actor} className="border-b border-white/[0.04] last:border-0">
                <td className="py-1 pl-2 text-gray-200">{actor}</td>
                <td className="py-1 text-right font-mono text-amber-300">{c.immunobreak || ''}</td>
                <td className="py-1 text-right font-mono text-sky-300">{c.cover || ''}</td>
                <td className="py-1 text-right font-mono text-teal-300">{c.magicBurst || ''}</td>
                <td className="py-1 text-right font-mono text-rose-300">{c.crit || ''}</td>
                <td className="py-1 text-right font-mono text-gray-300 pr-2">{c.total.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
