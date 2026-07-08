import { invoke } from '@tauri-apps/api/core';
import { readText } from './library';

function basename(p: string): string { return p.replace(/^.*[\\/]/, ''); }
function dirname(p: string): string { return p.replace(/[\\/][^\\/]+$/, ''); }
function joinPath(...parts: string[]): string { return parts.join('\\'); }

async function writeTextFile(path: string, contents: string): Promise<void> {
  await invoke('write_text_file', { path, contents });
}

export interface ArchiveForDeleteResult {
  archived: string[];
  archiveDir: string;
  failed: { path: string; reason: string }[];
}

export type ArchiveProgress = { current: number; total: number; label: string };

export async function archiveForDelete(
  memberPaths: string[],
  onProgress?: (p: ArchiveProgress) => void,
): Promise<ArchiveForDeleteResult> {
  const result: ArchiveForDeleteResult = { archived: [], archiveDir: '', failed: [] };
  if (memberPaths.length === 0) return result;

  const zoneDir = dirname(memberPaths[0]);
  const dataDir = dirname(zoneDir);
  const batchId = Math.floor(Date.now() / 1000);
  const archiveDir = joinPath(dataDir, '_deleted', String(batchId));
  result.archiveDir = archiveDir;

  const total = memberPaths.length;
  let done = 0;
  for (const p of memberPaths) {
    done += 1;
    onProgress?.({ current: done, total, label: `Archiving ${basename(p)}` });
    try {
      const text = await readText(p);
      const archivePath = joinPath(archiveDir, basename(p).replace(/\.gz$/, ''));
      await writeTextFile(archivePath, text);
      result.archived.push(archivePath);
    } catch (e) {
      result.failed.push({ path: p, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
