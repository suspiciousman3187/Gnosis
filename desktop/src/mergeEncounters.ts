import type { Encounter, EncounterEnemy, EncounterDrop } from '@/lib/encounter';

type WithElapsed = { elapsed: number };
type ShiftableLog<T extends WithElapsed> = T[] | null | undefined;

function shiftAndConcat<T extends WithElapsed>(parts: ShiftableLog<T>[], deltas: number[]): T[] | null {
  let any = false;
  const out: T[] = [];
  for (let i = 0; i < parts.length; i++) {
    const arr = parts[i];
    if (!arr) continue;
    any = true;
    const d = deltas[i];
    for (const e of arr) out.push({ ...e, elapsed: e.elapsed + d });
  }
  return any ? out : null;
}

function maxNum(a: number | undefined | null, b: number | undefined | null): number {
  return Math.max(a ?? 0, b ?? 0);
}

function unionEnemies(parts: (EncounterEnemy[] | null | undefined)[], deltas: number[]): EncounterEnemy[] {
  const out: EncounterEnemy[] = [];
  for (let i = 0; i < parts.length; i++) {
    const arr = parts[i] ?? [];
    const d = deltas[i];
    for (const e of arr) {
      out.push({
        ...e,
        firstSeen: (e.firstSeen ?? 0) + d,
        killedAt: e.killedAt != null ? e.killedAt + d : null,
      });
    }
  }
  out.sort((a, b) => (a.firstSeen ?? 0) - (b.firstSeen ?? 0));
  const seqCounter = new Map<string, number>();
  for (const e of out) {
    const key = `${e.name}#${e.id ?? ''}`;
    const next = (seqCounter.get(key) ?? 0) + 1;
    seqCounter.set(key, next);
    e.spawnSeq = next;
  }
  return out;
}

function unionDrops(parts: (EncounterDrop[] | null | undefined)[], deltas: number[]): EncounterDrop[] | null {
  const out: EncounterDrop[] = [];
  let any = false;
  for (let i = 0; i < parts.length; i++) {
    const arr = parts[i];
    if (!arr) continue;
    any = true;
    const d = deltas[i];
    for (const e of arr) out.push({ ...e, elapsed: (e.elapsed ?? 0) + d });
  }
  return any ? out : null;
}

