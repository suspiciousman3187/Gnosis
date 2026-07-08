type RawSortie = Record<string, unknown> & { sortieStartTime?: number };

function shiftElapsed(node: unknown, delta: number): void {
  if (Array.isArray(node)) {
    for (const item of node) shiftElapsed(item, delta);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if ((k === 'elapsed' || k === 'fightStartElapsed') && typeof v === 'number') {
        obj[k] = v + delta;
      } else {
        shiftElapsed(v, delta);
      }
    }
  }
}

const SUM_DICT_KEYS = new Set(['areaTimes', 'points', 'drops']);
const UNION_ARRAY_KEYS = new Set(['defeatedBosses']);

function sortByElapsed(arr: unknown[]): unknown[] {
  const hasElapsed = arr.some(e => e && typeof e === 'object' && typeof (e as Record<string, unknown>).elapsed === 'number');
  if (!hasElapsed) return arr;
  return [...arr].sort((a, b) => {
    const ea = (a as Record<string, unknown>)?.elapsed;
    const eb = (b as Record<string, unknown>)?.elapsed;
    return (typeof ea === 'number' ? ea : 0) - (typeof eb === 'number' ? eb : 0);
  });
}

function mergeSlices(base: RawSortie, later: RawSortie): RawSortie {
  const out: RawSortie = { ...base };
  for (const [k, v] of Object.entries(later)) {
    const b = out[k];
    if (v === null || v === undefined) continue;
    if (b === null || b === undefined) { out[k] = v; continue; }
    if (k === 'gallimaufry' && typeof b === 'number' && typeof v === 'number') { out[k] = b + v; continue; }
    if (k === 'oldCasePlus1' && typeof b === 'number' && typeof v === 'number') { out[k] = Math.max(b, v); continue; }
    if (SUM_DICT_KEYS.has(k) && typeof b === 'object' && typeof v === 'object' && !Array.isArray(b) && !Array.isArray(v)) {
      const merged: Record<string, unknown> = { ...(b as Record<string, unknown>) };
      for (const [dk, dv] of Object.entries(v as Record<string, unknown>)) {
        const bv = merged[dk];
        merged[dk] = (typeof bv === 'number' && typeof dv === 'number') ? bv + dv : (bv ?? dv);
      }
      out[k] = merged;
      continue;
    }
    if (UNION_ARRAY_KEYS.has(k) && Array.isArray(b) && Array.isArray(v)) {
      out[k] = [...new Set([...(b as unknown[]), ...(v as unknown[])])];
      continue;
    }
    if (k === 'party' && Array.isArray(b) && Array.isArray(v)) {
      const seen = new Set((b as { id?: number; name?: string }[]).map(m => m.id ?? m.name));
      const extra = (v as { id?: number; name?: string }[]).filter(m => !seen.has(m.id ?? m.name));
      out[k] = [...(b as unknown[]), ...extra];
      continue;
    }
    if (Array.isArray(b) && Array.isArray(v)) {
      out[k] = sortByElapsed([...(b as unknown[]), ...(v as unknown[])]);
      continue;
    }
    if (typeof b === 'object' && typeof v === 'object' && !Array.isArray(b) && !Array.isArray(v)) {
      out[k] = { ...(v as Record<string, unknown>), ...(b as Record<string, unknown>) };
      continue;
    }
  }
  return out;
}

export function mergeRawSortieSlices(texts: string[]): string {
  const parsed = texts.map(t => JSON.parse(t) as RawSortie);
  const valid = parsed.filter(p => typeof p.sortieStartTime === 'number');
  if (valid.length === 0) return texts[0];
  if (valid.length === 1) return JSON.stringify(valid[0]);
  const entries = valid.map(p => ({ p, start: p.sortieStartTime as number }));
  const mergedStart = Math.min(...entries.map(e => e.start));
  for (const e of entries) {
    const delta = e.start - mergedStart;
    if (delta > 0) {
      shiftElapsed(e.p, delta);
      e.p.sortieStartTime = mergedStart;
    }
  }
  const sorted = [...entries].sort((a, b) => a.start - b.start);
  let merged = sorted[0].p;
  for (let i = 1; i < sorted.length; i++) merged = mergeSlices(merged, sorted[i].p);
  return JSON.stringify(merged);
}
