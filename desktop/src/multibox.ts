import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { writeTrackerControl } from './library';
import { useMemo, useSyncExternalStore } from 'react';
import type { ParseCombatStats, PartyMember } from '@/lib/types';
import type { TrackerLive } from './content';
import { inTauri } from './library';


export type BoxSelf = {
  id: number;
  name: string;
  main?: string; mainLvl?: number;
  sub?: string; subLvl?: number;
  hpp?: number; mpp?: number; tp?: number;
  zone?: number; zoneName?: string;
};

export type BoxState = {
  conn: number;
  self?: BoxSelf;
  lastSeen: number;
  combat?: ParseCombatStats;   // latest combat_stats this box streamed
  combatAt: number;            // Date.now() of the last combat message (0 = none)
  combatStart?: number;        // unix-second start of the live encounter (from addon's ff_live_combat_start) - drives Live-view DPS
  live?: TrackerLive;          // latest compact overlay payload (players/targets/dps)
  liveAt: number;              // Date.now() of the last live message (0 = none)
  killHistory?: KillEvent[];   // accumulated per-kill events for this box's current encounter; reset on zone change
};

export type KillEvent = {
  id?: number;
  kill_seq: number;
  name: string;
  dmg?: Record<string, number>;
  since?: number | null;
  ended?: number | null;
};

type Msg =
  | ({ t: 'self' } & { id: number; name: string; main?: string; main_lvl?: number; sub?: string; sub_lvl?: number; hpp?: number; mpp?: number; tp?: number; zone?: number; zone_name?: string })
  | { t: 'combat'; cs: ParseCombatStats; start?: number }
  | { t: 'live'; live: TrackerLive }
  | { t: 'action'; seq: number; e: unknown }
  | { t: 'kill'; kill: KillEvent }
  | { t: 'enc'; phase: string; id?: number; zone?: string };

const boxesByConn = new Map<number, BoxState>();
const listeners = new Set<() => void>();
let snapshot: BoxState[] = [];
let started = false;

let combatSubscribers = 0;
let combatAddonDir: string | null = null;
function pushRelayState() {
  if (inTauri) void invoke('set_combat_relay', { enabled: combatSubscribers > 0 }).catch(() => {});
}
export function addCombatSubscriber(dir?: string | null): () => void {
  const wasZero = combatSubscribers === 0;
  combatSubscribers += 1;
  if (wasZero) pushRelayState();
  const resolvedDir = dir || (typeof localStorage !== 'undefined' ? localStorage.getItem('ff_data_dir') : null);
  if (resolvedDir && !combatAddonDir) {
    combatAddonDir = resolvedDir;
    void writeTrackerControl(resolvedDir, { wantsLiveCombat: true }).catch(() => {});
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    combatSubscribers -= 1;
    if (combatSubscribers === 0) {
      pushRelayState();
      const lastDir = combatAddonDir;
      combatAddonDir = null;
      if (lastDir) void writeTrackerControl(lastDir, { wantsLiveCombat: false }).catch(() => {});
    }
  };
}

let flushPending = false;
function rebuild() {
  snapshot = [...boxesByConn.values()].sort((a, b) => (a.self?.name ?? '').localeCompare(b.self?.name ?? ''));
  for (const l of listeners) l();
}
function scheduleRebuild() {
  if (flushPending) return;
  flushPending = true;
  setTimeout(() => { flushPending = false; rebuild(); }, 150);
}

let combatWorker: Worker | null = null;
let combatWorkerTried = false;
const combatPendingMeasures = new Map<number, (r: { ok: boolean; bytes?: number; jsHeap?: number; error?: string }) => void>();
let combatMeasureNextId = 1;
function getCombatWorker(): Worker | null {
  if (combatWorker) return combatWorker;
  if (combatWorkerTried) return null;
  combatWorkerTried = true;
  if (typeof Worker === 'undefined') return null;
  try {
    combatWorker = new Worker(new URL('./combatParseWorker.ts', import.meta.url), { type: 'module' });
    combatWorker.addEventListener('message', (ev: MessageEvent<{ conn?: number; ok?: boolean; msg?: Msg; id?: number; type?: string; bytes?: number; jsHeap?: number; error?: string }>) => {
      const data = ev.data;
      if (data.type === 'memory' && typeof data.id === 'number') {
        const r = combatPendingMeasures.get(data.id);
        if (!r) return;
        combatPendingMeasures.delete(data.id);
        r({ ok: !!data.ok, bytes: data.bytes, jsHeap: data.jsHeap, error: data.error });
        return;
      }
      if (typeof data.conn !== 'number' || !data.ok || !data.msg) return;
      if (!boxesByConn.has(data.conn)) return;
      applyParsedMsg(data.conn, data.msg);
    });
    combatWorker.addEventListener('error', () => {
      try { combatWorker?.terminate(); } catch { /* ignore */ }
      combatWorker = null;
    });
    return combatWorker;
  } catch {
    combatWorker = null;
    return null;
  }
}

