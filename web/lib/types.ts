export interface PartyMember {
  id?: number;      // entity id - stable join key across logs. Optional for legacy reports.
  name: string;
  mainJob: string;
  mainLevel: number;
  subJob: string;
  subLevel: number;
  maxHp?: number;   // derived (hp/hpp) at capture time; for damage-taken severity
}

export interface DamageEntry {
  name: string;
  damage: number;
  percent: number;
  isSkillchain: boolean;
  skillchainOwner?: string;
  scDamage?: number;
}

export interface WsEntry {
  name: string;
  wsAvg: number;
  count: number;
}

export interface PctEntry {
  name: string;
  pct: number;
  count: number;
}

export interface AvgEntry {
  name: string;
  avg: number;
  count: number;
}

export interface CorRolls {
  misers: number;
  misersLucky: boolean;
  tactician: number;
  tacticianLucky: boolean;
  wildCard: number;
}

export interface AminonData {
  mode: 'normal' | 'hardmode';
  killed?: boolean;
  minHpPct?: number;
  damageReport: DamageEntry[];
  wsAverages: WsEntry[];
  fightDurationSeconds: number;
  fightStartElapsed?: number; // seconds from sortie start when fight began
  rolls: CorRolls | null;
  mesoCount?: number;
  wsAccuracy?: PctEntry[];
  accuracy?: PctEntry[];
  critRate?: PctEntry[];
  meleeAverage?: AvgEntry[];
  meleeCritAverage?: AvgEntry[];
}

export interface BossReport {
  killed?: boolean;
  minHpPct?: number;
  damageReport: DamageEntry[];
  wsAverages: WsEntry[];
  fightDurationSeconds: number;
  fightStartElapsed?: number; // seconds from sortie start when fight began
  wsAccuracy?: PctEntry[];
  accuracy?: PctEntry[];
  critRate?: PctEntry[];
  meleeAverage?: AvgEntry[];
  meleeCritAverage?: AvgEntry[];
  // Extended (generic-tracker per-swing capture): ranged + magic offense and
  // per-player defensive rates vs this enemy. All optional / additive.
  rangedAccuracy?: PctEntry[];
  rangedCritRate?: PctEntry[];
  rangedAverage?: AvgEntry[];
  magicAccuracy?: PctEntry[];
  attacksPerRound?: AvgEntry[];
  evadeRate?: PctEntry[];
  parryRate?: PctEntry[];
  blockRate?: PctEntry[];
}

export interface ActionLogTarget {
  /** FFXI entity ID - distinguishes individual mobs sharing the same name. Optional for legacy data. */
  id?: number;
  mob: string;
  damage: number;
  result: 'hit' | 'miss' | 'land' | 'resist' | 'burst';
  /** Number of hits in the action (multi-hit WS). 0x028 result_sum. */
  hits?: number;
  /** Raw FFXI action message id - lets the UI classify crit / magic burst / resist / recovery. */
  message?: number;
  /** Raw FFXI reaction code (hit/miss/block/parry/guard/evade/counter bits). */
  reaction?: number;
  /** Additional effect (skillchain damage, enspell, drain). param = bonus value. */
  addEffect?: { message: number; param?: number };
  /** Spike effect (boss reactive damage: blaze/shock/dread spikes, counters). */
  spikeEffect?: { message: number; param?: number };
  procKind?: number;
  reactKind?: number;
  crit?: boolean;
  bitFlags?: number;
  swings?: { m?: number; d?: number; r?: number; am?: number; ap?: number }[];

  /** Owner name when this target is a pet of a party member (DRG wyvern, BST jug,
   *  PUP automaton, SMN avatar, GEO luopan). Set by the addon via Windower's
   *  pet_index linkage; authoritative regardless of pet's custom name. */
  petOf?: string;
  tgtRole?: 'pc' | 'trust' | 'pet' | 'mob' | 'boss' | 'outsider' | 'unknown';
}

export interface SkillchainEntry {
  elapsed: number;   // seconds from sortie start
  closer: string;    // actor who closed the skillchain
  ws: string;        // closing weapon skill / spell name
  mob: string;       // target the SC landed on
  sc: string;        // skillchain name (Light, Fragmentation, ...)
  damage: number;    // skillchain bonus damage
}

export interface PetLogEntry {
  elapsed: number;
  owner: string;
  pet: string;
  hpp: number;
}

