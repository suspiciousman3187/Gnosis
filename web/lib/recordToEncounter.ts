import type { RunRecord, ActionLogEntry, ActionLogTarget, KillLogEntry } from '@/lib/types';
import type { Encounter, EncounterEnemy } from '@/lib/encounter';
import { normalizeBuffLog } from '@/lib/parseShared';

function deriveEnemies(
  actionLog: ActionLogEntry[] | null | undefined,
  killLog: KillLogEntry[] | null | undefined,
  partyNames: Set<string>,
): EncounterEnemy[] {
  const acts = actionLog ?? [];
  const kills = killLog ?? [];
  if (acts.length === 0 && kills.length === 0) return [];
  const deathsById = new Map<number, number[]>();
  for (const k of kills) {
    if (k.id == null) continue;
    const arr = deathsById.get(k.id) ?? [];
    arr.push(k.elapsed);
    deathsById.set(k.id, arr);
  }
  for (const arr of deathsById.values()) arr.sort((a, b) => a - b);
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
  const by = new Map<string, EncounterEnemy>();
  for (const e of acts) {
    if (e.from === 'boss') continue;
    const targets: ActionLogTarget[] = Array.isArray(e.targets)
      ? e.targets
      : (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' }] : []);
    for (const t of targets) {
      const nm = t.mob;
      if (!nm) continue;
      if (partyNames.has(nm)) continue;
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
  return [...by.values()];
}

export interface RecordToEncounterOptions {
  enemies?: EncounterEnemy[];
  durationSeconds?: number;
  zoneName?: string | null;
  zoneId?: number | null;
}

export function recordToEncounter(r: RunRecord, opts: RecordToEncounterOptions = {}): Encounter {
  const partyNames = new Set((r.party ?? []).map(p => p.name).filter(Boolean));
  const enemies = opts.enemies ?? deriveEnemies(r.action_log, r.kill_log, partyNames);
  const startTimeIso = r.sortie_start_time ?? r.run_date;
  const startTime = startTimeIso ? Math.floor(new Date(startTimeIso).getTime() / 1000) : 0;
  const dur = opts.durationSeconds ?? (() => {
    const at = r.area_times;
    if (!at || typeof at !== 'object') return 0;
    let total = 0;
    for (const v of Object.values(at as unknown as Record<string, unknown>)) {
      if (typeof v === 'number') total += v;
    }
    return total;
  })();
  return {
    id: r.id ?? '',
    source: 'sortie',
    segmentation: 'session',
    zoneId: opts.zoneId ?? null,
    zoneName: opts.zoneName ?? null,
    zoneLog: null,
    startTime,
    durationSeconds: dur,

    party: r.party ?? [],
    playerIds: r.playerIds ?? null,
    enemies,

    actionLog: r.action_log ?? null,
    skillchainLog: r.skillchain_log ?? null,
    buffLog: normalizeBuffLog(r.buff_log ?? null),
    itemUseLog: r.item_use_log ?? null,
    petLog: r.pet_log ?? null,
    battleMsgRaw: r.battle_msg_raw ?? null,
    jobExtendedLog: r.job_extended_log ?? null,
    effectLog: r.effect_log ?? null,
    bossHpLog: r.boss_hp_log ?? null,
    partyHpLog: r.party_hp_log ?? null,
    partyTpLog: r.party_tp_log ?? null,
    partyMpLog: r.party_mp_log ?? null,
    partyMaxHp: r.party_max_hp ?? null,
    partyMaxMp: r.party_max_mp ?? null,
    points: r.points ?? null,
    positionLog: r.position_log ?? null,
    partyPositionLog: null,
    killLog: r.kill_log ?? null,
    deathLog: r.death_log ?? null,
    dropLog: null,
    progressionLog: null,
    progressionStart: null,
    progressionEnd: null,
    currencyStart: null,
    currencyEnd: null,
    keyItemLog: null,
    gearLog: r.gearLog ?? null,
    stateSets: r.stateSets ?? null,
    localCharacter: r.localCharacter ?? null,
    gearByPlayer: r.gearByPlayer ?? null,
    combatStats: r.combat_stats ?? null,
    enemyReports: r.boss_reports ?? null,
    content: { type: 'generic' },
    notes: r.notes ?? '',
  };
}

export interface SortieSidecar {
  bonusObjectives: RunRecord['bonus_objectives'];
  treasureChests: RunRecord['treasure_chests'];
  sectorObjectives: RunRecord['sector_objectives'];
  aminon: RunRecord['aminon'];
  bossReports: RunRecord['boss_reports'];
  areaTimes: RunRecord['area_times'];
  chestLog: RunRecord['chest_log'];
  naakualKills: RunRecord['naakual_kills'];
  miniNmLog: RunRecord['mini_nm_log'];
  dropLog: RunRecord['drop_log'];
  drops: RunRecord['drops'];
  gallimaufry: RunRecord['gallimaufry'];
  oldCasePlus1: RunRecord['old_case_plus1'];
  defeatedBosses: RunRecord['defeated_bosses'];
  notes: RunRecord['notes'];
}

export function extractSortieSidecar(r: RunRecord): SortieSidecar {
  return {
    bonusObjectives: r.bonus_objectives,
    treasureChests: r.treasure_chests,
    sectorObjectives: r.sector_objectives,
    aminon: r.aminon,
    bossReports: r.boss_reports,
    areaTimes: r.area_times,
    chestLog: r.chest_log,
    naakualKills: r.naakual_kills,
    miniNmLog: r.mini_nm_log,
    dropLog: r.drop_log,
    drops: r.drops,
    gallimaufry: r.gallimaufry,
    oldCasePlus1: r.old_case_plus1,
    defeatedBosses: r.defeated_bosses,
    notes: r.notes,
  };
}
