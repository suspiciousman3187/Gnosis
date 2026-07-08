import { invoke } from '@tauri-apps/api/core';
import { readText } from './library';

export interface ViewEntry {
  id: string;
  members: string[];
  boundaries?: number[];
}

function manifestPath(dataDir: string): string {
  return `${dataDir.replace(/[\\/]+$/, '')}\\_gnosis\\views.json`;
}

export async function loadViews(dataDir: string): Promise<ViewEntry[]> {
  try {
    const text = await readText(manifestPath(dataDir));
    const parsed = JSON.parse(text) as { v?: number; views?: ViewEntry[] };
    if (!Array.isArray(parsed.views)) return [];
    return parsed.views.filter(v =>
      v && typeof v.id === 'string' && Array.isArray(v.members) && v.members.length > 0 &&
      (v.boundaries === undefined || (Array.isArray(v.boundaries) && v.boundaries.every(b => typeof b === 'number'))),
    );
  } catch {
    return [];
  }
}

export async function saveViews(dataDir: string, views: ViewEntry[]): Promise<void> {
  await invoke('write_text_file', {
    path: manifestPath(dataDir),
    contents: JSON.stringify({ v: 1, views }),
  });
}

export function newViewId(): string {
  return `v${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function pruneViews(views: ViewEntry[], existingPaths: Set<string>): { views: ViewEntry[]; changed: boolean } {
  let changed = false;
  const out: ViewEntry[] = [];
  for (const v of views) {
    const alive = v.members.filter(m => existingPaths.has(m));
    if (alive.length === v.members.length) { out.push(v); continue; }
    changed = true;
    if (alive.length === 0) continue;
    if (v.boundaries) { out.push({ ...v, members: alive }); continue; }
    if (alive.length >= 2) out.push({ ...v, members: alive });
  }
  return { views: out, changed };
}