export interface RawBattleMessage {
  elapsed: number;
  msgId: number;
  actorId?: number;
  targetId?: number;
  data?: number;
  data2?: number;
}

export interface JobExtendedEntry {
  elapsed: number;
  jobId: number;
  isSubJob: boolean;
  rawHex?: string;
  decoded?: {
    rolls?: string[];
    spellNames?: string[];
    frameName?: string;
    headName?: string;
    arts?: string;
  };
}

export interface EffectLogEntry {
  elapsed: number;
  entityId: number;
  effectNum: number;
  type: number;
  status: number;
  timer: number;
}

export interface ActionLogEntry {
  elapsed: number;   // seconds from sortie start
  player: string;    // actor name (boss name when from='boss')
  /** FFXI entity id of the actor. Lets the UI separate two same-named mobs
   *  acting in one encounter (e.g. 4 Temenos Golems). Optional for legacy data. */
  playerId?: number;
  category?: number;
  /** Raw action id within the category. Lets us debug "X labeled as Y" with
   *  the FFXI resource table directly. Optional for legacy data. */
  param?: number;
  type: 'ws' | 'spell' | 'mb' | 'enfeeb' | 'ja' | 'auto' | 'ranged';
  name: string;      // ability/spell name
  from?: 'player' | 'boss' | 'enemy' | 'buff' | 'item'; // 'enemy' = non-boss enemy hitting party (Sortie sector mobs). 'item' = synthesized from item_use_log. undefined treated as 'player' (legacy data).
  actorRole?: 'pc' | 'trust' | 'pet' | 'mob' | 'boss' | 'outsider' | 'unknown';
  /** Owner name when the actor is a pet of a party member. Set by the addon
   *  via Windower's pet_index linkage. Authoritative over name-based detection. */
  actorPetOf?: string;
  // v2 format: one entry per cast, N targets
  targets?: ActionLogTarget[];
  // v1 legacy format: flat single-target fields
  mob?: string;
  damage?: number;
  result?: 'hit' | 'miss' | 'land' | 'resist' | 'burst';
  castTimeMs?: number;
  phase?: 'interrupt' | 'start';
  interrupted?: boolean;
  tp?: number;
}

export interface SortieDrops {
  sapphire: number;
  starstone: number;
  eikondrite: number;
  octahedrite: number;
  hexahedrite: number;
  mesosiderite: number;
  oldCase: number;
  oldCasePlus1: number;
}

export interface MiniNmKill {
  name: string;
  sector: string; // 'A'–'H', or 'Aminon'
  elapsed: number; // seconds from sortie start
  type?: 'boss' | 'bonus' | 'aminon'; // undefined = 'bonus' for old entries
}

export interface DropLogEntry {
  name: string;    // e.g. "Old Case +1", "Eikondrite", "Sheet of Ra'Kaznar metal #G"
  area: string;    // current_area at time of drop
  elapsed: number; // seconds from sortie start
  type?: 'temp' | 'temporary' | 'pool' | 'direct';
  /** Rich-shape fields populated by the 0x0D2 packet path (Sortie + generic
   *  tracker). Absent on legacy text-scraped entries. */
  itemId?: number;
  count?: number;
  source?: string;  // dropper mob name
  by?: string;      // looter name (filled in via 0x0D3 correlation)
}

export interface NaakualSectorData {
  kills: Record<string, number | null>; // naakual name → elapsed seconds from sortie start
  completed: boolean;
  firstKill: number | null;
  lastKill: number | null;
  duration: number | null; // seconds from first to last kill
}

export type NaakualKills = Partial<Record<'E' | 'F' | 'G' | 'H', NaakualSectorData>>;

export interface BonusObjectives {
  aurumChest: boolean;
  naakualSets: number;
  basementMiniNms: string[];
  flans: boolean;
}

export interface TreasureChests {
  chests: string[];
  caskets: string[];
  coffers: string[];
}

export interface SectorObjectives {
  A: number; B: number; C: number; D: number;
  E: number; F: number; G: number; H: number;
}

export interface ChestLogEntry {
  // New format: raw NPC packet ID, resolved at display time via chestIds.ts
  npcId?: number;
  // Old format: pre-migration runs already have type/name resolved
  type?: 'Chest' | 'Casket' | 'Coffer' | 'Unknown';
  name?: string;
  // Common fields
  area: string;
  elapsed: number; // seconds since sortie start
}

