import { Window } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { inTauri } from './library';

const OVERLAY_LABEL = 'overlay';

async function existing(): Promise<Window | null> {
  if (!inTauri) return null;
  return Window.getByLabel(OVERLAY_LABEL);
}

function createOverlay(alwaysOnTop: boolean): WebviewWindow {
  return new WebviewWindow(OVERLAY_LABEL, {
    url: '/index.html#overlay',
    title: 'Gnosis Overlay',
    width: 420,
    height: 340,
    minWidth: 280,
    minHeight: 36,
    decorations: false,
    transparent: true,
    alwaysOnTop,
    skipTaskbar: true,
    resizable: true,
    shadow: false,
    visible: true,
  });
}

export async function showOverlay(alwaysOnTop: boolean) {
  if (!inTauri) return;
  const found = await existing();
  if (found) {
    await found.setAlwaysOnTop(alwaysOnTop);
    await found.show();
    await found.setFocus();
    return;
  }
  const w = createOverlay(alwaysOnTop);
  w.once('tauri://error', (e) => {
    console.error('[overlay] creation failed:', e);
    void import('@/lib/dialogs').then(m => m.alertDialog({ title: 'Overlay failed to open', message: 'Open DevTools console for details.', tone: 'danger' }));
  });
}

export async function hideOverlay() {
  const w = await existing();
  if (!w) return;
  try { await w.close(); } catch { /* already gone */ }
}

export async function setOverlayAlwaysOnTop(on: boolean) {
  const w = await existing();
  if (w) await w.setAlwaysOnTop(on);
}

export async function setOverlayClickthrough(on: boolean) {
  const w = await existing();
  if (w) await w.setIgnoreCursorEvents(on);
}

export async function isOverlayVisible(): Promise<boolean> {
  const w = await existing();
  return w ? await w.isVisible() : false;
}

export async function closeOverlayWindow() {
  const w = await existing();
  if (w) { try { await w.close(); } catch { /* already gone */ } }
}
