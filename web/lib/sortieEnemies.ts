import type { EncounterEnemy } from './encounter';
import type { ActionLogEntry, KillLogEntry, PartyMember, RawBattleMessage } from './types';
import { isPetName, buildPetNameSet } from './petDetect';
import { BATTLE_MESSAGE_DICT } from './battleMessages';

const SPAWN_TOLERANCE_SEC = 5;
const PHANTOM_DMG_MAX = 1000;
const REAL_FIGHT_DMG_MIN = 10000;

const DEATH_MSG_IDS = new Set<number>(
  Object.entries(BATTLE_MESSAGE_DICT)
    .filter(([, m]) => m.category === 'death')
    .map(([id]) => Number(id))
);

export function deriveEnemiesFromActionLog(
  actionLog: ActionLogEntry[] | null | undefined,
  killLog: KillLogEntry[] | null | undefined,
  party: PartyMember[] | null | undefined,
  battleMsgRaw?: RawBattleMessage[] | null,
): EncounterEnemy[] {
  const acts = actionLog ?? [];
  const kills = killLog ?? [];
  if (acts.length === 0 && kills.length === 0) return [];

  const partyNames = new Set((party ?? []).map(p => p.name));
  const taggedPetNames = buildPetNameSet(acts);

  const CROSS_BOX_KILL_WINDOW = 5;
  const deathsById = new Map<number, number[]>();
  for (const k of kills) {
    if (k.id == null) continue;
    let arr = deathsById.get(k.id);
    if (!arr) { arr = []; deathsById.set(k.id, arr); }
    arr.push(k.elapsed);
  }
  for (const [id, arr] of deathsById) {
    arr.sort((a, b) => a - b);
    const deduped: number[] = [];
    for (const t of arr) {
      if (deduped.length > 0 && t - deduped[deduped.length - 1] <= CROSS_BOX_KILL_WINDOW) continue;
      deduped.push(t);
    }
    deathsById.set(id, deduped);
  }

  const spawnSeqFor = (id: number, elapsed: number): number => {
    const deaths = deathsById.get(id);
    if (!deaths) return 1;
    let seq = 1;
    for (const d of deaths) { if (elapsed > d + SPAWN_TOLERANCE_SEC) seq += 1; else break; }
    return seq;
  };

  const by = new Map<string, EncounterEnemy>();
  for (const e of acts) {
    if (e.from === 'boss') continue;
    for (const t of e.targets ?? []) {
      const nm = t.mob;
      if (!nm) continue;
      if (partyNames.has(nm) || isPetName(nm, partyNames, taggedPetNames)) continue;
      const seq = t.id != null ? spawnSeqFor(t.id, e.elapsed) : 1;
      const key = t.id != null ? `${nm}#${t.id}#${seq}` : nm;
      let row = by.get(key);
      if (!row) {
        row = { name: nm, id: t.id, spawnSeq: seq, firstSeen: e.elapsed, killedAt: null, damageTaken: 0 };
        by.set(key, row);
      }
      if (e.elapsed < row.firstSeen) row.firstSeen = e.elapsed;
      row.damageTaken += (t.damage || 0);
    }
  }

  const byIdSeq = new Map<string, EncounterEnemy>();
  for (const row of by.values()) {
    if (row.id != null) byIdSeq.set(`${row.id}#${row.spawnSeq ?? 1}`, row);
  }
  for (const [id, deaths] of deathsById) {
    for (let i = 0; i < deaths.length; i++) {
      const row = byIdSeq.get(`${id}#${i + 1}`);
      if (row) row.killedAt = deaths[i];
    }
  }
  for (const k of kills) {
    if (k.id != null) continue;
    for (const row of by.values()) {
      if (row.name === k.name && row.killedAt == null) { row.killedAt = k.elapsed; break; }
    }
  }

  if (battleMsgRaw && battleMsgRaw.length > 0) {
    const mobIds = new Set<number>();
    for (const row of by.values()) if (row.id != null) mobIds.add(row.id);
    const rowsById = new Map<number, EncounterEnemy[]>();
    for (const row of by.values()) {
      if (row.id == null) continue;
      let arr = rowsById.get(row.id);
      if (!arr) { arr = []; rowsById.set(row.id, arr); }
      arr.push(row);
    }
    for (const arr of rowsById.values()) arr.sort((a, b) => (a.spawnSeq ?? 1) - (b.spawnSeq ?? 1));
    const sorted = [...battleMsgRaw].sort((a, b) => a.elapsed - b.elapsed);
    for (const m of sorted) {
      if (!DEATH_MSG_IDS.has(m.msgId)) continue;
      for (const cand of [m.actorId, m.targetId]) {
        if (cand == null || !mobIds.has(cand)) continue;
        const rows = rowsById.get(cand);
        if (!rows) continue;
        const first = rows.find(r => r.killedAt == null);
        if (first) first.killedAt = m.elapsed;
      }
    }
  }

  const byName = new Map<string, EncounterEnemy[]>();
  for (const row of by.values()) {
    let arr = byName.get(row.name);
    if (!arr) { arr = []; byName.set(row.name, arr); }
    arr.push(row);
  }
  const suppressed = new Set<EncounterEnemy>();
  for (const rows of byName.values()) {
    if (rows.length < 2) continue;
    const hasRealConfirmedFight = rows.some(r => r.killedAt != null && r.damageTaken >= REAL_FIGHT_DMG_MIN);
    if (!hasRealConfirmedFight) continue;
    for (const row of rows) {
      if (row.killedAt == null && row.damageTaken < PHANTOM_DMG_MAX) suppressed.add(row);
    }
  }

  const out = [...by.values()].filter(r => !suppressed.has(r));
  out.sort((a, b) => a.firstSeen - b.firstSeen);
  return out;
}

export const deriveSortieEnemies = deriveEnemiesFromActionLog;
