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
}

export type ArchiveKind = 'merged' | 'split' | 'deleted';

export interface ArchiveEntry {
  archiveDir: string;
  mergedStart: number;
  kind: ArchiveKind;
  members: ArchiveMember[];
}

export interface RestoreResult {
  restored: string[];
  failed: { path: string; reason: string }[];
}

async function scanArchiveRoot(dataDir: string, rootName: string, kind: ArchiveKind): Promise<ArchiveEntry[]> {
  const archiveRoot = joinPath(dataDir, rootName);
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
    const members: ArchiveMember[] = filePaths.map(p => ({ path: p, char: fileChar(p) }));
    out.push({ archiveDir, mergedStart, kind, members });
  }
  return out;
}

export async function peekArchiveZone(archive: ArchiveEntry): Promise<string | null> {
  const rep = archive.members[0];
  if (!rep) return null;
  if (basename(rep.path).startsWith('sortie_')) return 'Sortie';
  try {
    const text = await readText(rep.path);
    const m = text.match(/"zoneName"\s*:\s*"([^"]*)"/);
    return m && m[1] ? m[1] : null;
  } catch {
    return null;
  }
}

export async function scanArchives(dataDir: string): Promise<ArchiveEntry[]> {
  const [merged, split, deleted] = await Promise.all([
    scanArchiveRoot(dataDir, '_merged', 'merged'),
    scanArchiveRoot(dataDir, '_split', 'split'),
    scanArchiveRoot(dataDir, '_deleted', 'deleted'),
  ]);
  const out = [...merged, ...split, ...deleted];
  out.sort((a, b) => b.mergedStart - a.mergedStart);
  return out;
}

export async function restoreArchive(
  dataDir: string,
  archive: ArchiveEntry,
): Promise<RestoreResult> {
  const result: RestoreResult = { restored: [], failed: [] };
  for (const m of archive.members) {
    const isSortie = basename(m.path).startsWith('sortie_');
    try {
      const text = await readText(m.path);
      let destSubdir: string;
      if (isSortie) {
        destSubdir = 'Sortie';
      } else {
        const enc = parseJsonWithTrailingRecovery(text) as Encounter;
        const zone = enc.zoneName?.trim();
        if (!zone) {
          result.failed.push({ path: m.path, reason: 'Could not read zone from file.' });
          continue;
        }
        destSubdir = zone;
      }
      const destPath = joinPath(dataDir, destSubdir, basename(m.path));
      await writeTextFile(destPath, text);
      result.restored.push(destPath);
      try { await deleteFile(m.path); } catch { /* keep archive copy if delete fails */ }
    } catch (e) {
      result.failed.push({ path: m.path, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
