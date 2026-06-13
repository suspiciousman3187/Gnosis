import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getStoreStats, evictLootsExcept, clearStore, type StoreStats } from './summaryStore';
import { alertDialog, confirmDialog } from '@/lib/dialogs';
import { getParseWorkerStats, measureParseWorkerHeaps, recycleAllParseWorkers, type ParseWorkerStats, type WorkerHeapSample } from './parseWorkerClient';
import { getMultiboxStats, measureCombatWorkerHeap, type MultiboxStats } from './multibox';
import { closeOverlayWindow } from './overlay';
import type { LoadedContent } from './content';

interface PerfMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface WebViewProc {
  pid: number;
  name: string;
  working_set_bytes: number;
  process_type: string;
  sub_type: string;
}

interface RendererBreakdown {
  total: number;
  byType: { type: string; bytes: number }[];
  byScope: { scope: string; bytes: number; sample?: string }[];
  unavailable: string | null;
}

interface StorageEstimate {
  quota: number;
  usage: number;
  indexedDB: number | null;
  caches: number | null;
  serviceWorker: number | null;
  unavailable: string | null;
}

interface ImgEntry {
  src: string;
  naturalW: number;
  naturalH: number;
  decodedBytes: number;
  displayedCount: number;
}

interface ImageFootprint {
  imgCount: number;
  uniqueSrcs: number;
  totalDecodedBytes: number;
  totalTransferBytes: number;
  top: ImgEntry[];
}

interface VmRegionTop {
  base: string;
  size_bytes: number;
  type_name: string;
  protect_name: string;
}

interface VmStats {
  pid: number;
  total_committed_bytes: number;
  private_committed_bytes: number;
  private_committed_rw_bytes: number;
  private_committed_rx_bytes: number;
  private_committed_rwx_bytes: number;
  private_committed_other_bytes: number;
  private_reserved_bytes: number;
  image_bytes: number;
  mapped_bytes: number;
  region_count: number;
  largest_private: VmRegionTop[];
  walk_ms: number;
  errorMsg?: string;
  targetLabel: string;
}

interface Snapshot {
  ts: number;
  heap: PerfMemory | null;
  processMemoryBytes: number | null;
  webviewProcs: WebViewProc[];
  store: StoreStats;
  parser: ParseWorkerStats;
  multibox: MultiboxStats;
  contentBytes: number;
  contentDescription: string;
  domNodeCount: number;
  reactRootBytes: number;
  renderer: RendererBreakdown | null;
  storage: StorageEstimate | null;
  images: ImageFootprint;
  stylesheetCount: number;
  iframeCount: number;
  listenerHints: { eventTargets: number };
  vm: VmStats | null;
  workerHeaps: WorkerHeapSample[] | null;
}

const fmtMB = (b: number) => {
  if (b >= 1024 * 1024 * 1024 * 1024) return (b / 1024 / 1024 / 1024 / 1024).toFixed(2) + ' TB';
  if (b >= 10 * 1024 * 1024 * 1024) return (b / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  return (b / 1024 / 1024).toFixed(b > 100 * 1024 * 1024 ? 0 : 1) + ' MB';
};
const fmtKB = (b: number) => b > 1024 * 1024 ? fmtMB(b) : (b / 1024).toFixed(1) + ' KB';
const fmtPct = (n: number, d: number) => d > 0 ? (n / d * 100).toFixed(1) + '%' : '-';

function approxByteSize(v: unknown): number {
  try { return JSON.stringify(v).length * 2; } catch { return 0; }
}

function describeContent(c: LoadedContent | null): { bytes: number; text: string } {
  if (!c) return { bytes: 0, text: 'none open' };
  if (c.kind === 'encounter') {
    const enc = c.encounter;
    const al = Array.isArray(enc.actionLog) ? enc.actionLog.length : 0;
    const kl = Array.isArray(enc.killLog) ? enc.killLog.length : 0;
    const en = Array.isArray(enc.enemies) ? enc.enemies.length : 0;
    const bytes = approxByteSize(enc);
    return { bytes, text: `${enc.zoneName ?? 'Unknown'} · ${al.toLocaleString()} actions · ${en.toLocaleString()} enemies · ${kl.toLocaleString()} kills` };
  }
  return { bytes: approxByteSize(c), text: `sortie record` };
}

function readPerfMemory(): PerfMemory | null {
  const perf = performance as unknown as { memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number } };
  const m = perf.memory;
  if (!m || typeof m.usedJSHeapSize !== 'number') return null;
  return {
    usedJSHeapSize: m.usedJSHeapSize,
    totalJSHeapSize: m.totalJSHeapSize ?? 0,
    jsHeapSizeLimit: m.jsHeapSizeLimit ?? 0,
  };
}

