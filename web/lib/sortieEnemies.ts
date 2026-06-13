import type { EncounterEnemy } from './encounter';
import type { ActionLogEntry, KillLogEntry, PartyMember } from './types';
import { isPetName, buildPetNameSet } from './petDetect';

const SPAWN_TOLERANCE_SEC = 5;

export function deriveSortieEnemies(
  actionLog: ActionLogEntry[] | null | undefined,
  killLog: KillLogEntry[] | null | undefined,
  party: PartyMember[] | null | undefined,
): EncounterEnemy[] {
  const acts = actionLog ?? [];
  const kills = killLog ?? [];
  if (acts.length === 0 && kills.length === 0) return [];

  const partyNames = new Set((party ?? []).map(p => p.name));
  const taggedPetNames = buildPetNameSet(acts);

  const deathsById = new Map<number, number[]>();
  for (const k of kills) {
    if (k.id == null) continue;
    let arr = deathsById.get(k.id);
    if (!arr) { arr = []; deathsById.set(k.id, arr); }
    arr.push(k.elapsed);
  }
  for (const arr of deathsById.values()) arr.sort((a, b) => a - b);

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

  const out = [...by.values()];
  out.sort((a, b) => a.firstSeen - b.firstSeen);
  return out;
}
