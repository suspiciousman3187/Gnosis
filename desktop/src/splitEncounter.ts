import type { Encounter, EncounterEnemy, EncounterDrop } from '@/lib/encounter';

type WithElapsed = { elapsed: number };

function sliceLog<T extends WithElapsed>(
  log: T[] | null | undefined,
  start: number,
  end: number,
): T[] | null {
  if (!log || log.length === 0) return null;
  const out: T[] = [];
  for (const e of log) {
    const t = e.elapsed ?? 0;
    if (t >= start && t < end) out.push({ ...e, elapsed: t - start });
  }
  return out.length > 0 ? out : null;
}

function sliceDropLog(
  log: EncounterDrop[] | null | undefined,
  start: number,
  end: number,
): EncounterDrop[] | null {
  if (!log || log.length === 0) return null;
  const out: EncounterDrop[] = [];
  for (const e of log) {
    const t = e.elapsed ?? 0;
    if (t >= start && t < end) out.push({ ...e, elapsed: t - start });
  }
  return out.length > 0 ? out : null;
}

function sliceEnemies(
  enemies: EncounterEnemy[] | null | undefined,
  start: number,
  end: number,
): EncounterEnemy[] {
  if (!enemies) return [];
  const out: EncounterEnemy[] = [];
  for (const e of enemies) {
    const seen = e.firstSeen ?? 0;
    const killed = e.killedAt ?? null;
    // An enemy belongs to this segment if it was seen DURING the segment, OR
    // it was killed during the segment. Enemies seen+killed wholly outside drop.
    const seenInside = seen >= start && seen < end;
    const killedInside = killed != null && killed >= start && killed < end;
    if (!seenInside && !killedInside) continue;
    out.push({
      ...e,
      firstSeen: Math.max(0, seen - start),
      killedAt: killedInside ? Math.max(0, (killed ?? 0) - start) : null,
    });
  }
  return out;
}

/**
 * Split one Encounter at the given elapsed-timestamp boundaries. Boundaries
 * are seconds-from-encounter-start. A boundary list `[t1, t2, t3]` produces
 * 4 segments: `[0, t1) [t1, t2) [t2, t3) [t3, end)`.
 *
 * Segments with no log entries at all are dropped (e.g., an idle gap between
 * fights produces an empty segment that's not worth saving).
 */
export function splitEncounter(enc: Encounter, boundaries: number[]): Encounter[] {
  const end = enc.durationSeconds;
  // Normalize: dedupe, clamp to [0, end), sort ascending.
  const cleaned = [...new Set(boundaries)]
    .filter(t => t > 0 && t < end)
    .sort((a, b) => a - b);
  // Build closed-open windows. Always include [0, end) as a single segment if
  // no boundaries survived.
  const windows: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const t of cleaned) {
    windows.push({ start: cursor, end: t });
    cursor = t;
  }
  windows.push({ start: cursor, end });

  const segments: Encounter[] = [];
  for (const w of windows) {
    const segDur = w.end - w.start;
    if (segDur <= 0) continue;
    const actionLog        = sliceLog(enc.actionLog, w.start, w.end);
    const skillchainLog    = sliceLog(enc.skillchainLog, w.start, w.end);
    const buffLog          = sliceLog(enc.buffLog, w.start, w.end);
    const itemUseLog       = sliceLog(enc.itemUseLog, w.start, w.end);
    const petLog           = sliceLog(enc.petLog, w.start, w.end);
    const battleMsgRaw     = sliceLog(enc.battleMsgRaw ?? null, w.start, w.end);
    const jobExtendedLog   = sliceLog(enc.jobExtendedLog ?? null, w.start, w.end);
    const effectLog        = sliceLog(enc.effectLog ?? null, w.start, w.end);
    const bossHpLog        = sliceLog(enc.bossHpLog, w.start, w.end);
    const partyHpLog       = sliceLog(enc.partyHpLog, w.start, w.end);
    const partyTpLog       = sliceLog(enc.partyTpLog, w.start, w.end);
    const partyMpLog       = sliceLog(enc.partyMpLog, w.start, w.end);
    const positionLog      = sliceLog(enc.positionLog, w.start, w.end);
    const partyPositionLog = sliceLog(enc.partyPositionLog, w.start, w.end);
    const killLog          = sliceLog(enc.killLog, w.start, w.end);
    const deathLog         = sliceLog(enc.deathLog, w.start, w.end);
    const progressionLog   = sliceLog(enc.progressionLog, w.start, w.end);
    const keyItemLog       = sliceLog(enc.keyItemLog, w.start, w.end);
    const gearLog          = sliceLog(enc.gearLog, w.start, w.end);
    const zoneLog          = sliceLog(enc.zoneLog, w.start, w.end);
    const dropLog          = sliceDropLog(enc.dropLog, w.start, w.end);

    // Drop entirely-empty segments (no combat, no events).
    const hasContent =
      (actionLog?.length ?? 0) + (killLog?.length ?? 0) + (deathLog?.length ?? 0) > 0;
    if (!hasContent) continue;

    const enemies = sliceEnemies(enc.enemies, w.start, w.end);

    segments.push({
      id: `${enc.id}_split_${w.start}`,
      source: enc.source,
      segmentation: enc.segmentation,
      zoneId: enc.zoneId,
      zoneName: enc.zoneName,
      zoneLog,
      startTime: enc.startTime + w.start,
      durationSeconds: segDur,

      party: enc.party,
      playerIds: enc.playerIds ?? null,
      enemies,

      actionLog, skillchainLog, buffLog, itemUseLog, petLog, battleMsgRaw, jobExtendedLog, effectLog,
      bossHpLog, partyHpLog, partyTpLog, partyMpLog,
      positionLog, partyPositionLog, killLog, deathLog, dropLog,
      progressionLog, keyItemLog, gearLog,

      // Per-character maxes are segment-invariant - copy through.
      partyMaxHp: enc.partyMaxHp ?? null,
      partyMaxMp: enc.partyMaxMp ?? null,

      // Aggregates we can't honestly slice - null them. Web re-derives stats
      // from action_log on render; points totals can't be attributed per-time.
      progressionStart: null,
      progressionEnd: null,
      currencyStart: null,
      currencyEnd: null,
      points: null,
      combatStats: null,
      enemyReports: null,
      stateSets: enc.stateSets ?? null,

      localCharacter: enc.localCharacter ?? null,
      gearByPlayer: enc.gearByPlayer ?? null,

      content: enc.content,
      notes: enc.notes,
      rawText: undefined,
    });
  }
  return segments;
}

