import { useMemo, type ReactNode } from 'react';
import type { EncounterMetrics, PlayerMetric } from '@/lib/combatStats';
import { useSummariesRecord } from './summaryStore';
import { kindFromName } from './content';
import { JOB_FULL_NAMES } from '@/lib/anonymize';

export interface LibEntry {
  path: string;
  ts: number;
  zone: string | null;
  source: string | null;
  dur: number;
  enemies: number;
  enemyNames: string[];
  metrics: EncounterMetrics;
}

export type MetricKey = 'dps' | 'totalDamage' | 'damagePct' | 'meleeAccPct' | 'critPct' | 'meleeAvg' | 'wsAvg' | 'rangedAccPct' | 'magicAccPct';

export const METRICS: { key: MetricKey; label: string; pct?: boolean }[] = [
  { key: 'dps', label: 'DPS' },
  { key: 'totalDamage', label: 'Total Damage' },
  { key: 'damagePct', label: 'Damage %', pct: true },
  { key: 'meleeAccPct', label: 'Melee Acc', pct: true },
  { key: 'critPct', label: 'Crit Rate', pct: true },
  { key: 'meleeAvg', label: 'Melee Avg' },
  { key: 'wsAvg', label: 'WS Avg' },
  { key: 'rangedAccPct', label: 'Ranged Acc', pct: true },
  { key: 'magicAccPct', label: 'Magic Acc', pct: true },
];

export const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const fmtDateTime = (ts: number) => new Date(ts * 1000).toLocaleString();
export function fmtDur(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export const pmValue = (pm: PlayerMetric | undefined, k: MetricKey): number | null => {
  if (!pm) return null;
  const v = pm[k];
  return typeof v === 'number' ? v : null;
};
export const fmtVal = (v: number | null, pct?: boolean) =>
  v == null ? '-' : pct ? `${v.toFixed(1)}%` : v.toLocaleString();

export const playersOf = (entries: LibEntry[]): string[] => {
  const count: Record<string, number> = {};
  for (const e of entries) for (const p of e.metrics.players) count[p.player] = (count[p.player] || 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1]).map(([n]) => n);
};

export const zonesOf = (entries: LibEntry[]): string[] => {
  const s = new Set<string>();
  for (const e of entries) if (e.zone) s.add(e.zone);
  return Array.from(s).sort();
};

export const enemiesOf = (entries: LibEntry[]): string[] => {
  const s = new Set<string>();
  for (const e of entries) for (const n of e.enemyNames) if (n) s.add(n);
  return Array.from(s).sort();
};

export function useLibEntries(paths: string[]): LibEntry[] {
  const encSummaries = useSummariesRecord();
  return useMemo(() => {
    const out: LibEntry[] = [];
    for (const p of paths) {
      if (kindFromName(p) !== 'encounter') continue;
      const s = encSummaries[p];
      if (!s) continue;
      out.push({ path: p, ts: s.ts, zone: s.zone, source: s.source, dur: s.dur, enemies: s.enemies, enemyNames: s.enemyNames, metrics: s.metrics });
    }
    return out;
  }, [paths, encSummaries]);
}

export function useAnonNameLabel(entries: LibEntry[], anon: boolean): (n: string) => string {
  return useMemo<(n: string) => string>(() => {
    if (!anon) return (n) => n;
    const votes: Record<string, Record<string, number>> = {};
    for (const e of entries) for (const p of e.metrics.players) {
      const j = p.job || '';
      (votes[p.player] ??= {})[j] = (votes[p.player][j] ?? 0) + 1;
    }
    const bestJob: Record<string, string> = {};
    for (const [name, v] of Object.entries(votes)) {
      bestJob[name] = Object.entries(v).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    }
    const names = Object.keys(bestJob).filter(n => bestJob[n] !== 'TRUST').sort();
    const labelFor = (n: string) => JOB_FULL_NAMES[bestJob[n]] ?? (bestJob[n] || 'Player');
    const total: Record<string, number> = {};
    for (const n of names) { const l = labelFor(n); total[l] = (total[l] ?? 0) + 1; }
    const map: Record<string, string> = {};
    const idx: Record<string, number> = {};
    for (const n of names) {
      const l = labelFor(n);
      if (total[l] > 1) { idx[l] = (idx[l] ?? 0) + 1; map[n] = `${l} ${idx[l]}`; }
      else map[n] = l;
    }
    return (n) => map[n] ?? n;
  }, [entries, anon]);
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{label}</span>
      {children}
    </label>
  );
}
