import type { BuffLogEntry } from '@/lib/types';
import { buffFamilyFor, type BuffFamily } from '@/lib/data/buffFamilies';

export interface UpkeepInterval { start: number; end: number }

export interface DebuffUpkeepRow {
  player: string;
  name: string;
  familyIds: number[] | null;
  intervals: UpkeepInterval[];
  firstApplyAt: number;
  lastSeenAt: number;
  activeSeconds: number;
  windowSeconds: number;
  uptimePct: number;
  applyCount: number;
}

function unionIntervals(intervals: UpkeepInterval[]): UpkeepInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: UpkeepInterval[] = [];
  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (next.start <= cur.end) cur.end = Math.max(cur.end, next.end);
    else { out.push(cur); cur = { ...next }; }
  }
  out.push(cur);
  return out;
}

function clipToWindow(intervals: UpkeepInterval[], winStart: number, winEnd: number): UpkeepInterval[] {
  const out: UpkeepInterval[] = [];
  for (const iv of intervals) {
    const s = Math.max(iv.start, winStart);
    const e = Math.min(iv.end, winEnd);
    if (e > s) out.push({ start: s, end: e });
  }
  return out;
}

function groupKeyFor(buffId: number, family: BuffFamily | null): string {
  return family ? `fam:${family.name}` : `id:${buffId}`;
}

type Acc = {
  player: string;
  name: string;
  familyIds: number[] | null;
  rawIntervals: UpkeepInterval[];
  firstApplyAt: number;
  lastSeenAt: number;
  applyCount: number;
};

