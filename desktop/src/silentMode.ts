import { invoke } from '@tauri-apps/api/core';
import { useEffect, useSyncExternalStore } from 'react';
import { inTauri } from './library';

const STORAGE_KEY = 'ff_silent_mode_on_minimize';
const STORAGE_HIDE_OVERLAY_KEY = 'ff_silent_mode_hide_overlay';

function readStored(key: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(key) === '1';
}

let current = readStored(STORAGE_KEY);
let currentHideOverlay = readStored(STORAGE_HIDE_OVERLAY_KEY);
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function notify() { for (const cb of listeners) cb(); }

function getSnapshot(): boolean { return current; }
function getHideOverlaySnapshot(): boolean { return currentHideOverlay; }
function getServerSnapshot(): boolean { return false; }

export function getSilentModeOnMinimize(): boolean { return current; }
export function getSilentModeHideOverlay(): boolean { return currentHideOverlay; }

export async function setSilentModeOnMinimize(enabled: boolean): Promise<void> {
  if (enabled === current) return;
  current = enabled;
  try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch {}
  notify();
  if (inTauri) {
    try { await invoke('set_silent_mode_on_minimize', { enabled }); } catch {}
  }
}

export async function setSilentModeHideOverlay(enabled: boolean): Promise<void> {
  if (enabled === currentHideOverlay) return;
  currentHideOverlay = enabled;
  try { localStorage.setItem(STORAGE_HIDE_OVERLAY_KEY, enabled ? '1' : '0'); } catch {}
  notify();
  if (inTauri) {
    try { await invoke('set_silent_mode_hide_overlay', { enabled }); } catch {}
  }
}

export async function enterSilentModeNow(): Promise<void> {
  if (!inTauri) return;
  try { await invoke('enter_silent_mode'); } catch {}
}

export function useSilentModeOnMinimize(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useSilentModeHideOverlay(): boolean {
  return useSyncExternalStore(subscribe, getHideOverlaySnapshot, getServerSnapshot);
}

export function useSilentModeBootSync(): void {
  useEffect(() => {
    if (!inTauri) return;
    void invoke('set_silent_mode_on_minimize', { enabled: current });
    void invoke('set_silent_mode_hide_overlay', { enabled: currentHideOverlay });
  }, []);
}
