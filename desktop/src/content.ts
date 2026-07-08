import { parseReport } from '@/lib/parser';
import type { RunRecord, CharacterGear, PartyMember } from '@/lib/types';
import type { Encounter } from '@/lib/encounter';
import type { LootEncounterSummary } from '@/lib/dropAggregator';
import { parsedToRecord } from './adapt';
import { mergeEncountersAcrossBoxes, mergeRunRecords } from './mergeEncounters';

export type ContentKind = 'sortie' | 'encounter';

export type TrackingMode = 'off' | 'zone' | 'fight' | 'session';

// Live tracker state the addon publishes to data/tracker_status.json.
export interface TrackerStatus {
  mode: TrackingMode;
  idleTimeout?: number; // Fight-mode inactivity timeout (seconds) the addon is using
  recording: boolean;
  zone: string | null;
  source: string | null;
  elapsed: number;
  enemies: number;
  updatedAt: number; // unix seconds; lets the UI detect a stale/dead addon
}

// Persisted tracking defaults (data/tracker_prefs.json). The addon restores these
// on load so tracking resumes automatically; the Settings tab reads/writes them.
export interface TrackerPrefs {
  mode: TrackingMode;
  idleTimeout: number;
  lightweight: boolean;
  disableMovement: boolean;
  trackCurrency: boolean;
}

export const DEFAULT_TRACKER_PREFS: TrackerPrefs = {
  mode: 'fight',
  idleTimeout: 30,
  lightweight: true,
  disableMovement: true,
  trackCurrency: false,
};

// Live combat snapshot the addon publishes (~1Hz while recording) for the overlay.
export interface LivePlayer {
  name: string;
  job?: string;   // main job (so the overlay can anonymize names → job)
  damage: number;
  dps: number;
  pct?: number;   // share of party damage
  acc?: number;   // melee accuracy %
  crit?: number;  // melee crit %
  exphr?: number;
  cphr?: number;
  ephr?: number;
  lphr?: number;
}
export interface LiveTarget {
  name: string;
  hpp: number;
  /** Mob entity id - present on newer addon builds (>= 1.0.6 server tracker
   *  emit). Lets the overlay distinguish multiple mobs with the same name. */
  id?: number;
  dmg?: Record<string, number>;
  since?: number | null;
  ended?: number | null;
  kill_seq?: number;
}
export interface TrackerLive {
  recording: boolean;
  elapsed?: number;
  zone?: string | null;
  source?: string | null;
  enemies?: number;
  deaths?: number;
  partyDamage?: number;
  partyDps?: number;
  players?: LivePlayer[] | null;
  targets?: LiveTarget[] | null;
  myTargetId?: number | null;
}

export type LoadedContent =
  | { kind: 'sortie'; record: RunRecord }
  | { kind: 'encounter'; encounter: Encounter };

const basename = (p: string) => p.replace(/^.*[\\/]/, '');

export function kindFromName(path: string): ContentKind | null {
  const b = basename(path);
  if (b.startsWith('encounter_')) return 'encounter';
  if (b.startsWith('sortie_')) return 'sortie';
  return null;
}

export function isReportFile(path: string): boolean {
  const b = basename(path);
  if (!b.endsWith('.json') && !b.endsWith('.json.gz')) return false;
  if (b.includes('snapshot') || b.includes('config')) return false;
  return kindFromName(b) !== null;
}

// Sortable timestamp from a filename: unix seconds for encounters, or the
// embedded YYYY-MM-DD_HH-MM-SS (local time) for content reports.
export function fileTs(path: string): number {
  const b = basename(path);
  // encounter_<unix>[__<char>].json[.gz] (multibox) and sortie_<unix>__<char>.json (Sortie folder layout)
  const enc = b.match(/(?:encounter|sortie)_(\d+)(?:__.*)?\.json(?:\.gz)?$/);
  if (enc) return parseInt(enc[1], 10);
  const d = b.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (d) {
    const [, y, mo, da, h, mi, s] = d;
    return Math.floor(new Date(+y, +mo - 1, +da, +h, +mi, +s).getTime() / 1000);
  }
  return 0;
}

// The per-character tag a multiboxed report carries in its filename (after the
// `__` delimiter), or null for legacy/single files. Used to group sibling files.
export function fileChar(path: string): string | null {
  const m = basename(path).match(/__([A-Za-z0-9]+)\.json(?:\.gz)?$/);
  return m ? m[1] : null;
}

// A label derived purely from the filename - no file read required, so the
// library sidebar stays cheap even with large content reports.
export function labelFromName(path: string): string {
  const b = basename(path);
  const kind = kindFromName(b);
  switch (kind) {
    case 'sortie': return 'Sortie';
    case 'encounter': return 'Encounter';
    default: return b;
  }
}