export interface ZoneLogEntry {
  area: string;
  elapsed: number; // seconds since sortie start
  galli?: number;  // gallimaufry total at time of entering this area
}

export interface DeathEntry {
  player: string;
  area: string;
  elapsed: number; // seconds since sortie start
}

// ── Parse addon combat data ──────────────────────────────────────────────────

/** tally = number of times; damage = sum of damage dealt */
export interface ParseStatLeaf {
  tally?: number;
  damage?: number;
  max?: number;   // highest single damage seen for this action/hit
}

/** Per-ability map: ability name → {tally, damage} */
export type ParseAbilityMap = Record<string, ParseStatLeaf>;

export interface ParsePlayerCombat {
  total_damage?: number;
  /** Melee offensive stats (hit/miss/crit are stat names matching Parse's stat_types.melee) */
  melee?: {
    melee?: ParseStatLeaf;  // normal hits
    miss?:  ParseStatLeaf;
    crit?:  ParseStatLeaf;
  };
  /** Ranged offensive stats */
  ranged?: {
    ranged?: ParseStatLeaf; // normal ranged hits
    r_miss?: ParseStatLeaf;
    r_crit?: ParseStatLeaf;
  };
  /** Named-ability categories: WS, JA, spells, magic bursts, enfeebles */
  category?: {
    ws?:          ParseAbilityMap;
    ja?:          ParseAbilityMap;
    spell?:       ParseAbilityMap;
    mb?:          ParseAbilityMap; // magic bursts
    enfeeb?:      ParseAbilityMap;
    ws_miss?:     ParseAbilityMap;
    ja_miss?:     ParseAbilityMap;
    enfeeb_miss?: ParseAbilityMap;
  };
  /** Skillchains (sc), add-effects (add), spike/counter damage (spike) */
  other?: {
    sc?:    ParseStatLeaf;
    add?:   ParseStatLeaf;
    spike?: ParseStatLeaf;
  };
  /** Multihit breakdown: keys '1'–'8' = count of swings per strike */
  multi?: Record<string, ParseStatLeaf>;
  /** Defensive stats: what the mob did TO this player */
  defense?: {
    hit?:        ParseStatLeaf;
    crit_taken?: ParseStatLeaf;
    block?:      ParseStatLeaf; // player blocked
    parry?:      ParseStatLeaf;
    evade?:      ParseStatLeaf;
    absorb?:     ParseStatLeaf;
    intimidate?: ParseStatLeaf;
    shadow?:     ParseStatLeaf;
    anticipate?: ParseStatLeaf;
    nonblock?:   ParseStatLeaf; // hits that were NOT blocked (denominator for block%)
    nonparry?:   ParseStatLeaf; // hits that were NOT parried
    retrate?:    ParseStatLeaf; // retaliation procs
    nonret?:     ParseStatLeaf; // attacks where retaliation did not fire
  };
}

/** All players recorded against one mob */
export type ParseMobData = Record<string, ParsePlayerCombat>;

/** Top-level: mob name → per-player combat data */
export type ParseCombatStats = Record<string, ParseMobData>;

export interface AreaTimes {
  groundFloor: number;
  sectorE: number;
  sectorF: number;
  sectorG: number;
  sectorH: number;
  bossA: number;
  bossB: number;
  bossC: number;
  bossD: number;
  bossE: number;
  bossF: number;
  bossG: number;
  bossH: number;
  aminon: number;
}

