
import type { LootEncounterSummary } from './dropAggregator';
import {
  classify, mobNamesFromLootSummary, itemNamesFromLootSummary,
  CONTENT_REGISTRY, type ContentDef, type ClassifyInput,
} from './contentRegistry';

export interface ActivityEncounter {
  path: string;
  ts: number;
  kind: 'encounter' | 'sortie';
  loot?: LootEncounterSummary;
  sheolType?: 'A' | 'B' | 'C';
  /** Cheap label derived at cache-build time - drives the drill-down's
   *  Runs list without re-parsing. Empty string when unavailable. */
  label?: string;
}

export interface ActivityRollup {
  def: ContentDef;
  encounters: ActivityEncounter[];
  runCount: number;
  /** Sum of `durationSeconds` from any encounter that exposes one (loot
   *  summary). Content-module entries contribute 0 until v2 adds parsing. */
  totalSeconds: number;
  firstRunTs: number;
  lastRunTs: number;
  /** Notable-boss completion (lifetime). Only meaningful when loot summaries
   *  are present; computed from killLog/dropLog source unions. */
  notableBossesSeen: number;
  notableBossesTotal: number;
  topDrops: { item: string; itemId?: number; count: number }[];
}

export interface ActivitiesCatalog {
  rollups: ActivityRollup[];
  /** Encounters that didn't match any registered Activity - surfaced as
   *  the "Uncategorized" footer on the hub so users can spot stragglers. */
  uncategorized: ActivityEncounter[];
  /** Earliest / latest timestamps across ALL classified runs, for the hub
   *  header subtitle ("tracking since ..."). */
  earliestTs: number | null;
  latestTs: number | null;
}

const EMPTY: ActivitiesCatalog = {
  rollups: [], uncategorized: [], earliestTs: null, latestTs: null,
};

/** Build the full Activities catalog. Pure function - caller is responsible
 *  for memoizing on the input arrays. */
export function aggregateActivities(entries: ActivityEncounter[]): ActivitiesCatalog {
  if (entries.length === 0) return EMPTY;

  // Bucket entries by content id. Uncategorized falls into the footer pile.
  const byId = new Map<string, ActivityEncounter[]>();
  const uncategorized: ActivityEncounter[] = [];
  for (const e of entries) {
    const input: ClassifyInput = {
      kind: e.kind,
      zoneId: e.loot?.zoneId ?? null,
      zoneName: e.loot?.zone ?? null,
      mobNames: e.loot ? mobNamesFromLootSummary(e.loot) : new Set<string>(),
      itemNames: e.loot ? itemNamesFromLootSummary(e.loot) : new Set<string>(),
      sheolType: e.sheolType,
    };
    const def = classify(input);
    if (!def) { uncategorized.push(e); continue; }
    const arr = byId.get(def.id) ?? [];
    arr.push(e);
    byId.set(def.id, arr);
  }

  // Walk the registry order so tiles render in a deterministic order
  // regardless of which content the user has actually engaged with first.
  const rollups: ActivityRollup[] = [];
  for (const def of CONTENT_REGISTRY) {
    const enc = byId.get(def.id);
    if (!enc || enc.length === 0) continue;
    rollups.push(rollOne(def, enc));
  }

  // Library-wide bounds for the header subtitle.
  let earliestTs: number | null = null;
  let latestTs: number | null = null;
  for (const e of entries) {
    if (earliestTs == null || e.ts < earliestTs) earliestTs = e.ts;
    if (latestTs == null || e.ts > latestTs) latestTs = e.ts;
  }

  return { rollups, uncategorized, earliestTs, latestTs };
}

function rollOne(def: ContentDef, encounters: ActivityEncounter[]): ActivityRollup {
  const notableNames = new Set<string>();
  for (const b of def.bosses) if (b.notable) notableNames.add(b.name);

  const seenBosses = new Set<string>();
  let totalSeconds = 0;
  let firstRunTs = Number.POSITIVE_INFINITY;
  let lastRunTs = Number.NEGATIVE_INFINITY;
  type DropTally = { item: string; itemId?: number; count: number };
  const drops = new Map<string, DropTally>();

  for (const e of encounters) {
    if (e.ts < firstRunTs) firstRunTs = e.ts;
    if (e.ts > lastRunTs)  lastRunTs  = e.ts;
    if (!e.loot) continue;
    totalSeconds += e.loot.durationSeconds || 0;
    for (const k of e.loot.killLog) if (notableNames.has(k.name)) seenBosses.add(k.name);
    for (const en of e.loot.enemies) if (notableNames.has(en.name)) seenBosses.add(en.name);
    for (const d of e.loot.dropLog) {
      if (!d.name) continue;
      const t = drops.get(d.name) ?? { item: d.name, count: 0 };
      t.count += d.count ?? 1;
      if (t.itemId == null && typeof d.itemId === 'number') t.itemId = d.itemId;
      drops.set(d.name, t);
    }
  }

  // Top 5 by total quantity. The full Loot drill-down view uses the lifetime
  // loot aggregator separately - this is just the tile-summary row.
  const topDrops = [...drops.values()].sort((a, b) => b.count - a.count).slice(0, 5);

  return {
    def,
    encounters,
    runCount: encounters.length,
    totalSeconds,
    firstRunTs: firstRunTs === Number.POSITIVE_INFINITY ? 0 : firstRunTs,
    lastRunTs:  lastRunTs  === Number.NEGATIVE_INFINITY ? 0 : lastRunTs,
    notableBossesSeen: seenBosses.size,
    notableBossesTotal: notableNames.size,
    topDrops,
  };
}

/** Convenience: pull just the encounters in an Activity (drives the drill-
 *  down's Runs list without re-aggregating). */
export function encountersForActivity(
  catalog: ActivitiesCatalog,
  contentId: string,
): ActivityEncounter[] {
  return catalog.rollups.find(r => r.def.id === contentId)?.encounters ?? [];
}
