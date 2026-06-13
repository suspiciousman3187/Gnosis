'use client';

import { useState, useRef, type MouseEvent } from 'react';
import type { ZoneLogEntry, AreaTimes, DeathEntry, ChestLogEntry, MiniNmKill, DropLogEntry } from '@/lib/types';
import { resolveChestId } from '@/lib/chestIds';
import type { ChestIdEntry } from '@/lib/chestIds';

const BOSS_NAME: Record<string, string> = {
  'Boss A': 'Ghatjot',  'Boss B': 'Leshonn',
  'Boss C': 'Skomora',  'Boss D': 'Degei',
  'Boss E': 'Dhartok',  'Boss F': 'Gartell',
  'Boss G': 'Triboulex','Boss H': 'Aita',
};

// Full label for table rows
function fullLabel(area: string) {
  return BOSS_NAME[area] ? `${area} - ${BOSS_NAME[area]}` : area;
}


function segBg(area: string): string {
  if (area === 'Ground Floor') return 'bg-violet-700';
  if (area.startsWith('Sector '))  return 'bg-sky-700';
  if (area.startsWith('Boss '))    return 'bg-amber-600';
  if (area === 'Aminon')           return 'bg-red-700';
  return 'bg-violet-700';
}

// Swatch color for the custom tooltip (matches the segment bg families).
function segColor(area: string): string {
  if (area.startsWith('Sector ')) return '#0ea5e9'; // sky
  if (area.startsWith('Boss '))   return '#f59e0b'; // amber
  if (area === 'Aminon')          return '#ef4444'; // red
  return '#8b5cf6';                                  // violet (Ground Floor)
}

function rowBorder(area: string): string {
  if (area === 'Ground Floor') return 'border-violet-500';
  if (area.startsWith('Sector '))  return 'border-sky-600';
  if (area.startsWith('Boss '))    return 'border-amber-500';
  if (area === 'Aminon')           return 'border-red-500';
  return 'border-violet-500';
}