export function loadContent(path: string, rawText: string): LoadedContent {
  const kind = kindFromName(path);
  switch (kind) {
    case 'sortie':    return { kind, record: parsedToRecord(parseReport(rawText), rawText) };
    case 'encounter': return { kind: 'encounter', encounter: JSON.parse(rawText) as Encounter };
    default: throw new Error(`Unrecognized report file: ${basename(path)}`);
  }
}

type GearView = { char: string | null; gear: CharacterGear; actionLen: number };
function gearViewOf(c: LoadedContent): GearView {
  if (c.kind === 'encounter') {
    const e = c.encounter;
    return {
      char: e.localCharacter ?? null,
      gear: {
        gearLog: e.gearLog, stateSets: e.stateSets, positionLog: e.positionLog, buffLog: e.buffLog,
        progressionLog: e.progressionLog ?? null,
        progressionStart: e.progressionStart ?? null,
        progressionEnd: e.progressionEnd ?? null,
        currencyStart: e.currencyStart ?? null,
        currencyEnd: e.currencyEnd ?? null,
      },
      actionLen: e.actionLog?.length ?? 0,
    };
  }
  const r = c.record as {
    localCharacter?: string | null; gearLog?: CharacterGear['gearLog']; stateSets?: CharacterGear['stateSets'];
    position_log?: CharacterGear['positionLog']; buff_log?: CharacterGear['buffLog']; action_log?: unknown[];
    progressionLog?: CharacterGear['progressionLog'];
    progressionStart?: CharacterGear['progressionStart'];
    progressionEnd?: CharacterGear['progressionEnd'];
    currencyStart?: CharacterGear['currencyStart'];
    currencyEnd?: CharacterGear['currencyEnd'];
    points?: { xp: number; cp: number; ep: number; lp: number } | null;
    gallimaufry?: number | null;
  };
  let progressionLog = r.progressionLog ?? null;
  if (!progressionLog && r.points) {
    const p = r.points;
    const evs: NonNullable<CharacterGear['progressionLog']> = [];
    if (p.xp > 0) evs.push({ elapsed: 0, kind: 'xp', value: p.xp });
    if (p.cp > 0) evs.push({ elapsed: 0, kind: 'cp', value: p.cp });
    if (p.ep > 0) evs.push({ elapsed: 0, kind: 'ep', value: p.ep });
    if (p.lp > 0) evs.push({ elapsed: 0, kind: 'lp', value: p.lp });
    if (evs.length > 0) progressionLog = evs;
  }
  return {
    char: r.localCharacter ?? null,
    gear: {
      gearLog: r.gearLog ?? null, stateSets: r.stateSets ?? null, positionLog: r.position_log ?? null, buffLog: r.buff_log ?? null,
      progressionLog,
      progressionStart: r.progressionStart ?? null,
      progressionEnd: r.progressionEnd ?? null,
      currencyStart: r.currencyStart ?? null,
      currencyEnd: r.currencyEnd ?? null,
    },
    actionLen: Array.isArray(r.action_log) ? r.action_log.length : 0,
  };
}

export function mergeContents(contents: LoadedContent[]): LoadedContent {
  if (contents.length === 0) throw new Error('mergeContents: empty contents');
  if (contents.length === 1) return contents[0];
  const kinds = new Set(contents.map(c => c.kind));
  if (kinds.size > 1) {
    console.warn(`[mergeContents] mixed kinds in group (${[...kinds].join(',')}); using majority kind only.`);
  }
  const rep = [...contents].sort((a, b) => gearViewOf(b).actionLen - gearViewOf(a).actionLen)[0];
  const gearByPlayer: Record<string, CharacterGear> = {};
  let n = 0;
  for (const c of contents) {
    const v = gearViewOf(c);
    console.log('[mergeContents] file', n, 'char=', v.char, 'gearLog=', v.gear.gearLog?.length ?? null, 'stateSets=', v.gear.stateSets ? Object.keys(v.gear.stateSets).length : null);
    const char = v.char || `Character ${(n += 1)}`;
    // Keep each box's own self-buffs only (its buffLog has the complete self set).
    const buffLog = (v.gear.buffLog ?? []).filter(b => !v.char || b.target === v.char);
    gearByPlayer[char] = { ...v.gear, buffLog: buffLog.length > 0 ? buffLog : null };
  }
  const partyOf = (c: LoadedContent): PartyMember[] | undefined =>
    c.kind === 'encounter' ? c.encounter.party : (c.record as { party?: PartyMember[] }).party;
  const selfJobs: Record<string, PartyMember> = {};
  for (const c of contents) {
    const ch = gearViewOf(c).char;
    if (!ch) continue;
    const self = partyOf(c)?.find(p => p.name === ch);
    if (self && self.mainJob) selfJobs[ch] = self;
  }
  const patchParty = (party?: PartyMember[]): PartyMember[] =>
    (party ?? []).map(p => (selfJobs[p.name] ? { ...p, ...selfJobs[p.name] } : p));

  if (rep.kind === 'encounter') {
    const encounters: Encounter[] = [];
    for (const c of contents) if (c.kind === 'encounter') encounters.push(c.encounter);
    const merged = encounters.length > 1 ? mergeEncountersAcrossBoxes(encounters) : rep.encounter;
    return { kind: 'encounter', encounter: { ...merged, party: patchParty(merged.party), gearByPlayer } };
  }
  const records: RunRecord[] = [];
  for (const c of contents) if (c.kind === 'sortie') records.push(c.record);
  const mergedRec = records.length > 1 ? mergeRunRecords(records) : rep.record;
  return { kind: 'sortie', record: { ...mergedRec, party: patchParty(mergedRec.party), gearByPlayer } };
}

