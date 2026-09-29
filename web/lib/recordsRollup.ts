import { aggregateLoot, type LootEncounterSummary } from './dropAggregator';

// Bump when the rollup shape or aggregation logic changes, so a persisted
// rollup from an older build is rejected and rebuilt.
export const RECORDS_ROLLUP_VERSION = 6;

// Not real mobs / not worth a record row (Luopan = the sortie roaming device).
const EXCLUDED_MOBS = new Set(['Luopan']);

// Some runs store a party member's JOB instead of their name (unidentified
// alliance members). Drop those from per-character attribution so the roster
// shows real character names only.
const JOB_NAMES = new Set([
  'Warrior', 'Monk', 'White Mage', 'Black Mage', 'Red Mage', 'Thief', 'Paladin',
  'Dark Knight', 'Beastmaster', 'Bard', 'Ranger', 'Samurai', 'Ninja', 'Dragoon',
  'Summoner', 'Blue Mage', 'Corsair', 'Puppetmaster', 'Dancer', 'Scholar',
  'Geomancer', 'Rune Fencer',
]);

// Cap per-mob instance rows kept in the (persisted) rollup. Bosses have far
// fewer than this; trash mobs are capped to the most-recent N so the cache
// stays small.
const INSTANCE_CAP = 500;

export interface RecordDrop {
  item: string;
  itemId?: number;
  count: number;
}

export interface CharacterKills {
  name: string;
  count: number;
}

/** One individual kill of a mob, for the per-boss detail table. */
export interface KillInstance {
  ts: number;            // unix seconds of the kill
  kt: number | null;     // kill time, seconds (best-effort for multi-kill runs)
  players: string[];     // party roster present for the run
  drops: RecordDrop[];   // loot attributed to this kill (by dropLog area)
  path: string;          // source encounter file, to open the log
}

export interface RecordRow {
  mob: string;
  kills: number;
  best: number | null;   // fastest kill time, seconds
  worst: number | null;  // longest kill time, seconds
  avg: number | null;    // average kill time, seconds
  lastTs: number;        // unix seconds of most recent kill
  drops: RecordDrop[];   // sorted by count desc; may be empty
  perCharacter: CharacterKills[]; // party members present, sorted by count desc
  instances: KillInstance[];      // most-recent-first, capped at INSTANCE_CAP
}

export interface RecordsRollup {
  v: number;             // RECORDS_ROLLUP_VERSION
  fp: string;            // fingerprint of the contributing file set
  rows: RecordRow[];
}

const AMINON = 'Aminon';
const aminonKey = (mode: 'normal' | 'hardmode') => (mode === 'hardmode' ? 'Aminon (Hard)' : 'Aminon (Normal)');

/** Lifetime per-enemy rollup built from loot slices. Kills come from killLog
 *  (the only source that includes sortie bosses); kill times from the per-enemy
 *  windows; drops from the loot aggregator. Aminon is special-cased: split into
 *  Normal/Hard rows (from the run's aminon.mode), timed by its fight duration,
 *  and given its own drops from the dropLog entries in the 'Aminon' area. */
