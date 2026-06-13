'use client';

import { useMemo, useState } from 'react';
import type { JobExtendedEntry } from '@/lib/types';
import { decodeJobExtended, jobName, summarizeJobExtended } from '@/lib/jobExtended';

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function JobExtendedPanel({ entries }: { entries?: JobExtendedEntry[] | null }) {
  const summary = useMemo(() => summarizeJobExtended(entries), [entries]);
  const [selected, setSelected] = useState<JobExtendedEntry | null>(null);

  if (!entries || entries.length === 0) return null;

  const byJob = [...summary.byJob.entries()].sort((a, b) => b[1] - a[1]);
  const decoded = selected ? decodeJobExtended(selected) : null;

  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-5">
      <div className="flex items-end justify-between gap-3 mb-1 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Job Extended Info</h3>
        <span className="text-[11px] text-gray-400">
          {summary.total} events · {summary.subJobChanges.length} subjob change{summary.subJobChanges.length === 1 ? '' : 's'} · {byJob.length} unique jobs
        </span>
      </div>
      <p className="text-[11px] text-gray-400 mb-3">
        Raw 0x044 packet capture. Surfaces COR rolls / BLU spells / PUP attachments / SCH arts state.
        Click any event to decode the raw bytes.
      </p>

      {summary.subJobChanges.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">Subjob change timeline</div>
          <div className="flex flex-wrap gap-2">
            {summary.subJobChanges.map((e, i) => (
              <span key={i} className="text-[11px] font-mono px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-200">
                {fmtTime(e.elapsed)} → {jobName(e.jobId)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">Job event counts</div>
        <div className="flex flex-wrap gap-1.5">
          {byJob.map(([id, count]) => (
            <span key={id} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/10 text-gray-300">
              {jobName(id)}<span className="text-gray-500">·{count}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="border-t border-white/10 pt-3">
        <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">Events</div>
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-row-even">
              <tr className="text-gray-400 border-b border-white/10">
                <th className="text-right pb-1.5 font-semibold w-16 pl-2">Time</th>
                <th className="text-left pb-1.5 font-semibold pl-3">Job</th>
                <th className="text-left pb-1.5 font-semibold w-16">Slot</th>
                <th className="text-left pb-1.5 font-semibold">Decoded</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 200).map((e, i) => {
                const d = decodeJobExtended(e);
                let detail = '';
                if (d.cor?.rollNames?.length) detail = `rolls: ${d.cor.rollNames.join(', ')}`;
                else if (d.cor?.rolls.length) detail = `rolls: ${d.cor.rolls.join(', ')}`;
                else if (d.blu?.spellNames?.length) detail = `${d.blu.spellNames.length} blue spells: ${d.blu.spellNames.slice(0, 4).join(', ')}${d.blu.spellNames.length > 4 ? '...' : ''}`;
                else if (d.blu?.spellIds.length) detail = `${d.blu.spellIds.length} blue spells`;
                else if (d.pup) {
                  const fr = d.pup.frameName ?? `frame ${d.pup.frame}`;
                  const hd = d.pup.headName ?? `head ${d.pup.head}`;
                  detail = `${fr} / ${hd} (${d.pup.attachments.length} att)`;
                }
                else if (d.sch?.arts) detail = `arts: ${d.sch.arts}`;
                else if (d.sch) detail = `arts bits 0x${d.sch.artsBits.toString(16)}`;
                return (
                  <tr
                    key={i}
                    onClick={() => setSelected(e === selected ? null : e)}
                    className={`border-b border-white/[0.04] last:border-0 cursor-pointer hover:bg-white/[0.03] ${selected === e ? 'bg-accent/10' : ''}`}
                  >
                    <td className="py-1 text-right font-mono text-gray-400 pl-2">{fmtTime(e.elapsed)}</td>
                    <td className="py-1 pl-3 text-gray-200">{jobName(e.jobId)}</td>
                    <td className="py-1 text-gray-400">{e.isSubJob ? 'sub' : 'main'}</td>
                    <td className="py-1 text-gray-300 truncate max-w-md">{detail || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {decoded && selected?.rawHex && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">Raw Data (hex, 154 bytes)</div>
            <div className="font-mono text-[10px] text-gray-400 break-all">{selected.rawHex}</div>
          </div>
        )}
      </div>
    </div>
  );
}
