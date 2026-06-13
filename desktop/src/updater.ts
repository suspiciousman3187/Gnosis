import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { invoke } from '@tauri-apps/api/core';
import { inTauri } from './library';

const CHECK_ON_STARTUP_KEY = 'ff_check_updates_on_startup';
const SKIPPED_VERSION_KEY = 'ff_update_skipped_version';
const LATEST_DESKTOP_VERSION_KEY = 'ff_latest_desktop_version_seen';
const LATEST_ADDON_VERSION_KEY = 'ff_latest_addon_version_seen';

export function getLatestSeenDesktopVersion(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(LATEST_DESKTOP_VERSION_KEY);
}
export function getLatestSeenAddonVersion(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(LATEST_ADDON_VERSION_KEY);
}
function rememberLatestDesktop(v: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LATEST_DESKTOP_VERSION_KEY, v);
}
function rememberLatestAddon(v: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LATEST_ADDON_VERSION_KEY, v);
}

export function getCheckOnStartupEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  const v = localStorage.getItem(CHECK_ON_STARTUP_KEY);
  return v == null ? true : v === '1';
}

export function setCheckOnStartupEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(CHECK_ON_STARTUP_KEY, enabled ? '1' : '0');
}

export function getSkippedVersion(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(SKIPPED_VERSION_KEY);
}

export function setSkippedVersion(version: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (version == null) localStorage.removeItem(SKIPPED_VERSION_KEY);
  else localStorage.setItem(SKIPPED_VERSION_KEY, version);
}

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; update: Update; version: string; notes?: string; date?: string }
  | { kind: 'none' }
  | { kind: 'downloading'; downloaded: number; total: number | null }
  | { kind: 'installing' }
  | { kind: 'error'; message: string };

type Listener = (s: UpdateState) => void;

let current: UpdateState = { kind: 'idle' };
const listeners = new Set<Listener>();

function emit(s: UpdateState) {
  current = s;
  for (const l of listeners) l(s);
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  l(current);
  return () => { listeners.delete(l); };
}

export function getState(): UpdateState { return current; }

export async function checkForUpdates(opts: { respectSkip?: boolean; minCheckingMs?: number } = {}): Promise<void> {
  if (!inTauri) {
    emit({ kind: 'error', message: 'updater is only available in the desktop app' });
    return;
  }
  if (current.kind === 'checking' || current.kind === 'downloading' || current.kind === 'installing') return;
  emit({ kind: 'checking' });
  const start = Date.now();
  const minMs = opts.minCheckingMs ?? 0;
  const holdChecking = async () => {
    const elapsed = Date.now() - start;
    if (elapsed < minMs) await new Promise(r => setTimeout(r, minMs - elapsed));
  };
  try {
    const update = await check();
    if (!update) {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(LATEST_DESKTOP_VERSION_KEY);
      await holdChecking();
      emit({ kind: 'none' });
      return;
    }
    rememberLatestDesktop(update.version);
    if (opts.respectSkip) {
      const skipped = getSkippedVersion();
      if (skipped && skipped === update.version) { await holdChecking(); emit({ kind: 'none' }); return; }
    }
    await holdChecking();
    emit({
      kind: 'available',
      update,
      version: update.version,
      notes: update.body ?? undefined,
      date: update.date ?? undefined,
    });
  } catch (e) {
    await holdChecking();
    emit({ kind: 'error', message: String(e) });
  }
}

export async function downloadAndInstall(update: Update): Promise<void> {
  if (!inTauri) return;
  let total: number | null = null;
  let downloaded = 0;
  emit({ kind: 'downloading', downloaded: 0, total: null });
  try {
    await update.downloadAndInstall(event => {
      if (event.event === 'Started') {
        total = typeof event.data.contentLength === 'number' ? event.data.contentLength : null;
        emit({ kind: 'downloading', downloaded: 0, total });
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength;
        emit({ kind: 'downloading', downloaded, total });
      } else if (event.event === 'Finished') {
        emit({ kind: 'installing' });
      }
    });
    await relaunch();
  } catch (e) {
    emit({ kind: 'error', message: String(e) });
  }
}

export function dismissError(): void {
  if (current.kind === 'error' || current.kind === 'none') emit({ kind: 'idle' });
}

export function skipVersion(version: string): void {
  setSkippedVersion(version);
  emit({ kind: 'idle' });
}

export function laterDismiss(): void {
  emit({ kind: 'idle' });
}

const ADDON_DIR_OVERRIDE_KEY = 'ff_addon_dir_override';
const ADDON_SKIPPED_VERSION_KEY = 'ff_addon_update_skipped_version';

export function getAddonDirOverride(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(ADDON_DIR_OVERRIDE_KEY);
}

export function setAddonDirOverride(p: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (p == null) localStorage.removeItem(ADDON_DIR_OVERRIDE_KEY);
  else localStorage.setItem(ADDON_DIR_OVERRIDE_KEY, p);
}

