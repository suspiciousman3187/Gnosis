import { useMemo, useSyncExternalStore } from 'react';
import { readText } from './library';
import { fileTs, kindFromName, representativeLootSummaries, fileChar } from './content';
import { parseEncounter } from './parseWorkerClient';
import { synthContentLoot } from '@/lib/contentLootSynth';
import { loadIndex } from './encounterIndex';
import {
  dbOpen, dbGetSummaries, dbGetLoots, dbListKnownPaths, dbPutSummaries, dbPutLoots, dbDeletePaths,
  dbMetaGet, dbMetaSet, dbCountSummaries, META_LEGACY_MIGRATED,
  type SummaryRow, type LootRow,
} from './db';
import type { EncSummary } from './App';
import type { LootEncounterSummary } from '@/lib/dropAggregator';

const PARSE_CONCURRENCY = 4;
const PERSIST_DEBOUNCE_MS = 1500;
const NOTIFY_BATCH_MS = 32;
const GLOBAL_NOTIFY_THROTTLE_MS = 250;

const summaries = new Map<string, EncSummary>();
const loots = new Map<string, LootEncounterSummary>();

function isStaleLoot(path: string, loot: LootEncounterSummary): boolean {
  if (kindFromName(path) === 'sortie') {
    if (!Array.isArray(loot.enemies) || loot.enemies.length === 0) return true;
  }
  return false;
}

const LOOTS_CAP = 150;
function evictLootsToCap() {
  if (loots.size <= LOOTS_CAP) return;
  const iter = loots.keys();
  while (loots.size > LOOTS_CAP) {
    const next = iter.next();
    if (next.done || next.value === undefined) break;
    const p = next.value;
    loots.delete(p);
    lootRequested.delete(p);
  }
}
const summaryRequested = new Set<string>();
const lootRequested = new Set<string>();
const summaryQueue: string[] = [];
const lootQueue: string[] = [];
let summaryInFlight = 0;
let lootInFlight = 0;

let activeDir: string | null = null;
let dbReadyDir: string | null = null;
let dbReadyPromise: Promise<void> | null = null;

let version = 0;
const allListeners = new Set<() => void>();
const pathListeners = new Map<string, Set<() => void>>();

let cachedSummariesSnapshot: Record<string, EncSummary> = {};
let cachedLootsSnapshot: Record<string, LootEncounterSummary> = {};
let cachedSummariesVersion = -1;
let cachedLootsVersion = -1;

const pendingPathNotifications = new Set<string>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let globalNotifyTimer: ReturnType<typeof setTimeout> | null = null;
let globalNotifyPending = false;
let lastGlobalNotifyTs = 0;

function fireGlobal() {
  globalNotifyTimer = null;
  globalNotifyPending = false;
  lastGlobalNotifyTs = Date.now();
  for (const cb of allListeners) cb();
}
function scheduleGlobalNotify() {
  if (globalNotifyPending) return;
  globalNotifyPending = true;
  const since = Date.now() - lastGlobalNotifyTs;
  const wait = since >= GLOBAL_NOTIFY_THROTTLE_MS ? 0 : GLOBAL_NOTIFY_THROTTLE_MS - since;
  globalNotifyTimer = setTimeout(fireGlobal, wait);
}

function flushPendingNotifications() {
  notifyTimer = null;
  if (pendingPathNotifications.size === 0) return;
  version++;
  for (const p of pendingPathNotifications) {
    const subs = pathListeners.get(p);
    if (subs) for (const cb of subs) cb();
  }
  pendingPathNotifications.clear();
  scheduleGlobalNotify();
}
function notifyPath(p: string) {
  pendingPathNotifications.add(p);
  if (notifyTimer == null) notifyTimer = setTimeout(flushPendingNotifications, NOTIFY_BATCH_MS);
}
function notifyAll() {
  version++;
  if (globalNotifyTimer != null) { clearTimeout(globalNotifyTimer); globalNotifyTimer = null; }
  globalNotifyPending = false;
  lastGlobalNotifyTs = Date.now();
  for (const cb of allListeners) cb();
}

export function subscribeAll(cb: () => void) {
  allListeners.add(cb);
  return () => { allListeners.delete(cb); };
}
export function subscribePath(p: string, cb: () => void) {
  let s = pathListeners.get(p);
  if (!s) { s = new Set(); pathListeners.set(p, s); }
  s.add(cb);
  return () => {
    const set = pathListeners.get(p);
    if (!set) return;
    set.delete(cb);
    if (set.size === 0) pathListeners.delete(p);
  };
}

