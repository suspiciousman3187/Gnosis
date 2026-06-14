import type { ActionLogEntry, ActionLogTarget } from './types';

export interface DeathEvent {
  elapsed: number;
  kind: 'incoming' | 'outgoing' | 'hp' | 'death';
  actor?: string;     // who acted (enemy for incoming, target for outgoing)
  action?: string;    // ability/spell/attack name
  type?: string;      // action type (auto/ws/spell/…)
  damage?: number;
  result?: string;
  hpp?: number;       // for hp samples
  fatal?: boolean;    // the killing blow
}

export interface DeathReportRow {
  player: string;
  elapsed: number;
  area?: string;
  killedBy?: string;      // actor of the fatal hit
  killingBlow?: string;   // its action name
  killingDamage?: number; // its damage
  events: DeathEvent[];   // time-ordered lead-up (oldest → death)
  leadupDamage: number;
  leadupHits: number;
  leadupBySource: { actor: string; damage: number; hits: number }[];
}

type DeathLike = { player?: string; elapsed?: number; area?: string };
type HpLike = { player: string; elapsed: number; hpp: number };

// How many seconds of lead-up to include before the death.
const WINDOW = 20;

function targetsOf(e: ActionLogEntry): ActionLogTarget[] {
  if (Array.isArray(e.targets)) return e.targets;
  if (e.mob) return [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' }];
  return [];
}

export function buildDeathReports(
  deathLog: DeathLike[] | null | undefined,
  actionLog: ActionLogEntry[] | null | undefined,
  partyHpLog: HpLike[] | null | undefined,
): DeathReportRow[] {
  const deaths = (deathLog ?? []).filter((d): d is DeathLike => !!d.player && typeof d.elapsed === 'number');
  const log = actionLog ?? [];
  const hp = partyHpLog ?? [];

  return deaths.map(d => {
    const player = d.player as string;
    const at = d.elapsed as number;
    const lo = at - WINDOW;
    const hi = at + 1;
    const events: DeathEvent[] = [];
    let killedBy: string | undefined, killingBlow: string | undefined, killingDamage: number | undefined;
    let killIdx = -1, killTime = -Infinity;
    let leadupDamage = 0;
    let leadupHits = 0;
    const sourceMap = new Map<string, { damage: number; hits: number }>();

    for (const e of log) {
      if (e.elapsed < lo || e.elapsed > hi) continue;
      if (e.phase === 'start') continue;
      if (e.from === 'boss' || e.from === 'enemy') {
        for (const t of targetsOf(e)) {
          if (t.mob !== player) continue;
          events.push({ elapsed: e.elapsed, kind: 'incoming', actor: e.player, action: e.name, type: e.type, damage: t.damage, result: t.result });
          const dmg = t.damage ?? 0;
          if (dmg > 0 && e.elapsed >= lo && e.elapsed <= at) {
            leadupDamage += dmg;
            leadupHits += 1;
            const src = sourceMap.get(e.player) ?? { damage: 0, hits: 0 };
            src.damage += dmg;
            src.hits += 1;
            sourceMap.set(e.player, src);
          }
          if (dmg > 0 && e.elapsed <= at && e.elapsed >= killTime) {
            killTime = e.elapsed; killIdx = events.length - 1;
            killedBy = e.player; killingBlow = e.name; killingDamage = dmg;
          }
        }
      } else if (e.player === player) {
        // the dying player's own actions, for context
        const tgt = targetsOf(e)[0];
        events.push({ elapsed: e.elapsed, kind: 'outgoing', action: e.name, type: e.type, actor: tgt?.mob });
      }
    }
    if (killIdx >= 0) events[killIdx].fatal = true;

    for (const h of hp) {
      if (h.player === player && h.elapsed >= lo && h.elapsed <= hi) {
        events.push({ elapsed: h.elapsed, kind: 'hp', hpp: h.hpp });
      }
    }
    events.push({ elapsed: at, kind: 'death' });
    // Stable order: by time, then hp samples first within a second, death last.
    const rank = (k: DeathEvent['kind']) => (k === 'death' ? 3 : k === 'hp' ? 0 : 1);
    events.sort((a, b) => a.elapsed - b.elapsed || rank(a.kind) - rank(b.kind));

    const leadupBySource = Array.from(sourceMap.entries())
      .map(([actor, v]) => ({ actor, damage: v.damage, hits: v.hits }))
      .sort((a, b) => b.damage - a.damage);

    return { player, elapsed: at, area: d.area, killedBy, killingBlow, killingDamage, events, leadupDamage, leadupHits, leadupBySource };
  });
}