export function getAddonSkippedVersion(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(ADDON_SKIPPED_VERSION_KEY);
}

export function setAddonSkippedVersion(v: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (v == null) localStorage.removeItem(ADDON_SKIPPED_VERSION_KEY);
  else localStorage.setItem(ADDON_SKIPPED_VERSION_KEY, v);
}

export interface ManifestAddon {
  version: string;
  url: string;
  sha256?: string;
  notes?: string;
}

export async function resolveAddonDir(dataDir: string | null): Promise<string | null> {
  const override = getAddonDirOverride();
  if (override) return override;
  if (!inTauri || !dataDir) return null;
  try { return await invoke<string | null>('derive_addon_dir', { dataDir }); } catch { return null; }
}

export async function readInstalledAddonVersion(addonDir: string): Promise<string | null> {
  if (!inTauri) return null;
  try { return await invoke<string | null>('read_installed_addon_version', { addonDir }); } catch { return null; }
}

export interface AddonInstallResult {
  installed_version: string;
  files_written: number;
  files_skipped: number;
  skipped_examples: string[];
  addon_dir: string;
}

export type AddonUpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; manifest: ManifestAddon; addonDir: string; installedVersion: string | null }
  | { kind: 'none' }
  | { kind: 'no-addon-dir'; message: string }
  | { kind: 'installing' }
  | { kind: 'installed'; result: AddonInstallResult }
  | { kind: 'error'; message: string };

let addonCurrent: AddonUpdateState = { kind: 'idle' };
const addonListeners = new Set<(s: AddonUpdateState) => void>();
function emitAddon(s: AddonUpdateState) {
  addonCurrent = s;
  for (const l of addonListeners) l(s);
}
export function subscribeAddon(l: (s: AddonUpdateState) => void): () => void {
  addonListeners.add(l);
  l(addonCurrent);
  return () => { addonListeners.delete(l); };
}
export function getAddonState(): AddonUpdateState { return addonCurrent; }

export function isNewerSemver(latest: string, installed: string | null): boolean {
  if (!installed) return true;
  const a = latest.split('.').map(n => parseInt(n, 10) || 0);
  const b = installed.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

export async function checkAddonUpdate(opts: { dataDir: string | null; manifestUrl: string; respectSkip?: boolean; minCheckingMs?: number }): Promise<void> {
  if (!inTauri) return;
  if (addonCurrent.kind === 'checking' || addonCurrent.kind === 'installing') return;
  emitAddon({ kind: 'checking' });
  const start = Date.now();
  const minMs = opts.minCheckingMs ?? 0;
  const holdChecking = async () => {
    const elapsed = Date.now() - start;
    if (elapsed < minMs) await new Promise(r => setTimeout(r, minMs - elapsed));
  };
  try {
    const addonDir = await resolveAddonDir(opts.dataDir);
    if (!addonDir) {
      await holdChecking();
      emitAddon({ kind: 'no-addon-dir', message: 'Could not find Gnosis.lua next to your data folder. Open Settings → Updates → Browse to your addon folder.' });
      return;
    }
    const installed = await readInstalledAddonVersion(addonDir);
    const resp = await fetch(opts.manifestUrl, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`manifest fetch ${resp.status}`);
    const manifest = await resp.json() as { addon?: ManifestAddon };
    if (!manifest.addon || !manifest.addon.version || !manifest.addon.url) {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(LATEST_ADDON_VERSION_KEY);
      await holdChecking();
      emitAddon({ kind: 'none' });
      return;
    }
    rememberLatestAddon(manifest.addon.version);
    if (!isNewerSemver(manifest.addon.version, installed)) {
      await holdChecking();
      emitAddon({ kind: 'none' });
      return;
    }
    if (opts.respectSkip && getAddonSkippedVersion() === manifest.addon.version) {
      await holdChecking();
      emitAddon({ kind: 'none' });
      return;
    }
    await holdChecking();
    emitAddon({ kind: 'available', manifest: manifest.addon, addonDir, installedVersion: installed });
  } catch (e) {
    await holdChecking();
    emitAddon({ kind: 'error', message: String(e) });
  }
}

export async function installAddonUpdate(addonDir: string, manifest: ManifestAddon): Promise<void> {
  if (!inTauri) return;
  emitAddon({ kind: 'installing' });
  try {
    const result = await invoke<AddonInstallResult>('install_addon_update', {
      addonDir,
      url: manifest.url,
      expectedSha256: manifest.sha256 ?? null,
    });
    emitAddon({ kind: 'installed', result });
  } catch (e) {
    emitAddon({ kind: 'error', message: String(e) });
  }
}

export function skipAddonVersion(version: string): void {
  setAddonSkippedVersion(version);
  emitAddon({ kind: 'idle' });
}

export function dismissAddonState(): void {
  emitAddon({ kind: 'idle' });
}
