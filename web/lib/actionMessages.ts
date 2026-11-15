import actionMessagesData from '@/lib/data/actionMessages.json';
import jobAbilitiesData from '@/lib/data/job_abilities.json';
import weaponSkillsData from '@/lib/data/weapon_skills.json';
import type { ActionLogEntry } from './types';

export interface ActionMessageEntry {
  id: number;
  en?: string;
  color?: string;
}

const TABLE = actionMessagesData as unknown as Record<string, ActionMessageEntry>;
const JA_MAP = jobAbilitiesData as unknown as Record<string, { en?: string; ja?: string }>;
const WS_MAP = weaponSkillsData as unknown as Record<string, { en?: string; ja?: string }>;

export function lookupActionMessage(id: number | null | undefined): ActionMessageEntry | null {
  if (id == null) return null;
  return TABLE[String(id)] ?? null;
}

export function actionMessageText(id: number | null | undefined): string | null {
  return lookupActionMessage(id)?.en ?? null;
}

export const CAT3_ABILITY_MSGS = new Set<number>([
  100, 110, 317, 379, 522, 736, 746, 802, 803,
]);

export function cat3IsAbility(msg: number | null | undefined): boolean | null {
  if (msg == null) return null;
  const en = lookupActionMessage(msg)?.en;
  if (en) {
    if (en.indexOf('${weapon_skill}') >= 0) return false;
    if (en.indexOf('${ability}') >= 0) return true;
  }
  return CAT3_ABILITY_MSGS.has(msg) ? true : null;
}

export function resolveActionDisplayName(e: ActionLogEntry, lang: 'en' | 'ja' = 'en'): string {
  if (e.category === 3 && e.actorRole !== 'mob' && e.actorRole !== 'boss') {
    const msg = e.targets?.[0]?.message ?? null;
    const ab = cat3IsAbility(msg);
    const map = ab === true ? JA_MAP : ab === false ? WS_MAP : (e.type === 'ja' ? JA_MAP : WS_MAP);
    const r = map[String(e.param)];
    const nm = r && (lang === 'ja' ? r.ja : r.en);
    if (nm) return nm;
  }
  return e.name;
}
