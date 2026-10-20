import type { ActionLogEntry } from './types';

const AVATAR_NAMES = new Set<string>([
  'Ifrit', 'Ramuh', 'Garuda', 'Shiva', 'Titan', 'Leviathan',
  'Carbuncle', 'Diabolos', 'Fenrir', 'Atomos', 'Cait Sith', 'Siren',
  'Alexander', 'Odin',
]);

const STANDALONE_PET_NAMES = new Set<string>([
  'Luopan',
]);

export function buildPetNameSet(
  actionLog: readonly ActionLogEntry[] | null | undefined,
): Set<string> {
  const out = new Set<string>();
  if (!actionLog) return out;
  for (const e of actionLog) {
    if (e.actorPetOf && e.player) out.add(e.player);
    if (e.targets) {
      for (const t of e.targets) {
        if (t.petOf && t.mob) out.add(t.mob);
      }
    }
  }
  return out;
}

// Owner-qualified display name for a pet, so same-named EXTERNAL pets (two plain
// "Ramuh"s owned by different summoners) separate by owner instead of collapsing
// into one row. Names that already carry the owner (BST/jug possessive, or an
// -Automaton tag) are left untouched so we never double-prefix.
export function petActorLabel(name: string, owner?: string | null): string {
  if (!owner || !name) return name;
  if (/'s\s/.test(name)) return name;
  if (/-Automaton$/.test(name)) return name;
  return `${owner}'s ${name}`;
}

// Rewrite a single action-log entry's actor/target names to their owner-qualified
// form when the addon tagged them as a pet (actorPetOf / target.petOf). Returns the
// same reference when nothing changed so callers can keep memo identity cheaply.
export function qualifyPetEntry<T extends ActionLogEntry>(e: T): T {
  let out = e;
  if (e.actorPetOf && e.player) {
    const q = petActorLabel(e.player, e.actorPetOf);
    if (q !== e.player) out = { ...out, player: q };
  }
  if (e.targets && e.targets.some(t => t.petOf && t.mob)) {
    out = out === e ? { ...out } : out;
    out.targets = e.targets.map(t => (t.petOf && t.mob) ? { ...t, mob: petActorLabel(t.mob, t.petOf) } : t);
  }
  return out;
}

export function isPetName(
  name: string,
  partyNames?: Iterable<string> | null,
  taggedPetNames?: ReadonlySet<string> | null,
): boolean {
  if (!name) return false;
  if (taggedPetNames && taggedPetNames.has(name)) return true;
  if (AVATAR_NAMES.has(name)) return true;
  if (STANDALONE_PET_NAMES.has(name)) return true;
  const party = partyNames ? (partyNames instanceof Set ? partyNames : new Set(partyNames)) : null;
  if (!party || party.size === 0) return false;
  const poss = name.match(/^(.+?)'s\s/);
  if (poss && party.has(poss[1])) return true;
  const auto = name.match(/^(.+?)-Automaton$/);
  if (auto && party.has(auto[1])) return true;
  return false;
}
