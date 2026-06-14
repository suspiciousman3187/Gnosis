
import type { Encounter } from './encounter';
import type {
  ActionLogEntry, PctEntry, AvgEntry, WsEntry, PartyMember, SkillchainEntry,
  ParseCombatStats, ParsePlayerCombat, ParseStatLeaf,
} from './types';
import { canonicalTypeOf, isAutoAttack } from './actionCategory';

// Ported from Parse's offense/defense action-message tables.
export const M = {
  meleeHit: new Set([1]), meleeCrit: new Set([67]), meleeMiss: new Set([15, 63]),
  rangedHit: new Set([352, 576, 577]), rangedCrit: new Set([353]), rangedMiss: new Set([354]),
  wsHit: new Set([185, 187, 197]), wsMiss: new Set([188]),
  enfeebLand: new Set([82, 236, 754, 755]), enfeebMiss: new Set([85, 284, 653, 654, 655, 656]),
  defHit: new Set([1, 67]), defEvade: new Set([15, 282]),
};

export type Swing = { m?: number; d?: number; r?: number };
export const swingsOf = (t: { swings?: Swing[]; message?: number; damage?: number; reaction?: number }): Swing[] =>
  t.swings && t.swings.length > 0 ? t.swings : [{ m: t.message, d: t.damage, r: t.reaction }];

const pct = (n: number, d: number) => +((n / d) * 100).toFixed(2);

