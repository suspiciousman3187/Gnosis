import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
const EncounterView = lazy(() => import('@/components/EncounterView'));
const ContentView = lazy(() => import('./ContentView'));
import TrackingControls from './TrackingControls';
import LoadingScreen from './LoadingScreen';
import { startMultibox } from './multibox';
import TitleBar from './TitleBar';
const TrendsView = lazy(() => import('./TrendsView'));
const CompareView = lazy(() => import('./CompareView'));
import NavRail, { type Section } from './NavRail';
import { useAdminStatus } from './useAdminStatus';
import LiveView from './LiveView';
import LootView from './LootView';
import ActivitiesView from './ActivitiesView';
import HistoryView from './HistoryView';
import HomeDashboard from './HomeDashboard';
import IdleQuote from './IdleQuote';
import { flushIndexImmediate } from './encounterIndex';
import {
  bindDir as bindStoreDir,
  pruneStore,
  clearStore,
  requestSummaries as storeRequestSummaries,
  requestLoots as storeRequestLoots,
  evictLootsExcept,
  useSummariesRecord,
  useLootsRecord,
  useEnemyKillHistory,
  ensureDbReady as ensureStoreIndexLoaded,
} from './summaryStore';
import SettingsView from './SettingsView';
import DiagnosticsView from './DiagnosticsView';
import OverlayView from './OverlayView';
import ShareButton from './ShareButton';
import ExportAnonymizedButton from './ExportAnonymizedButton';
import type { ActivityEncounter } from '@/lib/contentAggregator';
import { ItemIconContext } from '@/components/ItemIcon';
import { BuffIconContext } from '@/components/BuffIcon';
import { anonymize } from './anonymize';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { inTauri, listReportFiles, readText, deleteFile, fileTs, readTrackerStatus, writeTrackerControl, readTrackerPrefs, writeTrackerPrefs, compressIdleFiles } from './library';
import { showOverlay, hideOverlay, setOverlayClickthrough } from './overlay';
import { getCheckOnStartupEnabled } from './updater';
import StartupUpdateCheck from './StartupUpdateCheck';
import UpdateBannerDemo from './UpdateBannerDemo';
import WelcomeWizard, { isFtueCompleted } from './WelcomeWizard';
import DialogHost from '@/components/DialogHost';
import TooltipHost from '@/components/TooltipHost';
import { startMemoryMonitor, setMonitorSection } from './memoryMonitor';
import { getDisplayLanguage } from '@/lib/displayLanguage';
import { ensureBundlesLoaded, TRANSLATE_BUNDLES } from '@/lib/translate';
import { useSilentModeBootSync } from './silentMode';
import { listen } from '@tauri-apps/api/event';
import { kindFromName, labelFromName, loadContent, fileChar, mergeContents, representativeLootSummaries, DEFAULT_TRACKER_PREFS, type ContentKind, type LoadedContent, type TrackerStatus, type TrackingMode, type TrackerPrefs } from './content';
import type { EncounterMetrics } from '@/lib/combatStats';

const DIR_KEY = 'ff_data_dir';
const DEFAULT_DIR = 'C:\\Program Files (x86)\\Windower Dev\\addons\\Gnosis\\data';
const THEME_KEY = 'ff_theme';
const BUFFSET_KEY = 'ff_buffset';
const ANON_KEY = 'ff_anon';
const BG_BRIGHTNESS_KEY = 'ff_bg_brightness';
// `bg-fit` is now an automatic consequence of theme choice (THEME_BG_FIT
// below) - no separate localStorage key, no user-facing toggle.
type BgFit = 'cover' | 'center' | 'contain' | 'right' | 'left';
const AUTO_OPEN_KEY = 'ff_auto_open';
const ANON_SHARE_KEY = 'ff_anon_share';
const UI_SCALE_KEY = 'ff_ui_scale';
const OVERLAY_SCALE_KEY = 'ff_overlay_scale';
const OVERLAY_DEMO_KEY = 'ff_overlay_demo';
const OVERLAY_COMPACT_KEY = 'ff_overlay_compact';
const OVERLAY_OPACITY_KEY = 'ff_overlay_opacity';

type Theme = 'gnosis' | 'dawn' | 'crimson' | 'minimal';
const THEME_IDS: Theme[] = ['gnosis', 'dawn', 'crimson', 'minimal'];
const DEFAULT_THEME: Theme = 'gnosis';

const THEME_BG_FIT: Record<Theme, BgFit> = {
  gnosis:  'center',  // Fill (center) - Nahida wallpaper
  dawn:    'cover',   // Fill (top) - original twilight-navy theme
  crimson: 'center',  // Fill (center) - LesserEvil
  minimal: 'cover',
};
export type BuffSet = 'off' | 'classic' | 'jeanpaul' | 'xiview';

const KIND_ORDER: ContentKind[] = ['sortie', 'encounter'];