export function getVersion() { return version; }
export function getSummary(p: string) { return summaries.get(p); }
export function getLootSummary(p: string) { return loots.get(p); }
export function hasSummary(p: string) { return summaries.has(p); }

export function getSummariesSnapshot(): Record<string, EncSummary> {
  if (cachedSummariesVersion === version) return cachedSummariesSnapshot;
  cachedSummariesSnapshot = Object.fromEntries(summaries);
  cachedSummariesVersion = version;
  return cachedSummariesSnapshot;
}
export function getLootsSnapshot(): Record<string, LootEncounterSummary> {
  if (cachedLootsVersion === version) return cachedLootsSnapshot;
  cachedLootsSnapshot = Object.fromEntries(loots);
  cachedLootsVersion = version;
  return cachedLootsSnapshot;
}

export function bindDir(dir: string | null) { activeDir = dir; }
export function getActiveDir(): string | null { return activeDir; }
export async function dbLootSlicesForPaths(
  paths: string[],
  onProgress?: (parsed: number, total: number) => void,
): Promise<LootEncounterSummary[]> {
  if (!activeDir || paths.length === 0) return [];
  const rows = await dbGetLoots(activeDir, paths);
  const out: LootEncounterSummary[] = [];
  const total = rows.length;
  const CHUNK = 64;
  for (let i = 0; i < total; i++) {
    try { out.push(JSON.parse(rows[i].json) as LootEncounterSummary); } catch { /* skip corrupt */ }
    if ((i + 1) % CHUNK === 0) {
      onProgress?.(i + 1, total);
      await new Promise(r => setTimeout(r, 0));
    }
  }
  onProgress?.(total, total);
  return out;
}
export async function dbKnownPathsSet(): Promise<Set<string>> {
  if (!activeDir) return new Set();
  try {
    const list = await dbListKnownPaths(activeDir);
    return new Set(list);
  } catch { return new Set(); }
}

async function migrateLegacyIndex(dir: string): Promise<void> {
  try {
    const already = await dbMetaGet(dir, META_LEGACY_MIGRATED);
    if (already === '1') return;
    const count = await dbCountSummaries(dir);
    if (count > 0) {
      await dbMetaSet(dir, META_LEGACY_MIGRATED, '1');
      return;
    }
    const idx = await loadIndex(dir);
    const entries = Object.entries(idx.encounters ?? {});
    if (entries.length === 0) {
      await dbMetaSet(dir, META_LEGACY_MIGRATED, '1');
      return;
    }
    const summaryRows: SummaryRow[] = [];
    const lootRows: LootRow[] = [];
    for (const [p, entry] of entries) {
      const s = entry?.summary;
      if (!s) continue;
      const kind = kindFromName(p) ?? 'unknown';
      summaryRows.push({
        path: p,
        ts: typeof s.ts === 'number' ? Math.floor(s.ts) : fileTs(p),
        kind,
        zone: s.zone ?? null,
        json: JSON.stringify(s),
      });
      if (entry.loot) {
        lootRows.push({
          path: p,
          ts: typeof s.ts === 'number' ? Math.floor(s.ts) : fileTs(p),
          json: JSON.stringify(entry.loot),
        });
      }
    }
    const CHUNK = 200;
    for (let i = 0; i < summaryRows.length; i += CHUNK) {
      await dbPutSummaries(dir, summaryRows.slice(i, i + CHUNK));
    }
    for (let i = 0; i < lootRows.length; i += CHUNK) {
      await dbPutLoots(dir, lootRows.slice(i, i + CHUNK));
    }
    await dbMetaSet(dir, META_LEGACY_MIGRATED, '1');
  } catch (e) {
    console.warn('[summaryStore] legacy migration failed:', e);
  }
}

export async function ensureDbReady(dir: string): Promise<void> {
  if (dbReadyDir === dir) return;
  if (dbReadyPromise) return dbReadyPromise;
  dbReadyPromise = (async () => {
    try {
      await dbOpen(dir);
      await migrateLegacyIndex(dir);
      dbReadyDir = dir;
    } finally {
      dbReadyPromise = null;
    }
  })();
  return dbReadyPromise;
}

const HYDRATE_CHUNK = 150;
const yieldToBrowser = () => new Promise<void>(r => setTimeout(r, 0));

