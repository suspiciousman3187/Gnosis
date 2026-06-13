import { parseReport } from '@/lib/parser';
import type { RunRecord, CharacterGear, PartyMember } from '@/lib/types';
import type { Encounter } from '@/lib/encounter';
import type { LootEncounterSummary } from '@/lib/dropAggregator';
import { parsedToRecord } from './adapt';

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
  mode: 'off',
  idleTimeout: 30,
  lightweight: false,
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
  };
  return {
    char: r.localCharacter ?? null,
    gear: {
      gearLog: r.gearLog ?? null, stateSets: r.stateSets ?? null, positionLog: r.position_log ?? null, buffLog: r.buff_log ?? null,
      progressionLog: r.progressionLog ?? null,
      progressionStart: r.progressionStart ?? null,
      progressionEnd: r.progressionEnd ?? null,
      currencyStart: r.currencyStart ?? null,
      currencyEnd: r.currencyEnd ?? null,
    },
    actionLen: Array.isArray(r.action_log) ? r.action_log.length : 0,
  };
}

export function mergeContents(contents: LoadedContent[]): LoadedContent {
  if (contents.length <= 1) return contents[0];
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
    return { kind: 'encounter', encounter: { ...rep.encounter, party: patchParty(rep.encounter.party), gearByPlayer } };
  }
  const rec = rep.record as unknown as { party?: PartyMember[] };
  return { ...rep, record: { ...rep.record, party: patchParty(rec.party), gearByPlayer } } as LoadedContent;
}

export function groupMultiboxPaths(
  paths: string[],
  encSummaries: Record<string, { zones?: string[]; zone?: string | null } | undefined>,
): { id: string; rep: string; members: string[]; chars: string[] }[] {
  const BUCKET = 30;
  const zoneSig = (p: string): string => {
    const kind = kindFromName(p);
    if (kind !== 'encounter') return 'content-module';
    const enc = encSummaries[p];
    if (!enc) return `unparsed::${p}`;
    const zones = enc.zones?.length ? enc.zones : (enc.zone ? [enc.zone] : []);
    if (zones.length === 0) return `unzoned::${p}`;
    return zones.slice().sort().join('|');
  };
  const bucketKey = (p: string) => `${kindFromName(p)}|${Math.round(fileTs(p) / BUCKET)}|${zoneSig(p)}`;
  const byBucket = new Map<string, string[]>();
  for (const p of paths) {
    const key = bucketKey(p);
    const arr = byBucket.get(key);
    if (arr) arr.push(p); else byBucket.set(key, [p]);
  }
  const out: { id: string; rep: string; members: string[]; chars: string[] }[] = [];
  const emitted = new Set<string>();
  for (const p of paths) {
    const key = bucketKey(p);
    const bucket = byBucket.get(key)!;
    const chars = bucket.map(fileChar);
    const multibox = bucket.length >= 2 && chars.every(Boolean) && new Set(chars).size === chars.length;
    if (multibox) {
      if (emitted.has(key)) continue;
      emitted.add(key);
      out.push({ id: key, rep: bucket[0], members: bucket, chars: chars as string[] });
    } else {
      out.push({ id: p, rep: p, members: [p], chars: (fileChar(p) ? [fileChar(p)!] : []) });
    }
  }
  return out;
}

export function representativeLootSummaries(
  summaries: LootEncounterSummary[],
): LootEncounterSummary[] {
  const BUCKET = 30;
  type Bucket = { sig: string; entries: LootEncounterSummary[] };
  const groups = new Map<string, Bucket>();
  for (const s of summaries) {
    const kind = kindFromName(s.path);
    if (!kind) continue;
    const bucketKey = Math.round(s.ts / BUCKET);
    const sig = `${kind}|${bucketKey}|${s.zone ?? ''}`;
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
