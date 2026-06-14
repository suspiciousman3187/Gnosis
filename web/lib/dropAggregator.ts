
import type { EncounterDrop, EncounterEnemy } from './encounter';
import type { KillLogEntry } from './types';

export interface LootEncounterSummary {
  path: string;
  ts: number;                 // unix-second startTime; sorts a kill across the whole library
  zone: string | null;
  zoneId: number | null;
  durationSeconds: number;
  killLog: KillLogEntry[];
  dropLog: EncounterDrop[];
  /** enemies[] gives us the per-instance firstSeen/killedAt window, mainly
   *  useful when a same-named mob died multiple times in one encounter. */
  enemies: EncounterEnemy[];
}

/** Filters applied BEFORE aggregation. UI keeps these in component state.
 *  Empty / undefined means "no constraint" for that axis. */
export interface LootFilters {
  /** Lowercased substring against mob name + item name (mob OR item match wins). */
  query?: string;
  /** Set of zone names (case-sensitive, matches Encounter.zoneName); empty = all. */
  zones?: Set<string>;
  /** Inclusive epoch-second range; absent bound = open-ended. */
  startTs?: number;
  endTs?: number;
}

function wilsonHalfWidth(successes: number, n: number): number {
  if (n === 0) return 0;
  const z = 1.96; // 95% two-sided
  const p = successes / n;
  // Wilson interval bounds; we want the half-width.
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  const lo = (center - margin) / denom;
  const hi = (center + margin) / denom;
  return (hi - lo) / 2;
}

interface KillRecord {
  /** Sortable global time of the kill (encounter.ts + kill.elapsed). */
  absTs: number;
  /** Owning encounter file - for "open the run where this kill happened" links. */
  path: string;
  /** Encounter-local elapsed (used for windowing inside the source encounter). */
  elapsed: number;
}

interface DropRecord {
  absTs: number;
  path: string;
  elapsed: number;
  count: number;
  by?: string;
}

/** Per-(mob,item) statistics, scoped to the filter set. */
export interface ItemFromMobStats {
  item: string;
  itemId?: number;
  drops: number;          // total drops (sum of counts)
  rate: number;           // drops / mobKills, 0..1
  ratePctHalfWidth: number; // Wilson 95% half-width, in PERCENT points
  lastDropKillIndex: number | null; // 1-based kill # of mob where this last dropped (within the filtered timeline)
  killsSinceLastDrop: number; // mobKills - lastDropKillIndex when known; mobKills when never seen
  longestDryStreak: number;
  firstDropTs: number | null;
  firstDropPath: string | null;
  lastDropTs: number | null;
  lastDropPath: string | null;
  looters: { name: string; count: number; pct: number }[];
  /** Drop markers (1-based kill indexes) - drives the strip-strip viz. */
  dropKillIndexes: number[];
}

export interface MobLootStats {
  mob: string;
  kills: number;
  uniqueItems: number;
  firstKillTs: number;
  lastKillTs: number;
  items: ItemFromMobStats[]; // sorted by drop count desc
  /** Total times something dropped from this mob - useful for the "X drops over Y kills"
   *  headline; can be > sum of items[].drops/total counts since stacks count by 1 drop. */
  totalDropEvents: number;
}

/** Inverse index: per-item, every mob that has dropped it. */
export interface ItemSourceStats {
  mob: string;
  drops: number;
  killsOfMob: number;
  rate: number;
  ratePctHalfWidth: number;
}

export interface ItemLootStats {
  item: string;
  itemId?: number;
  totalDrops: number;     // sum across all sources (count-weighted)
  totalDropEvents: number; // raw drop-event count (stacks count as one)
  firstDropTs: number | null;
  firstDropPath: string | null;
  lastDropTs: number | null;
  lastDropPath: string | null;
  sources: ItemSourceStats[]; // sorted by drops desc
  looters: { name: string; count: number; pct: number }[];
}

