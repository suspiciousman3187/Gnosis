import { invoke } from '@tauri-apps/api/core';
import type { Encounter } from '@/lib/encounter';
import { playerMetricsForEncounter, type EncounterMetrics } from '@/lib/combatStats';
import { parseEncounterText, type ParseReply, type ParsedEncounterResult } from './parseEncounterCore';

export type { ParsedEncounterResult };

const POOL_SIZE = 4;

interface MeasureMemoryReply { id: number; type: 'memory'; ok: boolean; bytes?: number; jsHeap?: number; error?: string }

interface PendingJob {
  path: string;
  done: (r: ParseReply) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface WorkerSlot {
  worker: Worker;
  pending: Map<number, PendingJob>;
  pendingMeasures: Map<number, (r: MeasureMemoryReply) => void>;
  load: number;
  bornAt: number;
  jobCount: number;
}

let pool: WorkerSlot[] | null = null;
let poolFailed = false;
let nextId = 1;

const RECYCLE_AFTER_JOBS = 10;
const RECYCLE_AFTER_MS = 60 * 1000;
// A single capture that OOMs or infinite-loops the worker must not wedge the
// whole parse queue. If a job hasn't replied in this long the worker is dead or
// stuck, so we fail that job and rebuild the slot. A normal parse is well under
// a second; 60s only ever fires on a genuinely broken file/worker.
const JOB_TIMEOUT_MS = 60 * 1000;

// Fail every in-flight job on a slot and replace its worker. Called when the
// worker fires an error (crash) or a job times out (silent hang) - previously
// the dead worker was kept, so all later jobs routed to it hung forever and
// Records/Loot spun at ~100% with no error. Logs the offending path(s) so the
// bad capture is identifiable instead of silently swallowed.
function hardResetSlot(slot: WorkerSlot, reason: string): void {
  const stuck = [...slot.pending.values()].map(j => j.path);
  if (stuck.length > 0) {
    console.warn(`[parseWorker] ${reason}: failing ${stuck.length} in-flight job(s). Likely offender: ${stuck[0]}`
      + (stuck.length > 1 ? ` (also: ${stuck.slice(1, 4).join(', ')}${stuck.length > 4 ? ', …' : ''})` : ''));
  }
  for (const job of slot.pending.values()) { clearTimeout(job.timer); job.done({ id: -1, ok: false }); }
  slot.pending.clear();
  slot.pendingMeasures.clear();
  slot.load = 0;
  try { slot.worker.terminate(); } catch { /* ignore */ }
  slot.worker = makeWorker();
  slot.bornAt = Date.now();
  slot.jobCount = 0;
  attachWorkerHandlers(slot);
}

function attachWorkerHandlers(slot: WorkerSlot): void {
  const w = slot.worker;
  w.addEventListener('message', (ev: MessageEvent<ParseReply | MeasureMemoryReply>) => {
    const data = ev.data as ParseReply | MeasureMemoryReply;
    if ('type' in data && data.type === 'memory') {
      const r = slot.pendingMeasures.get(data.id);
      if (!r) return;
      slot.pendingMeasures.delete(data.id);
      r(data);
      return;
    }
    const reply = data as ParseReply;
    const job = slot.pending.get(reply.id);
    if (!job) return;
    slot.pending.delete(reply.id);
    clearTimeout(job.timer);
    slot.load = Math.max(0, slot.load - 1);
    slot.jobCount += 1;
    job.done(reply);
    maybeRecycle(slot);
  });
  w.addEventListener('error', (ev: ErrorEvent) => {
    hardResetSlot(slot, `worker crashed (${ev?.message ?? 'uncaught error'})`);
  });
  w.addEventListener('messageerror', () => {
    hardResetSlot(slot, 'worker message deserialization error');
  });
}

function makeWorker(): Worker {
  return new Worker(new URL('./parseWorker.ts', import.meta.url), { type: 'module' });
}

function recycleSlot(slot: WorkerSlot): boolean {
  if (slot.load > 0 || slot.pending.size > 0 || slot.pendingMeasures.size > 0) return false;
  try { slot.worker.terminate(); } catch { /* ignore */ }
  slot.worker = makeWorker();
  slot.bornAt = Date.now();
  slot.jobCount = 0;
  attachWorkerHandlers(slot);
  return true;
}

function maybeRecycle(slot: WorkerSlot): void {
  const aged = Date.now() - slot.bornAt > RECYCLE_AFTER_MS;
  const busy = slot.jobCount >= RECYCLE_AFTER_JOBS;
  if (!aged && !busy) return;
  recycleSlot(slot);
}

function ensurePool(): WorkerSlot[] | null {
  if (pool) return pool;
  if (poolFailed) return null;
  if (typeof Worker === 'undefined') { poolFailed = true; return null; }
  try {
    const slots: WorkerSlot[] = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const slot: WorkerSlot = {
        worker: makeWorker(),
        pending: new Map(),
        pendingMeasures: new Map(),
        load: 0,
        bornAt: Date.now(),
        jobCount: 0,
      };
      attachWorkerHandlers(slot);
      slots.push(slot);
    }
    pool = slots;
    return pool;
  } catch {
    poolFailed = true;
    pool = null;
    return null;
  }
}

