'use client';


import { useMemo, useState, useEffect, useRef } from 'react';
import type { PositionLogEntry } from '@/lib/types';
import {
  mapsForZone, dominantMapFor, pickMapFor, projectToMap, mapImageUrl,
  type ZoneMapEntry,
} from '@/lib/zoneMaps';

function fmtClock(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtDur(s: number) {
  if (s < 60) return `${Math.round(s)}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  if (h > 0) return sec === 0 ? `${h}h ${m}m` : `${h}h ${m}m ${sec}s`;
  return sec === 0 ? `${m}m` : `${m}m ${sec}s`;
}

interface Props {
  zoneId: number | null;
  zoneName?: string | null;
  positionLog: PositionLogEntry[] | null;
  /** Optional encounter duration in seconds for the scrubber range. Falls
   *  back to the last sample's elapsed when omitted. */
  durationSeconds?: number;
}

export default function EncounterMapTab({ zoneId, zoneName, positionLog, durationSeconds }: Props) {
  const samples = useMemo(
    () => (positionLog ?? []).slice().sort((a, b) => a.elapsed - b.elapsed),
    [positionLog],
  );

  // Maps available for this zone (sorted by map_level). Empty when LE has
  // no calibration - we'll render a normalized scatter fallback instead.
  const zoneMaps = useMemo(() => mapsForZone(zoneId), [zoneId]);

  // Default map = the one majority of samples land on. User can override
  // via the floor-strip below if multiple levels were visited.
  const defaultMap = useMemo(
    () => dominantMapFor(zoneId, samples),
    [zoneId, samples],
  );

  const touched = useMemo(() => {
    const counts = new Map<number, number>();
    for (const s of samples) {
      const m = pickMapFor(zoneId, s.x, s.y, s.z);
      if (!m) continue;
      counts.set(m.map_level, (counts.get(m.map_level) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0] - b[0]);
  }, [zoneId, samples]);

  const [selLevel, setSelLevel] = useState<number | null>(null);
  useEffect(() => {
    if (selLevel == null && defaultMap) setSelLevel(defaultMap.map_level);
  }, [defaultMap, selLevel]);

  const sel: ZoneMapEntry | null = selLevel != null
    ? (zoneMaps.find(m => m.map_level === selLevel) ?? defaultMap)
    : defaultMap;

  // Playback scrub: clamp to [first sample elapsed, max(last sample, runtime)].
  const minE = samples.length ? samples[0].elapsed : 0;
  const maxE = Math.max(
    samples.length ? samples[samples.length - 1].elapsed : 0,
    durationSeconds ?? 0,
  );
  const [curT, setCurT] = useState(maxE);
  useEffect(() => { setCurT(maxE); }, [maxE]);

  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);

  // Map dim 0..0.75 - same chrome as JourneyTab. Default to a hair of dim
  // so the bright LE bitmaps don't overpower the cyan trail.
  const [dim, setDim] = useState(0.15);
  // Map size in vh, shared key with JourneyTab so a user's preferred map
  // size carries across Sortie ↔ generic encounters. Both clamped [30, 80].
  const [mapSize, setMapSize] = useState<number>(() => {
    if (typeof window === 'undefined') return 55;
    const v = parseFloat(window.localStorage.getItem('ff_map_size') ?? '');
    return Number.isFinite(v) && v >= 30 && v <= 80 ? v : 55;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('ff_map_size', String(mapSize));
  }, [mapSize]);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      setCurT(t => {
        const nt = t + dt * 10; // 10× playback (same as Odyssey)
        if (nt >= maxE) { setPlaying(false); return maxE; }
        return nt;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, maxE]);

  if (samples.length === 0) {
    return (
      <div className="bg-row-even border border-white/10 rounded-xl p-8 text-center text-gray-400 text-sm">
        No position data recorded for this encounter.
      </div>
    );
  }

  // ── Calibrated path: real LE map background + projection ────────────────
  if (sel) {
    // Project each sample onto the SELECTED level (samples on other levels
    // are dropped from THIS render - switch the floor chip to see them).
    const pts: { fx: number; fy: number; elapsed: number }[] = [];
    for (const s of samples) {
      const m = pickMapFor(zoneId, s.x, s.y, s.z);
      if (!m || m.map_level !== sel.map_level) continue;
      if (s.elapsed > curT) break;
      const p = projectToMap(sel, s.x, s.y);
      pts.push({ ...p, elapsed: s.elapsed });
    }
    const head = pts.length ? pts[pts.length - 1] : null;
    const start = pts.length ? pts[0] : null;

    return (
      <div className="space-y-2">
        <div className="bg-row-even border border-white/10 rounded-xl overflow-hidden">
          {/* Toolbar - zone title + level chips on the left, sliders on
              the right. Big standalone "ZONE MAP" header used to live
              above the panel; that read as orphaned chrome, so it's now
              folded into this row. */}
          <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-white/10 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap min-w-0">
              <span className="text-sm font-semibold text-accent uppercase tracking-wide truncate">
                {zoneName ?? `Zone ${zoneId ?? '-'}`}
              </span>
              {touched.length > 1 ? (
                <div className="flex items-center gap-1.5">
                  {touched.map(([level, n]) => (
                    <button
                      key={level}
                      onClick={() => setSelLevel(level)}
                      className={`text-xs font-mono rounded px-2.5 py-1 border transition-colors ${
                        level === sel.map_level
                          ? 'bg-accent/20 border-accent/50 text-accent'
                          : 'bg-panel-alt/60 border-white/10 text-gray-400 hover:border-accent/30'
                      }`}
                    >
                      L{level + 1} <span className="text-gray-400">· {n}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-[11px] uppercase tracking-wide text-gray-400">
                  Level {sel.map_level + 1}
                </span>
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

          {/* Map body - sized by `mapSize`, centered. The image renders at
              its native aspect via object-fill in a square container; the
              SVG fills the same box with preserveAspectRatio="none", so
              fx/fy fractions land on the exact pixel they correspond to
              in the source bitmap. A dimming layer above the image (below
              the trail) honors the Brightness slider. */}
          <div
            className="relative mx-auto bg-panel border-t border-white/[0.04]"
            style={{ aspectRatio: '1 / 1', maxHeight: `${mapSize}vh`, maxWidth: `${mapSize}vh`, width: '100%' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mapImageUrl(sel)}
              alt={`${zoneName ?? 'Zone'} level ${sel.map_level + 1}`}
              className="absolute inset-0 w-full h-full object-fill select-none"
              draggable={false}
            />
            {dim > 0 && (
              <div className="absolute inset-0 pointer-events-none" style={{ background: 'black', opacity: dim }} />
            )}
            {/* Trail + start/current dots - colored amber-400 to match
                Sortie's player trail + dot exactly. Start point stays
                emerald so it's distinguishable from the head. */}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
              {pts.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#fbbf24"
                  strokeWidth={0.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={0.75}
                  points={pts.map(p => `${p.fx * 100},${p.fy * 100}`).join(' ')}
                />
              )}
              {start && <circle cx={start.fx * 100} cy={start.fy * 100} r={1.2} fill="#34d399" />}
              {head  && <circle cx={head.fx  * 100} cy={head.fy  * 100} r={1.6} fill="#fbbf24" stroke="#000" strokeWidth={0.3} />}
            </svg>

            {pts.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
                No samples on this floor before {fmtClock(curT)}
              </div>
            )}
          </div>
          {/* Sample-count footer inside the panel so it reads as part of
              the artifact, not floating context. */}
          <div className="px-3 py-1.5 text-[10px] text-gray-400 border-t border-white/[0.04] flex items-center justify-between gap-2 flex-wrap">
            <span>{samples.length} samples · {fmtDur(maxE - minE)} active</span>
            {touched.length > 1 && <span>Green = first sample · Amber = position at {fmtClock(curT)}</span>}
          </div>
        </div>

        {/* Playback scrubber - wrapped in its own panel to mirror the
            scrubber-panel layout in Sortie's JourneyTab. */}
        <div className="bg-row-even border border-white/10 rounded-xl p-3 space-y-2">
          <input
            type="range"
            min={minE}
            max={maxE}
            step={1}
            value={Math.round(curT)}
            onChange={e => { setPlaying(false); setCurT(Number(e.target.value)); }}
            className="w-full accent-cyan-400"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() => { if (curT >= maxE) setCurT(minE); setPlaying(p => !p); }}
              className="flex-1 px-4 py-1.5 text-sm font-semibold rounded-md bg-cyan-500/20 border border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/30"
            >
              {playing ? 'PAUSE' : curT >= maxE ? 'REPLAY' : 'PLAY'}
            </button>
            <button
              onClick={() => { setPlaying(false); setCurT(minE); }}
              className="flex-1 px-4 py-1.5 text-sm rounded-md bg-panel-alt/60 border border-white/10 text-gray-300 hover:bg-white/[0.04]"
            >
              RESET
            </button>
            <span className="text-xs text-gray-400 font-mono w-16 text-right">{fmtClock(curT)}</span>
          </div>
        </div>

        <p className="text-[10px] text-gray-400 leading-relaxed">
          Map data + bitmap from LesserEvil. Green = first sample, amber = position at {fmtClock(curT)}.
          {touched.length > 1 && ' Only samples on the selected floor are drawn - switch the chip above for other floors.'}
        </p>
      </div>
    );
  }

  const xs = samples.map(s => s.x), ys = samples.map(s => s.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const fx = (x: number) => ((x - minX) / span);
  const fy = (y: number) => ((y - minY) / span);
  const visible = samples.filter(s => s.elapsed <= curT);
  const first = visible.length ? visible[0] : null;
  const last  = visible.length ? visible[visible.length - 1] : null;
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wide leading-none mb-1">Movement Trail</div>
          <h3 className="font-bold text-2xl text-cyan-400 uppercase tracking-wide leading-none">
            {zoneName ?? `Zone ${zoneId ?? '-'}`}
          </h3>
        </div>
        <div className="text-right text-[10px] text-gray-400 leading-tight">
          <div>{samples.length} samples · {fmtDur(maxE - minE)} active</div>
          <div className="text-amber-400/70">No map calibration - showing raw trail.</div>
        </div>
      </div>

      <div className="bg-row-even border border-white/10 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-white/10 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide text-gray-400">Raw trail (no map bitmap)</span>
          <label className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-gray-400 shrink-0">Size</span>
            <input
              type="range"
              min={30} max={80} step={1}
              value={mapSize}
              onChange={e => setMapSize(parseFloat(e.target.value))}
              className="w-24 accent-cyan-400"
              data-tooltip="How large the map renders on screen (% of viewport height)"
            />
          </label>
        </div>
        <div
          className="relative mx-auto bg-black/30 border-t border-white/[0.04]"
          style={{ aspectRatio: '1 / 1', maxHeight: `${mapSize}vh`, maxWidth: `${mapSize}vh`, width: '100%' }}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
            {visible.length > 1 && (
              <polyline
                fill="none"
                stroke="#22d3ee"
                strokeWidth={0.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={0.7}
                points={visible.map(s => `${fx(s.x) * 100},${fy(s.y) * 100}`).join(' ')}
              />
            )}
            {first && <circle cx={fx(first.x) * 100} cy={fy(first.y) * 100} r={1.2} fill="#34d399" />}
            {last  && <circle cx={fx(last.x)  * 100} cy={fy(last.y)  * 100} r={1.6} fill="#fbbf24" stroke="#000" strokeWidth={0.3} />}
          </svg>
        </div>
      </div>

      <div className="bg-row-even border border-white/10 rounded-xl p-3 space-y-2">
        <input
          type="range"
          min={minE}
          max={maxE}
          step={1}
          value={Math.round(curT)}
          onChange={e => { setPlaying(false); setCurT(Number(e.target.value)); }}
          className="w-full accent-cyan-400"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={() => { if (curT >= maxE) setCurT(minE); setPlaying(p => !p); }}
            className="flex-1 px-4 py-1.5 text-sm font-semibold rounded-md bg-cyan-500/20 border border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/30"
          >
            {playing ? 'PAUSE' : curT >= maxE ? 'REPLAY' : 'PLAY'}
          </button>
          <button
            onClick={() => { setPlaying(false); setCurT(minE); }}
            className="flex-1 px-4 py-1.5 text-sm rounded-md bg-panel-alt/60 border border-white/10 text-gray-300 hover:bg-white/[0.04]"
          >
            RESET
          </button>
          <span className="text-xs text-gray-400 font-mono w-16 text-right">{fmtClock(curT)}</span>
        </div>
      </div>
    </div>
  );
}
