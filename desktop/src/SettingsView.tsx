// Settings section: configuration that doesn't belong in the operational Home
// sidebar - the addon data folder and appearance/theme.
import { useEffect, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { inTauri, openExternal } from './library';
import { SHARE_API_BASE_URL } from '@/lib/shareConfig';
import type { BuffSet } from './App';
import type { TrackerPrefs, TrackingMode } from './content';
import { getCheckOnStartupEnabled, setCheckOnStartupEnabled, checkForUpdates, subscribe as subscribeUpdater, type UpdateState,
  checkAddonUpdate, subscribeAddon, type AddonUpdateState, resolveAddonDir, readInstalledAddonVersion,
  getAddonDirOverride, setAddonDirOverride } from './updater';
import { emitTokenChanged } from './useAdminStatus';
import { useDisplayLanguage, setDisplayLanguage } from '@/lib/displayLanguage';
import type { DisplayLanguage } from '@/lib/translate';
import { useSilentModeOnMinimize, setSilentModeOnMinimize, useSilentModeHideOverlay, setSilentModeHideOverlay } from './silentMode';
import { clearFtueCompletion } from './WelcomeWizard';

async function pickDataFolder(currentDir: string): Promise<string | null> {
  try {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: currentDir,
      title: 'Select the Gnosis addon data folder',
    });
    if (typeof selected === 'string' && selected.length > 0) return selected;
    return null;
  } catch {
    return null;
  }
}

type Theme = 'gnosis' | 'crimson' | 'dawn' | 'minimal';
const THEMES: { id: Theme; label: string; bg: string; accent: string }[] = [
  { id: 'gnosis',  label: 'Gnosis',     bg: '#1a2b22', accent: '#f0c062' },
  { id: 'dawn',    label: 'Dawn',       bg: '#121a28', accent: '#e8a24a' },
  { id: 'crimson', label: 'LesserEvil', bg: '#0f0f11', accent: '#c44545' },
  { id: 'minimal', label: 'Minimal',    bg: '#141618', accent: '#f2b03a' },
];


const TRACK_MODES: { mode: TrackingMode; label: string; hint: string }[] = [
  { mode: 'off',     label: 'Off',       hint: "Don't track automatically" },
  { mode: 'fight',   label: 'Encounter', hint: 'One encounter per fight - opens on combat, closes after the idle timeout' },
  { mode: 'zone',    label: 'Zone',      hint: 'One encounter per zone' },
  { mode: 'session', label: 'Session',   hint: 'One continuous encounter until stopped' },
];

const BUFF_SETS: { value: BuffSet; label: string }[] = [
  { value: 'xiview', label: 'XIView' },
  { value: 'classic', label: 'Classic' },
  { value: 'jeanpaul', label: 'JeanPaul' },
  { value: 'off', label: 'Off' },
];

const UI_SCALE_PRESETS: { value: number; label: string }[] = [
  { value: 1, label: 'Default' },
  { value: 1.15, label: 'Large' },
  { value: 1.3, label: 'Larger' },
  { value: 1.5, label: 'Largest' },
];

