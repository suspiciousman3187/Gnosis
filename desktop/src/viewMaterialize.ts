import { loadContent, mergeContents, fileChar, kindFromName, type LoadedContent } from './content';
import { mergeEncountersForCharacter } from './mergeEncounters';
import { splitEncounterWindows } from './splitEncounter';
import { mergeRawSortieSlices } from './sortieSliceMerge';
import { parseJsonWithTrailingRecovery } from './parseEncounterCore';
import type { Encounter } from '@/lib/encounter';

export interface ViewSpec {
  boundaries?: number[];
  segIndex?: number;
}

export function materializeGroup(
  loads: { path: string; text: string }[],
  view?: ViewSpec,
): LoadedContent {
  if (loads.length === 0) throw new Error('Nothing to open.');

  const byChar = new Map<string, { path: string; text: string }[]>();
  for (const l of loads) {
    const key = fileChar(l.path) ?? l.path;
    const arr = byChar.get(key) ?? [];
    arr.push(l);
    byChar.set(key, arr);
  }

  const perChar: LoadedContent[] = [];
  for (const items of byChar.values()) {
    if (items.length === 1) {
      perChar.push(loadContent(items[0].path, items[0].text));
      continue;
    }
    const kind = kindFromName(items[0].path);
    if (kind === 'sortie') {
      const mergedText = mergeRawSortieSlices(items.map(i => i.text));
      perChar.push(loadContent(items[0].path, mergedText));
    } else if (kind === 'encounter') {
      const encs = items.map(i => parseJsonWithTrailingRecovery(i.text) as Encounter);
      const merged = mergeEncountersForCharacter(encs);
      perChar.push(loadContent(items[0].path, JSON.stringify(merged)));
    } else {
      perChar.push(loadContent(items[0].path, items[0].text));
    }
  }

  let contents = perChar;
  if (view?.boundaries && view.boundaries.length > 0 && view.segIndex != null) {
    const segIdx = view.segIndex;
    const sliced: LoadedContent[] = [];
    for (const c of contents) {
      if (c.kind !== 'encounter') continue;
      const seg = splitEncounterWindows(c.encounter, view.boundaries)[segIdx];
      if (seg) sliced.push({ kind: 'encounter', encounter: seg });
    }
    if (sliced.length === 0) throw new Error('This segment has no recorded events.');
    contents = sliced;
  }

  return contents.length > 1 ? mergeContents(contents) : contents[0];
}