async function hydrateFromDb(
  paths: string[],
  opts: { summaries: boolean; loots: boolean } = { summaries: true, loots: true },
): Promise<{ summariesAdded: string[]; lootsAdded: string[] }> {
  if (!activeDir) return { summariesAdded: [], lootsAdded: [] };
  const missingSummary = opts.summaries ? paths.filter(p => !summaries.has(p)) : [];
  const missingLoot = opts.loots ? paths.filter(p => !loots.has(p)) : [];
  const summaryRowsP = missingSummary.length ? dbGetSummaries(activeDir, missingSummary) : Promise.resolve([] as SummaryRow[]);
  const lootRowsP = missingLoot.length ? dbGetLoots(activeDir, missingLoot) : Promise.resolve([] as LootRow[]);
  const [sRows, lRows] = await Promise.all([summaryRowsP, lootRowsP]);
  const summariesAdded: string[] = [];
  const lootsAdded: string[] = [];
  for (let i = 0; i < sRows.length; i++) {
    const r = sRows[i];
    try { summaries.set(r.path, JSON.parse(r.json) as EncSummary); summariesAdded.push(r.path); }
    catch { /* skip corrupt row */ }
    if (i > 0 && i % HYDRATE_CHUNK === 0) await yieldToBrowser();
  }
  for (let i = 0; i < lRows.length; i++) {
    const r = lRows[i];
    try {
      const parsed = JSON.parse(r.json) as LootEncounterSummary;
      if (isStaleLoot(r.path, parsed)) {
        // Drop so the next parse pass repopulates it with the current schema
        // (e.g. old Sortie loots cached with enemies=[] from before the
        // deriveSortieEnemies fix).
        continue;
      }
      loots.set(r.path, parsed);
      lootsAdded.push(r.path);
    } catch { /* skip corrupt row */ }
    if (i > 0 && i % HYDRATE_CHUNK === 0) await yieldToBrowser();
  }
  evictLootsToCap();
  return { summariesAdded, lootsAdded };
}

const pendingSummaryWrites = new Map<string, SummaryRow>();
const pendingLootWrites = new Map<string, LootRow>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist() {
  if (!activeDir) return;
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    if (!activeDir) return;
    const sRows = [...pendingSummaryWrites.values()];
    const lRows = [...pendingLootWrites.values()];
    pendingSummaryWrites.clear();
    pendingLootWrites.clear();
    try {
      if (sRows.length) await dbPutSummaries(activeDir, sRows);
      if (lRows.length) await dbPutLoots(activeDir, lRows);
    } catch (e) {
      console.warn('[summaryStore] persist failed:', e);
    }
  }, PERSIST_DEBOUNCE_MS);
}

function queueSummaryWrite(path: string, summary: EncSummary, json?: string) {
  if (!activeDir) return;
  const kind = kindFromName(path) ?? 'unknown';
  pendingSummaryWrites.set(path, {
    path,
    ts: typeof summary.ts === 'number' ? Math.floor(summary.ts) : fileTs(path),
    kind,
    zone: summary.zone ?? null,
    json: json ?? JSON.stringify(summary),
  });
  schedulePersist();
}
function queueLootWrite(path: string, loot: LootEncounterSummary, json?: string) {
  if (!activeDir) return;
  pendingLootWrites.set(path, {
    path,
    ts: fileTs(path),
    json: json ?? JSON.stringify(loot),
  });
  schedulePersist();
}

function pumpSummaryQueue() {
  while (summaryInFlight < PARSE_CONCURRENCY && summaryQueue.length > 0) {
    const p = summaryQueue.shift()!;
    summaryInFlight++;
    void parseOne(p).finally(() => { summaryInFlight--; pumpSummaryQueue(); });
  }
}

async function parseOne(p: string) {
  const k = kindFromName(p);
  if (k !== 'encounter' && k !== 'sortie') return;
  const ts = fileTs(p);
  const wantMetrics = (Date.now() / 1000 - ts) < 7 * 86400;
  try {
    const parsed = await parseEncounter(p, wantMetrics, ts);
    if (!parsed) return;
    summaries.set(p, parsed.summary);
    queueSummaryWrite(p, parsed.summary, parsed.summaryJson);
    if (parsed.loot) {
      loots.set(p, parsed.loot);
      queueLootWrite(p, parsed.loot, parsed.lootJson);
      evictLootsToCap();
    }
    notifyPath(p);
  } catch { /* ignore */ }
}

function pumpLootQueue() {
  while (lootInFlight < PARSE_CONCURRENCY && lootQueue.length > 0) {
    const p = lootQueue.shift()!;
    lootInFlight++;
    void synthOne(p).finally(() => { lootInFlight--; pumpLootQueue(); });
  }
}