const GROUP_JOIN_WINDOW_SEC = 45;

function clusterByProximity(paths: string[], keyOf: (p: string) => string, window: number): string[][] {
  const sorted = [...paths].sort((a, b) => {
    const k = keyOf(a).localeCompare(keyOf(b));
    return k !== 0 ? k : fileTs(a) - fileTs(b);
  });
  const clusters: string[][] = [];
  let cur: string[] = [];
  let curKey = '';
  let lastTs = 0;
  for (const p of sorted) {
    const k = keyOf(p);
    const t = fileTs(p);
    if (cur.length > 0 && k === curKey && t - lastTs <= window) {
      cur.push(p);
      lastTs = t;
    } else {
      if (cur.length > 0) clusters.push(cur);
      cur = [p];
      curKey = k;
      lastTs = t;
    }
  }
  if (cur.length > 0) clusters.push(cur);
  return clusters;
}

export interface PathGroupView {
  id: string;
  boundaries?: number[];
  segIndex?: number;
  segCount?: number;
}

export interface PathGroup {
  id: string;
  rep: string;
  members: string[];
  chars: string[];
  view?: PathGroupView;
}

export interface ViewEntryLike {
  id: string;
  members: string[];
  boundaries?: number[];
}

export function groupMultiboxPaths(
  paths: string[],
  encSummaries: Record<string, { zones?: string[]; zone?: string | null } | undefined>,
  views?: ViewEntryLike[],
): PathGroup[] {
  const claimed = new Map<string, ViewEntryLike>();
  if (views) {
    const pathSet = new Set(paths);
    for (const v of views) {
      const present = v.members.filter(m => pathSet.has(m));
      if (present.length === 0) continue;
      for (const m of present) claimed.set(m, v);
    }
  }
  const unclaimed = paths.filter(p => !claimed.has(p));
  const autoGroups = groupAutomatic(unclaimed, encSummaries);

  if (claimed.size === 0) return autoGroups;

  const viewGroups = new Map<string, PathGroup[]>();
  for (const v of new Set(claimed.values())) {
    const members = v.members.filter(m => claimed.get(m) === v);
    const chars = [...new Set(members.map(fileChar).filter((c): c is string => !!c))];
    if (v.boundaries && v.boundaries.length > 0) {
      const segCount = v.boundaries.length + 1;
      const segs: PathGroup[] = [];
      for (let i = 0; i < segCount; i++) {
        segs.push({
          id: `view:${v.id}:seg${i}`,
          rep: members[0],
          members,
          chars,
          view: { id: v.id, boundaries: v.boundaries, segIndex: i, segCount },
        });
      }
      viewGroups.set(members[0], segs);
    } else {
      viewGroups.set(members[0], [{
        id: `view:${v.id}`,
        rep: members[0],
        members,
        chars,
        view: { id: v.id },
      }]);
    }
  }

  const anchorOf = new Map<string, string>();
  for (const [anchor] of viewGroups) {
    const v = claimed.get(anchor)!;
    for (const m of v.members) anchorOf.set(m, anchor);
  }

  const out: PathGroup[] = [];
  const emittedAnchors = new Set<string>();
  const autoByFirstPath = new Map<string, PathGroup>();
  const emittedAuto = new Set<PathGroup>();
  for (const g of autoGroups) for (const m of g.members) autoByFirstPath.set(m, g);
  for (const p of paths) {
    const anchor = anchorOf.get(p);
    if (anchor !== undefined) {
      if (!emittedAnchors.has(anchor)) {
        emittedAnchors.add(anchor);
        const groupsFor = viewGroups.get(anchor);
        if (groupsFor) out.push(...groupsFor);
      }
      continue;
    }
    const g = autoByFirstPath.get(p);
    if (g && !emittedAuto.has(g)) {
      emittedAuto.add(g);
      out.push(g);
    }
  }
  return out;
}

