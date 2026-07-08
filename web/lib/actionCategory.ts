
import type { ActionLogEntry } from './types';

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
    if (base === 'spell' && (entry.type === 'enfeeb' || entry.type === 'mb')) return entry.type;
    // Category 3 carries BOTH weaponskills and damaging, enemy-targeted job
    // abilities (Jump, High Jump, Super Jump, Shield Bash, ...). The addon
    // disambiguates them by the action's message id and records the result in
    // `type`; category alone can't tell them apart and would mislabel the job
    // abilities as weaponskills (dragging down the WS average). Trust the addon's
    // 'ja' whenever the category resolved to 'ws'.
    if (base === 'ws' && entry.type === 'ja') return 'ja';
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