export function mergeEncountersForCharacter(parts: Encounter[]): Encounter {
  if (parts.length === 0) throw new Error('mergeEncountersForCharacter: empty');
  const sorted = [...parts].sort((a, b) => a.startTime - b.startTime);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const mergedStart = first.startTime;
  const mergedEnd = last.startTime + last.durationSeconds;
  const deltas = sorted.map(e => e.startTime - mergedStart);

  const unionParty = (() => {
    const seen = new Set<string>();
    const out: Encounter['party'] = [];
    for (const e of sorted) {
      for (const m of e.party ?? []) {
        if (seen.has(m.name)) continue;
        seen.add(m.name);
        out.push(m);
      }
    }
    return out;
  })();

  const playerIds: Record<string, number> = {};
  for (const e of sorted) {
    for (const [name, id] of Object.entries(e.playerIds ?? {})) {
      if (!(name in playerIds)) playerIds[name] = id;
    }
  }

  const partyMaxHp: Record<string, number> = {};
  for (const e of sorted) {
    for (const [name, v] of Object.entries(e.partyMaxHp ?? {})) {
      partyMaxHp[name] = maxNum(partyMaxHp[name], v);
    }
  }

  const partyMaxMp: Record<string, number> = {};
  for (const e of sorted) {
    for (const [name, v] of Object.entries(e.partyMaxMp ?? {})) {
      partyMaxMp[name] = maxNum(partyMaxMp[name], v);
    }
  }

  const points = (() => {
    let xp = 0, cp = 0, ep = 0, lp = 0;
    let any = false;
    for (const e of sorted) {
      const p = e.points;
      if (!p) continue;
      any = true;
      xp += p.xp || 0;
      cp += p.cp || 0;
      ep += p.ep || 0;
      lp += p.lp || 0;
    }
    return any ? { xp, cp, ep, lp } : null;
  })();

  const merged: Encounter = {
    id: `enc_merged_${mergedStart}`,
    source: first.source,
    segmentation: first.segmentation,
    zoneId: first.zoneId,
    zoneName: first.zoneName,
    zoneLog: shiftAndConcat(sorted.map(e => e.zoneLog), deltas),
    startTime: mergedStart,
    durationSeconds: mergedEnd - mergedStart,

    party: unionParty,
    playerIds: Object.keys(playerIds).length > 0 ? playerIds : null,
    enemies: unionEnemies(sorted.map(e => e.enemies), deltas),

    actionLog:        shiftAndConcat(sorted.map(e => e.actionLog), deltas),
    skillchainLog:    shiftAndConcat(sorted.map(e => e.skillchainLog), deltas),
    buffLog:          shiftAndConcat(sorted.map(e => e.buffLog), deltas),
    itemUseLog:       shiftAndConcat(sorted.map(e => e.itemUseLog), deltas),
    petLog:           shiftAndConcat(sorted.map(e => e.petLog), deltas),
    battleMsgRaw:     shiftAndConcat(sorted.map(e => e.battleMsgRaw ?? null), deltas),
    jobExtendedLog:   shiftAndConcat(sorted.map(e => e.jobExtendedLog ?? null), deltas),
    effectLog:        shiftAndConcat(sorted.map(e => e.effectLog ?? null), deltas),
    bossHpLog:        shiftAndConcat(sorted.map(e => e.bossHpLog), deltas),
    partyHpLog:       shiftAndConcat(sorted.map(e => e.partyHpLog), deltas),
    partyTpLog:       shiftAndConcat(sorted.map(e => e.partyTpLog), deltas),
    partyMpLog:       shiftAndConcat(sorted.map(e => e.partyMpLog), deltas),
    partyMaxHp:       Object.keys(partyMaxHp).length > 0 ? partyMaxHp : null,
    partyMaxMp:       Object.keys(partyMaxMp).length > 0 ? partyMaxMp : null,
    points,
    positionLog:      shiftAndConcat(sorted.map(e => e.positionLog), deltas),
    partyPositionLog: shiftAndConcat(sorted.map(e => e.partyPositionLog), deltas),
    killLog:          shiftAndConcat(sorted.map(e => e.killLog), deltas),
    deathLog:         shiftAndConcat(sorted.map(e => e.deathLog), deltas),
    dropLog:          unionDrops(sorted.map(e => e.dropLog), deltas),
    progressionLog:   shiftAndConcat(sorted.map(e => e.progressionLog), deltas),
    progressionStart: first.progressionStart ?? null,
    progressionEnd:   last.progressionEnd ?? null,
    currencyStart:    first.currencyStart ?? null,
    currencyEnd:      last.currencyEnd ?? null,
    keyItemLog:       shiftAndConcat(sorted.map(e => e.keyItemLog), deltas),
    gearLog:          shiftAndConcat(sorted.map(e => e.gearLog), deltas),
    stateSets:        first.stateSets ?? null,
    localCharacter:   first.localCharacter ?? null,
    gearByPlayer:     first.gearByPlayer ?? null,
    combatStats:      null,
    enemyReports:     null,
    content:          first.content,
    notes:            sorted.map(e => e.notes).filter(Boolean).join(' | '),
    rawText:          undefined,
  };

  return merged;
}

export type MergeValidation =
  | { ok: true; warnings: string[] }
  | { ok: false; reason: string };

export function validateMerge(parts: Encounter[]): MergeValidation {
  if (parts.length < 2) return { ok: false, reason: 'Select at least two encounters to merge.' };
  const zones = new Set(parts.map(p => p.zoneName ?? '?'));
  if (zones.size > 1) {
    return { ok: false, reason: `Cross-zone merge blocked. Selected encounters span: ${Array.from(zones).join(', ')}.` };
  }
  const sorted = [...parts].sort((a, b) => a.startTime - b.startTime);
  const warnings: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].startTime - (sorted[i - 1].startTime + sorted[i - 1].durationSeconds);
    if (gap > 300) warnings.push(`${Math.round(gap / 60)}-min gap between encounters ${i} and ${i + 1}.`);
    if (gap < 0) warnings.push(`Encounters ${i} and ${i + 1} overlap in time (${Math.abs(gap)}s) - duration will be inflated.`);
  }
  return { ok: true, warnings };
}
