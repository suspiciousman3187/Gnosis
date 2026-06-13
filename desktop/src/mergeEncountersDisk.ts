import { invoke } from '@tauri-apps/api/core';
import { readText, deleteFile } from './library';
import { fileChar, kindFromName } from './content';
import type { Encounter } from '@/lib/encounter';
import { parseJsonWithTrailingRecovery } from './parseEncounterCore';
import { mergeEncountersForCharacter, validateMerge } from './mergeEncounters';

function basename(p: string): string { return p.replace(/^.*[\\/]/, ''); }
function dirname(p: string): string  { return p.replace(/[\\/][^\\/]+$/, ''); }
function joinPath(...parts: string[]): string { return parts.join('\\'); }

async function writeTextFile(path: string, contents: string): Promise<void> {
  await invoke('write_text_file', { path, contents });
}

export type MergeResult = {
  newFiles: string[];
  archivedFiles: string[];
  archiveDir: string;
};

export type MergeProgress = { current: number; total: number; label: string };

/**
 * Merge multiple encounter groups into one.
 *
 * `groupMemberPaths` is an array of arrays - each inner array is one multibox
 * group's member files. Validation (same zone, same character-set sanity, etc.)
 * is done up-front on the loaded representatives; if it fails the whole merge
 * aborts and nothing is written.
 *
 * On success: writes one new encounter file per unique character into the
 * original zone subfolder, then moves every original file into a sibling
 * `_merged/<mergedStart>/` directory (recoverable, not deleted).
 */
export async function mergeGroups(
  groupMemberPaths: string[][],
  onProgress?: (p: MergeProgress) => void,
): Promise<MergeResult> {
  const allPaths = groupMemberPaths.flat();
  if (allPaths.length === 0) throw new Error('No paths to merge.');

  // Total step count = N reads + (chars to write) + N archive writes + N deletes.
  // We resolve the char count after grouping (below) - until then, hold the
  // partial total at N and lift the cap right before the write phase.
  const N = allPaths.length;
  let stepsDone = 0;
  let stepsTotal = N + 1 + N + N;
  const tick = (label: string) => {
    stepsDone += 1;
    onProgress?.({ current: stepsDone, total: stepsTotal, label });
  };

  onProgress?.({ current: 0, total: stepsTotal, label: 'Reading files…' });

  const loaded: { path: string; enc: Encounter; rawText: string }[] = [];
  for (const p of allPaths) {
    if (kindFromName(p) !== 'encounter') {
      throw new Error(`Only encounter files can be merged (got: ${basename(p)}).`);
    }
    const rawText = await readText(p);
    const enc = parseJsonWithTrailingRecovery(rawText) as Encounter;
    loaded.push({ path: p, enc, rawText });
    tick(`Read ${basename(p)}`);
  }

  const representativesPerGroup: Encounter[] = groupMemberPaths.map(members => {
    const first = loaded.find(l => l.path === members[0]);
    if (!first) throw new Error('Group representative missing - load failed.');
    return first.enc;
  });
  const v = validateMerge(representativesPerGroup);
  if (!v.ok) throw new Error(v.reason);

  const mergedStart = Math.min(...loaded.map(l => l.enc.startTime));
  const zoneDir = dirname(loaded[0].path);
  const archiveDir = joinPath(dirname(zoneDir), '_merged', String(mergedStart));

  const byChar = new Map<string, { path: string; enc: Encounter; rawText: string }[]>();
  for (const item of loaded) {
    const char = fileChar(item.path) ?? '_';
    const arr = byChar.get(char) ?? [];
    arr.push(item);
    byChar.set(char, arr);
  }

  stepsTotal = N + byChar.size + N + N;

  const newFiles: string[] = [];
  for (const [char, items] of byChar) {
    if (items.length === 0) continue;
    const merged = mergeEncountersForCharacter(items.map(i => i.enc));
    const newPath = joinPath(zoneDir, `encounter_${mergedStart}__${char}.json`);
    await writeTextFile(newPath, JSON.stringify(merged));
    newFiles.push(newPath);
    tick(`Wrote merged ${char}`);
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

  return { newFiles, archivedFiles, archiveDir };
}

export { validateMerge };
