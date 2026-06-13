
import { invoke } from '@tauri-apps/api/core';
import type { EncSummary } from './App';
import type { LootEncounterSummary } from '@/lib/dropAggregator';

export const INDEX_VERSION = 5;

const INDEX_FILENAME = 'gnosis_index.json';

const joinDir = (dir: string, name: string) => dir.replace(/[\\/]+$/, '') + '\\' + name;

export interface EncounterIndexEntry {
  summary: EncSummary;
  loot?: LootEncounterSummary;
}

export interface EncounterIndex {
  v: number;
  encounters: Record<string, EncounterIndexEntry>;
}

export async function loadIndex(dir: string): Promise<EncounterIndex> {
  const empty: EncounterIndex = { v: INDEX_VERSION, encounters: {} };
  if (!dir) return empty;
  try {
    const raw = await invoke<string>('read_text_file', { path: joinDir(dir, INDEX_FILENAME) });
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed == null) return empty;
    const v = (parsed as { v?: unknown }).v;
    if (typeof v !== 'number' || v !== INDEX_VERSION) return empty;
    const enc = (parsed as { encounters?: unknown }).encounters;
    if (typeof enc !== 'object' || enc == null) return empty;
    return { v: INDEX_VERSION, encounters: enc as Record<string, EncounterIndexEntry> };
  } catch {
    return empty;
  }
}

const SAVE_DEBOUNCE_MS = 1500;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPayload: { dir: string; index: EncounterIndex } | null = null;
let writeInFlight: Promise<void> | null = null;

async function flushPending(): Promise<void> {
  pendingTimer = null;
  if (!pendingPayload) return;
  const { dir, index } = pendingPayload;
  pendingPayload = null;
  try {
    const slim: EncounterIndex = { v: index.v, encounters: {} };
    for (const [p, entry] of Object.entries(index.encounters)) {
      slim.encounters[p] = { summary: entry.summary };
    }
    await invoke('write_text_file', {
      path: joinDir(dir, INDEX_FILENAME),
      contents: JSON.stringify(slim),
    });
  } catch {
  }
}

export function saveIndex(dir: string, index: EncounterIndex): void {
  if (!dir) return;
  pendingPayload = { dir, index };
  if (pendingTimer != null) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    if (writeInFlight) {
      writeInFlight = writeInFlight.then(flushPending);
    } else {
      writeInFlight = flushPending().finally(() => { writeInFlight = null; });
    }
  }, SAVE_DEBOUNCE_MS);
}

export function flushIndexImmediate(): Promise<void> {
  if (pendingTimer != null) { clearTimeout(pendingTimer); pendingTimer = null; }
  if (writeInFlight) return writeInFlight.then(flushPending);
  return flushPending();
}

export function pruneIndex(index: EncounterIndex, alivePaths: Set<string>): boolean {
  let pruned = false;
  for (const p of Object.keys(index.encounters)) {
    if (!alivePaths.has(p)) {
      delete index.encounters[p];
      pruned = true;
    }
  }
  return pruned;
}
