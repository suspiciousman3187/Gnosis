import { invoke } from '@tauri-apps/api/core';
import type { Encounter } from '@/lib/encounter';
import { playerMetricsForEncounter, type EncounterMetrics } from '@/lib/combatStats';
import { parseEncounterText, type ParseReply, type ParsedEncounterResult } from './parseEncounterCore';

export type { ParsedEncounterResult };

const POOL_SIZE = 4;

interface MeasureMemoryReply { id: number; type: 'memory'; ok: boolean; bytes?: number; jsHeap?: number; error?: string }

interface WorkerSlot {
  worker: Worker;
  pending: Map<number, (r: ParseReply) => void>;
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
    const resolver = slot.pending.get(reply.id);
    if (!resolver) return;
    slot.pending.delete(reply.id);
    slot.load = Math.max(0, slot.load - 1);
    slot.jobCount += 1;
    resolver(reply);
    maybeRecycle(slot);
  });
  w.addEventListener('error', () => {
    for (const [id, resolver] of slot.pending) resolver({ id, ok: false });
    slot.pending.clear();
    slot.pendingMeasures.clear();
    slot.load = 0;
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
    slot.pending.set(id, reply => {
      if (!reply.ok) resolve(null);
      else resolve({ summary: reply.summary, loot: reply.loot, summaryJson: reply.summaryJson, lootJson: reply.lootJson });
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
