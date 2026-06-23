import { listen } from '@tauri-apps/api/event';
import { useMemo, useSyncExternalStore } from 'react';
import type { TrackerLive, TrackerStatus } from './content';


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
  live?: TrackerLive;
  liveAt: number;
  status?: TrackerStatus;
  statusAt: number;
  killHistory?: KillEvent[];
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
  | { t: 'live'; live: TrackerLive }
  | ({ t: 'status' } & TrackerStatus)
  | { t: 'action'; seq: number; e: unknown }
  | { t: 'kill'; kill: KillEvent }
  | { t: 'enc'; phase: string; id?: number; zone?: string };

const boxesByConn = new Map<number, BoxState>();
const listeners = new Set<() => void>();
let snapshot: BoxState[] = [];
let started = false;

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


export interface CombatWorkerHeapSample { label: string; bytes: number | null; jsHeap: number | null; error?: string }
export async function measureCombatWorkerHeap(): Promise<CombatWorkerHeapSample | null> {
  return null;
}

function applyParsedMsg(conn: number, msg: Msg) {
  const b = boxesByConn.get(conn) ?? { conn, lastSeen: 0, liveAt: 0, statusAt: 0 };
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
  } else if (msg.t === 'live') {
    if (msg.live && msg.live.recording) { b.live = msg.live; b.liveAt = Date.now(); }
  } else if (msg.t === 'status') {
    const { t: _t, ...status } = msg;
    void _t;
    b.status = status as TrackerStatus;
    b.statusAt = Date.now();
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

const STATUS_STALE_MS = 30000;
export function useTrackerStatus(): TrackerStatus | null {
  const boxes = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const nowBucket = Math.floor(Date.now() / 1000);
  return useMemo(() => {
    const now = nowBucket * 1000;
    let best: { s: TrackerStatus; at: number } | null = null;
    for (const b of boxes) {
      if (!b.status || now - b.statusAt > STATUS_STALE_MS) continue;
      if (!best) { best = { s: b.status, at: b.statusAt }; continue; }
      if (b.status.recording && !best.s.recording) { best = { s: b.status, at: b.statusAt }; continue; }
      if (b.status.recording === best.s.recording && b.statusAt > best.at) {
        best = { s: b.status, at: b.statusAt };
      }
    }
    return best ? best.s : null;
  }, [boxes, nowBucket]);
}

export interface MultiboxStats {
  boxCount: number;
  boxes: { name: string | undefined; liveBytes: number; killHistoryCount: number; totalBytes: number }[];
  totalBytes: number;
}

export function getMultiboxStats(): MultiboxStats {
  const out: MultiboxStats['boxes'] = [];
  let total = 0;
  for (const b of boxesByConn.values()) {
    const liveBytes = b.live ? JSON.stringify(b.live).length * 2 : 0;
    const killHistBytes = b.killHistory ? JSON.stringify(b.killHistory).length * 2 : 0;
    const totalBytes = liveBytes + killHistBytes;
    total += totalBytes;
    out.push({
      name: b.self?.name,
      liveBytes,
      killHistoryCount: b.killHistory?.length ?? 0,
      totalBytes,
    });
  }
  return {
    boxCount: boxesByConn.size,
    boxes: out,
    totalBytes: total,
  };
}