function groupAutomatic(
  paths: string[],
  encSummaries: Record<string, { zones?: string[]; zone?: string | null } | undefined>,
): PathGroup[] {
  const zoneSig = (p: string): string | null => {
    const kind = kindFromName(p);
    if (kind !== 'encounter') return 'content-module';
    const enc = encSummaries[p];
    if (!enc) return null;
    const zones = enc.zones?.length ? enc.zones : (enc.zone ? [enc.zone] : []);
    if (zones.length === 0) return 'unzoned';
    return zones.slice().sort().join('|');
  };

  const timeClusters = clusterByProximity(paths, p => kindFromName(p) ?? '?', GROUP_JOIN_WINDOW_SEC);

  const finalClusters: string[][] = [];
  for (const cluster of timeClusters) {
    const bySig = new Map<string, string[]>();
    const pending: string[] = [];
    for (const p of cluster) {
      const sig = zoneSig(p);
      if (sig === null) { pending.push(p); continue; }
      const arr = bySig.get(sig);
      if (arr) arr.push(p); else bySig.set(sig, [p]);
    }
    if (bySig.size === 0) {
      finalClusters.push(pending);
      continue;
    }
    if (bySig.size === 1) {
      const only = [...bySig.values()][0];
      finalClusters.push([...only, ...pending]);
      continue;
    }
    let largest: string[] | null = null;
    for (const arr of bySig.values()) {
      if (!largest || arr.length > largest.length) largest = arr;
      finalClusters.push(arr);
    }
    if (pending.length > 0 && largest) largest.push(...pending);
  }

  const clusterOf = new Map<string, string[]>();
  const idOf = new Map<string[], string>();
  for (const c of finalClusters) {
    for (const p of c) clusterOf.set(p, c);
    idOf.set(c, `grp:${c[0]}`);
  }

  const out: { id: string; rep: string; members: string[]; chars: string[] }[] = [];
  const emitted = new Set<string[]>();
  for (const p of paths) {
    const cluster = clusterOf.get(p) ?? [p];
    const chars = cluster.map(fileChar);
    const multibox = cluster.length >= 2 && chars.every(Boolean) && new Set(chars).size === chars.length;
    if (multibox) {
      if (emitted.has(cluster)) continue;
      emitted.add(cluster);
      out.push({ id: idOf.get(cluster) ?? `grp:${cluster[0]}`, rep: cluster[0], members: cluster, chars: chars as string[] });
    } else {
      out.push({ id: p, rep: p, members: [p], chars: (fileChar(p) ? [fileChar(p)!] : []) });
    }
  }
  return out;
}

export function representativeLootSummaries(
  summaries: LootEncounterSummary[],
): LootEncounterSummary[] {
  type Bucket = { sig: string; entries: LootEncounterSummary[] };
  const bySigTime = [...summaries]
    .filter(s => kindFromName(s.path))
    .sort((a, b) => {
      const ka = `${kindFromName(a.path)}|${a.zone ?? ''}`;
      const kb = `${kindFromName(b.path)}|${b.zone ?? ''}`;
      const c = ka.localeCompare(kb);
      return c !== 0 ? c : a.ts - b.ts;
    });
  const groups = new Map<string, Bucket>();
  let clusterId = 0;
  let prevKey = '';
  let prevTs = 0;
  for (const s of bySigTime) {
    const key = `${kindFromName(s.path)}|${s.zone ?? ''}`;
    if (key !== prevKey || s.ts - prevTs > GROUP_JOIN_WINDOW_SEC) clusterId++;
    prevKey = key;
    prevTs = s.ts;
    const sig = `${key}#${clusterId}`;
    const g = groups.get(sig) ?? { sig, entries: [] };
    g.entries.push(s);
    groups.set(sig, g);
  }
  const out: LootEncounterSummary[] = [];
  for (const g of groups.values()) {
    if (g.entries.length === 1) {
      out.push(g.entries[0]);
      continue;
    }
    const chars = g.entries.map(s => fileChar(s.path));
    if (!chars.every(Boolean) || new Set(chars).size !== chars.length) {
      out.push(...g.entries);
      continue;
    }
    const rep = [...g.entries].sort((a, b) => b.dropLog.length - a.dropLog.length)[0];
    out.push(rep);
  }
  return out;
}

export function buildKillCounts(
  lootSummaries: Record<string, LootEncounterSummary>,
): Map<string, { total: number; mostRecent: number }> {
  const reps = representativeLootSummaries(Object.values(lootSummaries));
  const out = new Map<string, { total: number; mostRecent: number }>();
  for (const s of reps) {
    for (const k of s.killLog) {
      if (!k?.name) continue;
      const prev = out.get(k.name) ?? { total: 0, mostRecent: 0 };
      prev.total += 1;
      if (s.ts > prev.mostRecent) prev.mostRecent = s.ts;
      out.set(k.name, prev);
    }
  }
  return out;
}