async function synthOne(p: string) {
  const k = kindFromName(p);
  if (!k || k === 'encounter') return;
  let text: string;
  try { text = await readText(p); } catch { return; }
  const loot = synthContentLoot(p, k, text, fileTs(p));
  if (!loot) return;
  loots.set(p, loot);
  queueLootWrite(p, loot);
  evictLootsToCap();
  notifyPath(p);
}

export function requestSummaries(paths: string[]): void {
  if (!activeDir) return;
  void ensureDbReady(activeDir).then(async () => {
    const stillMissing: string[] = [];
    const fromDb = paths.filter(p => !summaries.has(p) && !summaryRequested.has(p));
    if (fromDb.length) {
      const { summariesAdded } = await hydrateFromDb(fromDb, { summaries: true, loots: false });
      for (const p of summariesAdded) notifyPath(p);
      for (const p of fromDb) {
        if (!summaries.has(p)) stillMissing.push(p);
      }
    }
    let queued = false;
    for (const p of stillMissing) {
      if (summaryRequested.has(p)) continue;
      const k = kindFromName(p);
      if (k !== 'encounter' && k !== 'sortie') continue;
      summaryRequested.add(p);
      summaryQueue.push(p);
      queued = true;
    }
    if (queued) pumpSummaryQueue();
  });
}

export function requestLoots(paths: string[]): void {
  if (!activeDir) return;
  void ensureDbReady(activeDir).then(async () => {
    const needLoot = paths.filter(p => !loots.has(p) && !lootRequested.has(p));
    if (needLoot.length) {
      const { lootsAdded } = await hydrateFromDb(needLoot, { summaries: false, loots: true });
      for (const p of lootsAdded) notifyPath(p);
    }
    let pumpedSummary = false, pumpedLoot = false;
    for (const p of paths) {
      if (loots.has(p)) continue;
      if (lootRequested.has(p)) continue;
      const k = kindFromName(p);
      if (!k) continue;
      lootRequested.add(p);
      if (k === 'encounter' || k === 'sortie') {
        if (!summaryRequested.has(p)) {
          summaryRequested.add(p);
          summaryQueue.push(p);
          pumpedSummary = true;
        }
      } else {
        lootQueue.push(p);
        pumpedLoot = true;
      }
    }
    if (pumpedSummary) pumpSummaryQueue();
    if (pumpedLoot) pumpLootQueue();
  });
}

export function evictLootsExcept(keep: Set<string>): number {
  let evicted = 0;
  for (const p of [...loots.keys()]) {
    if (!keep.has(p)) { loots.delete(p); lootRequested.delete(p); evicted++; }
  }
  if (evicted > 0) notifyAll();
  return evicted;
}

export function pruneStore(alivePaths: Set<string>) {
  const dropped: string[] = [];
  for (const p of [...summaries.keys()]) if (!alivePaths.has(p)) { summaries.delete(p); summaryRequested.delete(p); dropped.push(p); }
  for (const p of [...loots.keys()]) if (!alivePaths.has(p)) { loots.delete(p); lootRequested.delete(p); if (!dropped.includes(p)) dropped.push(p); }
  if (dropped.length) {
    notifyAll();
    if (activeDir) {
      void dbDeletePaths(activeDir, dropped).catch(() => {});
    }
  }
}

export function clearStore() {
  summaries.clear();
  loots.clear();
  summaryRequested.clear();
  lootRequested.clear();
  summaryQueue.length = 0;
  lootQueue.length = 0;
  notifyAll();
}

export function useStoreVersion(): number {
  return useSyncExternalStore(subscribeAll, getVersion, getVersion);
}
export function useSummariesRecord(): Record<string, EncSummary> {
  useSyncExternalStore(subscribeAll, getVersion, getVersion);
  return getSummariesSnapshot();
}
export function useLootsRecord(): Record<string, LootEncounterSummary> {
  useSyncExternalStore(subscribeAll, getVersion, getVersion);
  return getLootsSnapshot();
}
export function useSummary(path: string): EncSummary | undefined {
  useSyncExternalStore(
    cb => subscribePath(path, cb),
    () => version,
    () => version,
  );
  return summaries.get(path);
}
export function useLootSummary(path: string): LootEncounterSummary | undefined {
  useSyncExternalStore(
    cb => subscribePath(path, cb),
    () => version,
    () => version,
  );
  return loots.get(path);
}

export interface EnemyCharacterKillStats {
  name: string;
  count: number;
  best: number;
  avg: number;
}

export interface EnemyKillStats {
  best: number;
  worst: number;
  avg: number;
  count: number;
  perCharacter: EnemyCharacterKillStats[];
  divergence: boolean;
}

