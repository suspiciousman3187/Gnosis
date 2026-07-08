import type { Encounter, EncounterEnemy, EncounterDrop } from '@/lib/encounter';
import type { RunRecord, GearStateVariant } from '@/lib/types';

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
  const all: EncounterEnemy[] = [];
  for (let i = 0; i < parts.length; i++) {
    const arr = parts[i] ?? [];
    const d = deltas[i];
    for (const e of arr) {
      all.push({
        ...e,
        firstSeen: (e.firstSeen ?? 0) + d,
        killedAt: e.killedAt != null ? e.killedAt + d : null,
      });
    }
  }
  const byEntity = new Map<string, EncounterEnemy>();
  for (const e of all) {
    if (e.id == null) continue;
    const key = `${e.name}#${e.id}`;
    const existing = byEntity.get(key);
    if (!existing) { byEntity.set(key, e); continue; }
    const merged: EncounterEnemy = {
      ...existing,
      firstSeen: Math.min(existing.firstSeen ?? Infinity, e.firstSeen ?? Infinity),
      killedAt: existing.killedAt ?? e.killedAt ?? null,
      damageTaken: Math.max(existing.damageTaken ?? 0, e.damageTaken ?? 0),
    };
    byEntity.set(key, merged);
  }
  const out: EncounterEnemy[] = [...byEntity.values()];
  for (const e of all) {
    if (e.id != null) continue;
    out.push(e);
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
        const key = m.id != null
          ? `id:${m.id}`
          : `name:${m.name}|${m.mainJob}${m.mainLevel}/${m.subJob}${m.subLevel}`;
        if (seen.has(key)) continue;
        seen.add(key);
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

  const stateSetsMerged: Record<string, GearStateVariant[]> = {};
  for (const e of sorted) {
    for (const [player, variants] of Object.entries(e.stateSets ?? {})) {
      if (!(player in stateSetsMerged) && Array.isArray(variants)) {
        stateSetsMerged[player] = variants;
      }
    }
  }

  const merged: Encounter = {
    id: `enc_merged_${mergedStart}`,
    source: first.source,
    language: first.language,
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
    jobChangeLog:     shiftAndConcat(sorted.map(e => e.jobChangeLog ?? null), deltas),
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
    dropLog:          unionDrops(sorted.map(e => stampDropOwners(e.dropLog, e.localCharacter)), deltas),
    progressionLog:   shiftAndConcat(sorted.map(e => e.progressionLog), deltas),
    progressionStart: first.progressionStart ?? null,
    progressionEnd:   last.progressionEnd ?? null,
    currencyStart:    first.currencyStart ?? null,
    currencyEnd:      last.currencyEnd ?? null,
    keyItemLog:       shiftAndConcat(sorted.map(e => e.keyItemLog), deltas),
    gearLog:          shiftAndConcat(sorted.map(e => e.gearLog), deltas),
    stateSets:        Object.keys(stateSetsMerged).length > 0 ? stateSetsMerged : (first.stateSets ?? null),
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

const CROSS_BOX_DEDUP_WINDOW_SEC = 3;

function dedupByElapsed<T extends { elapsed: number }>(
  arr: T[] | null | undefined,
  keyFn: (e: T) => string,
): T[] | null {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a.elapsed - b.elapsed);
  const lastByKey = new Map<string, number>();
  const out: T[] = [];
  for (const e of sorted) {
    const k = keyFn(e);
    const prev = lastByKey.get(k);
    if (prev != null && e.elapsed - prev <= CROSS_BOX_DEDUP_WINDOW_SEC) continue;
    lastByKey.set(k, e.elapsed);
    out.push(e);
  }
  return out;
}

type DropLike = { elapsed: number; name?: string; itemId?: number; type?: string; source?: string; by?: string; poolIndex?: number };

function dropDedupKey(e: DropLike): string {
  if (e.type === 'pool') {
    if (e.poolIndex != null) return `pool:${e.itemId ?? 0}:${e.poolIndex}`;
    return `pool:${e.name ?? ''}:${e.itemId ?? 0}`;
  }
  return `${e.name ?? ''}:${e.itemId ?? 0}:${e.type ?? ''}:${e.by ?? ''}`;
}

function stampDropOwners<T extends DropLike>(log: T[] | null | undefined, owner: string | null | undefined): T[] | null | undefined {
  if (!log || !owner) return log;
  return log.map(d => (d.type !== 'pool' && !d.by ? { ...d, by: owner } : d));
}

function dedupDrops<T extends DropLike>(arr: T[] | null | undefined): T[] | null {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a.elapsed - b.elapsed);
  const out: T[] = [];
  const groups = new Map<string, { idx: number; anchor: number; byVotes: Map<string, number> }>();
  for (const e of sorted) {
    const key = dropDedupKey(e);
    const g = groups.get(key);
    if (g && e.elapsed - g.anchor <= CROSS_BOX_DEDUP_WINDOW_SEC) {
      const kept = out[g.idx] as DropLike;
      if (!kept.source && e.source) kept.source = e.source;
      if (e.by) {
        g.byVotes.set(e.by, (g.byVotes.get(e.by) ?? 0) + 1);
        let best: string | undefined; let bestN = 0;
        for (const [n, c] of g.byVotes) if (c > bestN) { best = n; bestN = c; }
        kept.by = best;
      }
      continue;
    }
    const copy = { ...e };
    out.push(copy);
    const votes = new Map<string, number>();
    if (e.by) votes.set(e.by, 1);
    groups.set(key, { idx: out.length - 1, anchor: e.elapsed, byVotes: votes });
  }
  return out;
}

