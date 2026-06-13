import { invoke } from '@tauri-apps/api/core';
import { inTauri } from './library';

export type SummaryRow = {
  path: string;
  ts: number;
  kind: string;
  zone: string | null;
  json: string;
};

export type LootRow = {
  path: string;
  ts: number;
  json: string;
};

export const META_SCHEMA_VERSION = 'schema_version';
export const META_LEGACY_MIGRATED = 'legacy_index_migrated';

export async function dbOpen(dir: string): Promise<void> {
  if (!inTauri || !dir) return;
  await invoke('db_open', { dir });
}

export async function dbGetSummaries(dir: string, paths: string[]): Promise<SummaryRow[]> {
  if (!inTauri || !dir || paths.length === 0) return [];
  return invoke<SummaryRow[]>('db_get_summaries', { dir, paths });
}

export async function dbGetLoots(dir: string, paths: string[]): Promise<LootRow[]> {
  if (!inTauri || !dir || paths.length === 0) return [];
  return invoke<LootRow[]>('db_get_loots', { dir, paths });
}

export async function dbListKnownPaths(dir: string): Promise<string[]> {
  if (!inTauri || !dir) return [];
  return invoke<string[]>('db_list_known_paths', { dir });
}

export async function dbPutSummary(dir: string, row: SummaryRow): Promise<void> {
  if (!inTauri || !dir) return;
  await invoke('db_put_summary', { dir, row });
}

export async function dbPutSummaries(dir: string, rows: SummaryRow[]): Promise<void> {
  if (!inTauri || !dir || rows.length === 0) return;
  await invoke('db_put_summaries', { dir, rows });
}

export async function dbPutLoot(dir: string, row: LootRow): Promise<void> {
  if (!inTauri || !dir) return;
  await invoke('db_put_loot', { dir, row });
}

export async function dbPutLoots(dir: string, rows: LootRow[]): Promise<void> {
  if (!inTauri || !dir || rows.length === 0) return;
  await invoke('db_put_loots', { dir, rows });
}

export async function dbDeletePaths(dir: string, paths: string[]): Promise<void> {
  if (!inTauri || !dir || paths.length === 0) return;
  await invoke('db_delete_paths', { dir, paths });
}

export async function dbMetaGet(dir: string, key: string): Promise<string | null> {
  if (!inTauri || !dir) return null;
  const v = await invoke<string | null>('db_meta_get', { dir, key });
  return v ?? null;
}

export async function dbMetaSet(dir: string, key: string, value: string): Promise<void> {
  if (!inTauri || !dir) return;
  await invoke('db_meta_set', { dir, key, value });
}

export async function dbCountSummaries(dir: string): Promise<number> {
  if (!inTauri || !dir) return 0;
  return invoke<number>('db_count_summaries', { dir });
}
