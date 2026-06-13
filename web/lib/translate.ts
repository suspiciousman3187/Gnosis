import {
  lookupResEntry,
  loadResBundle,
  getResBundleSync,
  type ResKind,
} from './resBundle';
import type { EncounterLanguage } from './encounter';

export type DisplayLanguage = 'auto' | 'en' | 'ja';

export function effectiveLanguage(displayLang: DisplayLanguage, captureLang: EncounterLanguage | null | undefined): EncounterLanguage {
  if (displayLang === 'auto') return captureLang === 'ja' ? 'ja' : 'en';
  return displayLang;
}

/** action_log entries: pick the res table based on FFXI action category. */
export function resKindForCategory(category: number | null | undefined): ResKind | null {
  switch (category) {
    case 3:                          return 'weapon_skills';
    case 4: case 8:                  return 'spells';
    case 6: case 13: case 14: case 15: return 'job_abilities';
    case 11:                         return 'monster_abilities';
    default:                         return null;
  }
}

/** Synchronous: returns the translated name if the bundle is already loaded,
 *  else returns null so the caller can fall back to the captured-language name. */
export function translateActionSync(
  kind: ResKind | null,
  id: number | null | undefined,
  targetLang: EncounterLanguage,
): string | null {
  if (!kind || id == null) return null;
  const entry = lookupResEntry(kind, id);
  if (!entry) return null;
  const out = targetLang === 'ja' ? entry.ja : entry.en;
  return (out && out !== '') ? out : null;
}

/** Ensure the named bundles are loaded; safe to call repeatedly. */
export async function ensureBundlesLoaded(kinds: ResKind[]): Promise<void> {
  await Promise.all(kinds.map(k => (getResBundleSync(k) ? Promise.resolve() : loadResBundle(k).catch(() => undefined))));
}

/** Convenience: bundles every display surface needs. */
export const TRANSLATE_BUNDLES: ResKind[] = [
  'items',
  'spells',
  'job_abilities',
  'weapon_skills',
  'buffs',
  'zones',
  'key_items',
  'monster_abilities',
];

export function translateByIdSync(kind: ResKind, id: number | null | undefined, fallback: string, targetLang: EncounterLanguage): string {
  if (id == null) return fallback;
  const entry = lookupResEntry(kind, id);
  if (!entry) return fallback;
  const out = targetLang === 'ja' ? entry.ja : entry.en;
  return (out && out !== '') ? out : fallback;
}

/** Direct display-language renderer for aggregation surfaces (loot table, activities)
 *  where each row's capture language is unknown / mixed. In 'auto' mode, returns the
 *  captured-language fallback verbatim. In 'en' / 'ja' mode, looks up via id; falls back
 *  to the captured name if the bundle isn't loaded yet or the id is unknown. */
export function translateForDisplay(kind: ResKind, id: number | null | undefined, fallback: string, displayLang: DisplayLanguage): string {
  if (displayLang === 'auto') return fallback;
  return translateByIdSync(kind, id ?? null, fallback, displayLang);
}

/** Build a stable per-encounter translator. Returns identity when displayLang matches
 *  captureLang (skips res lookups entirely — cheap for the common case). */
export function makeActionTranslator(captureLang: EncounterLanguage | null | undefined, displayLang: DisplayLanguage) {
  const target = effectiveLanguage(displayLang, captureLang);
  const cap = (captureLang === 'ja' ? 'ja' : 'en') as EncounterLanguage;
  if (target === cap) {
    return (name: string, _category?: number | null, _param?: number | null) => name;
  }
  return (name: string, category?: number | null, param?: number | null) => {
    if (category == null || param == null) return name;
    const kind = resKindForCategory(category);
    const out = translateActionSync(kind, param, target);
    return out ?? name;
  };
}

export function makeIdTranslator(captureLang: EncounterLanguage | null | undefined, displayLang: DisplayLanguage, kind: ResKind) {
  const target = effectiveLanguage(displayLang, captureLang);
  const cap = (captureLang === 'ja' ? 'ja' : 'en') as EncounterLanguage;
  if (target === cap) {
    return (name: string, _id?: number | null) => name;
  }
  return (name: string, id?: number | null) => translateByIdSync(kind, id ?? null, name, target);
}
