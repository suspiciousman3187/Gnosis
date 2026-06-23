type AnyObj = Record<string, unknown>;

function asArr(v: unknown): AnyObj[] {
  return Array.isArray(v) ? (v as AnyObj[]) : [];
}

function isMobAlsoBossRoleName(name: unknown, knownMobs: Set<string>, knownPlayerLabels: Set<string>): boolean {
  if (typeof name !== 'string' || !name) return false;
  if (knownMobs.has(name)) return false;
  if (knownPlayerLabels.has(name)) return false;
  if (name.indexOf(' ') !== -1) return false;
  if (name.indexOf("'") !== -1) return false;
  if (name.indexOf('-') !== -1) return false;
  return true;
}

function collectOutsiderNames(enc: AnyObj): Set<string> {
  const mobs = new Set<string>();
  for (const e of asArr(enc.enemies)) {
    const n = e.name;
    if (typeof n === 'string') mobs.add(n);
  }

  const playerLabels = new Set<string>();
  const pidMap = (enc.playerIds ?? enc.player_ids) as Record<string, unknown> | undefined;
  if (pidMap && typeof pidMap === 'object' && !Array.isArray(pidMap)) {
    for (const k of Object.keys(pidMap)) playerLabels.add(k);
  }
  for (const p of asArr(enc.party)) {
    const n = p.name;
    if (typeof n === 'string') playerLabels.add(n);
  }

  const out = new Set<string>();
  const add = (n: unknown) => {
    if (isMobAlsoBossRoleName(n, mobs, playerLabels)) out.add(n as string);
  };
  for (const a of asArr(enc.actionLog ?? enc.action_log)) {
    if (a.from === 'boss' || a.actorRole === 'boss') add(a.player);
    for (const t of asArr(a.targets)) {
      if (t.tgtRole === 'boss' || t.tgtRole === 'enemy') add(t.mob);
    }
  }
  return out;
}

function deepRewrite(value: unknown, re: RegExp, map: Record<string, string>): unknown {
  if (typeof value === 'string') {
    if (map[value] != null) return map[value];
    return value.replace(re, m => map[m] ?? m);
  }
  if (Array.isArray(value)) return value.map(v => deepRewrite(v, re, map));
  if (value && typeof value === 'object') {
    const out: AnyObj = {};
    for (const [k, v] of Object.entries(value)) {
      const nk = typeof k === 'string' && map[k] != null ? map[k] : k;
      out[nk] = deepRewrite(v, re, map);
    }
    return out;
  }
  return value;
}

export function scrubOutsiders<T>(payload: T): { data: T; replaced: number } {
  const top = payload as unknown as AnyObj;
  if (!top || typeof top !== 'object') return { data: payload, replaced: 0 };

  const enc = ((top.content as AnyObj | undefined)?.encounter as AnyObj | undefined) ?? top;
  const outsiders = collectOutsiderNames(enc);
  if (outsiders.size === 0) return { data: payload, replaced: 0 };

  const sorted = [...outsiders].sort((a, b) => b.length - a.length);
  const map: Record<string, string> = {};
  sorted.forEach((n, i) => { map[n] = `Outsider ${i + 1}`; });

  const escaped = sorted.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`\\b(${escaped.join('|')})\\b`, 'g');

  const cleaned = deepRewrite(top, re, map) as T;
  return { data: cleaned, replaced: outsiders.size };
}
