'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { DisplayLanguage } from './translate';
import { ensureBundlesLoaded, TRANSLATE_BUNDLES } from './translate';

const STORAGE_KEY = 'ff_display_language';
const EVENT_NAME = 'ff:display-language';

function readStored(): DisplayLanguage {
  if (typeof localStorage === 'undefined') return 'auto';
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === 'en' || v === 'ja' || v === 'auto') return v;
  return 'auto';
}

let current: DisplayLanguage = readStored();
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot(): DisplayLanguage { return current; }
function getServerSnapshot(): DisplayLanguage { return 'auto'; }

export function setDisplayLanguage(next: DisplayLanguage): void {
  if (next === current) return;
  current = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  for (const cb of listeners) cb();
  try { window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next })); } catch {}
  if (next !== 'auto') void ensureBundlesLoaded(TRANSLATE_BUNDLES);
}

export function getDisplayLanguage(): DisplayLanguage { return current; }

export function useDisplayLanguage(): DisplayLanguage {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Hook variant that also lazy-loads translation bundles on first non-auto access. */
export function useDisplayLanguageEager(): DisplayLanguage {
  const lang = useDisplayLanguage();
  useEffect(() => {
    if (lang !== 'auto') void ensureBundlesLoaded(TRANSLATE_BUNDLES);
  }, [lang]);
  return lang;
}