export interface LootCatalog {
  /** Encounters whose data fed this catalog (after filter). */
  encounterCount: number;
  killCount: number;
  dropCount: number;
  mobs: MobLootStats[];           // sorted by kills desc
  items: ItemLootStats[];         // sorted by totalDrops desc
  /** Used to render "based on data since YYYY-MM-DD" in the header. */
  earliestTs: number | null;
  latestTs: number | null;
}

const EMPTY: LootCatalog = {
  encounterCount: 0, killCount: 0, dropCount: 0,
  mobs: [], items: [], earliestTs: null, latestTs: null,
};

/** Pre-filter an encounter against the user's zone + date constraints. */
function encounterPasses(enc: LootEncounterSummary, f: LootFilters): boolean {
  if (f.zones && f.zones.size > 0 && (!enc.zone || !f.zones.has(enc.zone))) return false;
  if (f.startTs != null && enc.ts < f.startTs) return false;
  if (f.endTs != null && enc.ts > f.endTs) return false;
  return true;
}

/** Build the cross-run loot catalog from the cached encounter summaries. */
export function aggregateLoot(
  entries: LootEncounterSummary[],
  filters: LootFilters = {},
): LootCatalog {
  if (entries.length === 0) return EMPTY;
  const passed = entries.filter(e => encounterPasses(e, filters));
  if (passed.length === 0) return EMPTY;

  const killsByMob = new Map<string, KillRecord[]>();
  for (const enc of passed) {
    for (const k of enc.killLog) {
      const arr = killsByMob.get(k.name) ?? [];
      arr.push({ absTs: enc.ts + k.elapsed, path: enc.path, elapsed: k.elapsed });
      killsByMob.set(k.name, arr);
    }
  }
  for (const arr of killsByMob.values()) arr.sort((a, b) => a.absTs - b.absTs);

  type MobItemBucket = { items: Map<string, DropRecord[]> };
  const byMob = new Map<string, MobItemBucket>();
  // Inverse index - same drops, keyed by item first then by mob.
  type ItemMobBucket = { sources: Map<string, DropRecord[]> };
  const byItem = new Map<string, ItemMobBucket>();
  // Looter rollups (kept independent of kill attribution so a drop without
  // a kill window still feeds the "who got it" share).
  const looterByMobItem = new Map<string, Map<string, number>>(); // key = `${mob}|${item}`
  const looterByItem = new Map<string, Map<string, number>>();
  // Cache item IDs (first time we see an item the addon attached an id).
  const itemIdOf = new Map<string, number>();

  const NO_SOURCE = '(no source)';
  const CROSS_BOX_DROP_WINDOW = 5;
  const seenDropKey = new Map<string, number>();
  let dropCount = 0;
  for (const enc of passed) {
    for (const d of enc.dropLog) {
      const dropKey = `${enc.ts}:${d.name}:${d.source ?? ''}:${d.itemId ?? 0}`;
      const prevElapsed = seenDropKey.get(dropKey);
      if (prevElapsed != null && Math.abs(d.elapsed - prevElapsed) <= CROSS_BOX_DROP_WINDOW) continue;
      seenDropKey.set(dropKey, d.elapsed);
      dropCount += d.count ?? 1;
      if (d.itemId != null && !itemIdOf.has(d.name)) itemIdOf.set(d.name, d.itemId);
      const drec: DropRecord = {
        absTs: enc.ts + d.elapsed,
        path: enc.path,
        elapsed: d.elapsed,
        count: d.count ?? 1,
        by: d.by,
      };
      // by-mob: only pool drops whose `source` is a kill-attributable mob -
      // rate math (drops/kills) is meaningless otherwise.
      if (d.source && d.type === 'pool') {
        let mb = byMob.get(d.source);
        if (!mb) { mb = { items: new Map() }; byMob.set(d.source, mb); }
        let mbItems = mb.items.get(d.name);
        if (!mbItems) { mbItems = []; mb.items.set(d.name, mbItems); }
        mbItems.push(drec);
      }
      const srcKey = d.source ?? NO_SOURCE;
      let ib = byItem.get(d.name);
      if (!ib) { ib = { sources: new Map() }; byItem.set(d.name, ib); }
      let ibSources = ib.sources.get(srcKey);
      if (!ibSources) { ibSources = []; ib.sources.set(srcKey, ibSources); }
      ibSources.push(drec);
      // looters: any drop with a recorded looter (pool or direct), so per-
      // item looter shares stay honest even for non-pool drops.
      if (d.by) {
        if (d.source) {
          const k1 = `${d.source}|${d.name}`;
          const m1 = looterByMobItem.get(k1) ?? new Map<string, number>();
          m1.set(d.by, (m1.get(d.by) ?? 0) + (d.count ?? 1));
          looterByMobItem.set(k1, m1);
        }
        const m2 = looterByItem.get(d.name) ?? new Map<string, number>();
        m2.set(d.by, (m2.get(d.by) ?? 0) + (d.count ?? 1));
        looterByItem.set(d.name, m2);
      }
    }
  }

  const q = (filters.query ?? '').trim().toLowerCase();
  const matchesQuery = (s: string) => !q || s.toLowerCase().includes(q);

  // Helper - binary search for the largest index with kills[i].absTs <= t.
  // Returns -1 when t precedes every kill.
  function killIndexAtOrBefore(kills: KillRecord[], t: number): number {
    let lo = 0, hi = kills.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (kills[mid].absTs <= t) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  // ── Build the mob-side rollup ────────────────────────────────────────────
  const mobs: MobLootStats[] = [];
  for (const [mobName, bucket] of byMob) {
    const kills = killsByMob.get(mobName) ?? [];
    if (kills.length === 0) continue; // drops without kills can't have rates
    const items: ItemFromMobStats[] = [];
    let totalDropEvents = 0;
    for (const [itemName, drops] of bucket.items) {
      drops.sort((a, b) => a.absTs - b.absTs);
      totalDropEvents += drops.length;
      // Per-drop kill index (1-based).
      const dropKillIndexes: number[] = [];
      let lastIdx: number | null = null;
      for (const dr of drops) {
        const i0 = killIndexAtOrBefore(kills, dr.absTs);
        if (i0 < 0) continue;
        const idx1 = i0 + 1;
        dropKillIndexes.push(idx1);
        lastIdx = idx1;
      }
      let longestDry = 0;
      let prev = 0; // sentinel before first kill
      for (const k of dropKillIndexes) {
        const gap = k - prev - 1; // kills since last drop (or start) without one
        if (gap > longestDry) longestDry = gap;
        prev = k;
      }
      const trailingDry = kills.length - prev;
      if (trailingDry > longestDry) longestDry = trailingDry;
      const dropsTotal = drops.reduce((s, d) => s + d.count, 0);
      const rate = dropsTotal / kills.length;
      const hw = wilsonHalfWidth(dropsTotal, kills.length) * 100;
      const looterMap = looterByMobItem.get(`${mobName}|${itemName}`);
      const looterTotal = looterMap ? Array.from(looterMap.values()).reduce((s, n) => s + n, 0) : 0;
      const looters = looterMap
        ? Array.from(looterMap.entries())
            .map(([name, count]) => ({ name, count, pct: looterTotal > 0 ? +(count / looterTotal * 100).toFixed(1) : 0 }))
            .sort((a, b) => b.count - a.count)
        : [];
      items.push({
        item: itemName,
        itemId: itemIdOf.get(itemName),
        drops: dropsTotal,
        rate,
        ratePctHalfWidth: hw,
        lastDropKillIndex: lastIdx,
        killsSinceLastDrop: lastIdx != null ? kills.length - lastIdx : kills.length,
        longestDryStreak: longestDry,
        firstDropTs: drops[0]?.absTs ?? null,
        firstDropPath: drops[0]?.path ?? null,
        lastDropTs: drops[drops.length - 1]?.absTs ?? null,
        lastDropPath: drops[drops.length - 1]?.path ?? null,
        looters,
        dropKillIndexes,
      });
    }
    items.sort((a, b) => b.drops - a.drops);
    const anyItemMatches = items.some(i => matchesQuery(i.item));
    if (!matchesQuery(mobName) && !anyItemMatches) continue;
    mobs.push({
      mob: mobName,
      kills: kills.length,
      uniqueItems: items.length,
      firstKillTs: kills[0].absTs,
      lastKillTs: kills[kills.length - 1].absTs,
      items,
      totalDropEvents,
    });
  }
  mobs.sort((a, b) => b.kills - a.kills);

  // ── Build the item-side rollup ───────────────────────────────────────────
  const items: ItemLootStats[] = [];
  for (const [itemName, bucket] of byItem) {
    const sources: ItemSourceStats[] = [];
    let totalDrops = 0, totalDropEvents = 0;
    let firstTs: number | null = null, lastTs: number | null = null;
    let firstPath: string | null = null;
    let lastPath: string | null = null;
    for (const [mobName, drops] of bucket.sources) {
      const kills = killsByMob.get(mobName) ?? [];
      const dropsCount = drops.reduce((s, d) => s + d.count, 0);
      totalDrops += dropsCount;
      totalDropEvents += drops.length;
      for (const d of drops) {
        if (firstTs == null || d.absTs < firstTs) { firstTs = d.absTs; firstPath = d.path; }
        if (lastTs  == null || d.absTs > lastTs)  { lastTs = d.absTs; lastPath = d.path; }
      }
      sources.push({
        mob: mobName,
        drops: dropsCount,
        killsOfMob: kills.length,
        rate: kills.length > 0 ? dropsCount / kills.length : 0,
        ratePctHalfWidth: kills.length > 0 ? wilsonHalfWidth(dropsCount, kills.length) * 100 : 0,
      });
    }
    sources.sort((a, b) => b.drops - a.drops);
    const anySourceMatches = sources.some(s => matchesQuery(s.mob));
    if (!matchesQuery(itemName) && !anySourceMatches) continue;
    const looterMap = looterByItem.get(itemName);
    const looterTotal = looterMap ? Array.from(looterMap.values()).reduce((s, n) => s + n, 0) : 0;
    const looters = looterMap
      ? Array.from(looterMap.entries())
          .map(([name, count]) => ({ name, count, pct: looterTotal > 0 ? +(count / looterTotal * 100).toFixed(1) : 0 }))
          .sort((a, b) => b.count - a.count)
      : [];
    items.push({
      item: itemName,
      itemId: itemIdOf.get(itemName),
      totalDrops,
      totalDropEvents,
      firstDropTs: firstTs,
      firstDropPath: firstPath,
      lastDropTs: lastTs,
      lastDropPath: lastPath,
      sources,
      looters,
    });
  }
  items.sort((a, b) => b.totalDrops - a.totalDrops);

  // Library-wide bounds for the header subtitle.
  let earliestTs: number | null = null;
  let latestTs: number | null = null;
  for (const e of passed) {
    if (earliestTs == null || e.ts < earliestTs) earliestTs = e.ts;
    if (latestTs == null || e.ts > latestTs) latestTs = e.ts;
  }

  return {
    encounterCount: passed.length,
    killCount: passed.reduce((s, e) => s + e.killLog.length, 0),
    dropCount,
    mobs, items, earliestTs, latestTs,
  };
}

/** Sorted unique zone names from the loot cache - feeds the zone filter chip strip. */
export function zonesFromLootEntries(entries: LootEncounterSummary[]): string[] {
  const s = new Set<string>();
  for (const e of entries) if (e.zone) s.add(e.zone);
  return Array.from(s).sort();
}