function concatLogs<T>(arrs: (T[] | null | undefined)[]): T[] | null {
  const out: T[] = [];
  let any = false;
  for (const a of arrs) {
    if (!a) continue;
    any = true;
    for (const e of a) out.push(e);
  }
  return any ? out : null;
}

export function mergeEncountersAcrossBoxes(parts: Encounter[]): Encounter {
  if (parts.length === 0) throw new Error('mergeEncountersAcrossBoxes: empty');
  if (parts.length === 1) return parts[0];
  const merged = mergeEncountersForCharacter(parts);
  return {
    ...merged,
    battleMsgRaw: dedupByElapsed(merged.battleMsgRaw,
      m => `${m.msgId}:${m.actorId ?? 0}:${m.targetId ?? 0}:${m.data ?? 0}`),
    buffLog: dedupByElapsed(merged.buffLog,
      b => `${b.target}:${b.buffId}:${b.kind}`),
    actionLog: dedupByElapsed(merged.actionLog,
      a => `${a.playerId ?? 0}:${a.player}:${a.category ?? 0}:${a.param ?? 0}:${a.phase ?? ''}:${a.targets?.[0]?.id ?? 0}`),
    killLog: dedupByElapsed(merged.killLog,
      k => `${k.id ?? 0}:${k.name}`),
    deathLog: dedupByElapsed(merged.deathLog,
      d => `${d.player}`),
    skillchainLog: dedupByElapsed(merged.skillchainLog,
      s => `${s.closer}:${s.mob}:${s.sc}`),
    itemUseLog: dedupByElapsed(merged.itemUseLog,
      i => `${i.player}:${i.item}`),
    jobExtendedLog: dedupByElapsed(merged.jobExtendedLog ?? null,
      j => `${j.jobId}:${j.isSubJob}:${j.rawHex ?? ''}`),
    effectLog: dedupByElapsed(merged.effectLog ?? null,
      e => `${e.entityId}:${e.effectNum}:${e.type}:${e.status}`),
    petLog: dedupByElapsed(merged.petLog,
      p => `${p.owner}:${p.pet}`),
    bossHpLog: dedupByElapsed(merged.bossHpLog,
      h => `${h.id ?? 0}:${h.name ?? ''}:${h.hpp}`),
    partyHpLog: dedupByElapsed(merged.partyHpLog,
      h => `${h.player}`),
    partyMpLog: dedupByElapsed(merged.partyMpLog,
      h => `${h.player}`),
    partyTpLog: dedupByElapsed(merged.partyTpLog,
      h => `${h.player}`),
    dropLog: dedupDrops(merged.dropLog),
  };
}

