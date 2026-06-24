'use client';

import { useState, type ReactNode } from 'react';
import Collapse from '@/components/Collapse';
import { imgSrc } from '@/lib/img';
import GearReveal from '@/components/GearReveal';
import { DamageSpread } from '@/components/CombatStatsTab';
import { BossActionTimeline } from '@/components/ActionTimelineTab';
import { JOB_ICONS, mainJobKey } from '@/components/JobIcon';
import type { GearIndex } from '@/lib/gearLookup';
import type { BossReport, ActionLogEntry, ActionLogTarget, ItemUseLogEntry, CorRolls, PartyMember, AminonData, BossHpEntry, PartyHpEntry, PartyTpEntry, PartyMpEntry, SkillchainEntry, BuffLogEntry, DamageEntry } from '@/lib/types';
import { SP_ABILITIES } from '@/lib/spAbilities';
import { isWeaponSkill, isAutoAttack, isSpell, isJobAbility, isEnfeebleSpell, isMagicBurst, isRanged } from '@/lib/actionCategory';
import { useEnemyTerm } from './EnemyTerm';
import BuffIcon from './BuffIcon';
import { formatDuration, fmtFightTime } from './sortie/SortieHelpers';
import { debuffUpkeepByPlayer, type DebuffUpkeepRow } from '@/lib/debuffUpkeep';

