export type ResKind =
  | 'items'
  | 'spells'
  | 'job_abilities'
  | 'weapon_skills'
  | 'buffs'
  | 'zones'
  | 'key_items'
  | 'monster_abilities';

export interface ResEntry { en: string; ja: string }
export type ResBundle = Record<string, ResEntry>;

const CACHE: Partial<Record<ResKind, ResBundle>> = {};
const PENDING: Partial<Record<ResKind, Promise<ResBundle>>> = {};

export function getResBundleSync(kind: ResKind): ResBundle | null {
  return CACHE[kind] ?? null;
}

export async function loadResBundle(kind: ResKind): Promise<ResBundle> {
  const cached = CACHE[kind];
  if (cached) return cached;
  const inflight = PENDING[kind];
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const res = await fetch(`/res/${kind}.json`, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as ResBundle;
      CACHE[kind] = data;
      return data;
    } catch (e) {
      delete PENDING[kind];
      throw e;
    }
  })();
  PENDING[kind] = p;
  return p;
}

export function lookupResEntry(kind: ResKind, id: number | string | null | undefined): ResEntry | null {
  if (id == null) return null;
  const bundle = CACHE[kind];
  if (!bundle) return null;
  return bundle[String(id)] ?? null;
}
