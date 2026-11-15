
import type { ActionLogEntry } from './types';
import { cat3IsAbility } from './actionMessages';

export type CanonicalActionType =
  | 'auto'
  | 'ranged'
  | 'ws'
  | 'spell'
  | 'enfeeb'   // sub-class of spell
  | 'mb'       // magic burst (sub-class of spell; UI tag, not a packet cat)
  | 'ja'
  | 'mob_ability'
  | 'unknown';

function categoryToType(cat: number): CanonicalActionType {
  switch (cat) {
    case 1:  return 'auto';
    case 2:  return 'ranged';
    case 3:  return 'ws';
    case 4:  return 'spell';
    case 6:  return 'ja';
    case 7:  return 'ws';
    case 8:  return 'spell';
    case 9:  return 'unknown';
    case 11: return 'mob_ability';
    case 12: return 'ranged';
    case 13: return 'ja';
    case 14: return 'ja';
    case 15: return 'ja';
    default: return 'unknown';
  }
}

function legacyTypeToCanonical(t: ActionLogEntry['type']): CanonicalActionType {
  // Identity for every value: 'auto' | 'ranged' | 'ws' | 'spell' | 'enfeeb' | 'mb' | 'ja'.
  return t;
}

export function canonicalTypeOf(entry: ActionLogEntry): CanonicalActionType {
  if (typeof entry.category === 'number') {
    const base = categoryToType(entry.category);
    // Preserve spell sub-classifications when the resolver tagged them.
    if (base === 'spell' && entry.type === 'enfeeb') return 'enfeeb';
    if (base === 'spell' && entry.type === 'mb') return 'mb';
    // A spell cast during an open skillchain window lands as a magic burst; the
    // addon records that on the target as result 'burst' (never as entry.type).
    // Surface it as 'mb' so the filter chip, per-row tag, and the 'mb' stats
    // bucket all treat it as a magic burst. Retroactive - works on existing logs.
    if (base === 'spell' && entry.targets?.some(t => t.result === 'burst')) return 'mb';
    if ((base === 'ws' || base === 'ja') && entry.type === 'mob_ability') return 'mob_ability';
    if (base === 'ws') {
      const ab = cat3IsAbility(entry.targets?.[0]?.message ?? null);
      if (ab === true) return 'ja';
      if (ab === false) return 'ws';
      return entry.type === 'ja' ? 'ja' : 'ws';
    }
    return base;
  }
  return legacyTypeToCanonical(entry.type);
}


export const isWeaponSkill   = (e: ActionLogEntry) => canonicalTypeOf(e) === 'ws';
export const isJobAbility    = (e: ActionLogEntry) => canonicalTypeOf(e) === 'ja';
export const isSpell         = (e: ActionLogEntry) => {
  const t = canonicalTypeOf(e);
  return t === 'spell' || t === 'enfeeb' || t === 'mb';
};
export const isEnfeebleSpell = (e: ActionLogEntry) => canonicalTypeOf(e) === 'enfeeb';
export const isMagicBurst    = (e: ActionLogEntry) => canonicalTypeOf(e) === 'mb';
export const isAutoAttack    = (e: ActionLogEntry) => canonicalTypeOf(e) === 'auto';
export const isRanged        = (e: ActionLogEntry) => canonicalTypeOf(e) === 'ranged';
export const isMobAbility    = (e: ActionLogEntry) => canonicalTypeOf(e) === 'mob_ability';
