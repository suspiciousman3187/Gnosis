import type { BuffLogEntry } from '@/lib/types';

export const DISABLING_BUFF_IDS = new Set<number>([
  2, 19, 7, 6, 10, 14, 4, 15, 21, 28, 16,
]);

export const DISABLING_BUFF_LABEL: Record<number, string> = {
  2:  'Sleep',
  19: 'Sleep II',
  7:  'Petrify',
  6:  'Silence',
  10: 'Stun',
  14: 'Charm',
  4:  'Paralyze',
  15: 'Bind',
  21: 'Doom',
  28: 'Terror',
  16: 'Amnesia',
};

export interface DisablingBuffEntry {
  buffId: number;
  buffName: string;
  target: string;
  appliedBy?: string | null;
  appliedBySpell?: string | null;
  startElapsed: number;
  endElapsed: number;
  durationSec: number;
}

export function pairDisablingBuffDurations(
  buffLog: BuffLogEntry[] | null | undefined,
  opts?: { buffIds?: Set<number>; maxElapsed?: number },
): DisablingBuffEntry[] {
  if (!Array.isArray(buffLog) || buffLog.length === 0) return [];
  const buffIds = opts?.buffIds ?? DISABLING_BUFF_IDS;
  const pending = new Map<string, BuffLogEntry>();
  const out: DisablingBuffEntry[] = [];
  const sorted = [...buffLog].sort((a, b) => a.elapsed - b.elapsed);
  for (const e of sorted) {
    if (!e.buffId || !buffIds.has(e.buffId)) continue;
    const key = `${e.target}|${e.buffId}`;
    if (e.kind === 'gain') {
      if (!pending.has(key)) pending.set(key, e);
    } else if (e.kind === 'wear') {
      const g = pending.get(key);
      if (g) {
        pending.delete(key);
        out.push({
          buffId: e.buffId,
          buffName: e.buffName ?? DISABLING_BUFF_LABEL[e.buffId] ?? `Buff ${e.buffId}`,
          target: e.target,
          appliedBy: g.appliedBy ?? null,
          appliedBySpell: g.appliedBySpell ?? null,
          startElapsed: g.elapsed,
          endElapsed: e.elapsed,
          durationSec: Math.max(0, e.elapsed - g.elapsed),
        });
      }
    }
  }
  if (opts?.maxElapsed != null) {
    for (const g of pending.values()) {
      out.push({
        buffId: g.buffId,
        buffName: g.buffName ?? DISABLING_BUFF_LABEL[g.buffId] ?? `Buff ${g.buffId}`,
        target: g.target,
        appliedBy: g.appliedBy ?? null,
        appliedBySpell: g.appliedBySpell ?? null,
        startElapsed: g.elapsed,
        endElapsed: opts.maxElapsed,
        durationSec: Math.max(0, opts.maxElapsed - g.elapsed),
      });
    }
  }
  return out.sort((a, b) => a.startElapsed - b.startElapsed);
}
