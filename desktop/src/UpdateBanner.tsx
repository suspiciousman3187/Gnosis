import { useEffect, useState } from 'react';
import {
  subscribe as subscribeUpdater,
  subscribeAddon,
  checkForUpdates,
  checkAddonUpdate,
  downloadAndInstall,
  installAddonUpdate,
  skipVersion,
  skipAddonVersion,
  laterDismiss,
  dismissAddonState,
  dismissError,
  type UpdateState,
  type AddonUpdateState,
  resolveAddonDir,
  readInstalledAddonVersion,
  getLatestSeenDesktopVersion,
  getLatestSeenAddonVersion,
  isNewerSemver,
} from './updater';
import { inTauri, openExternal } from './library';

const MANIFEST_URL = 'https://gnosis-xi.com/updates/desktop.json';

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

export default function UpdateBanner({ dataDir }: { dataDir: string }) {
  const [desktopState, setDesktopState] = useState<UpdateState>({ kind: 'idle' });
  const [addonState, setAddonState] = useState<AddonUpdateState>({ kind: 'idle' });
  const [desktopVersion, setDesktopVersion] = useState<string>('');
  const [addonVersion, setAddonVersion] = useState<string | null>(null);
  const [addonDir, setAddonDir] = useState<string | null>(null);

  useEffect(() => subscribeUpdater(setDesktopState), []);
  useEffect(() => subscribeAddon(setAddonState), []);
  useEffect(() => {
    void import('@tauri-apps/api/app').then(m => m.getVersion()).then(setDesktopVersion).catch(() => {});
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await resolveAddonDir(dataDir);
      if (cancelled) return;
      setAddonDir(d);
      if (d) {
        const v = await readInstalledAddonVersion(d);
        if (!cancelled) setAddonVersion(v);
      } else {
        setAddonVersion(null);
      }
    })();
    return () => { cancelled = true; };
  }, [dataDir, addonState.kind]);

  if (!inTauri) return null;

  const desktopHasUpdate = desktopState.kind === 'available';
  const desktopUpdating = desktopState.kind === 'downloading' || desktopState.kind === 'installing';
  const desktopErrored = desktopState.kind === 'error';
  const desktopChecking = desktopState.kind === 'checking';

  const addonHasUpdate = addonState.kind === 'available';
  const addonUpdating = addonState.kind === 'installing';
  const addonInstalled = addonState.kind === 'installed';
  const addonErrored = addonState.kind === 'error';
  const addonNoDir = addonState.kind === 'no-addon-dir';
  const addonChecking = addonState.kind === 'checking';

  const anyAttention = desktopHasUpdate || desktopUpdating
    || addonHasUpdate || addonUpdating || addonInstalled;

  const desktopErrorMsg = desktopState.kind === 'error' ? desktopState.message : null;
  const addonErrorMsg = addonState.kind === 'error' ? addonState.message
    : addonState.kind === 'no-addon-dir' ? addonState.message
    : null;

  if (!anyAttention) {
    const latestDesktop = getLatestSeenDesktopVersion();
    const latestAddon = getLatestSeenAddonVersion();
    const desktopBehind = !!(latestDesktop && desktopVersion && isNewerSemver(latestDesktop, desktopVersion));
    const addonBehind = !!(latestAddon && addonVersion && isNewerSemver(latestAddon, addonVersion));

    const upToDateCls    = 'text-emerald-200 bg-emerald-500/15 border-emerald-500/40 hover:bg-emerald-500/25';
    const updateFoundCls = 'text-accent bg-accent/15 border-accent/40 hover:bg-accent/25';
    const checkNowCls    = 'text-gray-400 bg-white/[0.04] border-white/15 hover:text-gray-100 hover:bg-white/[0.08] hover:border-white/25';
    const checkingCls    = 'text-gray-400 bg-white/[0.05] border-white/15';
    const errorCls       = 'text-amber-200 bg-amber-500/15 border-amber-500/40 hover:bg-amber-500/25';

    const desktopBadge = desktopChecking
      ? { label: 'Checking…', tooltip: 'Checking for updates…', cls: checkingCls }
      : desktopErrorMsg
        ? { label: 'Check failed', tooltip: `Update check failed - click to retry.\n\n${desktopErrorMsg}`, cls: errorCls }
        : desktopBehind
          ? { label: 'Update available', tooltip: `New version v${latestDesktop} available. Click to recheck.`, cls: updateFoundCls }
          : desktopState.kind === 'none'
            ? { label: 'Up to date', tooltip: `You're running the latest version. Click to recheck.`, cls: upToDateCls }
            : { label: 'Check now', tooltip: 'Check for Viewer updates', cls: checkNowCls };

    const addonBadge = addonChecking
      ? { label: 'Checking…', tooltip: 'Checking for addon updates…', cls: checkingCls }
      : addonState.kind === 'no-addon-dir'
        ? { label: 'Folder ?', tooltip: `Addon folder not found - click to retry.\n\n${addonState.message}`, cls: errorCls }
        : addonErrorMsg
          ? { label: 'Check failed', tooltip: `Update check failed - click to retry.\n\n${addonErrorMsg}`, cls: errorCls }
          : addonBehind
            ? { label: 'Update available', tooltip: `New addon version v${latestAddon} available. Click to recheck.`, cls: updateFoundCls }
            : addonState.kind === 'none'
              ? { label: 'Up to date', tooltip: `Your addon is on the latest version. Click to recheck.`, cls: upToDateCls }
              : { label: 'Check now', tooltip: 'Check for Windower addon updates', cls: checkNowCls };

    const checkDesktop = () => { dismissError(); void checkForUpdates({ minCheckingMs: 1500 }); };
    const checkAddon = () => { dismissAddonState(); void checkAddonUpdate({ dataDir, manifestUrl: MANIFEST_URL, minCheckingMs: 1500 }); };

    return (
      <div className="flex items-stretch justify-between gap-4 bg-row-even border border-white/10 rounded-xl px-5 py-4">
        <div className="flex items-stretch gap-5 min-w-0">
          <div className="min-w-0 flex flex-col justify-center">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold flex items-center gap-1.5">
              Viewer
              <button
                type="button"
                onClick={checkDesktop}
                disabled={desktopChecking}
                data-tooltip={desktopBadge.tooltip}
                className={`text-[8.5px] font-bold uppercase tracking-wider border rounded px-1.5 py-0.5 transition-colors disabled:cursor-not-allowed ${desktopBadge.cls}`}
              >
                {desktopBadge.label}
              </button>
            </div>
            <div className={`text-lg font-bold font-mono flex items-baseline gap-2 ${desktopBehind ? 'text-rose-300' : 'text-emerald-300'}`}>
              <span>v{desktopVersion || '-'}</span>
              {desktopBehind && (
                <span className="text-[10px] uppercase tracking-wider text-rose-400">(outdated)</span>
              )}
            </div>
            {desktopBehind && <div className="text-[10px] text-rose-400/80 font-mono">latest: v{latestDesktop}</div>}
          </div>
          <div className="min-w-0 flex flex-col justify-center border-l border-white/10 pl-5">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold flex items-center gap-1.5">
              Addon
              <button
                type="button"
                onClick={checkAddon}
                disabled={addonChecking}
                data-tooltip={addonBadge.tooltip}
                className={`text-[8.5px] font-bold uppercase tracking-wider border rounded px-1.5 py-0.5 transition-colors disabled:cursor-not-allowed ${addonBadge.cls}`}
              >
                {addonBadge.label}
              </button>
            </div>
            <div className={`text-lg font-bold font-mono flex items-baseline gap-2 ${addonBehind ? 'text-rose-300' : 'text-emerald-300'}`}>
              <span>{addonVersion ? `v${addonVersion}` : '-'}</span>
              {addonBehind && (
                <span className="text-[10px] uppercase tracking-wider text-rose-400">(outdated)</span>
              )}
            </div>
            {addonBehind && <div className="text-[10px] text-rose-400/80 font-mono">latest: v{latestAddon}</div>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => { void openExternal('https://gnosis-xi.com'); }}
          data-tooltip="Open gnosis-xi.com in your browser"
          data-tooltip-tone="accent"
          className="shrink-0 min-w-0 flex flex-col justify-center border-l border-white/10 pl-5 text-left group"
        >
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold flex items-center gap-1.5">
            Web
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600 group-hover:text-accent transition-colors" aria-hidden="true">
              <path d="M7 17L17 7" />
              <path d="M7 7h10v10" />
            </svg>
          </div>
          <div className="text-lg font-bold font-mono text-accent group-hover:text-accent/80 transition-colors truncate">
            gnosis-xi.com
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {(desktopHasUpdate || desktopUpdating) && (
        <DesktopRow
          state={desktopState}
          installedVersion={desktopVersion}
        />
      )}
      {(addonHasUpdate || addonUpdating || addonInstalled) && (
        <AddonRow
          state={addonState}
          installedVersion={addonVersion}
          addonDir={addonDir}
        />
      )}
    </div>
  );

  function DesktopRow({ state, installedVersion }: { state: UpdateState; installedVersion: string }) {
    if (state.kind === 'available') {
      return (
        <div className="bg-row-odd border border-accent/50 rounded-lg px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-accent">
                Viewer update available: v{installedVersion} → v{state.version}
              </div>
              {state.notes && (
                <div className="text-[11px] text-gray-300 mt-1.5 max-h-20 overflow-y-auto whitespace-pre-wrap border-l-2 border-white/10 pl-2">
                  {state.notes}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => skipVersion(state.version)} className="text-[11px] rounded px-2 py-1 text-gray-500 hover:text-gray-300 transition-colors">
                Skip
              </button>
              <button onClick={laterDismiss} className="text-[11px] rounded px-2 py-1 bg-white/[0.06] border border-white/15 text-gray-200 hover:bg-white/[0.10]">
                Later
              </button>
              <button onClick={() => downloadAndInstall(state.update)} className="text-[11px] rounded px-3 py-1 bg-accent text-zinc-950 font-semibold hover:bg-accent/90">
                Update now
              </button>
            </div>
          </div>
        </div>
      );
    }
    if (state.kind === 'downloading') {
      const pct = state.total ? Math.round((state.downloaded / state.total) * 100) : null;
      return (
        <div className="bg-row-odd border border-accent/50 rounded-lg px-4 py-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-sm font-semibold text-accent">Downloading Viewer update…</div>
            <div className="text-[11px] font-mono text-gray-400 shrink-0">
              {fmtBytes(state.downloaded)}{state.total ? ` / ${fmtBytes(state.total)}` : ''}{pct != null ? ` · ${pct}%` : ''}
            </div>
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
            <div className="h-full bg-accent transition-[width] duration-200" style={{ width: pct != null ? `${pct}%` : '40%' }} />
          </div>
        </div>
      );
    }
    if (state.kind === 'installing') {
      return (
        <div className="bg-row-odd border border-accent/50 rounded-lg px-4 py-3">
          <div className="text-sm font-semibold text-accent">Installing update…</div>
          <div className="text-[11px] text-gray-400 mt-0.5">App will relaunch shortly.</div>
        </div>
      );
    }
    if (state.kind === 'error') {
      return (
        <div className="bg-row-odd border border-rose-500/50 rounded-lg px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-rose-200">Viewer update check failed</div>
            <div className="text-[11px] text-rose-300/80 font-mono mt-1 break-all">{state.message}</div>
          </div>
          <button onClick={dismissError} className="text-rose-300 hover:text-rose-100 text-lg leading-none shrink-0">×</button>
        </div>
      );
    }
    return null;
  }

  function AddonRow({ state, installedVersion, addonDir }: { state: AddonUpdateState; installedVersion: string | null; addonDir: string | null }) {
    if (state.kind === 'available') {
      return (
        <div className="bg-row-odd border border-accent/50 rounded-lg px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-accent">
                Addon update available: v{installedVersion ?? '?'} → v{state.manifest.version}
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">
                Files in <span className="font-mono text-gray-300">data/</span> and <span className="font-mono text-gray-300">*config*.json</span> are left alone. After install, type <span className="font-mono text-accent">//lua r gnosis</span> in FFXI.
              </div>
              {state.manifest.notes && (
                <div className="text-[11px] text-gray-300 mt-1.5 max-h-20 overflow-y-auto whitespace-pre-wrap border-l-2 border-white/10 pl-2">
                  {state.manifest.notes}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => skipAddonVersion(state.manifest.version)} className="text-[11px] rounded px-2 py-1 text-gray-500 hover:text-gray-300 transition-colors">
                Skip
              </button>
              <button onClick={dismissAddonState} className="text-[11px] rounded px-2 py-1 bg-white/[0.06] border border-white/15 text-gray-200 hover:bg-white/[0.10]">
                Later
              </button>
              <button onClick={() => installAddonUpdate(state.addonDir, state.manifest)} className="text-[11px] rounded px-3 py-1 bg-accent text-zinc-950 font-semibold hover:bg-accent/90">
                Update now
              </button>
            </div>
          </div>
        </div>
      );
    }
    if (state.kind === 'installing') {
      return (
        <div className="bg-row-odd border border-accent/50 rounded-lg px-4 py-3">
          <div className="text-sm font-semibold text-accent">Updating addon files…</div>
          <div className="text-[11px] text-gray-400 mt-0.5">Your data folder is untouched.</div>
        </div>
      );
    }
    if (state.kind === 'installed') {
      return (
        <div className="bg-row-odd border border-emerald-500/50 rounded-lg px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-emerald-200">Addon updated to v{state.result.installed_version}</div>
            <div className="text-[11px] text-emerald-100 mt-1 font-mono bg-black/30 rounded inline-block px-2 py-0.5">
              In FFXI: <span className="text-accent font-bold">//lua r gnosis</span>
            </div>
            <div className="text-[10px] text-emerald-400/70 mt-1.5">
              {state.result.files_written} files written · {state.result.files_skipped} skipped (data + config preserved)
            </div>
          </div>
          <button onClick={dismissAddonState} className="text-emerald-300 hover:text-emerald-100 text-lg leading-none shrink-0">×</button>
        </div>
      );
    }
    if (state.kind === 'no-addon-dir') {
      return (
        <div className="bg-row-odd border border-amber-500/50 rounded-lg px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-amber-200">Addon folder not found</div>
            <div className="text-[11px] text-amber-300/80 mt-0.5 leading-snug">
              Open Settings → Updates → set the addon folder path. Detected data folder: <span className="font-mono">{addonDir ?? dataDir}</span>
            </div>
          </div>
          <button onClick={dismissAddonState} className="text-amber-300 hover:text-amber-100 text-lg leading-none shrink-0">×</button>
        </div>
      );
    }
    if (state.kind === 'error') {
      return (
        <div className="bg-row-odd border border-rose-500/50 rounded-lg px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-rose-200">Addon update failed</div>
            <div className="text-[11px] text-rose-300/80 font-mono mt-1 break-all">{state.message}</div>
          </div>
          <button onClick={dismissAddonState} className="text-rose-300 hover:text-rose-100 text-lg leading-none shrink-0">×</button>
        </div>
      );
    }
    return null;
  }
}
