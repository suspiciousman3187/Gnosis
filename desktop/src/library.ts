import { invoke } from '@tauri-apps/api/core';
import { isReportFile, fileTs, DEFAULT_TRACKER_PREFS, type TrackerStatus, type TrackingMode, type TrackerLive, type TrackerPrefs } from './content';

const joinDir = (dir: string, name: string) => dir.replace(/[\\/]+$/, '') + '\\' + name;

// True when running inside the Tauri window (vs the dev browser). Folder reading
// only works in Tauri; the browser falls back to the file picker.
export const inTauri =
  typeof window !== 'undefined' &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (typeof (window as any).__TAURI_INTERNALS__ !== 'undefined' || typeof (window as any).__TAURI__ !== 'undefined');

// All report files in the data folder (encounters + content runs), newest first.
// Snapshots/configs and unknown JSON are filtered out by isReportFile.
export async function listReportFiles(dir: string): Promise<string[]> {
  const all = await invoke<string[]>('list_json_files', { dir });
  return all.filter(isReportFile).sort((a, b) => fileTs(b) - fileTs(a));
}

export async function readText(path: string): Promise<string> {
  return await invoke<string>('read_text_file', { path });
}

export async function deleteFile(path: string): Promise<void> {
  await invoke('delete_file', { path });
}

export async function compressIdleFiles(dir: string, ageSecs = 3600): Promise<number> {
  if (!inTauri) return 0;
  try {
    return await invoke<number>('compress_idle_files', { dir, ageSecs });
  } catch {
    return 0;
  }
}

export async function openExternal(url: string): Promise<void> {
  if (inTauri) { await invoke('open_url', { url }); return; }
  window.open(url, '_blank', 'noopener');
}

// ── Tracker control bridge ──────────────────────────────────────────────────
// Read the addon's published state; null if it hasn't been written yet.
export async function readTrackerStatus(dir: string): Promise<TrackerStatus | null> {
  try {
    return JSON.parse(await invoke<string>('read_text_file', { path: joinDir(dir, 'tracker_status.json') })) as TrackerStatus;
  } catch {
    return null;
  }
}

// Read the live combat snapshot for the overlay; null if not present.
export async function readTrackerLive(dir: string): Promise<TrackerLive | null> {
  try {
    return JSON.parse(await invoke<string>('read_text_file', { path: joinDir(dir, 'tracker_live.json') })) as TrackerLive;
  } catch {
    return null;
  }
}

// Send a tracking command to the addon. The nonce makes each write a distinct
// command the addon applies exactly once.
export async function writeTrackerControl(dir: string, cmd: { mode?: TrackingMode; idleTimeout?: number; lightweight?: boolean; disableMovement?: boolean; wantsLiveCombat?: boolean; trackCurrency?: boolean; action?: 'save' }): Promise<void> {
  await invoke('write_text_file', {
    path: joinDir(dir, 'tracker_control.json'),
    contents: JSON.stringify({ ...cmd, nonce: Date.now() }),
  });
}

export async function readTrackerPrefs(dir: string): Promise<TrackerPrefs> {
  try {
    const o = JSON.parse(await invoke<string>('read_text_file', { path: joinDir(dir, 'tracker_prefs.json') }));
    const mode: TrackingMode = (['off', 'zone', 'fight', 'session'] as const).includes(o?.mode) ? o.mode : DEFAULT_TRACKER_PREFS.mode;
    const idleTimeout = typeof o?.idleTimeout === 'number' && o.idleTimeout >= 1 ? Math.floor(o.idleTimeout) : DEFAULT_TRACKER_PREFS.idleTimeout;
    const lightweight = typeof o?.lightweight === 'boolean' ? o.lightweight : DEFAULT_TRACKER_PREFS.lightweight;
    const disableMovement = typeof o?.disableMovement === 'boolean' ? o.disableMovement : DEFAULT_TRACKER_PREFS.disableMovement;
    const trackCurrency = typeof o?.trackCurrency === 'boolean' ? o.trackCurrency : DEFAULT_TRACKER_PREFS.trackCurrency;
    return { mode, idleTimeout, lightweight, disableMovement, trackCurrency };
  } catch {
    return { ...DEFAULT_TRACKER_PREFS };
  }
}

export async function writeTrackerPrefs(dir: string, prefs: TrackerPrefs): Promise<void> {
  await invoke('write_text_file', {
    path: joinDir(dir, 'tracker_prefs.json'),
    contents: JSON.stringify(prefs),
  });
}

export { fileTs };