export interface CombatWorkerHeapSample { label: string; bytes: number | null; jsHeap: number | null; error?: string }
export async function measureCombatWorkerHeap(): Promise<CombatWorkerHeapSample | null> {
  const w = combatWorker;
  if (!w) return null;
  return new Promise<CombatWorkerHeapSample>(resolve => {
    const id = combatMeasureNextId++;
    const timeout = setTimeout(() => {
      combatPendingMeasures.delete(id);
      resolve({ label: 'combatParseWorker', bytes: null, jsHeap: null, error: 'timeout' });
    }, 5000);
    combatPendingMeasures.set(id, reply => {
      clearTimeout(timeout);
      resolve({ label: 'combatParseWorker', bytes: reply.bytes ?? null, jsHeap: reply.jsHeap ?? null, error: reply.error });
    });
    w.postMessage({ id, type: 'measure-memory' });
  });
}

function applyParsedMsg(conn: number, msg: Msg) {
  const b = boxesByConn.get(conn) ?? { conn, lastSeen: 0, combatAt: 0, liveAt: 0 };
  b.lastSeen = Date.now();
  if (msg.t === 'self') {
    const prevZone = b.self?.zone;
    if (prevZone !== undefined && prevZone !== msg.zone) {
      b.killHistory = [];
    }
    b.self = {
      id: msg.id, name: msg.name,
      main: msg.main, mainLvl: msg.main_lvl, sub: msg.sub, subLvl: msg.sub_lvl,
      hpp: msg.hpp, mpp: msg.mpp, tp: msg.tp, zone: msg.zone, zoneName: msg.zone_name,
    };
  } else if (msg.t === 'combat') {
    b.combat = msg.cs;
    b.combatAt = Date.now();
    if (msg.start != null) b.combatStart = msg.start;
  } else if (msg.t === 'live') {
    if (msg.live && msg.live.recording) { b.live = msg.live; b.liveAt = Date.now(); }
  } else if (msg.t === 'kill' && msg.kill && typeof msg.kill.kill_seq === 'number') {
    const hist = b.killHistory ?? [];
    if (!hist.some(k => k.kill_seq === msg.kill.kill_seq)) {
      hist.push(msg.kill);
      if (hist.length > 200) hist.splice(0, hist.length - 200);
      b.killHistory = hist;
    }
  }
  boxesByConn.set(conn, b);
  scheduleRebuild();
}

function onLine(conn: number, line: string) {
  const isBigCombat = line.length > 1000 && line.indexOf('"t":"combat"') >= 0;
  if (combatSubscribers === 0 && isBigCombat) {
    const existing = boxesByConn.get(conn);
    if (existing) { existing.lastSeen = Date.now(); }
    return;
  }
  if (isBigCombat) {
    const w = getCombatWorker();
    if (w) {
      let b = boxesByConn.get(conn);
      if (!b) { b = { conn, lastSeen: 0, combatAt: 0, liveAt: 0 }; boxesByConn.set(conn, b); }
      b.lastSeen = Date.now();
      w.postMessage({ conn, line });
      return;
    }
    // Worker construction failed or unavailable - fall through to inline parse.
  }
  let msg: Msg;
  try { msg = JSON.parse(line) as Msg; } catch { return; }
  applyParsedMsg(conn, msg);
}

export async function startMultibox() {
  if (started) return;
  started = true;
  await listen<{ conn: number; line: string }>('styx://box-msg', e => onLine(e.payload.conn, e.payload.line));
  await listen<number>('styx://box-gone', e => { boxesByConn.delete(e.payload); scheduleRebuild(); });
}

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function getSnapshot() { return snapshot; }

export function useBoxes(): BoxState[] {
  const all = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const nowBucket = Math.floor(Date.now() / 3000);
  return useMemo(
    () => all.filter(b => b.self && nowBucket * 3000 - b.lastSeen < 6000),
    [all, nowBucket],
  );
}

const COMBAT_STALE_MS = 10000;

function totalDamage(cs: ParseCombatStats): number {
  let dmg = 0;
  for (const mob of Object.values(cs)) {
    for (const p of Object.values(mob)) dmg += (p as { total_damage?: number }).total_damage ?? 0;
  }
  return dmg;
}

// Build the party roster from every box's authoritative self-report (each box is
// one party member; trusts/others that didn't connect simply aren't here).
function partyFromBoxes(boxes: BoxState[]): PartyMember[] {
  const seen = new Set<string>();
  const party: PartyMember[] = [];
  for (const b of boxes) {
    const s = b.self;
    if (!s || !s.name || seen.has(s.name)) continue;
    seen.add(s.name);
    party.push({ name: s.name, mainJob: s.main ?? '', mainLevel: s.mainLvl ?? 0, subJob: s.sub ?? '', subLevel: s.subLvl ?? 0 });
  }
  return party;
}