export type EncSummary = {
  zone: string | null;
  zones: string[];
  dur: number;
  enemies: number;
  enemyNames: string[];
  playerNames: string[];
  jobs: string[];
  source: string | null;
  contentDefId?: string | null;
  ts: number;
  metrics: EncounterMetrics;
  sortie?: {
    defeated: number;
    aminon: { mode: 'normal' | 'hardmode'; killed: boolean } | null;
  };
};

// IdleQuote moved to its own file so LiveView / the History empty state
// can reuse it too. See ./IdleQuote.tsx.

export default function App() {
  const [demoHash, setDemoHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setDemoHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const [ftueDone, setFtueDone] = useState<boolean>(() => !inTauri || isFtueCompleted());
  if (demoHash === '#updater-demo') {
    return <UpdateBannerDemo onClose={() => { window.location.hash = ''; }} />;
  }
  if (!ftueDone) {
    return (
      <WelcomeWizard
        onComplete={(picked: string) => {
          try { localStorage.setItem('ff_data_dir', picked); } catch { /* ignore */ }
          setFtueDone(true);
        }}
      />
    );
  }
  return <AppMain />;
}

function AppMain() {
  const firstLaunchRef = useRef(false);
  const [dir, setDir] = useState<string>(() => {
    // Rebrand migration: a saved path still pointing at the old Styx addon folder
    // follows to Gnosis (the folder was renamed, taking the data with it).
    const saved = localStorage.getItem(DIR_KEY);
    if (saved) return saved.replace(/([\\/])Styx([\\/]data)$/i, '$1Gnosis$2');
    firstLaunchRef.current = true;
    return DEFAULT_DIR;
  });

  useEffect(() => {
    if (!firstLaunchRef.current || !inTauri) return;
    let alive = true;
    (async () => {
      try {
        const detected = await invoke<string | null>('find_addon_data_dir');
        if (alive && typeof detected === 'string' && detected.length > 0) {
          setDir(detected);
        }
      } catch { /* keep DEFAULT_DIR */ }
    })();
    return () => { alive = false; };
  }, []);
  const [paths, setPaths] = useState<string[]>([]);
  const encSummaries = useSummariesRecord();
  const lootSummaries = useLootsRecord();
  const enemyHistory = useEnemyKillHistory();
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<LoadedContent | null>(null);
  const [loading, setLoading] = useState(false);
  const MIN_LOADER_MS = 1500;
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { startMultibox(); }, []);
  useEffect(() => { startMemoryMonitor(); }, []);
  useSilentModeBootSync();
  useEffect(() => { if (getDisplayLanguage() !== 'auto') void ensureBundlesLoaded(TRANSLATE_BUNDLES); }, []);
  useEffect(() => {
    const onBeforeUnload = () => { void flushIndexImmediate(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
  const [startupCheckActive, setStartupCheckActive] = useState<boolean | null>(() => {
    if (!inTauri) return false;
    if (!getCheckOnStartupEnabled()) return false;
    return null;
  });
  useEffect(() => {
    if (startupCheckActive !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const alreadyDone = await invoke<boolean>('was_startup_check_done');
        if (!cancelled) setStartupCheckActive(!alreadyDone);
      } catch {
        if (!cancelled) setStartupCheckActive(true);
      }
    })();
    return () => { cancelled = true; };
  }, [startupCheckActive]);
  useEffect(() => {
    void import('@/components/EncounterView');
    void import('./ContentView');
  }, []);
  const [theme, setTheme] = useState<Theme>(() => {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'meadow') return 'gnosis';
    if (v === 'regular' || v === 'styx') return DEFAULT_THEME;
    return THEME_IDS.includes(v as Theme) ? (v as Theme) : DEFAULT_THEME;
  });
  const [buffSet, setBuffSet] = useState<BuffSet>(() => (localStorage.getItem(BUFFSET_KEY) as BuffSet) || 'xiview');
  const [anon, setAnon] = useState<boolean>(() => localStorage.getItem(ANON_KEY) === '1');
  const [anonOnShare, setAnonOnShare] = useState<boolean>(() => localStorage.getItem(ANON_SHARE_KEY) !== '0');
  const [bgBrightness, setBgBrightness] = useState<number>(() => {
    const v = parseFloat(localStorage.getItem(BG_BRIGHTNESS_KEY) ?? '');
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 1;
  });
  const bgFit: BgFit = THEME_BG_FIT[theme];
  const [autoOpenNew, setAutoOpenNew] = useState<boolean>(() => localStorage.getItem(AUTO_OPEN_KEY) !== '0');
  const [uiScale, setUiScale] = useState<number>(() => {
    const v = parseFloat(localStorage.getItem(UI_SCALE_KEY) ?? '');
    return Number.isFinite(v) && v >= 1 && v <= 1.8 ? v : 1;
  });
  const autoOpenRef = useRef(autoOpenNew);
  const prevPathsRef = useRef<Set<string> | null>(null);
  const loadedDirRef = useRef<string | null>(null);
  const lastCompressMs = useRef(0);
  const [autoOpenPath, setAutoOpenPath] = useState<string | null>(null);
  const [trackPrefs, setTrackPrefs] = useState<TrackerPrefs>(DEFAULT_TRACKER_PREFS);
  const pendingMode = useRef<{ mode: TrackingMode; until: number } | null>(null);
  const offReadStreak = useRef(0);
  const [section, setSection] = useState<Section>('home');
  const [origin, setOrigin] = useState<Section | null>(null);
  const { isAdmin } = useAdminStatus();
  useEffect(() => {
    if (section === 'diagnostics' && !isAdmin) setSection('home');
  }, [section, isAdmin]);
  useEffect(() => { setMonitorSection(section); }, [section]);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayCT, setOverlayCT] = useState(false);
  const [overlayScale, setOverlayScale] = useState<number>(() => parseFloat(localStorage.getItem(OVERLAY_SCALE_KEY) || '1') || 1);
  const [overlayDemo, setOverlayDemo] = useState<boolean>(() => localStorage.getItem(OVERLAY_DEMO_KEY) === '1');
  const [overlayCompact, setOverlayCompact] = useState<boolean>(() => localStorage.getItem(OVERLAY_COMPACT_KEY) === '1');
  const [overlayOpacity, setOverlayOpacity] = useState<number>(() => parseFloat(localStorage.getItem(OVERLAY_OPACITY_KEY) || '0.72') || 0.72);

  const toggleOverlay = async () => {
    if (overlayOpen) { await hideOverlay(); setOverlayOpen(false); }
    else { await showOverlay(true); if (overlayCT) await setOverlayClickthrough(true); setOverlayOpen(true); }
  };
  const toggleCT = async () => { const n = !overlayCT; setOverlayCT(n); await setOverlayClickthrough(n); };

  useEffect(() => {
    if (!inTauri) return;
    const unlisten = listen('styx://overlay-hidden', () => setOverlayOpen(false));
    return () => { unlisten.then(fn => fn()).catch(() => {}); };
  }, []);

  useEffect(() => { localStorage.setItem(DIR_KEY, dir); }, [dir]);
  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.dataset.theme = theme;
    delete document.documentElement.dataset.gnosisPalette;
  }, [theme]);
  useEffect(() => { localStorage.setItem(BUFFSET_KEY, buffSet); }, [buffSet]);
  useEffect(() => { localStorage.setItem(ANON_KEY, anon ? '1' : '0'); }, [anon]);
  useEffect(() => {
    localStorage.setItem(BG_BRIGHTNESS_KEY, String(bgBrightness));
    // Brightness 1 = wallpaper as the theme intends; lower adds a black dim.
    document.documentElement.style.setProperty('--styx-user-dim', String(Math.max(0, Math.min(0.9, 1 - bgBrightness))));
  }, [bgBrightness]);
  useEffect(() => { document.documentElement.dataset.bgfit = bgFit; }, [bgFit]);
  useEffect(() => { localStorage.setItem(AUTO_OPEN_KEY, autoOpenNew ? '1' : '0'); autoOpenRef.current = autoOpenNew; }, [autoOpenNew]);
  useEffect(() => { localStorage.setItem(ANON_SHARE_KEY, anonOnShare ? '1' : '0'); }, [anonOnShare]);
  useEffect(() => {
    localStorage.setItem(UI_SCALE_KEY, String(uiScale));
    const el = (document.getElementById('zoom-wrapper') ?? document.documentElement) as HTMLElement;
    (el.style as CSSStyleDeclaration & { zoom: string }).zoom = String(uiScale);
    // Clear the html zoom in case a previous version of this app left it set.
    if (el !== document.documentElement) {
      (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = '';
    }
  }, [uiScale]);
  useEffect(() => { localStorage.setItem(OVERLAY_SCALE_KEY, String(overlayScale)); }, [overlayScale]);
  useEffect(() => { localStorage.setItem(OVERLAY_DEMO_KEY, overlayDemo ? '1' : '0'); }, [overlayDemo]);
  useEffect(() => { localStorage.setItem(OVERLAY_COMPACT_KEY, overlayCompact ? '1' : '0'); }, [overlayCompact]);
  useEffect(() => { localStorage.setItem(OVERLAY_OPACITY_KEY, String(overlayOpacity)); }, [overlayOpacity]);

  // Persisted tracking defaults (mode + fight idle timeout). Loaded from the
  // shared prefs file the addon also restores on load.
  useEffect(() => {
    if (!inTauri || !dir) return;
    let alive = true;
    readTrackerPrefs(dir).then(p => { if (alive) setTrackPrefs(p); });
    return () => { alive = false; };
  }, [dir]);
  // Change a default: persist it (survives an offline addon) AND push a live
  // command so a running addon applies it immediately.
  const changeTrackPrefs = useCallback(async (next: TrackerPrefs) => {
    setTrackPrefs(next);
    try {
      await writeTrackerPrefs(dir, next);
      await writeTrackerControl(dir, { mode: next.mode, idleTimeout: next.idleTimeout, lightweight: next.lightweight, disableMovement: next.disableMovement, trackCurrency: next.trackCurrency });
      pendingMode.current = { mode: next.mode, until: Date.now() + 6000 };
      setStatus(prev => (prev ? { ...prev, mode: next.mode, idleTimeout: next.idleTimeout } : prev));
    } catch (e) { setError(String(e)); }
  }, [dir]);

  // Poll the addon's published tracking state (faster than the file list so the
  // live timer and mode stay responsive).
  useEffect(() => {
    if (!inTauri || !dir) return;
    let alive = true;
    const OFF_DEBOUNCE_TICKS = 3;
    const tick = async () => {
      const s = await readTrackerStatus(dir);
      if (!alive) return;
      if (!s) return;
      const pend = pendingMode.current;
      if (pend) {
        if (s.mode === pend.mode) pendingMode.current = null;
        else if (Date.now() < pend.until) { setStatus({ ...s, mode: pend.mode }); return; }
        else pendingMode.current = null;
      }
      let effectiveMode: TrackingMode = s.mode;
      setStatus(prev => {
        if (prev && s.mode === 'off' && prev.mode !== 'off') {
          offReadStreak.current += 1;
          if (offReadStreak.current < OFF_DEBOUNCE_TICKS) {
            effectiveMode = prev.mode;
            return { ...s, mode: prev.mode };
          }
        } else {
          offReadStreak.current = 0;
        }
        return s;
      });
      setTrackPrefs(p => (effectiveMode !== p.mode ? { ...p, mode: effectiveMode } : p));
    };
    tick();
    const id = setInterval(() => { if (!document.hidden) void tick(); }, 1500);
    const onVis = () => { if (!document.hidden) void tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [dir]);

  // A fresh status file means the addon is loaded and writing (15s idle heartbeat).
  const connected = !!status && (Date.now() / 1000 - status.updatedAt) < 25;

  const sendCommand = useCallback(async (cmd: { mode?: TrackingMode; action?: 'save' }) => {
    setBusy(true);
    try {
      await writeTrackerControl(dir, cmd);
      // Optimistic: reflect the command immediately; pin it until the addon confirms.
      if (cmd.mode) {
        pendingMode.current = { mode: cmd.mode, until: Date.now() + 6000 };
        setStatus(prev => (prev ? { ...prev, mode: cmd.mode! } : prev));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [dir]);

  const upgradeArchivalMetrics = useCallback(async () => {
    return;
  }, []);

  const refreshing = useRef(false);

  const refresh = useCallback(async (opts?: { synthLoot?: boolean }) => {
    if (!inTauri || !dir || refreshing.current) return;
    refreshing.current = true;
    try {
      bindStoreDir(dir);
      await ensureStoreIndexLoaded(dir);

      try { await invoke('scan_glog_dir', { dir }); } catch (e) { console.warn('scan_glog_dir failed', e); }

      const files = await listReportFiles(dir);
      const firstForDir = loadedDirRef.current !== dir;
      const known = prevPathsRef.current;
      const newly = firstForDir || !known
        ? []
        : files.filter(p => !known.has(p) && KIND_ORDER.includes(kindFromName(p)!));
      prevPathsRef.current = new Set(files);
      loadedDirRef.current = dir;
      setPaths(prev => {
        if (prev.length === files.length) {
          let same = true;
          for (let i = 0; i < files.length; i++) {
            if (prev[i] !== files[i]) { same = false; break; }
          }
          if (same) return prev;
        }
        return files;
      });
      setError(null);

      const alive = new Set(files);
      pruneStore(alive);

      if (opts?.synthLoot) {
        storeRequestLoots(files);
      }

      const COMPRESS_THROTTLE_MS = 10 * 60 * 1000;
      if (dir && Date.now() - lastCompressMs.current > COMPRESS_THROTTLE_MS) {
        lastCompressMs.current = Date.now();
        void compressIdleFiles(dir, 600).catch(() => {});
      }

      if (autoOpenRef.current && newly.length > 0) {
        setAutoOpenPath(newly.reduce((a, b) => (fileTs(b) >= fileTs(a) ? b : a)));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      refreshing.current = false;
    }
  }, [dir]);

  useEffect(() => {
    if (!inTauri) return;
    void refresh();
    const id = setInterval(() => {
      if (document.hidden) return;
      refresh();
    }, 8000);
    let purgeTimer: number | null = null;
    const PURGE_AFTER_HIDDEN_MS = 30_000;
    const purgeCaches = () => {
      loadedDirRef.current = null;
      prevPathsRef.current = null;
      clearStore();
    };
    const onVis = () => {
      if (document.hidden) {
        if (purgeTimer == null) {
          purgeTimer = window.setTimeout(() => { purgeCaches(); purgeTimer = null; }, PURGE_AFTER_HIDDEN_MS);
        }
      } else {
        if (purgeTimer != null) { clearTimeout(purgeTimer); purgeTimer = null; }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      if (purgeTimer != null) clearTimeout(purgeTimer);
    };
  }, [refresh, section]);

  useEffect(() => {
    if (section !== 'trends' && section !== 'compare') return;
    void upgradeArchivalMetrics();
  }, [section, upgradeArchivalMetrics]);

  useEffect(() => {
    if (section !== 'loot' && section !== 'activities') return;
    void refresh({ synthLoot: true });
  }, [section, refresh]);

  useEffect(() => {
    if (section === 'loot' || section === 'activities' || section === 'home') return;
    const t = setTimeout(() => {
      const HOME_LOOKBACK_SEC = 14 * 86400;
      const HOME_LOOT_CAP = 50;
      const cutoff = Math.floor(Date.now() / 1000) - HOME_LOOKBACK_SEC;
      const keep = new Set(
        paths
          .filter(p => fileTs(p) >= cutoff)
          .sort((a, b) => fileTs(b) - fileTs(a))
          .slice(0, HOME_LOOT_CAP)
      );
      evictLootsExcept(keep);
    }, 30_000);
    return () => clearTimeout(t);
  }, [section, paths]);

  useEffect(() => {
    if (section !== 'history' && section !== 'home') return;
    void refresh();
  }, [section, refresh]);


  useEffect(() => {
    if (section !== 'trends' && section !== 'compare') return;
    void refresh();
    if (paths.length) storeRequestSummaries(paths);
  }, [section, refresh, paths]);

  const loadIdRef = useRef(0);

  const loaderDeadlineRef = useRef(0);

  const open = async (path: string) => {
    const myId = ++loadIdRef.current;
    setOrigin(null);
    setSelected(path);
    if (loaderDeadlineRef.current < Date.now()) {
      loaderDeadlineRef.current = Date.now() + MIN_LOADER_MS;
    }
    setLoading(true);
    try {
      const text = await readText(path);
      if (loadIdRef.current !== myId) return;
      setContent(loadContent(path, text));
      setError(null);
    } catch (e) {
      if (loadIdRef.current !== myId) return;
      setError(String(e)); setContent(null);
    } finally {
      const remaining = loaderDeadlineRef.current - Date.now();
      if (remaining > 0) await new Promise(res => setTimeout(res, remaining));
      if (loadIdRef.current === myId) setLoading(false);
    }
  };

  const openGroup = async (members: string[]) => {
    const myId = ++loadIdRef.current;
    setOrigin(null);
    setSelected(members[0]);
    if (loaderDeadlineRef.current < Date.now()) {
      loaderDeadlineRef.current = Date.now() + MIN_LOADER_MS;
    }
    setLoading(true);
    try {
      const loaded = await Promise.all(members.map(async p => loadContent(p, await readText(p))));
      if (loadIdRef.current !== myId) return;
      setContent(mergeContents(loaded));
      setError(null);
    } catch (e) {
      if (loadIdRef.current !== myId) return;
      setError(String(e)); setContent(null);
    } finally {
      const remaining = loaderDeadlineRef.current - Date.now();
      if (remaining > 0) await new Promise(res => setTimeout(res, remaining));
      if (loadIdRef.current === myId) setLoading(false);
    }
  };

  const removeGroup = async (members: string[]) => {
    try {
      for (const p of members) await deleteFile(p);
      const set = new Set(members);
      setPaths(prev => {
        const next = prev.filter(p => !set.has(p));
        pruneStore(new Set(next));
        return next;
      });
      if (selected && set.has(selected)) { setSelected(null); setContent(null); }
    } catch (e) {
      setError(String(e));
    }
  };

  const loadPicked = (f: File) =>
    f.text()
      .then(t => { setContent(loadContent(f.name, t)); setSelected(f.name); setError(null); })
      .catch(e => setError(String(e)));

  const autoOpenGroupFor = useCallback((p: string): string[] => {
    const BUCKET = 30;
    const kind = kindFromName(p);
    if (!kind || !KIND_ORDER.includes(kind)) return [p];
    const zoneSig = (q: string): string => {
      const k = kindFromName(q);
      if (k !== 'encounter') return 'content-module';
      const enc = encSummaries[q];
      if (!enc) return `unparsed::${q}`;
      const zones = enc.zones?.length ? enc.zones : (enc.zone ? [enc.zone] : []);
      if (zones.length === 0) return `unzoned::${q}`;
      return zones.slice().sort().join('|');
    };
    const bucketKey = Math.round(fileTs(p) / BUCKET);
    const mySig = zoneSig(p);
    const siblings = paths.filter(other => {
      if (other === p) return true;
      if (kindFromName(other) !== kind) return false;
      if (Math.round(fileTs(other) / BUCKET) !== bucketKey) return false;
      return zoneSig(other) === mySig;
    });
    if (siblings.length < 2) return [p];
    const chars = siblings.map(fileChar);
    if (!chars.every(Boolean) || new Set(chars).size !== chars.length) return [p];
    return siblings;
  }, [paths, encSummaries]);

  useEffect(() => {
    if (!autoOpenPath) return;
    setSection('history');
    const members = autoOpenGroupFor(autoOpenPath);
    if (members.length > 1) openGroup(members); else open(autoOpenPath);
    setAutoOpenPath(null);
  }, [autoOpenPath, autoOpenGroupFor]);

  const activityEntries = useMemo<ActivityEncounter[]>(() => {
    const out: ActivityEncounter[] = [];
    for (const p of paths) {
      const kind = kindFromName(p);
      if (!kind) continue;
      const ts = fileTs(p);
      const label = labelFromName(p);
      if (kind === 'encounter') {
        const s = lootSummaries[p];
        out.push({ path: p, ts, kind, loot: s, label });
      } else {
        out.push({ path: p, ts, kind, label });
      }
    }
    const lootBearing = out.flatMap(e => e.loot ? [e.loot] : []);
    if (lootBearing.length === 0) return out;
    const repPaths = new Set(representativeLootSummaries(lootBearing).map(r => r.path));
    return out.filter(e => e.kind !== 'encounter' || !e.loot || repPaths.has(e.path));
  }, [paths, lootSummaries]);


  const openFromTrends = (p: string, from: Section) => { setSection('history'); open(p); setOrigin(from); };

  // Item-icon resolver for the shared UI: maps an item id to the addon's
  // extracted icon file (asset protocol URL). Null on the web / outside Tauri.
  const iconResolver = useCallback((id: number) => {
    if (!inTauri || !dir) return null;
    return convertFileSrc(`${dir.replace(/[\\/]+$/, '')}/assets/icon_${id}.bmp`);
  }, [dir]);

  // Buff/status icons come from a bundled set (public/buffs/<set>/<id>.bmp).
  const buffResolver = useCallback((buffId: number) => {
    if (buffSet === 'off') return null;
    return `/buffs/${buffSet}/${buffId}.bmp`;
  }, [buffSet]);

  // Anonymize player names → job (toggle). Applied at render so flipping it
  // doesn't require reloading the run.
  const displayContent = useMemo<LoadedContent | null>(() => {
    if (!content || !anon) return content;
    if (content.kind === 'encounter') return { ...content, encounter: anonymize(content.encounter) };
    return { ...content, record: anonymize(content.record) } as LoadedContent;
  }, [content, anon]);

  const LOADER_EXIT_MS = 400;
  const showLoader = loading;
  const [loaderExiting, setLoaderExiting] = useState(false);
  const showLoaderRef = useRef(false);
  useEffect(() => {
    const wasShowing = showLoaderRef.current;
    showLoaderRef.current = showLoader;
    if (wasShowing && !showLoader) {
      setLoaderExiting(true);
      const t = window.setTimeout(() => setLoaderExiting(false), LOADER_EXIT_MS);
      return () => window.clearTimeout(t);
    }
    if (showLoader && loaderExiting) setLoaderExiting(false);
  }, [showLoader, loaderExiting]);
  const renderLoader = showLoader || loaderExiting;
  const [mergeStatus, setMergeStatus] = useState<'idle' | 'working' | 'complete'>('idle');
  const [splitStatus, setSplitStatus] = useState<'idle' | 'working' | 'complete'>('idle');
  const longRunningOp: 'merge' | 'split' | null =
    mergeStatus !== 'idle' ? 'merge' : splitStatus !== 'idle' ? 'split' : null;
  const longRunningStatus: 'idle' | 'working' | 'complete' =
    mergeStatus !== 'idle' ? mergeStatus : splitStatus !== 'idle' ? splitStatus : 'idle';
  const merging = longRunningOp !== null;
  const [mergeProgress, setMergeProgress] = useState<{ current: number; total: number; label: string } | null>(null);

  const viewKey = (section === 'home' || section === 'history')
    ? (selected ?? `${section}-idle`)
    : section;

  if (startupCheckActive === null) {
    return <div className="h-screen overflow-hidden"><div className="styx-bg" /></div>;
  }
  if (startupCheckActive) {
    return (
      <StartupUpdateCheck
        dataDir={dir}
        onDone={() => {
          setStartupCheckActive(false);
          if (inTauri) {
            void import('@tauri-apps/api/core').then(({ invoke }) => invoke('mark_startup_check_done').catch(() => {}));
          }
        }}
      />
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <DialogHost />
      <TooltipHost />
      <div className="styx-bg" />
      {/* Zoom target. The TrackingControls footer is intentionally a sibling
          of this wrapper (not a child) so the user's interface-scale setting
          doesn't push the status bar off-screen at large scales - the footer
          stays at native size while everything above it scales. */}
      <div id="zoom-wrapper" className="flex-1 flex flex-col min-h-0">
      <TitleBar dataDir={dir} />
      <div className="flex-1 flex min-h-0">
      <NavRail section={section} onSelect={(s) => { setOrigin(null); setSection(s); }} isAdmin={isAdmin} />

      {/* Left sidebar - History list. Only mounted on the History tab; the
          width-collapsing wrapper keeps the slide-in animation cheap. The
          report opens to the right on the same tab (no Home redirect). */}
      <div className={`h-full shrink-0 overflow-hidden transition-[width] duration-[450ms] ease-out motion-reduce:transition-none ${section === 'history' ? 'w-72' : 'w-0'}`}>
        <HistoryView
          active={section === 'history'}
          inTauri={inTauri}
          paths={paths}
          encSummaries={encSummaries}
          lootSummaries={lootSummaries}
          selected={selected}
          error={error}
          onOpenGroup={openGroup}
          onRemoveGroup={removeGroup}
          onPickFile={loadPicked}
          onMergeStatusChange={setMergeStatus}
          onSplitStatusChange={setSplitStatus}
          onMergeProgress={setMergeProgress}
        />
      </div>

      <main className="flex-1 h-full overflow-y-auto relative">
        {section === 'home' && inTauri && (
          <div className="h-full">
            <div className="mx-auto max-w-6xl px-6 py-6">
              <ItemIconContext.Provider value={iconResolver}>
                <HomeDashboard
                  paths={paths}
                  encSummaries={encSummaries}
                  lootSummaries={lootSummaries}
                  activityEntries={activityEntries}
                  onOpenRun={(p) => {
                    setSection('history');
                    const members = autoOpenGroupFor(p);
                    if (members.length > 1) openGroup(members); else open(p);
                  }}
                  onNavigate={(s) => setSection(s)}
                  dataDir={dir}
                />
              </ItemIconContext.Provider>
            </div>
          </div>
        )}
        {section === 'loot' && (
          <div className="h-full">
            <div className="mx-auto max-w-6xl px-6 py-6">
              <ItemIconContext.Provider value={iconResolver}>
                <LootView paths={paths} activityEntries={activityEntries} onOpen={(p) => openFromTrends(p, 'loot')} />
              </ItemIconContext.Provider>
            </div>
          </div>
        )}
        {section === 'activities' && (
          <div className="h-full">
            <div className="mx-auto max-w-6xl px-6 py-6">
              <ItemIconContext.Provider value={iconResolver}>
                <ActivitiesView
                  entries={activityEntries}
                  onOpenRun={(p) => { setSection('history'); open(p); }}
                  labelOf={labelFromName}
                />
              </ItemIconContext.Provider>
            </div>
          </div>
        )}
        {section === 'trends' && (
          <div className="h-full">
            <div className="mx-auto max-w-6xl px-6 py-6">
              <Suspense fallback={<div className="text-gray-600 text-xs py-12 text-center">Loading Trends…</div>}>
                <TrendsView paths={paths} anon={anon} onOpen={(p) => openFromTrends(p, 'trends')} />
              </Suspense>
            </div>
          </div>
        )}
        {section === 'compare' && (
          <div className="h-full">
            <div className="mx-auto max-w-6xl px-6 py-6">
              <Suspense fallback={<div className="text-gray-600 text-xs py-12 text-center">Loading Compare…</div>}>
                <CompareView paths={paths} anon={anon} onOpen={(p) => openFromTrends(p, 'compare')} />
              </Suspense>
            </div>
          </div>
        )}
        {section === 'live' && (
          <div className="h-full">
            <div className="mx-auto max-w-6xl px-6 py-6">
              <LiveView dir={dir} />
            </div>
          </div>
        )}
        {(section === 'history' || section === 'overlay' || section === 'settings' || section === 'diagnostics' || (section === 'home' && !inTauri)) && (
        <div key={viewKey} className="ff-view h-full">
        {merging ? (
          <LoadingScreen
            caption={longRunningOp === 'split' ? 'splitting encounter' : 'merging encounters'}
            completeCaption={longRunningOp === 'split' ? 'split complete!' : 'merge complete!'}
            complete={longRunningStatus === 'complete'}
            hideQuote
            footer={longRunningStatus === 'complete' ? null : (() => {
              const pct = mergeProgress && mergeProgress.total > 0
                ? Math.min(100, Math.round((mergeProgress.current / mergeProgress.total) * 100))
                : 0;
              return (
                <div className="mx-auto w-[28rem] max-w-[80%] mt-4 flex flex-col items-center gap-3">
                  <div className="w-full h-3 rounded-full bg-white/[0.08] overflow-hidden">
                    <div
                      className="h-full bg-accent transition-[width] duration-200 ease-out"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-sm text-gray-300 font-mono text-center min-h-[20px]">
                    {mergeProgress
                      ? `${mergeProgress.current} / ${mergeProgress.total} - ${mergeProgress.label}`
                      : 'Preparing…'}
                  </div>
                </div>
              );
            })()}
          />
        ) : section === 'home' ? (
          <IdleQuote />
        ) : section !== 'overlay' && section !== 'settings' && section !== 'diagnostics' && !displayContent && !renderLoader ? (
          <IdleQuote caption="Pick an encounter from the list" />
        ) : (
        <div className="mx-auto max-w-6xl px-6 py-6">
          {error && !inTauri && <div className="text-red-400 mb-4">{error}</div>}
          <ItemIconContext.Provider value={iconResolver}>
          <BuffIconContext.Provider value={buffResolver}>
          {section === 'overlay' ? (
            <OverlayView
              open={overlayOpen}
              onToggleOpen={toggleOverlay}
              ct={overlayCT}
              onToggleCT={toggleCT}
              scale={overlayScale}
              onScaleChange={setOverlayScale}
              demo={overlayDemo}
              onToggleDemo={() => setOverlayDemo(d => !d)}
              compact={overlayCompact}
              onToggleCompact={() => setOverlayCompact(c => !c)}
              opacity={overlayOpacity}
              onOpacityChange={setOverlayOpacity}
            />
          ) : section === 'diagnostics' ? (
            <DiagnosticsView content={content} />
          ) : section === 'settings' ? (
            <SettingsView dir={dir} onDirChange={setDir} theme={theme} onThemeChange={setTheme} buffSet={buffSet} onBuffSetChange={setBuffSet} anon={anon} onAnonChange={setAnon} anonOnShare={anonOnShare} onAnonOnShareChange={setAnonOnShare} bgBrightness={bgBrightness} onBgBrightnessChange={setBgBrightness} uiScale={uiScale} onUiScaleChange={setUiScale} autoOpenNew={autoOpenNew} onAutoOpenNewChange={setAutoOpenNew} trackPrefs={trackPrefs} onTrackPrefsChange={changeTrackPrefs} trackConnected={connected} />
          ) : showLoader ? (
            /* Loader is fully visible - render nothing underneath so the
               stale report doesn't bleed through the transparent overlay.
               The overlay's exit fade (loaderExiting) flips `showLoader`
               false; at that point `displayContent` is the new content and
               this branch falls through to render it, cross-fading in
               under the fading-out loader. */
            null
          ) : displayContent ? (
            (() => {
              const share = inTauri && content ? (
                <div className="inline-flex items-center gap-2">
                  <ExportAnonymizedButton sourcePath={selected} />
                  <ShareButton content={content} anonymizeOnShare={anonOnShare} sourcePath={selected} />
                </div>
              ) : undefined;
              return (
                <>
                  {origin && (
                    <button
                      onClick={() => { const o = origin; setOrigin(null); setSection(o); }}
                      className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-accent transition-colors"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                      Back to {origin === 'compare' ? 'Compare' : 'Trends'}
                    </button>
                  )}
                  {/* Suspense fallback is `null` (no loader flash) - the
                      chunks are prefetched at app boot so this fallback
                      should never fire in practice. If a race slips
                      through, the user sees a single blank tick instead
                      of the loader animation popping in. */}
                  <Suspense fallback={null}>
                    {displayContent.kind === 'encounter'
                      ? <EncounterView enc={displayContent.encounter} headerAction={share} enemyHistory={enemyHistory} />
                      : <ContentView content={displayContent} headerAction={share} enemyHistory={enemyHistory} />}
                  </Suspense>
                </>
              );
            })()
          ) : null}
          {/* Loader overlay rendered as a sibling, NOT an alternative branch
              - content renders underneath (stale on subsequent loads, blank on
              first load) and the overlay fades out via .splash-overlay--exiting
              when `showLoader` flips false, revealing the report behind it.
              Absolute-positioned with z-index 10 + solid app-bg so it covers
              the content during the active load. */}
          {renderLoader && <LoadingScreen exiting={loaderExiting} />}
          </BuffIconContext.Provider>
          </ItemIconContext.Provider>
        </div>
        )}
        </div>
        )}
      </main>
      </div>
      </div>
      {inTauri && (
        <TrackingControls
          status={status}
          connected={connected}
          busy={busy}
          onSetMode={(m) => sendCommand({ mode: m })}
          onSave={() => sendCommand({ action: 'save' })}
        />
      )}
    </div>
  );
}
