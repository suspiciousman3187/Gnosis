import type { RunRecord } from '@/lib/types';
import type { Encounter, EncounterEnemy } from '@/lib/encounter';
import { normalizeBuffLog } from '@/lib/parseShared';
import { deriveEnemiesFromActionLog } from '@/lib/sortieEnemies';

export interface RecordToEncounterOptions {
  enemies?: EncounterEnemy[];
  durationSeconds?: number;
  zoneName?: string | null;
  zoneId?: number | null;
}

export function recordToEncounter(r: RunRecord, opts: RecordToEncounterOptions = {}): Encounter {
  const enemies = opts.enemies ?? deriveEnemiesFromActionLog(r.action_log, r.kill_log, r.party, r.battle_msg_raw);
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
