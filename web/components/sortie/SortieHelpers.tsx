'use client';

import type {
  NaakualSectorData,
  ActionLogEntry,
  KillLogEntry,
  ItemUseLogEntry,
  RunRecord,
  AreaTimes,
  ChestLogEntry,
} from '@/lib/types';
import { CHEST_INFO, SECTORS } from '@/lib/sortieData';
import { resolveChestId } from '@/lib/chestIds';

export const SORTIE_DURATION = 3600;

export const NAAKUAL_ORDER = ['Bztavian', 'Rockfin', 'Gabbrath', 'Waktza', 'Yggdreant', 'Cehuetzi'];

export function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function fmtSortieClock(elapsedSeconds: number) {
  const remaining = Math.max(0, SORTIE_DURATION - elapsedSeconds);
  const m = Math.floor(remaining / 60);
  const sec = Math.floor(remaining % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatAreaTime(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export function fmtFightTime(elapsedSeconds: number, fightStartElapsed: number | null | undefined) {
  const t = Math.max(0, elapsedSeconds - (fightStartElapsed ?? 0));
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function heatHsl(t: number) {
  const hue = Math.round(220 * Math.min(1, Math.max(0, t)));
  return `hsl(${hue} 75% 55%)`;
}

export const AREA_TIME_ROWS: { key: keyof AreaTimes; label: string; color: string }[] = [
  { key: 'groundFloor', label: 'Ground Floor',  color: 'bg-violet-700' },
  { key: 'sectorE',     label: 'Sector E',       color: 'bg-sky-600' },
  { key: 'sectorF',     label: 'Sector F',       color: 'bg-sky-600' },
  { key: 'sectorG',     label: 'Sector G',       color: 'bg-sky-600' },
  { key: 'sectorH',     label: 'Sector H',       color: 'bg-sky-600' },
  { key: 'bossA',       label: 'Boss Room A',    color: 'bg-amber-600' },
  { key: 'bossB',       label: 'Boss Room B',    color: 'bg-amber-600' },
  { key: 'bossC',       label: 'Boss Room C',    color: 'bg-amber-600' },
  { key: 'bossD',       label: 'Boss Room D',    color: 'bg-amber-600' },
  { key: 'bossE',       label: 'Boss Room E',    color: 'bg-amber-600' },
  { key: 'bossF',       label: 'Boss Room F',    color: 'bg-amber-600' },
  { key: 'bossG',       label: 'Boss Room G',    color: 'bg-amber-600' },
  { key: 'bossH',       label: 'Boss Room H',    color: 'bg-amber-600' },
  { key: 'aminon',      label: 'Aminon',         color: 'bg-rose-500' },
];

export type ChestType = 'Chest' | 'Casket' | 'Coffer';
export const CHEST_TYPES: ChestType[] = ['Chest', 'Casket', 'Coffer'];
export const SECTOR_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export type SectorLetter = typeof SECTOR_LETTERS[number];
export type BucketKey = SectorLetter | 'AurumGround' | 'AurumBasement' | 'Other';

export const BUCKET_LABEL: Record<Exclude<BucketKey, SectorLetter>, string> = {
  AurumGround:   'Aurum (Ground)',
  AurumBasement: 'Aurum (Basement)',
  Other:         'Other',
};

export function resolveChestEntry(c: ChestLogEntry): { type: ChestType; bucket: BucketKey } | null {
  let type: ChestType | null = null;
  let name: string | null = null;
  if (c.npcId != null) {
    const r = resolveChestId(c.npcId);
    if (r) { type = r.type; name = r.name; }
  }
  if (!type && c.type && c.type !== 'Unknown') { type = c.type as ChestType; }
  if (!type) return null;

  if (name === 'Aurum Ground')   return { type, bucket: 'AurumGround' };
  if (name === 'Aurum Basement') return { type, bucket: 'AurumBasement' };

  const letter = name?.[0]?.toUpperCase();
  if (letter && (SECTOR_LETTERS as readonly string[]).includes(letter)) {
    return { type, bucket: letter as SectorLetter };
  }
  return { type, bucket: 'Other' };
}

export interface MobKillRow {
  mob: string;
  firstSeen: number | null;
  killedAt: number | null;
  lastHit: number | null;
  hits: number;
  misses: number;
  damage: number;
  confirmed: boolean;
}

export function buildMobKills(
  actionLog: ActionLogEntry[],
  killLog: KillLogEntry[] | null,
  matches: (name: string) => boolean,
): MobKillRow[] {
  type Acc = MobKillRow & { _id?: number; _name: string };
  const acc = new Map<string, Acc>();
  const keyFor = (mob: string, id?: number) => (id != null ? `${mob}#${id}` : mob);

  for (const entry of actionLog) {
    if (entry.from === 'boss') continue;
    const targets = entry.targets ?? (entry.mob ? [{ mob: entry.mob, damage: entry.damage ?? 0, result: entry.result ?? 'hit' }] : []);
    for (const t of targets) {
      if (!t.mob || !matches(t.mob)) continue;
      const key = keyFor(t.mob, t.id);
      let row = acc.get(key);
      if (!row) {
        row = { mob: t.mob, firstSeen: entry.elapsed, killedAt: null, lastHit: null, hits: 0, misses: 0, damage: 0, confirmed: false, _id: t.id, _name: t.mob };
        acc.set(key, row);
      }
      if (row.firstSeen == null || entry.elapsed < row.firstSeen) row.firstSeen = entry.elapsed;
      const isDamaging = t.result === 'hit' || t.result === 'land' || t.result === 'burst';
      if (isDamaging) {
        row.hits += 1;
        row.damage += t.damage ?? 0;
        if (row.lastHit == null || entry.elapsed > row.lastHit) row.lastHit = entry.elapsed;
      } else {
        row.misses += 1;
      }
    }
  }

  if (killLog) {
    for (const k of killLog) {
      if (!matches(k.name)) continue;
      const key = keyFor(k.name, k.id);
      let row = acc.get(key);
      if (!row) {
        row = { mob: k.name, firstSeen: null, killedAt: null, lastHit: null, hits: 0, misses: 0, damage: 0, confirmed: false, _id: k.id, _name: k.name };
        acc.set(key, row);
      }
      row.killedAt = k.elapsed;
      row.confirmed = true;
    }
  }

  const rows = Array.from(acc.values());
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r._name, (counts.get(r._name) ?? 0) + 1);
  const orderTime = (r: Acc) => r.firstSeen ?? r.killedAt ?? Number.POSITIVE_INFINITY;
  const ordered = [...rows].sort((a, b) => orderTime(a) - orderTime(b));
  const seq = new Map<string, number>();
  for (const r of ordered) {
    if ((counts.get(r._name) ?? 0) > 1) {
      const n = (seq.get(r._name) ?? 0) + 1;
      seq.set(r._name, n);
      r.mob = `${r._name} #${n}`;
    }
  }

  const killTimeOf = (r: { killedAt: number | null; lastHit: number | null }) =>
    r.killedAt ?? r.lastHit ?? Number.POSITIVE_INFINITY;
  return rows
    .map(({ _id, _name, ...row }) => row)
    .sort((a, b) => killTimeOf(a) - killTimeOf(b));
}

export function buildSectorMobKills(
  actionLog: ActionLogEntry[],
  killLog: KillLogEntry[] | null,
  prefix: string,
): MobKillRow[] {
  const lower = prefix.toLowerCase();
  return buildMobKills(actionLog, killLog, (n) => n.toLowerCase().startsWith(lower));
}

export type SectorDef = (typeof SECTORS)[number];

export function findKillElapsed(name: string, killLog: KillLogEntry[] | null, miniNmLog: { name: string; elapsed: number }[] | null): number | null {
  if (killLog) {
    for (const k of killLog) if (k.name === name) return k.elapsed;
  }
  if (miniNmLog) {
    for (const m of miniNmLog) if (m.name === name) return m.elapsed;
  }
  return null;
}

export function computeSectorGalli(
  sector: SectorDef,
  zoneLog: { area: string; elapsed: number; galli?: number }[] | null,
  finalGalli?: number,
): number {
  if (!zoneLog || zoneLog.length === 0) return 0;
  const areas = sector.floor === 'Basement'
    ? new Set([`Sector ${sector.id}`, `Boss ${sector.id}`])
    : new Set([`Boss ${sector.id}`]);
  const sorted = [...zoneLog].sort((a, b) => a.elapsed - b.elapsed);
  let total = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (!areas.has(sorted[i].area)) continue;
    const cur = sorted[i].galli;
    if (cur == null) continue;
    const nxt = sorted[i + 1]?.galli ?? (i === sorted.length - 1 ? finalGalli : undefined);
    if (nxt != null) total += Math.max(0, nxt - cur);
  }
  return total;
}

export function filterItemUseToSector(sector: SectorDef, itemUseLog: ItemUseLogEntry[] | null): ItemUseLogEntry[] {
  if (!itemUseLog) return [];
  const areas = sector.floor === 'Basement'
    ? new Set([`Sector ${sector.id}`, `Boss ${sector.id}`])
    : new Set([`Boss ${sector.id}`]);
  return itemUseLog.filter(u => areas.has(u.area));
}

export function computeSectorItems(sector: SectorDef, run: RunRecord): { name: string; count: number }[] {
  const areas = sector.floor === 'Basement'
    ? new Set([`Sector ${sector.id}`, `Boss ${sector.id}`])
    : new Set([`Boss ${sector.id}`]);
  const counts = new Map<string, number>();
  for (const d of run.drop_log ?? []) {
    if (d.type === 'temp' || d.type === 'temporary') continue;
    if (!areas.has(d.area)) continue;
    counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
  }
  for (const chestName of sector.chests) {
    if (run.treasure_chests?.chests.includes(chestName)) {
      const reward = CHEST_INFO[chestName]?.reward;
      if (reward && !counts.has(reward)) counts.set(reward, 1);
    }
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function StatusIcon({ done }: { done: boolean }) {
  return done ? (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="#22c55e" />
      <path d="M4.6 8.2 7 10.6 11.5 5.4" fill="none" stroke="#fff"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0 text-gray-400" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function NaakualSectorCard({ data, actionLog, killLog }: { data: NaakualSectorData; actionLog: ActionLogEntry[]; killLog: KillLogEntry[] | null }) {
  const done = NAAKUAL_ORDER.filter(n => data.kills[n] != null).length;
  const NAAKUAL_SET = new Set(NAAKUAL_ORDER);
  const byName = (() => {
    if (data.firstKill == null) return new Map<string, MobKillRow>();
    const lo = data.firstKill - 180;
    const hi = (data.lastKill ?? data.firstKill) + 5;
    const sa = actionLog.filter(e => e.elapsed >= lo && e.elapsed <= hi);
    const sk = (killLog ?? []).filter(k => k.elapsed >= lo && k.elapsed <= hi);
    return new Map(buildMobKills(sa, sk, n => NAAKUAL_SET.has(n)).map(r => [r.mob, r]));
  })();
  return (
    <section className="bg-row-even border border-white/10 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h4 className="font-bold text-2xl text-emerald-400 uppercase tracking-wide">Naakuals</h4>
        {data.completed && data.duration != null ? (
          <span className="text-xs bg-emerald-900/40 border border-emerald-700/40 text-emerald-400 rounded px-1.5 py-0.5">
            {formatDuration(data.duration)}
          </span>
        ) : (
          <span className="text-xs text-gray-400/70">{done}/6</span>
        )}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-400 text-xs border-b border-white/10">
            <th className="text-left pb-2">Naakual</th>
            <th className="text-right pb-2">First Seen</th>
            <th className="text-right pb-2">Killed</th>
            <th className="text-right pb-2">Kill Time</th>
            <th className="text-right pb-2">Damage Done</th>
          </tr>
        </thead>
        <tbody>
          {NAAKUAL_ORDER.map(name => {
            const row = byName.get(name);
            const firstSeen = row?.firstSeen ?? null;
            const killed = data.kills[name] ?? row?.killedAt ?? row?.lastHit ?? null;
            const killDuration = (firstSeen != null && killed != null && killed >= firstSeen)
              ? killed - firstSeen
              : null;
            return (
              <tr key={name} className="border-b border-white/[0.08]">
                <td className={`py-1.5 ${killed != null ? 'text-white' : 'text-gray-400'}`}>{name}</td>
                <td className="py-1.5 text-right font-mono text-xs text-gray-400">{firstSeen != null ? fmtSortieClock(firstSeen) : '-'}</td>
                <td className="py-1.5 text-right font-mono text-xs text-amber-400">{killed != null ? fmtSortieClock(killed) : '-'}</td>
                <td className="py-1.5 text-right font-mono text-xs text-gray-400">{killDuration != null ? formatDuration(killDuration) : '-'}</td>
                <td className="py-1.5 text-right text-green-400 font-medium">{row && row.damage > 0 ? row.damage.toLocaleString() : '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function ChestBadge({
  name, opened, color, objective, reward,
}: {
  name: string;
  opened: boolean;
  color: 'red' | 'blue' | 'purple';
  objective: string | undefined;
  reward?: string;
}) {
  const openedCls = 'bg-emerald-900/50 border-emerald-500/60 text-emerald-200 shadow-[0_0_8px_-2px] shadow-emerald-500/40';
  const offByColor = {
    red:    'bg-row-even border-white/10 text-gray-400',
    blue:   'bg-row-even border-white/10 text-gray-400',
    purple: 'bg-row-even border-white/10 text-gray-400',
  };
  const cls = opened ? openedCls : offByColor[color];
  return (
    <div className="relative group/badge">
      <span className={`border rounded-lg px-3 py-1.5 text-sm font-mono cursor-default select-none ${cls}`}>{name}</span>
      {objective && (
        <div className="absolute bottom-full left-0 mb-2 z-50 w-80 hidden group-hover/badge:block pointer-events-none">
          <div className="bg-panel-alt border border-white/[0.12] rounded-lg p-3 shadow-xl">
            {opened && <p className="text-green-400 text-xs mb-2">✓ Opened this run</p>}
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Objective</p>
            <p className="text-xs text-gray-100 leading-relaxed">{objective}</p>
            {reward && (
              <>
                <p className="text-xs text-gray-400 uppercase tracking-wide mt-2 mb-1">Item Reward</p>
                <p className="text-xs text-amber-300">{reward}</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function SectorMobTable({ rows, hasKillLog }: { rows: MobKillRow[]; hasKillLog: boolean }) {
  if (rows.length === 0) return null;
  return (
    <div className="border border-white/10 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h4 className="font-bold text-2xl text-red-400 uppercase tracking-wide">Mob Kills</h4>
        {!hasKillLog && (
          <span className="text-[10px] text-gray-400 italic">kill times inferred from last action (legacy run)</span>
        )}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-400 text-xs border-b border-white/10">
            <th className="text-left pb-2">Mob</th>
            <th className="text-right pb-2">First Seen</th>
            <th className="text-right pb-2">Killed</th>
            <th className="text-right pb-2">Kill Time</th>
            <th className="text-right pb-2">Damage Done</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const killTime = r.killedAt ?? r.lastHit;
            const killDuration = (r.firstSeen != null && killTime != null && killTime >= r.firstSeen)
              ? killTime - r.firstSeen
              : null;
            return (
              <tr key={r.mob} className="border-b border-white/[0.08]">
                <td className="py-2 text-white">{r.mob}</td>
                <td className="py-2 text-right text-gray-400 font-mono text-xs">{r.firstSeen != null ? fmtSortieClock(r.firstSeen) : '-'}</td>
                <td className={`py-2 text-right font-mono text-xs ${r.confirmed ? 'text-amber-400' : 'text-amber-400/60 italic'}`} title={r.confirmed ? 'Confirmed from packet data' : 'Inferred from last damaging action'}>
                  {killTime != null ? fmtSortieClock(killTime) : '-'}
                </td>
                <td className="py-2 text-right text-gray-400 font-mono text-xs">
                  {killDuration != null ? formatDuration(killDuration) : '-'}
                </td>
                <td className="py-2 text-right text-green-400 font-medium">{r.damage.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function StatRow({ label, value, valueClass = 'text-amber-400' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-white/[0.06] py-1.5">
      <span className="text-xs text-gray-400 uppercase tracking-wide">{label}</span>
      <span className={`font-mono text-sm ${valueClass}`}>{value}</span>
    </div>
  );
}

export function SectorSummaryPanel({ sector, run, sectorSeconds }: { sector: SectorDef; run: RunRecord; sectorSeconds: number }) {
  const bossKilledAt     = findKillElapsed(sector.boss, run.kill_log ?? null, run.mini_nm_log ?? null);
  const minibossKilledAt = findKillElapsed(sector.nm,   run.kill_log ?? null, run.mini_nm_log ?? null);
  const galli = computeSectorGalli(sector, run.zone_log ?? null, run.gallimaufry);
  const items = computeSectorItems(sector, run);
  const fmt = (n: number | null) => n != null ? fmtSortieClock(n) : '-';

  return (
    <div className="border border-white/10 rounded-xl p-4">
      <h4 className="font-semibold text-xs text-gray-400 uppercase tracking-wide mb-2">Sector Summary</h4>
      <div className="space-y-0">
        {sector.floor === 'Basement' && (
          <StatRow label="Total Time Spent" value={sectorSeconds > 0 ? formatDuration(sectorSeconds) : '-'} />
        )}
        <StatRow label={`${sector.boss} Killed @`}
                 value={fmt(bossKilledAt)}
                 valueClass={bossKilledAt != null ? 'text-emerald-400' : 'text-gray-400'} />
        <StatRow label={`${sector.nm} Killed @`}
                 value={fmt(minibossKilledAt)}
                 valueClass={minibossKilledAt != null ? 'text-emerald-400' : 'text-gray-400'} />
        <StatRow label="Gallimaufry Earned"
                 value={galli > 0 ? `+${galli.toLocaleString()}` : '-'}
                 valueClass={galli > 0 ? 'text-emerald-400' : 'text-gray-400'} />
        <div className="pt-2">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1.5">Items Obtained</div>
          {items.length === 0 ? (
            <div className="text-xs text-gray-400 italic">None recorded for this sector.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {items.map(({ name, count }) => (
                <span key={name} className="text-xs font-mono bg-panel-alt/60 border border-white/10 rounded px-2 py-0.5 text-emerald-300">
                  {name}{count > 1 ? ` ×${count}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SpawnedChests({ chestLog }: { chestLog: ChestLogEntry[] }) {
  const buckets: Record<BucketKey, Record<ChestType, number>> = {
    A: { Chest: 0, Casket: 0, Coffer: 0 },
    B: { Chest: 0, Casket: 0, Coffer: 0 },
    C: { Chest: 0, Casket: 0, Coffer: 0 },
    D: { Chest: 0, Casket: 0, Coffer: 0 },
    E: { Chest: 0, Casket: 0, Coffer: 0 },
    F: { Chest: 0, Casket: 0, Coffer: 0 },
    G: { Chest: 0, Casket: 0, Coffer: 0 },
    H: { Chest: 0, Casket: 0, Coffer: 0 },
    AurumGround:   { Chest: 0, Casket: 0, Coffer: 0 },
    AurumBasement: { Chest: 0, Casket: 0, Coffer: 0 },
    Other:         { Chest: 0, Casket: 0, Coffer: 0 },
  };

  for (const c of chestLog) {
    const r = resolveChestEntry(c);
    if (!r) continue;
    buckets[r.bucket][r.type] += 1;
  }

  const totals: Record<ChestType, number> = { Chest: 0, Casket: 0, Coffer: 0 };
  for (const key of Object.keys(buckets) as BucketKey[]) {
    for (const t of CHEST_TYPES) totals[t] += buckets[key][t];
  }
  const grandTotal = totals.Chest + totals.Casket + totals.Coffer;
  if (grandTotal === 0) return null;

  const sectorRows = [...SECTOR_LETTERS].filter(s =>
    CHEST_TYPES.some(t => buckets[s][t] > 0)
  );
  const showAurumGround   = CHEST_TYPES.some(t => buckets['AurumGround'][t] > 0);
  const showAurumBasement = CHEST_TYPES.some(t => buckets['AurumBasement'][t] > 0);
  const showOther         = CHEST_TYPES.some(t => buckets['Other'][t] > 0);

  const COL  = 'text-center font-mono';
  const HEAD = 'text-[10px] uppercase tracking-wide text-gray-400 font-semibold pb-2';

  const renderRow = (key: BucketKey, label: string, labelClass: string) => {
    const b = buckets[key];
    return (
      <tr key={key} className="border-b border-white/[0.06]">
        <td className={`py-1.5 ${labelClass}`}>{label}</td>
        <td className={`${COL} py-1.5 ${b.Chest  ? 'text-amber-300'  : 'text-gray-700'}`}>{b.Chest  || '-'}</td>
        <td className={`${COL} py-1.5 ${b.Casket ? 'text-sky-300'    : 'text-gray-700'}`}>{b.Casket || '-'}</td>
        <td className={`${COL} py-1.5 ${b.Coffer ? 'text-violet-300' : 'text-gray-700'}`}>{b.Coffer || '-'}</td>
      </tr>
    );
  };

  return (
    <section className="bg-row-even border border-white/10 rounded-xl p-5">
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="font-semibold text-sm text-gray-400 uppercase tracking-wide">Chests Spawned</h2>
        <span className="text-xs text-gray-400">total: {grandTotal}</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={`${HEAD} text-left`}>Sector</th>
            <th className={`${HEAD} text-center`}>Chests</th>
            <th className={`${HEAD} text-center`}>Caskets</th>
            <th className={`${HEAD} text-center`}>Coffers</th>
          </tr>
        </thead>
        <tbody>
          {sectorRows.map(s => renderRow(s, `Sector ${s}`, 'text-gray-100 font-medium'))}
          {showAurumGround   && renderRow('AurumGround',   BUCKET_LABEL.AurumGround,   'text-amber-200 font-medium')}
          {showAurumBasement && renderRow('AurumBasement', BUCKET_LABEL.AurumBasement, 'text-amber-200 font-medium')}
          {showOther         && renderRow('Other',         BUCKET_LABEL.Other,         'text-gray-400 italic')}
          <tr>
            <td className="pt-2 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Total</td>
            <td className={`${COL} pt-2 text-amber-400 font-bold`}>{totals.Chest}</td>
            <td className={`${COL} pt-2 text-sky-400 font-bold`}>{totals.Casket}</td>
            <td className={`${COL} pt-2 text-violet-400 font-bold`}>{totals.Coffer}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

export function TimeBreakdown({ areaTimes }: { areaTimes: AreaTimes }) {
  const rows = AREA_TIME_ROWS
    .filter((r) => areaTimes[r.key] > 0)
    .map((r) => ({ ...r, secs: areaTimes[r.key] }))
    .sort((a, b) => b.secs - a.secs);
  if (rows.length === 0) return null;

  const total = rows.reduce((sum, r) => sum + r.secs, 0);
  const lastIdx = Math.max(1, rows.length - 1);

  return (
    <section className="bg-row-even border border-white/10 rounded-xl p-5">
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="font-semibold text-sm text-gray-400 uppercase tracking-wide">Time Breakdown</h2>
        <span className="text-xs text-gray-400">tracked: {formatAreaTime(total)}</span>
      </div>
      <div className="space-y-2.5">
        {rows.map(({ key, label, secs }, i) => {
          const pct = Math.min((secs / SORTIE_DURATION) * 100, 100);
          const heat = heatHsl(i / lastIdx);
          return (
            <div key={key} className="flex items-center gap-3">
              <span className="text-sm text-gray-100 w-28 shrink-0">{label}</span>
              <div className="flex-1 h-2 bg-panel-alt rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: heat }} />
              </div>
              <span className="text-xs font-mono w-16 text-right" style={{ color: heat }}>{formatAreaTime(secs)}</span>
              <span className="text-xs text-gray-400 w-8 text-right">{Math.round(pct)}%</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
