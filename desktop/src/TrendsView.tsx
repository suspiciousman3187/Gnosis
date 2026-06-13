import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { METRICS, fmtDate, fmtDateTime, fmtDur, pmValue, fmtVal, playersOf, zonesOf, enemiesOf, Field, useLibEntries, useAnonNameLabel, type MetricKey } from './trendsShared';

export type { LibEntry } from './trendsShared';

export default function TrendsView({ paths, anon, onOpen }: { paths: string[]; anon: boolean; onOpen: (path: string) => void }) {
  const entries = useLibEntries(paths);
  const nameLabel = useAnonNameLabel(entries, anon);
  const players = useMemo(() => playersOf(entries), [entries]);
  const zones = useMemo(() => zonesOf(entries), [entries]);

  const [player, setPlayer] = useState<string>('');
  const [job, setJob] = useState<string>('all');
  const [metric, setMetric] = useState<MetricKey>('dps');
  const [zone, setZone] = useState<string>('all');
  const [enemy, setEnemy] = useState<string>('all');
  const [range, setRange] = useState<string>('all');
  const [sortKey, setSortKey] = useState<'ts' | MetricKey>('ts');

  const activePlayer = player || players[0] || '';
  const metricDef = METRICS.find(m => m.key === metric)!;

  const jobs = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) { const j = e.metrics.players.find(p => p.player === activePlayer)?.job; if (j) s.add(j); }
    return Array.from(s).sort();
  }, [entries, activePlayer]);

  const enemies = useMemo(
    () => enemiesOf(entries.filter(e => e.metrics.players.some(p => p.player === activePlayer))),
    [entries, activePlayer],
  );

  const rows = useMemo(() => {
    const cutoff = range === 'all' ? 0 : Date.now() / 1000 - Number(range) * 86400;
    return entries
      .filter(e => (range === 'all' || e.ts >= cutoff))
      .filter(e => (zone === 'all' || e.zone === zone))
      .filter(e => (enemy === 'all' || e.enemyNames.includes(enemy)))
      .filter(e => (job === 'all' || (e.metrics.players.find(p => p.player === activePlayer)?.job ?? '') === job))
      .filter(e => e.metrics.players.some(p => p.player === activePlayer))
      .map(e => ({ e, pm: e.metrics.players.find(p => p.player === activePlayer) }))
      .sort((a, b) => {
        if (sortKey === 'ts') return b.e.ts - a.e.ts;
        return (pmValue(b.pm, sortKey) ?? -Infinity) - (pmValue(a.pm, sortKey) ?? -Infinity);
      });
  }, [entries, range, zone, enemy, job, activePlayer, sortKey]);

  const chartData = useMemo(() =>
    rows
      .slice()
      .sort((a, b) => a.e.ts - b.e.ts)
      .map(({ e, pm }) => ({ ts: e.ts, label: fmtDate(e.ts), value: pmValue(pm, metric), zone: e.zone }))
      .filter(d => d.value != null),
  [rows, metric]);

  if (entries.length === 0) {
    return <div className="text-gray-500 border border-dashed border-white/15 rounded-xl p-12 text-center mt-8">No encounters to analyze yet. Track some fights and they&apos;ll show up here.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="text-[11px] text-gray-500">{rows.length} encounters · {activePlayer ? nameLabel(activePlayer) : '-'}</div>

      <div className="bg-row-even border border-white/10 rounded-xl p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Field label="Player">
          <select value={activePlayer} onChange={e => { setPlayer(e.target.value); setEnemy('all'); setJob('all'); }} className="w-full bg-gray-800 border border-white/10 text-sm text-gray-200 rounded-lg px-2 py-1">
            {players.map(p => <option key={p} value={p}>{nameLabel(p)}</option>)}
          </select>
        </Field>
        <Field label="Job">
          <select value={job} onChange={e => setJob(e.target.value)} className="w-full bg-gray-800 border border-white/10 text-sm text-gray-200 rounded-lg px-2 py-1">
            <option value="all">All Jobs</option>
            {jobs.map(j => <option key={j} value={j}>{j}</option>)}
          </select>
        </Field>
        <Field label="Metric">
          <select value={metric} onChange={e => setMetric(e.target.value as MetricKey)} className="w-full bg-gray-800 border border-white/10 text-sm text-gray-200 rounded-lg px-2 py-1">
            {METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Zone">
          <select value={zone} onChange={e => setZone(e.target.value)} className="w-full bg-gray-800 border border-white/10 text-sm text-gray-200 rounded-lg px-2 py-1">
            <option value="all">All Zones</option>
            {zones.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </Field>
        <Field label="Enemy">
          <select value={enemy} onChange={e => setEnemy(e.target.value)} className="w-full bg-gray-800 border border-white/10 text-sm text-gray-200 rounded-lg px-2 py-1">
            <option value="all">All Enemies</option>
            {enemies.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Period">
          <select value={range} onChange={e => setRange(e.target.value)} className="w-full bg-gray-800 border border-white/10 text-sm text-gray-200 rounded-lg px-2 py-1">
            <option value="all">All Time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </Field>
      </div>

      <div className="bg-row-even border border-white/10 rounded-xl p-5">
        <div className="text-sm font-semibold uppercase tracking-wide text-gray-400 mb-3">{metricDef.label} over time</div>
        {chartData.length === 0 ? (
          <div className="text-gray-500 text-sm py-8 text-center">No data for {nameLabel(activePlayer)} with this metric.</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 5, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 11 }} stroke="rgba(255,255,255,0.15)" />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} stroke="rgba(255,255,255,0.15)" width={48}
                tickFormatter={(v: number) => metricDef.pct ? `${v}%` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`} />
              <Tooltip
                contentStyle={{ background: 'rgba(20,22,24,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#e5e7eb' }}
                formatter={(value) => [fmtVal(typeof value === 'number' ? value : Number(value ?? 0), metricDef.pct), metricDef.label]}
              />
              <Line type="monotone" dataKey="value" stroke="#f5b942" strokeWidth={2} dot={{ r: 3, fill: '#f5b942' }} activeDot={{ r: 5 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-row-even border border-white/10 rounded-xl p-5">
        <div className="text-sm font-semibold uppercase tracking-wide text-gray-400 mb-3">Encounters</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs text-left border-b border-white/10">
                <Th onClick={() => setSortKey('ts')} active={sortKey === 'ts'}>When</Th>
                <th className="pb-2">Zone</th>
                <th className="pb-2">Dur</th>
                <Th onClick={() => setSortKey('dps')} active={sortKey === 'dps'} right>DPS</Th>
                <Th onClick={() => setSortKey('totalDamage')} active={sortKey === 'totalDamage'} right>Damage</Th>
                <Th onClick={() => setSortKey('meleeAccPct')} active={sortKey === 'meleeAccPct'} right>Acc</Th>
                <Th onClick={() => setSortKey('critPct')} active={sortKey === 'critPct'} right>Crit</Th>
                <Th onClick={() => setSortKey('wsAvg')} active={sortKey === 'wsAvg'} right>WS Avg</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, pm }) => (
                <tr key={e.path} className="border-b border-white/[0.04] hover:bg-white/[0.02] cursor-pointer" onClick={() => onOpen(e.path)}>
                  <td className="py-1.5 text-gray-400" title={fmtDateTime(e.ts)}>{fmtDate(e.ts)}</td>
                  <td className="py-1.5 text-gray-300">{e.zone ?? '-'}</td>
                  <td className="py-1.5 text-gray-500 font-mono">{fmtDur(e.dur)}</td>
                  <td className="py-1.5 text-right font-mono text-amber-300">{fmtVal(pmValue(pm, 'dps'))}</td>
                  <td className="py-1.5 text-right font-mono text-gray-300">{fmtVal(pmValue(pm, 'totalDamage'))}</td>
                  <td className="py-1.5 text-right font-mono text-sky-300">{fmtVal(pmValue(pm, 'meleeAccPct'), true)}</td>
                  <td className="py-1.5 text-right font-mono text-sky-300">{fmtVal(pmValue(pm, 'critPct'), true)}</td>
                  <td className="py-1.5 text-right font-mono text-amber-400">{fmtVal(pmValue(pm, 'wsAvg'))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Th({ children, onClick, active, right }: { children: React.ReactNode; onClick: () => void; active: boolean; right?: boolean }) {
  return (
    <th className={`pb-2 cursor-pointer select-none hover:text-gray-300 ${right ? 'text-right' : ''} ${active ? 'text-accent' : ''}`} onClick={onClick}>
      {children}{active ? ' ↓' : ''}
    </th>
  );
}
