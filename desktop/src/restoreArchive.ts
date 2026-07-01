import { invoke } from '@tauri-apps/api/core';
import { readText, deleteFile } from './library';
import { parseJsonWithTrailingRecovery } from './parseEncounterCore';
import { fileChar } from './content';
import type { Encounter } from '@/lib/encounter';

function basename(p: string): string { return p.replace(/^.*[\\/]/, ''); }
function dirname(p: string): string { return p.replace(/[\\/][^\\/]+$/, ''); }
function joinPath(...parts: string[]): string { return parts.join('\\'); }

async function writeTextFile(path: string, contents: string): Promise<void> {
  await invoke('write_text_file', { path, contents });
}

export interface ArchiveMember {
  path: string;
  char: string | null;
  zoneName: string | null;
  startTime: number | null;
}

export interface ArchiveEntry {
  archiveDir: string;
  mergedStart: number;
  members: ArchiveMember[];
}

export interface RestoreResult {
  restored: string[];
  failed: { path: string; reason: string }[];
}

export async function scanArchives(dataDir: string): Promise<ArchiveEntry[]> {
  const archiveRoot = joinPath(dataDir, '_merged');
  let paths: string[];
  try {
    paths = await invoke<string[]>('list_json_files', { dir: archiveRoot });
  } catch {
    return [];
  }
  const byArchive = new Map<string, string[]>();
  for (const p of paths) {
    if (!p.endsWith('.json') && !p.endsWith('.json.gz')) continue;
    const dir = dirname(p);
    const arr = byArchive.get(dir) ?? [];
    arr.push(p);
    byArchive.set(dir, arr);
  }

  const out: ArchiveEntry[] = [];
  for (const [archiveDir, filePaths] of byArchive) {
    const tsName = basename(archiveDir);
    const mergedStart = /^\d+$/.test(tsName) ? Number(tsName) : 0;
    const members: ArchiveMember[] = [];
    for (const p of filePaths) {
      try {
        const text = await readText(p);
        const enc = parseJsonWithTrailingRecovery(text) as Encounter;
        members.push({
          path: p,
          char: fileChar(p),
          zoneName: enc.zoneName ?? null,
          startTime: typeof enc.startTime === 'number' ? enc.startTime : null,
        });
      } catch {
        members.push({ path: p, char: fileChar(p), zoneName: null, startTime: null });
      }
    }
    out.push({ archiveDir, mergedStart, members });
  }

  out.sort((a, b) => b.mergedStart - a.mergedStart);
  return out;
}

export async function restoreArchive(
  dataDir: string,
  archive: ArchiveEntry,
): Promise<RestoreResult> {
  const result: RestoreResult = { restored: [], failed: [] };
  for (const m of archive.members) {
    if (!m.zoneName) {
      result.failed.push({ path: m.path, reason: 'Could not read zone from file.' });
      continue;
    }
    const destDir = joinPath(dataDir, m.zoneName);
    const destPath = joinPath(destDir, basename(m.path));
    try {
      const text = await readText(m.path);
      await writeTextFile(destPath, text);
      result.restored.push(destPath);
      try { await deleteFile(m.path); } catch { /* keep archive copy if delete fails */ }
    } catch (e) {
      result.failed.push({ path: m.path, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