export type LiveGroup = {
  key: number;            // zone id (the group key)
  zoneName: string;
  combatStats: ParseCombatStats;
  party: PartyMember[];
  boxCount: number;
  totalDamage: number;
  durationSeconds: number;
};

export function useLiveGroups(): LiveGroup[] {
  const boxes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const nowBucket = Math.floor(Date.now() / 5000);
  return useMemo(() => {
    const now = nowBucket * 5000;
    const byZone = new Map<number, BoxState[]>();
    for (const b of boxes) {
      if (!b.self) continue;
      const z = b.self.zone ?? -1;
      let g = byZone.get(z);
      if (!g) { g = []; byZone.set(z, g); }
      g.push(b);
    }
    const groups: LiveGroup[] = [];
    for (const [z, gboxes] of byZone) {
      let rep: BoxState | undefined;
      let repDmg = -1;
      for (const b of gboxes) {
        if (!b.combat || now - b.combatAt > COMBAT_STALE_MS) continue;
        const dmg = totalDamage(b.combat);
        if (dmg > repDmg) { repDmg = dmg; rep = b; }
      }
      if (!rep || !rep.combat) continue;
      const zoneName = rep.self?.zoneName || gboxes.find(b => b.self?.zoneName)?.self?.zoneName || (z >= 0 ? `Zone ${z}` : 'Unknown');
      const nowSec = Math.floor(now / 1000);
      let start = rep.combatStart;
      if (start == null) {
        for (const b of gboxes) if (b.combatStart != null && (start == null || b.combatStart < start)) start = b.combatStart;
      }
      const durationSeconds = start != null ? Math.max(0, nowSec - start) : 0;
      groups.push({ key: z, zoneName, combatStats: rep.combat, party: partyFromBoxes(gboxes), boxCount: gboxes.length, totalDamage: repDmg, durationSeconds });
    }
    groups.sort((a, b) => b.totalDamage - a.totalDamage);
    return groups;
  }, [boxes, nowBucket]);
}

export type LiveOverlayGroup = { key: number; zoneName: string; live: TrackerLive; conn: number };

export function useLiveOverlayGroups(): LiveOverlayGroup[] {
  const boxes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const nowBucket = Math.floor(Date.now() / 5000);
  return useMemo(() => {
    const now = nowBucket * 5000;
    const byZone = new Map<number, BoxState[]>();
    for (const b of boxes) {
      if (!b.self || !b.live || now - b.liveAt > COMBAT_STALE_MS) continue;
      const z = b.self.zone ?? -1;
      let g = byZone.get(z);
      if (!g) { g = []; byZone.set(z, g); }
      g.push(b);
    }
    const groups: LiveOverlayGroup[] = [];
    for (const [z, gboxes] of byZone) {
      let rep = gboxes[0];
      for (const b of gboxes) if ((b.live!.partyDamage ?? 0) > (rep.live!.partyDamage ?? 0)) rep = b;
      const zoneName = rep.self?.zoneName || gboxes.find(b => b.self?.zoneName)?.self?.zoneName || (z >= 0 ? `Zone ${z}` : 'Unknown');
      groups.push({ key: z, zoneName, live: rep.live!, conn: rep.conn });
    }
    groups.sort((a, b) => (b.live.partyDamage ?? 0) - (a.live.partyDamage ?? 0));
    return groups;
  }, [boxes, nowBucket]);
}

export function useLiveActive(): boolean {
  const boxes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const now = Date.now();
  return boxes.some(b => b.live?.recording && now - b.liveAt < COMBAT_STALE_MS);
}

if (inTauri) void startMultibox();

export interface MultiboxStats {
  boxCount: number;
  boxes: { name: string | undefined; combatBytes: number; liveBytes: number; killHistoryCount: number; totalBytes: number }[];
  combatSubscribers: number;
  totalBytes: number;
}

export function getMultiboxStats(): MultiboxStats {
  const out: MultiboxStats['boxes'] = [];
  let total = 0;
  for (const b of boxesByConn.values()) {
    const combatBytes = b.combat ? JSON.stringify(b.combat).length * 2 : 0;
    const liveBytes = b.live ? JSON.stringify(b.live).length * 2 : 0;
    const killHistBytes = b.killHistory ? JSON.stringify(b.killHistory).length * 2 : 0;
    const totalBytes = combatBytes + liveBytes + killHistBytes;
    total += totalBytes;
    out.push({
      name: b.self?.name,
      combatBytes,
      liveBytes,
      killHistoryCount: b.killHistory?.length ?? 0,
      totalBytes,
    });
  }
  return {
    boxCount: boxesByConn.size,
    boxes: out,
    combatSubscribers,
    totalBytes: total,
  };
}
