'use client';

import { useMemo, useState } from 'react';
import type { ActionLogEntry } from '@/lib/types';
import { buildDeathReports, type DeathEvent, type DeathReportRow } from '@/lib/deaths';

type DeathLike = { player?: string; elapsed?: number; area?: string };
type HpLike = { player: string; elapsed: number; hpp: number };

const fmtClock = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

function EventRow({ ev, deathAt }: { ev: DeathEvent; deathAt: number }) {
  const before = deathAt - ev.elapsed; // seconds before death
  const rel = ev.kind === 'death' ? 'death' : before > 0 ? `−${before}s` : 'now';

  if (ev.kind === 'death') {
    return (
      <div className="flex items-center gap-2 py-1">
        <span className="w-12 shrink-0 text-right font-mono text-[10px] text-rose-400">{fmtClock(ev.elapsed)}</span>
        <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
        <span className="text-rose-300 font-semibold text-xs">Defeated</span>
      </div>
    );
  }
  if (ev.kind === 'hp') {
    const c = ev.hpp! <= 25 ? 'text-rose-300' : ev.hpp! <= 50 ? 'text-amber-300' : 'text-emerald-300';
    return (
      <div className="flex items-center gap-2 py-0.5">
        <span className="w-12 shrink-0 text-right font-mono text-[10px] text-gray-400">{rel}</span>
        <span className="w-2 h-2 rounded-full bg-white/15 shrink-0" />
        <span className="text-[11px] text-gray-400">HP</span>
        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden max-w-[120px]">
          <div className="h-full rounded-full" style={{ width: `${ev.hpp}%`, background: ev.hpp! <= 25 ? '#fb7185' : ev.hpp! <= 50 ? '#fbbf24' : '#34d399' }} />
        </div>
        <span className={`font-mono text-[11px] ${c}`}>{ev.hpp}%</span>
      </div>
    );
  }
  const incoming = ev.kind === 'incoming';
  return (
    <div className={`flex items-center gap-2 py-0.5 ${ev.fatal ? 'bg-rose-500/10 -mx-1 px-1 rounded' : ''}`}>
      <span className="w-12 shrink-0 text-right font-mono text-[10px] text-gray-400">{rel}</span>
      <span className={`w-2 h-2 rounded-full shrink-0 ${incoming ? 'bg-rose-500/70' : 'bg-sky-500/50'}`} />
      <span className={`text-xs truncate ${incoming ? 'text-gray-200' : 'text-gray-400'}`}>
        {incoming
          ? <><span className="text-rose-300/90">{ev.actor}</span> {ev.action}</>
          : <>You used <span className="text-sky-300/80">{ev.action}</span></>}
      </span>
      {incoming && (ev.damage ?? 0) > 0 && (
        <span className={`ml-auto font-mono text-xs shrink-0 ${ev.fatal ? 'text-rose-300 font-bold' : 'text-rose-400/80'}`}>−{ev.damage!.toLocaleString()}</span>
      )}
      {incoming && (ev.damage ?? 0) === 0 && ev.result === 'miss' && (
        <span className="ml-auto text-[10px] text-gray-400 shrink-0">miss</span>
      )}
    </div>
  );
}

function DeathCard({ r }: { r: DeathReportRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-rose-700/30 rounded-lg overflow-hidden bg-rose-950/10">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03]">
        <span className="text-rose-400">💀</span>
        <span className="font-semibold text-sm text-gray-100">{r.player}</span>
        <span className="font-mono text-[11px] text-gray-400">{fmtClock(r.elapsed)}</span>
        <span className="text-xs text-gray-400 truncate">
          {r.killedBy
            ? <>- {r.killingBlow} from <span className="text-rose-300/90">{r.killedBy}</span>{r.killingDamage ? <span className="text-rose-400/80 font-mono"> ({r.killingDamage.toLocaleString()})</span> : null}</>
            : '- cause unknown (DoT or untracked)'}
        </span>
        <span className="ml-auto text-gray-400 text-xs shrink-0">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-3 pb-2 pt-1 border-t border-white/5">
          {r.leadupDamage > 0 && (
            <div className="mb-2 pb-2 border-b border-white/5 text-xs flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-gray-400 uppercase tracking-wide text-[10px]">Last 20s</span>
              <span className="font-mono text-rose-300">{r.leadupDamage.toLocaleString()} dmg</span>
              <span className="font-mono text-gray-400">{r.leadupHits} hits</span>
              {r.leadupBySource.slice(0, 3).map(s => (
                <span key={s.actor} className="font-mono text-[11px] text-gray-400">
                  <span className="text-rose-300/80">{s.actor}</span> {s.damage.toLocaleString()}
                </span>
              ))}
            </div>
          )}
          {r.events.length <= 1 ? (
            <p className="text-[11px] text-gray-400 py-2">No lead-up actions were recorded for this death.</p>
          ) : (
            <div className="space-y-0">{r.events.map((ev, i) => <EventRow key={i} ev={ev} deathAt={r.elapsed} />)}</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DeathReport({ deathLog, actionLog, partyHpLog, title = 'Deaths' }: {
  deathLog?: DeathLike[] | null;
  actionLog?: ActionLogEntry[] | null;
  partyHpLog?: HpLike[] | null;
  title?: string;
}) {
  const reports = useMemo(() => buildDeathReports(deathLog, actionLog, partyHpLog), [deathLog, actionLog, partyHpLog]);
  if (reports.length === 0) return null;
  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-1">{title} <span className="text-gray-400 font-mono">{reports.length}</span></h3>
      <p className="text-[11px] text-gray-400 mb-3">Each death shows the killing blow; expand for the lead-up and HP descent.</p>
      <div className="space-y-2">
        {reports.map((r, i) => <DeathCard key={i} r={r} />)}
      </div>
    </div>
  );
}