export interface StoreStats {
  summariesCount: number;
  lootsCount: number;
  pendingSummaryWrites: number;
  pendingLootWrites: number;
  summaryQueueLen: number;
  lootQueueLen: number;
  summaryInFlight: number;
  lootInFlight: number;
  approxSummariesBytes: number;
  approxLootsBytes: number;
  approxPendingWriteBytes: number;
  largestEncounter: { path: string; bytes: number } | null;
}

function approxByteSize(v: unknown): number {
  try { return JSON.stringify(v).length * 2; } catch { return 0; }
}

export function getStoreStats(): StoreStats {
  let summariesBytes = 0;
  let lootsBytes = 0;
  let largest: { path: string; bytes: number } | null = null;
  for (const [p, s] of summaries) {
    const sz = approxByteSize(s);
    summariesBytes += sz;
    if (!largest || sz > largest.bytes) largest = { path: p, bytes: sz };
  }
  for (const [p, l] of loots) {
    const sz = approxByteSize(l);
    lootsBytes += sz;
    if (!largest || sz > largest.bytes) largest = { path: p, bytes: sz };
  }
  let pendingBytes = 0;
  for (const w of pendingSummaryWrites.values()) pendingBytes += (w.json?.length ?? 0) * 2;
  for (const w of pendingLootWrites.values()) pendingBytes += (w.json?.length ?? 0) * 2;
  return {
    summariesCount: summaries.size,
    lootsCount: loots.size,
    pendingSummaryWrites: pendingSummaryWrites.size,
    pendingLootWrites: pendingLootWrites.size,
    summaryQueueLen: summaryQueue.length,
    lootQueueLen: lootQueue.length,
    summaryInFlight,
    lootInFlight,
    approxSummariesBytes: summariesBytes,
    approxLootsBytes: lootsBytes,
    approxPendingWriteBytes: pendingBytes,
    largestEncounter: largest,
  };
}

export function useEnemyKillHistory(): Map<string, EnemyKillStats> {
  const v = useSyncExternalStore(subscribeAll, getVersion, getVersion);
  return useMemo(() => {
    const all = [...loots.values()];
    const perChar = new Map<string, Map<string, { sum: number; min: number; count: number }>>();
    for (const loot of all) {
      const character = fileChar(loot.path);
      if (!character) continue;
      const enemies = loot.enemies;
      if (!Array.isArray(enemies)) continue;
      for (const e of enemies) {
        if (e.killedAt == null) continue;
        const kt = Math.max(0, e.killedAt - (e.firstSeen >= 0 ? e.firstSeen : 0));
        if (kt <= 0) continue;
        let byChar = perChar.get(e.name);
        if (!byChar) { byChar = new Map(); perChar.set(e.name, byChar); }
        const cur = byChar.get(character);
        if (!cur) byChar.set(character, { sum: kt, min: kt, count: 1 });
        else { cur.sum += kt; if (kt < cur.min) cur.min = kt; cur.count += 1; }
      }
    }
    const reps = representativeLootSummaries(all);
    const acc = new Map<string, { sum: number; min: number; max: number; count: number }>();
    for (const loot of reps) {
      const enemies = loot.enemies;
      if (!Array.isArray(enemies)) continue;
      for (const e of enemies) {
        if (e.killedAt == null) continue;
        const kt = Math.max(0, e.killedAt - (e.firstSeen >= 0 ? e.firstSeen : 0));
        if (kt <= 0) continue;
        const cur = acc.get(e.name);
        if (!cur) acc.set(e.name, { sum: kt, min: kt, max: kt, count: 1 });
        else {
          cur.sum += kt;
          if (kt < cur.min) cur.min = kt;
          if (kt > cur.max) cur.max = kt;
          cur.count += 1;
        }
      }
    }
    const out = new Map<string, EnemyKillStats>();
    for (const [name, s] of acc) {
      const byChar = perChar.get(name);
      const perCharacter: EnemyCharacterKillStats[] = byChar
        ? [...byChar.entries()]
            .map(([cname, cs]) => ({ name: cname, count: cs.count, best: cs.min, avg: cs.sum / cs.count }))
            .sort((a, b) => b.count - a.count)
        : [];
      let divergence = false;
      if (perCharacter.length >= 2) {
        const max = perCharacter[0].count;
        const min = perCharacter[perCharacter.length - 1].count;
        if (min > 0 && max >= min * 2) divergence = true;
      }
      out.set(name, { best: s.min, worst: s.max, avg: s.sum / s.count, count: s.count, perCharacter, divergence });
    }
    return out;
  }, [v]);
}