export default function SettingsView({
  dir, onDirChange, theme, onThemeChange, buffSet, onBuffSetChange, anon, onAnonChange,
  anonOnShare, onAnonOnShareChange,
  bgBrightness, onBgBrightnessChange, uiScale, onUiScaleChange, autoOpenNew, onAutoOpenNewChange,
  trackPrefs, onTrackPrefsChange, trackConnected,
}: {
  dir: string;
  onDirChange: (v: string) => void;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  buffSet: BuffSet;
  onBuffSetChange: (s: BuffSet) => void;
  anon: boolean;
  onAnonChange: (v: boolean) => void;
  anonOnShare: boolean;
  onAnonOnShareChange: (v: boolean) => void;
  bgBrightness: number;
  onBgBrightnessChange: (v: number) => void;
  uiScale: number;
  onUiScaleChange: (v: number) => void;
  autoOpenNew: boolean;
  onAutoOpenNewChange: (v: boolean) => void;
  trackPrefs: TrackerPrefs;
  onTrackPrefsChange: (p: TrackerPrefs) => void;
  trackConnected: boolean;
}) {
  return (
    <div className="space-y-6">
      {inTauri && (
        <Card title="Behavior">
          <label className="block">
            <span className="text-xs text-gray-400">Addon Data Folder</span>
            <div className="mt-1 flex gap-2">
              <input
                value={dir}
                onChange={e => onDirChange(e.target.value)}
                spellCheck={false}
                className="flex-1 min-w-0 text-xs font-mono bg-panel-alt/60 border border-white/10 rounded px-2 py-1.5 text-gray-300"
                placeholder="addon data folder"
              />
              <button
                type="button"
                onClick={async () => {
                  const picked = await pickDataFolder(dir);
                  if (picked) onDirChange(picked);
                }}
                className="shrink-0 text-xs rounded px-3 py-1.5 border border-white/15 text-gray-200 hover:bg-white/[0.06] transition-colors"
              >
                Browse…
              </button>
            </div>
            <span className="text-[11px] text-gray-600 mt-1 block">
              Where Gnosis writes its reports. Encounters and content runs in this folder appear under Home.
            </span>
            <button
              type="button"
              onClick={() => {
                clearFtueCompletion();
                window.location.reload();
              }}
              className="mt-2 text-[11px] text-accent/80 hover:text-accent underline underline-offset-2 transition-colors"
            >
              Replay welcome wizard
            </button>
          </label>

          <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
            <div>
              <div className="text-sm text-gray-200">Open New Encounter Results Automatically</div>
              <div className="text-[11px] text-gray-500">When a new encounter is saved, navigate to the report automatically in the UI.</div>
            </div>
            <button
              onClick={() => onAutoOpenNewChange(!autoOpenNew)}
              role="switch"
              aria-checked={autoOpenNew}
              className={`shrink-0 ml-4 relative w-11 h-6 rounded-full transition-colors ${autoOpenNew ? 'bg-accent/70' : 'bg-white/15'}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${autoOpenNew ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>

          <div className="mt-4 pt-4 border-t border-white/5">
            <TrackingCard prefs={trackPrefs} onChange={onTrackPrefsChange} connected={trackConnected} />
          </div>
        </Card>
      )}

      {inTauri && (
        <Card title="Updates">
          <UpdatesCard dataDir={dir} />
        </Card>
      )}

      <Card title="Appearance">
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm text-gray-200">Interface Scale</div>
              <div className="text-[11px] text-gray-500">Make all text and UI larger or smaller, like Windows display scaling. Increase it if text is hard to read.</div>
            </div>
            <span className="text-sm font-mono text-accent shrink-0 ml-4">{Math.round(uiScale * 100)}%</span>
          </div>
          <input
            type="range"
            min={1}
            max={1.8}
            step={0.05}
            value={uiScale}
            onChange={e => onUiScaleChange(parseFloat(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex gap-1 mt-2">
            {UI_SCALE_PRESETS.map(p => (
              <button
                key={p.value}
                onClick={() => onUiScaleChange(p.value)}
                className={`flex-1 text-xs rounded px-2 py-1 border transition-colors ${
                  Math.abs(uiScale - p.value) < 0.001 ? 'bg-accent/20 border-accent/50 text-accent font-semibold' : 'border-white/10 text-gray-300 hover:bg-white/[0.05]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-white/5">
          <div className="text-sm text-gray-200 mb-1">Theme</div>
          <div className="text-[11px] text-gray-500 mb-3">Recolors the whole app. Gnosis, Forest, and LesserEvil are art-backed; Minimal is a flat dark UI.</div>
          <div className="grid grid-cols-4 gap-2">
            {THEMES.map(t => (
              <button
                key={t.id}
                onClick={() => onThemeChange(t.id)}
                data-tooltip={t.label}
                className={`rounded-lg border p-2 flex flex-col items-center gap-1.5 transition-colors ${
                  theme === t.id ? 'border-accent bg-accent/10' : 'border-white/10 hover:bg-white/[0.05]'
                }`}
              >
                <span className="w-full h-7 rounded flex items-center justify-end px-1.5 border border-white/10" style={{ background: t.bg }}>
                  <span className="w-3 h-3 rounded-full" style={{ background: t.accent }} />
                </span>
                <span className={`text-[10px] ${theme === t.id ? 'text-accent font-semibold' : 'text-gray-400'}`}>{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
          <div>
            <div className="text-sm text-gray-200">Buff Icon Styling</div>
            <div className="text-[11px] text-gray-500">Status-effect icon art used in buffs/debuffs tables.</div>
          </div>
          <div className="flex rounded border border-white/10 overflow-hidden shrink-0">
            {BUFF_SETS.map(s => (
              <button
                key={s.value}
                onClick={() => onBuffSetChange(s.value)}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  buffSet === s.value ? 'bg-accent/20 text-accent font-semibold' : 'text-gray-400 hover:bg-white/[0.05]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {theme !== 'minimal' && (
          <div className="mt-4 pt-4 border-t border-white/5">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm text-gray-200">Wallpaper Brightness</div>
                <div className="text-[11px] text-gray-500">How bright the theme wallpaper appears behind the panels. Higher = brighter art; lower = darker and easier to read.</div>
              </div>
              <span className="text-sm font-mono text-accent shrink-0 ml-4">{Math.round(bgBrightness * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={bgBrightness}
              onChange={e => onBgBrightnessChange(parseFloat(e.target.value))}
              className="w-full accent-accent"
            />
          </div>
        )}

        {/* Wallpaper Fit picker removed: each theme now has a fixed bgFit
            baked in (THEME_BG_FIT in App.tsx). Gnosis = Fill (top); Forest
            and LesserEvil = Fill (center). Minimal has no wallpaper, so
            fit is moot. */}

        <div className="mt-5 pt-5 border-t border-white/[0.06]">
          <DisplayLanguageRow />
        </div>
      </Card>

      {inTauri && (
        <Card title="Performance">
          <SilentModeRow />
        </Card>
      )}

      <Card title="Privacy">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-200">Anonymize Character Names (Local)</div>
            <div className="text-[11px] text-gray-500">Replaces player names with their job (e.g. Geomancer) everywhere in local reports.</div>
          </div>
          <button
            onClick={() => onAnonChange(!anon)}
            role="switch"
            aria-checked={anon}
            className={`shrink-0 ml-4 relative w-11 h-6 rounded-full transition-colors ${anon ? 'bg-accent/70' : 'bg-white/15'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${anon ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
          <div>
            <div className="text-sm text-gray-200">Anonymize Character Names (Web)</div>
            <div className="text-[11px] text-gray-500">Anonymizes all character names when uploading to the web to share reports.</div>
          </div>
          <button
            onClick={() => onAnonOnShareChange(!anonOnShare)}
            role="switch"
            aria-checked={anonOnShare}
            className={`shrink-0 ml-4 relative w-11 h-6 rounded-full transition-colors ${anonOnShare ? 'bg-accent/70' : 'bg-white/15'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${anonOnShare ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>
      </Card>

      <Card title="Sharing">
        <SharingCard />
      </Card>

    </div>
  );
}


const SHARE_TOKEN_KEY = 'gnosis_share_token';
const DEFAULT_PRIVACY_KEY = 'gnosis_share_default_privacy';

function SharingCard() {
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [identity, setIdentity] = useState<{ email: string | null; username: string | null } | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultPrivacy, setDefaultPrivacy] = useState<'public' | 'private'>(() => {
    try { return localStorage.getItem(DEFAULT_PRIVACY_KEY) === 'public' ? 'public' : 'private'; } catch { return 'private'; }
  });
  function updateDefaultPrivacy(p: 'public' | 'private') {
    setDefaultPrivacy(p);
    try { localStorage.setItem(DEFAULT_PRIVACY_KEY, p); } catch { /* ignore */ }
  }

  useEffect(() => {
    const t = (() => { try { return localStorage.getItem(SHARE_TOKEN_KEY); } catch { return null; } })();
    setSavedToken(t);
    if (t) verify(t, false);
  }, []);

  async function pasteAndConnect() {
    setError(null);
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      setError('Could not read clipboard. Paste the token manually below instead.');
      return;
    }
    const token = text.trim();
    if (!token) {
      setError('Clipboard is empty. Copy the token from gnosis-xi.com/settings first.');
      return;
    }
    setInput(token);
    await verify(token, true);
  }

  async function verify(token: string, persistOnSuccess: boolean) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${SHARE_API_BASE_URL}/api/account/whoami`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        if (persistOnSuccess) setError('Token not recognized. Generate a fresh one at gnosis-xi.com/settings.');
        setIdentity(null);
        if (!persistOnSuccess) {
        }
        return;
      }
      const j = await res.json() as { email: string | null; username: string | null };
      setIdentity({ email: j.email, username: j.username });
      if (persistOnSuccess) {
        try { localStorage.setItem(SHARE_TOKEN_KEY, token); } catch { /* ignore */ }
        setSavedToken(token);
        setInput('');
        emitTokenChanged();
      }
    } catch {
      setError('Could not reach gnosis-xi.com. Check your network and try again.');
      setIdentity(null);
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    try { localStorage.removeItem(SHARE_TOKEN_KEY); } catch { /* ignore */ }
    setSavedToken(null);
    setIdentity(null);
    setError(null);
    emitTokenChanged();
  }

  const masked = savedToken ? `${savedToken.slice(0, 4)}…${savedToken.slice(-4)}` : null;

  if (savedToken && identity) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="text-sm text-gray-200">Connected{identity.email ? <> as <span className="text-accent">{identity.email}</span></> : ''}</span>
        </div>
        <div className="text-[11px] text-gray-500 font-mono">Token: {masked}</div>
        <div className="text-[11px] text-gray-500">Shared encounters upload with your API token (20/hr instead of 3/hr).</div>
        <button onClick={disconnect} className="mt-1 text-xs rounded px-3 py-1.5 border border-white/15 text-gray-300 hover:bg-white/[0.05]">
          Disconnect
        </button>

        <div className="mt-4 pt-4 border-t border-white/5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm text-gray-200">Default Privacy Setting On Share</div>
              <div className="text-[11px] text-gray-500">Pre-selected when you open the Share dialog.</div>
            </div>
            <div className="flex rounded border border-white/10 overflow-hidden shrink-0">
              {(['public', 'private'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => updateDefaultPrivacy(p)}
                  className={`px-2.5 py-1 text-xs transition-colors ${
                    defaultPrivacy === p ? 'bg-accent/20 text-accent font-semibold' : 'text-gray-400 hover:bg-white/[0.05]'
                  }`}
                >
                  {p === 'public' ? 'Public' : 'Private'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-gray-500 leading-relaxed">
        <span className="inline-block align-middle text-[9px] font-bold uppercase tracking-wider text-gray-300 bg-white/[0.06] border border-white/15 rounded px-1.5 py-0.5 leading-none mr-1.5">Optional</span>
        Connect your gnosis-xi.com account so shared encounters upload under your username. Sharing still works without an account, with limited features.
      </div>
      <button
        onClick={() => openExternal(`${SHARE_API_BASE_URL}/settings`)}
        className="text-xs rounded px-3 py-1.5 bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 transition-colors"
      >
        Open gnosis-xi.com/settings ↗
      </button>
      <div className="text-[11px] text-gray-500">Generate a token on that page, copy it, then:</div>
      <button
        onClick={pasteAndConnect}
        disabled={busy}
        className="inline-flex items-center gap-2 text-xs rounded px-3 py-1.5 bg-emerald-600/80 hover:bg-emerald-600 border border-emerald-500/50 text-white font-semibold transition-colors disabled:opacity-40"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
        </svg>
        {busy ? 'Connecting…' : 'Paste from Clipboard'}
      </button>
      <div className="text-[11px] text-gray-500 pt-1">Or enter it manually:</div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="j1i24j12j21ej34o45ko4klklrel..."
          spellCheck={false}
          className="flex-1 min-w-0 text-xs font-mono bg-panel-alt/60 border border-white/10 rounded px-2 py-1.5 text-gray-300"
        />
        <button
          onClick={() => verify(input.trim(), true)}
          disabled={busy || !input.trim()}
          className="text-xs rounded px-3 py-1.5 border border-white/15 text-gray-300 hover:bg-white/[0.05] transition-colors disabled:opacity-40"
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
      {error && <div className="text-[11px] text-rose-400">{error}</div>}
    </div>
  );
}

function UpdatesCard({ dataDir }: { dataDir: string }) {
  const [checkOnStartup, setLocal] = useState(() => getCheckOnStartupEnabled());
  const [state, setState] = useState<UpdateState>({ kind: 'idle' });
  const [addonState, setAddonState] = useState<AddonUpdateState>({ kind: 'idle' });
  const [version, setVersion] = useState<string>('');
  const [addonDir, setAddonDir] = useState<string | null>(null);
  const [installedAddonVersion, setInstalledAddonVersion] = useState<string | null>(null);
  const [addonOverride, setAddonOverride] = useState<string>(() => getAddonDirOverride() ?? '');
  useEffect(() => subscribeUpdater(setState), []);
  useEffect(() => subscribeAddon(setAddonState), []);
  useEffect(() => {
    void import('@tauri-apps/api/app').then(m => m.getVersion()).then(setVersion).catch(() => {});
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await resolveAddonDir(dataDir);
      if (cancelled) return;
      setAddonDir(d);
      if (d) {
        const v = await readInstalledAddonVersion(d);
        if (!cancelled) setInstalledAddonVersion(v);
      } else {
        setInstalledAddonVersion(null);
      }
    })();
    return () => { cancelled = true; };
  }, [dataDir, addonState.kind]);
  const toggle = () => {
    const next = !checkOnStartup;
    setLocal(next);
    setCheckOnStartupEnabled(next);
  };
  const busy = state.kind === 'checking' || state.kind === 'downloading' || state.kind === 'installing';
  const addonBusy = addonState.kind === 'checking' || addonState.kind === 'installing';
  const statusLine = (() => {
    if (state.kind === 'checking') return 'Checking…';
    if (state.kind === 'downloading') return `Downloading… ${state.total ? Math.round((state.downloaded / state.total) * 100) : '-'}%`;
    if (state.kind === 'installing') return 'Installing…';
    if (state.kind === 'available') return `Update available: v${state.version}`;
    if (state.kind === 'none') return 'You are on the latest version.';
    if (state.kind === 'error') return `Check failed: ${state.message}`;
    return '';
  })();
  const addonStatusLine = (() => {
    if (addonState.kind === 'checking') return 'Checking…';
    if (addonState.kind === 'installing') return 'Installing addon files…';
    if (addonState.kind === 'installed') return `Installed v${addonState.result.installed_version}. Type //lua r gnosis in FFXI.`;
    if (addonState.kind === 'available') return `Update available: v${addonState.manifest.version}`;
    if (addonState.kind === 'none') return 'Addon is on the latest version.';
    if (addonState.kind === 'no-addon-dir') return 'Addon folder not found - set the override path below.';
    if (addonState.kind === 'error') return `Check failed: ${addonState.message}`;
    return '';
  })();
  const saveOverride = () => {
    const trimmed = addonOverride.trim();
    setAddonDirOverride(trimmed || null);
    void checkAddonUpdate({ dataDir, manifestUrl: 'https://gnosis-xi.com/updates/desktop.json' });
  };
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-200">Check For Updates On Startup</div>
          <div className="text-[11px] text-gray-500">When enabled, Gnosis quietly checks for both desktop + addon updates on launch. Disable to check manually.</div>
        </div>
        <button
          onClick={toggle}
          role="switch"
          aria-checked={checkOnStartup}
          className={`shrink-0 ml-4 relative w-11 h-6 rounded-full transition-colors ${checkOnStartup ? 'bg-accent/70' : 'bg-white/15'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checkOnStartup ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5 gap-3">
        <div className="min-w-0">
          <div className="text-sm text-gray-200">Viewer</div>
          <div className="text-[11px] text-gray-500 font-mono">{version || '-'}</div>
          {statusLine && <div className="text-[11px] text-accent mt-1 truncate">{statusLine}</div>}
        </div>
        <button
          onClick={() => { void checkForUpdates({ minCheckingMs: 1500 }); }}
          disabled={busy}
          className="shrink-0 text-xs rounded px-3 py-1.5 border border-white/15 text-gray-200 hover:bg-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? 'Checking…' : 'Check now'}
        </button>
      </div>
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5 gap-3">
        <div className="min-w-0">
          <div className="text-sm text-gray-200">Windower Addon</div>
          <div className="text-[11px] text-gray-500 font-mono">
            {installedAddonVersion ? `v${installedAddonVersion}` : '-'} {addonDir ? <span className="text-gray-600">· {addonDir}</span> : null}
          </div>
          {addonStatusLine && <div className="text-[11px] text-accent mt-1 truncate">{addonStatusLine}</div>}
        </div>
        <button
          onClick={() => { void checkAddonUpdate({ dataDir, manifestUrl: 'https://gnosis-xi.com/updates/desktop.json', minCheckingMs: 1500 }); }}
          disabled={addonBusy}
          className="shrink-0 text-xs rounded px-3 py-1.5 border border-white/15 text-gray-200 hover:bg-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {addonBusy ? 'Checking…' : 'Check now'}
        </button>
      </div>
      <label className="block mt-3">
        <span className="text-[11px] text-gray-500">Addon folder override (only if auto-detection fails)</span>
        <div className="mt-1 flex gap-2">
          <input
            value={addonOverride}
            onChange={e => setAddonOverride(e.target.value)}
            onBlur={saveOverride}
            spellCheck={false}
            placeholder={addonDir ?? 'C:\\Program Files (x86)\\Windower\\addons\\Gnosis'}
            className="flex-1 min-w-0 text-xs font-mono bg-panel-alt/60 border border-white/10 rounded px-2 py-1.5 text-gray-300"
          />
          <button
            type="button"
            onClick={async () => {
              const picked = await pickDataFolder(addonOverride || addonDir || '');
              if (picked) { setAddonOverride(picked); setAddonDirOverride(picked); void checkAddonUpdate({ dataDir, manifestUrl: 'https://gnosis-xi.com/updates/desktop.json' }); }
            }}
            className="shrink-0 text-xs rounded px-3 py-1.5 border border-white/15 text-gray-200 hover:bg-white/[0.06] transition-colors"
          >
            Browse…
          </button>
        </div>
      </label>
    </>
  );
}

function DisplayLanguageRow() {
  const current = useDisplayLanguage();
  const options: { value: DisplayLanguage; label: string; hint: string }[] = [
    { value: 'auto', label: 'Auto',     hint: 'Match each report to the language it was captured in' },
    { value: 'en',   label: 'English',  hint: 'Force English names everywhere'  },
    { value: 'ja',   label: '日本語',    hint: 'Force Japanese names everywhere' },
  ];
  return (
    <div>
      <div className="text-sm text-gray-200 mb-1 flex items-center gap-2">
        <span>Display Language</span>
        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">Experimental</span>
      </div>
      <div className="text-[11px] text-gray-500 leading-snug mb-3">
        Translates spell, weapon skill, item, buff, and zone names at view time using bundled
        FFXI resource tables. Mob names are NOT translated (the game client emits them in its own language).
      </div>
      <div className="flex gap-1">
        {options.map(o => {
          const on = current === o.value;
          return (
            <button
              key={o.value}
              onClick={() => setDisplayLanguage(o.value)}
              role="radio"
              aria-checked={on}
              data-tooltip={o.hint}
              className={`flex-1 text-xs rounded px-3 py-2 border transition-colors ${
                on ? 'bg-accent/20 border-accent/50 text-accent font-semibold' : 'border-white/10 text-gray-300 hover:bg-white/[0.05]'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SilentModeRow() {
  const enabled = useSilentModeOnMinimize();
  const hideOverlay = useSilentModeHideOverlay();
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="min-w-0 pr-4">
          <div className="text-sm text-gray-200">Silent Mode On Minimize</div>
          <div className="text-[11px] text-gray-500 leading-snug">
            Collapses to System Tray on Minimize. Lowers memory usage.
          </div>
        </div>
        <button
          onClick={() => void setSilentModeOnMinimize(!enabled)}
          role="switch"
          aria-checked={enabled}
          className={`shrink-0 ml-4 relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-accent/70' : 'bg-white/15'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
      {enabled && (
        <div className="mt-4 pt-4 border-t border-white/[0.06] flex items-center justify-between">
          <div className="min-w-0 pr-4">
            <div className="text-sm text-gray-200">Hide Overlay In Silent Mode</div>
            <div className="text-[11px] text-gray-500 leading-snug">
              Also hide Overlay in Silent Mode, reduces memory usage further.
            </div>
          </div>
          <button
            onClick={() => void setSilentModeHideOverlay(!hideOverlay)}
            role="switch"
            aria-checked={hideOverlay}
            className={`shrink-0 ml-4 relative w-11 h-6 rounded-full transition-colors ${hideOverlay ? 'bg-accent/70' : 'bg-white/15'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${hideOverlay ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-5">
      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-3">{title}</div>
      {children}
    </div>
  );
}

function TrackingCard({ prefs, onChange, connected }: {
  prefs: TrackerPrefs;
  onChange: (p: TrackerPrefs) => void;
  connected: boolean;
}) {
  // Local editable copy of the timeout so typing is smooth; commit on blur/Enter.
  const [timeoutInput, setTimeoutInput] = useState(String(prefs.idleTimeout));
  useEffect(() => { setTimeoutInput(String(prefs.idleTimeout)); }, [prefs.idleTimeout]);

  const commitTimeout = () => {
    const n = Math.floor(Number(timeoutInput));
    if (!Number.isFinite(n) || n < 1) { setTimeoutInput(String(prefs.idleTimeout)); return; }
    if (n !== prefs.idleTimeout) onChange({ ...prefs, idleTimeout: n });
    else setTimeoutInput(String(prefs.idleTimeout));
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-200">Start Tracking Automatically</div>
        <span className="flex items-center gap-1 text-[10px]">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-gray-600'}`} />
          <span className={connected ? 'text-emerald-400/80' : 'text-gray-600'}>{connected ? 'addon connected' : 'addon offline'}</span>
        </span>
      </div>
      <div className="text-[11px] text-gray-500 mb-2">
        Upon loading the addon ingame, Gnosis will start tracking automatically.
      </div>
      <div className="grid grid-cols-4 gap-1">
        {TRACK_MODES.map(({ mode, label, hint }) => {
          const on = prefs.mode === mode;
          return (
            <button
              key={mode}
              data-tooltip={hint}
              onClick={() => { if (mode !== prefs.mode) onChange({ ...prefs, mode }); }}
              className={`text-xs rounded px-2 py-1.5 border transition-colors ${
                on ? 'bg-accent/20 border-accent/50 text-accent font-semibold' : 'border-white/10 text-gray-300 hover:bg-white/[0.05]'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
        <div>
          <div className="text-sm text-gray-200">Encounter Inactivity Timeout</div>
          <div className="text-[11px] text-gray-500">
            Seconds out of combat before an <span className="text-gray-300">Encounter</span> is saved and split into
            a new one. Only applies to Encounter mode.
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-4">
          <input
            type="number"
            min={1}
            value={timeoutInput}
            onChange={e => setTimeoutInput(e.target.value)}
            onBlur={commitTimeout}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="w-16 text-sm text-right bg-panel-alt/60 border border-white/10 rounded px-2 py-1 text-gray-200"
          />
          <span className="text-xs text-gray-500">sec</span>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-sm text-gray-200">Enable Movement Tracking</div>
            <span className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40">EXPERIMENTAL</span>
          </div>
          <div className="text-[11px] text-gray-500">Captures party/self position samples for the Map tab. Off by default to reduce addon memory usage.</div>
        </div>
        <button
          onClick={() => onChange({ ...prefs, disableMovement: !prefs.disableMovement })}
          role="switch"
          aria-checked={!prefs.disableMovement}
          className={`shrink-0 ml-4 relative w-11 h-6 rounded-full transition-colors ${!prefs.disableMovement ? 'bg-accent/70' : 'bg-white/15'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${!prefs.disableMovement ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
        <div>
          <div className="text-sm text-gray-200">Lightweight Mode</div>
          <div className="text-[11px] text-gray-500">Disables HP, TP, MP, and position tracking. Lowers addon&apos;s ingame memory use over long encounters.</div>
        </div>
        <button
          onClick={() => onChange({ ...prefs, lightweight: !prefs.lightweight })}
          role="switch"
          aria-checked={prefs.lightweight}
          className={`shrink-0 ml-4 relative w-11 h-6 rounded-full transition-colors ${prefs.lightweight ? 'bg-accent/70' : 'bg-white/15'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${prefs.lightweight ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-sm text-gray-200">Track Currency</div>
            <span className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40">EXPERIMENTAL</span>
          </div>
          <div className="text-[11px] text-gray-500">Captures gil / currency deltas on each encounter. Adds a 3 second wait at encounter close while polling for the server&apos;s reply.</div>
        </div>
        <button
          onClick={() => onChange({ ...prefs, trackCurrency: !prefs.trackCurrency })}
          role="switch"
          aria-checked={prefs.trackCurrency}
          className={`shrink-0 ml-4 relative w-11 h-6 rounded-full transition-colors ${prefs.trackCurrency ? 'bg-accent/70' : 'bg-white/15'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${prefs.trackCurrency ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>

    </div>
  );
}