export function mergeRunRecords(parts: RunRecord[]): RunRecord {
  if (parts.length === 0) throw new Error('mergeRunRecords: empty');
  if (parts.length === 1) return parts[0];

  const rep = [...parts].sort((a, b) =>
    (b.action_log?.length ?? 0) - (a.action_log?.length ?? 0)
  )[0];

  const playerIds: Record<string, number> = {};
  for (const p of parts) {
    for (const [name, id] of Object.entries(p.playerIds ?? {})) {
      if (!(name in playerIds)) playerIds[name] = id;
    }
  }
  const party_max_hp: Record<string, number> = {};
  for (const p of parts) {
    for (const [name, v] of Object.entries(p.party_max_hp ?? {})) {
      party_max_hp[name] = Math.max(party_max_hp[name] ?? 0, v);
    }
  }
  const party_max_mp: Record<string, number> = {};
  for (const p of parts) {
    for (const [name, v] of Object.entries(p.party_max_mp ?? {})) {
      party_max_mp[name] = Math.max(party_max_mp[name] ?? 0, v);
    }
  }

  const partyMerged = (() => {
    const seen = new Set<string>();
    const out: RunRecord['party'] = [];
    for (const p of parts) {
      for (const m of p.party ?? []) {
        const key = m.id != null
          ? `id:${m.id}`
          : `name:${m.name}|${m.mainJob}${m.mainLevel}/${m.subJob}${m.subLevel}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(m);
      }
    }
    return out;
  })();

  const dropsMerged: RunRecord['drops'] = (() => {
    if (!parts.some(p => p.drops)) return rep.drops ?? null;
    const out: Record<string, number> = {};
    for (const p of parts) {
      for (const [k, v] of Object.entries(p.drops ?? {})) {
        if (typeof v === 'number') out[k] = (out[k] ?? 0) + v;
      }
    }
    return out as unknown as RunRecord['drops'];
  })();

  const pointsMerged = (() => {
    let xp = 0, cp = 0, ep = 0, lp = 0, any = false;
    for (const p of parts) {
      if (!p.points) continue;
      any = true;
      xp += p.points.xp || 0; cp += p.points.cp || 0; ep += p.points.ep || 0; lp += p.points.lp || 0;
    }
    return any ? { xp, cp, ep, lp } : (rep.points ?? null);
  })();

  const galliMerged = (() => {
    let best = 0, any = false;
    for (const p of parts) {
      const g = p.gallimaufry;
      if (typeof g === 'number' && g > 0 && g < 200000) { best = Math.max(best, g); any = true; }
    }
    return any ? best : (rep.gallimaufry ?? null);
  })();

  return {
    ...rep,
    party: partyMerged,
    drops: dropsMerged,
    points: pointsMerged,
    gallimaufry: galliMerged,
    playerIds: Object.keys(playerIds).length > 0 ? playerIds : (rep.playerIds ?? null),
    party_max_hp: Object.keys(party_max_hp).length > 0 ? party_max_hp : (rep.party_max_hp ?? null),
    party_max_mp: Object.keys(party_max_mp).length > 0 ? party_max_mp : (rep.party_max_mp ?? null),
    action_log: dedupByElapsed(concatLogs(parts.map(p => p.action_log)),
      a => `${a.playerId ?? 0}:${a.player}:${a.category ?? 0}:${a.param ?? 0}:${a.phase ?? ''}:${a.targets?.[0]?.id ?? 0}`),
    buff_log: dedupByElapsed(concatLogs(parts.map(p => p.buff_log)),
      b => `${b.target}:${b.buffId}:${b.kind}`),
    battle_msg_raw: dedupByElapsed(concatLogs(parts.map(p => p.battle_msg_raw)),
      m => `${m.msgId}:${m.actorId ?? 0}:${m.targetId ?? 0}:${m.data ?? 0}`),
    kill_log: dedupByElapsed(concatLogs(parts.map(p => p.kill_log)),
      k => `${k.id ?? 0}:${k.name}`),
    death_log: dedupByElapsed(concatLogs(parts.map(p => p.death_log)),
      d => `${d.player}`),
    skillchain_log: dedupByElapsed(concatLogs(parts.map(p => p.skillchain_log)),
      s => `${s.closer}:${s.mob}:${s.sc}`),
    item_use_log: dedupByElapsed(concatLogs(parts.map(p => p.item_use_log)),
      i => `${i.player}:${i.item}`),
    pet_log: dedupByElapsed(concatLogs(parts.map(p => p.pet_log)),
      p => `${p.owner}:${p.pet}`),
    job_extended_log: dedupByElapsed(concatLogs(parts.map(p => p.job_extended_log)),
      j => `${j.jobId}:${j.isSubJob}:${j.rawHex ?? ''}`),
    effect_log: dedupByElapsed(concatLogs(parts.map(p => p.effect_log)),
      e => `${e.entityId}:${e.effectNum}:${e.type}:${e.status}`),
    party_hp_log: dedupByElapsed(concatLogs(parts.map(p => p.party_hp_log)),
      h => `${h.player}`),
    party_mp_log: dedupByElapsed(concatLogs(parts.map(p => p.party_mp_log)),
      h => `${h.player}`),
    party_tp_log: dedupByElapsed(concatLogs(parts.map(p => p.party_tp_log)),
      h => `${h.player}`),
    position_log: concatLogs(parts.map(p => p.position_log)),
    boss_hp_log: dedupByElapsed(concatLogs(parts.map(p => p.boss_hp_log)),
      h => `${h.id ?? 0}:${h.name ?? ''}:${h.hpp}`),
    drop_log: dedupDrops(concatLogs(parts.map(p => stampDropOwners(p.drop_log, p.localCharacter)))),
    zone_log: dedupByElapsed(concatLogs(parts.map(p => p.zone_log)),
      z => `${z.area}`),
    chest_log: dedupByElapsed(concatLogs(parts.map(p => p.chest_log)),
      c => `${c.area}:${c.npcId ?? 0}:${c.name ?? ''}`),
    mini_nm_log: dedupByElapsed(concatLogs(parts.map(p => p.mini_nm_log)),
      m => `${m.name}:${m.sector}`),
    defeated_bosses: (() => {
      const seen = new Set<string>();
      for (const p of parts) for (const b of p.defeated_bosses ?? []) seen.add(b);
      return [...seen];
    })(),
    boss_reports: (() => {
      const merged: NonNullable<RunRecord['boss_reports']> = {};
      for (const p of parts) {
        for (const [name, report] of Object.entries(p.boss_reports ?? {})) {
          if (!(name in merged)) merged[name] = report;
        }
      }
      return Object.keys(merged).length > 0 ? merged : (rep.boss_reports ?? null);
    })(),
  };
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
