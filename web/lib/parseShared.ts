import type {
  ActionLogEntry,
  SkillchainEntry,
  BuffLogEntry,
  ItemUseLogEntry,
  PetLogEntry,
  RawBattleMessage,
  JobExtendedEntry,
  EffectLogEntry,
  BossHpEntry,
  PartyHpEntry,
  PartyTpEntry,
  PartyMpEntry,
  PositionLogEntry,
  BossReport,
  ParseCombatStats,
  PartyMember,
} from './types';

import { normalizeBuffName } from '@/lib/statusEffects';

export const arrOf = <T,>(v: unknown): T[] | null => (Array.isArray(v) ? (v as T[]) : null);

export function normalizeBuffLog(buffs: BuffLogEntry[] | null): BuffLogEntry[] | null {
  if (!buffs || buffs.length === 0) return buffs;
  let changed = false;
  const out = buffs.map(b => {
    const nm = normalizeBuffName(b.buffId, b.buffName);
    if (nm === b.buffName) return b;
    changed = true;
    return { ...b, buffName: nm };
  });
  return changed ? out : buffs;
}

export interface CommonCombatLogs {
  actionLog: ActionLogEntry[] | null;
  skillchainLog: SkillchainEntry[] | null;
  buffLog: BuffLogEntry[] | null;
  itemUseLog: ItemUseLogEntry[] | null;
  petLog: PetLogEntry[] | null;
  battleMsgRaw: RawBattleMessage[] | null;
  jobExtendedLog: JobExtendedEntry[] | null;
  effectLog: EffectLogEntry[] | null;
  bossHpLog: BossHpEntry[] | null;
  partyHpLog: PartyHpEntry[] | null;
  partyTpLog: PartyTpEntry[] | null;
  partyMpLog: PartyMpEntry[] | null;
  positionLog: PositionLogEntry[] | null;
  partyMaxHp: Record<string, number> | null;
  partyMaxMp: Record<string, number> | null;
  points: { xp: number; cp: number; ep: number; lp: number } | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractCommonLogs(body: any): CommonCombatLogs {
  return {
    actionLog:     arrOf<ActionLogEntry>(body.actionLog),
    skillchainLog: arrOf<SkillchainEntry>(body.skillchainLog),
    buffLog:       normalizeBuffLog(arrOf<BuffLogEntry>(body.buffLog)),
    itemUseLog:    arrOf<ItemUseLogEntry>(body.itemUseLog),
    petLog:        arrOf<PetLogEntry>(body.petLog),
    battleMsgRaw:  arrOf<RawBattleMessage>(body.battleMsgRaw),
    jobExtendedLog: arrOf<JobExtendedEntry>(body.jobExtendedLog),
    effectLog:     arrOf<EffectLogEntry>(body.effectLog),
    bossHpLog:     arrOf<BossHpEntry>(body.bossHpLog),
    partyHpLog:    arrOf<PartyHpEntry>(body.partyHpLog),
    partyTpLog:    arrOf<PartyTpEntry>(body.partyTpLog),
    partyMpLog:    arrOf<PartyMpEntry>(body.partyMpLog),
    positionLog:   arrOf<PositionLogEntry>(body.positionLog),
    partyMaxHp:    (body.partyMaxHp && typeof body.partyMaxHp === 'object') ? body.partyMaxHp : null,
    partyMaxMp:    (body.partyMaxMp && typeof body.partyMaxMp === 'object') ? body.partyMaxMp : null,
    points:        (body.points && typeof body.points === 'object')
                     ? { xp: body.points.xp ?? 0, cp: body.points.cp ?? 0, ep: body.points.ep ?? 0, lp: body.points.lp ?? 0 }
                     : null,
  };
}

export function extractBossReports(body: any, opts?: { dropEmpty?: boolean }): Record<string, BossReport> | null {
  const br = body.bossReports;
  if (!br || typeof br !== 'object') return null;
  if (opts?.dropEmpty && Object.keys(br).length === 0) return null;
  return br as Record<string, BossReport>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractCombatStats(body: any): ParseCombatStats | null {
  return body.combatStats && typeof body.combatStats === 'object' && !Array.isArray(body.combatStats)
    ? (body.combatStats as ParseCombatStats)
    : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractParty(body: any): PartyMember[] {
  return Array.isArray(body.party) ? (body.party as PartyMember[]) : [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractDefeatedBosses(body: any): string[] {
  return Array.isArray(body.defeatedBosses) ? (body.defeatedBosses as string[]) : [];
}
