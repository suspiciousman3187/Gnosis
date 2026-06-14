'use client';

import { useEffect, useMemo, useState } from 'react';
import type { EncounterEnemy } from '@/lib/encounter';
import type {
  ActionLogEntry, KillLogEntry, PartyMember,
  BossHpEntry, PartyHpEntry, PartyMpEntry, PartyTpEntry,
  SkillchainEntry, BuffLogEntry, ItemUseLogEntry, CharacterGear,
  BossReport,
} from '@/lib/types';
import { BossReportSection, buildJobMap } from '@/lib/reportShared';
import Collapse from '@/components/Collapse';
import { statsForEnemy } from '@/lib/combatStats';
import type { GearIndex } from '@/lib/gearLookup';

function mmss(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
function hhmmss(s: number, withHours = true) {
  const total = Math.max(0, Math.floor(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return withHours ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
}
function humanDur(s: number) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return sec ? `${h}h ${m}m ${sec}s` : (m ? `${h}h ${m}m` : `${h}h`);
  return sec ? `${m}m ${sec}s` : `${m}m`;
}
function killTimeColor(t: number | null, avg: number | null): string {
  if (t == null || avg == null || avg <= 0) return 'text-gray-300';
  const r = t / avg;
  if (r <= 0.5)  return 'text-emerald-400';
  if (r <= 0.8)  return 'text-emerald-300';
  if (r <= 1.25) return 'text-gray-200';
  if (r <= 2.0)  return 'text-rose-300';
  return 'text-rose-400';
}
const nf = (n: number) => n.toLocaleString();

export interface EnemyHistoryCharacterStats {
  name: string;
  count: number;
  best: number;
  avg: number;
}

export interface EnemyHistoryStats {
  best: number;
  worst: number;
  avg: number;
  count: number;
  perCharacter?: EnemyHistoryCharacterStats[];
  divergence?: boolean;
}

function pbTooltip(hist: EnemyHistoryStats | undefined): string {
  if (!hist) return 'No history yet';
  const head = `PB ${humanDur(hist.best)} · ${hist.count.toLocaleString()} unique clear${hist.count === 1 ? '' : 's'}${hist.divergence ? ' · uneven (some characters missed runs)' : ''}`;
  const per = hist.perCharacter ?? [];
  if (per.length === 0) return head;
  const lines = per.slice(0, 8).map(p => `  ${p.name}: ${p.count} (best ${humanDur(p.best)})`);
  const extra = per.length > 8 ? `\n  … ${per.length - 8} more` : '';
  return `${head}\n${lines.join('\n')}${extra}`;
}

export interface FightsPanelProps {
  enemies: EncounterEnemy[];
  actionLog: ActionLogEntry[] | null;
  killLog: KillLogEntry[] | null;
  party: PartyMember[];
  jobMap: ReturnType<typeof buildJobMap>;
  durationSeconds: number;
  encounterId: string;
  bossHpLog: BossHpEntry[] | null;
  partyHpLog: PartyHpEntry[] | null;
  partyMpLog: PartyMpEntry[] | null;
  partyTpLog: PartyTpEntry[] | null;
  skillchainLog: SkillchainEntry[] | null;
  buffLog: BuffLogEntry[] | null;
  gearByPlayer: Record<string, CharacterGear> | null;
  itemUseLog: ItemUseLogEntry[] | null;
  gearIndex: GearIndex;
  enemyHistory?: Map<string, EnemyHistoryStats>;
  focusEnemy?: { name: string; id?: number; spawnSeq?: number; token: number } | null;
}

type FightInstance = { id?: number; spawnSeq?: number; firstSeen: number; killedAt: number | null; damage: number };
type FightGroup   = { name: string; count: number; killed: number; total: number; firstSeen: number; lastEnd: number; instances: FightInstance[] };

function pbDeltaColor(delta: number, best: number): string {
  if (delta <= 0) return 'text-emerald-300';
  const r = best > 0 ? delta / best : 0;
  if (r <= 0.10) return 'text-gray-200';
  if (r <= 0.30) return 'text-amber-300';
  if (r <= 0.60) return 'text-amber-400';
  return 'text-rose-400';
}
function fmtPbDelta(delta: number): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  const abs = Math.abs(delta);
  if (abs < 1) return `${sign}<1s`;
  if (abs < 60) return `${sign}${Math.round(abs)}s`;
  const m = Math.floor(abs / 60);
  const s = Math.round(abs % 60);
  return s > 0 ? `${sign}${m}m${s}s` : `${sign}${m}m`;
}

export default function FightsPanel({
  enemies, actionLog, killLog, party, jobMap, durationSeconds: dur, encounterId,
  bossHpLog, partyHpLog, partyMpLog, partyTpLog, skillchainLog, buffLog,
  gearByPlayer, itemUseLog, gearIndex, enemyHistory, focusEnemy,
}: FightsPanelProps) {
  const [groupByName, setGroupByName] = useState(false);
  const [openFights, setOpenFights] = useState<Set<string>>(new Set());

  const killedAtOf = useMemo(() => {
    const hp = bossHpLog ?? [];
    const byName = new Map<string, EncounterEnemy[]>();
    for (const e of enemies) { const a = byName.get(e.name) ?? []; a.push(e); byName.set(e.name, a); }
    for (const a of byName.values()) a.sort((x, y) => x.firstSeen - y.firstSeen);
    const out = new Map<EncounterEnemy, number | null>();
    for (const e of enemies) {
      if (e.killedAt != null) { out.set(e, e.killedAt); continue; }
      let best: number | null = null;
      if (e.id != null) {
        for (const s of hp) if (s.id === e.id && s.hpp <= 0) best = best == null ? s.elapsed : Math.min(best, s.elapsed);
      }
      if (best == null) {
        const group = byName.get(e.name)!;
        const i = group.indexOf(e);
        const start = e.firstSeen;
        const end = group[i + 1]?.firstSeen ?? Infinity;
        for (const s of hp) {
          if (s.id != null) continue;
          if (s.name === e.name && s.hpp <= 0 && s.elapsed >= start && s.elapsed < end) {
            best = best == null ? s.elapsed : Math.min(best, s.elapsed);
          }
        }
      }
      out.set(e, best);
    }
    return out;
  }, [enemies, bossHpLog]);

  const deathsById = useMemo(() => {
    const out = new Map<number, number[]>();
    for (const k of killLog ?? []) {
      if (k.id == null) continue;
      let arr = out.get(k.id);
      if (!arr) { arr = []; out.set(k.id, arr); }
      arr.push(k.elapsed);
    }
    for (const arr of out.values()) arr.sort((a, b) => a - b);
    return out;
  }, [killLog]);

  const SPAWN_TOLERANCE_SEC = 5;
  const spawnSeqFor = (id: number, elapsed: number): number => {
    const deaths = deathsById.get(id);
    if (!deaths) return 1;
    let seq = 1;
    for (const d of deaths) {
      if (elapsed > d + SPAWN_TOLERANCE_SEC) seq += 1;
      else break;
    }
    return seq;
  };

  const dmgWindowByIdSeq = useMemo(() => {
    const out = new Map<string, { first: number; last: number }>();
    if (!actionLog) return out;
    for (const e of actionLog) {
      if (e.from === 'boss') continue;
      const tgts = e.targets ?? [];
      for (const t of tgts) {
        if (t.id == null) continue;
        if ((t.damage ?? 0) <= 0) continue;
        const seq = spawnSeqFor(t.id, e.elapsed);
        const key = `${t.id}|${seq}`;
        const cur = out.get(key);
        if (!cur) out.set(key, { first: e.elapsed, last: e.elapsed });
        else {
          if (e.elapsed < cur.first) cur.first = e.elapsed;
          if (e.elapsed > cur.last) cur.last = e.elapsed;
        }
      }
    }
    return out;
  }, [actionLog, deathsById]); // eslint-disable-line react-hooks/exhaustive-deps

  const enemyOrdinals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of enemies) totals.set(e.name, (totals.get(e.name) ?? 0) + 1);
    const counts = new Map<string, number>();
    const out = new Map<string, { absIdx: number; idx: number; total: number }>();
    const byTime = [...enemies].sort((a, b) => a.firstSeen - b.firstSeen);
    byTime.forEach((e, i) => {
      const idx = (counts.get(e.name) ?? 0) + 1;
      counts.set(e.name, idx);
      const k = `${e.name}|${e.id ?? 'none'}|${e.spawnSeq ?? 1}`;
      out.set(k, { absIdx: i + 1, idx, total: totals.get(e.name) ?? 1 });
    });
    return out;
  }, [enemies]);

  const fightGroups = useMemo<FightGroup[]>(() => {
    const makeInst = (e: EncounterEnemy): FightInstance => {
      const ka = killedAtOf.get(e) ?? null;
      const fs = e.firstSeen >= 0 ? e.firstSeen : 0;
      return { id: e.id, spawnSeq: e.spawnSeq, firstSeen: fs, killedAt: ka, damage: e.damageTaken };
    };
    if (!groupByName) {
      return enemies
        .map(e => {
          const inst = makeInst(e);
          return {
            name: e.name,
            count: 1,
            killed: inst.killedAt != null ? 1 : 0,
            total: inst.damage,
            firstSeen: inst.firstSeen,
            lastEnd: inst.killedAt ?? dur,
            instances: [inst],
          };
        })
        .sort((a, b) => a.firstSeen - b.firstSeen);
    }
    const byName = new Map<string, FightGroup>();
    for (const e of enemies) {
      const inst = makeInst(e);
      const g = byName.get(e.name);
      if (g) {
        g.count += 1; g.total += inst.damage;
        if (inst.killedAt != null) g.killed += 1;
        if (inst.firstSeen < g.firstSeen) g.firstSeen = inst.firstSeen;
        const end = inst.killedAt ?? dur;
        if (end > g.lastEnd) g.lastEnd = end;
        g.instances.push(inst);
      } else {
        byName.set(e.name, {
          name: e.name, count: 1, killed: inst.killedAt != null ? 1 : 0, total: inst.damage,
          firstSeen: inst.firstSeen, lastEnd: inst.killedAt ?? dur, instances: [inst],
        });
      }
    }
    for (const g of byName.values()) g.instances.sort((a, b) => a.firstSeen - b.firstSeen);
    return [...byName.values()].sort((a, b) => b.total - a.total);
  }, [enemies, killedAtOf, dur, groupByName]);

  const bossReports = useMemo(() => {
    type Acc = { first: number; last: number; firstSeenFallback: number; lastEndFallback: number };
    const byName = new Map<string, Acc>();
    for (const e of enemies) {
      const ka = killedAtOf.get(e) ?? null;
      const fsFallback = e.firstSeen >= 0 ? e.firstSeen : 0;
      const endFallback = ka ?? dur;
      let acc = byName.get(e.name);
      if (!acc) {
        acc = { first: Infinity, last: -Infinity, firstSeenFallback: fsFallback, lastEndFallback: endFallback };
        byName.set(e.name, acc);
      } else {
        if (fsFallback < acc.firstSeenFallback) acc.firstSeenFallback = fsFallback;
        if (endFallback > acc.lastEndFallback) acc.lastEndFallback = endFallback;
      }
      if (e.id != null) {
        const w = dmgWindowByIdSeq.get(`${e.id}|${e.spawnSeq ?? 1}`);
        if (w) {
          if (w.first < acc.first) acc.first = w.first;
          if (w.last > acc.last) acc.last = w.last;
        }
      }
    }
    const out: Record<string, BossReport> = {};
    for (const [name, acc] of byName) {
      const start = isFinite(acc.first) ? acc.first : acc.firstSeenFallback;
      const end   = isFinite(acc.last)  ? acc.last  : acc.lastEndFallback;
      const win   = Math.max(1, end - start);
      const stats = statsForEnemy(actionLog, name, start, end);
      out[name] = { damageReport: [], fightStartElapsed: start, fightDurationSeconds: win, ...stats };
    }
    return out;
  }, [enemies, killedAtOf, dur, actionLog, dmgWindowByIdSeq]);

  const instanceReports = useMemo(() => {
    const out = new Map<string, BossReport>();
    for (const e of enemies) {
      if (e.id == null) continue;
      const seq = e.spawnSeq ?? 1;
      const dw = dmgWindowByIdSeq.get(`${e.id}|${seq}`);
      const ka = killedAtOf.get(e) ?? null;
      const fsFallback = e.firstSeen >= 0 ? e.firstSeen : 0;
      const endFallback = ka ?? dur;
      const start = dw ? dw.first : fsFallback;
      const end   = dw ? dw.last  : endFallback;
      const win = Math.max(1, end - start);
      const stats = statsForEnemy(actionLog, e.name, start, end, e.id);
      out.set(`${e.name}|${e.id}|${seq}`, { damageReport: [], fightStartElapsed: start, fightDurationSeconds: win, ...stats });
    }
    return out;
  }, [enemies, killedAtOf, dur, actionLog, dmgWindowByIdSeq]);

  const avgKillTimeAll = useMemo(() => {
    let sum = 0, count = 0;
    for (const e of enemies) {
      const ka = killedAtOf.get(e) ?? null;
      if (ka == null) continue;
      const seq = e.spawnSeq ?? 1;
      const dw = e.id != null ? dmgWindowByIdSeq.get(`${e.id}|${seq}`) : undefined;
      const t = dw ? Math.max(0, dw.last - dw.first) : Math.max(0, ka - e.firstSeen);
      sum += t; count += 1;
    }
    return count > 0 ? sum / count : null;
  }, [enemies, killedAtOf, dmgWindowByIdSeq]);

  useEffect(() => { setOpenFights(new Set(fightGroups[0] ? [fightGroups[0].name] : [])); }, [encounterId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFight = (name: string) => setOpenFights(s => {
    const n = new Set(s);
    if (n.has(name)) n.delete(name); else n.add(name);
    return n;
  });

  useEffect(() => {
    if (!focusEnemy) return;
    const matches = fightGroups.filter(g => g.name === focusEnemy.name);
    if (matches.length === 0) return;
    const targetId = focusEnemy.id;
    const targetSeq = focusEnemy.spawnSeq ?? 1;
    setOpenFights(s => {
      const n = new Set(s);
      for (const g of matches) {
        const onlyInst = g.instances[0];
        const gKey = (g.count === 1 && onlyInst?.id != null)
          ? `${g.name}|${onlyInst.id}|${onlyInst.spawnSeq ?? 1}`
          : g.name;
        n.add(gKey);
        if (g.count > 1 && targetId != null) {
          n.add(`${g.name}|${targetId}|${targetSeq}`);
        }
      }
      return n;
    });
    let cancelled = false;
    const tryScroll = (attempt: number) => {
      if (cancelled) return;
      const escName = CSS.escape(focusEnemy.name);
      const sel = targetId != null
        ? `[data-fight-name="${escName}"][data-fight-id="${targetId}"][data-fight-seq="${targetSeq}"]`
        : `[data-fight-name="${escName}"]`;
      let el = document.querySelector(sel) as HTMLElement | null;
      if (!el && targetId != null) {
        el = document.querySelector(`[data-fight-name="${escName}"]`) as HTMLElement | null;
      }
      if (!el) {
        if (attempt < 10) setTimeout(() => tryScroll(attempt + 1), 50);
        return;
      }
      el.style.scrollMarginTop = '80px';
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const t = setTimeout(() => tryScroll(0), 80);
    return () => { cancelled = true; clearTimeout(t); };
  }, [focusEnemy?.token, focusEnemy?.name, focusEnemy?.id, focusEnemy?.spawnSeq, fightGroups]); // eslint-disable-line react-hooks/exhaustive-deps

  const showPb = !!enemyHistory && enemyHistory.size > 0;

  if (fightGroups.length === 0) {
    return (
      <div className="bg-row-even border border-white/10 rounded-xl p-8 text-center text-gray-400 text-sm">
        No combat breakdown.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 px-3 py-2 rounded-lg bg-row-even border border-white/10">
        <span className="text-[10px] uppercase tracking-wide text-gray-300 font-semibold">
          <span className="text-accent font-bold">{fightGroups.length.toLocaleString()}</span>
          {' '}
          {groupByName
            ? (fightGroups.length === 1 ? 'enemy type' : 'enemy types')
            : (fightGroups.length === 1 ? 'total kill' : 'total kills')}
        </span>
        <div className="flex rounded-md border border-white/15 overflow-hidden bg-black/30">
          <button
            type="button"
            onClick={() => setGroupByName(false)}
            className={`px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors ${
              !groupByName ? 'bg-accent/20 text-accent' : 'text-gray-300 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            Each Kill
          </button>
          <button
            type="button"
            onClick={() => setGroupByName(true)}
            className={`px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors border-l border-white/15 ${
              groupByName ? 'bg-accent/20 text-accent' : 'text-gray-300 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            Group by Name
          </button>
        </div>
      </div>
      <div className="bg-row-even border border-white/10 rounded-xl overflow-hidden">
        {(() => {
          const headerCls = 'text-xs uppercase tracking-wide text-gray-200 font-bold';
          const headerRowCls = 'hidden sm:grid gap-3 items-center px-3 sm:px-4 py-2.5 bg-white/[0.06] border-b border-white/15 [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]';
          return groupByName ? (
            <div className={`${headerRowCls} ${showPb ? 'grid-cols-[22px_1fr_90px_120px_120px_90px_140px]' : 'grid-cols-[22px_1fr_90px_120px_120px_140px]'}`}>
              <span />
              <span className={headerCls}>Enemy</span>
              <span className={`${headerCls} text-right`}>Killed</span>
              <span className={`${headerCls} text-right`}>Total Kill Time</span>
              <span className={`hidden md:inline ${headerCls} text-right`}>Avg Kill Time</span>
              {showPb && <span className={`${headerCls} text-right`} title="Avg vs your personal-best across all encounters">vs PB</span>}
              <span className={`${headerCls} text-right`}>Total Damage</span>
            </div>
          ) : (
            <div className={`${headerRowCls} ${showPb ? 'grid-cols-[22px_1fr_110px_90px_110px_140px]' : 'grid-cols-[22px_1fr_110px_110px_140px]'}`}>
              <span />
              <span className={headerCls}>Enemy</span>
              <span className={`${headerCls} text-right`}>Kill Time</span>
              {showPb && <span className={`${headerCls} text-right`} title="Difference from your personal-best kill time across all encounters">vs PB</span>}
              <span className={`${headerCls} text-right`}>Killed At</span>
              <span className={`${headerCls} text-right`}>Total Damage</span>
            </div>
          );
        })()}
        <div className="divide-y divide-white/10">
        {fightGroups.map(g => {
          const onlyInst = g.instances[0];
          const groupKey = (g.count === 1 && onlyInst?.id != null)
            ? `${g.name}|${onlyInst.id}|${onlyInst.spawnSeq ?? 1}`
            : g.name;
          const open = openFights.has(groupKey);
          const multi = g.count > 1;
          const instWindows: { first: number; last: number }[] = [];
          let instKillSum = 0;
          let instKillCount = 0;
          for (const inst of g.instances) {
            if (inst.killedAt == null) continue;
            let w: { first: number; last: number } | null = null;
            if (inst.id != null) {
              const dw = dmgWindowByIdSeq.get(`${inst.id}|${inst.spawnSeq ?? 1}`);
              if (dw) w = dw;
            }
            if (!w) w = { first: inst.firstSeen, last: inst.killedAt };
            instWindows.push(w);
            instKillSum += Math.max(0, w.last - w.first);
            instKillCount += 1;
          }
          let groupKillTime: number | null = null;
          if (instWindows.length > 0) {
            const sorted = [...instWindows].sort((a, b) => a.first - b.first);
            let total = 0;
            let cur = { first: sorted[0].first, last: sorted[0].last };
            for (let i = 1; i < sorted.length; i++) {
              const iv = sorted[i];
              if (iv.first <= cur.last) {
                if (iv.last > cur.last) cur.last = iv.last;
              } else {
                total += cur.last - cur.first;
                cur = { first: iv.first, last: iv.last };
              }
            }
            total += cur.last - cur.first;
            groupKillTime = Math.max(0, total);
          }
          const avgKillTime = instKillCount > 0 ? instKillSum / instKillCount : null;
          const ord = (!multi && onlyInst)
            ? enemyOrdinals.get(`${g.name}|${onlyInst.id ?? 'none'}|${onlyInst.spawnSeq ?? 1}`)
            : undefined;
          const hist = enemyHistory?.get(g.name);
          const pbAvg = hist?.avg ?? avgKillTimeAll;
          const pbBest = hist?.best ?? null;
          const ekDelta = (!groupByName && groupKillTime != null && pbBest != null) ? groupKillTime - pbBest : null;
          const gbnDelta = (groupByName && avgKillTime != null && pbBest != null) ? avgKillTime - pbBest : null;
          return (
            <div
              key={groupKey}
              data-fight-name={g.name}
              {...(!multi && onlyInst?.id != null ? { 'data-fight-id': onlyInst.id, 'data-fight-seq': onlyInst.spawnSeq ?? 1 } : {})}
            >
              <button
                onClick={() => toggleFight(groupKey)}
                className={`w-full grid grid-cols-[22px_1fr_auto] ${
                  groupByName
                    ? (showPb ? 'sm:grid-cols-[22px_1fr_90px_120px_120px_90px_140px]' : 'sm:grid-cols-[22px_1fr_90px_120px_120px_140px]')
                    : (showPb ? 'sm:grid-cols-[22px_1fr_110px_90px_110px_140px]' : 'sm:grid-cols-[22px_1fr_110px_110px_140px]')
                } gap-3 items-center px-3 sm:px-4 py-3 text-sm hover:bg-white/[0.03] transition-colors text-left`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}><path d="M9 6l6 6-6 6" /></svg>
                <span className="font-semibold text-gray-200 truncate min-w-0 flex items-center gap-1.5">
                  <span className="truncate">{g.name}</span>
                  {ord && (
                    <>
                      <span className="text-[11px] font-normal text-gray-400">#{ord.absIdx}</span>
                      {ord.total > 1 && (
                        <span className="text-[10px] font-normal text-gray-400">({ord.idx}/{ord.total})</span>
                      )}
                    </>
                  )}
                  {multi && <span className="text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded bg-white/10 text-gray-300 border border-white/10 shrink-0">×{g.count}</span>}
                  {!multi && g.killed === 0 && (
                    <span className="text-[10px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">survived</span>
                  )}
                </span>
                {groupByName ? (
                  <>
                    <span className="hidden sm:flex items-center justify-end text-sm font-mono text-emerald-300 shrink-0">
                      {g.killed}/{g.count}
                    </span>
                    <span className="hidden sm:flex items-center justify-end text-sm font-mono text-gray-300 shrink-0">
                      {groupKillTime != null ? humanDur(groupKillTime) : <span className="text-gray-400">-</span>}
                    </span>
                    <span className={`hidden md:flex items-center justify-end text-sm font-mono shrink-0 ${killTimeColor(avgKillTime, pbAvg)}`}>
                      {avgKillTime != null ? humanDur(avgKillTime) : <span className="text-gray-400">-</span>}
                    </span>
                    {showPb && (
                      <span className={`hidden sm:flex items-center justify-end text-xs font-mono shrink-0 ${gbnDelta != null && pbBest != null ? pbDeltaColor(gbnDelta, pbBest) : 'text-gray-400'}`} data-tooltip={pbTooltip(hist)} data-tooltip-tone="accent">
                        {gbnDelta != null ? fmtPbDelta(gbnDelta) : <span className="text-gray-400">-</span>}
                      </span>
                    )}
                    <span className="ml-auto sm:ml-0 sm:justify-end flex items-baseline gap-1.5 shrink-0">
                      <span className="sm:hidden text-[10px] uppercase tracking-wide text-gray-400">Total Damage</span>
                      <span className="font-mono text-rose-300/80">{nf(g.total)}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className={`hidden sm:flex items-center justify-end text-sm font-mono shrink-0 ${killTimeColor(groupKillTime, pbAvg)}`}>
                      {groupKillTime != null ? humanDur(groupKillTime) : <span className="text-gray-400">-</span>}
                    </span>
                    {showPb && (
                      <span className={`hidden sm:flex items-center justify-end text-xs font-mono shrink-0 ${ekDelta != null && pbBest != null ? pbDeltaColor(ekDelta, pbBest) : 'text-gray-400'}`} data-tooltip={pbTooltip(hist)} data-tooltip-tone="accent">
                        {ekDelta != null ? fmtPbDelta(ekDelta) : <span className="text-gray-400">-</span>}
                      </span>
                    )}
                    <span className="hidden sm:flex items-center justify-end text-sm font-mono text-gray-300 shrink-0">
                      {onlyInst?.killedAt != null ? hhmmss(onlyInst.killedAt, dur >= 3600) : <span className="text-gray-400">-</span>}
                    </span>
                    <span className="ml-auto sm:ml-0 sm:justify-end flex items-baseline gap-1.5 shrink-0">
                      <span className="sm:hidden text-[10px] uppercase tracking-wide text-gray-400">Total Damage</span>
                      <span className="font-mono text-rose-300/80">{nf(g.total)}</span>
                    </span>
                  </>
                )}
              </button>
              {!multi && (
                <Collapse open={open}>{() => {
                const inst = g.instances[0];
                const seq = inst?.spawnSeq ?? 1;
                const perInst = inst?.id != null
                  ? instanceReports.get(`${g.name}|${inst.id}|${seq}`)
                  : undefined;
                const dispName = ord && ord.total > 1 ? `${g.name} #${ord.idx}` : undefined;
                return (
                <div className="border-t border-white/10 p-4">
                  <BossReportSection
                    name={g.name}
                    entityId={inst?.id}
                    displayName={dispName}
                    report={perInst ?? bossReports[g.name]}
                    jobMap={jobMap}
                    hideKillTime
                    flush
                    actionLog={actionLog}
                    party={party}
                    bossReports={bossReports}
                    bossHpLog={bossHpLog}
                    partyHpLog={partyHpLog}
                    partyMpLog={partyMpLog}
                    partyTpLog={partyTpLog}
                    skillchainLog={skillchainLog}
                    buffLog={buffLog}
                    gearByPlayer={gearByPlayer}
                    itemUseLog={itemUseLog}
                    gearIndex={gearIndex}
                  />
                </div>
                );
              }}</Collapse>
              )}
              {multi && (
                <Collapse open={open}>{() => (
                <div className="border-t border-white/10 bg-row-odd/40">
                  {(() => {
                    const aggKey = `${g.name}|__all`;
                    const aggOpen = openFights.has(aggKey);
                    return (
                      <div className="border-b border-white/10 last:border-0">
                        <button onClick={() => toggleFight(aggKey)} className="w-full flex items-center gap-2 px-4 py-2.5 text-xs hover:bg-white/[0.03] transition-colors">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-gray-400 shrink-0 transition-transform ${aggOpen ? 'rotate-90' : ''}`}><path d="M9 6l6 6-6 6" /></svg>
                          <span className="font-semibold text-gray-300">All {g.count} combined</span>
                          <span className="text-[10px] text-gray-400">({mmss(g.firstSeen)}{g.lastEnd > g.firstSeen ? `–${mmss(g.lastEnd)}` : ''})</span>
                          <span className="ml-auto flex items-baseline gap-1.5 shrink-0">
                            <span className="hidden sm:inline text-[10px] uppercase tracking-wide text-gray-400">Total Damage</span>
                            <span className="font-mono text-rose-300/80">{nf(g.total)}</span>
                          </span>
                        </button>
                        <Collapse open={aggOpen}>{() => (
                          <div className="border-t border-white/10 p-4">
                            <BossReportSection
                              name={g.name}
                              report={bossReports[g.name]}
                              jobMap={jobMap}
                              hideKillTime
                              flush
                              actionLog={actionLog}
                              party={party}
                              bossReports={bossReports}
                              bossHpLog={bossHpLog}
                              partyHpLog={partyHpLog}
                              partyMpLog={partyMpLog}
                              partyTpLog={partyTpLog}
                              skillchainLog={skillchainLog}
                              buffLog={buffLog}
                              gearByPlayer={gearByPlayer}
                              itemUseLog={itemUseLog}
                              gearIndex={gearIndex}
                            />
                          </div>
                        )}</Collapse>
                      </div>
                    );
                  })()}
                  {g.instances.map((inst, i) => {
                    const seq = inst.spawnSeq ?? 1;
                    const instKey = inst.id != null
                      ? `${g.name}|${inst.id}|${seq}`
                      : `${g.name}|idx${i}`;
                    const instOpen = openFights.has(instKey);
                    const report = inst.id != null ? instanceReports.get(instKey) : undefined;
                    const end = inst.killedAt ?? dur;
                    const dw = inst.id != null ? dmgWindowByIdSeq.get(`${inst.id}|${seq}`) : undefined;
                    const instKillTime = inst.killedAt == null
                      ? null
                      : dw
                        ? Math.max(0, dw.last - dw.first)
                        : Math.max(0, inst.killedAt - inst.firstSeen);
                    return (
                      <div
                        key={instKey}
                        data-fight-name={g.name}
                        data-fight-id={inst.id ?? ''}
                        data-fight-seq={seq}
                        className="border-b border-white/10 last:border-0"
                      >
                        <button
                          onClick={() => toggleFight(instKey)}
                          className="w-full grid grid-cols-[18px_1fr_auto] sm:grid-cols-[18px_1fr_110px_110px_140px] gap-3 items-center px-4 py-2.5 text-xs hover:bg-white/[0.03] transition-colors text-left"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-gray-400 shrink-0 transition-transform ${instOpen ? 'rotate-90' : ''}`}><path d="M9 6l6 6-6 6" /></svg>
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span className="font-medium text-gray-300 truncate">{g.name} #{i + 1}</span>
                            <span className="text-[10px] text-gray-400 shrink-0">{mmss(inst.firstSeen)}{end > inst.firstSeen ? `–${mmss(end)}` : ''}</span>
                            {inst.killedAt == null && (
                              <span className="text-[10px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">survived</span>
                            )}
                          </span>
                          <span className={`hidden sm:flex items-center justify-end text-sm font-mono shrink-0 ${killTimeColor(instKillTime, avgKillTimeAll)}`}>
                            {instKillTime != null ? humanDur(instKillTime) : <span className="text-gray-400">-</span>}
                          </span>
                          <span className="hidden sm:flex items-center justify-end text-sm font-mono text-gray-300 shrink-0">
                            {inst.killedAt != null ? hhmmss(inst.killedAt, dur >= 3600) : <span className="text-gray-400">-</span>}
                          </span>
                          <span className="ml-auto sm:ml-0 sm:justify-end flex items-baseline gap-1.5 shrink-0">
                            <span className="sm:hidden text-[10px] uppercase tracking-wide text-gray-400">Total Damage</span>
                            <span className="font-mono text-rose-300/80">{nf(inst.damage)}</span>
                          </span>
                        </button>
                        <Collapse open={instOpen}>{() => (
                          <div className="border-t border-white/10 p-4">
                            {report ? (
                              <BossReportSection
                                name={g.name}
                                entityId={inst.id}
                                displayName={`${g.name} #${i + 1}`}
                                report={report}
                                jobMap={jobMap}
                                hideKillTime
                                flush
                                actionLog={actionLog}
                                party={party}
                                bossReports={bossReports}
                                bossHpLog={bossHpLog}
                                partyHpLog={partyHpLog}
                                partyMpLog={partyMpLog}
                                partyTpLog={partyTpLog}
                                skillchainLog={skillchainLog}
                                buffLog={buffLog}
                                gearByPlayer={gearByPlayer}
                                itemUseLog={itemUseLog}
                                gearIndex={gearIndex}
                              />
                            ) : (
                              <p className="text-xs text-gray-400 italic">No per-instance data - legacy log without entity ids. Use the combined view above.</p>
                            )}
                          </div>
                        )}</Collapse>
                      </div>
                    );
                  })}
                </div>
                )}</Collapse>
              )}
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
