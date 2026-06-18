import type {
  RunRecord,
  AminonData,
  DamageEntry,
  WsEntry,
  PctEntry,
  AvgEntry,
  ActionLogEntry,
  BossHpEntry,
} from './types';
import { combatStatsFromActionLog } from './combatStats';
import type { ParseCombatStats, ParseMobData, ParsePlayerCombat, ParseStatLeaf } from './types';

function totalDamageFor(mobData: ParseMobData): number {
  let total = 0;
  for (const d of Object.values(mobData)) total += d.total_damage ?? 0;
  return total;
}

function damageReportFor(mobData: ParseMobData): DamageEntry[] {
  const total = totalDamageFor(mobData);
  if (total <= 0) return [];
  const out: DamageEntry[] = [];
  for (const [player, d] of Object.entries(mobData)) {
    const dmg = d.total_damage ?? 0;
    if (dmg <= 0) continue;
    const isSc = player.startsWith('SC-');
    const entry: DamageEntry = {
      name: player,
      damage: dmg,
      percent: Math.round((dmg / total) * 1000) / 10,
      isSkillchain: isSc,
    };
    if (isSc) entry.skillchainOwner = player.slice(3);
    out.push(entry);
  }
  out.sort((a, b) => b.damage - a.damage);
  return out;
}

function leafTally(leaf: ParseStatLeaf | undefined): number { return leaf?.tally ?? 0; }
function leafDamage(leaf: ParseStatLeaf | undefined): number { return leaf?.damage ?? 0; }

function statsFor(mobData: ParseMobData): {
  accuracy: PctEntry[];
  critRate: PctEntry[];
  meleeAverage: AvgEntry[];
  meleeCritAverage: AvgEntry[];
  wsAverages: WsEntry[];
  wsAccuracy: PctEntry[];
} {
  const accuracy: PctEntry[] = [];
  const critRate: PctEntry[] = [];
  const meleeAverage: AvgEntry[] = [];
  const meleeCritAverage: AvgEntry[] = [];
  const wsAverages: WsEntry[] = [];
  const wsAccuracy: PctEntry[] = [];

  for (const [player, d] of Object.entries(mobData)) {
    if (player.startsWith('SC-')) continue;
    const m: NonNullable<ParsePlayerCombat['melee']> = d.melee ?? {};
    const mHits = leafTally(m.melee);
    const mDmg = leafDamage(m.melee);
    const mCrits = leafTally(m.crit);
    const cDmg = leafDamage(m.crit);
    const mMisses = leafTally(m.miss);

    const totalSwings = mHits + mCrits + mMisses;
    if (totalSwings > 0) {
      const pct = ((mHits + mCrits) / totalSwings) * 100;
      accuracy.push({ name: player, pct: Math.round(pct * 100) / 100, count: totalSwings });
    }

    const landed = mHits + mCrits;
    if (landed > 0) {
      const pct = (mCrits / landed) * 100;
      critRate.push({ name: player, pct: Math.round(pct * 100) / 100, count: landed });
    }
    if (mHits > 0) meleeAverage.push({ name: player, avg: Math.floor(mDmg / mHits), count: mHits });
    if (mCrits > 0) meleeCritAverage.push({ name: player, avg: Math.floor(cDmg / mCrits), count: mCrits });

    const cat = d.category ?? {};
    const wsData = cat.ws ?? {};
    const wmData = cat.ws_miss ?? {};
    let wsHits = 0, wsDmg = 0, wsMiss = 0;
    for (const v of Object.values(wsData)) {
      wsHits += v.tally ?? 0;
      wsDmg += v.damage ?? 0;
    }
    for (const v of Object.values(wmData)) wsMiss += v.tally ?? 0;
    const totalWs = wsHits + wsMiss;
    if (totalWs > 0) {
      const pct = (wsHits / totalWs) * 100;
      wsAccuracy.push({ name: player, pct: Math.round(pct * 100) / 100, count: totalWs });
    }
    if (wsHits > 0) wsAverages.push({ name: player, wsAvg: Math.floor(wsDmg / wsHits), count: wsHits });
  }

  accuracy.sort((a, b) => b.pct - a.pct);
  critRate.sort((a, b) => b.pct - a.pct);
  meleeAverage.sort((a, b) => b.avg - a.avg);
  meleeCritAverage.sort((a, b) => b.avg - a.avg);
  wsAverages.sort((a, b) => b.wsAvg - a.wsAvg);
  wsAccuracy.sort((a, b) => b.pct - a.pct);
  return { accuracy, critRate, meleeAverage, meleeCritAverage, wsAverages, wsAccuracy };
}

function actionTouchesAminon(e: ActionLogEntry): boolean {
  if (e.player === 'Aminon') return true;
  if (e.mob === 'Aminon') return true;
  if (e.targets?.some(t => t.mob === 'Aminon')) return true;
  return false;
}

function minHpPctFor(bossHpLog: BossHpEntry[] | null): number | undefined {
  if (!bossHpLog || bossHpLog.length === 0) return undefined;
  let lowest: number | null = null;
  for (const h of bossHpLog) {
    if (h.name !== 'Aminon') continue;
    if (typeof h.hpp !== 'number') continue;
    if (lowest === null || h.hpp < lowest) lowest = h.hpp;
  }
  return lowest === null ? undefined : lowest;
}

export interface SynthesizedAminon extends AminonData {
  synthesized: true;
}

export function isSynthesizedAminon(a: AminonData | SynthesizedAminon | null | undefined): a is SynthesizedAminon {
  return !!a && (a as SynthesizedAminon).synthesized === true;
}

export function synthesizeAminonReport(r: RunRecord): SynthesizedAminon | null {
  const actionLog = r.action_log ?? null;
  if (!actionLog || actionLog.length === 0) return null;

  const aminonActions = actionLog.filter(actionTouchesAminon);
  if (aminonActions.length === 0) return null;

  let firstElapsed = Infinity;
  let lastElapsed = -Infinity;
  for (const e of aminonActions) {
    if (e.elapsed < firstElapsed) firstElapsed = e.elapsed;
    if (e.elapsed > lastElapsed) lastElapsed = e.elapsed;
  }
  if (!Number.isFinite(firstElapsed) || !Number.isFinite(lastElapsed)) return null;

  const killed = (r.defeated_bosses ?? []).includes('Aminon');
  const fightStartElapsed = firstElapsed;
  let fightDurationSeconds = Math.max(0, lastElapsed - firstElapsed);
  if (!killed) {
    const zoneTime = r.area_times?.aminon ?? 0;
    if (zoneTime > fightDurationSeconds) fightDurationSeconds = zoneTime;
  }

  const stats: ParseCombatStats = combatStatsFromActionLog(
    actionLog,
    r.party ?? [],
    r.skillchain_log ?? null,
    ['Aminon'],
  );
  const mobData = stats['Aminon'];
  const damageReport = mobData ? damageReportFor(mobData) : [];
  const derived = mobData
    ? statsFor(mobData)
    : { accuracy: [], critRate: [], meleeAverage: [], meleeCritAverage: [], wsAverages: [], wsAccuracy: [] };

  return {
    synthesized: true,
    mode: 'normal',
    killed,
    minHpPct: minHpPctFor(r.boss_hp_log ?? null),
    damageReport,
    wsAverages: derived.wsAverages,
    fightDurationSeconds,
    fightStartElapsed,
    rolls: null,
    wsAccuracy: derived.wsAccuracy,
    accuracy: derived.accuracy,
    critRate: derived.critRate,
    meleeAverage: derived.meleeAverage,
    meleeCritAverage: derived.meleeCritAverage,
  };
}
