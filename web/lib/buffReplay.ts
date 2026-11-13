import type { BuffLogEntry } from './types';
import { buffLongName } from './statusEffects';

export type BuffReplay = (player: string, elapsed: number) => number[];

// Bard song roots (matched as substrings so "Valor Minuet", "Honor March" etc.
// all land in the song group).
const SONG_WORDS = [
  'Minuet', 'Madrigal', 'March', 'Aria', 'Ballad', 'Minne', 'Paeon', 'Mambo',
  'Etude', 'Carol', 'Threnody', 'Hymnus', 'Lullaby', 'Finale', 'Requiem', 'Elegy',
  'Virelai', 'Scherzo', 'Nocturne', 'Prelude', 'Mazurka', 'Operetta', 'Capriccio',
  'Dirge', 'Gavotte', 'Round', 'Fantasia', 'Pastoral',
];

// Coarse display group so like buffs cluster: enhancing/misc, then songs, then
// rolls, then food. Within a group they stay id-sorted.
function buffGroup(id: number): number {
  const name = buffLongName(id) ?? '';
  if (/roll/i.test(name)) return 2;
  if (SONG_WORDS.some(w => name.includes(w))) return 1;
  if (name === 'Food' || name === 'medicine') return 3;
  return 0;
}

// Order a set of active buff ids for display: by group first, then id.
export function orderBuffs(ids: number[]): number[] {
  return ids.slice().sort((a, b) => {
    const ga = buffGroup(a), gb = buffGroup(b);
    return ga !== gb ? ga - gb : a - b;
  });
}

// Build a replay function: given a player and an elapsed time, return the buff ids
// that were active on that character at that moment, by replaying the gain/wear
// events in buff_log up to (and including) that time. Mirrors the server-side
// replayBuffs used for shared-analytics. Empty array = no buffs; the function is
// cheap to call per row because the per-player event lists are pre-sorted once.
export function buildBuffReplay(buffLog: BuffLogEntry[] | null | undefined): BuffReplay {
  const byTarget = new Map<string, BuffLogEntry[]>();
  for (const e of buffLog ?? []) {
    if (!e || !e.target || e.buffId == null || e.elapsed == null) continue;
    if (e.kind !== 'gain' && e.kind !== 'wear') continue;
    let arr = byTarget.get(e.target);
    if (!arr) { arr = []; byTarget.set(e.target, arr); }
    arr.push(e);
  }
  for (const arr of byTarget.values()) arr.sort((a, b) => a.elapsed - b.elapsed);

  for (const arr of byTarget.values()) {
    const nextGain = new Map<number, number>();
    for (let i = arr.length - 1; i >= 0; i--) {
      const e = arr[i];
      if (e.kind === 'gain') {
        nextGain.set(e.buffId, e.elapsed);
      } else if (e.kind === 'wear') {
        const g = nextGain.get(e.buffId);
        if (g != null && g - e.elapsed <= FLAP_WINDOW_SEC) {
          (e as BuffLogEntry & { _spurious?: boolean })._spurious = true;
        }
      }
    }
  }

  // Cache results per (player, elapsed): the UI calls this twice per action row
  // (sub-row + the ALL/NONE scan) across a hundred-plus rows, and again on every
  // toggle re-render. Without the cache each call replays the whole (15k+) event
  // list, which made the viewer crawl. The cache lives as long as the memoized
  // replay (i.e. until buffLog changes), so toggles become O(1).
  const cache = new Map<string, number[]>();
  return (player, elapsed) => {
    const ck = `${player}|${elapsed}`;
    const hit = cache.get(ck);
    if (hit) return hit;
    const arr = byTarget.get(player);
    if (!arr) { cache.set(ck, EMPTY); return EMPTY; }
    const active = new Set<number>();
    for (const ev of arr) {
      if (ev.elapsed > elapsed) break;
      if ((ev as BuffLogEntry & { _spurious?: boolean })._spurious) continue;
      if (ev.kind === 'gain') active.add(ev.buffId);
      // A wear logged at the action's OWN tick means the buff was consumed by/at
      // that action (e.g. Climactic Flourish eaten by the weaponskill) - it WAS up
      // for the action, so only a wear strictly before the action removes it.
      else if (ev.elapsed < elapsed) active.delete(ev.buffId);
    }
    // Sort by id so like buffs group together instead of appearing in the order
    // they were gained. FFXI lays status ids out by type, so this clusters songs,
    // rolls, aftermath, etc. The category pass enforces the big groups.
    const out = active.size > 0 ? orderBuffs([...active]) : EMPTY;
    cache.set(ck, out);
    return out;
  };
}

const EMPTY: number[] = [];

const FLAP_WINDOW_SEC = 3;
