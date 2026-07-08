
import type {
  PartyMember,
  BossReport,
  ParseCombatStats,
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
  KillLogEntry,
  DeathEntry,
  JobChangeEntry,
  GearLogEntry,
  GearStateVariant,
  CharacterGear,
} from './types';

// Which kind of content this encounter was recognized as. 'generic' = free
// combat tracking with no recognized content (the base case).
export type EncounterSource = 'generic' | 'sortie' | 'limbus' | 'odyssey' | 'omen' | 'ambuscade';

/** Client language the encounter was captured under. Drives which language the
 *  stored names (actions, items, buffs, zones) are in. Older files without
 *  this field are treated as 'en' for backwards compatibility. */
export type EncounterLanguage = 'en' | 'ja';

export type SegmentationMode = 'manual' | 'combat-idle' | 'zone' | 'session';


export type TrackingMode = 'off' | 'zone' | 'fight' | 'session';
export type CaptureGate = 'off' | 'zones' | 'always' | 'manual';

export interface TrackingConfig {
  mode: TrackingMode;
  // Advanced overrides - when set, take precedence over the preset's defaults.
  gate?: CaptureGate;
  boundary?: SegmentationMode;
  // Knobs:
  idleTimeoutSec: number;       // combat-idle boundary: close after this much no-combat
  instancedZonesOnly: boolean;  // zone gate: only open encounters in instanced zones
  pruneEmptyZones: boolean;     // zone boundary: discard a zone encounter that saw no combat
}

export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  mode: 'off',
  idleTimeoutSec: 30,
  instancedZonesOnly: false,
  pruneEmptyZones: true,
};

export interface EncounterDrop {
  name: string;
  elapsed: number;
  itemId?: number;  // for icon lookup (pool drops); absent for text-only drops
  count?: number;   // stack size / gil amount when > 1
  source?: string;
  by?: string;
  type?: 'pool' | 'direct' | 'temporary';
  poolIndex?: number;
}

// Self gear capture types live in the shared spec (types.ts); re-exported here
// so existing imports from '@/lib/encounter' keep working.
export type { GearLogEntry, GearStateVariant };

export interface ProgressionEvent {
  elapsed: number;
  kind: 'xp' | 'cp' | 'lp' | 'ep';
  value: number;
  msg?: number;
}

export interface ProgressionSnapshot {
  mainJob?: number;
  mainJobLevel?: number;
  subJob?: number;
  subJobLevel?: number;
  xpCurrent?: number;
  xpToNext?: number;
  epCurrent?: number;
  epToNext?: number;
  masterLevel?: number;
  unityPoints?: number;
}

export interface KeyItemEvent {
  elapsed: number;
  kiId: number;
  kiName: string;
}

export type CurrencySnapshot = Record<string, number>;

// One enemy fought during the encounter. Generalizes the old "known boss" set
// to any mob, keyed by entity id when available so same-named instances split.
export interface EncounterEnemy {
  name: string;
  id?: number;
  firstSeen: number;        // elapsed seconds from encounter start
  killedAt: number | null;  // elapsed seconds, null if it survived/unconfirmed
  damageTaken: number;      // total damage the party dealt to it
  spawnSeq?: number;
}

export type EncounterContent =
  | { type: 'generic' }
  | { type: 'sortie'; data: Record<string, unknown> };

export interface ZoneLogEntry {
  elapsed: number;
  zoneId: number;
  zoneName: string;
}

export interface Encounter {
  // ── Identity / lifecycle ──────────────────────────────────────────────────
  id: string;
  source: EncounterSource;
  language?: EncounterLanguage;
  segmentation: SegmentationMode;
  zoneId: number | null;
  zoneName: string | null;
  zoneLog?: ZoneLogEntry[] | null;
  startTime: number;        // unix epoch seconds (os.time() at encounter open)
  durationSeconds: number;
  addonVersion?: string;

  // ── Roster ────────────────────────────────────────────────────────────────
  party: PartyMember[];
  /** Name → entity id map for everything in this encounter. Stable join key
   *  for the anonymizer. Absent for legacy reports. */
  playerIds?: Record<string, number> | null;
  enemies: EncounterEnemy[];

  // ── Universal combat logs (the shared engine output) ──────────────────────
  actionLog: ActionLogEntry[] | null;
  skillchainLog: SkillchainEntry[] | null;
  buffLog: BuffLogEntry[] | null;
  itemUseLog: ItemUseLogEntry[] | null;
  petLog: PetLogEntry[] | null;
  battleMsgRaw?: RawBattleMessage[] | null;
  jobExtendedLog?: JobExtendedEntry[] | null;
  effectLog?: EffectLogEntry[] | null;
  bossHpLog: BossHpEntry[] | null;
  partyHpLog: PartyHpEntry[] | null;
  partyTpLog: PartyTpEntry[] | null;
  partyMpLog: PartyMpEntry[] | null;
  partyMaxHp?: Record<string, number> | null;
  partyMaxMp?: Record<string, number> | null;
  points?: { xp: number; cp: number; ep: number; lp: number } | null;
  positionLog: PositionLogEntry[] | null;
  partyPositionLog: { elapsed: number; player: string; x: number; y: number; z: number; dir?: number }[] | null;
  killLog: KillLogEntry[] | null;
  deathLog: DeathEntry[] | null;
  dropLog: EncounterDrop[] | null;
  progressionLog?: ProgressionEvent[] | null;
  progressionStart?: ProgressionSnapshot | null;
  progressionEnd?: ProgressionSnapshot | null;
  currencyStart?: CurrencySnapshot | null;
  currencyEnd?: CurrencySnapshot | null;
  keyItemLog?: KeyItemEvent[] | null;
  jobChangeLog?: JobChangeEntry[] | null;
  gearLog: GearLogEntry[] | null;

  // State gearsets keyed by observed-state label ('Engaged' | 'Idle' |
  // 'Idle (Pet)' | 'Resting' | 'Ranged') → deduped variants. Local player only.
  stateSets?: Record<string, GearStateVariant[]> | null;

  // Multibox: the box's own character (tags the report) and, on a merged report,
  // each character's gear keyed by name.
  localCharacter?: string | null;
  gearByPlayer?: Record<string, CharacterGear> | null;

  // Parse-derived combat stats (accuracy/crit/WS averages), when available.
  combatStats: ParseCombatStats | null;

  // Per-enemy damage breakdown - the generalization of the old per-boss
  // BossReport map, now keyed by ANY enemy name (not a fixed boss set).
  enemyReports: Record<string, BossReport> | null;

  // ── Content enrichment (only for recognized content) ──────────────────────
  content: EncounterContent;

  notes: string;
  rawText?: string;
}

function deepReplaceName<T>(node: T, raw: string, canon: string): T {
  if (typeof node === 'string') return (node === raw ? canon : node) as T;
  if (Array.isArray(node)) return node.map(v => deepReplaceName(v, raw, canon)) as unknown as T;
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k === raw ? canon : k] = deepReplaceName(v, raw, canon);
    return out as T;
  }
  return node;
}

export function reconcileSelfName(enc: Encounter): Encounter {
  const canon = enc.gearLog && enc.gearLog.length > 0 ? enc.gearLog[0].player : null;
  const raw = enc.localCharacter;
  if (!canon || !raw || raw === canon) return enc;
  return deepReplaceName(enc, raw, canon);
}
