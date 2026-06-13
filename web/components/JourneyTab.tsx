'use client';

import { useState, useMemo, useEffect, useRef, type MouseEvent } from 'react';
import type {
  PositionLogEntry,
  KillLogEntry,
  ChestLogEntry,
  DeathEntry,
  BossReport,
} from '@/lib/types';
import { resolveChestId } from '@/lib/chestIds';


interface MapTransform {
  imageSrc: string;
  imageSize: number;
  scale: number;
  worldOriginX: number;
  worldOriginY: number;
}

// LE mapdata.json zone 133 level 3: area_type=0.2, x=234,  y=103.5
const GROUND_MAP: MapTransform = {
  imageSrc:     '/maps/sortie_ground.png',
  imageSize:    2048,
  scale:        1.6,
  worldOriginX: -1170,
  worldOriginY: 517.5,
};

// LE mapdata.json zone 133 level 4: area_type=0.2, x=15.5, y=128
const BASEMENT_MAP: MapTransform = {
  imageSrc:     '/maps/sortie_basement.png',
  imageSize:    2048,
  scale:        1.6,
  worldOriginX: -77.5,
  worldOriginY: 640,
};

function worldToPixel(world: { x: number; y: number }, t: MapTransform) {
  return {
    px: (world.x - t.worldOriginX) * t.scale,
    py: (t.worldOriginY - world.y) * t.scale,
  };
}

function pickMap(sample: { z: number }): 'ground' | 'basement' {
  return sample.z > 0 ? 'basement' : 'ground';
}

function fmtElapsed(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

const SPEEDS = [1, 3, 5, 10, 30, 50] as const;
const SORTIE_DURATION = 3600;  // Sortie's in-game clock: starts at 60:00, counts down
const TRAIL_FADE_SECONDS = 30;  // recent trail visible; older points fade out

interface JourneyTabProps {
  positionLog:  PositionLogEntry[] | null;
  killLog?:     KillLogEntry[] | null;
  chestLog?:    ChestLogEntry[] | null;
  deathLog?:    DeathEntry[] | null;
  bossReports?: Record<string, BossReport> | null;
}

type EventKind = 'kill' | 'miniboss' | 'chest' | 'death' | 'boss';
interface EventMarker {
  kind: EventKind;
  label: string;
  sublabel?: string;
  elapsed: number;
  x: number; y: number; z: number;
}

const EVENT_STYLE: Record<EventKind, { color: string; r: number; ringColor?: string }> = {
  kill:     { color: '#ef4444', r: 16 },                            // red triangle
  miniboss: { color: '#f97316', r: 22 },                            // orange star
  chest:    { color: '#2dd4bf', r: 19 },                            // teal diamond
  death:    { color: '#1f2937', r: 24, ringColor: '#f87171' },      // dark + red ring
  boss:     { color: '#a855f7', r: 28, ringColor: '#c084fc' },      // purple + lighter ring
};

// Sortie roaming minibosses - promoted out of the regular kill log so they
// get their own star marker + filter.
const MINIBOSS_NAMES = new Set([
  'Cachaemic Bhoot', 'Abject Obdella', 'Demisang Deleterious', 'Biune Porxie',
  'Gyvewrapped Naraka', 'Fetid Ixion', 'Haughty Tulittia', 'Esurient Botulus',
].map(n => n.toLowerCase()));

const SECTOR_BOSS_NAMES = new Set([
  'Ghatjot', 'Leshonn', 'Skomora', 'Degei',
  'Dhartok', 'Gartell', 'Triboulex', 'Aita',
].map(n => n.toLowerCase()));

function isOffMapRoom(area: string): boolean {
  return /^boss [a-h]$/i.test(area) || area.toLowerCase() === 'aminon';
}

// Boss arenas A-H map to fixed sector bosses; Aminon room → Aminon. Used so
// the Journey banner can read "FIGHTING: <boss>" while inside an arena.
const BOSS_ROOM_NAMES: Record<string, string> = {
  a: 'Ghatjot', b: 'Leshonn', c: 'Skomora', d: 'Degei',
  e: 'Dhartok', f: 'Gartell', g: 'Triboulex', h: 'Aita',
};
function roomBossName(area: string): string | null {
  if (area.toLowerCase() === 'aminon') return 'Aminon';
  const m = /^boss ([a-h])$/i.exec(area);
  return m ? BOSS_ROOM_NAMES[m[1].toLowerCase()] : null;
}

// 5-pointed star polygon points centered at (cx, cy), outer radius r.
function starPoints(cx: number, cy: number, r: number): string {
  const inner = r * 0.5;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const ang = (-90 + i * 36) * (Math.PI / 180);
    const rad = i % 2 === 0 ? r : inner;
    pts.push(`${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`);
  }
  return pts.join(' ');
}

