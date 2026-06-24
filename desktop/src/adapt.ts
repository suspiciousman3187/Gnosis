import type { ParsedRun, RunRecord } from '@/lib/types';

const localBase = () => ({
  id: 'local',
  user_id: 'local',
  created_at: new Date().toISOString(),
  is_public: false,
});

const iso = (unixSeconds: number | null) =>
  unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;


export function parsedToRecord(parsed: ParsedRun, rawText: string): RunRecord {
  return {
    ...localBase(),
    localCharacter: parsed.localCharacter ?? null,
    run_date: parsed.runDate.toISOString(),
    addonVersion: parsed.addonVersion,
    gallimaufry: parsed.gallimaufry,
    old_case_plus1: parsed.oldCasePlus1,
    defeated_bosses: parsed.defeatedBosses,
    party: parsed.party,
    bonus_objectives: parsed.bonusObjectives,
    treasure_chests: parsed.treasureChests,
    sector_objectives: parsed.sectorObjectives,
    aminon: parsed.aminon,
    boss_reports: parsed.bossReports,
    area_times: parsed.areaTimes,
    zone_log: parsed.zoneLog,
    death_log: parsed.deathLog,
    chest_log: parsed.chestLog,
    naakual_kills: parsed.naakualKills,
    mini_nm_log: parsed.miniNmLog,
    drop_log: parsed.dropLog,
    drops: parsed.drops,
    notes: parsed.notes,
    sortie_start_time: iso(parsed.sortieStartTime),
    raw_text: rawText,
    combat_stats: parsed.combatStats,
    action_log: parsed.actionLog,
    kill_log: parsed.killLog,
    item_use_log: parsed.itemUseLog,
    position_log: parsed.positionLog,
    boss_hp_log: parsed.bossHpLog,
    party_hp_log: parsed.partyHpLog,
    party_tp_log: parsed.partyTpLog,
    party_mp_log: parsed.partyMpLog,
    buff_log: parsed.buffLog,
    skillchain_log: parsed.skillchainLog,
    pet_log: parsed.petLog,
    battle_msg_raw: parsed.battleMsgRaw,
    job_extended_log: parsed.jobExtendedLog,
    effect_log: parsed.effectLog,
    gearLog: parsed.gearLog ?? null,
    stateSets: parsed.stateSets ?? null,
    party_max_hp: parsed.partyMaxHp ?? null,
    party_max_mp: parsed.partyMaxMp ?? null,
    points: parsed.points ?? null,
  };
}