function fmtTimer(secs: number) {
  const clamped = Math.max(0, secs);
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDuration(secs: number) {
  if (secs <= 0) return '-';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return `${s}s`;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

const CHEST_COLOR: Record<string, string> = {
  Chest:   'text-red-400/70',
  Casket:  'text-sky-400/70',
  Coffer:  'text-gray-400/70',
  Unknown: 'text-yellow-500/60',
};

interface BossHpEntry {
  minHpPct?: number;
}

interface Props {
  zoneLog: ZoneLogEntry[];
  areaTimes: AreaTimes | null;
  deathLog: DeathEntry[] | null;
  chestLog: ChestLogEntry[] | null;
  miniNmLog: MiniNmKill[] | null;
  dropLog: DropLogEntry[] | null;
  finalGalli: number;
  bossHp?: Record<string, BossHpEntry> | null;
  isAdmin?: boolean;
}

function categoryOf(area: string): 'ground' | 'sector' | 'boss' | 'aminon' {
  if (area === 'Ground Floor') return 'ground';
  if (area.startsWith('Sector '))  return 'sector';
  if (area.startsWith('Boss '))    return 'boss';
  return 'aminon';
}

export default function RunJourney({ zoneLog, areaTimes, deathLog, chestLog, miniNmLog, dropLog, finalGalli, bossHp, isAdmin = false }: Props) {
  const sorted = [...zoneLog]
    .sort((a, b) => a.elapsed - b.elapsed)
    .filter((entry, i, arr) => {
      const prev = arr[i - 1];
      return !prev || prev.area !== entry.area || Math.abs(entry.elapsed - prev.elapsed) > 2;
    });
  const killedBossNames = new Set((miniNmLog ?? []).map(n => n.name));

  // Custom segmented-bar tooltip (matches the Journey map's tooltip UI)
  const barRef = useRef<HTMLDivElement | null>(null);
  const [barTip, setBarTip] = useState<
    { color: string; label: string; sub: string; left: number; top: number; boxW: number } | null
  >(null);
  const onSegHover = (color: string, label: string, sub: string, e: MouseEvent) => {
    const box = barRef.current?.getBoundingClientRect();
    if (!box) return;
    setBarTip({ color, label, sub, left: e.clientX - box.left, top: e.clientY - box.top, boxW: box.width });
  };

  const maxZoneGalli = Math.max(0, ...sorted.map(e => e.galli ?? 0));
  const effectiveFinalGalli = (finalGalli > 500_000 && maxZoneGalli > 0)
    ? maxZoneGalli
    : finalGalli;

  const totalSecs = areaTimes
    ? Object.values(areaTimes).reduce((a, b) => a + b, 0)
    : null;

  // Effective total for bar widths - fall back to a rough estimate if no areaTimes
  const effectiveTotal = totalSecs ??
    (sorted.length > 0 ? sorted[sorted.length - 1].elapsed + 300 : 3600);

  // Total seconds and galli per category and per sector
  const catTotals = { ground: 0, sector: 0, boss: 0, aminon: 0 };
  const catGalli  = { ground: 0, sector: 0, boss: 0, aminon: 0 };
  const sectorTotals: Record<string, number> = {};
  const sectorGalli:  Record<string, number> = {};
  sorted.forEach((entry, i) => {
    const nextElapsed = sorted[i + 1]?.elapsed ?? effectiveTotal;
    const duration = Math.max(0, nextElapsed - entry.elapsed);
    const cat = categoryOf(entry.area);
    catTotals[cat] += duration;
    // galli earned while in this area
    const isLast = i === sorted.length - 1;
    const nextGalli = isLast ? effectiveFinalGalli : sorted[i + 1]?.galli;
    const delta = (entry.galli !== undefined && nextGalli !== undefined)
      ? Math.max(0, nextGalli - entry.galli) : 0;
    catGalli[cat] += delta;
    if (entry.area.startsWith('Sector ')) {
      const letter = entry.area.slice(7);
      sectorTotals[letter] = (sectorTotals[letter] ?? 0) + duration;
      sectorGalli[letter]  = (sectorGalli[letter]  ?? 0) + delta;
    }
  });
  const hasBasement = catTotals.sector > 0;
  const visitedSectors = ['A','B','C','D','E','F','G','H'].filter(l => sectorTotals[l] > 0);

  return (
    <div className="space-y-6">

      {/* ── Shared panel: segmented bar + category totals ──────── */}
      <div className="bg-row-even border border-white/10 rounded-xl p-5 space-y-4">

      {/* ── Segmented progress bar ────────────────────────────── */}
      <div ref={barRef} className="relative">
        <div className="flex w-full h-6 rounded-md overflow-hidden gap-[2px] bg-black/30">
          {sorted.map((entry, i) => {
            const nextElapsed = sorted[i + 1]?.elapsed ?? effectiveTotal;
            const duration = Math.max(0, nextElapsed - entry.elapsed);
            const pct = (duration / effectiveTotal) * 100;
            const bg = segBg(entry.area);
            const label = fullLabel(entry.area);
            const sub = `${fmtTimer(3600 - entry.elapsed)} arrival time · ${fmtDuration(duration)} spent`;
            const color = segColor(entry.area);
            return (
              <div
                key={i}
                className={`${bg} flex-shrink-0 hover:brightness-125 transition-[filter] cursor-default`}
                style={{ width: `${pct}%` }}
                onMouseEnter={e => onSegHover(color, label, sub, e)}
                onMouseMove={e => onSegHover(color, label, sub, e)}
                onMouseLeave={() => setBarTip(null)}
              />
            );
          })}
        </div>
        {barTip && (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2"
            style={{
              left: Math.min(Math.max(barTip.left, 80), barTip.boxW - 80),
              top: barTip.top + 14,
            }}
          >
            <div className="w-0 h-0 mx-auto border-x-[6px] border-x-transparent border-b-[6px] border-b-black/90" />
            <div className="rounded-md bg-black/90 border border-white/15 px-3 py-2 shadow-lg whitespace-nowrap">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: barTip.color }} />
                <span className="text-sm text-white font-medium">{barTip.label}</span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5 pl-[18px]">{barTip.sub}</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Category totals ───────────────────────────────────── */}
      <div className="space-y-2">
        {/* Row 1: main categories */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([
            { label: 'Ground Floor', dot: 'bg-violet-600', secs: catTotals.ground, galli: catGalli.ground },
            { label: 'Basement',     dot: 'bg-sky-600',    secs: catTotals.sector, galli: catGalli.sector },
            { label: 'Bosses',       dot: 'bg-amber-500',  secs: catTotals.boss,   galli: catGalli.boss   },
            { label: 'Aminon',       dot: 'bg-red-600',    secs: catTotals.aminon, galli: catGalli.aminon },
          ]).map(({ label, dot, secs, galli }) => (
            <div key={label} className="border border-white/[0.08] rounded-lg px-3 py-2 flex items-center gap-2">
              <span className={`${dot} w-2.5 h-2.5 rounded-full flex-shrink-0`} />
              <div className="min-w-0">
                <p className="text-gray-400 text-xs leading-none mb-0.5">{label}</p>
                <p className="text-white font-mono text-sm font-semibold">
                  {secs > 0 ? fmtDuration(secs) : '-'}
                </p>
                {galli > 0 && (
                  <p className="text-amber-400/70 font-mono text-xs">+{galli.toLocaleString()}</p>
                )}
              </div>
            </div>
          ))}
        </div>
        {/* Row 2: per-sector breakdown (only if basement was visited) */}
        {hasBasement && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {visitedSectors.map((letter) => (
              <div key={letter} className="border border-sky-900/30 rounded-lg px-3 py-2 flex items-center gap-2">
                <span className="bg-sky-800 w-2.5 h-2.5 rounded-sm flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sky-400/50 text-xs leading-none mb-0.5">Sector {letter}</p>
                  <p className="text-white font-mono text-sm font-semibold">
                    {sectorTotals[letter] > 0 ? fmtDuration(sectorTotals[letter]) : '-'}
                  </p>
                  {sectorGalli[letter] > 0 && (
                    <p className="text-amber-400/70 font-mono text-xs">+{sectorGalli[letter].toLocaleString()}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>

      {/* ── Split-sheet table ─────────────────────────────────── */}
      <div className="rounded-xl overflow-hidden border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-panel-alt text-xs text-gray-400 uppercase tracking-wide">
              <th className="text-left px-4 py-2.5 font-semibold">Area</th>
              <th className="text-right px-4 py-2.5 font-semibold">Arrival</th>
              <th className="text-right px-4 py-2.5 font-semibold">Time Spent</th>
              <th className="text-right px-4 py-2.5 font-semibold border-l border-white/[0.07]">Gain</th>
              <th className="text-right px-4 py-2.5 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry, i) => {
              const nextElapsed = Math.min(sorted[i + 1]?.elapsed ?? totalSecs ?? entry.elapsed, 3600);
              const duration = nextElapsed - entry.elapsed;
              const timerRemaining = 3600 - entry.elapsed;
              const borderCls = rowBorder(entry.area);
              const isLast = i === sorted.length - 1;
              const nextGalli = isLast ? effectiveFinalGalli : sorted[i + 1]?.galli;
              const galliDelta = entry.galli !== undefined && nextGalli !== undefined
                ? nextGalli - entry.galli : null;
              const rowDeaths = deathLog?.filter(
                d => d.elapsed >= entry.elapsed && d.elapsed < nextElapsed
              ) ?? [];
              const rowChests = chestLog?.filter(
                c => c.elapsed >= entry.elapsed && c.elapsed < nextElapsed
              ) ?? [];
              const rowNms = miniNmLog?.filter(
                n => n.elapsed >= entry.elapsed && n.elapsed < nextElapsed
              ) ?? [];
              const rowDrops = dropLog?.filter(
                d => d.elapsed >= entry.elapsed && d.elapsed < nextElapsed
              ) ?? [];
              const bossName = entry.area === 'Aminon' ? 'Aminon' : (BOSS_NAME[entry.area] ?? null);
              const bossKilled = bossName ? rowNms.some(n => n.name === bossName) : false;
              const bossEverKilled = bossName ? killedBossNames.has(bossName) : false;
              const hpInfo = bossName && bossHp && !bossKilled && !bossEverKilled ? bossHp[bossName] : null;
              return (
                <tr
                  key={i}
                  className={`border-t border-white/[0.08] ${i % 2 === 0 ? 'bg-row-even' : 'bg-row-odd'}`}
                >
                  <td className={`px-4 py-3 border-l-4 ${borderCls}`}>
                    <span className="text-white font-medium">{fullLabel(entry.area)}</span>
                    {rowDeaths.map((d, di) => (
                      <div key={`d${di}`} className="flex items-center gap-1 mt-1">
                        <span className="text-red-400/70 text-xs">✦</span>
                        <span className="text-red-300/60 text-xs font-medium">{d.player}</span>
                        <span className="text-gray-400/70 text-xs font-mono">({fmtTimer(3600 - d.elapsed)})</span>
                      </div>
                    ))}
                    {rowNms.map((n, ni) => {
                      const isBoss = n.type === 'boss' || n.type === 'aminon';
                      return (
                        <div key={`nm${ni}`} className="flex items-center gap-1 mt-1">
                          <span className={`text-xs ${isBoss ? 'text-orange-400/80' : 'text-amber-400/70'}`}>{isBoss ? '⚔' : '★'}</span>
                          <span className={`text-xs font-medium ${isBoss ? 'text-orange-300/90' : 'text-amber-300/80'}`}>{n.name}</span>
                          <span className="text-gray-400/70 text-xs font-mono">({fmtTimer(3600 - n.elapsed)})</span>
                        </div>
                      );
                    })}
                    {rowDrops.map((drop, di) => {
                      const isTemp = drop.type === 'temp' || drop.type === 'temporary';
                      return (
                        <div key={`drop${di}`} className="flex items-center gap-1 mt-1">
                          <span className={`text-xs ${isTemp ? 'text-violet-400/80' : 'text-teal-400/80'}`}>{isTemp ? '◇' : '◆'}</span>
                          <span className={`text-xs font-medium ${isTemp ? 'text-violet-300/80' : 'text-teal-300/90'}`}>
                            {isTemp ? <span className="text-violet-400/50 text-xs">temp </span> : null}{drop.name}
                          </span>
                          <span className="text-gray-400/70 text-xs font-mono">({fmtTimer(3600 - drop.elapsed)})</span>
                        </div>
                      );
                    })}
                    {hpInfo?.minHpPct !== undefined && (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="text-orange-400/60 text-xs">⚠</span>
                        <div className="w-20 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-orange-500/50 rounded-full"
                            style={{ width: `${hpInfo.minHpPct}%` }}
                          />
                        </div>
                        <span className="text-orange-400/70 text-xs font-mono">{hpInfo.minHpPct}% HP</span>
                      </div>
                    )}
                    {isAdmin && rowChests.map((c, ci) => {
                      const inChestRange = c.npcId != null && c.npcId >= 21000100 && c.npcId <= 21000270;
                      const resolved = c.npcId
                        ? (resolveChestId(c.npcId) ?? (inChestRange ? { type: 'Unknown' as const, name: `#${c.npcId}` } : null))
                        : (c.name ? { type: (c.type ?? 'Chest') as ChestIdEntry['type'], name: c.name } : null);
                      if (!resolved) return null;
                      const color = CHEST_COLOR[resolved.type] ?? 'text-gray-400';
                      return (
                        <div key={`c${ci}`} className="flex items-center gap-1 mt-1">
                          <span className={`${color} text-xs`}>◈</span>
                          <span className={`${color} text-xs font-medium`}>{resolved.type} {resolved.name}</span>
                          <span className="text-gray-400/70 text-xs font-mono">({fmtTimer(3600 - c.elapsed)})</span>
                        </div>
                      );
                    })}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-amber-400/90">
                    {fmtTimer(timerRemaining)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400">
                    {fmtDuration(duration)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono border-l border-white/[0.07]">
                    {galliDelta !== null && galliDelta > 0
                      ? <span className="text-emerald-400/80">+{galliDelta.toLocaleString()}</span>
                      : <span className="text-gray-700/50">-</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {galliDelta !== null && galliDelta > 0
                      ? <span className="text-amber-300/70">{nextGalli!.toLocaleString()}</span>
                      : <span className="text-gray-700/50">-</span>
                    }
                  </td>
                </tr>
              );
            })}

            {/* End row */}
            {totalSecs !== null && (
              <tr className="border-t border-white/10 bg-panel-alt">
                <td className="px-4 py-2.5 border-l-4 border-white/10 text-gray-400/70 text-xs italic">
                  Report generated
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-gray-400/70 text-xs">
                  {fmtTimer(3600 - totalSecs)}
                </td>
                <td />
                <td className="border-l border-white/[0.07]" />
                <td />
              </tr>
            )}

            {/* Total row */}
            <tr className="border-t-2 border-amber-900/40 bg-panel-alt">
              <td className="px-4 py-3 border-l-4 border-amber-700/40 text-gray-400 text-sm font-semibold uppercase tracking-wide">
                Total Gallimaufry
              </td>
              <td />
              <td />
              <td className="border-l border-white/[0.07]" />
              <td className="px-4 py-3 text-right font-mono text-amber-400 font-bold text-2xl">
                {effectiveFinalGalli.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  );
}