// Pointy-top hexagon points centered at (cx, cy), circumradius r.
function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = (-90 + i * 60) * (Math.PI / 180);
    pts.push(`${cx + r * Math.cos(ang)},${cy + r * Math.sin(ang)}`);
  }
  return pts.join(' ');
}

export default function JourneyTab({
  positionLog, killLog, chestLog, deathLog, bossReports,
}: JourneyTabProps) {
  const samples = positionLog ?? [];
  const sortedSamples = useMemo(
    () => [...samples].sort((a, b) => a.elapsed - b.elapsed),
    [samples],
  );

  const plotSamples = useMemo(() => {
    const out = sortedSamples.map(s => ({ ...s }));
    const n = out.length;
    type Pos = { x: number; y: number; z: number };

    const ROOM_LAG_DIST = 50; // yalms; lag samples barely move from room coords
    const offmap = new Array<boolean>(n).fill(false);
    let roomPos: Pos | null = null;
    for (let i = 0; i < n; i++) {
      if (isOffMapRoom(out[i].area)) {
        offmap[i] = true;
        roomPos = { x: out[i].x, y: out[i].y, z: out[i].z };
      } else if (roomPos) {
        const dx = out[i].x - roomPos.x, dy = out[i].y - roomPos.y;
        if (dx * dx + dy * dy < ROOM_LAG_DIST * ROOM_LAG_DIST) {
          offmap[i] = true; // position still stuck on room coords
          roomPos = { x: out[i].x, y: out[i].y, z: out[i].z };
        } else {
          roomPos = null;   // snapped to the gadget - block truly ended
        }
      }
    }

    const exitAnchor: (Pos | null)[] = new Array(n).fill(null);
    let nextOnMap: Pos | null = null;
    for (let i = n - 1; i >= 0; i--) {
      if (offmap[i]) exitAnchor[i] = nextOnMap;
      else nextOnMap = { x: out[i].x, y: out[i].y, z: out[i].z };
    }
    let prevOnMap: Pos | null = null;
    for (let i = 0; i < n; i++) {
      if (offmap[i]) {
        const a = exitAnchor[i] ?? prevOnMap;
        if (a) { out[i].x = a.x; out[i].y = a.y; out[i].z = a.z; }
      } else {
        prevOnMap = { x: out[i].x, y: out[i].y, z: out[i].z };
      }
    }
    return out;
  }, [sortedSamples]);

  const minElapsed = plotSamples[0]?.elapsed ?? 0;
  const maxElapsed = plotSamples[plotSamples.length - 1]?.elapsed ?? 1;

  function interpAt(elapsed: number): { x: number; y: number; z: number } | null {
    if (plotSamples.length === 0) return null;
    if (elapsed <= plotSamples[0].elapsed) return plotSamples[0];
    if (elapsed >= plotSamples[plotSamples.length - 1].elapsed) return plotSamples[plotSamples.length - 1];
    // Linear scan; arrays are small (≤3600 entries for a 1h run) and called rarely.
    for (let i = 0; i < plotSamples.length - 1; i++) {
      const a = plotSamples[i], b = plotSamples[i + 1];
      if (elapsed >= a.elapsed && elapsed <= b.elapsed) {
        // Don't blend across warps - pick the closer endpoint.
        const dx = b.x - a.x, dy = b.y - a.y;
        if (dx * dx + dy * dy > 100 * 100) {
          return elapsed - a.elapsed < b.elapsed - elapsed ? a : b;
        }
        const span = b.elapsed - a.elapsed;
        const t = span > 0 ? (elapsed - a.elapsed) / span : 0;
        return { x: a.x + dx * t, y: a.y + dy * t, z: a.z + (b.z - a.z) * t };
      }
    }
    return null;
  }

  const eventMarkers = useMemo<EventMarker[]>(() => {
    const out: EventMarker[] = [];
    const push = (kind: EventKind, label: string, elapsed: number, sublabel?: string) => {
      const pos = interpAt(elapsed);
      if (!pos) return;
      out.push({ kind, label, sublabel, elapsed, ...pos });
    };
    for (const k of killLog ?? []) {
      // Luopan is the GEO pet bubble - its expiry registers as a "kill" but
      // it's not a real mob, so don't pin it.
      if (/luopan/i.test(k.name)) continue;
      const lname = k.name.toLowerCase();
      // Sector bosses are sourced from bossReports as BOSS markers; skip
      // them here so they don't also show up as a duplicate MOB.
      if (SECTOR_BOSS_NAMES.has(lname)) continue;
      const kind: EventKind = MINIBOSS_NAMES.has(lname) ? 'miniboss' : 'kill';
      push(kind, k.name, k.elapsed, k.area);
    }
    for (const c of chestLog ?? []) {
      const resolved = c.npcId != null ? resolveChestId(c.npcId) : null;
      const type = c.type ?? resolved?.type ?? 'Chest';
      const name = c.name ?? resolved?.name ?? '';
      push('chest', `${type}${name ? ` ${name}` : ''}`, c.elapsed, c.area);
    }
    for (const d of deathLog ?? [])   push('death', `Death: ${d.player}`, d.elapsed, d.area);
    for (const [bossName, report] of Object.entries(bossReports ?? {})) {
      if (report.fightStartElapsed == null) continue;
      const elapsed = report.killed
        ? report.fightStartElapsed + (report.fightDurationSeconds || 0)
        : report.fightStartElapsed;
      push('boss', `${bossName} fight`, elapsed,
           report.killed ? `killed in ${Math.round(report.fightDurationSeconds)}s` : 'engaged');
    }
    return out.sort((a, b) => a.elapsed - b.elapsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [killLog, chestLog, deathLog, bossReports, plotSamples]);

  // Playback state
  const [currentT, setCurrentT] = useState(minElapsed);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(10);
  // Manual map override; null means auto-pick based on current sample's z
  const [mapOverride, setMapOverride] = useState<'ground' | 'basement' | null>(null);
  // Map dim level 0..0.75 - darkens the background image so markers pop.
  // Starts slightly dimmed so markers are legible without any interaction.
  const [dim, setDim] = useState(0.2);
  const [mapSize, setMapSize] = useState<number>(() => {
    if (typeof window === 'undefined') return 55;
    const v = parseFloat(window.localStorage.getItem('ff_map_size') ?? '');
    return Number.isFinite(v) && v >= 30 && v <= 80 ? v : 55;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('ff_map_size', String(mapSize));
  }, [mapSize]);
  // Custom marker tooltip - position is in container-relative pixels.
  const mapBoxRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState<{ ev: EventMarker; left: number; top: number; boxW: number } | null>(null);
  const onMarkerHover = (ev: EventMarker, e: MouseEvent) => {
    const box = mapBoxRef.current?.getBoundingClientRect();
    if (!box) return;
    setHovered({ ev, left: e.clientX - box.left, top: e.clientY - box.top, boxW: box.width });
  };
  // Which event kinds are shown on the map + in the list. All on by default.
  const [enabledKinds, setEnabledKinds] = useState<Set<EventKind>>(
    () => new Set<EventKind>(['kill', 'miniboss', 'chest', 'death', 'boss']),
  );
  const toggleKind = (k: EventKind) =>
    setEnabledKinds(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });

  // requestAnimationFrame-driven scrubber while playing
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  useEffect(() => {
    if (!isPlaying) return;
    lastTickRef.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setCurrentT(prev => {
        const next = prev + dt * speed;
        if (next >= maxElapsed) {
          setIsPlaying(false);
          return maxElapsed;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, speed, maxElapsed]);

  if (plotSamples.length === 0) {
    return (
      <div className="bg-row-even border border-white/10 rounded-xl p-8 text-center text-gray-400">
        No position data recorded for this run.
      </div>
    );
  }

  // Find the latest sample with elapsed <= currentT (linear scan; samples are sorted
  // and runs are bounded, so this is plenty fast).
  let currentIdx = 0;
  for (let i = 0; i < plotSamples.length; i++) {
    if (plotSamples[i].elapsed <= currentT) currentIdx = i;
    else break;
  }
  const currentSample = plotSamples[currentIdx];

  let nextAreaTransition: { nextArea: string; atElapsed: number } | null = null;
  for (let i = currentIdx + 1; i < plotSamples.length; i++) {
    if (plotSamples[i].area !== currentSample.area) {
      nextAreaTransition = { nextArea: plotSamples[i].area, atElapsed: plotSamples[i].elapsed };
      break;
    }
  }
  let areaStartIdx = currentIdx;
  while (areaStartIdx > 0 && plotSamples[areaStartIdx - 1].area === currentSample.area) {
    areaStartIdx--;
  }
  const timeSpentInArea = Math.max(0, currentT - plotSamples[areaStartIdx].elapsed);

  const currentEvent: { prefix: string; color: string; names: string[] }[] | null = (() => {
    const mob: string[] = [], miniboss: string[] = [], boss: string[] = [];
    const item: string[] = [], death: string[] = [];
    const LOOK_BACK = 12, LOOK_AHEAD = 2;
    for (const [bossName, report] of Object.entries(bossReports ?? {})) {
      if (!report.killed || report.fightStartElapsed == null) continue;
      const killAt = report.fightStartElapsed + (report.fightDurationSeconds || 0);
      if (currentT >= killAt && currentT <= killAt + LOOK_BACK) boss.push(bossName);
    }
    for (const e of eventMarkers) {
      if (e.elapsed < currentT - LOOK_BACK || e.elapsed > currentT + LOOK_AHEAD) continue;
      if (e.kind === 'kill') mob.push(e.label);
      else if (e.kind === 'miniboss') miniboss.push(e.label);
      else if (e.kind === 'chest') item.push(e.label);
      else if (e.kind === 'death') death.push(e.label.replace(/^Death:\s*/i, ''));
    }
    const dedupeCap = (arr: string[]) => {
      const uniq = [...new Set(arr)];
      return uniq.length > 5 ? [...uniq.slice(0, 5), '...'] : uniq;
    };
    const groups: { prefix: string; color: string; names: string[] }[] = [];
    const fightingBoss = roomBossName(currentSample.area);
    if (fightingBoss) {
      const rep = bossReports?.[fightingBoss];
      const killElapsed = rep && rep.killed && rep.fightStartElapsed != null
        ? rep.fightStartElapsed + (rep.fightDurationSeconds || 0)
        : null;
      // Once this boss is killed, never show FIGHTING for it again this run -
      // the outcome is determined, so any later time in the arena is post-kill.
      const bossAlreadyKilled = killElapsed != null && currentT >= killElapsed;
      if (!bossAlreadyKilled) groups.push({ prefix: 'FIGHTING', color: EVENT_STYLE.boss.color, names: [fightingBoss] });
    }
    if (mob.length)      groups.push({ prefix: 'MOB KILL',      color: EVENT_STYLE.kill.color,     names: dedupeCap(mob) });
    if (miniboss.length) groups.push({ prefix: 'MINIBOSS KILL', color: EVENT_STYLE.miniboss.color, names: dedupeCap(miniboss) });
    if (boss.length)     groups.push({ prefix: 'BOSS KILL',     color: EVENT_STYLE.boss.color,     names: dedupeCap(boss) });
    if (item.length)     groups.push({ prefix: 'CHEST SPAWN',   color: EVENT_STYLE.chest.color,    names: dedupeCap(item) });
    if (death.length)    groups.push({ prefix: 'DEATH',    color: EVENT_STYLE.death.ringColor!, names: dedupeCap(death) });
    return groups.length ? groups : null;
  })();

  // Auto-pick the map based on the current sample's sub-area. User can override.
  const autoMap = pickMap(currentSample);
  const view: 'ground' | 'basement' = mapOverride ?? autoMap;
  const transform = view === 'ground' ? GROUND_MAP : BASEMENT_MAP;

  const FLOOR_GAP_SECONDS = 5; // > this between same-floor samples = cross-floor excursion
  const trailSamples = plotSamples.filter(s => pickMap(s) === view && s.elapsed <= currentT);
  const segments: Array<{
    x1: number; y1: number; x2: number; y2: number; opacity: number; key: number;
  }> = [];
  for (let i = 0; i < trailSamples.length - 1; i++) {
    const a = trailSamples[i];
    const b = trailSamples[i + 1];
    if (b.elapsed - a.elapsed > FLOOR_GAP_SECONDS) continue;
    const age = currentT - b.elapsed;
    const fade = Math.max(0, 1 - age / TRAIL_FADE_SECONDS);
    if (fade <= 0.02) continue;
    const p1 = worldToPixel(a, transform);
    const p2 = worldToPixel(b, transform);
    segments.push({ x1: p1.px, y1: p1.py, x2: p2.px, y2: p2.py, opacity: fade, key: i });
  }

  const showDot = pickMap(currentSample) === view || mapOverride !== null;
  const nextSample = plotSamples[currentIdx + 1];
  const dotPos = (() => {
    if (!nextSample) return worldToPixel(currentSample, transform);
    const dx = nextSample.x - currentSample.x;
    const dy = nextSample.y - currentSample.y;
    const sameMap = pickMap(nextSample) === pickMap(currentSample);
    if (!sameMap) return worldToPixel(currentSample, transform);
    const span = nextSample.elapsed - currentSample.elapsed;
    const t = span > 0 ? Math.min(1, Math.max(0, (currentT - currentSample.elapsed) / span)) : 0;
    return worldToPixel(
      { x: currentSample.x + dx * t, y: currentSample.y + dy * t },
      transform,
    );
  })();

  return (
    <div className="space-y-2">
      {/* UNIFIED MAP PANEL - toolbar header is now physically attached to
          the map below it (one rounded container, no gap). Mirrors the
          chrome the generic EncounterMapTab uses, so Sortie and generic
          encounters present the same layout: floor/level chips on the
          left, the Brightness + Size sliders on the right, map below. */}
      <div className="bg-row-even border border-white/10 rounded-xl overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-white/10 flex-wrap">
          <div className="flex items-stretch -my-1">
            <button
              onClick={() => setMapOverride(mapOverride === 'ground' ? null : 'ground')}
              className={`relative px-4 py-2 text-sm font-medium transition-colors ${
                view === 'ground' ? 'text-accent' : 'text-gray-300 hover:text-white'
              }`}
            >
              Ground Floor
              {view === 'ground' && <span className="absolute inset-x-2 -bottom-2 h-0.5 rounded-full bg-accent" />}
            </button>
            <button
              onClick={() => setMapOverride(mapOverride === 'basement' ? null : 'basement')}
              className={`relative px-4 py-2 text-sm font-medium transition-colors ${
                view === 'basement' ? 'text-accent' : 'text-gray-300 hover:text-white'
              }`}
            >
              Basement
              {view === 'basement' && <span className="absolute inset-x-2 -bottom-2 h-0.5 rounded-full bg-accent" />}
            </button>
            {mapOverride && (
              <button
                onClick={() => setMapOverride(null)}
                className="self-center ml-1 px-2.5 py-1 text-xs font-medium rounded-md text-gray-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                data-tooltip="Resume auto-switching between maps based on the current Sortie area"
              >
                auto
              </button>
            )}
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-400 shrink-0">Brightness</span>
              <input
                type="range"
                min={0.25} max={1} step={0.05}
                value={1 - dim}
                onChange={e => setDim(1 - parseFloat(e.target.value))}
                className="w-24 accent-accent"
                data-tooltip="Lower brightness darkens the map background so the trail and markers stand out"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-400 shrink-0">Size</span>
              <input
                type="range"
                min={30} max={80} step={1}
                value={mapSize}
                onChange={e => setMapSize(parseFloat(e.target.value))}
                className="w-24 accent-accent"
                data-tooltip="How large the map renders on screen (% of viewport height)"
              />
            </label>
          </div>
        </div>

        {/* Map body - square, capped to `mapSize`vh on both axes so the
            user controls how much screen real estate the image gets.
            `mx-auto` centers it within the panel's full width. The SVG
            viewBox + preserveAspectRatio do the actual scaling. mapBoxRef
            is still container-relative for the marker-tooltip math. */}
        <div
          ref={mapBoxRef}
          className="relative p-3 mx-auto"
          style={{ aspectRatio: '1 / 1', maxHeight: `${mapSize}vh`, maxWidth: `${mapSize}vh`, width: '100%' }}
        >
        <svg
          viewBox={`0 0 ${transform.imageSize} ${transform.imageSize}`}
          className="w-full h-full block"
          preserveAspectRatio="xMidYMid meet"
        >
          <image
            href={transform.imageSrc}
            x={0} y={0}
            width={transform.imageSize}
            height={transform.imageSize}
          />
          {/* Optional dimming layer - sits above the image but below the
              trail and markers so only the background is darkened. */}
          {dim > 0 && (
            <rect x={0} y={0}
                  width={transform.imageSize} height={transform.imageSize}
                  fill="black" opacity={dim} />
          )}
          {/* Fading trail of recent positions */}
          {segments.map(seg => (
            <line
              key={seg.key}
              x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2}
              stroke="#fbbf24"
              strokeWidth={6}
              strokeLinecap="round"
              opacity={seg.opacity}
            />
          ))}
          {/* Event markers (kills, chests, deaths, boss starts).
              Only events the playback head has reached are plotted, so the
              map fills in as the run progresses rather than showing every
              event up front. Click any marker to seek there. */}
          {eventMarkers
            .filter(ev =>
              ev.elapsed <= currentT &&
              enabledKinds.has(ev.kind) &&
              pickMap({ z: ev.z }) === view)
            .map((ev, idx) => {
              const p = worldToPixel(ev, transform);
              const style = EVENT_STYLE[ev.kind];
              const isCurrent = Math.abs(ev.elapsed - currentT) < 2;
              return (
                <g
                  key={`${ev.kind}-${idx}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => { setIsPlaying(false); setCurrentT(ev.elapsed); }}
                  onMouseEnter={e => onMarkerHover(ev, e)}
                  onMouseMove={e => onMarkerHover(ev, e)}
                  onMouseLeave={() => setHovered(null)}
                >
                  {style.ringColor && (
                    <circle cx={p.px} cy={p.py} r={style.r + 8}
                            fill="none" stroke={style.ringColor}
                            strokeWidth={5} opacity={isCurrent ? 1 : 0.6} />
                  )}
                  {ev.kind === 'death' ? (
                    <g stroke={style.ringColor} strokeWidth={7} strokeLinecap="round">
                      <line x1={p.px - style.r} y1={p.py - style.r} x2={p.px + style.r} y2={p.py + style.r} />
                      <line x1={p.px - style.r} y1={p.py + style.r} x2={p.px + style.r} y2={p.py - style.r} />
                    </g>
                  ) : ev.kind === 'chest' ? (
                    <rect x={p.px - style.r} y={p.py - style.r}
                          width={style.r * 2} height={style.r * 2}
                          fill={style.color} stroke="white" strokeWidth={4}
                          transform={`rotate(45 ${p.px} ${p.py})`} />
                  ) : ev.kind === 'kill' ? (
                    <polygon
                      points={[
                        `${p.px},${p.py - style.r}`,
                        `${p.px + style.r * 0.866},${p.py + style.r * 0.5}`,
                        `${p.px - style.r * 0.866},${p.py + style.r * 0.5}`,
                      ].join(' ')}
                      fill={style.color} stroke="white" strokeWidth={4}
                      strokeLinejoin="round" />
                  ) : ev.kind === 'miniboss' ? (
                    <polygon
                      points={hexPoints(p.px, p.py, style.r)}
                      fill={style.color} stroke="white" strokeWidth={4}
                      strokeLinejoin="round" />
                  ) : ev.kind === 'boss' ? (
                    <polygon
                      points={starPoints(p.px, p.py, style.r)}
                      fill={style.color} stroke="white" strokeWidth={4}
                      strokeLinejoin="round" />
                  ) : (
                    <circle cx={p.px} cy={p.py} r={style.r}
                            fill={style.color}
                            stroke="white" strokeWidth={4} />
                  )}
                  {isCurrent && (
                    <circle cx={p.px} cy={p.py} r={style.r + 14}
                            fill="none" stroke={style.color} strokeWidth={4}>
                      <animate attributeName="r" from={style.r + 6} to={style.r + 28} dur="1.2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" from="1" to="0" dur="1.2s" repeatCount="indefinite" />
                    </circle>
                  )}
                </g>
              );
            })}
          {/* Player position dot */}
          {showDot && (
            <g>
              {/* Pulse halo so the dot is easy to spot at any speed */}
              <circle cx={dotPos.px} cy={dotPos.py} r={36} fill="rgba(251, 191, 36, 0.25)" />
              <circle cx={dotPos.px} cy={dotPos.py} r={20} fill="rgba(251, 191, 36, 0.45)" />
              <circle cx={dotPos.px} cy={dotPos.py} r={12} fill="#fbbf24" stroke="white" strokeWidth={3} />
            </g>
          )}
          {/* "Player is on the other map" indicator */}
          {!showDot && (
            <text x={transform.imageSize / 2} y={transform.imageSize / 2}
                  fill="white" fontSize={64} fontWeight="bold" textAnchor="middle"
                  style={{ paintOrder: 'stroke', stroke: 'black', strokeWidth: 8 }}>
              Player on {autoMap === 'ground' ? 'Ground Floor' : 'Basement'}
            </text>
          )}
        </svg>

        {/* "Current Event" banner pinned to the bottom of the map image.
            Only shown while something notable is happening. */}
        {currentEvent && (
          <div className="absolute left-3 right-3 bottom-3 pointer-events-none">
            <div className="w-full px-4 py-2 backdrop-blur-sm border-t border-white/15 bg-black/80 flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
              {currentEvent.map((g, i) => (
                <span key={i} className="text-sm">
                  <span className="font-bold tracking-wide mr-1.5" style={{ color: g.color }}>
                    {g.prefix}:
                  </span>
                  <span className="font-medium text-gray-100">
                    {g.names.join(', ')}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Custom marker tooltip - follows the cursor, clamped inside the box,
            sits above the pointer. Replaces the native <title> tooltip. */}
        {hovered && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full"
            style={{
              left: Math.min(Math.max(hovered.left, 90), hovered.boxW - 90),
              top: hovered.top - 14,
            }}
          >
            <div className="rounded-md bg-black/90 border border-white/15 px-3 py-2 shadow-lg whitespace-nowrap">
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: EVENT_STYLE[hovered.ev.kind].color }}
                />
                <span className="text-sm text-white font-medium">{hovered.ev.label}</span>
                <span className="text-xs text-amber-300 font-mono">{fmtElapsed(hovered.ev.elapsed)}</span>
              </div>
              {hovered.ev.sublabel && (
                <div className="text-xs text-gray-400 mt-0.5 pl-[18px]">{hovered.ev.sublabel}</div>
              )}
            </div>
            <div className="w-0 h-0 mx-auto border-x-[6px] border-x-transparent border-t-[6px] border-t-black/90" />
          </div>
        )}
        </div>
      </div>

      {/* Scrubber + transport controls - tightened paddings (p-4 → p-3,
          space-y-3 → space-y-2) + smaller time HUD (text-2xl → text-xl)
          to claw back vertical space. Behavior unchanged. */}
      <div className="bg-row-even border border-white/10 rounded-xl p-3 space-y-2">
        {/* Time + area */}
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-xl text-amber-400">{fmtElapsed(Math.max(0, SORTIE_DURATION - currentT))}</span>
            <span className="text-xs text-gray-400">Time Remaining</span>
          </div>
          <div className="flex items-baseline gap-4 text-xs">
            <div>
              <span className="text-gray-400">Current Area:</span>{' '}
              <span className="text-white font-medium">{currentSample.area}</span>
            </div>
            <div>
              <span className="text-gray-400">Time Spent:</span>{' '}
              <span className="text-amber-300 font-mono">{fmtElapsed(timeSpentInArea)}</span>
            </div>
            {nextAreaTransition ? (
              <div>
                <span className="text-gray-400">Next:</span>{' '}
                <span className="text-white font-medium">{nextAreaTransition.nextArea}</span>
              </div>
            ) : (
              <div className="text-gray-400 italic">stays here</div>
            )}
          </div>
        </div>

        {/* Scrubber */}
        <input
          type="range"
          min={minElapsed}
          max={maxElapsed}
          step={0.1}
          value={currentT}
          onChange={e => {
            setCurrentT(parseFloat(e.target.value));
            if (isPlaying) setIsPlaying(false);
          }}
          className="w-full accent-amber-400"
        />

        {/* Speed - own row */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-400 mr-1 shrink-0">SPEED:</span>
          {SPEEDS.map(s => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`flex-1 px-2 py-1 text-xs font-mono rounded ${
                speed === s
                  ? 'bg-amber-500/30 text-amber-200'
                  : 'bg-row-even text-gray-400 hover:text-gray-300'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Filter on its own row, transport buttons on the row below */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400 mr-1 shrink-0">FILTER:</span>
            {([
              ['kill',     'Mob'],
              ['miniboss', 'Miniboss'],
              ['boss',     'Boss'],
              ['chest',    'Item'],
              ['death',    'Death'],
            ] as [EventKind, string][]).map(([kind, label]) => {
              const on = enabledKinds.has(kind);
              return (
                <button
                  key={kind}
                  onClick={() => toggleKind(kind)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1 text-xs rounded-md border transition-colors ${
                    on
                      ? 'bg-white/[0.06] border-white/20 text-gray-200'
                      : 'bg-row-even border-white/10 text-gray-400 line-through'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: on ? EVENT_STYLE[kind].color : 'transparent',
                             border: on ? 'none' : `1px solid ${EVENT_STYLE[kind].color}` }}
                  />
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (currentT >= maxElapsed) setCurrentT(minElapsed);
                setIsPlaying(p => !p);
              }}
              className="flex-1 px-4 py-1.5 text-sm font-semibold rounded-md bg-amber-500/20 border border-amber-500/50 text-amber-300 hover:bg-amber-500/30"
            >
              {isPlaying ? 'PAUSE' : currentT >= maxElapsed ? 'REPLAY' : 'PLAY'}
            </button>
            <button
              onClick={() => { setIsPlaying(false); setCurrentT(minElapsed); }}
              className="flex-1 px-4 py-1.5 text-sm rounded-md bg-row-even border border-white/10 text-gray-300 hover:bg-white/[0.04]"
            >
              RESET
            </button>
          </div>
        </div>
      </div>

      {/* Events list - click to jump the scrubber to that moment.
          Shows all events (past or future relative to currentT). The event
          nearest to currentT is highlighted to anchor the user's attention.
          Default scroll cap dropped to ~10 rows (max-h-40) to keep the
          whole tab on-screen at typical desktop heights - the user always
          had to scroll to reach the events anyway. */}
      {eventMarkers.some(ev => enabledKinds.has(ev.kind)) && (
        <div className="bg-row-even border border-white/10 rounded-xl p-3">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-2 px-1">
            Events <span className="text-gray-400 font-normal normal-case ml-1">
              ({eventMarkers.filter(ev => enabledKinds.has(ev.kind)).length})
            </span>
          </p>
          <div className="max-h-40 overflow-y-auto pr-1 space-y-0.5 font-mono text-xs">
            {eventMarkers.filter(ev => enabledKinds.has(ev.kind)).map((ev, idx) => {
              const style = EVENT_STYLE[ev.kind];
              const isPast = ev.elapsed <= currentT;
              const isCurrent = Math.abs(ev.elapsed - currentT) < 2;
              return (
                <button
                  key={`row-${ev.kind}-${idx}`}
                  onClick={() => { setIsPlaying(false); setCurrentT(ev.elapsed); }}
                  className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded transition-colors ${
                    isCurrent
                      ? 'bg-amber-500/20 text-amber-200'
                      : isPast
                        ? 'hover:bg-white/[0.04] text-gray-300'
                        : 'hover:bg-white/[0.04] text-gray-400'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: style.color }} />
                  <span className="w-12 tabular-nums text-gray-400">{fmtElapsed(ev.elapsed)}</span>
                  <span className="uppercase text-[10px] text-gray-400 w-12 shrink-0">{ev.kind}</span>
                  <span className="truncate">{ev.label}</span>
                  {ev.sublabel && <span className="text-gray-400 truncate">- {ev.sublabel}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
