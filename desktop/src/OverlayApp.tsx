import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';
import type { LivePlayer, TrackerLive } from './content';
import { startMultibox, useBoxes, useLiveGroups, useLiveOverlayGroups, addCombatSubscriber, type KillEvent } from './multibox';
import { inTauri } from './library';
import { JOB_FULL_NAMES } from '@/lib/anonymize';
import { JOB_ICONS, mainJobKey } from '@/components/JobIcon';
import { imgSrc } from '@/lib/img';
import { aggregateFilteredPlayers, mobKeyFromDisplay } from './overlayFilter';
import type { LiveTarget } from './content';

const CTRL = 'w-5 h-5 flex items-center justify-center rounded hover:bg-white/15 transition-colors';

function isIgnoredMobName(name: string): boolean {
  return name.indexOf('Luopan') >= 0;
}

const ANON_KEY = 'ff_anon';
const SCALE_KEY = 'ff_overlay_scale';
const DEMO_KEY = 'ff_overlay_demo';
const COMPACT_KEY = 'ff_overlay_compact';
const OPACITY_KEY = 'ff_overlay_opacity';
const THEME_KEY = 'ff_theme';
const AUTO_PROMOTE_KEY  = 'gnosis_overlay_auto_promote_on_death';
const FOLLOW_TARGET_KEY = 'gnosis_overlay_follow_my_target';
const FOLLOW_CHAR_KEY   = 'gnosis_overlay_follow_target_char';
const MODE_KEY          = 'gnosis_overlay_mode';

type OverlayMode = 'all-mobs' | 'focus' | 'paused';
function loadMode(): OverlayMode {
  const v = localStorage.getItem(MODE_KEY);
  return v === 'focus' || v === 'paused' || v === 'all-mobs' ? v : 'all-mobs';
}

const JOB_BADGE: Record<string, string> = {
  WAR: 'bg-red-700', MNK: 'bg-orange-600', WHM: 'bg-pink-600', BLM: 'bg-indigo-700',
  RDM: 'bg-red-500', THF: 'bg-emerald-700', PLD: 'bg-sky-700', DRK: 'bg-violet-800',
  BST: 'bg-lime-700', BRD: 'bg-gray-600', RNG: 'bg-green-700', SAM: 'bg-red-600',
  NIN: 'bg-slate-600', DRG: 'bg-blue-700', SMN: 'bg-cyan-700', BLU: 'bg-sky-500',
  COR: 'bg-amber-700', PUP: 'bg-orange-700', DNC: 'bg-rose-500', SCH: 'bg-indigo-500',
  GEO: 'bg-yellow-700', RUN: 'bg-teal-700', TRUST: 'bg-purple-800',
};

// Sample scenario for the Overlay preview - clearly fictional names (no real
// character names) so users can size/scale the overlay without being in combat.
const DUMMY_LIVE: TrackerLive = {
  recording: true,
  elapsed: 252,
  zone: "Outer Ra'Kaznar [U2]",
  source: 'sortie',
  enemies: 2,
  deaths: 1,
  partyDamage: 1240500,
  partyDps: 4923,
  players: [
    { name: 'N',          job: 'PUP',   damage: 412300, dps: 1636, pct: 33.2, acc: 96, crit: 32, exphr: 24500, cphr: 850000, ephr: 12500, lphr: 15400 },
    { name: 'Mirdain',    job: 'MNK',   damage: 287100, dps: 1139, pct: 23.1, exphr: 22800, cphr: 812000, ephr: 11900 },
    { name: 'Martel',     job: 'PLD',   damage: 198400, dps: 787,  pct: 16.0, acc: 94, cphr: 798000 },
    { name: 'Kiriyu',     job: 'BRD',   damage: 165900, dps: 658,  pct: 13.4, acc: 95, crit: 28, cphr: 760000, ephr: 10200 },
    { name: 'Constantine', job: 'WHM',   damage: 92300,  dps: 366,  pct: 7.4, cphr: 725000 },
    { name: 'Dexprozius', job: 'CLOWN', damage: 84500,  dps: 335,  pct: 6.8, cphr: 710000, ephr: 9800 },
  ],
};

function buildLabelMap(players: LivePlayer[]): Record<string, string> {
  const labelFor = (job: string | null | undefined): string => {
    if (!job || job === '?' || job === 'TRUST') return 'Player';
    return JOB_FULL_NAMES[job] ?? job;
  };
  const named = players.filter(p => p.job !== 'TRUST').sort((a, b) => a.name.localeCompare(b.name));
  const total: Record<string, number> = {};
  for (const p of named) { const l = labelFor(p.job); total[l] = (total[l] ?? 0) + 1; }
  const map: Record<string, string> = {};
  const idx: Record<string, number> = {};
  for (const p of named) {
    if (map[p.name]) continue;
    const l = labelFor(p.job);
    if (total[l] > 1) { idx[l] = (idx[l] ?? 0) + 1; map[p.name] = `${l} ${idx[l]}`; }
    else map[p.name] = l;
  }
  return map;
}