export function statsForEnemy(actionLog: ActionLogEntry[] | null | undefined, mobName: string, start: number, end: number, entityId?: number) {
  type Off = { mHit: number; mCrit: number; mMiss: number; mDmg: number; mCritDmg: number; rHit: number; rCrit: number; rMiss: number; rDmg: number; rCritDmg: number; wsHit: number; wsMiss: number; wsDmg: number; magLand: number; magMiss: number; mRounds: number; mStrikes: number };
  type Def = { hit: number; evade: number; block: number; parry: number };
  const off: Record<string, Off> = {};
  const def: Record<string, Def> = {};
  const getOff = (n: string) => (off[n] ??= { mHit: 0, mCrit: 0, mMiss: 0, mDmg: 0, mCritDmg: 0, rHit: 0, rCrit: 0, rMiss: 0, rDmg: 0, rCritDmg: 0, wsHit: 0, wsMiss: 0, wsDmg: 0, magLand: 0, magMiss: 0, mRounds: 0, mStrikes: 0 });
  const getDef = (n: string) => (def[n] ??= { hit: 0, evade: 0, block: 0, parry: 0 });

  for (const e of actionLog ?? []) {
    if (e.elapsed < start || e.elapsed > end) continue;
    if (e.phase === 'start') continue;
    if (e.from === 'boss') {
      if (e.player !== mobName || !isAutoAttack(e)) continue;
      // Per-instance: only this entity's auto-attacks. Legacy entries without
      // playerId still pass when scoping by name (best-effort, same as v1 data).
      if (entityId != null && e.playerId != null && e.playerId !== entityId) continue;
      for (const t of e.targets ?? []) {
        const d = getDef(t.mob);
        for (const s of swingsOf(t)) {
          if (s.r === 12) d.block++;
          else if (s.r === 11) d.parry++;
          else if (s.m != null && M.defEvade.has(s.m)) d.evade++;
          else if (s.m != null && M.defHit.has(s.m)) d.hit++;
        }
      }
      continue;
    }
    for (const t of e.targets ?? []) {
      if (t.mob !== mobName) continue;
      if (entityId != null && t.id != null && t.id !== entityId) continue;
      const a = getOff(e.player);
      let connect = 0;
      for (const s of swingsOf(t)) {
        const m = s.m, dmg = s.d || 0;
        if (m == null) continue;
        if (M.meleeCrit.has(m)) { a.mCrit++; a.mDmg += dmg; a.mCritDmg += dmg; connect++; }
        else if (M.meleeHit.has(m)) { a.mHit++; a.mDmg += dmg; connect++; }
        else if (M.meleeMiss.has(m)) { a.mMiss++; }
        else if (M.rangedCrit.has(m)) { a.rCrit++; a.rDmg += dmg; a.rCritDmg += dmg; }
        else if (M.rangedHit.has(m)) { a.rHit++; a.rDmg += dmg; }
        else if (M.rangedMiss.has(m)) { a.rMiss++; }
        else if (M.wsHit.has(m)) { a.wsHit++; a.wsDmg += dmg; }
        else if (M.wsMiss.has(m)) { a.wsMiss++; }
        else if (M.enfeebLand.has(m)) { a.magLand++; }
        else if (M.enfeebMiss.has(m)) { a.magMiss++; }
      }
      if (isAutoAttack(e) && connect > 0) { a.mRounds++; a.mStrikes += connect; }
    }
  }

  const accuracy: PctEntry[] = [], critRate: PctEntry[] = [], wsAccuracy: PctEntry[] = [];
  const rangedAccuracy: PctEntry[] = [], rangedCritRate: PctEntry[] = [], magicAccuracy: PctEntry[] = [];
  const evadeRate: PctEntry[] = [], parryRate: PctEntry[] = [], blockRate: PctEntry[] = [];
  const meleeAverage: AvgEntry[] = [], meleeCritAverage: AvgEntry[] = [], rangedAverage: AvgEntry[] = [];
  const attacksPerRound: AvgEntry[] = [];
  const wsAverages: WsEntry[] = [];

  for (const [name, a] of Object.entries(off)) {
    const mLanded = a.mHit + a.mCrit, mTotal = mLanded + a.mMiss;
    if (mTotal > 0)  accuracy.push({ name, pct: pct(mLanded, mTotal), count: mTotal });
    if (mLanded > 0) critRate.push({ name, pct: pct(a.mCrit, mLanded), count: mLanded });
    if (mLanded > 0) meleeAverage.push({ name, avg: Math.floor(a.mDmg / mLanded), count: mLanded });
    if (a.mCrit > 0) meleeCritAverage.push({ name, avg: Math.floor(a.mCritDmg / a.mCrit), count: a.mCrit });
    if (a.mRounds > 0) attacksPerRound.push({ name, avg: +(a.mStrikes / a.mRounds).toFixed(2), count: a.mRounds });

    const rLanded = a.rHit + a.rCrit, rTotal = rLanded + a.rMiss;
    if (rTotal > 0)  rangedAccuracy.push({ name, pct: pct(rLanded, rTotal), count: rTotal });
    if (rLanded > 0) rangedCritRate.push({ name, pct: pct(a.rCrit, rLanded), count: rLanded });
    if (rLanded > 0) rangedAverage.push({ name, avg: Math.floor(a.rDmg / rLanded), count: rLanded });

    const wsTotal = a.wsHit + a.wsMiss;
    if (wsTotal > 0) wsAccuracy.push({ name, pct: pct(a.wsHit, wsTotal), count: wsTotal });
    if (a.wsHit > 0) wsAverages.push({ name, wsAvg: Math.floor(a.wsDmg / a.wsHit), count: a.wsHit });

    const mag = a.magLand + a.magMiss;
    if (mag > 0) magicAccuracy.push({ name, pct: pct(a.magLand, mag), count: mag });
  }
  for (const [name, d] of Object.entries(def)) {
    const total = d.hit + d.evade + d.block + d.parry;
    if (total > 0) {
      evadeRate.push({ name, pct: pct(d.evade, total), count: total });
      if (d.parry > 0) parryRate.push({ name, pct: pct(d.parry, total), count: total });
      if (d.block > 0) blockRate.push({ name, pct: pct(d.block, total), count: total });
    }
  }

  const byPct = (x: PctEntry, y: PctEntry) => y.pct - x.pct;
  const byAvg = (x: AvgEntry, y: AvgEntry) => y.avg - x.avg;
  accuracy.sort(byPct); critRate.sort(byPct); wsAccuracy.sort(byPct);
  rangedAccuracy.sort(byPct); rangedCritRate.sort(byPct); magicAccuracy.sort(byPct);
  evadeRate.sort(byPct); parryRate.sort(byPct); blockRate.sort(byPct);
  meleeAverage.sort(byAvg); meleeCritAverage.sort(byAvg); rangedAverage.sort(byAvg);
  wsAverages.sort((x, y) => y.wsAvg - x.wsAvg);

  return {
    accuracy, critRate, meleeAverage, meleeCritAverage, wsAccuracy, wsAverages,
    rangedAccuracy, rangedCritRate, rangedAverage, magicAccuracy, attacksPerRound,
    evadeRate, parryRate, blockRate,
  };
}