export function buildRecordsRollup(entries: LootEncounterSummary[]): RecordRow[] {
  const kills = new Map<string, { count: number; lastTs: number }>();
  const kt = new Map<string, { best: number; worst: number; sum: number; count: number }>();
  const dropAgg = new Map<string, Map<string, { count: number; itemId?: number }>>();
  const perChar = new Map<string, Map<string, number>>();
  const instAgg = new Map<string, KillInstance[]>();
  const addPerChar = (mob: string, ch: string) => {
    let m = perChar.get(mob);
    if (!m) { m = new Map(); perChar.set(mob, m); }
    m.set(ch, (m.get(ch) ?? 0) + 1);
  };
  const addInst = (mob: string, inst: KillInstance) => {
    let a = instAgg.get(mob);
    if (!a) { a = []; instAgg.set(mob, a); }
    a.push(inst);
  };

  const addKill = (name: string, absTs: number) => {
    const c = kills.get(name);
    if (!c) kills.set(name, { count: 1, lastTs: absTs });
    else { c.count += 1; if (absTs > c.lastTs) c.lastTs = absTs; }
  };
  const addTime = (name: string, t: number) => {
    if (t <= 0) return;
    const c = kt.get(name);
    if (!c) kt.set(name, { best: t, worst: t, sum: t, count: 1 });
    else { c.sum += t; if (t < c.best) c.best = t; if (t > c.worst) c.worst = t; c.count += 1; }
  };
  const addDrop = (mob: string, item: string, cnt: number, itemId?: number) => {
    let m = dropAgg.get(mob);
    if (!m) { m = new Map(); dropAgg.set(mob, m); }
    const cur = m.get(item);
    if (!cur) m.set(item, { count: cnt, itemId });
    else { cur.count += cnt; if (itemId != null && cur.itemId == null) cur.itemId = itemId; }
  };

  for (const e of entries) {
    const party = (e.party ?? []).filter(p => p && !JOB_NAMES.has(p));
    const credit = (mob: string) => { for (const p of party) addPerChar(mob, p); };

    // Drops grouped by dropLog area, so a kill can claim the loot from its room
    // (Aminon -> 'Aminon', sortie sector bosses -> 'Boss A'..'Boss H').
    const dropsByArea = new Map<string, Map<string, { count: number; itemId?: number }>>();
    for (const d of e.dropLog ?? []) {
      if (d.type === 'temporary') continue;
      const a = d.area ?? '';
      if (!a) continue;
      let m = dropsByArea.get(a);
      if (!m) { m = new Map(); dropsByArea.set(a, m); }
      const cur = m.get(d.name);
      if (!cur) m.set(d.name, { count: d.count ?? 1, itemId: d.itemId });
      else { cur.count += d.count ?? 1; if (d.itemId != null && cur.itemId == null) cur.itemId = d.itemId; }
    }
    const areaDrops = (a: string): RecordDrop[] => {
      const m = dropsByArea.get(a);
      return m ? [...m.entries()].map(([item, v]) => ({ item, itemId: v.itemId, count: v.count })).sort((x, y) => y.count - x.count) : [];
    };

    // Per-instance kill-time queue: enemies[] windows by name, consumed in order.
    const timeQ = new Map<string, number[]>();
    for (const en of e.enemies ?? []) {
      if (en.killedAt == null || en.name === AMINON || EXCLUDED_MOBS.has(en.name)) continue;
      const t = Math.max(0, en.killedAt - (en.firstSeen >= 0 ? en.firstSeen : 0));
      addTime(en.name, t);
      let q = timeQ.get(en.name);
      if (!q) { q = []; timeQ.set(en.name, q); }
      q.push(t);
    }

    for (const k of e.killLog ?? []) {
      if (!k.name || EXCLUDED_MOBS.has(k.name)) continue;
      if (k.name === AMINON) {
        // Split via the aminon record below. If this slice predates the aminon
        // field (not yet reparsed), fall back to an unsplit 'Aminon' row so the
        // kill still shows; it resolves into Normal/Hard once reparse lands.
        if (!e.aminon?.killed) {
          const ts = e.ts + (k.elapsed ?? 0);
          addKill(AMINON, ts); credit(AMINON);
          addInst(AMINON, { ts, kt: null, players: party, drops: areaDrops(k.area ?? AMINON), path: e.path });
        }
        continue;
      }
      const ts = e.ts + (k.elapsed ?? 0);
      addKill(k.name, ts); credit(k.name);
      const q = timeQ.get(k.name);
      const ktv = q && q.length ? q.shift()! : null;
      addInst(k.name, { ts, kt: ktv, players: party, drops: areaDrops(k.area ?? ''), path: e.path });
    }

    const am = e.aminon;
    if (am?.killed) {
      const key = aminonKey(am.mode);
      const amk = (e.killLog ?? []).find(k => k.name === AMINON);
      const ts = amk ? e.ts + (amk.elapsed ?? 0) : e.ts + (am.durationSeconds || 0);
      addKill(key, ts);
      addTime(key, am.durationSeconds || 0);
      credit(key);
      const dr = areaDrops(AMINON);
      for (const d of dr) addDrop(key, d.item, d.count, d.itemId);
      addInst(key, { ts, kt: am.durationSeconds || null, players: party, drops: dr, path: e.path });
    }
  }

  // Per-mob drops for non-sortie bosses (drop-keyed; sortie pool drops absent).
  const catalog = aggregateLoot(entries);
  for (const mb of catalog.mobs) {
    for (const it of mb.items) addDrop(mb.mob, it.item, it.drops, it.itemId);
  }

  const rows: RecordRow[] = [];
  for (const [mob, k] of kills) {
    const t = kt.get(mob);
    const dm = dropAgg.get(mob);
    const drops = dm
      ? [...dm.entries()].map(([item, v]) => ({ item, itemId: v.itemId, count: v.count })).sort((a, b) => b.count - a.count)
      : [];
    const pc = perChar.get(mob);
    const perCharacter = pc
      ? [...pc.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
      : [];
    const instances = (instAgg.get(mob) ?? []).sort((a, b) => b.ts - a.ts).slice(0, INSTANCE_CAP);
    rows.push({
      mob,
      kills: k.count,
      best: t ? t.best : null,
      worst: t ? t.worst : null,
      avg: t ? Math.round(t.sum / t.count) : null,
      lastTs: k.lastTs,
      drops,
      perCharacter,
      instances,
    });
  }
  return rows.sort((a, b) => b.kills - a.kills);
}

/** Cheap identity of the contributing file set. Capture files are immutable
 *  once written, so the set of paths uniquely identifies the aggregated data;
 *  a changed fingerprint means files were added/removed and we must rebuild. */
export function recordsFingerprint(paths: string[]): string {
  const sorted = [...paths].sort();
  let h = 2166136261 >>> 0;
  for (const p of sorted) {
    for (let i = 0; i < p.length; i++) {
      h ^= p.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return `${sorted.length}:${(h >>> 0).toString(36)}`;
}
