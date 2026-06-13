import { invoke } from '@tauri-apps/api/core';
import { readText, deleteFile } from './library';
import { fileChar, kindFromName } from './content';
import type { Encounter } from '@/lib/encounter';
import { parseJsonWithTrailingRecovery } from './parseEncounterCore';
import { splitEncounter, suggestSplits, type SplitMode } from './splitEncounter';

function basename(p: string): string { return p.replace(/^.*[\\/]/, ''); }
function dirname(p: string): string  { return p.replace(/[\\/][^\\/]+$/, ''); }
function joinPath(...parts: string[]): string { return parts.join('\\'); }

async function writeTextFile(path: string, contents: string): Promise<void> {
  await invoke('write_text_file', { path, contents });
}

export type SplitProgress = { current: number; total: number; label: string };

export type SplitResult = {
  newFiles: string[];
  archivedFiles: string[];
  archiveDir: string;
  segmentCount: number;
};

/**
 * Split one (multi-character or single) encounter group into N segments.
 *
 * `groupMemberPaths` is one group's member files (e.g., 6 multibox files of
 * the same encounter). The same boundary set is applied to every member, so
 * the resulting per-segment files share `startTime` and naturally regroup as
 * multibox groups in the History list.
 *
 * Originals are moved to `data/_split/<origStart>/<filename>` (recoverable).
 *
 * `boundaries`: either a fixed list (manual mode) or omitted (mode-derived).
 */
export async function splitGroup(
  groupMemberPaths: string[],
  mode: SplitMode,
  options: { boundaries?: number[]; gapSeconds?: number },
  onProgress?: (p: SplitProgress) => void,
): Promise<SplitResult> {
  if (groupMemberPaths.length === 0) throw new Error('No paths to split.');

  // Load every member. Boundary derivation needs the encounter shape; pick the
  // first member as the representative (multibox members share timelines).
  const N = groupMemberPaths.length;
  let stepsTotal = N + 1; // reads + (write count refined below)
  let stepsDone = 0;
  const tick = (label: string) => {
    stepsDone += 1;
    onProgress?.({ current: stepsDone, total: stepsTotal, label });
  };

  onProgress?.({ current: 0, total: stepsTotal, label: 'Reading files…' });

  const loaded: { path: string; enc: Encounter; rawText: string }[] = [];
  for (const p of groupMemberPaths) {
    if (kindFromName(p) !== 'encounter') {
      throw new Error(`Only encounter files can be split (got: ${basename(p)}).`);
    }
    const rawText = await readText(p);
    const enc = parseJsonWithTrailingRecovery(rawText) as Encounter;
    loaded.push({ path: p, enc, rawText });
    tick(`Read ${basename(p)}`);
  }

  const representative = loaded[0].enc;
  const boundaries = mode === 'manual'
    ? (options.boundaries ?? [])
    : suggestSplits(representative, mode, { gapSeconds: options.gapSeconds });

  if (boundaries.length === 0) {
    throw new Error('No split boundaries produced - try a different mode or pick boundaries manually.');
  }

  // Refine totals: N reads + (segments × members) writes + N archive writes + N deletes.
  const previewSegments = splitEncounter(representative, boundaries).length;
  if (previewSegments < 2) {
    throw new Error('Split produced fewer than 2 non-empty segments. Try different boundaries.');
  }
  stepsTotal = N + previewSegments * N + N + N;

  const zoneDir = dirname(loaded[0].path);
  const archiveDir = joinPath(dirname(zoneDir), '_split', String(representative.startTime));

  const newFiles: string[] = [];
  for (const item of loaded) {
    const segments = splitEncounter(item.enc, boundaries);
    const char = fileChar(item.path) ?? '_';
    for (const seg of segments) {
      const newPath = joinPath(zoneDir, `encounter_${seg.startTime}__${char}.json`);
      await writeTextFile(newPath, JSON.stringify(seg));
      newFiles.push(newPath);
      tick(`Wrote ${char} segment @ ${seg.startTime}`);
    }
  }

  const archivedFiles: string[] = [];
  for (const item of loaded) {
    const archivePath = joinPath(archiveDir, basename(item.path).replace(/\.gz$/, ''));
    await writeTextFile(archivePath, item.rawText);
    archivedFiles.push(archivePath);
    tick(`Archived ${basename(item.path)}`);
    try { await deleteFile(item.path); } catch { /* best-effort; archive is already written */ }
    tick(`Removed original`);
  }

  return { newFiles, archivedFiles, archiveDir, segmentCount: previewSegments };
}