function DebuffUpkeepInline({ rows }: { rows: DebuffUpkeepRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded border border-fuchsia-700/30 bg-fuchsia-950/15 px-2.5 py-2 mb-2">
      <div className="text-[10px] uppercase tracking-wide text-fuchsia-300 mb-1.5">Debuff Upkeep</div>
      <div className="space-y-1">
        {rows.map(r => {
          const pct = Math.min(100, Math.max(0, r.uptimePct * 100));
          return (
            <div key={r.name} className="flex items-center gap-2 text-[11px]">
              <div className="w-24 truncate text-fuchsia-100" title={r.name}>{r.name}</div>
              <div className="flex-1 h-1.5 bg-panel-alt rounded-full overflow-hidden">
                <div className="h-full bg-fuchsia-500/70" style={{ width: `${pct}%` }} />
              </div>
              <div className="w-10 text-right text-gray-200 font-mono">{Math.round(pct)}%</div>
              <div className="w-28 text-right text-gray-500 font-mono whitespace-nowrap">
                {Math.round(r.activeSeconds)}s / {Math.round(r.windowSeconds)}s
              </div>
              <div className="w-12 text-right text-gray-500 font-mono whitespace-nowrap">
                {r.applyCount}x
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RollBadge({ label, value, lucky }: { label: string; value: number; lucky: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-gray-400 text-xs">{label}</span>
      <span className={`text-2xl font-bold ${lucky ? 'text-amber-400' : 'text-white'}`}>{value}</span>
      {lucky && <span className="text-amber-500 text-xs">Lucky!</span>}
    </div>
  );
}

interface PlayerSecondaryStats {
  accuracy?:        { pct: number; count: number };
  critRate?:        { pct: number; count: number };
  meleeAverage?:    { avg: number; count: number };
  meleeCritAverage?:{ avg: number; count: number };
  wsAccuracy?:      { pct: number; count: number };
  wsAverage?:       { avg: number; count: number };
  wsAvgTp?:         { avg: number; count: number };
  wsPerSecond?:     { value: number; count: number };
  rangedAccuracy?:  { pct: number; count: number };
  rangedCritRate?:  { pct: number; count: number };
  rangedAverage?:   { avg: number; count: number };
  magicAccuracy?:   { pct: number; count: number };
  attacksPerRound?: { avg: number; count: number };
  evadeRate?:       { pct: number; count: number };
  parryRate?:       { pct: number; count: number };
  blockRate?:       { pct: number; count: number };
}

function buildPerPlayerStats(report: BossReport): Record<string, PlayerSecondaryStats> {
  const stats: Record<string, PlayerSecondaryStats> = {};
  const get = (name: string) => (stats[name] ??= {});
  report.accuracy?.forEach(e         => { get(e.name).accuracy         = { pct: e.pct, count: e.count }; });
  report.critRate?.forEach(e         => { get(e.name).critRate         = { pct: e.pct, count: e.count }; });
  report.meleeAverage?.forEach(e     => { get(e.name).meleeAverage     = { avg: e.avg, count: e.count }; });
  report.meleeCritAverage?.forEach(e => { get(e.name).meleeCritAverage = { avg: e.avg, count: e.count }; });
  report.wsAccuracy?.forEach(e       => { get(e.name).wsAccuracy       = { pct: e.pct, count: e.count }; });
  report.wsAverages?.forEach(e       => { get(e.name).wsAverage        = { avg: e.wsAvg, count: e.count }; });
  report.rangedAccuracy?.forEach(e   => { get(e.name).rangedAccuracy   = { pct: e.pct, count: e.count }; });
  report.rangedCritRate?.forEach(e   => { get(e.name).rangedCritRate   = { pct: e.pct, count: e.count }; });
  report.rangedAverage?.forEach(e    => { get(e.name).rangedAverage    = { avg: e.avg, count: e.count }; });
  report.magicAccuracy?.forEach(e    => { get(e.name).magicAccuracy    = { pct: e.pct, count: e.count }; });
  report.attacksPerRound?.forEach(e  => { get(e.name).attacksPerRound  = { avg: e.avg, count: e.count }; });
  report.evadeRate?.forEach(e        => { get(e.name).evadeRate        = { pct: e.pct, count: e.count }; });
  report.parryRate?.forEach(e        => { get(e.name).parryRate        = { pct: e.pct, count: e.count }; });
  report.blockRate?.forEach(e        => { get(e.name).blockRate        = { pct: e.pct, count: e.count }; });

  // WS/sec - total WS attempts (hits + misses) divided by fight duration.
  // Falls back to wsAverages.count (hits only) when accuracy data isn't available.
  if (report.fightDurationSeconds > 0) {
    const attempts: Record<string, number> = {};
    report.wsAccuracy?.forEach(e   => { attempts[e.name] = e.count; });
    report.wsAverages?.forEach(e   => { attempts[e.name] ??= e.count; });
    for (const [name, count] of Object.entries(attempts)) {
      get(name).wsPerSecond = { value: count / report.fightDurationSeconds, count };
    }
  }

  return stats;
}

function StatTile({ label, value, count, color, unit = 'hits' }: { label: string; value: string; count: number; color: string; unit?: string }) {
  return (
    <div className="bg-panel-alt/40 border border-white/5 rounded-md px-3 py-2 text-center">
      <div className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-medium ${color}`}>{value}</div>
      <div className="text-[10px] text-gray-400">{count} {unit}</div>
    </div>
  );
}

function PlayerStatsPanel({ stats }: { stats: PlayerSecondaryStats | undefined }) {
  if (!stats || Object.keys(stats).length === 0) {
    return <div className="text-xs text-gray-400 italic">No detailed stats recorded.</div>;
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {stats.rangedAccuracy  && <StatTile label="Ranged Acc" value={`${stats.rangedAccuracy.pct.toFixed(2)}%`} count={stats.rangedAccuracy.count} unit="shots" color="text-sky-400" />}
      {stats.rangedAverage   && <StatTile label="Ranged Avg" value={stats.rangedAverage.avg.toLocaleString()} count={stats.rangedAverage.count} unit="shots" color="text-green-400" />}
      {stats.rangedCritRate  && <StatTile label="Ranged Crit" value={`${stats.rangedCritRate.pct.toFixed(2)}%`} count={stats.rangedCritRate.count} unit="shots" color="text-sky-400" />}
      {stats.wsAccuracy      && <StatTile label="Weaponskill Accuracy"  value={`${stats.wsAccuracy.pct.toFixed(2)}%`} count={stats.wsAccuracy.count} color="text-sky-400" />}
      {stats.wsAverage       && <StatTile label="Weaponskill Average"   value={stats.wsAverage.avg.toLocaleString()}  count={stats.wsAverage.count}  color="text-amber-400" />}
      {stats.wsAvgTp         && <StatTile label="Avg. TP At Weaponskill" value={Math.round(stats.wsAvgTp.avg).toLocaleString()} count={stats.wsAvgTp.count} color="text-amber-300" />}
      {stats.wsPerSecond     && <StatTile label="Weaponskill Frequency" value={`${(stats.wsPerSecond.value * 60).toFixed(2)} /min`} count={stats.wsPerSecond.count} color="text-amber-400" />}
      {stats.accuracy        && <StatTile label="Auto Accuracy" value={`${stats.accuracy.pct.toFixed(2)}%`} count={stats.accuracy.count} color="text-sky-400" />}
      {stats.critRate        && <StatTile label="Crit Rate"     value={`${stats.critRate.pct.toFixed(2)}%`} count={stats.critRate.count} color="text-sky-400" />}
      {stats.attacksPerRound && <StatTile label="Avg. Attacks Per Round" value={`${stats.attacksPerRound.avg.toFixed(2)}`} count={stats.attacksPerRound.count} unit="rounds" color="text-green-400" />}
      {stats.magicAccuracy   && <StatTile label="Magic Acc"  value={`${stats.magicAccuracy.pct.toFixed(2)}%`} count={stats.magicAccuracy.count} unit="casts" color="text-indigo-400" />}
      {stats.evadeRate       && <StatTile label="Evasion"    value={`${stats.evadeRate.pct.toFixed(2)}%`} count={stats.evadeRate.count} unit="vs" color="text-rose-300" />}
      {stats.parryRate       && <StatTile label="Parry"      value={`${stats.parryRate.pct.toFixed(2)}%`} count={stats.parryRate.count} unit="vs" color="text-rose-300" />}
      {stats.blockRate       && <StatTile label="Block"      value={`${stats.blockRate.pct.toFixed(2)}%`} count={stats.blockRate.count} unit="vs" color="text-rose-300" />}
    </div>
  );
}


const ACTION_TYPE_STYLE: Record<ActionLogEntry['type'], string> = {
  ws:     'text-amber-300',
  spell:  'text-sky-300',
  mb:     'text-teal-300',
  enfeeb: 'text-gray-300',
  ja:     'text-emerald-300',
  auto:   'text-zinc-300',
  ranged: 'text-green-300',
};

// Placeholder names the addon emits when it can't resolve an action id. The
// debuff-source correlation skips these in favor of a real, named action.
const GENERIC_ACTION_NAMES = new Set(['Spell', 'WS', 'JA', 'Unknown', 'Item', 'TP Move', 'Pet Ability', 'Ability', 'Auto Attack']);

const PLACEHOLDER_CAST_NAMES = new Set(['Spell', 'WS', 'JA', 'Unknown', 'Item', 'TP Move', 'Pet Ability', 'Ability']);

const DRAIN_HP_MSG = new Set([187, 227, 274, 281, 736, 748, 749, 802]);
const DRAIN_MP_MSG = new Set([225, 228, 275, 366, 750, 751]);
const DRAIN_TP_MSG = new Set([226, 454, 746, 752, 753]);
// Additional-effect drains ride on top of an otherwise-normal hit; the amount
// is in addEffect.param, NOT the main damage.
const ADD_DRAIN_MSG: Record<number, 'HP' | 'MP' | 'TP'> = { 161: 'HP', 162: 'MP', 165: 'TP' };
// Reactive damage the actor TAKES when hitting a target: spikes (msg 44) and
// counters (msg 33). Surfaced in Damage Taken.
const REACTIVE_TAKEN_MSG: Record<number, string> = { 44: 'Spikes', 33: 'Counter' };

// Damage-taken type from the action message id. Mob TP moves (msg 110) all share
// one message regardless of physical/magic/breath, so they read as "Ability".
const DMG_TAKEN_TYPE: Record<number, { label: string; color: string }> = {
  1: { label: 'Melee', color: 'text-rose-300' },
  67: { label: 'Melee', color: 'text-rose-300' },
  2: { label: 'Magic', color: 'text-violet-300' },
  252: { label: 'Magic', color: 'text-violet-300' },
  265: { label: 'Magic', color: 'text-violet-300' },
  157: { label: 'Ranged', color: 'text-teal-300' },
  77: { label: 'Ranged', color: 'text-teal-300' },
  44: { label: 'Spikes', color: 'text-sky-300' },
  33: { label: 'Counter', color: 'text-sky-300' },
  163: { label: 'Add. Effect', color: 'text-gray-400' },
  229: { label: 'Add. Effect', color: 'text-gray-400' },
};
const dmgTakenType = (msg?: number) => (msg != null ? DMG_TAKEN_TYPE[msg] : undefined) ?? { label: 'Ability', color: 'text-amber-300' };

type DrainInfo = { resource: 'HP' | 'MP' | 'TP'; amount: number; addOn: boolean };
// Classify a target entry's drain, if any. addOn=true means it's an
// additional-effect siphon layered on a normal hit (not the main action).
function drainInfo(t: ActionLogTarget | undefined): DrainInfo | null {
  if (!t) return null;
  const m = t.message;
  if (m != null) {
    if (DRAIN_HP_MSG.has(m)) return { resource: 'HP', amount: t.damage ?? 0, addOn: false };
    if (DRAIN_MP_MSG.has(m)) return { resource: 'MP', amount: t.damage ?? 0, addOn: false };
    if (DRAIN_TP_MSG.has(m)) return { resource: 'TP', amount: t.damage ?? 0, addOn: false };
  }
  const ae = t.addEffect;
  if (ae && ae.param && ae.param > 0 && ae.message in ADD_DRAIN_MSG) {
    return { resource: ADD_DRAIN_MSG[ae.message], amount: ae.param, addOn: true };
  }
  return null;
}

function isAbsorbOrDrain(e: ActionLogEntry): boolean {
  if (!isSpell(e)) return false;
  if (/^Absorb-/i.test(e.name) || /^(Drain|Aspir)\b/i.test(e.name)) return true;
  const d = drainInfo(e.targets?.[0]);
  return d != null && !d.addOn;
}

function PlayerSubTable({ title, titleColor = 'text-gray-300', summary, headerCells, colSpan, isEmpty, children }: { title: string; titleColor?: string; summary?: ReactNode; headerCells: ReactNode; colSpan: number; isEmpty?: boolean; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5">
        <span className={`text-sm font-bold uppercase tracking-wide ${titleColor}`}>{title}</span>
        {summary && <span className="text-[11px] text-gray-400"> · {summary}</span>}
      </div>
      <div className="max-h-60 overflow-y-auto border border-white/[0.06] rounded">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-panel-alt/80 backdrop-blur-sm">
            <tr className="text-gray-400 border-b border-white/10">{headerCells}</tr>
          </thead>
          <tbody>
            {isEmpty
              ? <tr><td colSpan={colSpan} className="py-4 text-center text-gray-400 italic">Empty</td></tr>
              : children}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function BossReportSection({ name, entityId, displayName, report, jobMap, hideKillTime = false, flush = false, embedded = false, itemUseLog, corsairRolls, actionLog, party, bossReports, aminon, bossHpLog, partyHpLog, partyTpLog, partyMpLog, skillchainLog, buffLog, gearByPlayer, gearIndex, middleSlot }: { name: string; entityId?: number; displayName?: string; report: BossReport; jobMap: Record<string, string>; hideKillTime?: boolean; flush?: boolean; embedded?: boolean; itemUseLog?: ItemUseLogEntry[] | null; corsairRolls?: CorRolls | null; actionLog?: ActionLogEntry[] | null; party?: PartyMember[]; bossReports?: Record<string, BossReport> | null; aminon?: AminonData | null; bossHpLog?: BossHpEntry[] | null; partyHpLog?: PartyHpEntry[] | null; partyTpLog?: PartyTpEntry[] | null; partyMpLog?: PartyMpEntry[] | null; skillchainLog?: SkillchainEntry[] | null; buffLog?: BuffLogEntry[] | null; gearByPlayer?: Record<string, import('@/lib/types').CharacterGear> | null; gearIndex?: GearIndex; middleSlot?: ReactNode }) {
  const enemyTerm = useEnemyTerm();
  const actionsByPlayer = (() => {
    const map: Record<string, ActionLogEntry[]> = {};
    if (!actionLog) return map;
    const start = report.fightStartElapsed;
    const end = start != null ? start + report.fightDurationSeconds : null;
    const targetsBoss = (e: ActionLogEntry) => {
      const tgts = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' as const }] : []);
      return tgts.some(t => t.mob === name && (entityId == null || t.id == null || t.id === entityId));
    };
    for (const e of actionLog) {
      if (e.from === 'boss') continue;
      if (e.phase === 'start') continue;
      if (PLACEHOLDER_CAST_NAMES.has(e.name)) continue; // drop unresolved cat-8 "Spell" dummies (old runs)
      const inFightWindow = start != null && end != null && e.elapsed >= start && e.elapsed <= end;
      const isBossAction = targetsBoss(e);
      if (!inFightWindow && !isBossAction) continue;
      (map[e.player] ??= []).push(e);
    }
    return map;
  })();

  const itemsByPlayer = (() => {
    const map: Record<string, { events: { elapsed: number; item: string }[] }> = {};
    if (!itemUseLog) return map;
    const start = report.fightStartElapsed;
    const end = start != null ? start + report.fightDurationSeconds : null;
    for (const u of itemUseLog) {
      if (start != null && end != null && (u.elapsed < start || u.elapsed > end)) continue;
      (map[u.player] ??= { events: [] }).events.push({ elapsed: u.elapsed, item: u.item });
    }
    for (const rec of Object.values(map)) rec.events.sort((a, b) => a.elapsed - b.elapsed);
    return map;
  })();

  // Skillchains this player closed on THIS boss during the fight window.
  // One event per close, plus a per-player total for the section summary.
  const scByPlayer = (() => {
    const map: Record<string, { total: number; events: { elapsed: number; sc: string; ws: string; damage: number }[] }> = {};
    if (!skillchainLog) return map;
    const start = report.fightStartElapsed;
    const end = start != null ? start + report.fightDurationSeconds : null;
    for (const s of skillchainLog) {
      if (s.mob !== name) continue;
      if (PLACEHOLDER_CAST_NAMES.has(s.ws)) continue; // drop bogus "Spell"-closer SCs (old cat-8 noise)
      if (start != null && end != null && (s.elapsed < start || s.elapsed > end)) continue;
      const rec = (map[s.closer] ??= { total: 0, events: [] });
      rec.total += s.damage || 0;
      rec.events.push({ elapsed: s.elapsed, sc: s.sc, ws: s.ws, damage: s.damage || 0 });
    }
    for (const rec of Object.values(map)) rec.events.sort((a, b) => a.elapsed - b.elapsed);
    return map;
  })();

  const debuffsByPlayer = (() => {
    type DebuffRow = { elapsed: number; action: string | null; status: string | null; statusId?: number; resisted?: boolean; immunobreak?: boolean };
    const map: Record<string, { events: DebuffRow[] }> = {};
    const start = report.fightStartElapsed;
    const end = start != null ? start + report.fightDurationSeconds : null;
    const inWindow = (t: number) => !(start != null && end != null && (t < start || t > end));
    const correlateSource = (player: string, elapsed: number): string | null => {
      if (!actionLog) return null;
      let best: { name: string; generic: boolean; dt: number } | null = null;
      for (const a of actionLog) {
        if (a.player !== player || a.from === 'boss') continue;
        const tgts = a.targets ?? (a.mob ? [{ mob: a.mob, damage: a.damage ?? 0, result: a.result ?? 'hit' as const }] : []);
        if (!tgts.some(t => t.mob === name)) continue;
        const dt = Math.abs(a.elapsed - elapsed);
        if (dt > 1) continue;
        const generic = GENERIC_ACTION_NAMES.has(a.name);
        const better = best == null
          || (generic !== best.generic ? !generic : dt < best.dt);
        if (better) best = { name: a.name, generic, dt };
      }
      return best?.name ?? null;
    };
    // 1. Status gains on the boss.
    for (const e of buffLog ?? []) {
      if (e.kind !== 'gain' || e.target !== name || !e.appliedBy) continue;
      if (!inWindow(e.elapsed)) continue;
      const action = e.appliedBySpell ?? correlateSource(e.appliedBy, e.elapsed);
      (map[e.appliedBy] ??= { events: [] }).events.push({ elapsed: e.elapsed, action, status: e.buffName, statusId: e.buffId });
    }
    // 2. Enfeebling casts not already represented by a status-gain row.
    for (const e of actionLog ?? []) {
      if (!isEnfeebleSpell(e) || e.from === 'boss') continue;
      if (PLACEHOLDER_CAST_NAMES.has(e.name)) continue;
      if (!inWindow(e.elapsed)) continue;
      const tgts = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' as const }] : []);
      const onBoss = tgts.filter(t => t.mob === name);
      if (onBoss.length === 0) continue;
      const resisted = onBoss.every(t => t.result === 'resist' || t.result === 'miss');
      const immunobreak = onBoss.some(t => (t.bitFlags ?? 0) & 0x08);
      const rec = (map[e.player] ??= { events: [] });
      const covered = rec.events.some(ev => ev.action === e.name && Math.abs(ev.elapsed - e.elapsed) <= 1);
      if (!covered) rec.events.push({ elapsed: e.elapsed, action: e.name, status: null, resisted, immunobreak });
    }
    for (const e of actionLog ?? []) {
      if (e.from === 'boss' || !isAbsorbOrDrain(e)) continue;
      if (PLACEHOLDER_CAST_NAMES.has(e.name)) continue;
      if (!inWindow(e.elapsed)) continue;
      const tgts = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' as const }] : []);
      if (!tgts.some(t => t.mob === name)) continue;
      const rec = (map[e.player] ??= { events: [] });
      const covered = rec.events.some(ev => ev.action === e.name && Math.abs(ev.elapsed - e.elapsed) <= 1);
      if (covered) continue;
      const d = drainInfo(tgts.find(t => t.mob === name));
      const status = d ? `−${d.amount.toLocaleString()} ${d.resource}` : null;
      rec.events.push({ elapsed: e.elapsed, action: e.name, status });
    }
    for (const rec of Object.values(map)) rec.events.sort((a, b) => a.elapsed - b.elapsed);
    return map;
  })();

  const upkeepByPlayer = (() => {
    const fightStart = report.fightStartElapsed;
    if (fightStart == null || report.fightDurationSeconds <= 0) return {};
    return debuffUpkeepByPlayer(buffLog, name, fightStart, report.fightDurationSeconds);
  })();

  const damageTakenByPlayer = (() => {
    type DamageTakenRow = {
      elapsed: number;
      action: string;
      damage: number;
      message?: number;
    };
    const map: Record<string, DamageTakenRow[]> = {};
    if (!actionLog) return map;
    const start = report.fightStartElapsed;
    const end = start != null ? start + report.fightDurationSeconds : null;
    const push = (player: string, elapsed: number, action: string, damage: number, message?: number) => {
      (map[player] ??= []).push({ elapsed, action, damage, message });
    };
    for (const e of actionLog) {
      const tgts = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' as const }] : []);
      if (e.player === name && !isAutoAttack(e) && !PLACEHOLDER_CAST_NAMES.has(e.name)) {
        if (start != null && end != null && (e.elapsed < start || e.elapsed > end)) continue;
        if (entityId != null && e.playerId != null && e.playerId !== entityId) continue;
        for (const t of tgts) {
          const dmg = t.damage ?? 0;
          if (dmg > 0 && t.mob) push(t.mob, e.elapsed, e.name, dmg, t.message);
        }
        continue;
      }
      if (e.from !== 'boss') {
        if (start != null && end != null && (e.elapsed < start || e.elapsed > end)) continue;
        for (const t of tgts) {
          if (t.mob !== name) continue;
          if (entityId != null && t.id != null && t.id !== entityId) continue;
          const sp = t.spikeEffect;
          if (sp && sp.param && sp.param > 0 && sp.message in REACTIVE_TAKEN_MSG) {
            push(e.player, e.elapsed, REACTIVE_TAKEN_MSG[sp.message], sp.param, sp.message);
          }
        }
      }
    }
    for (const arr of Object.values(map)) arr.sort((a, b) => a.elapsed - b.elapsed);
    return map;
  })();

  const damageReport: DamageEntry[] = (() => {
    const raw: DamageEntry[] = (() => {
      if (entityId == null && report.damageReport && report.damageReport.length > 0) return report.damageReport;
      if (!actionLog) return [];
      const start = report.fightStartElapsed;
      const end   = start != null ? start + report.fightDurationSeconds : null;
      const totals = new Map<string, number>();
      for (const e of actionLog) {
        if (e.from === 'boss') continue;
        if (PLACEHOLDER_CAST_NAMES.has(e.name)) continue;
        if (start != null && end != null && (e.elapsed < start || e.elapsed > end)) continue;
        const tgts = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' as const }] : []);
        for (const t of tgts) {
          if (t.mob !== name) continue;
          if (entityId != null && t.id != null && t.id !== entityId) continue;
          const dmg = t.damage ?? 0;
          if (dmg > 0) totals.set(e.player, (totals.get(e.player) ?? 0) + dmg);
        }
      }
      const groupTotal = Array.from(totals.values()).reduce((s, n) => s + n, 0);
      if (groupTotal === 0) return [];
      return Array.from(totals.entries())
        .map(([player, dmg]) => ({
          name: player,
          damage: dmg,
          percent: +(dmg / groupTotal * 100).toFixed(1),
          isSkillchain: false,
        }))
        .sort((a, b) => b.damage - a.damage);
    })();

    const scByPlayer = new Map<string, number>();
    const players: DamageEntry[] = [];
    for (const e of raw) {
      if (e.isSkillchain) {
        const owner = e.skillchainOwner || e.name.replace(/^SC-/, '');
        scByPlayer.set(owner, (scByPlayer.get(owner) ?? 0) + e.damage);
      } else {
        players.push(e);
      }
    }
    if (scByPlayer.size === 0) return raw;

    const ownerMatch = (owner: string): string | null => {
      if (players.find(p => p.name === owner)) return owner;
      const lo = owner.toLowerCase();
      return players.find(p => p.name.toLowerCase().startsWith(lo))?.name ?? null;
    };

    const merged = players.map(p => {
      const totalDmg = p.damage;
      return { entry: p, baseDmg: totalDmg, scDmg: 0 };
    });
    for (const [owner, scDmg] of scByPlayer) {
      const matched = ownerMatch(owner);
      const slot = matched ? merged.find(m => m.entry.name === matched) : null;
      if (slot) slot.scDmg = (slot.scDmg ?? 0) + scDmg;
    }

    const newTotal = merged.reduce((s, m) => s + m.baseDmg + m.scDmg, 0);
    if (newTotal === 0) return raw;
    return merged
      .map(m => ({
        name: m.entry.name,
        damage: m.baseDmg + m.scDmg,
        percent: +((m.baseDmg + m.scDmg) / newTotal * 100).toFixed(1),
        isSkillchain: false,
        scDamage: m.scDmg > 0 ? m.scDmg : undefined,
      }))
      .sort((a, b) => b.damage - a.damage);
  })();
  const playerDamage = damageReport.filter((d: DamageEntry) => !d.isSkillchain);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const perPlayer = buildPerPlayerStats(report);

  function toggle(playerName: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(playerName)) next.delete(playerName); else next.add(playerName);
      return next;
    });
  }


  return (
    <div className="space-y-3">
      <div className={flush ? '' : (embedded ? 'border border-white/10 rounded-xl p-5' : 'bg-row-even border border-white/10 rounded-xl p-5')}>
        {!flush && (
          <div className="flex items-end justify-between mb-4">
            <div>
              <div className="text-[10px] text-gray-400 uppercase tracking-wide leading-none mb-1">{enemyTerm} Report</div>
              <h4 className="font-bold text-2xl text-amber-400 uppercase tracking-wide leading-none">{displayName ?? name}</h4>
            </div>
            {report.fightDurationSeconds > 0 && (
              <div className="text-right shrink-0">
                <div className="text-[10px] text-gray-400 uppercase tracking-wide leading-none mb-1">Fight Time</div>
                <div className="font-bold text-2xl text-amber-400 leading-none">{formatDuration(report.fightDurationSeconds)}</div>
              </div>
            )}
          </div>
        )}
        <div className="space-y-2">
          {damageReport.map((entry: DamageEntry) => {
            const dps = report.fightDurationSeconds > 0 ? Math.round(entry.damage / report.fightDurationSeconds) : null;
            if (entry.isSkillchain) return null;
            const isOpen = expanded.has(entry.name);
            const playerItems = itemsByPlayer[entry.name];
            const playerActions = actionsByPlayer[entry.name] ?? [];
            const isCor = corsairRolls != null && mainJobKey(jobMap[entry.name]) === 'cor';
            const playerSC = scByPlayer[entry.name];
            const playerDebuffs = debuffsByPlayer[entry.name];
            const playerUpkeep = upkeepByPlayer[entry.name] ?? [];
            const playerDamageTaken = damageTakenByPlayer[entry.name] ?? [];
            const hasStats = (perPlayer[entry.name] && Object.keys(perPlayer[entry.name]).length > 0) || (playerItems != null && playerItems.events.length > 0) || playerActions.length > 0 || isCor || (playerSC != null && playerSC.events.length > 0) || (playerDebuffs != null && playerDebuffs.events.length > 0) || playerUpkeep.length > 0 || playerDamageTaken.length > 0;
            return (
              <div key={entry.name}>
                <button
                  type="button"
                  onClick={() => hasStats && toggle(entry.name)}
                  disabled={!hasStats}
                  className={`w-full flex items-center gap-3 text-left rounded-md py-1 px-1 -mx-1 ${hasStats ? 'hover:bg-white/[0.04] cursor-pointer' : 'cursor-default'}`}
                >
                  {(() => {
                    const icon = mainJobKey(jobMap[entry.name]);
                    return (
                      <div className="w-10 h-10 shrink-0 flex items-center justify-center">
                        {icon && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imgSrc(JOB_ICONS[icon])} alt={icon.toUpperCase()} width={40} height={40} className="object-contain" />
                        )}
                      </div>
                    );
                  })()}
                  <div className="w-40 shrink-0">
                    <div className="text-sm truncate text-white">{entry.name}</div>
                    {jobMap[entry.name] && (
                      <div className="text-xs text-gray-400 font-mono">{jobMap[entry.name]}</div>
                    )}
                  </div>
                  <div
                    className="flex-1 h-2 bg-panel-alt rounded-full overflow-hidden flex"
                    data-tooltip={entry.scDamage ? `Direct: ${(entry.damage - entry.scDamage).toLocaleString()}  ·  Skillchains: ${entry.scDamage.toLocaleString()}` : undefined}
                  >
                    {(() => {
                      const baseWidth = entry.scDamage ? entry.percent * ((entry.damage - entry.scDamage) / entry.damage) : entry.percent;
                      const scWidth = entry.scDamage ? entry.percent - baseWidth : 0;
                      return (
                        <>
                          <div className="h-full bg-amber-500" style={{ width: `${baseWidth}%` }} />
                          {scWidth > 0 && <div className="h-full bg-amber-400/70" style={{ width: `${scWidth}%` }} />}
                        </>
                      );
                    })()}
                  </div>
                  <span className="text-xs text-gray-400 w-12 text-right">{entry.percent}%</span>
                  <div className="w-48 text-right leading-tight">
                    {dps != null ? (
                      <>
                        <div className="text-xs text-gray-400 whitespace-nowrap">
                          {dps.toLocaleString()} <span className="text-gray-400">DPS</span>
                          {entry.scDamage ? (
                            <span className="text-amber-400/85"> (+{Math.round(entry.scDamage / Math.max(1, report.fightDurationSeconds)).toLocaleString()} SC DPS)</span>
                          ) : null}
                        </div>
                        <div className="text-[10px] text-gray-400 whitespace-nowrap">
                          {entry.damage.toLocaleString()} DMG
                          {entry.scDamage ? (
                            <span className="text-amber-400/85"> (+{entry.scDamage.toLocaleString()} SC DMG)</span>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-gray-400 whitespace-nowrap">
                        {entry.damage.toLocaleString()} <span className="text-gray-400">DMG</span>
                        {entry.scDamage ? (
                          <span className="text-amber-400/85"> (+{entry.scDamage.toLocaleString()} SC DMG)</span>
                        ) : null}
                      </div>
                    )}
                  </div>
                </button>
                <Collapse open={isOpen}>{() => {
                  const targetsBossEntry = (e: ActionLogEntry) => {
                    const tgts = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' as const }] : []);
                    return tgts.some(t => t.mob === name);
                  };
                  const isHealSpell = (e: ActionLogEntry) =>
                    isSpell(e) && /^Cur[ae]/.test(e.name);
                  const damageDealtRows = playerActions
                    .filter(e => targetsBossEntry(e) && !isAutoAttack(e) && !isRanged(e) && !isJobAbility(e) && !isEnfeebleSpell(e) && !isAbsorbOrDrain(e))
                    .sort((a, b) => a.elapsed - b.elapsed);
                  const jobAbilityRows = playerActions
                    .filter(e => isJobAbility(e))
                    .sort((a, b) => a.elapsed - b.elapsed);
                  const healingRows = playerActions
                    .filter(e => !targetsBossEntry(e) && isHealSpell(e))
                    .sort((a, b) => a.elapsed - b.elapsed);
                  const ENFEEBLE_NAME_RE = /^(Bind|Gravity|Sleep|Slow|Paralyze|Silence|Blind|Bio|Dia|Poison|Addle|Frazzle|Distract|Inundation|Burn|Frost|Choke|Rasp|Shock|Drown|Aspir|Drain|Stun|Tranquil Heart|Threnody|Carol|Madrigal|Etude|Minuet|March|Mambo|Lullaby|Finale|Elegy|Requiem|Virelai|Pining Nocturne|Pastoral)/i;
                  const isLikelyEnfeebleByName = (e: ActionLogEntry) => isEnfeebleSpell(e) || ENFEEBLE_NAME_RE.test(e.name);
                  const buffRows = playerActions
                    .filter(e => {
                      const tgts = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' as const }] : []);
                      const hasResolvedTarget = tgts.some(t => t.mob && t.mob.length > 0);
                      if (!hasResolvedTarget) return false;
                      return !targetsBossEntry(e) && !isHealSpell(e)
                        && !isJobAbility(e) && !isAutoAttack(e) && !isRanged(e)
                        && !isWeaponSkill(e) && !isMagicBurst(e) && !isLikelyEnfeebleByName(e);
                    })
                    .sort((a, b) => a.elapsed - b.elapsed);
                  // HP damage only - an MP/TP drain's `damage` field is the
                  // siphoned resource, not HP, so it must not inflate the total.
                  const hpDamageOf = (e: ActionLogEntry): number => {
                    const tgts = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' as const }] : []);
                    return tgts.reduce((ss, t) => {
                      const d = drainInfo(t);
                      if (d && !d.addOn && d.resource !== 'HP') return ss; // MP/TP drain: 0 HP damage
                      return ss + (t.damage ?? 0);
                    }, 0);
                  };
                  const totalDamageDealt = damageDealtRows.reduce((s, e) => s + hpDamageOf(e), 0);
                  const playerDamageTakenTotal = playerDamageTaken.reduce((s, r) => s + r.damage, 0);
                  const playerDamageTakenBiggest = playerDamageTaken.reduce((m, r) => Math.max(m, r.damage), 0);
                  const playerMaxHp = party?.find(p => p.name === entry.name)?.maxHp ?? null;
                  const dmgByType: Record<string, number> = {};
                  for (const e of playerActions) {
                    if (!targetsBossEntry(e)) continue;
                    dmgByType[e.type] = (dmgByType[e.type] ?? 0) + hpDamageOf(e);
                  }
                  const totalBossDmg = Object.values(dmgByType).reduce((s, n) => s + n, 0);
                  const dmgSpread = ([
                    { label: 'Weaponskill', bar: 'bg-amber-500',   text: 'text-amber-300',   types: ['ws'] },
                    { label: 'Magic Burst', bar: 'bg-fuchsia-500', text: 'text-fuchsia-300', types: ['mb'] },
                    { label: 'Magic',       bar: 'bg-violet-500',  text: 'text-violet-300',  types: ['spell', 'enfeeb'] },
                    { label: 'Ranged',      bar: 'bg-teal-500',    text: 'text-teal-300',    types: ['ranged'] },
                    { label: 'Ability',     bar: 'bg-emerald-500', text: 'text-emerald-300', types: ['ja'] },
                    { label: 'Auto-Attack', bar: 'bg-sky-500',     text: 'text-sky-300',     types: ['auto'] },
                  ])
                    .map(c => ({ label: c.label, bar: c.bar, text: c.text, dmg: c.types.reduce((s, t) => s + (dmgByType[t] ?? 0), 0) }))
                    .filter(c => c.dmg > 0)
                    .sort((a, b) => b.dmg - a.dmg);
                  const otherDmg = Math.max(0, totalBossDmg - dmgSpread.reduce((s, c) => s + c.dmg, 0));
                  const dmgSegments = otherDmg > 0
                    ? [...dmgSpread, { label: 'Other', bar: 'bg-gray-500', text: 'text-gray-300', dmg: otherDmg }]
                    : dmgSpread;
                  const tpSeries: PartyTpEntry[] = (partyTpLog ?? [])
                    .filter(t => t.player === entry.name)
                    .sort((a, b) => a.elapsed - b.elapsed);
                  const tpForWs = (ws: ActionLogEntry): number | null => {
                    if (typeof ws.tp === 'number') return Math.max(1000, ws.tp);
                    if (tpSeries.length === 0) return null;
                    let bestIdx = -1;
                    for (let i = 0; i < tpSeries.length; i++) {
                      if (tpSeries[i].elapsed <= ws.elapsed) bestIdx = i; else break;
                    }
                    if (bestIdx < 0) return null;
                    for (let i = bestIdx; i >= 0; i--) {
                      if (tpSeries[i].tp >= 1000) return tpSeries[i].tp;
                    }
                    return null;
                  };
                  const wsTpSamples: number[] = [];
                  for (const e of damageDealtRows) {
                    if (!isWeaponSkill(e)) continue;
                    const t = tpForWs(e);
                    if (t != null) wsTpSamples.push(t);
                  }
                  const wsAvgTp = wsTpSamples.length > 0
                    ? { avg: wsTpSamples.reduce((s, n) => s + n, 0) / wsTpSamples.length, count: wsTpSamples.length }
                    : undefined;
                  // The ⚙ that reveals this player's gear snapshot for a cast.
                  const gearCell = (n: string | null | undefined, el: number) => {
                    if (!gearIndex || !n) return null;
                    const ge = gearIndex.lookup(entry.name, n, el);
                    return ge ? <GearReveal entry={ge} changed={gearIndex.changed(entry.name, n, el)} /> : null;
                  };
                  return (
                  <div className="ml-6 mt-2 mb-3 pl-3 border-l border-white/10 space-y-3">
                    <PlayerStatsPanel stats={wsAvgTp ? { ...perPlayer[entry.name], wsAvgTp } : perPlayer[entry.name]} />
                    {totalBossDmg > 0 && dmgSegments.length > 0 && (
                      <DamageSpread segments={dmgSegments} />
                    )}
                    {isCor && corsairRolls && (
                      <div>
                        <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1.5">Corsair Rolls</div>
                        <div className="flex items-center justify-around gap-6 text-sm">
                          <RollBadge label="Miser's"     value={corsairRolls.misers}    lucky={corsairRolls.misersLucky} />
                          <RollBadge label="Tactician's" value={corsairRolls.tactician} lucky={corsairRolls.tacticianLucky} />
                          <RollBadge label="Wild Card"   value={corsairRolls.wildCard}  lucky={false} />
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {/* All 8 tables always render - empty ones show an "Empty"
                          placeholder so the 4×2 grid layout stays stable. */}
                      {/* Row 1: Damage Dealt | Damage Taken */}
                      <PlayerSubTable
                        title="Damage Dealt"
                        titleColor="text-orange-400"
                        summary={`${damageDealtRows.length} skills · ${totalDamageDealt.toLocaleString()} total`}
                        colSpan={5}
                        isEmpty={damageDealtRows.length === 0}
                        headerCells={
                          <>
                            <th className="text-right py-1.5 pl-2 pr-3 w-20">Time</th>
                            <th className="text-left py-1.5 pr-3">Action</th>
                            <th className="text-right py-1.5 pr-3 w-14">TP</th>
                            <th className="text-right py-1.5 pr-3 w-20">Damage</th>
                            <th className="text-left py-1.5 pr-2 w-16">Result</th>
                          </>
                        }
                      >
                        {damageDealtRows.map((e, i) => {
                          const targets = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' as const }] : []);
                          const drain = drainInfo(targets[0]);
                          const hpDmg = hpDamageOf(e);
                          const rawResult = targets[0]?.result ?? 'hit';
                          const spellCast = isSpell(e);
                          const isGeomancy = spellCast && (e.name.startsWith('Geo-') || e.name.startsWith('Indi-'));
                          const result = (spellCast && hpDmg === 0 && rawResult === 'hit' && !isGeomancy && !drain) ? 'resist' : rawResult;
                          const isMiss = result === 'miss' || result === 'resist';
                          const tp = isWeaponSkill(e) ? tpForWs(e) : null;
                          return (
                            <tr key={i} className="border-b border-white/[0.04] last:border-0">
                              <td className="py-1 pl-2 pr-3 text-right text-gray-400 font-mono">{fmtFightTime(e.elapsed, report.fightStartElapsed)}</td>
                              <td className={`py-1 pr-3 truncate ${ACTION_TYPE_STYLE[e.type] ?? 'text-gray-300'}`}>
                                {e.name}
                                {drain && (
                                  <span className="ml-1.5 text-[10px] font-mono text-teal-300 whitespace-nowrap" title={`Siphoned ${drain.amount.toLocaleString()} ${drain.resource}`}>
                                    ⤓{drain.amount.toLocaleString()} {drain.resource}
                                  </span>
                                )}
                                {gearCell(e.name, e.elapsed)}
                              </td>
                              <td className="py-1 pr-3 text-right font-mono">
                                {isWeaponSkill(e)
                                  ? (tp != null ? <span className="text-amber-300">{tp}</span> : <span className="text-gray-400">-</span>)
                                  : <span className="text-gray-700">-</span>}
                              </td>
                              <td className={`py-1 pr-3 text-right font-mono ${hpDmg > 0 ? 'text-gray-200' : 'text-gray-400'}`}>{hpDmg > 0 ? hpDmg.toLocaleString() : '-'}</td>
                              <td className={`py-1 pr-2 ${isMiss ? 'text-red-400' : 'text-emerald-400'}`}>{result}</td>
                            </tr>
                          );
                        })}
                      </PlayerSubTable>
                      <PlayerSubTable
                        title="Damage Taken"
                        titleColor="text-rose-400"
                        summary={`${playerDamageTaken.length} hits · ${playerDamageTakenTotal.toLocaleString()} total${playerDamageTakenBiggest > 0 ? ` · biggest ${playerDamageTakenBiggest.toLocaleString()}` : ''}`}
                        colSpan={5}
                        isEmpty={playerDamageTaken.length === 0}
                        headerCells={
                          <>
                            <th className="text-right py-1.5 pl-2 pr-3 w-20">Time</th>
                            <th className="text-left py-1.5 pr-3">Boss Action</th>
                            <th className="text-left py-1.5 pr-3 w-24">Type</th>
                            <th className="text-right py-1.5 pr-3 w-20">Damage</th>
                            <th className="text-right py-1.5 pr-2 w-28">% Max HP</th>
                          </>
                        }
                      >
                        {playerDamageTaken.map((r, i) => {
                          const t = dmgTakenType(r.message);
                          const pct = playerMaxHp ? (r.damage / playerMaxHp) * 100 : null;
                          return (
                            <tr key={i} className="border-b border-white/[0.04] last:border-0">
                              <td className="py-1 pl-2 pr-3 text-right text-gray-400 font-mono">{fmtFightTime(r.elapsed, report.fightStartElapsed)}</td>
                              <td className="py-1 pr-3 text-rose-300">{r.action}</td>
                              <td className={`py-1 pr-3 ${t.color}`}>{t.label}</td>
                              <td className="py-1 pr-3 text-right font-mono text-rose-400">{r.damage.toLocaleString()}</td>
                              <td className="py-1 pr-2">
                                {pct != null ? (
                                  <div className="flex items-center gap-1.5 justify-end">
                                    <div className="relative h-1.5 w-14 rounded-full bg-white/[0.06] overflow-hidden">
                                      <div className="absolute inset-y-0 left-0 rounded-full bg-rose-500/70" style={{ width: `${Math.min(100, pct)}%` }} />
                                    </div>
                                    <span className="font-mono text-xs text-gray-300 w-8 text-right">{pct >= 1 ? `${Math.round(pct)}%` : '<1%'}</span>
                                  </div>
                                ) : (
                                  <span className="block text-right text-gray-400">-</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </PlayerSubTable>
                      {/* Row 2: Debuffs | Buffs */}
                      <div>
                        <DebuffUpkeepInline rows={playerUpkeep} />
                      <PlayerSubTable
                        title="Debuffs & Enfeebling"
                        titleColor="text-fuchsia-400"
                        summary={(() => {
                          const evs = playerDebuffs?.events ?? [];
                          const ib = evs.filter(e => e.immunobreak).length;
                          const resisted = evs.filter(e => e.resisted && !e.immunobreak).length;
                          const landed = evs.length - resisted - ib;
                          const parts: string[] = [];
                          if (landed > 0) parts.push(`${landed} landed`);
                          if (ib > 0) parts.push(`${ib} IB`);
                          if (resisted > 0) parts.push(`${resisted} resisted`);
                          return parts.length > 0 ? parts.join(' · ') : `${evs.length} applied`;
                        })()}
                        colSpan={3}
                        isEmpty={!playerDebuffs || playerDebuffs.events.length === 0}
                        headerCells={
                          <>
                            <th className="text-right py-1.5 pl-2 pr-3 w-20">Time</th>
                            <th className="text-left py-1.5 pr-3">Action</th>
                            <th className="text-left py-1.5 pr-2">Status</th>
                          </>
                        }
                      >
                        {(playerDebuffs?.events ?? []).map((ev, i) => (
                          <tr key={i} className="border-b border-white/[0.04] last:border-0">
                            <td className="py-1 pl-2 pr-3 text-right text-gray-400 font-mono">{fmtFightTime(ev.elapsed, report.fightStartElapsed)}</td>
                            <td className="py-1 pr-3 text-fuchsia-200">{ev.action ?? <span className="text-gray-400">-</span>}{gearCell(ev.action, ev.elapsed)}</td>
                            <td className={`py-1 pr-2 truncate ${ev.immunobreak ? 'text-amber-300' : ev.resisted ? 'text-rose-400' : ev.status?.startsWith('−') ? 'text-teal-300' : 'text-rose-300'}`}>
                              {ev.immunobreak
                                ? <span className="inline-flex items-center gap-1.5"><span className="text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-amber-500/15 border border-amber-500/40">IB</span>Immunobreak!</span>
                                : ev.resisted
                                  ? 'resisted'
                                  : ev.status
                                    ? <span className="inline-flex items-center gap-1.5"><BuffIcon id={ev.statusId} />{ev.status}</span>
                                    : <span className="text-gray-400">-</span>}
                            </td>
                          </tr>
                        ))}
                      </PlayerSubTable>
                      </div>
                      <PlayerSubTable
                        title="Buffs"
                        titleColor="text-violet-400"
                        summary={`${buffRows.length} actions`}
                        colSpan={3}
                        isEmpty={buffRows.length === 0}
                        headerCells={
                          <>
                            <th className="text-right py-1.5 pl-2 pr-3 w-20">Time</th>
                            <th className="text-left py-1.5 pr-3">Action</th>
                            <th className="text-left py-1.5 pr-2">Target</th>
                          </>
                        }
                      >
                        {buffRows.map((e, i) => {
                          const targets = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' as const }] : []);
                          const targetList = targets.map(t => t.mob).filter(Boolean);
                          const targetLabel = targetList.length === 0 ? '-' : targetList.length === 1 ? targetList[0] : `${targetList[0]} +${targetList.length - 1}`;
                          return (
                            <tr key={i} className="border-b border-white/[0.04] last:border-0">
                              <td className="py-1 pl-2 pr-3 text-right text-gray-400 font-mono">{fmtFightTime(e.elapsed, report.fightStartElapsed)}</td>
                              <td className={`py-1 pr-3 truncate ${ACTION_TYPE_STYLE[e.type] ?? 'text-gray-300'}`}>{e.name}{gearCell(e.name, e.elapsed)}</td>
                              <td className="py-1 pr-2 truncate text-gray-400">{targetLabel}</td>
                            </tr>
                          );
                        })}
                      </PlayerSubTable>
                      {/* Row 3: Healing | Job Abilities */}
                      <PlayerSubTable
                        title="Healing"
                        titleColor="text-emerald-400"
                        summary={`${healingRows.length} casts`}
                        colSpan={4}
                        isEmpty={healingRows.length === 0}
                        headerCells={
                          <>
                            <th className="text-right py-1.5 pl-2 pr-3 w-20">Time</th>
                            <th className="text-left py-1.5 pr-3">Spell</th>
                            <th className="text-left py-1.5 pr-3">Target</th>
                            <th className="text-right py-1.5 pr-2 w-20">Amount</th>
                          </>
                        }
                      >
                        {healingRows.map((e, i) => {
                          const targets = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' as const }] : []);
                          const dmg = targets.reduce((s, t) => s + (t.damage ?? 0), 0);
                          const targetList = targets.map(t => t.mob).filter(Boolean);
                          const targetLabel = targetList.length === 0 ? '-' : targetList.length === 1 ? targetList[0] : `${targetList[0]} +${targetList.length - 1}`;
                          return (
                            <tr key={i} className="border-b border-white/[0.04] last:border-0">
                              <td className="py-1 pl-2 pr-3 text-right text-gray-400 font-mono">{fmtFightTime(e.elapsed, report.fightStartElapsed)}</td>
                              <td className="py-1 pr-3 text-sky-300">{e.name}{gearCell(e.name, e.elapsed)}</td>
                              <td className="py-1 pr-3 truncate text-gray-400">{targetLabel}</td>
                              <td className={`py-1 pr-2 text-right font-mono ${dmg > 0 ? 'text-emerald-300' : 'text-gray-400'}`}>{dmg > 0 ? dmg.toLocaleString() : '-'}</td>
                            </tr>
                          );
                        })}
                      </PlayerSubTable>
                      <PlayerSubTable
                        title="Job Abilities"
                        titleColor="text-teal-300"
                        summary={`${jobAbilityRows.length} uses`}
                        colSpan={3}
                        isEmpty={jobAbilityRows.length === 0}
                        headerCells={
                          <>
                            <th className="text-right py-1.5 pl-2 pr-3 w-20">Time</th>
                            <th className="text-left py-1.5 pr-3">Ability</th>
                            <th className="text-left py-1.5 pr-2">Target</th>
                          </>
                        }
                      >
                        {jobAbilityRows.map((e, i) => {
                          const targets = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' as const }] : []);
                          const targetList = targets.map(t => t.mob).filter(Boolean);
                          const targetLabel = targetList.length === 0 ? '-' : targetList.length === 1 ? targetList[0] : `${targetList[0]} +${targetList.length - 1}`;
                          const isSp = SP_ABILITIES.has(e.name);
                          return (
                            <tr key={i} className={`border-b border-white/[0.04] last:border-0 ${isSp ? 'bg-fuchsia-500/10' : ''}`}>
                              <td className="py-1 pl-2 pr-3 text-right text-gray-400 font-mono">{fmtFightTime(e.elapsed, report.fightStartElapsed)}</td>
                              <td className="py-1 pr-3">
                                {isSp ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <span className="text-[9px] font-bold text-fuchsia-200 bg-fuchsia-500/30 border border-fuchsia-400/40 rounded px-1 leading-tight">SP</span>
                                    <span className="text-fuchsia-300 font-bold">{e.name}</span>
                                  </span>
                                ) : (
                                  <span className="text-emerald-300">{e.name}</span>
                                )}
                                {gearCell(e.name, e.elapsed)}
                              </td>
                              <td className="py-1 pr-2 truncate text-gray-400">{targetLabel}</td>
                            </tr>
                          );
                        })}
                      </PlayerSubTable>
                      {/* Row 4: Items Used | Skillchains */}
                      <PlayerSubTable
                        title="Items Used"
                        titleColor="text-sky-300"
                        summary={`${(playerItems?.events.length ?? 0)} uses`}
                        colSpan={2}
                        isEmpty={!playerItems || playerItems.events.length === 0}
                        headerCells={
                          <>
                            <th className="text-right py-1.5 pl-2 pr-3 w-20">Time</th>
                            <th className="text-left py-1.5 pr-3">Item</th>
                          </>
                        }
                      >
                        {(playerItems?.events ?? []).map((ev, i) => (
                          <tr key={i} className="border-b border-white/[0.04] last:border-0">
                            <td className="py-1 pl-2 pr-3 text-right text-gray-400 font-mono">{fmtFightTime(ev.elapsed, report.fightStartElapsed)}</td>
                            <td className="py-1 pr-3 text-sky-300">{ev.item}</td>
                          </tr>
                        ))}
                      </PlayerSubTable>
                      <PlayerSubTable
                        title="Skillchains"
                        titleColor="text-amber-300"
                        summary={`${(playerSC?.events.length ?? 0)} closes · ${(playerSC?.total ?? 0).toLocaleString()} damage`}
                        colSpan={4}
                        isEmpty={!playerSC || playerSC.events.length === 0}
                        headerCells={
                          <>
                            <th className="text-right py-1.5 pl-2 pr-3 w-20">Time</th>
                            <th className="text-left py-1.5 pr-3">Skillchain</th>
                            <th className="text-left py-1.5 pr-3">Closing WS</th>
                            <th className="text-right py-1.5 pr-2 w-20">Damage</th>
                          </>
                        }
                      >
                        {(playerSC?.events ?? []).map((ev, i) => (
                          <tr key={i} className="border-b border-white/[0.04] last:border-0">
                            <td className="py-1 pl-2 pr-3 text-right text-gray-400 font-mono">{fmtFightTime(ev.elapsed, report.fightStartElapsed)}</td>
                            <td className="py-1 pr-3 text-amber-200">{ev.sc}</td>
                            <td className="py-1 pr-3 text-gray-300">{ev.ws}</td>
                            <td className="py-1 pr-2 text-right font-mono text-amber-300/80">{ev.damage.toLocaleString()}</td>
                          </tr>
                        ))}
                      </PlayerSubTable>
                    </div>
                  </div>
                  );
                }}</Collapse>
              </div>
            );
          })}
        </div>

        {actionLog && party && (
          <BossActionTimeline
            bossName={name}
            entityId={entityId}
            actionLog={actionLog}
            party={party}
            bossReports={bossReports ?? null}
            aminon={aminon ?? null}
            bossHpLog={bossHpLog ?? null}
            partyHpLog={partyHpLog ?? null}
            partyMpLog={partyMpLog ?? null}
            partyTpLog={partyTpLog ?? null}
            itemUseLog={itemUseLog ?? null}
            buffLog={buffLog ?? null}
            gearByPlayer={gearByPlayer ?? null}
            bare
          />
        )}
      </div>

      {middleSlot}
    </div>
  );
}