export function computeDebuffUpkeep(
  buffLog: BuffLogEntry[] | null | undefined,
  targetName: string,
  fightStart: number,
  fightDuration: number,
): DebuffUpkeepRow[] {
  if (!Array.isArray(buffLog) || buffLog.length === 0 || fightDuration <= 0) return [];
  const fightEnd = fightStart + fightDuration;

  const accs = new Map<string, Acc>();
  const famOpen = new Map<string, { player: string; start: number; expectedEnd: number }>();
  const idOpen = new Map<string, { player: string; start: number }>();

  function ensureAcc(player: string, name: string, familyIds: number[] | null, key: string, atElapsed: number): Acc {
    let a = accs.get(key);
    if (!a) {
      a = { player, name, familyIds, rawIntervals: [], firstApplyAt: atElapsed, lastSeenAt: atElapsed, applyCount: 0 };
      accs.set(key, a);
    }
    return a;
  }

  const sorted = [...buffLog]
    .filter(e => e.target === targetName && e.elapsed >= fightStart && e.elapsed <= fightEnd)
    .sort((a, b) => a.elapsed - b.elapsed);

  for (const ev of sorted) {
    const family = buffFamilyFor(ev.buffId);
    if (ev.kind === 'gain') {
      const player = ev.appliedBy;
      if (!player) continue;

      if (family?.durationModel) {
        const dm = family.durationModel;
        const accKey = `${player}|fam:${family.name}`;
        const acc = ensureAcc(player, family.name, family.ids, accKey, ev.elapsed);
        acc.applyCount++;
        acc.firstApplyAt = Math.min(acc.firstApplyAt, ev.elapsed);
        acc.lastSeenAt = Math.max(acc.lastSeenAt, ev.elapsed);

        const open = famOpen.get(family.name);
        if (open && ev.elapsed < open.expectedEnd) {
          const remaining = open.expectedEnd - ev.elapsed;
          open.expectedEnd = ev.elapsed + Math.min(remaining + dm.refreshSec, dm.capSec);
        } else {
          if (open) {
            const priorAcc = accs.get(`${open.player}|fam:${family.name}`);
            if (priorAcc) priorAcc.rawIntervals.push({ start: open.start, end: Math.min(open.expectedEnd, ev.elapsed) });
          }
          famOpen.set(family.name, { player, start: ev.elapsed, expectedEnd: ev.elapsed + dm.initialSec });
        }
        continue;
      }

      const groupKey = groupKeyFor(ev.buffId, family);
      const accKey = `${player}|${groupKey}`;
      const acc = ensureAcc(player, family ? family.name : ev.buffName, family ? family.ids : null, accKey, ev.elapsed);
      acc.applyCount++;
      acc.firstApplyAt = Math.min(acc.firstApplyAt, ev.elapsed);
      acc.lastSeenAt = Math.max(acc.lastSeenAt, ev.elapsed);

      if (family) {
        for (const [k, st] of [...idOpen.entries()]) {
          const buffId = Number(k.split('|')[1]);
          if (buffId === ev.buffId) continue;
          if (!family.ids.includes(buffId)) continue;
          const priorAcc = accs.get(`${st.player}|fam:${family.name}`);
          if (priorAcc) priorAcc.rawIntervals.push({ start: st.start, end: ev.elapsed });
          idOpen.delete(k);
        }
      }

      const idKey = `${ev.buffId}|${player}`;
      if (idOpen.has(idKey)) {
        const prev = idOpen.get(idKey)!;
        const priorAcc = accs.get(`${prev.player}|${groupKey}`);
        if (priorAcc) priorAcc.rawIntervals.push({ start: prev.start, end: ev.elapsed });
      }
      idOpen.set(idKey, { player, start: ev.elapsed });
    } else {
      if (family?.durationModel) {
        const open = famOpen.get(family.name);
        if (open) {
          const priorAcc = accs.get(`${open.player}|fam:${family.name}`);
          if (priorAcc) priorAcc.rawIntervals.push({ start: open.start, end: ev.elapsed });
          famOpen.delete(family.name);
        }
        continue;
      }
      for (const [k, st] of idOpen.entries()) {
        const buffId = Number(k.split('|')[0]);
        if (buffId !== ev.buffId) continue;
        const groupKey = groupKeyFor(ev.buffId, family);
        const acc = accs.get(`${st.player}|${groupKey}`);
        if (acc) acc.rawIntervals.push({ start: st.start, end: ev.elapsed });
        idOpen.delete(k);
        break;
      }
    }
  }

  for (const [famName, open] of famOpen.entries()) {
    const acc = accs.get(`${open.player}|fam:${famName}`);
    if (acc) acc.rawIntervals.push({ start: open.start, end: Math.min(open.expectedEnd, fightEnd) });
  }
  for (const [k, st] of idOpen.entries()) {
    const buffId = Number(k.split('|')[0]);
    const fam = buffFamilyFor(buffId);
    const groupKey = groupKeyFor(buffId, fam);
    const acc = accs.get(`${st.player}|${groupKey}`);
    if (acc) acc.rawIntervals.push({ start: st.start, end: fightEnd });
  }

  const out: DebuffUpkeepRow[] = [];
  for (const a of accs.values()) {
    const merged = unionIntervals(a.rawIntervals);
    const clipped = clipToWindow(merged, a.firstApplyAt, fightEnd);
    const activeSeconds = clipped.reduce((s, iv) => s + (iv.end - iv.start), 0);
    const windowSeconds = Math.max(0, fightEnd - a.firstApplyAt);
    out.push({
      player: a.player,
      name: a.name,
      familyIds: a.familyIds,
      intervals: clipped,
      firstApplyAt: a.firstApplyAt,
      lastSeenAt: a.lastSeenAt,
      activeSeconds,
      windowSeconds,
      uptimePct: windowSeconds > 0 ? Math.min(1, activeSeconds / windowSeconds) : 0,
      applyCount: a.applyCount,
    });
  }
  return out.sort((a, b) => b.uptimePct - a.uptimePct);
}

export function debuffUpkeepByPlayer(
  buffLog: BuffLogEntry[] | null | undefined,
  targetName: string,
  fightStart: number,
  fightDuration: number,
): Record<string, DebuffUpkeepRow[]> {
  const rows = computeDebuffUpkeep(buffLog, targetName, fightStart, fightDuration);
  const map: Record<string, DebuffUpkeepRow[]> = {};
  for (const r of rows) (map[r.player] ??= []).push(r);
  return map;
}
