import { useSyncExternalStore } from 'react';

// Anonymize Names: one toggle that blurs every element tagged as PII (character
// names and anything that embeds one) so the whole UI - and the pop-out overlay -
// can be streamed/screenshotted without leaking real names. A boolean persisted
// to localStorage + a data-attribute on <html> that a global CSS rule keys off
// ([data-anon-blur="on"] .gn-pii). Purely visual: it never changes the underlying
// data, so nothing that keys on a name/id is affected. The `storage` listener
// keeps the separate overlay document in step live (same origin, shared storage).
const KEY = 'gn-anon-blur';

function read(): boolean {
  try { return localStorage.getItem(KEY) === 'on'; } catch { return false; }
}

function apply(on: boolean) {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.dataset.anonBlur = 'on';
  else delete document.documentElement.dataset.anonBlur;
}

let current = read();
apply(current);

const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    const on = e.newValue === 'on';
    if (on === current) return;
    current = on;
    apply(on);
    listeners.forEach((l) => l());
  });
}

export function getAnonBlur(): boolean { return current; }

export function setAnonBlur(on: boolean) {
  current = on;
  apply(on);
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export function useAnonBlur() {
  const on = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => current,
    () => current,
  );
  return [on, setAnonBlur] as const;
}
