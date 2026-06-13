'use client';

import React, { useMemo, useState } from 'react';
import ItemIcon from '@/components/ItemIcon';
import type { CharacterGear } from '@/lib/types';
import type { ProgressionEvent, ProgressionSnapshot, CurrencySnapshot, KeyItemEvent } from '@/lib/encounter';

export type GainsDrop = {
  name: string;
  elapsed: number;
  itemId?: number;
  count?: number;
  source?: string;
  by?: string;
  type?: string;
};

const nf = (n: number) => n.toLocaleString();
const ratePerHour = (total: number, durationSec: number) =>
  durationSec > 0 ? Math.round((total / durationSec) * 3600) : 0;
function mmss(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

const JOB_BY_ID: Record<number, string> = {
  0: 'NON', 1: 'WAR', 2: 'MNK', 3: 'WHM', 4: 'BLM', 5: 'RDM', 6: 'THF', 7: 'PLD',
  8: 'DRK', 9: 'BST', 10: 'BRD', 11: 'RNG', 12: 'SAM', 13: 'NIN', 14: 'DRG',
  15: 'SMN', 16: 'BLU', 17: 'COR', 18: 'PUP', 19: 'DNC', 20: 'SCH', 21: 'GEO', 22: 'RUN',
};
const jobName = (id?: number) => (id != null && JOB_BY_ID[id]) ? JOB_BY_ID[id] : null;

function KpiSegment({ label, value, tone = 'text-gray-100', sub }: { label: string; value: string | number; tone?: string; sub?: string }) {
  return (
    <div className="p-4">
      <p className="text-[11px] text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 font-mono mt-0.5">{sub}</p>}
    </div>
  );
}

export type GainsPanelProps = {
  points?: { xp: number; cp: number; ep: number; lp: number } | null;
  durationSeconds: number;
  localCharacter?: string | null;
  progressionLog?: ProgressionEvent[] | null;
  progressionStart?: ProgressionSnapshot | null;
  progressionEnd?: ProgressionSnapshot | null;
  currencyStart?: CurrencySnapshot | null;
  currencyEnd?: CurrencySnapshot | null;
  gearByPlayer?: Record<string, CharacterGear> | null;
  dropLog?: GainsDrop[] | null;
  keyItemLog?: KeyItemEvent[] | null;
};