function mmss(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
const fmt = (n: number) => n.toLocaleString();
function fmtRate(n: number | undefined): string | null {
  if (n == null || n <= 0) return null;
  if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + 'm';
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
  return String(n);
}
function fmtCompact(n: number | undefined): string {
  if (n == null || n <= 0) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

export default function OverlayApp() {
  const [theme, setTheme] = useState<string>(() => {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'meadow') return 'gnosis';
    return v || 'gnosis';
  });
  const [anon, setAnon] = useState<boolean>(() => localStorage.getItem(ANON_KEY) === '1');
  const [scale, setScale] = useState<number>(() => parseFloat(localStorage.getItem(SCALE_KEY) || '1') || 1);
  const [compact, setCompact] = useState<boolean>(() => localStorage.getItem(COMPACT_KEY) === '1');
  const [opacity, setOpacity] = useState<number>(() => parseFloat(localStorage.getItem(OPACITY_KEY) || '0.72') || 0.72);
  const [demo, setDemo] = useState<boolean>(() => localStorage.getItem(DEMO_KEY) === '1');
  const [selectedZone, setSelectedZone] = useState<number | null>(null);
  const [pinned, setPinned] = useState(true);
  const [focusOpen, setFocusOpen] = useState(false);
  type FocusKey = { id: number | null; kill_seq: number | null; name: string };
  const [focus, setFocus] = useState<FocusKey | null>(null);
  const [autoPromoteOnDeath, setAutoPromoteOnDeath] = useState<boolean>(() => localStorage.getItem(AUTO_PROMOTE_KEY) !== '0');
  const [followMyTarget, setFollowMyTarget]         = useState<boolean>(() => localStorage.getItem(FOLLOW_TARGET_KEY) === '1');
  const [followCharName, setFollowCharName]         = useState<string>(()  => localStorage.getItem(FOLLOW_CHAR_KEY) ?? '');
  const win = useMemo(() => (inTauri ? getCurrentWindow() : null), []);
  const togglePin = () => { const n = !pinned; setPinned(n); win?.setAlwaysOnTop(n).catch(() => {}); };
  type ResizeDir = 'NorthWest' | 'North' | 'NorthEast' | 'East' | 'SouthEast' | 'South' | 'SouthWest' | 'West';
  const startResize = (dir: ResizeDir) => (e: React.PointerEvent) => {
    if (!win) return;
    e.preventDefault();
    e.stopPropagation();
    win.startResizeDragging(dir).catch(() => {});
  };

  const minimizeToTaskbar = async () => {
    if (!win) return;
    try { await win.setSkipTaskbar(false); } catch { /* ignore */ }
    try { await win.minimize(); } catch { /* ignore */ }
  };

  // Subscribe to the multibox IPC stream in this (overlay) window's context.
  useEffect(() => { startMultibox(); }, []);
  useEffect(() => addCombatSubscriber(), []);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  // Poll shared display settings (changed in the main window) ~1Hz. No file reads.
  useEffect(() => {
    const tick = () => {
      setTheme((v => v === 'meadow' ? 'gnosis' : (v || 'gnosis'))(localStorage.getItem(THEME_KEY)));
      setAnon(localStorage.getItem(ANON_KEY) === '1');
      setScale(parseFloat(localStorage.getItem(SCALE_KEY) || '1') || 1);
      setCompact(localStorage.getItem(COMPACT_KEY) === '1');
      setOpacity(parseFloat(localStorage.getItem(OPACITY_KEY) || '0.72') || 0.72);
      setDemo(localStorage.getItem(DEMO_KEY) === '1');
      setAutoPromoteOnDeath(localStorage.getItem(AUTO_PROMOTE_KEY) !== '0');
      setFollowMyTarget(localStorage.getItem(FOLLOW_TARGET_KEY) === '1');
      setFollowCharName(localStorage.getItem(FOLLOW_CHAR_KEY) ?? '');
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const groups = useLiveOverlayGroups();
  const heavyGroups = useLiveGroups();

  const selected = demo
    ? null
    : (selectedZone != null ? groups.find(g => g.key === selectedZone) : undefined) ?? groups[0];
  const liveSource: TrackerLive | null = demo ? DUMMY_LIVE : (selected?.live ?? null);
  const zoneTitleSource = demo ? (DUMMY_LIVE.zone || 'Demo') : (selected?.zoneName || 'Idle');

  const [mode, setModeState] = useState<OverlayMode>(loadMode);
  const [pausedLive, setPausedLive] = useState<TrackerLive | null>(null);
  const [pausedZoneTitle, setPausedZoneTitle] = useState<string>('Idle');
  const paused = mode === 'paused';
  const setMode = (next: OverlayMode) => {
    if (next === mode) return;
    if (next === 'paused') {
      setPausedLive(liveSource);
      setPausedZoneTitle(zoneTitleSource);
    } else {
      setPausedLive(null);
    }
    if (next === 'all-mobs') setFocus(null);
    setModeState(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* quota / private mode */ }
  };
  const live: TrackerLive | null = paused ? pausedLive : liveSource;
  const zoneTitle = paused ? pausedZoneTitle : zoneTitleSource;

  const heavyGroup = useMemo(
    () => selected ? heavyGroups.find(g => g.key === selected.key) : undefined,
    [heavyGroups, selected?.key],
  );

  const allBoxes = useBoxes();


  // Reset focus + dropdown when the selected zone changes (new encounter).
  const prevZoneRef = useRef<number | null>(null);
  useEffect(() => {
    const z = selected?.key ?? null;
    if (prevZoneRef.current !== z) {
      prevZoneRef.current = z;
      setFocus(null);
      setFocusOpen(false);
    }
  }, [selected?.key]);

  type EngagedMob = { id: number | null; kill_seq: number | null; name: string; label: string; target: LiveTarget };
  const engagedMobs = useMemo<EngagedMob[]>(() => {
    const raw = (live?.targets ?? []).filter(t => t.name && !isIgnoredMobName(t.name));
    const byName: Record<string, LiveTarget[]> = {};
    for (const t of raw) (byName[t.name] ??= []).push(t);
    for (const name in byName) {
      byName[name].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    }
    const out: EngagedMob[] = [];
    for (const t of raw) {
      const siblings = byName[t.name];
      const idx = siblings.indexOf(t);
      const label = siblings.length > 1 ? `${t.name} #${idx + 1}` : t.name;
      out.push({ id: t.id ?? null, kill_seq: t.kill_seq ?? null, name: t.name, label, target: t });
    }
    return out;
  }, [live?.targets]);

  const matchesFocus = (m: EngagedMob, f: FocusKey): boolean => {
    if (f.kill_seq != null) return m.kill_seq === f.kill_seq;
    if (f.id != null) return m.kill_seq == null && m.id === f.id;
    return m.name === f.name && m.kill_seq == null;
  };

  useEffect(() => {
    if (mode !== 'focus') return;
    if (!autoPromoteOnDeath) return;
    if (focus) return;
    const candidates = engagedMobs.filter(m => m.kill_seq == null && (m.target.hpp ?? 0) > 0);
    if (candidates.length === 0) return;
    const lowest = candidates.reduce((a, b) => ((a.target.hpp ?? 100) <= (b.target.hpp ?? 100) ? a : b));
    setFocus({ id: lowest.id, kill_seq: lowest.kill_seq, name: lowest.name });
  }, [autoPromoteOnDeath, focus, engagedMobs, mode]);

  // LIVE section: currently-engaged (HP > 0), HP-descending.
  const liveMobs = useMemo(
    () => engagedMobs.filter(m => (m.target.hpp ?? 0) > 0),
    [engagedMobs],
  );

  // History search query (filters the full kill history). Empty = show all.
  const [historySearch, setHistorySearch] = useState('');

  const repBox = useMemo(
    () => selected ? allBoxes.find(b => b.conn === selected.conn) ?? null : null,
    [allBoxes, selected],
  );
  const killEvents = useMemo<KillEvent[]>(() => {
    // Prefer the full per-kill event stream (new addon).
    const hist = repBox?.killHistory;
    if (hist && hist.length > 0) return hist;
    // Legacy fallback: synthesize from live.targets[] entries with hpp=0
    // (capped at the addon's KILLED_EMIT_CAP, ~20).
    return (live?.targets ?? [])
      .filter(t => typeof t.kill_seq === 'number' && (t.hpp ?? 0) === 0)
      .map(t => ({
        id: t.id, kill_seq: t.kill_seq!, name: t.name,
        dmg: t.dmg, since: t.since ?? null, ended: t.ended ?? null,
      }));
  }, [repBox?.killHistory, live?.targets]);

  const killedMobs = useMemo<EngagedMob[]>(() => {
    const q = historySearch.trim().toLowerCase();
    const filtered = q ? killEvents.filter(k => k.name.toLowerCase().includes(q)) : killEvents;
    const byName: Record<string, KillEvent[]> = {};
    for (const k of filtered) (byName[k.name] ??= []).push(k);
    for (const name in byName) byName[name].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    return [...filtered]
      .sort((a, b) => (b.ended ?? 0) - (a.ended ?? 0))
      .map<EngagedMob>(k => {
        const siblings = byName[k.name];
        const idx = siblings.indexOf(k);
        const label = siblings.length > 1 ? `${k.name} #${idx + 1}` : k.name;
        const target: LiveTarget = {
          name: k.name, hpp: 0, id: k.id, dmg: k.dmg,
          since: k.since ?? null, ended: k.ended ?? null, kill_seq: k.kill_seq,
        };
        return { id: k.id ?? null, kill_seq: k.kill_seq, name: k.name, label, target };
      });
  }, [killEvents, historySearch]);

  useEffect(() => {
    if (mode !== 'focus') return;
    if (!focus) return;
    if (engagedMobs.some(m => matchesFocus(m, focus))) return;
    if (focus.kill_seq == null && focus.id != null) {
      const snapshot = engagedMobs
        .filter(m => m.id === focus.id && m.kill_seq != null)
        .sort((a, b) => (b.kill_seq ?? 0) - (a.kill_seq ?? 0))[0];
      if (snapshot) {
        setFocus({ id: snapshot.id, kill_seq: snapshot.kill_seq, name: snapshot.name });
        return;
      }
    }
    if (autoPromoteOnDeath) {
      const candidates = engagedMobs.filter(m => m.kill_seq == null && (m.target.hpp ?? 0) > 0);
      if (candidates.length > 0) {
        const lowest = candidates.reduce((a, b) => ((a.target.hpp ?? 100) <= (b.target.hpp ?? 100) ? a : b));
        setFocus({ id: lowest.id, kill_seq: lowest.kill_seq, name: lowest.name });
        return;
      }
    }
  }, [focus, engagedMobs, autoPromoteOnDeath, mode]);

  const KILL_HOLD_MS = 1000;
  const engagedMobsRef = useRef(engagedMobs);
  engagedMobsRef.current = engagedMobs;
  const snapshotKeyRef = useRef<string>('');
  const snapshotEnteredAtRef = useRef<number>(0);
  useEffect(() => {
    if (mode !== 'focus') return;
    if (!autoPromoteOnDeath || !focus || focus.kill_seq == null) {
      snapshotKeyRef.current = '';
      return;
    }
    const key = String(focus.kill_seq);
    if (snapshotKeyRef.current !== key) {
      snapshotKeyRef.current = key;
      snapshotEnteredAtRef.current = Date.now();
    }
    const elapsed = Date.now() - snapshotEnteredAtRef.current;
    const remaining = Math.max(0, KILL_HOLD_MS - elapsed);
    const t = window.setTimeout(() => {
      const candidates = engagedMobsRef.current.filter(m => m.kill_seq == null && (m.target.hpp ?? 0) > 0);
      if (candidates.length === 0) return;
      const lowest = candidates.reduce((a, b) => ((a.target.hpp ?? 100) <= (b.target.hpp ?? 100) ? a : b));
      setFocus({ id: lowest.id, kill_seq: lowest.kill_seq, name: lowest.name });
    }, remaining);
    return () => window.clearTimeout(t);
  }, [focus, autoPromoteOnDeath, engagedMobs, mode]);

  const followedTargetId: number | null = useMemo(() => {
    if (!followMyTarget || !followCharName) return null;
    const b = allBoxes.find(x => x.self?.name === followCharName);
    return b?.live?.myTargetId ?? null;
  }, [followMyTarget, followCharName, allBoxes]);
  const lastSeenTargetRef = useRef<number | null>(null);
  const pendingTargetRef  = useRef<number | null>(null);
  useEffect(() => {
    if (mode !== 'focus') return;
    if (!followMyTarget) {
      lastSeenTargetRef.current = followedTargetId;
      pendingTargetRef.current = null;
      return;
    }
    if (followedTargetId !== lastSeenTargetRef.current) {
      lastSeenTargetRef.current = followedTargetId;
      pendingTargetRef.current = followedTargetId;
    }
    const pending = pendingTargetRef.current;
    if (pending == null) return;
    const liveTarget = engagedMobs.find(m => m.kill_seq == null && m.id === pending);
    if (liveTarget) {
      pendingTargetRef.current = null;
      setFocus({ id: liveTarget.id, kill_seq: liveTarget.kill_seq, name: liveTarget.name });
    }
  }, [followMyTarget, followedTargetId, engagedMobs, mode]);

  const focusedMob = useMemo<EngagedMob | null>(() => {
    if (!focus) return null;
    const direct = engagedMobs.find(m => matchesFocus(m, focus));
    if (direct) return direct;
    if (focus.kill_seq == null && focus.id != null) {
      const snapshot = engagedMobs
        .filter(m => m.id === focus.id && m.kill_seq != null)
        .sort((a, b) => (b.kill_seq ?? 0) - (a.kill_seq ?? 0))[0];
      if (snapshot) return snapshot;
    }
    return null;
  }, [focus, engagedMobs]);

  const filtered = useMemo(() => {
    if (!focus) return null;
    if (focusedMob && focusedMob.target.dmg && (focus.id != null || focus.kill_seq != null)) {
      // Per-mob elapsed: (ended ?? now) - since. Falls back to encounter
      // duration when the timing stamps are missing (older addon build).
      const t = focusedMob.target;
      let dur = heavyGroup?.durationSeconds ?? live?.elapsed ?? 0;
      if (t.since != null) {
        const nowSec = Math.floor(Date.now() / 1000);
        const endSec = t.ended ?? nowSec;
        dur = Math.max(1, endSec - t.since);
      }
      const dmg = t.dmg ?? {};
      const jobByName: Record<string, string> = {};
      for (const p of (live?.players ?? [])) {
        if (p.job) jobByName[p.name] = p.job;
      }
      for (const p of (heavyGroup?.party ?? [])) {
        if (p.mainJob) jobByName[p.name] = p.mainJob;
      }
      const merged: Record<string, number> = {};
      let partyDamage = 0;
      for (const [name, d] of Object.entries(dmg)) {
        const base = name.startsWith('SC-') ? name.slice(3) : name;
        merged[base] = (merged[base] ?? 0) + d;
        partyDamage += d;
      }
      const denom = partyDamage || 1;
      const players = Object.entries(merged).map(([name, dmgVal]) => ({
        name,
        job: jobByName[name] || '',
        damage: dmgVal,
        dps: dur > 0 ? Math.round(dmgVal / dur) : 0,
        pct: Math.round((dmgVal / denom) * 1000) / 10,
      }));
      players.sort((a, b) => b.damage - a.damage);
      return { players, partyDamage, partyDps: dur > 0 ? Math.round(partyDamage / dur) : 0 };
    }
    if (heavyGroup) {
      const filterSet = new Set([mobKeyFromDisplay(focus.name)]);
      const partyByName = new Map(heavyGroup.party.map(p => [p.name, p]));
      for (const lp of (live?.players ?? [])) {
        const existing = partyByName.get(lp.name);
        if (!existing && lp.job) {
          partyByName.set(lp.name, { name: lp.name, mainJob: lp.job, subJob: '', mainLevel: 0, subLevel: 0 });
        } else if (existing && !existing.mainJob && lp.job) {
          partyByName.set(lp.name, { ...existing, mainJob: lp.job });
        }
      }
      const enrichedParty = Array.from(partyByName.values());
      return aggregateFilteredPlayers(heavyGroup.combatStats, filterSet, enrichedParty, heavyGroup.durationSeconds);
    }
    return null;
  }, [focus, focusedMob, heavyGroup, live?.elapsed, live?.players]);

  const recording = !!live?.recording;
  const isSingleBox = groups.length <= 1;
  const pointsRates = useMemo(() => {
    const sources: LivePlayer[] = [];
    if (Array.isArray(live?.players)) sources.push(...live!.players!);
    for (const g of groups) {
      if (Array.isArray(g.live?.players)) sources.push(...(g.live!.players ?? []));
    }
    let xp = 0, cp = 0, ep = 0, lp = 0;
    for (const p of sources) {
      if (p.exphr && p.exphr > xp) xp = p.exphr;
      if (p.cphr  && p.cphr  > cp) cp = p.cphr;
      if (p.ephr  && p.ephr  > ep) ep = p.ephr;
      if (p.lphr  && p.lphr  > lp) lp = p.lphr;
    }
    return { xp, cp, ep, lp };
  }, [live?.players, groups]);
  const effPlayers: LivePlayer[] = filtered ? filtered.players : (Array.isArray(live?.players) ? live!.players! : []);
  const effPartyDamage = filtered ? filtered.partyDamage : (live?.partyDamage ?? 0);
  const effPartyDps    = filtered ? filtered.partyDps    : (live?.partyDps    ?? 0);
  const max = effPlayers.reduce((m, p) => Math.max(m, p.damage), 0) || 1;
  const labelMap = useMemo(() => (anon ? buildLabelMap(effPlayers) : {}), [anon, effPlayers]);
  const label = (n: string) => labelMap[n] ?? n;

  // HP bar source - the focused mob's target entry. Already resolved above
  // (focusedMob.target). Aliased here for clarity at the use site.
  const focusTarget = focusedMob?.target ?? null;

  // Scale the whole overlay via CSS zoom. The logical size is divided by the
  // scale so that, once zoomed, it still fills the (resizable) window exactly.
  const rootStyle: CSSProperties = { width: `${100 / scale}vw`, height: `${100 / scale}vh` };
  (rootStyle as Record<string, unknown>).zoom = scale;

  return (
    <div className="relative p-1.5 text-white" style={rootStyle}>
      {/* Resize hit zones. Sit in the 6px padding gap around the inner frame
          (plus 12×12 corners that overlap a touch into the frame for easier
          diagonal grabs). Invisible - pointer cursor only - and z-20 so they
          win over content underneath. Headless overlay would otherwise need
          pixel-perfect aim on a 1-2px native border. */}
      {inTauri && <>
        <div onPointerDown={startResize('North')}     className="absolute top-0    left-3  right-3 h-1.5 cursor-n-resize  z-20" />
        <div onPointerDown={startResize('South')}     className="absolute bottom-0 left-3  right-3 h-1.5 cursor-s-resize  z-20" />
        <div onPointerDown={startResize('West')}      className="absolute top-3    bottom-3 left-0 w-1.5 cursor-w-resize  z-20" />
        <div onPointerDown={startResize('East')}      className="absolute top-3    bottom-3 right-0 w-1.5 cursor-e-resize z-20" />
        <div onPointerDown={startResize('NorthWest')} className="absolute top-0    left-0  w-3 h-3   cursor-nw-resize z-20" />
        <div onPointerDown={startResize('NorthEast')} className="absolute top-0    right-0 w-3 h-3   cursor-ne-resize z-20" />
        <div onPointerDown={startResize('SouthWest')} className="absolute bottom-0 left-0  w-3 h-3   cursor-sw-resize z-20" />
        <div onPointerDown={startResize('SouthEast')} className="absolute bottom-0 right-0 w-3 h-3   cursor-se-resize z-20" />
      </>}
      <div className="h-full flex flex-col backdrop-blur-md border border-white/15 rounded-lg overflow-hidden" style={{
        backgroundColor: theme === 'minimal'
          ? `rgba(0, 0, 0, ${opacity})`
          : `color-mix(in srgb, var(--color-background) ${Math.round(opacity * 100)}%, transparent)`,
      }}>
        {/* Drag strip / header - zone title on the left (draggable), window
            controls on the right (NOT a drag region, so they stay clickable). */}
        <div data-tauri-drag-region className="flex items-center justify-between gap-2 pl-3 pr-1 py-1 border-b border-white/10 select-none">
          <div data-tauri-drag-region className="flex items-center gap-2 min-w-0 cursor-move">
            <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${paused ? 'bg-rose-500' : recording ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`} />
            <span className="text-sm font-bold text-accent truncate">{recording ? zoneTitle : 'Idle'}</span>
            {recording && <span className="text-xs font-mono text-gray-300 shrink-0">{mmss(live?.elapsed ?? 0)}</span>}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={togglePin} aria-label="Always on top" title={pinned ? 'Always on top: on' : 'Always on top: off'} className={`${CTRL} ${pinned ? 'text-accent' : 'text-gray-500'}`}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 17v5" /><path d="M9 10.76V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6.76a2 2 0 0 0 .59 1.41l1.7 1.7A1 1 0 0 1 17.59 16H6.41a1 1 0 0 1-.7-1.71l1.7-1.7A2 2 0 0 0 8 11.16" />
              </svg>
            </button>
            <button onClick={minimizeToTaskbar} aria-label="Minimize" title="Minimize to taskbar" className={`${CTRL} text-gray-400 hover:text-gray-100`}>
              <svg width="13" height="13" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 9.5h7" /></svg>
            </button>
            <button onClick={() => { win?.hide().catch(() => {}); emit('styx://overlay-hidden').catch(() => {}); }} aria-label="Close" title="Close overlay (reopen from the Overlay tab)" className={`${CTRL} text-gray-400 hover:text-red-400`}>
              <svg width="13" height="13" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.3"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg>
            </button>
          </div>
        </div>

        {!demo && recording && (() => {
          const focusedLabel = focusedMob?.label ?? focus?.name ?? null;
          return (
          <div className={`border-b relative ${paused ? 'border-rose-500/70 bg-rose-500/[0.04]' : 'border-white/10'}`}>
            <button
              onClick={() => setFocusOpen(o => !o)}
              className="w-full flex items-center gap-2 px-3 py-1 text-left hover:bg-white/[0.05] transition-colors"
              data-tooltip={paused ? 'Paused - click any mode in the meter to resume' : focus ? `Focused on ${focusedLabel} - click to change` : 'Focus on a specific mob'}
            >
              {focus && focusTarget ? (
                <div key={`focus-${focus.id ?? focus.name}`} className={`focus-mob-in relative flex-1 min-w-0 h-6 rounded overflow-hidden ${paused ? 'ring-2 ring-rose-500/70 ring-inset' : ''} ${(focusTarget.hpp ?? 0) <= 0 ? 'bg-rose-500/10' : 'bg-white/[0.04]'}`}>
                  {(() => {
                    const hpp = Math.max(0, Math.min(100, focusTarget.hpp ?? 0));
                    const isDead = hpp === 0;
                    const barColor = hpp >= 60 ? 'bg-emerald-500/40' : hpp >= 25 ? 'bg-amber-500/40' : 'bg-rose-500/40';
                    return (
                      <>
                        <div className={`absolute inset-y-0 left-0 hp-bar-fill ${barColor}`} style={{ width: `${hpp}%` }} />
                        <div className="relative flex items-center justify-between gap-2 px-2.5 h-full text-xs">
                          <span className={`font-medium truncate ${isDead ? 'text-gray-400 line-through' : 'text-gray-100'}`}>{focusedLabel}</span>
                          <span className={`font-mono shrink-0 ${isDead ? 'text-rose-300/80 uppercase text-[10px] tracking-wide' : 'text-gray-200'}`}>{isDead ? 'Killed' : `${hpp}%`}</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              ) : (
                <span className="flex-1 text-[11px] text-gray-300 truncate">{focusedLabel ?? 'All mobs'}</span>
              )}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-gray-500 transition-transform ${focusOpen ? 'rotate-180' : ''}`}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {focusOpen && (() => {
              const renderRow = (m: EngagedMob) => {
                const hpp = Math.max(0, Math.min(100, m.target.hpp ?? 0));
                const isDead = hpp === 0;
                const barColor = isDead ? 'bg-rose-500/20' : hpp >= 60 ? 'bg-emerald-500/40' : hpp >= 25 ? 'bg-amber-500/40' : 'bg-rose-500/40';
                const isFocused = focus !== null && matchesFocus(m, focus);
                const itemKey = m.kill_seq != null ? `kill-${m.kill_seq}` : m.id != null ? `id-${m.id}` : `name-${m.label}`;
                return (
                  <button
                    key={itemKey}
                    onClick={() => {
                      setFocus({ id: m.id, kill_seq: m.kill_seq, name: m.name });
                      setFocusOpen(false);
                      if (mode !== 'paused') setMode('focus');
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-white/[0.08] transition-colors ${isFocused ? 'text-accent' : 'text-gray-200'}`}
                  >
                    <span className={`truncate flex-1 min-w-0 ${isDead ? 'line-through text-gray-400' : ''}`}>{m.label}</span>
                    <span className="relative w-14 h-3 rounded overflow-hidden bg-white/[0.06] shrink-0">
                      <span className={`absolute inset-y-0 left-0 hp-bar-fill ${barColor}`} style={{ width: isDead ? '100%' : `${hpp}%` }} />
                    </span>
                    <span className={`font-mono text-[10px] shrink-0 w-10 text-right ${isDead ? 'text-rose-300/70 uppercase' : 'text-gray-400'}`}>{isDead ? 'killed' : `${hpp}%`}</span>
                  </button>
                );
              };
              return (
                <div className="absolute left-0 right-0 top-full z-10 border-t border-white/10 bg-black/90 backdrop-blur-md shadow-lg max-h-64 overflow-y-auto">
                  <button
                    onClick={() => {
                      setFocus(null);
                      setFocusOpen(false);
                      if (mode !== 'paused') setMode('all-mobs');
                    }}
                    className={`w-full flex items-center px-3 py-1.5 text-left text-[11px] hover:bg-white/[0.08] transition-colors ${focus === null ? 'text-accent' : 'text-gray-200'}`}
                  >
                    All mobs
                  </button>
                  <div className="px-3 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-gray-500 font-semibold border-t border-white/5">Live</div>
                  {liveMobs.length === 0 ? (
                    <div className="px-3 py-1 text-[11px] text-gray-500 italic">No mobs engaged</div>
                  ) : liveMobs.map(renderRow)}
                  {(killEvents.length > 0 || historySearch) && (
                    <>
                      <div className="flex items-center gap-2 px-3 pt-1.5 pb-1 border-t border-white/5">
                        <span className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">History</span>
                        <span className="text-[9px] text-gray-500 font-mono">({killEvents.length})</span>
                        <input
                          type="text"
                          value={historySearch}
                          onChange={e => setHistorySearch(e.target.value)}
                          placeholder="Search…"
                          onClick={e => e.stopPropagation()}
                          className="ml-auto bg-white/[0.04] border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-accent/40 w-24"
                        />
                      </div>
                      {killedMobs.length === 0 ? (
                        <div className="px-3 py-1 text-[10px] text-gray-500 italic">No matches</div>
                      ) : killedMobs.map(renderRow)}
                    </>
                  )}
                </div>
              );
            })()}
          </div>
          );
        })()}

        {/* Zone switcher - only when multiple simultaneous encounters are live */}
        {!demo && groups.length > 1 && (
          <div className="flex items-center gap-1 px-2 py-1 border-b border-white/10 overflow-x-auto">
            {groups.map(g => {
              const on = g.key === (selected?.key ?? -999);
              return (
                <button
                  key={g.key}
                  onClick={() => setSelectedZone(g.key)}
                  data-tooltip={`${g.zoneName} - ${fmt(g.live.partyDps ?? 0)} DPS`}
                  className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                    on ? 'bg-accent/20 border-accent/50 text-accent' : 'border-white/10 text-gray-400 hover:bg-white/[0.06]'
                  }`}
                >
                  {g.zoneName}
                </button>
              );
            })}
          </div>
        )}

        {recording && (
          <>
            {/* Party summary - three-column flex: pause button on the left,
                centered metrics, deaths on the right. The pause toggle
                freezes the overlay's view of `live` so the user can browse
                killed-mob history without the screen ticking on (the addon
                keeps tracking in the background; unpause snaps back to the
                latest stream). Labels read TOTAL DPS / TOTAL DAMAGE; values
                come from effPartyDps / effPartyDamage. */}
            <div className="flex items-center justify-between gap-3 px-3 py-1 border-b border-white/5 text-[11px]">
              <div className="flex items-center gap-4 min-w-0">
                <span className="flex items-baseline gap-1.5">
                  <span className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">Total DPS</span>
                  <span className="text-accent font-mono font-semibold">{fmt(effPartyDps)}</span>
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">Total Damage</span>
                  <span className="text-gray-300 font-mono">{fmt(effPartyDamage)}</span>
                </span>
              </div>
              <div className="flex items-center gap-1 rounded-md bg-white/[0.04] border border-white/[0.08] p-0.5 shrink-0">
                <button
                  onClick={() => setMode('all-mobs')}
                  aria-label="All Mobs mode"
                  aria-pressed={mode === 'all-mobs'}
                  data-tooltip="All Mobs - show combined stats across every engaged mob"
                  className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${mode === 'all-mobs' ? 'text-accent bg-accent/20' : 'text-gray-400 hover:text-gray-100 hover:bg-white/10'}`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <rect x="3"  y="14" width="4" height="7"  rx="1" />
                    <rect x="10" y="9"  width="4" height="12" rx="1" />
                    <rect x="17" y="4"  width="4" height="17" rx="1" />
                  </svg>
                </button>
                <button
                  onClick={() => setMode('focus')}
                  aria-label="Focus mode"
                  aria-pressed={mode === 'focus'}
                  data-tooltip="Focus - lock on a single mob (auto-promotes / follows target if enabled)"
                  className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${mode === 'focus' ? 'text-accent bg-accent/20' : 'text-gray-400 hover:text-gray-100 hover:bg-white/10'}`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="8" />
                    <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
                    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                  </svg>
                </button>
                <button
                  onClick={() => setMode(mode === 'paused' ? 'all-mobs' : 'paused')}
                  aria-label={mode === 'paused' ? 'Resume' : 'Pause overlay'}
                  aria-pressed={mode === 'paused'}
                  data-tooltip={mode === 'paused' ? 'Paused - click any mode to resume' : 'Pause - freeze the overlay so you can browse killed-mob history'}
                  className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${mode === 'paused' ? 'text-accent bg-accent/20' : 'text-gray-400 hover:text-gray-100 hover:bg-white/10'}`}
                >
                  {mode === 'paused' ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="5" width="4" height="14" rx="1" />
                      <rect x="14" y="5" width="4" height="14" rx="1" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-center gap-x-4 gap-y-1 px-3 py-1 border-b border-white/5 text-[11px] flex-wrap">
              <span className="flex items-baseline gap-1.5">
                <span className="text-[9px] uppercase tracking-wider text-emerald-400/70 font-semibold">EXP</span>
                <span className="text-emerald-300 font-mono" title={`${fmt(pointsRates.xp)} EXP/hr`}>{fmtCompact(pointsRates.xp)}<span className="text-emerald-400/50 text-[9px] ml-0.5">/HR</span></span>
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-[9px] uppercase tracking-wider text-amber-400/70 font-semibold">LP</span>
                <span className="text-amber-300 font-mono" title={`${fmt(pointsRates.lp)} LP/hr`}>{fmtCompact(pointsRates.lp)}<span className="text-amber-400/50 text-[9px] ml-0.5">/HR</span></span>
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-[9px] uppercase tracking-wider text-sky-400/70 font-semibold">CP</span>
                <span className="text-sky-300 font-mono" title={`${fmt(pointsRates.cp)} CP/hr`}>{fmtCompact(pointsRates.cp)}<span className="text-sky-400/50 text-[9px] ml-0.5">/HR</span></span>
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-[9px] uppercase tracking-wider text-violet-400/70 font-semibold">EP</span>
                <span className="text-violet-300 font-mono" title={`${fmt(pointsRates.ep)} EP/hr`}>{fmtCompact(pointsRates.ep)}<span className="text-violet-400/50 text-[9px] ml-0.5">/HR</span></span>
              </span>
            </div>
          </>
        )}

        {/* Players */}
        <div className="flex-1 overflow-y-auto px-2 py-1.5 space-y-1">
          {!recording ? (
            <div className="text-[11px] text-gray-500 italic px-1 py-3 text-center">Idle - start tracking to see live damage.</div>
          ) : effPlayers.length === 0 ? (
            <div className="text-[11px] text-gray-500 italic px-1 py-3 text-center">
              {focus ? `No damage to ${focusedMob?.label ?? focus.name} yet…` : 'Waiting for combat…'}
            </div>
          ) : (
            effPlayers.map((p, i) => {
              const jk = mainJobKey(p.job);
              if (compact) {
                return (
                  <div key={p.name} className="player-row-in relative rounded px-2 py-0.5 overflow-hidden">
                    <div className="absolute inset-0 dmg-bar-fill bg-accent/15 rounded" style={{ width: `${(p.damage / max) * 100}%` }} />
                    <div className="relative flex items-center gap-1.5 text-[11px]">
                      {p.job === 'CLOWN'
                        ? <span className="shrink-0 text-[13px] leading-none">🤡</span>
                        : <span className={`${JOB_BADGE[p.job ?? ''] ?? 'bg-slate-700'} text-white text-[9px] font-bold px-1 py-0.5 rounded shrink-0`}>{p.job || '?'}</span>}
                      <span className="font-medium text-gray-100 truncate flex-1">{label(p.name)}</span>
                      <span className="text-gray-400 shrink-0">{p.pct ?? 0}%</span>
                      <span className="font-mono text-accent shrink-0">{fmt(p.dps)} <span className="text-gray-500 text-[9px] font-sans">DPS</span></span>
                      <span className="font-mono text-gray-400 shrink-0">{fmt(p.damage)}</span>
                    </div>
                  </div>
                );
              }
              return (
              <div key={p.name} className="player-row-in relative rounded px-2 py-1 overflow-hidden">
                <div className="absolute inset-0 dmg-bar-fill bg-accent/15 rounded" style={{ width: `${(p.damage / max) * 100}%` }} />
                <div className="relative flex items-center gap-2.5">
                  {p.job === 'CLOWN'
                    ? <span className="w-9 h-9 shrink-0 flex items-center justify-center text-2xl leading-none">🤡</span>
                    : jk
                    ? <img src={imgSrc(JOB_ICONS[jk])} alt={jk.toUpperCase()} className="w-9 h-9 shrink-0 object-contain" />
                    : <span className="w-9 shrink-0 text-center text-gray-500 font-mono">{i + 1}</span>}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium text-gray-100 truncate flex-1">{label(p.name)}</span>
                      <span className="font-mono text-accent shrink-0">{fmt(p.dps)} <span className="text-gray-500 text-[10px] font-sans">DPS</span></span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-0.5">
                      <span className="text-gray-400">{p.pct ?? 0}%</span>
                      {p.acc != null && <span className="text-sky-400/80">{p.acc}% acc</span>}
                      {p.crit != null && <span className="text-sky-400/80">{p.crit}% crit</span>}
                      <span className="ml-auto font-mono text-gray-400">{fmt(p.damage)} <span className="text-gray-500 font-sans">TOTAL</span></span>
                    </div>
                  </div>
                </div>
              </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
