import { invoke } from '@tauri-apps/api/core';
import { inTauri } from './library';

const POLL_INTERVAL_MS = 15_000;
const SOFT_THRESHOLD_BYTES = 800 * 1024 * 1024;
const HOME_THRESHOLD_BYTES = 900 * 1024 * 1024;
const ANY_VIEW_THRESHOLD_BYTES = 1100 * 1024 * 1024;
const HARD_CAP_BYTES = 1300 * 1024 * 1024;
const SOFT_IDLE_MS = 30_000;
const HOME_IDLE_MS = 15_000;
const ANY_VIEW_IDLE_MS = 30_000;

interface WebViewProc { pid: number; name: string; working_set_bytes: number; process_type: string; sub_type: string }

let pollTimer: number | null = null;
let activeSection: string = 'home';
let lastActivityAt: number = Date.now();
let suppressUntil: number = 0;

export function setMonitorSection(s: string): void { activeSection = s; }

async function getRendererWorkingSet(): Promise<number | null> {
  try {
    const procs = await invoke<WebViewProc[]>('get_webview_processes');
    const renderers = procs.filter(p => p.process_type === 'renderer').sort((a, b) => a.pid - b.pid);
    if (renderers.length === 0) return null;
    return renderers[0].working_set_bytes;
  } catch {
    return null;
  }
}

function bumpActivity() { lastActivityAt = Date.now(); }

export function startMemoryMonitor(): void {
  if (!inTauri) return;
  if (pollTimer != null) return;

  const onActivity = () => bumpActivity();
  window.addEventListener('mousemove', onActivity, { passive: true });
  window.addEventListener('mousedown', onActivity, { passive: true });
  window.addEventListener('keydown', onActivity, { passive: true });
  window.addEventListener('wheel', onActivity, { passive: true });
  window.addEventListener('touchstart', onActivity, { passive: true });

  const tick = async () => {
    if (document.hidden) return;
    if (Date.now() < suppressUntil) return;
    const bytes = await getRendererWorkingSet();
    if (bytes == null) return;
    const idleMs = Date.now() - lastActivityAt;

    if (bytes >= HARD_CAP_BYTES) {
      suppressUntil = Date.now() + 5 * 60 * 1000;
      window.location.reload();
      return;
    }
    if (bytes >= ANY_VIEW_THRESHOLD_BYTES && idleMs >= ANY_VIEW_IDLE_MS) {
      suppressUntil = Date.now() + 5 * 60 * 1000;
      window.location.reload();
      return;
    }
    if (bytes >= HOME_THRESHOLD_BYTES && activeSection === 'home' && idleMs >= HOME_IDLE_MS) {
      suppressUntil = Date.now() + 5 * 60 * 1000;
      window.location.reload();
      return;
    }
    if (bytes >= SOFT_THRESHOLD_BYTES && idleMs >= SOFT_IDLE_MS && activeSection === 'home') {
      suppressUntil = Date.now() + 5 * 60 * 1000;
      window.location.reload();
      return;
    }
  };

  void tick();
  pollTimer = window.setInterval(tick, POLL_INTERVAL_MS);
}

export function stopMemoryMonitor(): void {
  if (pollTimer != null) { window.clearInterval(pollTimer); pollTimer = null; }
}
