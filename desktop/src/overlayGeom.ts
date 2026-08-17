export type OverlayGeom = { x: number; y: number; w: number; h: number };

const KEY = 'ff_overlay_geom';

export function loadOverlayGeom(): OverlayGeom | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as Partial<OverlayGeom>;
    if (typeof g.x === 'number' && typeof g.y === 'number' && typeof g.w === 'number' && typeof g.h === 'number') {
      return { x: g.x, y: g.y, w: g.w, h: g.h };
    }
  } catch { /* none saved / corrupt */ }
  return null;
}

export function saveOverlayGeom(g: OverlayGeom): void {
  try { localStorage.setItem(KEY, JSON.stringify(g)); } catch { /* quota / private mode */ }
}