export function combatStatsFromActionLog(
  actionLog: ActionLogEntry[] | null | undefined,
  party: PartyMember[],
  skillchainLog?: SkillchainEntry[] | null,
  enemyNames?: Iterable<string>,
): ParseCombatStats {
  const log = actionLog ?? [];
  const partyNames = new Set(party.map(p => p.name));
  const enemySet = new Set(enemyNames ?? []);
  for (const n of partyNames) enemySet.delete(n);
  const partySet = new Set(partyNames);
  for (const e of log) {
    if (e.actorRole) {
      if (e.actorRole === 'pet' && e.actorPetOf && partyNames.has(e.actorPetOf)) partySet.add(e.player);
      continue;
    }
    if (e.from === 'boss' || e.from === 'enemy' || e.from === 'buff' || e.from === 'item') continue;
    if (enemySet.has(e.player)) continue;
    if (e.actorPetOf && partyNames.has(e.actorPetOf)) { partySet.add(e.player); continue; }
    const tg = e.targets ?? (e.mob ? [{ mob: e.mob }] : []);
    if (tg.some(t => t.mob === e.player)) partySet.add(e.player);
  }
  const stats: ParseCombatStats = {};

  const player = (mob: string, name: string): ParsePlayerCombat => {
    const md = (stats[mob] ??= {});
    return (md[name] ??= { total_damage: 0, melee: {}, ranged: {}, category: {}, multi: {}, defense: {}, other: {} });
  };
  const inc = (m: Record<string, ParseStatLeaf> | undefined, key: string, dmg = 0) => {
    if (!m) return;
    const l = (m[key] ??= { tally: 0, damage: 0 });
    l.tally = (l.tally ?? 0) + 1;
    l.damage = (l.damage ?? 0) + dmg;
    if (dmg > (l.max ?? 0)) l.max = dmg;
  };
  const incAbility = (cat: NonNullable<ParsePlayerCombat['category']>, group: keyof NonNullable<ParsePlayerCombat['category']>, name: string, dmg: number) => {
    const map = (cat[group] ??= {});
    inc(map, name, dmg);
  };

  for (const e of log) {
    if (e.from === 'buff') continue;
    const tgts = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' as const }] : []);

    if (!partySet.has(e.player)) {
      const mob = e.player;
      for (const t of tgts) {
        if (!partySet.has(t.mob)) continue;
        const def = player(mob, t.mob).defense!;
        for (const s of swingsOf(t)) {
          if (s.r === 12) inc(def, 'block');
          else if (s.r === 11) inc(def, 'parry');
          else if (s.m != null && M.defEvade.has(s.m)) inc(def, 'evade');
          else if (s.m != null && M.defHit.has(s.m)) { inc(def, 'hit', s.d || 0); inc(def, 'nonblock'); inc(def, 'nonparry'); }
        }
      }
      continue;
    }

    for (const t of tgts) {
      if (partySet.has(t.mob)) continue;
      if (t.petOf) continue;
      const pc = player(t.mob, e.player);
      const dmg = t.damage || 0;
      pc.total_damage = (pc.total_damage ?? 0) + dmg;
      const cat = pc.category!;

      switch (canonicalTypeOf(e)) {
        case 'auto': {
          let connect = 0;
          for (const s of swingsOf(t)) {
            if (s.m == null) continue;
            if (M.meleeCrit.has(s.m)) { inc(pc.melee, 'crit', s.d || 0); connect++; }
            else if (M.meleeHit.has(s.m)) { inc(pc.melee, 'melee', s.d || 0); connect++; }
            else if (M.meleeMiss.has(s.m)) inc(pc.melee, 'miss');
          }
          if (connect > 0) inc(pc.multi, String(Math.min(connect, 8)));
          break;
        }
        case 'ranged':
          for (const s of swingsOf(t)) {
            if (s.m == null) continue;
            if (M.rangedCrit.has(s.m)) inc(pc.ranged, 'r_crit', s.d || 0);
            else if (M.rangedHit.has(s.m)) inc(pc.ranged, 'ranged', s.d || 0);
            else if (M.rangedMiss.has(s.m)) inc(pc.ranged, 'r_miss');
          }
          break;
        case 'ws':
          if (t.result === 'miss' || (t.message != null && M.wsMiss.has(t.message))) incAbility(cat, 'ws_miss', e.name, 0);
          else incAbility(cat, 'ws', e.name, dmg);
          break;
        case 'ja':  incAbility(cat, 'ja', e.name, dmg); break;
        case 'spell': incAbility(cat, 'spell', e.name, dmg); break;
        case 'mb':  incAbility(cat, 'mb', e.name, dmg); break;
        case 'enfeeb':
          if (t.result === 'resist' || (t.message != null && M.enfeebMiss.has(t.message))) incAbility(cat, 'enfeeb_miss', e.name, 0);
          else incAbility(cat, 'enfeeb', e.name, dmg);
          break;
      }

      if (t.addEffect?.param) inc(pc.other, 'add', t.addEffect.param);
      if (t.spikeEffect?.param) inc(pc.other, 'spike', t.spikeEffect.param);
    }
  }

  for (const sc of skillchainLog ?? []) {
    if (!sc.mob || !sc.closer) continue;
    if (partySet.has(sc.mob)) continue;
    const scKey = `SC-${sc.closer}`;
    const md = (stats[sc.mob] ??= {});
    const virt = (md[scKey] ??= { total_damage: 0 });
    virt.total_damage = (virt.total_damage ?? 0) + (sc.damage || 0);
    inc(player(sc.mob, sc.closer).other, 'sc', sc.damage || 0);
  }

  return stats;
}

