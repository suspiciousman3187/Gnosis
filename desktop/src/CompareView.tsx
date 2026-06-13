import { useMemo, useState } from 'react';
import { METRICS, fmtDate, fmtDateTime, fmtDur, pmValue, fmtVal, playersOf, zonesOf, Field, useLibEntries, useAnonNameLabel } from './trendsShared';

export default function CompareView({ paths, anon, onOpen }: { paths: string[]; anon: boolean; onOpen: (path: string) => void }) {
  const entries = useLibEntries(paths);
  const nameLabel = useAnonNameLabel(entries, anon);
  const players = useMemo(() => playersOf(entries), [entries]);
  const zones = useMemo(() => zonesOf(entries), [entries]);

  const [player, setPlayer] = useState('');
  const [zone, setZone] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const activePlayer = player || players[0] || '';

  const rows = useMemo(() =>
    entries
      .filter(e => (zone === 'all' || e.zone === zone))
      .filter(e => e.metrics.players.some(p => p.player === activePlayer))
      .map(e => ({ e, pm: e.metrics.players.find(p => p.player === activePlayer) }))
      .sort((a, b) => b.e.ts - a.e.ts),
  [entries, zone, activePlayer]);

  const toggleSel = (path: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n; });

  const compareEntries = useMemo(() =>
    rows.filter(r => selected.has(r.e.path)).sort((a, b) => a.e.ts - b.e.ts),
  [rows, selected]);

  if (entries.length === 0) {
    return <div className="text-gray-500 border border-dashed border-white/15 rounded-xl p-12 text-center mt-8">No encounters to compare yet. Track some fights and they&apos;ll show up here.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="text-[11px] text-gray-500">Select two or more encounters to compare them side by side.</div>

      <div className="bg-row-even border border-white/10 rounded-xl p-4 flex flex-wrap items-end gap-4">
        <Field label="Player">
          <select value={activePlayer} onChange={e => { setPlayer(e.target.value); setSelected(new Set()); }} className="bg-gray-800 border border-white/10 text-sm text-gray-200 rounded-lg px-2 py-1">
            {players.map(p => <option key={p} value={p}>{nameLabel(p)}</option>)}
          </select>
        </Field>
        <Field label="Zone">
          <select value={zone} onChange={e => setZone(e.target.value)} className="bg-gray-800 border border-white/10 text-sm text-gray-200 rounded-lg px-2 py-1">
            <option value="all">All Zones</option>
            {zones.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </Field>
      </div>

      {compareEntries.length >= 2 ? (
        <div className="bg-row-even border border-white/10 rounded-xl p-5 overflow-x-auto">
          <div className="text-sm font-semibold uppercase tracking-wide text-gray-400 mb-3">Comparison · {nameLabel(activePlayer)}</div>
          <table className="text-sm min-w-full">
            <thead>
              <tr className="text-gray-500 text-xs text-left border-b border-white/10">
                <th className="pb-2 pr-4">Metric</th>
                {compareEntries.map(({ e }) => (
                  <th key={e.path} className="pb-2 px-3 whitespace-nowrap">{e.zone ?? 'Zone'}<div className="text-[10px] text-gray-600 font-normal">{fmtDate(e.ts)} · {fmtDur(e.dur)}</div></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map(m => {
                const vals = compareEntries.map(({ pm }) => pmValue(pm, m.key));
                const best = Math.max(...vals.filter((v): v is number => v != null));
                return (
                  <tr key={m.key} className="border-b border-white/[0.04]">
                    <td className="py-1.5 pr-4 text-gray-400">{m.label}</td>
                    {vals.map((v, i) => (
                      <td key={i} className={`py-1.5 px-3 font-mono ${v != null && v === best && vals.filter(x => x != null).length > 1 ? 'text-emerald-300 font-semibold' : 'text-gray-300'}`}>
                        {fmtVal(v, m.pct)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-row-even border border-white/10 rounded-xl p-8 text-center text-sm text-gray-500">
          Select {compareEntries.length === 1 ? 'one more encounter' : 'two or more encounters'} below to compare them.
        </div>
      )}

      <div className="bg-row-even border border-white/10 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold uppercase tracking-wide text-gray-400">Encounters</div>
          {selected.size > 0 && (
            <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:text-white">clear selection ({selected.size})</button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs text-left border-b border-white/10">
                <th className="pb-2 w-8"></th>
                <th className="pb-2">When</th>
                <th className="pb-2">Zone</th>
                <th className="pb-2">Dur</th>
                <th className="pb-2 text-right">DPS</th>
                <th className="pb-2 text-right">Damage</th>
                <th className="pb-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, pm }) => (
                <tr key={e.path} className={`border-b border-white/[0.04] cursor-pointer hover:bg-white/[0.02] ${selected.has(e.path) ? 'bg-accent/10' : ''}`} onClick={() => toggleSel(e.path)}>
                  <td className="py-1.5"><input type="checkbox" checked={selected.has(e.path)} onChange={() => toggleSel(e.path)} onClick={ev => ev.stopPropagation()} className="accent-accent" /></td>
                  <td className="py-1.5 text-gray-400" title={fmtDateTime(e.ts)}>{fmtDate(e.ts)}</td>
                  <td className="py-1.5 text-gray-300">{e.zone ?? '-'}</td>
                  <td className="py-1.5 text-gray-500 font-mono">{fmtDur(e.dur)}</td>
                  <td className="py-1.5 text-right font-mono text-amber-300">{fmtVal(pmValue(pm, 'dps'))}</td>
                  <td className="py-1.5 text-right font-mono text-gray-300">{fmtVal(pmValue(pm, 'totalDamage'))}</td>
                  <td className="py-1.5 text-right"><button onClick={ev => { ev.stopPropagation(); onOpen(e.path); }} title="Open report" className="text-gray-600 hover:text-accent">↗</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