export interface GearLogEntry {
  elapsed: number;
  player: string;
  type: string;   // 'ws' | 'spell' | 'ja' | 'enfeeb' | …
  name: string;   // action name
  gear: Record<string, { id: number; name: string; augments?: string[] }>;     // midcast for spells; the action set otherwise
  precast?: Record<string, { id: number; name: string; augments?: string[] }>; // spells only - the fast-cast set
}
export interface GearStateVariant {
  elapsed: number;
  count: number;
  gear: Record<string, { id: number; name: string; augments?: string[] }>;
}
export interface CharacterGear {
  gearLog?: GearLogEntry[] | null;
  stateSets?: Record<string, GearStateVariant[]> | null;
  positionLog?: PositionLogEntry[] | null;
  buffLog?: BuffLogEntry[] | null;
  progressionLog?: import('./encounter').ProgressionEvent[] | null;
  progressionStart?: import('./encounter').ProgressionSnapshot | null;
  progressionEnd?: import('./encounter').ProgressionSnapshot | null;
  currencyStart?: import('./encounter').CurrencySnapshot | null;
  currencyEnd?: import('./encounter').CurrencySnapshot | null;
}
// Mixin for any record/run that carries the self gear/state capture.
export interface GearCapture extends CharacterGear {
  // The box's own character name - every report tags itself so 6 multiboxed
  // clients' files can be merged per character (Phase 1).
  localCharacter?: string | null;
  // Multibox merge result (desktop-only): each character's own gear, keyed by
  // name. Present only on a merged report; single-box reports use the flat fields.
  gearByPlayer?: Record<string, CharacterGear> | null;
}
// Pull the gear/state capture out of a parsed report body (every content module
// + the generic tracker emit `gearLog` / `stateSets` / `localCharacter`).
export function extractGearCapture(body: { gearLog?: unknown; stateSets?: unknown; localCharacter?: unknown }): GearCapture {
  return {
    gearLog: Array.isArray(body.gearLog) ? (body.gearLog as GearLogEntry[]) : null,
    stateSets: (body.stateSets && typeof body.stateSets === 'object' && !Array.isArray(body.stateSets))
      ? (body.stateSets as Record<string, GearStateVariant[]>) : null,
    localCharacter: typeof body.localCharacter === 'string' ? body.localCharacter : null,
  };
}

export interface ParsedRun extends GearCapture {
  runDate: Date;
  addonVersion?: string;
  gallimaufry: number;
  oldCasePlus1: number;
  defeatedBosses: string[];
  party: PartyMember[];
  playerIds?: Record<string, number> | null;
  bonusObjectives: BonusObjectives;
  treasureChests: TreasureChests;
  sectorObjectives: SectorObjectives;
  aminon: AminonData | null;
  bossReports: Record<string, BossReport> | null;
  areaTimes: AreaTimes | null;
  zoneLog: ZoneLogEntry[] | null;
  deathLog: DeathEntry[] | null;
  chestLog: ChestLogEntry[] | null;
  naakualKills: NaakualKills | null;
  miniNmLog: MiniNmKill[] | null;
  dropLog: DropLogEntry[] | null;
  drops: SortieDrops | null;
  notes: string;
  sortieStartTime: number | null; // Unix timestamp (os.time()) when Sortie was entered
  combatStats: ParseCombatStats | null;
  actionLog: ActionLogEntry[] | null;
  killLog: KillLogEntry[] | null;
  itemUseLog: ItemUseLogEntry[] | null;
  positionLog: PositionLogEntry[] | null;
  bossHpLog: BossHpEntry[] | null;
  partyHpLog: PartyHpEntry[] | null;
  partyTpLog: PartyTpEntry[] | null;
  partyMpLog: PartyMpEntry[] | null;
  buffLog: BuffLogEntry[] | null;
  skillchainLog: SkillchainEntry[] | null;
  petLog: PetLogEntry[] | null;
  battleMsgRaw?: RawBattleMessage[] | null;
  jobExtendedLog?: JobExtendedEntry[] | null;
  effectLog?: EffectLogEntry[] | null;
  partyMaxHp?: Record<string, number> | null;
  partyMaxMp?: Record<string, number> | null;
  points?: { xp: number; cp: number; ep: number; lp: number } | null;
}

export interface KillLogEntry {
  id: number;      // FFXI entity ID
  name: string;
  area: string;
  elapsed: number; // seconds from sortie start
}

export interface ItemUseLogEntry {
  elapsed: number; // seconds from sortie start
  player: string;
  item: string;
  itemId: number;
  area: string;
}

export interface PositionLogEntry {
  elapsed: number;       // seconds from sortie start
  x: number;             // FFXI world X
  y: number;             // FFXI world Y
  z: number;             // FFXI world Z (height)
  dir: number;           // heading byte (0-255)
  area: string;          // current Sortie area at the time of sampling
}