export interface RecycleResult {
  recycled: number;
  skipped: number;
  perSlot: { index: number; recycled: boolean; ageMs: number; jobCount: number }[];
}

export function recycleAllParseWorkers(): RecycleResult {
  const slots = pool;
  if (!slots) return { recycled: 0, skipped: 0, perSlot: [] };
  const perSlot: RecycleResult['perSlot'] = [];
  let recycled = 0;
  let skipped = 0;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const ageMs = Date.now() - slot.bornAt;
    const jobCount = slot.jobCount;
    const ok = recycleSlot(slot);
    if (ok) recycled += 1; else skipped += 1;
    perSlot.push({ index: i, recycled: ok, ageMs, jobCount });
  }
  return { recycled, skipped, perSlot };
}

export interface WorkerHeapSample {
  label: string;
  bytes: number | null;
  jsHeap: number | null;
  error?: string;
}

export async function measureParseWorkerHeaps(): Promise<WorkerHeapSample[]> {
  const slots = pool;
  if (!slots) return [];
  return Promise.all(slots.map((slot, i) => new Promise<WorkerHeapSample>(resolve => {
    const id = nextId++;
    const timeout = setTimeout(() => {
      slot.pendingMeasures.delete(id);
      resolve({ label: `parseWorker[${i}]`, bytes: null, jsHeap: null, error: 'timeout' });
    }, 5000);
    slot.pendingMeasures.set(id, reply => {
      clearTimeout(timeout);
      resolve({
        label: `parseWorker[${i}]`,
        bytes: reply.bytes ?? null,
        jsHeap: reply.jsHeap ?? null,
        error: reply.error,
      });
    });
    slot.worker.postMessage({ id, type: 'measure-memory' });
  })));
}

function pickSlot(slots: WorkerSlot[]): WorkerSlot {
  let best = slots[0];
  for (let i = 1; i < slots.length; i++) {
    if (slots[i].load < best.load) best = slots[i];
  }
  return best;
}

async function readBytes(path: string): Promise<ArrayBuffer> {
  return await invoke<ArrayBuffer>('read_file_bytes', { path });
}

export async function parseEncounter(
  path: string,
  wantMetrics: boolean,
  ts: number,
): Promise<ParsedEncounterResult | null> {
  let buf: ArrayBuffer;
  try { buf = await readBytes(path); } catch { return null; }
  const slots = ensurePool();
  if (!slots) {
    const text = new TextDecoder('utf-8').decode(new Uint8Array(buf));
    return parseEncounterText(path, text, wantMetrics, ts);
  }
  const slot = pickSlot(slots);
  slot.load++;
  return new Promise(resolve => {
    const id = nextId++;
    const timer = setTimeout(() => {
      // Still pending after the timeout -> the worker is wedged on this file.
      // Rebuild the slot so the queue recovers (this job resolves null inside).
      if (slot.pending.has(id)) hardResetSlot(slot, `job timed out after ${JOB_TIMEOUT_MS / 1000}s on ${path}`);
    }, JOB_TIMEOUT_MS);
    slot.pending.set(id, {
      path,
      timer,
      done: reply => {
        if (!reply.ok) resolve(null);
        else resolve({ summary: reply.summary, loot: reply.loot, summaryJson: reply.summaryJson, lootJson: reply.lootJson });
      },
    });
    slot.worker.postMessage({ id, path, buf, wantMetrics, ts }, [buf]);
  });
}

export function computeMetricsForEncounter(enc: Encounter): EncounterMetrics {
  return playerMetricsForEncounter(enc);
}

export interface ParseWorkerStats {
  poolSize: number;
  perWorkerPending: number[];
  totalPending: number;
  poolFailed: boolean;
}

export function getParseWorkerStats(): ParseWorkerStats {
  if (!pool) return { poolSize: 0, perWorkerPending: [], totalPending: 0, poolFailed };
  const perWorker = pool.map(s => s.pending.size);
  return {
    poolSize: pool.length,
    perWorkerPending: perWorker,
    totalPending: perWorker.reduce((a, b) => a + b, 0),
    poolFailed,
  };
}
