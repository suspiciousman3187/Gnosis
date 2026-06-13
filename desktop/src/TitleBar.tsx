import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { inTauri } from './library';
import { closeOverlayWindow } from './overlay';
import { resolveAddonDir, readInstalledAddonVersion, subscribeAddon, type AddonUpdateState } from './updater';

const CTRL = 'w-11 h-full flex items-center justify-center text-gray-400 hover:text-white transition-colors';

export default function TitleBar({ dataDir = '' }: { dataDir?: string }) {
  const [maximized, setMaximized] = useState(false);
  const [appVersion, setAppVersion] = useState<string>('');
  const [addonVersion, setAddonVersion] = useState<string | null>(null);
  const [addonState, setAddonState] = useState<AddonUpdateState>({ kind: 'idle' });

  useEffect(() => {
    if (!inTauri) return;
    const w = getCurrentWindow();
    w.isMaximized().then(setMaximized).catch(() => {});
    const unlisten = w.onResized(() => { w.isMaximized().then(setMaximized).catch(() => {}); });
    return () => { unlisten.then(f => f()).catch(() => {}); };
  }, []);

  useEffect(() => {
    if (!inTauri) return;
    void import('@tauri-apps/api/app').then(m => m.getVersion()).then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => subscribeAddon(setAddonState), []);

  useEffect(() => {
    if (!inTauri) return;
    let cancelled = false;
    (async () => {
      const d = await resolveAddonDir(dataDir || null);
      if (cancelled || !d) { if (!cancelled) setAddonVersion(null); return; }
      const v = await readInstalledAddonVersion(d);
      if (!cancelled) setAddonVersion(v);
    })();
    return () => { cancelled = true; };
  }, [dataDir, addonState.kind]);

  if (!inTauri) return null;
  const w = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="bg-nav shrink-0 h-8 flex items-center justify-between border-b border-white/10 select-none"
    >
      <div data-tauri-drag-region className="flex items-center gap-1.5 px-3 text-xs">
        <span className="font-bold text-accent tracking-wide">GNOSIS</span>
        <span className="text-gray-500 font-medium">
          <span className="text-gray-600">·</span> App v{appVersion || '-'}
          <span className="text-gray-700 mx-1.5">|</span>
          Addon {addonVersion ? `v${addonVersion}` : '-'}
        </span>
      </div>
      <div className="flex items-stretch h-full">
        <button className={CTRL} onClick={() => w.minimize()} aria-label="Minimize">
          <svg width="11" height="11" viewBox="0 0 11 11"><rect x="1" y="5" width="9" height="1" fill="currentColor" /></svg>
        </button>
        <button
          className={CTRL}
          onClick={async () => { await w.toggleMaximize(); setMaximized(await w.isMaximized().catch(() => false)); }}
          aria-label="Maximize"
        >
          {maximized ? (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor">
              <rect x="1" y="3" width="7" height="7" />
              <path d="M3 3V1h7v7H8" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor">
              <rect x="1" y="1" width="9" height="9" />
            </svg>
          )}
        </button>
        <button className={`${CTRL} hover:bg-red-600`} onClick={async () => { await closeOverlayWindow(); try { await invoke('quit_app'); } catch { w.close(); } }} aria-label="Close">
          <svg width="11" height="11" viewBox="0 0 11 11" stroke="currentColor" strokeWidth="1.1">
            <path d="M1 1l9 9M10 1l-9 9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
