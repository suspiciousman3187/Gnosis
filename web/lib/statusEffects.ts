import buffsData from '@/lib/data/buffs.json';
import statusesData from '@/lib/data/statuses.json';

export interface BuffEntry {
  id: number;
  en?: string;
  enl?: string;
}

export interface StatusEntry {
  id: number;
  en?: string;
}

const BUFFS    = buffsData    as unknown as Record<string, BuffEntry>;
const STATUSES = statusesData as unknown as Record<string, StatusEntry>;

export function lookupBuff(id: number | null | undefined): BuffEntry | null {
  if (id == null) return null;
  return BUFFS[String(id)] ?? null;
}

export function buffName(id: number | null | undefined): string {
  const b = lookupBuff(id);
  return b?.en ?? (id != null ? `Buff#${id}` : '?');
}

export function buffLongName(id: number | null | undefined): string | null {
  return lookupBuff(id)?.enl ?? null;
}

const BUFFNAME_FALLBACK_RE = /^(?:Buff\s*#?\d+|Buff\s+\d+|\?)$/i;

export function normalizeBuffName(id: number | null | undefined, existing: string | null | undefined): string {
  const trimmed = (existing ?? '').trim();
  if (trimmed && !BUFFNAME_FALLBACK_RE.test(trimmed)) {
    return trimmed[0].toUpperCase() + trimmed.slice(1);
  }
  const resolved = lookupBuff(id)?.en;
  if (resolved) return resolved[0].toUpperCase() + resolved.slice(1);
  return trimmed || (id != null ? `Buff#${id}` : '?');
}

export function lookupStatus(id: number | null | undefined): StatusEntry | null {
  if (id == null) return null;
  return STATUSES[String(id)] ?? null;
}

export function statusName(id: number | null | undefined): string {
  const s = lookupStatus(id);
  return s?.en ?? (id != null ? `Status#${id}` : '?');
}