export default function GainsPanel({
  points,
  durationSeconds,
  localCharacter = null,
  progressionLog,
  progressionStart,
  progressionEnd,
  currencyStart,
  currencyEnd,
  gearByPlayer,
  dropLog,
  keyItemLog,
}: GainsPanelProps) {
  const [gainsTab, setGainsTab] = useState<'experience' | 'loot' | 'currency'>('experience');
  const [expTab, setExpTab] = useState<'experience' | 'capacity' | 'exemplar'>('experience');
  const [lootBySource, setLootBySource] = useState(false);
  const dur = durationSeconds;

  const progression = useMemo(() => {
    type Totals = { xp: number; cp: number; lp: number; ep: number };
    const emptyTotals = (): Totals => ({ xp: 0, cp: 0, lp: 0, ep: 0 });
    const sumLog = (log: { kind: 'xp' | 'cp' | 'lp' | 'ep'; value: number }[] | null | undefined) => {
      const t = emptyTotals();
      for (const e of log ?? []) t[e.kind] = (t[e.kind] ?? 0) + e.value;
      return t;
    };
    const perChar: { name: string; totals: Totals; start?: ProgressionSnapshot | null; end?: ProgressionSnapshot | null }[] = [];
    const seen = new Set<string>();
    if (gearByPlayer) {
      for (const [name, g] of Object.entries(gearByPlayer)) {
        const totals = sumLog(g.progressionLog);
        const hasAny = totals.xp + totals.cp + totals.lp + totals.ep > 0 || !!g.progressionStart || !!g.progressionEnd;
        if (!hasAny) continue;
        perChar.push({ name, totals, start: g.progressionStart, end: g.progressionEnd });
        seen.add(name);
      }
    }
    if (localCharacter && !seen.has(localCharacter)) {
      const totals = sumLog(progressionLog);
      const hasAny = totals.xp + totals.cp + totals.lp + totals.ep > 0 || !!progressionStart || !!progressionEnd;
      if (hasAny) perChar.push({ name: localCharacter, totals, start: progressionStart, end: progressionEnd });
    } else if (!localCharacter && perChar.length === 0) {
      const totals = sumLog(progressionLog);
      const hasAny = totals.xp + totals.cp + totals.lp + totals.ep > 0 || !!progressionStart || !!progressionEnd;
      if (hasAny) perChar.push({ name: '', totals, start: progressionStart, end: progressionEnd });
    }
    const grand = emptyTotals();
    for (const c of perChar) {
      grand.xp += c.totals.xp; grand.cp += c.totals.cp; grand.lp += c.totals.lp; grand.ep += c.totals.ep;
    }
    return { perChar, grand, has: perChar.length > 0 };
  }, [progressionLog, progressionStart, progressionEnd, gearByPlayer, localCharacter]);

  const currency = useMemo(() => {
    const deltaFor = (start?: CurrencySnapshot | null, end?: CurrencySnapshot | null) => {
      const out: Record<string, number> = {};
      if (!start || !end) return out;
      const keys = new Set<string>([...Object.keys(start), ...Object.keys(end)]);
      for (const k of keys) {
        const d = (end[k] ?? 0) - (start[k] ?? 0);
        if (d > 0) out[k] = d;
      }
      return out;
    };
    const perChar: { name: string; deltas: Record<string, number>; hasSnapshots: boolean }[] = [];
    const seen = new Set<string>();
    if (gearByPlayer) {
      for (const [name, g] of Object.entries(gearByPlayer)) {
        const hasSnapshots = !!(g.currencyStart && g.currencyEnd);
        const deltas = deltaFor(g.currencyStart, g.currencyEnd);
        if (hasSnapshots || Object.keys(deltas).length > 0) {
          perChar.push({ name, deltas, hasSnapshots });
          seen.add(name);
        }
      }
    }
    const localHas = !!(currencyStart && currencyEnd);
    if (localCharacter && !seen.has(localCharacter) && localHas) {
      perChar.push({ name: localCharacter, deltas: deltaFor(currencyStart, currencyEnd), hasSnapshots: true });
    } else if (!localCharacter && perChar.length === 0 && localHas) {
      perChar.push({ name: '', deltas: deltaFor(currencyStart, currencyEnd), hasSnapshots: true });
    }
    const activeCurrencies = new Set<string>();
    for (const c of perChar) for (const k of Object.keys(c.deltas)) activeCurrencies.add(k);
    const partyTotals: Record<string, number> = {};
    for (const c of perChar) for (const [k, v] of Object.entries(c.deltas)) partyTotals[k] = (partyTotals[k] ?? 0) + v;
    const sortedCurrencies = [...activeCurrencies].sort((a, b) =>
      (partyTotals[b] ?? 0) - (partyTotals[a] ?? 0) || a.localeCompare(b));
    return { perChar, sortedCurrencies, partyTotals, hasAnyData: perChar.length > 0, hasAnyDelta: sortedCurrencies.length > 0 };
  }, [currencyStart, currencyEnd, gearByPlayer, localCharacter]);

  const groupedLoot = useMemo(() => {
    type Group = { itemId?: number; name: string; type?: string; count: number; source?: string; sources: Set<string>; looters: Map<string, number> };
    const m = new Map<string, Group>();
    for (const d of dropLog ?? []) {
      const key = lootBySource
        ? `${d.itemId ?? ''}|${d.name}|${d.type ?? ''}|${d.source ?? ''}`
        : `${d.itemId ?? ''}|${d.name}|${d.type ?? ''}`;
      const add = d.count && d.count > 1 ? d.count : 1;
      const cur = m.get(key);
      if (cur) {
        cur.count += add;
        if (d.source) cur.sources.add(d.source);
        if (d.by) cur.looters.set(d.by, (cur.looters.get(d.by) ?? 0) + add);
      } else {
        const g: Group = { itemId: d.itemId, name: d.name, type: d.type, count: add, source: d.source, sources: new Set(), looters: new Map() };
        if (d.source) g.sources.add(d.source);
        if (d.by) g.looters.set(d.by, add);
        m.set(key, g);
      }
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [dropLog, lootBySource]);

  type Kind = 'xp' | 'cp' | 'lp' | 'ep';
  const SUB_META = {
    experience: { label: 'Experience & Limit', kinds: [
      { key: 'xp' as Kind, col: 'Experience Point', tone: 'text-amber-300' },
      { key: 'lp' as Kind, col: 'Limit Point',      tone: 'text-emerald-300' },
    ] },
    capacity:   { label: 'Capacity', kinds: [
      { key: 'cp' as Kind, col: 'Job Point', tone: 'text-violet-300' },
    ] },
    exemplar:   { label: 'Exemplar', kinds: [
      { key: 'ep' as Kind, col: 'Exemplar Point', tone: 'text-sky-300' },
    ] },
  } as const;
  const SUB_ORDER: ('experience' | 'capacity' | 'exemplar')[] = ['experience', 'capacity', 'exemplar'];
  const subTotal = (k: typeof SUB_META[keyof typeof SUB_META]) =>
    k.kinds.reduce((s, kk) => s + progression.grand[kk.key], 0);
  const subMeta = SUB_META[expTab];
  const subKinds = subMeta.kinds.filter(k => progression.grand[k.key] > 0);
  const subHasData = subTotal(subMeta) > 0;
  const charLabel = (c: { name: string; end?: ProgressionSnapshot | null; start?: ProgressionSnapshot | null }) => {
    const end = c.end, start = c.start;
    const endJob = jobName(end?.mainJob);
    const endLvl = end?.mainJobLevel;
    const sub = end?.subJob != null ? `/${jobName(end.subJob) ?? ''}${end?.subJobLevel ?? ''}` : '';
    const job = endJob ? `${endJob}${endLvl ?? ''}${sub}` : null;
    const leveledUp = start && end && start.mainJob === end.mainJob && start.mainJobLevel != null && end.mainJobLevel != null && end.mainJobLevel > start.mainJobLevel;
    return { job, leveledUp, delta: leveledUp ? (end!.mainJobLevel! - start!.mainJobLevel!) : 0 };
  };
  const multi = progression.perChar.length > 1;
  const MASTER: { id: 'experience' | 'loot' | 'currency'; label: string }[] = [
    { id: 'experience', label: 'Experience' },
    { id: 'loot',       label: 'Loot'       },
    { id: 'currency',   label: 'Currency'   },
  ];

  return (
    <div className="bg-row-even border border-white/10 rounded-xl overflow-hidden">
      <div className="flex border-b border-white/[0.08]">
        {MASTER.map(m => {
          const on = m.id === gainsTab;
          return (
            <button
              key={m.id}
              onClick={() => setGainsTab(m.id)}
              className={`relative flex-1 px-3 py-3 text-sm font-semibold uppercase tracking-wide transition-colors ${
                on ? 'text-accent bg-white/[0.03]' : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.02]'
              }`}
            >
              {m.label}
              {on && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" />}
            </button>
          );
        })}
      </div>

      {gainsTab === 'experience' && (
        <div>
          {!progression.has ? (
            <p className="text-gray-400 text-sm py-8 text-center px-5">No experience, capacity, or exemplar points recorded this encounter.</p>
          ) : (
            <>
              {points && (points.xp > 0 || points.cp > 0 || points.ep > 0 || points.lp > 0) && (
                <div className="px-5 pt-4 pb-3">
                  <div className="bg-black/20 border border-white/[0.06] rounded-xl grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-white/[0.06] overflow-hidden">
                    <KpiSegment label="EXP / HR" value={nf(ratePerHour(points.xp, dur))} tone="text-emerald-300" sub={`${nf(points.xp)} total`} />
                    <KpiSegment label="CP / HR"  value={nf(ratePerHour(points.cp, dur))} tone="text-sky-300"     sub={`${nf(points.cp)} total`} />
                    <KpiSegment label="EP / HR"  value={nf(ratePerHour(points.ep, dur))} tone="text-violet-300"  sub={`${nf(points.ep)} total`} />
                    <KpiSegment label="LP / HR"  value={nf(ratePerHour(points.lp, dur))} tone="text-amber-300"   sub={`${nf(points.lp)} total`} />
                  </div>
                </div>
              )}
              <div className="px-5 py-3 border-b border-white/[0.06]">
                <div className="flex bg-black/20 rounded-lg p-1 gap-1">
                  {SUB_ORDER.map(t => {
                    const on = t === expTab;
                    return (
                      <button
                        key={t}
                        onClick={() => setExpTab(t)}
                        className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                          on ? 'bg-white/[0.08] text-gray-100 shadow-sm' : 'text-gray-400 hover:text-gray-300 hover:bg-white/[0.03]'
                        }`}
                      >
                        {SUB_META[t].label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="px-5 pt-3 pb-4 overflow-x-auto">
                {!subHasData ? (
                  <p className="text-gray-400 text-sm py-6 text-center">No {subMeta.label.toLowerCase()} points recorded this encounter.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wide text-gray-400 border-b border-white/[0.06]">
                        <th className="text-left font-semibold py-2 pr-3">Character</th>
                        <th className="text-left font-semibold py-2 pr-3">Job</th>
                        {subKinds.map(k => (
                          <th key={k.key} className="text-right font-semibold py-2 px-3 whitespace-nowrap">{k.col}</th>
                        ))}
                        <th className="text-right font-semibold py-2 pl-3 whitespace-nowrap">Points/hr</th>
                      </tr>
                    </thead>
                    <tbody>
                      {progression.perChar.map(c => {
                        const { job, leveledUp, delta } = charLabel(c);
                        const charTabTotal = subKinds.reduce((s, k) => s + (c.totals[k.key] ?? 0), 0);
                        return (
                          <tr key={c.name} className="border-b border-white/[0.04] last:border-0">
                            <td className="py-1.5 pr-3 text-gray-200 font-medium">{c.name}</td>
                            <td className="py-1.5 pr-3 text-[11px] text-gray-400 font-mono whitespace-nowrap">
                              {job ?? <span className="text-gray-700">-</span>}
                              {leveledUp && <span className="ml-2 text-emerald-300">+{delta} lvl</span>}
                            </td>
                            {subKinds.map(k => {
                              const v = c.totals[k.key];
                              return (
                                <td key={k.key} className={`py-1.5 px-3 text-right font-mono ${v > 0 ? k.tone : 'text-gray-700'}`}>
                                  {v > 0 ? nf(v) : '-'}
                                </td>
                              );
                            })}
                            <td className="py-1.5 pl-3 text-right font-mono text-gray-400 text-xs">
                              {charTabTotal > 0 ? nf(ratePerHour(charTabTotal, dur)) : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {multi && (
                      <tfoot className="border-t border-white/[0.08]">
                        <tr>
                          <td className="pt-2 pr-3 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Party Total</td>
                          <td />
                          {subKinds.map(k => (
                            <td key={k.key} className={`pt-2 px-3 text-right font-mono font-semibold ${k.tone}`}>
                              {nf(progression.grand[k.key])}
                            </td>
                          ))}
                          <td className="pt-2 pl-3 text-right font-mono font-semibold text-gray-200">
                            {nf(ratePerHour(subTotal(subMeta), dur))}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {gainsTab === 'loot' && (
        <div className="p-5">
          {(dropLog?.length ?? 0) > 0 && (
            <div className="flex justify-end mb-3">
              <div className="flex rounded-md border border-white/15 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setLootBySource(false)}
                  className={`px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors ${
                    !lootBySource ? 'bg-accent/15 text-accent' : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'
                  }`}
                >
                  By Item
                </button>
                <button
                  type="button"
                  onClick={() => setLootBySource(true)}
                  className={`px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors border-l border-white/15 ${
                    lootBySource ? 'bg-accent/15 text-accent' : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'
                  }`}
                >
                  By Item + Source
                </button>
              </div>
            </div>
          )}
          {groupedLoot.length > 0 ? (
            <div className="space-y-1">
              {groupedLoot.map((g, i) => {
                const looters = [...g.looters.entries()].sort((a, b) => b[1] - a[1]);
                return (
                  <div key={`${g.name}-${i}`} className="flex items-center gap-x-2 gap-y-0.5 flex-wrap text-sm py-1">
                    <ItemIcon id={g.itemId} name={g.name} size={18} nameClass="text-lime-200" />
                    {g.count > 1 && <span className="text-gray-300 text-xs font-mono shrink-0">×{g.count}</span>}
                    {g.type === 'temporary' && <span className="text-gray-400 text-[10px] shrink-0">(temp)</span>}
                    {g.type === 'direct' && <span className="text-gray-400 text-[10px] shrink-0">(direct)</span>}
                    {g.sources.size > 0 && (
                      <span className="text-[11px] text-gray-400 shrink-0">
                        from <span className="text-gray-400">
                          {g.sources.size === 1 ? [...g.sources][0] : `${g.sources.size} sources`}
                        </span>
                      </span>
                    )}
                    {looters.length > 0 && (
                      <span className="text-[11px] text-gray-400 ml-auto shrink-0">
                        to {looters.map(([name, n]) => (
                          <span key={name} className="font-mono">
                            <span className="text-gray-400">{name}</span>{n > 1 ? <> ×{n}</> : null}
                          </span>
                        )).reduce<React.ReactNode[]>((acc, el, idx) => idx === 0 ? [el] : [...acc, ', ', el], [])}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-400 text-sm py-6 text-center">None found.</p>
          )}
          {(keyItemLog?.length ?? 0) > 0 && (() => {
            const items = keyItemLog!;
            const seen = new Set<number>();
            const unique = items.filter(k => seen.has(k.kiId) ? false : (seen.add(k.kiId), true));
            return (
              <div className="mt-4 pt-4 border-t border-white/[0.06]">
                <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Key Items <span className="text-gray-400 font-mono">{unique.length}</span>
                </h4>
                <div className="space-y-1">
                  {unique.map(k => (
                    <div key={k.kiId} className="flex items-center gap-x-2 gap-y-0.5 flex-wrap text-sm py-1">
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-sky-500/15 text-sky-300 border-sky-500/30 shrink-0">KI</span>
                      <span className="text-sky-200 truncate">{k.kiName}</span>
                      <span className="text-[11px] text-gray-400 font-mono ml-auto shrink-0">{mmss(k.elapsed)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {gainsTab === 'currency' && (
        <div className="p-5">
          {!currency.hasAnyData ? (
            <p className="text-[11px] text-gray-400 py-6 text-center">
              Currency tracking not enabled when this encounter was recorded. Enable <span className="text-gray-300">Track Currency Gains</span> in Settings → Behavior.
            </p>
          ) : !currency.hasAnyDelta ? (
            <p className="text-gray-400 text-sm py-6 text-center">No currency gains during this encounter.</p>
          ) : (
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-gray-400 border-b border-white/[0.06]">
                    <th className="text-left font-semibold py-2 pr-3 whitespace-nowrap">Currency</th>
                    {currency.perChar.map(c => (
                      <th key={c.name} className="text-right font-semibold py-2 px-3 whitespace-nowrap">{c.name}</th>
                    ))}
                    {currency.perChar.length > 1 && (
                      <th className="text-right font-semibold py-2 pl-3 whitespace-nowrap text-gray-400">Party Total</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {currency.sortedCurrencies.map(cur => (
                    <tr key={cur} className="border-b border-white/[0.04] last:border-0">
                      <td className="py-1.5 pr-3 text-gray-200 font-medium whitespace-nowrap">{cur}</td>
                      {currency.perChar.map(c => {
                        const v = c.deltas[cur] ?? 0;
                        return (
                          <td key={c.name} className={`py-1.5 px-3 text-right font-mono ${v > 0 ? 'text-amber-300' : 'text-gray-700'}`}>
                            {v > 0 ? `+${nf(v)}` : '-'}
                          </td>
                        );
                      })}
                      {currency.perChar.length > 1 && (
                        <td className="py-1.5 pl-3 text-right font-mono font-semibold text-amber-200">
                          +{nf(currency.partyTotals[cur] ?? 0)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
