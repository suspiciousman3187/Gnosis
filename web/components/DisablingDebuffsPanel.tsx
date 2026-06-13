'use client';

import { useMemo } from 'react';
import BuffIcon from './BuffIcon';
import type { BuffLogEntry } from '@/lib/types';
import { pairDisablingBuffDurations } from '@/lib/disablingBuffs';
import { buffLongName } from '@/lib/statusEffects';

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtDur(s: number): string {
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}m ${sec}s`;
}

export default function DisablingDebuffsPanel({
  buffLog,
  durationSeconds,
}: {
  buffLog?: BuffLogEntry[] | null;
  durationSeconds?: number | null;
}) {
  const entries = useMemo(
    () => pairDisablingBuffDurations(buffLog, { maxElapsed: durationSeconds ?? undefined }),
    [buffLog, durationSeconds],
  );

  if (entries.length === 0) return null;

  const totalSec = entries.reduce((s, e) => s + e.durationSec, 0);
  const byTarget = new Map<string, number>();
  for (const e of entries) byTarget.set(e.target, (byTarget.get(e.target) ?? 0) + e.durationSec);
  const worstTarget = [...byTarget.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-5">
      <div className="flex items-end justify-between gap-3 mb-1 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Disabling Debuffs</h3>
        <span className="text-[11px] text-gray-400">
          {entries.length} {entries.length === 1 ? 'window' : 'windows'} · {fmtDur(totalSec)} total downtime
          {worstTarget && ` · worst: ${worstTarget[0]} (${fmtDur(worstTarget[1])})`}
        </span>
      </div>
      <p className="text-[11px] text-gray-400 mb-3">
        Sleep / Petrify / Silence / Stun / Charm / Paralyze / Bind / Doom / Terror / Amnesia windows
        paired between gain and wear-off packets. Tracks when characters lost control and for how long.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 border-b border-white/10">
              <th className="text-left pb-1.5 font-semibold pl-2">Debuff</th>
              <th className="text-left pb-1.5 font-semibold">Character</th>
              <th className="text-left pb-1.5 font-semibold">From</th>
              <th className="text-right pb-1.5 font-semibold w-20">Start</th>
              <th className="text-right pb-1.5 font-semibold w-20">Duration</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const enl = buffLongName(e.buffId);
              const tooltip = enl ? `${e.target} is ${enl}` : `${e.target} suffered ${e.buffName}`;
              return (
              <tr key={i} className="border-b border-white/[0.04] last:border-0">
                <td className="py-1.5 pl-2">
                  <div className="flex items-center gap-1.5" title={tooltip}>
                    <BuffIcon id={e.buffId} />
                    <span className="text-gray-200">{e.buffName}</span>
                  </div>
                </td>
                <td className="py-1.5 text-gray-300">{e.target}</td>
                <td className="py-1.5 text-gray-400 truncate max-w-[14rem]">
                  {e.appliedBySpell
                    ? <><span className="text-rose-300/80">{e.appliedBy ?? 'enemy'}</span> via {e.appliedBySpell}</>
                    : (e.appliedBy ?? '-')}
                </td>
                <td className="py-1.5 text-right font-mono text-gray-400">{fmtTime(e.startElapsed)}</td>
                <td className="py-1.5 text-right font-mono text-rose-300">{fmtDur(e.durationSec)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
