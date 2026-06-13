import type { GearLogEntry, CharacterGear } from './types';

const TOL = 1; // seconds

export interface GearIndex {
  lookup: (player: string, name: string, elapsed: number) => GearLogEntry | null;
  changed: (player: string, name: string, elapsed: number) => boolean;
  any: boolean;
}

const sig = (g: GearLogEntry['gear']) => JSON.stringify(g);

// Flatten the flat gearLog plus any merged multibox per-character logs.
function collect(gearLog?: GearLogEntry[] | null, gearByPlayer?: Record<string, CharacterGear> | null): GearLogEntry[] {
  const out: GearLogEntry[] = [];
  if (Array.isArray(gearLog)) out.push(...gearLog);
  if (gearByPlayer) for (const g of Object.values(gearByPlayer)) if (Array.isArray(g.gearLog)) out.push(...g.gearLog);
  return out;
}

export function makeGearIndex(gearLog?: GearLogEntry[] | null, gearByPlayer?: Record<string, CharacterGear> | null): GearIndex {
  const all = collect(gearLog, gearByPlayer);
  // player|name -> casts sorted by elapsed
  const byPK = new Map<string, GearLogEntry[]>();
  for (const g of all) {
    if (!g || !g.player || !g.name) continue;
    const pk = `${g.player}|${g.name}`;
    (byPK.get(pk) ?? byPK.set(pk, []).get(pk)!).push(g);
  }
  const changedSet = new Set<string>(); // player|name|elapsed of casts whose set changed
  for (const [, casts] of byPK) {
    casts.sort((a, b) => a.elapsed - b.elapsed);
    let prev: string | null = null;
    for (const c of casts) {
      const s = sig(c.gear);
      if (prev !== null && prev !== s) changedSet.add(`${c.player}|${c.name}|${c.elapsed}`);
      prev = s;
    }
  }
  const nearest = (player: string, name: string, elapsed: number): GearLogEntry | null => {
    const casts = byPK.get(`${player}|${name}`);
    if (!casts) return null;
    let best: GearLogEntry | null = null, bestD = Infinity;
    for (const c of casts) {
      const d = Math.abs(c.elapsed - elapsed);
      if (d <= TOL && d < bestD) { best = c; bestD = d; }
    }
    return best;
  };
  return {
    lookup: nearest,
    changed: (player, name, elapsed) => {
      const c = nearest(player, name, elapsed);
      return c ? changedSet.has(`${c.player}|${c.name}|${c.elapsed}`) : false;
    },
    any: all.length > 0,
  };
}