export type SplitMode = 'per-kill' | 'per-zone' | 'idle-gaps' | 'manual';

/**
 * Generate boundary timestamps from an encounter based on a heuristic mode.
 * For 'manual', returns []; the caller supplies boundaries directly.
 */
export function suggestSplits(enc: Encounter, mode: SplitMode, opts?: { gapSeconds?: number }): number[] {
  if (mode === 'per-kill') {
    const kills = (enc.killLog ?? []).map(k => k.elapsed).filter(t => t > 0 && t < enc.durationSeconds);
    // Split AFTER each kill - boundary t means segment [prev, t) ends at t.
    // Sort + dedupe handled by splitEncounter.
    return kills;
  }
  if (mode === 'per-zone') {
    const zones = (enc.zoneLog ?? []).map(z => z.elapsed).filter(t => t > 0 && t < enc.durationSeconds);
    return zones;
  }
  if (mode === 'idle-gaps') {
    const minGap = opts?.gapSeconds ?? 60;
    const al = enc.actionLog ?? [];
    if (al.length < 2) return [];
    const times = al.map(e => e.elapsed).sort((a, b) => a - b);
    const out: number[] = [];
    for (let i = 1; i < times.length; i++) {
      if (times[i] - times[i - 1] >= minGap) {
        // Boundary at the midpoint of the gap (so each new segment starts
        // right before its first action).
        out.push(Math.floor((times[i - 1] + times[i]) / 2));
      }
    }
    return out;
  }
  return [];
}

/**
 * Build a preview of what splitting would produce - segment start/end + the
 * number of kills, the zone name (from zoneLog), and a duration. Doesn't
 * actually slice the logs; just describes the windows.
 */
export type SplitPreviewSegment = {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  killCount: number;
  zone: string | null;
};

export function previewSplit(enc: Encounter, boundaries: number[]): SplitPreviewSegment[] {
  const end = enc.durationSeconds;
  const cleaned = [...new Set(boundaries)].filter(t => t > 0 && t < end).sort((a, b) => a - b);
  const windows: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const t of cleaned) { windows.push({ start: cursor, end: t }); cursor = t; }
  windows.push({ start: cursor, end });

  const killLog = enc.killLog ?? [];
  const zoneLog = enc.zoneLog ?? [];

  return windows.map((w, i) => {
    const killCount = killLog.filter(k => k.elapsed >= w.start && k.elapsed < w.end).length;
    const zoneEntry = [...zoneLog].reverse().find(z => z.elapsed <= w.start);
    return {
      index: i,
      startSec: w.start,
      endSec: w.end,
      durationSec: w.end - w.start,
      killCount,
      zone: zoneEntry?.zoneName ?? enc.zoneName ?? null,
    };
  });
}