// ── Per-encounter scorecard (for Trends / comparison) ────────────────────────

export interface PlayerMetric {
  player: string;
  job: string | null;
  totalDamage: number;
  dps: number;
  damagePct: number;          // share of party damage to enemies
  meleeAccPct: number | null;
  critPct: number | null;
  meleeAvg: number | null;
  wsAvg: number | null;
  wsCount: number;
  rangedAccPct: number | null;
  magicAccPct: number | null;
}

export interface EncounterMetrics {
  players: PlayerMetric[];
  totalDamage: number;        // all party members to all enemies
}

// Whole-encounter per-player aggregation across every enemy.
export function playerMetricsForEncounter(enc: Encounter): EncounterMetrics {
  const enemyNames = new Set((Array.isArray(enc.enemies) ? enc.enemies : []).map(e => e.name));
  const dur = Math.max(1, enc.durationSeconds || 1);
  const jobByName: Record<string, string | null> = {};
  for (const p of enc.party ?? []) jobByName[p.name] = p.mainJob || null;

  type Acc = { dmg: number; mHit: number; mCrit: number; mMiss: number; mDmg: number; rHit: number; rCrit: number; rMiss: number; wsHit: number; wsDmg: number; magLand: number; magMiss: number };
  const by: Record<string, Acc> = {};
  const get = (n: string) => (by[n] ??= { dmg: 0, mHit: 0, mCrit: 0, mMiss: 0, mDmg: 0, rHit: 0, rCrit: 0, rMiss: 0, wsHit: 0, wsDmg: 0, magLand: 0, magMiss: 0 });

  for (const e of enc.actionLog ?? []) {
    if (e.from === 'boss') continue;
    for (const t of e.targets ?? []) {
      if (!enemyNames.has(t.mob)) continue;
      const a = get(e.player);
      a.dmg += t.damage || 0;
      for (const s of swingsOf(t)) {
        const m = s.m, dmg = s.d || 0;
        if (m == null) continue;
        if (M.meleeCrit.has(m)) { a.mCrit++; a.mDmg += dmg; }
        else if (M.meleeHit.has(m)) { a.mHit++; a.mDmg += dmg; }
        else if (M.meleeMiss.has(m)) { a.mMiss++; }
        else if (M.rangedCrit.has(m)) { a.rCrit++; }
        else if (M.rangedHit.has(m)) { a.rHit++; }
        else if (M.rangedMiss.has(m)) { a.rMiss++; }
        else if (M.wsHit.has(m)) { a.wsHit++; a.wsDmg += dmg; }
        else if (M.enfeebLand.has(m)) { a.magLand++; }
        else if (M.enfeebMiss.has(m)) { a.magMiss++; }
      }
    }
  }

  let totalDamage = 0;
  for (const a of Object.values(by)) totalDamage += a.dmg;

  const players: PlayerMetric[] = Object.entries(by).map(([player, a]) => {
    const mLanded = a.mHit + a.mCrit, mTotal = mLanded + a.mMiss;
    const rTotal = a.rHit + a.rCrit + a.rMiss;
    const mag = a.magLand + a.magMiss;
    return {
      player,
      job: jobByName[player] ?? null,
      totalDamage: a.dmg,
      dps: +(a.dmg / dur).toFixed(1),
      damagePct: totalDamage > 0 ? +((a.dmg / totalDamage) * 100).toFixed(1) : 0,
      meleeAccPct: mTotal > 0 ? pct(mLanded, mTotal) : null,
      critPct: mLanded > 0 ? pct(a.mCrit, mLanded) : null,
      meleeAvg: mLanded > 0 ? Math.floor(a.mDmg / mLanded) : null,
      wsAvg: a.wsHit > 0 ? Math.floor(a.wsDmg / a.wsHit) : null,
      wsCount: a.wsHit,
      rangedAccPct: rTotal > 0 ? pct(a.rHit + a.rCrit, rTotal) : null,
      magicAccPct: mag > 0 ? pct(a.magLand, mag) : null,
    };
  });
  players.sort((x, y) => y.totalDamage - x.totalDamage);
  return { players, totalDamage };
}