interface UASMResult {
  bytes: number;
  breakdown: {
    bytes: number;
    types?: string[];
    attribution?: { url?: string; scope?: string; container?: { id?: string; src?: string } }[];
  }[];
}

async function measureRenderer(): Promise<RendererBreakdown | null> {
  const perf = performance as unknown as { measureUserAgentSpecificMemory?: () => Promise<UASMResult> };
  if (typeof perf.measureUserAgentSpecificMemory !== 'function') {
    return { total: 0, byType: [], byScope: [], unavailable: 'performance.measureUserAgentSpecificMemory not available in this WebView2 build' };
  }
  if (typeof (globalThis as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated !== 'undefined'
      && !(globalThis as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated) {
    return { total: 0, byType: [], byScope: [], unavailable: 'document is not crossOriginIsolated - Chromium gates this API' };
  }
  try {
    const res = await perf.measureUserAgentSpecificMemory();
    const byType = new Map<string, number>();
    const byScope = new Map<string, { bytes: number; sample?: string }>();
    for (const item of res.breakdown) {
      const types = item.types && item.types.length > 0 ? item.types : ['Unknown'];
      for (const t of types) byType.set(t, (byType.get(t) ?? 0) + item.bytes);
      const attrs = item.attribution && item.attribution.length > 0 ? item.attribution : [{ scope: 'Window' }];
      for (const a of attrs) {
        const key = a.scope || 'Window';
        const cur = byScope.get(key) ?? { bytes: 0, sample: a.url || a.container?.src };
        cur.bytes += item.bytes;
        byScope.set(key, cur);
      }
    }
    return {
      total: res.bytes,
      byType: [...byType.entries()].map(([type, bytes]) => ({ type, bytes })).sort((a, b) => b.bytes - a.bytes),
      byScope: [...byScope.entries()].map(([scope, v]) => ({ scope, bytes: v.bytes, sample: v.sample })).sort((a, b) => b.bytes - a.bytes),
      unavailable: null,
    };
  } catch (e) {
    return { total: 0, byType: [], byScope: [], unavailable: `measureUserAgentSpecificMemory threw: ${String(e)}` };
  }
}

async function measureStorage(): Promise<StorageEstimate | null> {
  const nav = navigator as unknown as { storage?: { estimate?: () => Promise<{ quota?: number; usage?: number; usageDetails?: Record<string, number> }> } };
  if (!nav.storage || typeof nav.storage.estimate !== 'function') {
    return { quota: 0, usage: 0, indexedDB: null, caches: null, serviceWorker: null, unavailable: 'navigator.storage.estimate unavailable' };
  }
  try {
    const e = await nav.storage.estimate();
    const d = e.usageDetails ?? {};
    return {
      quota: e.quota ?? 0,
      usage: e.usage ?? 0,
      indexedDB: typeof d.indexedDB === 'number' ? d.indexedDB : null,
      caches: typeof d.caches === 'number' ? d.caches : null,
      serviceWorker: typeof d.serviceWorker === 'number' ? d.serviceWorker : null,
      unavailable: null,
    };
  } catch (e) {
    return { quota: 0, usage: 0, indexedDB: null, caches: null, serviceWorker: null, unavailable: `estimate threw: ${String(e)}` };
  }
}

const bgImageProbe = new Map<string, { w: number; h: number; loaded: boolean }>();

function probeBackgroundImage(url: string): void {
  if (bgImageProbe.has(url)) return;
  bgImageProbe.set(url, { w: 0, h: 0, loaded: false });
  const probe = new Image();
  probe.onload = () => bgImageProbe.set(url, { w: probe.naturalWidth, h: probe.naturalHeight, loaded: true });
  probe.onerror = () => bgImageProbe.set(url, { w: 0, h: 0, loaded: false });
  probe.src = url;
}

function extractBgUrls(bg: string): string[] {
  if (!bg || bg === 'none') return [];
  const out: string[] = [];
  const re = /url\((["']?)([^"')]+)\1\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bg)) !== null) out.push(m[2]);
  return out;
}

function measureImages(): ImageFootprint {
  const imgs = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];
  const bySrc = new Map<string, ImgEntry>();
  for (const img of imgs) {
    const src = img.currentSrc || img.src || '';
    if (!src) continue;
    const w = img.naturalWidth || 0;
    const h = img.naturalHeight || 0;
    const decoded = w * h * 4;
    const existing = bySrc.get(src);
    if (existing) existing.displayedCount += 1;
    else bySrc.set(src, { src, naturalW: w, naturalH: h, decodedBytes: decoded, displayedCount: 1 });
  }
  const seenBgUrls = new Set<string>();
  const bgCounts = new Map<string, number>();
  const allEls = document.querySelectorAll('*');
  for (let i = 0; i < allEls.length; i++) {
    const el = allEls[i];
    const cs = getComputedStyle(el);
    for (const url of extractBgUrls(cs.backgroundImage)) {
      seenBgUrls.add(url);
      bgCounts.set(url, (bgCounts.get(url) ?? 0) + 1);
    }
    for (const url of extractBgUrls(cs.borderImageSource)) {
      seenBgUrls.add(url);
      bgCounts.set(url, (bgCounts.get(url) ?? 0) + 1);
    }
  }
  for (const url of seenBgUrls) {
    probeBackgroundImage(url);
    const cached = bgImageProbe.get(url);
    if (cached && cached.loaded && cached.w > 0 && cached.h > 0) {
      const decoded = cached.w * cached.h * 4;
      const count = bgCounts.get(url) ?? 1;
      const existing = bySrc.get(url);
      if (existing) existing.displayedCount += count;
      else bySrc.set(url, { src: url, naturalW: cached.w, naturalH: cached.h, decodedBytes: decoded, displayedCount: count });
    }
  }
  const all = Array.from(bySrc.values()).sort((a, b) => b.decodedBytes - a.decodedBytes);
  const totalDecoded = all.reduce((s, e) => s + e.decodedBytes, 0);
  let totalTransfer = 0;
  try {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    for (const e of entries) {
      if (e.initiatorType === 'img' || e.initiatorType === 'css' || (e.name && /\.(png|jpe?g|webp|gif|svg|avif)(\?|$)/i.test(e.name))) {
        totalTransfer += e.transferSize || e.encodedBodySize || 0;
      }
    }
  } catch { /* ignore */ }
  return {
    imgCount: imgs.length + seenBgUrls.size,
    uniqueSrcs: bySrc.size,
    totalDecodedBytes: totalDecoded,
    totalTransferBytes: totalTransfer,
    top: all.slice(0, 10),
  };
}

async function measureAllWorkerHeaps(): Promise<WorkerHeapSample[]> {
  const out: WorkerHeapSample[] = [];
  try {
    const parsers = await measureParseWorkerHeaps();
    out.push(...parsers);
  } catch { /* ignore */ }
  try {
    const combat = await measureCombatWorkerHeap();
    if (combat) out.push(combat);
  } catch { /* ignore */ }
  return out;
}

function takeSnapshot(
  content: LoadedContent | null,
  processMemoryBytes: number | null,
  webviewProcs: WebViewProc[],
  renderer: RendererBreakdown | null,
  storage: StorageEstimate | null,
  vm: VmStats | null,
  workerHeaps: WorkerHeapSample[] | null,
): Snapshot {
  const heap = readPerfMemory();
  const desc = describeContent(content);
  return {
    ts: Date.now(),
    heap,
    processMemoryBytes,
    webviewProcs,
    store: getStoreStats(),
    parser: getParseWorkerStats(),
    multibox: getMultiboxStats(),
    contentBytes: desc.bytes,
    contentDescription: desc.text,
    domNodeCount: document.querySelectorAll('*').length,
    reactRootBytes: 0,
    renderer,
    storage,
    images: measureImages(),
    stylesheetCount: document.styleSheets.length,
    iframeCount: document.querySelectorAll('iframe').length,
    listenerHints: { eventTargets: document.querySelectorAll('[onclick],[onmouseenter],[onkeydown]').length },
    vm,
    workerHeaps,
  };
}

interface RawVmStats {
  pid: number;
  total_committed_bytes: number;
  private_committed_bytes: number;
  private_committed_rw_bytes: number;
  private_committed_rx_bytes: number;
  private_committed_rwx_bytes: number;
  private_committed_other_bytes: number;
  private_reserved_bytes: number;
  image_bytes: number;
  mapped_bytes: number;
  region_count: number;
  largest_private: VmRegionTop[];
  walk_ms: number;
}

async function measureVm(webviewProcs: WebViewProc[]): Promise<VmStats | null> {
  const renderer = webviewProcs.find(p => p.process_type === 'renderer');
  const target = renderer ?? webviewProcs[0];
  if (!target) return null;
  const label = renderer ? `renderer PID ${renderer.pid}` : `PID ${target.pid} (${target.process_type})`;
  try {
    const raw = await invoke<RawVmStats>('walk_process_vm', { pid: target.pid });
    return { ...raw, targetLabel: label };
  } catch (e) {
    return {
      pid: target.pid,
      total_committed_bytes: 0,
      private_committed_bytes: 0,
      private_committed_rw_bytes: 0,
      private_committed_rx_bytes: 0,
      private_committed_rwx_bytes: 0,
      private_committed_other_bytes: 0,
      private_reserved_bytes: 0,
      image_bytes: 0,
      mapped_bytes: 0,
      region_count: 0,
      largest_private: [],
      walk_ms: 0,
      errorMsg: String(e),
      targetLabel: label,
    };
  }
}

function describeProcess(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('msedgewebview')) return 'WebView2 renderer / utility';
  return name;
}

function categorizeProcess(_name: string, idx: number, all: WebViewProc[]): string {
  const p = all[idx];
  const t = (p.process_type || '').toLowerCase();
  const sub = (p.sub_type || '').toLowerCase();
  if (t === 'renderer') {
    const renderers = all
      .map((proc, i) => ({ proc, i }))
      .filter(x => (x.proc.process_type || '').toLowerCase() === 'renderer')
      .sort((a, b) => a.proc.pid - b.proc.pid);
    const rank = renderers.findIndex(r => r.i === idx);
    if (rank === 0) return 'Renderer: main window (+ workers)';
    if (rank === 1) return 'Renderer: overlay window';
    return `Renderer: secondary window #${rank}`;
  }
  if (t === 'gpu-process') return 'GPU process (image decode + compositor)';
  if (t === 'crashpad-handler') return 'Crashpad (crash reporter)';
  if (t === 'browser') return 'Browser process (Chromium coordinator)';
  if (t === 'utility') {
    if (sub.includes('network')) return 'Utility: Network service (HTTP, cookies)';
    if (sub.includes('storage')) return 'Utility: Storage service (IndexedDB, cache)';
    if (sub.includes('audio')) return 'Utility: Audio service';
    if (sub.includes('tracing')) return 'Utility: Tracing service';
    if (sub.includes('video')) return 'Utility: Video decoder';
    if (sub) return `Utility: ${sub}`;
    return 'Utility process';
  }
  if (t === 'plugin') return 'Plugin process';
  if (t === 'sandbox') return 'Sandbox helper';
  if (t === 'unknown') return 'msedgewebview2 child (command line unreadable)';
  return `Chromium process (${t})`;
}

function Row({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2 py-0.5 border-b border-white/[0.04] last:border-0">
      <div className="min-w-0">
        <div className="text-[12px] text-gray-200 truncate">{label}</div>
        {sub && <div className="text-[9px] text-gray-500 font-mono truncate">{sub}</div>}
      </div>
      <div className={`text-[12px] font-mono whitespace-nowrap ${warn ? 'text-amber-300 font-bold' : 'text-gray-100'}`}>{value}</div>
    </div>
  );
}

function Section({ title, children, total }: { title: string; children: React.ReactNode; total?: string }) {
  return (
    <section className="bg-row-even border border-white/10 rounded-lg p-2.5 break-inside-avoid mb-2.5">
      <div className="flex items-center justify-between mb-1 pb-1 border-b border-white/10">
        <h3 className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">{title}</h3>
        {total && <span className="text-[12px] font-mono text-accent font-bold">{total}</span>}
      </div>
      {children}
    </section>
  );
}

export default function DiagnosticsView({ content }: { content: LoadedContent | null }) {
  const [snap, setSnap] = useState<Snapshot>(() => takeSnapshot(content, null, [], null, null, null, null));
  const [paused, setPaused] = useState(false);
  const rendererRef = useRef<RendererBreakdown | null>(null);
  const rendererLoadingRef = useRef(false);
  const vmRef = useRef<VmStats | null>(null);
  const vmLoadingRef = useRef(false);
  const workerHeapsRef = useRef<WorkerHeapSample[] | null>(null);
  const workerHeapsLoadingRef = useRef(false);
  const tickCountRef = useRef(0);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    const tick = async () => {
      let procBytes: number | null = null;
      let wv: WebViewProc[] = [];
      try { procBytes = await invoke<number>('get_process_memory_bytes'); } catch { /* not available */ }
      try { wv = await invoke<WebViewProc[]>('get_webview_processes'); } catch { /* not available */ }
      const storage = await measureStorage();
      if (cancelled) return;
      if (tickCountRef.current % 5 === 0 && !rendererLoadingRef.current) {
        rendererLoadingRef.current = true;
        void measureRenderer().then(r => {
          rendererLoadingRef.current = false;
          if (!cancelled) rendererRef.current = r;
        });
      }
      if (tickCountRef.current % 5 === 0 && !vmLoadingRef.current && wv.length > 0) {
        vmLoadingRef.current = true;
        void measureVm(wv).then(v => {
          vmLoadingRef.current = false;
          if (!cancelled) vmRef.current = v;
        });
      }
      if (tickCountRef.current % 5 === 0 && !workerHeapsLoadingRef.current) {
        workerHeapsLoadingRef.current = true;
        void measureAllWorkerHeaps().then(h => {
          workerHeapsLoadingRef.current = false;
          if (!cancelled) workerHeapsRef.current = h;
        });
      }
      tickCountRef.current += 1;
      setSnap(takeSnapshot(content, procBytes, wv, rendererRef.current, storage, vmRef.current, workerHeapsRef.current));
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [content, paused]);

  const heapWarn = snap.heap && snap.heap.usedJSHeapSize > 1.5 * 1024 * 1024 * 1024;
  const contentWarn = snap.contentBytes > 200 * 1024 * 1024;
  const storeTotal = snap.store.approxSummariesBytes + snap.store.approxLootsBytes + snap.store.approxPendingWriteBytes;
  const trackedTotal = storeTotal + snap.contentBytes + snap.multibox.totalBytes;
  const rendererWorkingSet = snap.webviewProcs.find(p => p.process_type === 'renderer')?.working_set_bytes ?? null;
  const untrackedBytes = rendererWorkingSet != null && rendererWorkingSet > trackedTotal ? rendererWorkingSet - trackedTotal : null;

  const forceGc = () => {
    const w = window as unknown as { gc?: () => void };
    if (w.gc) { w.gc(); setTimeout(() => setSnap(takeSnapshot(content, snap.processMemoryBytes, snap.webviewProcs, rendererRef.current, snap.storage, vmRef.current, workerHeapsRef.current)), 500); }
    else void alertDialog({ title: 'GC unavailable', message: 'Start the dev console with --js-flags="--expose-gc" to enable.', tone: 'warn' });
  };

  const clearLoots = () => {
    const n = evictLootsExcept(new Set());
    setTimeout(() => setSnap(takeSnapshot(content, snap.processMemoryBytes, snap.webviewProcs, rendererRef.current, snap.storage, vmRef.current, workerHeapsRef.current)), 100);
    void alertDialog({ title: 'Loots cache cleared', message: `Evicted ${n} loot entries from in-memory cache. SQLite is unchanged; loots will re-hydrate on demand when you next open the Loot tab.`, tone: 'success' });
  };

  const minimizeMemory = async () => {
    clearStore();
    try { await closeOverlayWindow(); } catch { /* may not exist */ }
    const w = window as unknown as { gc?: () => void };
    if (w.gc) w.gc();
    setTimeout(() => setSnap(takeSnapshot(content, snap.processMemoryBytes, snap.webviewProcs, rendererRef.current, snap.storage, vmRef.current, workerHeapsRef.current)), 500);
  };

  const recycleWorkers = () => {
    const before = snap.webviewProcs.find(p => p.process_type === 'renderer')?.working_set_bytes ?? null;
    const r = recycleAllParseWorkers();
    const ages = r.perSlot.map(s => `${s.index}: ${(s.ageMs / 1000).toFixed(0)}s, ${s.jobCount} jobs, ${s.recycled ? 'recycled' : 'busy'}`).join('\n');
    setTimeout(() => setSnap(takeSnapshot(content, snap.processMemoryBytes, snap.webviewProcs, rendererRef.current, snap.storage, vmRef.current, workerHeapsRef.current)), 200);
    void alertDialog({
      title: 'Workers recycled',
      message: `Recycled ${r.recycled} of ${r.perSlot.length} parse workers.\n${r.skipped > 0 ? `(${r.skipped} were busy and left alone - try again in a moment)\n` : ''}\nPer worker:\n${ages}${before != null ? `\n\nRenderer before: ${(before / 1024 / 1024).toFixed(0)} MB. Check Diagnostics again in a few seconds to see the drop.` : ''}`,
      tone: 'success',
    });
  };

  const softReload = async () => {
    const ok = await confirmDialog({
      title: 'Soft reload renderer',
      message: 'Drops the entire document and reinitializes the app from scratch. Frees Chromium-internal caches (compositor layers, paint records, image decode, Skia, IPC buffers) that JS GC can\'t reach.\n\nYou will lose your current view/scroll position. The data on disk is untouched.\n\nContinue?',
      confirmLabel: 'Reload',
    });
    if (!ok) return;
    window.location.reload();
  };

  const totalChildren = snap.webviewProcs.reduce((s, p) => s + p.working_set_bytes, 0);
  const grandTotal = totalChildren + (snap.processMemoryBytes ?? 0);

  return (
    <div className="h-full overflow-hidden">
      <div className="h-full mx-auto max-w-[1600px] px-3 py-2 flex flex-col">
        <div className="flex items-center justify-between gap-3 mb-2 shrink-0">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-bold text-accent">Diagnostics</h1>
            <span className="text-[10px] text-gray-500">{paused ? 'paused' : 'refreshes every 2s'} · UASM every ~10s</span>
            {grandTotal > 0 && (
              <span className="text-[11px] text-gray-400 font-mono">total <span className="text-accent font-bold">{fmtMB(grandTotal)}</span></span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPaused(p => !p)} className="text-[11px] rounded px-2 py-1 bg-white/[0.06] border border-white/15 text-gray-200 hover:bg-white/[0.10]">
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button onClick={() => setSnap(takeSnapshot(content, snap.processMemoryBytes, snap.webviewProcs, rendererRef.current, snap.storage, vmRef.current, workerHeapsRef.current))} className="text-[11px] rounded px-2 py-1 bg-white/[0.06] border border-white/15 text-gray-200 hover:bg-white/[0.10]">
              Refresh
            </button>
            <button onClick={forceGc} className="text-[11px] rounded px-2 py-1 bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25">
              GC
            </button>
            <button onClick={clearLoots} className="text-[11px] rounded px-2 py-1 bg-rose-500/15 border border-rose-500/40 text-rose-300 hover:bg-rose-500/25">
              Clear loots
            </button>
            <button onClick={recycleWorkers} className="text-[11px] rounded px-2 py-1 bg-sky-500/15 border border-sky-500/40 text-sky-300 hover:bg-sky-500/25">
              Recycle workers
            </button>
            <button onClick={softReload} className="text-[11px] rounded px-2 py-1 bg-purple-500/15 border border-purple-500/40 text-purple-300 hover:bg-purple-500/25">
              Soft reload
            </button>
            <button onClick={minimizeMemory} className="text-[11px] rounded px-2 py-1 bg-rose-600/20 border border-rose-500/50 text-rose-200 hover:bg-rose-600/30 font-semibold">
              Minimize
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="columns-1 md:columns-2 xl:columns-3 gap-2.5">
            {snap.webviewProcs.length > 0 && (
              <Section title="Processes (Task Manager total)" total={fmtMB(grandTotal)}>
                {snap.processMemoryBytes != null && (
                  <Row label="Tauri main (Rust)" value={fmtMB(snap.processMemoryBytes)} />
                )}
                {snap.webviewProcs.map((p, i) => (
                  <Row
                    key={p.pid}
                    label={categorizeProcess(p.name, i, snap.webviewProcs)}
                    value={fmtMB(p.working_set_bytes)}
                    sub={`PID ${p.pid}`}
                    warn={p.working_set_bytes > 1024 * 1024 * 1024}
                  />
                ))}
              </Section>
            )}

            <Section title="Renderer breakdown (UASM)" total={snap.renderer && snap.renderer.unavailable == null ? fmtMB(snap.renderer.total) : (snap.renderer ? '-' : '…')}>
              {snap.renderer == null ? (
                <div className="text-[11px] text-gray-500 py-1">Sampling…</div>
              ) : snap.renderer.unavailable ? (
                <div className="text-[11px] text-amber-300/80 py-1 leading-snug">{snap.renderer.unavailable}</div>
              ) : (
                <>
                  {snap.renderer.byType.map(b => (
                    <Row key={b.type} label={b.type} value={fmtMB(b.bytes)} sub={fmtPct(b.bytes, snap.renderer!.total)} />
                  ))}
                  {snap.renderer.byScope.map(b => (
                    <Row key={`s-${b.scope}`} label={`scope: ${b.scope}`} value={fmtMB(b.bytes)} sub={b.sample ? b.sample.slice(0, 60) : undefined} />
                  ))}
                </>
              )}
            </Section>

            <Section title="JS Heap (V8)" total={snap.heap ? fmtMB(snap.heap.usedJSHeapSize) : '-'}>
              {snap.heap ? (
                <>
                  <Row label="Used" value={fmtMB(snap.heap.usedJSHeapSize)} sub={fmtPct(snap.heap.usedJSHeapSize, snap.heap.jsHeapSizeLimit)} warn={!!heapWarn} />
                  <Row label="Allocated" value={fmtMB(snap.heap.totalJSHeapSize)} />
                  <Row label="Limit" value={fmtMB(snap.heap.jsHeapSizeLimit)} />
                  <Row label="DOM nodes" value={snap.domNodeCount.toLocaleString()} warn={snap.domNodeCount > 50000} />
                  <Row label="Stylesheets" value={snap.stylesheetCount.toLocaleString()} />
                  <Row label="iframes" value={snap.iframeCount.toLocaleString()} />
                </>
              ) : (
                <div className="text-[11px] text-gray-500 py-1">performance.memory unavailable</div>
              )}
            </Section>

            <Section title="Image decode" total={fmtMB(snap.images.totalDecodedBytes)}>
              <Row label="<img> in DOM" value={`${snap.images.imgCount.toLocaleString()} / ${snap.images.uniqueSrcs.toLocaleString()} unique`} />
              <Row label="Resource transfer" value={fmtMB(snap.images.totalTransferBytes)} />
              {snap.images.top.slice(0, 5).map((e, i) => (
                <Row
                  key={i}
                  label={`${e.naturalW}×${e.naturalH}${e.displayedCount > 1 ? ` ×${e.displayedCount}` : ''}`}
                  value={fmtMB(e.decodedBytes)}
                  sub={e.src.split('/').pop()?.slice(0, 50)}
                  warn={e.decodedBytes > 20 * 1024 * 1024}
                />
              ))}
            </Section>

            <Section title="Browser storage" total={snap.storage && snap.storage.unavailable == null ? fmtMB(snap.storage.usage) : '-'}>
              {snap.storage == null ? (
                <div className="text-[11px] text-gray-500 py-1">Measuring…</div>
              ) : snap.storage.unavailable ? (
                <div className="text-[11px] text-gray-500 py-1">{snap.storage.unavailable}</div>
              ) : (
                <>
                  <Row label="Total usage" value={fmtMB(snap.storage.usage)} sub={`quota ${fmtMB(snap.storage.quota)}`} />
                  {snap.storage.indexedDB != null && <Row label="IndexedDB" value={fmtMB(snap.storage.indexedDB)} warn={snap.storage.indexedDB > 500 * 1024 * 1024} />}
                  {snap.storage.caches != null && <Row label="Cache API" value={fmtMB(snap.storage.caches)} />}
                  {snap.storage.serviceWorker != null && <Row label="Service Worker" value={fmtMB(snap.storage.serviceWorker)} />}
                </>
              )}
            </Section>

            <Section title="Multibox / Live Combat" total={fmtMB(snap.multibox.totalBytes)}>
              <Row
                label={`${snap.multibox.boxCount} characters`}
                value={`${snap.multibox.combatSubscribers} combat subs`}
                sub={snap.multibox.combatSubscribers > 0 ? 'live stream OPEN' : 'stream closed'}
              />
              {snap.multibox.boxes.map((b, i) => (
                <Row
                  key={i}
                  label={b.name ?? `Char ${i + 1}`}
                  value={fmtKB(b.totalBytes)}
                  sub={`c ${fmtKB(b.combatBytes)} · l ${fmtKB(b.liveBytes)} · ${b.killHistoryCount} kills`}
                  warn={b.totalBytes > 10 * 1024 * 1024}
                />
              ))}
            </Section>

            <Section title="Summary Store" total={fmtMB(storeTotal)}>
              <Row
                label="Summaries"
                value={`${snap.store.summariesCount.toLocaleString()}`}
                sub={fmtMB(snap.store.approxSummariesBytes)}
              />
              <Row
                label="Loots"
                value={`${snap.store.lootsCount.toLocaleString()}`}
                sub={fmtMB(snap.store.approxLootsBytes)}
              />
              <Row
                label="Pending writes"
                value={`${snap.store.pendingSummaryWrites + snap.store.pendingLootWrites}`}
                sub={`${snap.store.pendingSummaryWrites}s · ${snap.store.pendingLootWrites}l`}
              />
              <Row
                label="Parse queue"
                value={`${snap.store.summaryQueueLen + snap.store.lootQueueLen}`}
                sub={`flight: ${snap.store.summaryInFlight}s · ${snap.store.lootInFlight}l`}
              />
              {snap.store.largestEncounter && (
                <Row label="Largest" value={fmtKB(snap.store.largestEncounter.bytes)} sub={snap.store.largestEncounter.path.split(/[\\/]/).pop()} />
              )}
            </Section>

            <Section title="Parse workers" total={`${snap.parser.totalPending} pending`}>
              <Row
                label={`${snap.parser.poolSize} workers${snap.parser.poolFailed ? ' (failed)' : ''}`}
                value={snap.parser.perWorkerPending.map(n => `${n}`).join('·') || '-'}
              />
            </Section>

            <Section title="Open encounter" total={snap.contentBytes > 0 ? fmtMB(snap.contentBytes) : '-'}>
              <Row label={snap.contentDescription} value={snap.contentBytes > 0 ? fmtMB(snap.contentBytes) : '-'} warn={contentWarn} />
            </Section>

            {untrackedBytes != null && (
              <Section title="Untracked (renderer minus tracked JS)" total={fmtMB(untrackedBytes)}>
                <Row label="Renderer working set" value={fmtMB(rendererWorkingSet ?? 0)} sub="msedgewebview2 renderer subprocess" />
                <Row label="Tracked JS total" value={fmtMB(trackedTotal)} sub="store + multibox + open content" />
                <Row label="Compositor / paint / decode" value={fmtMB(untrackedBytes)} sub="not attributable from JS" warn={untrackedBytes > 1024 * 1024 * 1024} />
              </Section>
            )}

            {(() => {
              if (!snap.workerHeaps) return null;
              const totalBytes = snap.workerHeaps.reduce((s, h) => s + (h.bytes ?? 0), 0);
              return (
                <Section title="Worker heaps (UASM inside each worker)" total={totalBytes > 0 ? fmtMB(totalBytes) : '-'}>
                  {snap.workerHeaps.length === 0 ? (
                    <div className="text-[11px] text-gray-500 py-1">No workers running yet.</div>
                  ) : snap.workerHeaps.map((h, i) => (
                    <Row
                      key={i}
                      label={h.label}
                      value={h.bytes != null ? fmtMB(h.bytes) : (h.error ?? '-')}
                      sub={h.jsHeap != null ? `js heap ${fmtMB(h.jsHeap)}` : undefined}
                      warn={h.bytes != null && h.bytes > 100 * 1024 * 1024}
                    />
                  ))}
                  <div className="text-[9px] text-gray-600 mt-1 leading-snug">
                    Each worker measured separately - sum here closes the gap between renderer working set and main-thread UASM.
                  </div>
                </Section>
              );
            })()}

            <Section title="Renderer committed memory (VirtualQueryEx)" total={snap.vm && !snap.vm.errorMsg ? fmtMB(snap.vm.total_committed_bytes) : (snap.vm ? '-' : '…')}>
              {snap.vm == null ? (
                <div className="text-[11px] text-gray-500 py-1">Scanning…</div>
              ) : snap.vm.errorMsg ? (
                <div className="text-[11px] text-amber-300/80 py-1 leading-snug">{snap.vm.errorMsg}</div>
              ) : (
                <>
                  <Row label="Target" value={snap.vm.targetLabel} sub={`${snap.vm.region_count.toLocaleString()} regions · walk ${snap.vm.walk_ms}ms`} />
                  <Row label="Private committed" value={fmtMB(snap.vm.private_committed_bytes)} sub="unique RAM/pagefile - leaks live here" warn={snap.vm.private_committed_bytes > 1024 * 1024 * 1024} />
                  <Row label="  Private RW" value={fmtMB(snap.vm.private_committed_rw_bytes)} sub="heap, V8, native buffers" />
                  <Row label="  Private RX" value={fmtMB(snap.vm.private_committed_rx_bytes)} sub="JIT code" />
                  {snap.vm.private_committed_rwx_bytes > 0 && (
                    <Row label="  Private RWX" value={fmtMB(snap.vm.private_committed_rwx_bytes)} sub="writable JIT" />
                  )}
                  {snap.vm.private_committed_other_bytes > 0 && (
                    <Row label="  Private other" value={fmtMB(snap.vm.private_committed_other_bytes)} sub="r/o, noaccess, guard" />
                  )}
                  <Row label="Image (DLLs committed)" value={fmtMB(snap.vm.image_bytes)} sub="mostly shared across procs" />
                  <Row label="Mapped (files / shaders / fonts)" value={fmtMB(snap.vm.mapped_bytes)} sub="committed only" />
                  {snap.vm.largest_private.length > 0 && (
                    <div className="mt-1 pt-1 border-t border-white/[0.05]">
                      <div className="text-[10px] text-gray-500 mb-0.5">Largest private regions (top 20)</div>
                      {snap.vm.largest_private.slice(0, 20).map((r, i) => (
                        <Row key={i} label={`${r.base.slice(2)} · ${r.protect_name}`} value={fmtMB(r.size_bytes)} warn={r.size_bytes > 200 * 1024 * 1024} />
                      ))}
                    </div>
                  )}
                  <div className="text-[9px] text-gray-600 mt-1 leading-snug">
                    Address space reserved (no RAM): {fmtMB(snap.vm.private_reserved_bytes)} - V8 sandbox / Chromium ranges; not actionable.
                  </div>
                </>
              )}
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
