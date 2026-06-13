import type {
  ActionLogEntry,
  ActionLogTarget,
  BuffLogEntry,
  KillLogEntry,
  PartyHpEntry,
  PartyMember,
  PetLogEntry,
} from './types';

export interface IdNameMapSources {
  playerIds?: Record<string, number> | null;
  party?: PartyMember[] | null;
  actionLog?: ActionLogEntry[] | null;
  killLog?: KillLogEntry[] | null;
  partyHpLog?: PartyHpEntry[] | null;
  buffLog?: BuffLogEntry[] | null;
  petLog?: PetLogEntry[] | null;
}

export function buildIdNameMap(src: IdNameMapSources): Map<number, string> {
  const map = new Map<number, string>();
  const put = (id: number | undefined | null, name: string | undefined | null) => {
    if (!id || id <= 0 || !name) return;
    if (!map.has(id)) map.set(id, name);
  };

  if (src.playerIds) {
    for (const [name, id] of Object.entries(src.playerIds)) put(id, name);
  }
  if (Array.isArray(src.party)) {
    for (const m of src.party) put(m.id, m.name);
  }
  if (Array.isArray(src.partyHpLog)) {
    for (const r of src.partyHpLog) put(r.playerId, r.player);
  }
  if (Array.isArray(src.killLog)) {
    for (const k of src.killLog) put(k.id, k.name);
  }
  if (Array.isArray(src.buffLog)) {
    for (const b of src.buffLog) put(b.targetId, b.target);
  }
  if (Array.isArray(src.actionLog)) {
    for (const a of src.actionLog) {
      put(a.playerId, a.player);
      const ts = (a.targets ?? []) as ActionLogTarget[];
      for (const t of ts) put(t.id, t.mob);
    }
  }
  return map;
}

export function resolveName(map: Map<number, string>, id: number | undefined | null): string | null {
  if (!id || id <= 0) return null;
  return map.get(id) ?? null;
}