export interface BossHpEntry {
  elapsed: number;       // seconds from sortie start
  name: string;          // boss name (e.g. "Aita", "Aminon")
  hpp: number;           // hp percent 0-100
  id?: number;           // entity id - disambiguates same-named mobs (generic tracker)
  /** Mob MP percent (0-100) at sample time. Captured from the same get_mob_by_id
   *  call as `hpp`. Absent on pre-fix logs. Future use: caster mob MP-burn analysis. */
  mpp?: number;
  /** Mob TP at sample time (0-3000). Absent on pre-fix logs.
   *  Future use: predict TP-move thresholds, anti-skillchain timing. */
  tp?: number;
  /** Entity id of whichever PC currently has claim. 0/undefined = unclaimed.
   *  Absent on pre-fix logs. Future use: claim transitions, "who pulled" math. */
  claim?: number;
}

export interface PartyHpEntry {
  elapsed: number;       // seconds from sortie start
  playerId?: number;     // entity id - stable join key. Optional for legacy reports.
  player: string;
  hpp: number;           // hp percent 0-100
}

export interface PartyTpEntry {
  elapsed: number;       // seconds from run start
  playerId?: number;
  player: string;
  tp: number;            // 0-3000 TP value
}

export interface PartyMpEntry {
  elapsed: number;       // seconds from run start
  playerId?: number;
  player: string;
  mpp: number;           // mp percent 0-100
}

export interface BuffLogEntry {
  elapsed: number;       // seconds from sortie start
  kind: 'gain' | 'wear';
  target: string;        // entity name (boss or party member)
  targetId?: number;     // FFXI entity id
  buffId: number;        // res.buffs id
  buffName: string;      // resolved english name
  source?: '0x028' | '0x029' | '0x063' | 'party_poll';
  appliedBy?: string;    // caster name (0x028 gains only; null for state-diff sources)
  appliedBySpell?: string; // action that inflicted it, e.g. "Wind Threnody II" (0x028 gains only)
  duration?: number;
}


// ── User Profile ──────────────────────────────────────────────────────────────

export interface CharacterEntry {
  name: string;
  server: string;
  verified?: boolean;
}

export interface UserProfile {
  id: string;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
  characters: CharacterEntry[];
  is_admin: boolean;
  anonymous: boolean;
  theme: 'default' | 'dusk' | 'teal' | 'crimson';
}

// ── Sortie DB row ─────────────────────────────────────────────────────────────

// Database row shape returned from Supabase
export interface RunRecord extends GearCapture {
  id: string;
  user_id: string;
  created_at: string;
  is_public: boolean;
  run_date: string;
  addonVersion?: string;
  gallimaufry: number;
  old_case_plus1: number;
  defeated_bosses: string[];
  party: PartyMember[];
  /** Name → entity id map for everything in this report (combat_stats keys,
   *  gearLog player names, etc.). Stable join key the anonymizer uses to
   *  pair name-mismatched fields with the right party member. Absent for
   *  legacy reports written before the addon emitted this. */
  playerIds?: Record<string, number> | null;
  bonus_objectives: BonusObjectives;
  treasure_chests: TreasureChests | null;
  sector_objectives: SectorObjectives | null;
  aminon: AminonData | null;
  boss_reports: Record<string, BossReport> | null;
  area_times: AreaTimes | null;
  zone_log: ZoneLogEntry[] | null;
  death_log: DeathEntry[] | null;
  chest_log: ChestLogEntry[] | null;
  naakual_kills: NaakualKills | null;
  mini_nm_log: MiniNmKill[] | null;
  drop_log: DropLogEntry[] | null;
  drops: SortieDrops | null;
  notes: string;
  sortie_start_time: string | null; // ISO timestamptz - when Sortie was entered
  raw_text: string;
  combat_stats: ParseCombatStats | null;
  action_log: ActionLogEntry[] | null;
  kill_log: KillLogEntry[] | null;
  item_use_log: ItemUseLogEntry[] | null;
  position_log: PositionLogEntry[] | null;
  boss_hp_log: BossHpEntry[] | null;
  party_hp_log: PartyHpEntry[] | null;
  party_tp_log: PartyTpEntry[] | null;
  party_mp_log: PartyMpEntry[] | null;
  buff_log: BuffLogEntry[] | null;
  skillchain_log: SkillchainEntry[] | null;
  pet_log: PetLogEntry[] | null;
  battle_msg_raw?: RawBattleMessage[] | null;
  job_extended_log?: JobExtendedEntry[] | null;
  effect_log?: EffectLogEntry[] | null;
  party_max_hp?: Record<string, number> | null;
  party_max_mp?: Record<string, number> | null;
  points?: { xp: number; cp: number; ep: number; lp: number } | null;
}
