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
