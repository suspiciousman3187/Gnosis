
import RAW_MAPDATA from './zoneMapdata.json';

export interface ZoneMapEntry {
  zone_id: number;
  area_type: number;       // pixel-per-yalm scale (0.1 … 0.8 typical)
  map_level: number;       // 0..N - multi-floor zones use 1+
  x: number;               // pixel-space offset, east-west
  y: number;               // pixel-space offset, north-south
  map_file: string;        // e.g. "09_15.gif" - served from /maps/zones/<map_file>
  map_bounds: {
    min_x: number; max_x: number;
    min_y: number; max_y: number;  // height (LE.Y) - drives floor selection
    min_z: number; max_z: number;
  };
}

const MAPDATA = RAW_MAPDATA as ZoneMapEntry[];

// Pre-index by zone for O(1) lookups. The 290 KB JSON is loaded once at
// module init - ~870 rows so the bucket is tiny per zone (1-30 entries).
const BY_ZONE = new Map<number, ZoneMapEntry[]>();
for (const m of MAPDATA) {
  let bucket = BY_ZONE.get(m.zone_id);
  if (!bucket) { bucket = []; BY_ZONE.set(m.zone_id, bucket); }
  bucket.push(m);
}
for (const bucket of BY_ZONE.values()) bucket.sort((a, b) => a.map_level - b.map_level);

export function mapsForZone(zoneId: number | null | undefined): ZoneMapEntry[] {
  if (zoneId == null) return [];
  return BY_ZONE.get(zoneId) ?? [];
}

/** Public URL for a map image. Assets live under /maps/zones/ (gitignored;
 *  ~176MB of LE bitmaps copied once during repo setup, not bundled into JS). */
export function mapImageUrl(entry: ZoneMapEntry): string {
  return `/maps/zones/${entry.map_file}`;
}

export function pickMapFor(
  zoneId: number | null | undefined,
  sx: number, sy: number, sz: number,
): ZoneMapEntry | null {
  const maps = mapsForZone(zoneId);
  if (maps.length === 0) return null;
  if (maps.length === 1) return maps[0];
  for (const m of maps) {
    const b = m.map_bounds;
    if (sx < b.min_x || sx > b.max_x) continue;
    if (sz < b.min_y || sz > b.max_y) continue; // height (Gnosis.z = LE.Y)
    if (sy < b.min_z || sy > b.max_z) continue; // NS    (Gnosis.y = LE.Z)
    return m;
  }
  return maps[0];
}

export function dominantMapFor(
  zoneId: number | null | undefined,
  samples: Array<{ x: number; y: number; z: number }>,
): ZoneMapEntry | null {
  const maps = mapsForZone(zoneId);
  if (maps.length === 0) return null;
  if (maps.length === 1 || samples.length === 0) return maps[0];
  const tally = new Map<number, number>();
  for (const s of samples) {
    const m = pickMapFor(zoneId, s.x, s.y, s.z);
    if (!m) continue;
    tally.set(m.map_level, (tally.get(m.map_level) ?? 0) + 1);
  }
  let bestLevel = maps[0].map_level;
  let bestCount = -1;
  for (const [lvl, n] of tally) if (n > bestCount) { bestCount = n; bestLevel = lvl; }
  return maps.find(m => m.map_level === bestLevel) ?? maps[0];
}

export function projectToMap(
  entry: ZoneMapEntry,
  sx: number, sy: number,
): { fx: number; fy: number } {
  const px512 = (sx * entry.area_type + entry.x) *  2;
  const py512 = (sy * entry.area_type - entry.y) * -2;
  const clamp = (n: number) => Math.min(1, Math.max(0, n / 512));
  return { fx: clamp(px512), fy: clamp(py512) };
}
