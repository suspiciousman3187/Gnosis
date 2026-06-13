import { anonymize, findPlayerLeaks } from './anonymize';
import type { LoadedContent } from './content';
import {
  SHARE_API_BASE_URL, SHARE_PAYLOAD_VERSION,
} from '@/lib/shareConfig';

const SHARED_KEY = 'ff_shared_runs';
type SharedMap = Record<string, { url: string; ts: number }>;
function loadShared(): SharedMap {
  try { return JSON.parse(localStorage.getItem(SHARED_KEY) || '{}') as SharedMap; } catch { return {}; }
}
function rememberShared(id: string, url: string) {
  const m = loadShared();
  m[id] = { url, ts: Date.now() };
  try { localStorage.setItem(SHARED_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

const SHARED_PATHS_KEY = 'ff_shared_paths';
export type SharedPathEntry = { url: string; id: string; ts: number; isPrivate?: boolean };
export type SharedPathMap = Record<string, SharedPathEntry>;
export function loadSharedPaths(): SharedPathMap {
  try { return JSON.parse(localStorage.getItem(SHARED_PATHS_KEY) || '{}') as SharedPathMap; } catch { return {}; }
}
export function lookupShared(path: string | null | undefined): SharedPathEntry | null {
  if (!path) return null;
  return loadSharedPaths()[path] ?? null;
}
function rememberSharedPath(path: string, id: string, url: string, isPrivate?: boolean) {
  const m = loadSharedPaths();
  m[path] = { url, id, ts: Date.now(), isPrivate };
  try { localStorage.setItem(SHARED_PATHS_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

export function updateSharedPathPrivacy(id: string, isPrivate: boolean) {
  const m = loadSharedPaths();
  let changed = false;
  for (const path of Object.keys(m)) {
    if (m[path].id === id) {
      m[path] = { ...m[path], isPrivate };
      changed = true;
    }
  }
  if (changed) {
    try { localStorage.setItem(SHARED_PATHS_KEY, JSON.stringify(m)); } catch { /* ignore */ }
  }
}

export async function setSharePrivacy(id: string, isPrivate: boolean, apiToken?: string | null): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiToken) headers.Authorization = `Bearer ${apiToken}`;
  const res = await fetch(`${SHARE_API_BASE_URL}/api/share/${encodeURIComponent(id)}/privacy`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ private: isPrivate }),
  });
  if (!res.ok) {
    let msg = `Privacy update failed (${res.status})`;
    try { const j = await res.json() as { error?: string }; if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  updateSharedPathPrivacy(id, isPrivate);
}

function forgetSharedById(id: string) {
  const m = loadShared();
  if (id in m) {
    delete m[id];
    try { localStorage.setItem(SHARED_KEY, JSON.stringify(m)); } catch { /* ignore */ }
  }
}

function forgetSharedPathById(id: string) {
  const m = loadSharedPaths();
  let changed = false;
  for (const path of Object.keys(m)) {
    if (m[path].id === id) { delete m[path]; changed = true; }
  }
  if (changed) {
    try { localStorage.setItem(SHARED_PATHS_KEY, JSON.stringify(m)); } catch { /* ignore */ }
  }
}

export async function removeShareUpload(id: string, apiToken?: string | null): Promise<void> {
  const headers: Record<string, string> = {};
  if (apiToken) headers.Authorization = `Bearer ${apiToken}`;
  const res = await fetch(`${SHARE_API_BASE_URL}/api/share?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) {
    let msg = `Unshare failed (${res.status})`;
    try { const j = await res.json() as { error?: string }; if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  forgetSharedById(id);
  forgetSharedPathById(id);
}

async function contentId(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

async function gzip(text: string): Promise<Blob> {
  const cs = new CompressionStream('gzip');
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(cs);
  return new Response(stream).blob();
}

function stripRaw(c: LoadedContent): LoadedContent {
  if (c.kind === 'encounter') {
    const enc = { ...(c.encounter as unknown as Record<string, unknown>) };
    delete enc.rawText;
    delete enc.localCharacter;
    return { ...c, encounter: enc } as unknown as LoadedContent;
  }
  const rec = { ...(c.record as unknown as Record<string, unknown>) };
  delete rec.rawText;
  delete rec.raw_text;
  delete rec.localCharacter;
  return { ...c, record: rec } as unknown as LoadedContent;
}

const HEAVY_LOG_KEYS = [
  'positionLog',      'position_log',
  'partyHpLog',       'party_hp_log',
  'partyMpLog',       'party_mp_log',
  'partyTpLog',       'party_tp_log',
  'partyPositionLog', 'party_position_log',
  'bossHpLog',        'boss_hp_log',
];
function stripHeavyTimeSeries(c: LoadedContent): LoadedContent {
  const drop = (o: Record<string, unknown>) => {
    for (const k of HEAVY_LOG_KEYS) delete o[k];
  };
  if (c.kind === 'encounter') {
    const enc = { ...(c.encounter as unknown as Record<string, unknown>) };
    drop(enc);
    return { ...c, encounter: enc } as unknown as LoadedContent;
  }
  const rec = { ...(c.record as unknown as Record<string, unknown>) };
  drop(rec);
  return { ...c, record: rec } as unknown as LoadedContent;
}

const MAX_COMPRESSED_BYTES   = 16 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 100 * 1024 * 1024;
export class OversizedPayloadError extends Error {
  decompressedBytes: number;
  compressedBytes: number;
  constructor(decompressedBytes: number, compressedBytes: number) {
    super('payload too large');
    this.name = 'OversizedPayloadError';
    this.decompressedBytes = decompressedBytes;
    this.compressedBytes = compressedBytes;
  }
}

// Hard gate: refuse to publish if any real character name survived at an
// unambiguous player position. Fails the share loudly instead of leaking.
function assertNoLeak(body: unknown) {
  const leaks = findPlayerLeaks(body);
  if (leaks.length) {
    throw new Error(`Anonymization safety check failed - these names were not anonymized: ${leaks.join(', ')}. The report was NOT uploaded. Please report this so it can be fixed.`);
  }
}

export function buildSharePayload(content: LoadedContent, anonymizeOn: boolean) {
  let c = content;
  if (anonymizeOn) {
    if (content.kind === 'encounter') {
      const enc = anonymize(content.encounter);
      assertNoLeak(enc);
      c = { ...content, encounter: enc };
    } else {
      const rec = anonymize(content.record);
      assertNoLeak(rec);
      c = { ...content, record: rec } as LoadedContent;
    }
  }
  return { v: SHARE_PAYLOAD_VERSION, anonymized: anonymizeOn, content: stripRaw(c) };
}

function collectItemIds(node: unknown, out: Set<number>) {
  if (Array.isArray(node)) { for (const v of node) collectItemIds(v, out); return; }
  if (!node || typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  for (const k of ['itemId', 'item_id']) {
    const v = o[k];
    if (typeof v === 'number' && v > 0) out.add(v);
  }
  const gear = o.gear;
  if (gear && typeof gear === 'object' && !Array.isArray(gear)) {
    for (const slot of Object.values(gear as Record<string, unknown>)) {
      const sid = slot && typeof slot === 'object' ? (slot as Record<string, unknown>).id : undefined;
      if (typeof sid === 'number' && sid > 0) out.add(sid);
    }
  }
  for (const v of Object.values(o)) collectItemIds(v, out);
}

async function iconDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0) return null;
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return `data:image/bmp;base64,${btoa(bin)}`;
  } catch { return null; }
}

// Embed the icons the report references (read from the addon's locally-extracted
// files via the same resolver the app renders with) so the viewer can show them.
async function collectIcons(content: LoadedContent, resolve: (id: number) => string | null): Promise<Record<number, string>> {
  const ids = new Set<number>();
  collectItemIds(content as unknown, ids);
  const out: Record<number, string> = {};
  await Promise.all([...ids].map(async (id) => {
    const u = resolve(id);
    if (!u) return;
    const data = await iconDataUrl(u);
    if (data) out[id] = data;
  }));
  return out;
}

let cachedStatus: { enabled: boolean; checkedAt: number } | null = null;
const STATUS_TTL_MS = 60 * 1000;

export async function getShareStatus(): Promise<{ enabled: boolean }> {
  if (cachedStatus && Date.now() - cachedStatus.checkedAt < STATUS_TTL_MS) {
    return { enabled: cachedStatus.enabled };
  }
  try {
    const res = await fetch(`${SHARE_API_BASE_URL}/api/share`, { method: 'GET' });
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json() as { enabled?: boolean };
    cachedStatus = { enabled: j.enabled !== false, checkedAt: Date.now() };
    return { enabled: cachedStatus.enabled };
  } catch {
    // Fail OPEN on transient network errors - the actual upload POST will
    // be authoritative if sharing is disabled (it returns 503).
    cachedStatus = { enabled: true, checkedAt: Date.now() };
    return { enabled: true };
  }
}

export async function shareReport(
  content: LoadedContent,
  anonymizeOn: boolean,
  iconResolver?: (id: number) => string | null,
  apiToken?: string | null,
  sourcePath?: string | null,
  opts?: { private?: boolean; stripHeavyLogs?: boolean },
): Promise<{ id: string; url: string; alreadyUploaded: boolean; isPrivate: boolean }> {
  const wantsPrivate = !!opts?.private;
  const stripHeavy = !!opts?.stripHeavyLogs;
  const built = buildSharePayload(content, anonymizeOn) as { v: number; content: LoadedContent; icons?: Record<number, string> };
  if (stripHeavy) built.content = stripHeavyTimeSeries(built.content);
  const payload = built;

  const idJson = JSON.stringify({ v: SHARE_PAYLOAD_VERSION, content: payload.content });
  const id = await contentId(idJson);
  const url = `${SHARE_API_BASE_URL}/r/${id}`;

  if (loadShared()[id]) {
    if (sourcePath) rememberSharedPath(sourcePath, id, url, wantsPrivate);
    return { id, url, alreadyUploaded: true, isPrivate: wantsPrivate };
  }

  if (iconResolver) {
    const icons = await collectIcons(payload.content, iconResolver);
    if (Object.keys(icons).length) payload.icons = icons;
  }
  const json = JSON.stringify(payload);

  const body = await gzip(json);
  const compressedBytes = body.size;
  const decompressedBytes = json.length;
  if (compressedBytes > MAX_COMPRESSED_BYTES || decompressedBytes > MAX_DECOMPRESSED_BYTES) {
    if (!stripHeavy) throw new OversizedPayloadError(decompressedBytes, compressedBytes);
    throw new Error('This encounter is still too large to upload even after stripping movement and party time-series. Try the Split feature to break it into smaller segments.');
  }
  const authHeaders: Record<string, string> = {};
  if (apiToken) authHeaders.Authorization = `Bearer ${apiToken}`;
  const qs = wantsPrivate ? `id=${id}&private=1` : `id=${id}`;

  const initRes = await fetch(`${SHARE_API_BASE_URL}/api/share/init?${qs}`, {
    method: 'POST',
    headers: authHeaders,
  });
  if (!initRes.ok) {
    let msg = `Upload init failed (${initRes.status})`;
    try { const j = await initRes.json() as { error?: string }; if (j?.error) msg = j.error; } catch { /* keep generic */ }
    if (initRes.status === 503) throw new Error(`Sharing is temporarily disabled: ${msg}`);
    if (initRes.status === 429) throw new Error(msg);
    if (initRes.status === 401) throw new Error(msg);
    if (initRes.status === 400) throw new Error(`Server rejected the request: ${msg}`);
    throw new Error(msg);
  }
  const initJson = await initRes.json() as { id: string; alreadyUploaded?: boolean; isPrivate?: boolean; uploadUrl?: string };
  if (initJson.alreadyUploaded) {
    rememberShared(initJson.id, url);
    if (sourcePath) rememberSharedPath(sourcePath, initJson.id, url, initJson.isPrivate ?? wantsPrivate);
    return { id: initJson.id, url, alreadyUploaded: true, isPrivate: initJson.isPrivate ?? wantsPrivate };
  }
  if (!initJson.uploadUrl) throw new Error('Upload init returned no upload URL.');

  const putRes = await fetch(initJson.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/gzip' },
    body,
  });
  if (!putRes.ok) {
    throw new Error(`Blob upload to R2 failed (HTTP ${putRes.status}).`);
  }

  const commitRes = await fetch(`${SHARE_API_BASE_URL}/api/share/commit?${qs}`, {
    method: 'POST',
    headers: authHeaders,
  });
  if (!commitRes.ok) {
    let msg = `Upload commit failed (${commitRes.status})`;
    try { const j = await commitRes.json() as { error?: string }; if (j?.error) msg = j.error; } catch { /* keep generic */ }
    if (commitRes.status === 400) throw new Error(`Server rejected the payload: ${msg}`);
    throw new Error(msg);
  }
  const j = await commitRes.json() as { id: string; alreadyUploaded: boolean; isPrivate?: boolean };
  rememberShared(j.id, url);
  if (sourcePath) rememberSharedPath(sourcePath, j.id, url, j.isPrivate ?? wantsPrivate);
  return { id: j.id, url, alreadyUploaded: !!j.alreadyUploaded, isPrivate: j.isPrivate ?? wantsPrivate };
}
