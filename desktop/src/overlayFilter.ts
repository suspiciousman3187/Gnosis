
import type { LivePlayer } from './content';
import type { ParseCombatStats, ParsePlayerCombat, PartyMember } from '@/lib/types';

export function mobKeyFromDisplay(displayName: string): string {
  return displayName.replace(/ /g, '_').replace(/'/g, '');
}
export function displayFromMobKey(key: string): string {
  return key.replace(/_/g, ' ');
}

function leafTally(leaf: { tally?: number } | undefined): number {
  return leaf?.tally ?? 0;
}

function offensiveCounts(pc: ParsePlayerCombat): { hits: number; misses: number; crits: number } {
  const meleeHits  = leafTally(pc.melee?.melee);
  const meleeMiss  = leafTally(pc.melee?.miss);
  const meleeCrit  = leafTally(pc.melee?.crit);
  const rangedHits = leafTally(pc.ranged?.ranged);
  const rangedMiss = leafTally(pc.ranged?.r_miss);
  const rangedCrit = leafTally(pc.ranged?.r_crit);
  return {
    hits:   meleeHits + meleeCrit + rangedHits + rangedCrit,
    misses: meleeMiss + rangedMiss,
    crits:  meleeCrit + rangedCrit,
  };
}

export function aggregateFilteredPlayers(
  combatStats: ParseCombatStats,
  filter: Set<string>,
  party: PartyMember[],
  durationSeconds: number,
): { players: LivePlayer[]; partyDamage: number; partyDps: number } {
  const totals = new Map<string, { damage: number; hits: number; misses: number; crits: number }>();
  for (const mob of Object.keys(combatStats)) {
    if (!filter.has(mob)) continue;
    const mobData = combatStats[mob];
    for (const [playerName, pc] of Object.entries(mobData)) {
      let t = totals.get(playerName);
      if (!t) { t = { damage: 0, hits: 0, misses: 0, crits: 0 }; totals.set(playerName, t); }
      t.damage += pc.total_damage ?? 0;
      const oc = offensiveCounts(pc);
      t.hits += oc.hits;
      t.misses += oc.misses;
      t.crits += oc.crits;
    }
  }
  let partyDamage = 0;
  for (const t of totals.values()) partyDamage += t.damage;
  const denom = partyDamage || 1;
  const jobByName: Record<string, string> = {};
  for (const p of party) jobByName[p.name] = p.mainJob;
  const players: LivePlayer[] = [];
  for (const [name, t] of totals) {
    const totalSwings = t.hits + t.misses;
    players.push({
      name,
      job: jobByName[name] || '',
      damage: t.damage,
      dps: durationSeconds > 0 ? Math.round(t.damage / durationSeconds) : 0,
      pct: Math.round((t.damage / denom) * 1000) / 10,
      acc: totalSwings > 0 ? Math.round((t.hits / totalSwings) * 100) : undefined,
      crit: t.hits > 0 ? Math.round((t.crits / t.hits) * 100) : undefined,
    });
  }
  players.sort((a, b) => b.damage - a.damage);
  return {
    players,
    partyDamage,
    partyDps: durationSeconds > 0 ? Math.round(partyDamage / durationSeconds) : 0,
  };
}

export function engagedMobsByDamage(combatStats: ParseCombatStats): string[] {
  const mobs: { name: string; dmg: number }[] = [];
  for (const [mob, mobData] of Object.entries(combatStats)) {
    let dmg = 0;
    for (const pc of Object.values(mobData)) dmg += pc.total_damage ?? 0;
    mobs.push({ name: mob, dmg });
  }
  mobs.sort((a, b) => b.dmg - a.dmg);
  return mobs.map(m => m.name);
}
