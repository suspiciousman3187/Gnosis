
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { List, type RowComponentProps } from 'react-window';
import type { EncSummary } from './App';
import type { LootEncounterSummary } from '@/lib/dropAggregator';
import { kindFromName, labelFromName, fileTs, fileChar, representativeLootSummaries, groupMultiboxPaths, type ContentKind, type PathGroup } from './content';
import { newViewId, type ViewEntry } from './viewManifest';
import { loadSharedPaths, setSharePrivacy, type SharedPathMap } from './share';
import { openExternal } from './library';
import { requestSummaries as storeRequestSummaries, useSummary } from './summaryStore';
import { alertDialog } from '@/lib/dialogs';
import { ADDON_SOURCE_COLOR, CONTENT_COLOR_PALETTE, contentById, type ContentColorKey } from '@/lib/contentRegistry';
import type { EncounterSource } from '@/lib/encounter';
import RestoreArchiveModal from './RestoreArchiveModal';
import CleanupModal from './CleanupModal';

function titleColorFor(sourceOrKind: string): { off: string; on: string } | null {
  const def = contentById(sourceOrKind);
  if (def) {
    const pal = CONTENT_COLOR_PALETTE[def.color];
    return { off: pal.titleOff, on: pal.titleOn };
  }
  const key = ADDON_SOURCE_COLOR[sourceOrKind as EncounterSource] as ContentColorKey | null | undefined;
  if (key) {
    const pal = CONTENT_COLOR_PALETTE[key];
    return { off: pal.titleOff, on: pal.titleOn };
  }
  return null;
}

const KIND_ORDER: ContentKind[] = ['sortie', 'encounter'];

const SEARCH_FIELDS: { prefix: string; label: string; hint: string }[] = [
  { prefix: 'zone:', label: 'zone', hint: 'Search by zone name' },
  { prefix: 'mob:', label: 'enemy', hint: 'Search by enemy name' },
  { prefix: 'player:', label: 'player', hint: 'Search by player name' },
  { prefix: 'job:', label: 'job', hint: 'Search by job' },
  { prefix: 'type:', label: 'type', hint: 'Search by content type' },
  { prefix: 'is:starred', label: 'starred', hint: 'Show only starred runs' },
];

const STARRED_KEY = 'gnosis_starred_paths';
function loadStarred(): Set<string> {
  try {
    const raw = localStorage.getItem(STARRED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string') : []);
  } catch {
    return new Set();
  }
}
function saveStarred(set: Set<string>): void {
  try { localStorage.setItem(STARRED_KEY, JSON.stringify([...set])); } catch { /* quota / private mode - silently degrade */ }
}

function applyPrefix(s: string, prefix: string) {
  return s.replace(/(\S*)$/, prefix);
}

type SearchHay = { zone: string; enemies: string; players: string; jobs: string; kind: string; starred: boolean; blob: string };

function buildHay(path: string, enc: EncSummary | undefined, starred: boolean): SearchHay {
  const label = labelFromName(path).toLowerCase();
  // Use the full zone list (multi-zone session encounters) so `zone:bibiki`
  // matches a run that visited Bibiki even if the headline zone changed.
  const zone = ((enc?.zones?.length ? enc.zones : (enc?.zone ? [enc.zone] : []))
                .join(' ')
                .toLowerCase());
  const source = (enc?.source ?? '').toLowerCase();
  const enemies = (enc?.enemyNames ?? []).join(' ').toLowerCase();
  const players = (enc?.playerNames ?? []).join(' ').toLowerCase();
  const jobs = (enc?.jobs ?? []).join(' ').toLowerCase();
  const date = new Date(fileTs(path) * 1000).toLocaleString().toLowerCase();
  const kind = `${label} ${source}`;
  return { zone, enemies, players, jobs, kind, starred, blob: [label, zone, source, enemies, players, jobs, date].join(' ') };
}

function matchesQuery(hay: SearchHay, q: string): boolean {
  for (const term of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (term === 'is:starred' || term === 'starred:' || term === 'starred') {
      if (!hay.starred) return false;
      continue;
    }
    const ci = term.indexOf(':');
    if (ci > 0) {
      const field = term.slice(0, ci);
      const val = term.slice(ci + 1);
      let target: string | null;
      switch (field) {
        case 'zone': case 'z': target = hay.zone; break;
        case 'mob': case 'enemy': case 'enemies': case 'm': target = hay.enemies; break;
        case 'player': case 'players': case 'pl': case 'p': target = hay.players; break;
        case 'job': case 'j': target = hay.jobs; break;
        case 'type': case 'source': case 'src': target = hay.kind; break;
        default: target = null;
      }
      if (target !== null) { if (val && !target.includes(val)) return false; continue; }
    }
    if (!hay.blob.includes(term)) return false;
  }
  return true;
}

function fmtDur(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function fmtDurCompact(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function fmtRowDate(unixSec: number) {
  return new Date(unixSec * 1000).toLocaleString(undefined, {
    month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

const ROW_HEIGHT = 58;

type Group = PathGroup;

function segSpecOf(g: Group): { boundaries: number[]; segIndex: number } | undefined {
  if (g.view?.segIndex == null || !g.view.boundaries) return undefined;
  return { boundaries: g.view.boundaries, segIndex: g.view.segIndex };
}

function segWindowDur(g: Group, totalDur: number | undefined): number | undefined {
  if (g.view?.segIndex == null || !g.view.boundaries || totalDur == null) return undefined;
  const i = g.view.segIndex;
  const b = g.view.boundaries;
  const start = i === 0 ? 0 : b[i - 1];
  const end = i >= b.length ? totalDur : b[i];
  return Math.max(0, end - start);
}

interface RowExtraProps {
  groups: Group[];
  selected: string | null;
  confirmDelete: string | null;
  setConfirmDelete: (id: string | null) => void;
  onOpenGroup: (members: string[], view?: { boundaries?: number[]; segIndex?: number }) => void;
  onRemoveGroup: (members: string[]) => void;
  sharedPaths: SharedPathMap;
  starredPaths: Set<string>;
  onToggleStar: (members: string[]) => void;
  mergeMode: boolean;
  mergeSelection: Set<string>;
  toggleMergeSelection: (groupId: string, shiftKey: boolean) => void;
  enterMergeMode: () => void;
  openContextMenu: (groupId: string, x: number, y: number) => void;
  onRowPointerDown: (index: number, groupId: string, e: React.PointerEvent) => void;
  onRowPointerEnter: (index: number) => void;
  viewStats: Map<string, { dur: number; enemies: number }>;
}

function groupShareUrl(members: string[], sharedPaths: SharedPathMap): string | null {
  for (const m of members) {
    const e = sharedPaths[m];
    if (e?.url) return e.url;
  }
  return null;
}

function groupShareInfo(members: string[], sharedPaths: SharedPathMap): { id: string; url: string; isPrivate: boolean } | null {
  for (const m of members) {
    const e = sharedPaths[m];
    if (e?.id) return { id: e.id, url: e.url, isPrivate: !!e.isPrivate };
  }
  return null;
}

const SHARE_TOKEN_KEY = 'gnosis_share_token';
function loadShareToken(): string | null {
  try { return localStorage.getItem(SHARE_TOKEN_KEY) || null; } catch { return null; }
}

interface RowData {
  p: string;
  g: Group;
  kind: ContentKind;
  dotKind: string;
  enc: EncSummary | undefined;
  title: string;
  on: boolean;
  multibox: boolean;
  shareUrl: string | null;
  shareId: string | null;
  sharePrivate: boolean;
  starred: boolean;
  showStats: boolean;
  nEnemies: number | null;
  segDur?: number;
  isSegment: boolean;
  onOpenGroup: (members: string[], view?: { boundaries?: number[]; segIndex?: number }) => void;
  onToggleStar: (members: string[]) => void;
  setConfirmDelete: (id: string | null) => void;
  mergeMode: boolean;
  mergeSelected: boolean;
  toggleMergeSelection: (groupId: string, shiftKey: boolean) => void;
  enterMergeMode: () => void;
  openContextMenu: (groupId: string, x: number, y: number) => void;
  index: number;
  onRowPointerDown: (index: number, groupId: string, e: React.PointerEvent) => void;
  onRowPointerEnter: (index: number) => void;
}

// Star button - shared across every design (its placement varies, but
// the icon + behaviour is identical).
function StarButton({ d }: { d: RowData }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); d.onToggleStar(d.g.members); }}
      data-tooltip={d.starred ? 'Unstar this run' : 'Star this run'}
      aria-label={d.starred ? 'Unstar encounter' : 'Star encounter'}
      aria-pressed={d.starred}
      className={`shrink-0 w-6 h-6 flex items-center justify-center leading-none transition-colors ${
        d.starred
          ? 'text-amber-400 hover:text-amber-300'
          : 'text-white/10 group-hover:text-gray-500 hover:!text-amber-300'
      }`}
    >
      <svg viewBox="0 0 24 24" width="18" height="18"
        fill={d.starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 17.27l5.18 3.04-1.37-5.88L20.5 9.55l-6.04-.52L12 3.5l-2.46 5.53-6.04.52 4.69 4.88-1.37 5.88L12 17.27z" />
      </svg>
    </button>
  );
}

function DeleteButton({ d }: { d: RowData }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); d.setConfirmDelete(d.g.id); }}
      data-tooltip={d.multibox ? `Delete all ${d.g.members.length} character files` : 'Delete run'}
      aria-label="Delete encounter"
      className="shrink-0 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 leading-none px-1"
    >
      ✕
    </button>
  );
}

function SortieBadges({ d }: { d: RowData }) {
  if (d.kind !== 'sortie' || !d.enc?.sortie) return null;
  return (
    <>
      <span
        data-tooltip={`${d.enc.sortie.defeated} of 9 bosses defeated`}
        className={`shrink-0 text-[9px] font-bold px-1 py-0.5 rounded leading-none border ${
          d.enc.sortie.defeated >= 9
            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
            : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
        }`}
      >
        {d.enc.sortie.defeated}/9
      </span>
      {d.enc.sortie.aminon && (
        <span
          data-tooltip={`Aminon - ${d.enc.sortie.aminon.mode === 'hardmode' ? 'Hard Mode' : 'Normal'}${d.enc.sortie.aminon.killed ? ' (defeated)' : ' (attempted)'}`}
          className={`shrink-0 text-[9px] font-bold px-1 py-0.5 rounded leading-none border ${
            d.enc.sortie.aminon.mode === 'hardmode'
              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
              : 'bg-sky-500/20 text-sky-300 border-sky-500/40'
          } ${d.enc.sortie.aminon.killed ? '' : 'opacity-60'}`}
        >
          {d.enc.sortie.aminon.mode === 'hardmode' ? 'H' : 'N'}
        </span>
      )}
    </>
  );
}

function MultiboxBadge({ d }: { d: RowData }) {
  if (d.isSegment || !d.multibox) return null;
  const label = d.g.view ? `${d.g.members.length} merged` : `${d.g.members.length}×`;
  return (
    <span title={d.g.chars.join(', ')} className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded bg-accent/20 text-accent leading-none">
      {label}
    </span>
  );
}

function UploadedBadge({ d }: { d: RowData }) {
  if (!d.shareUrl) return null;
  return (
    <button
      onClick={e => { e.stopPropagation(); openExternal(d.shareUrl!); }}
      data-tooltip={`Uploaded - click to open ${d.shareUrl}`}
      aria-label="Open shared report in browser"
      className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded leading-none bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 transition-colors"
    >
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 17L17 7M9 7h8v8" />
      </svg>
    </button>
  );
}

function PrivacyBadge({ d }: { d: RowData }) {
  const [busy, setBusy] = useState(false);
  const [localPrivate, setLocalPrivate] = useState(d.sharePrivate);
  useEffect(() => { setLocalPrivate(d.sharePrivate); }, [d.sharePrivate]);

  if (!d.shareUrl || !d.shareId || !loadShareToken()) return null;

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    const next = !localPrivate;
    setBusy(true);
    setLocalPrivate(next);
    try {
      await setSharePrivacy(d.shareId!, next, loadShareToken());
    } catch (err) {
      setLocalPrivate(!next);
      await alertDialog({
        title: 'Privacy update failed',
        message: err instanceof Error ? err.message : String(err),
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  const tip = localPrivate
    ? 'Private - only you can view this report. Click to make public.'
    : 'Public - anyone with the link can view. Click to make private.';

  return (
    <button
      onClick={onClick}
      disabled={busy}
      data-tooltip={tip}
      aria-label={localPrivate ? 'Make report public' : 'Make report private'}
      className={`shrink-0 inline-flex items-center justify-center w-4 h-4 rounded leading-none border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        localPrivate
          ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
          : 'bg-white/[0.04] text-gray-400 border-white/15 hover:bg-white/[0.08] hover:text-gray-200'
      }`}
    >
      {busy ? (
        <span className="inline-block w-2 h-2 rounded-full border border-current border-t-transparent animate-spin" />
      ) : localPrivate ? (
        <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 018 0v4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 017.5-1.8" />
        </svg>
      )}
    </button>
  );
}

// Title with kind-colored tint (used by designs A, D). The encounter kind
// keeps the neutral white/gray treatment since its title is the zone name.
function TitleColored({ d }: { d: RowData }) {
  const tint = titleColorFor(d.dotKind);
  const cls = tint
    ? (d.on ? tint.on : tint.off)
    : (d.on ? 'text-white' : 'text-gray-300');
  return <span className={`text-xs font-medium truncate ${cls}`}>{d.title}</span>;
}

function HistoryRowBody({ d }: { d: RowData }) {
  return (
    <div onClick={(e) => {
        if (d.mergeMode) { e.preventDefault(); return; }
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          e.preventDefault();
          d.toggleMergeSelection(d.g.id, e.shiftKey);
          return;
        }
        d.onOpenGroup(d.g.members, segSpecOf(d.g));
      }}
      onPointerDown={(e) => d.onRowPointerDown(d.index, d.g.id, e)}
      onPointerEnter={() => d.onRowPointerEnter(d.index)}
      onContextMenu={(e) => {
        e.preventDefault();
        d.openContextMenu(d.g.id, e.clientX, e.clientY);
      }}
      className={`group w-full rounded px-2.5 py-2 cursor-pointer transition-colors mb-1 flex items-center gap-2.5 ${d.mergeMode ? 'select-none' : ''} ${
        d.mergeSelected ? 'bg-accent/15 ring-1 ring-accent/40' : d.on && !d.mergeMode ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
      }`}
    >
      <StarButton d={d} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-[13px] font-semibold truncate ${(() => {
            const tint = titleColorFor(d.dotKind);
            return tint ? (d.on ? tint.on : tint.off) : (d.on ? 'text-white' : 'text-gray-100');
          })()}`}>{d.title}</span>
          <SortieBadges d={d} />
          <MultiboxBadge d={d} />
          <UploadedBadge d={d} />
          <PrivacyBadge d={d} />
          <div className="ml-auto"><DeleteButton d={d} /></div>
        </div>
        <div className="text-[10px] text-gray-500 font-mono mt-1 truncate"
             data-tooltip={new Date(fileTs(d.p) * 1000).toLocaleString()}>
          {fmtRowDate(fileTs(d.p))}
          {d.showStats && (
            <>
              <span className="mx-1.5 text-gray-700">|</span>
              <span className="text-gray-400">{fmtDurCompact(d.segDur ?? d.enc!.dur ?? 0)}</span>
              {d.nEnemies != null && (
                <>
                  <span className="mx-1.5 text-gray-700">|</span>
                  <span className="text-gray-400">
                    {d.nEnemies === 1 && d.enc?.enemyNames?.[0]
                      ? d.enc.enemyNames[0]
                      : `${d.nEnemies.toLocaleString()} mobs`}
                  </span>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryRow({
  index, style,
  groups, selected, setConfirmDelete, onOpenGroup, sharedPaths, starredPaths, onToggleStar,
  mergeMode, mergeSelection, toggleMergeSelection, enterMergeMode, openContextMenu,
  onRowPointerDown, onRowPointerEnter, viewStats,
}: RowComponentProps<RowExtraProps>) {
  const g = groups[index];
  const p = g.rep;
  const kind = kindFromName(p)!;
  const on = g.members.includes(selected ?? '');
  const enc = useSummary(p);
  const dotKind: string = enc?.contentDefId
    ? enc.contentDefId
    : (kind === 'encounter' && enc?.source && enc.source !== 'generic' ? enc.source : kind);
  const zones = enc?.zones ?? (enc?.zone ? [enc.zone] : []);
  const baseTitle = kind === 'encounter'
    ? (zones.length > 0 ? zones.join(' + ') : '…')
    : labelFromName(p);
  const title = g.view?.segIndex != null && g.view.segCount != null
    ? `${baseTitle} · Part ${g.view.segIndex + 1}/${g.view.segCount}`
    : baseTitle;
  const vstat = g.view ? viewStats.get(g.view.id) : undefined;
  const isSegment = g.view?.segIndex != null;
  const segDur = isSegment
    ? segWindowDur(g, vstat?.dur ?? enc?.dur)
    : (g.view ? vstat?.dur : undefined);
  const nEnemies = isSegment ? null : (g.view ? (vstat?.enemies ?? 0) : (enc?.enemies ?? 0));
  const showStats = kind === 'encounter' && !!enc;
  const multibox = g.members.length > 1;
  const shareInfo = groupShareInfo(g.members, sharedPaths);
  const shareUrl = shareInfo?.url ?? null;
  const shareId = shareInfo?.id ?? null;
  const sharePrivate = !!shareInfo?.isPrivate;
  const starred = g.members.some(m => starredPaths.has(m));

  const data: RowData = {
    p, g, kind, dotKind, enc, title, on, multibox, shareUrl, shareId, sharePrivate, starred,
    showStats, nEnemies, segDur, isSegment, onOpenGroup, onToggleStar, setConfirmDelete,
    mergeMode,
    mergeSelected: mergeSelection.has(g.id),
    toggleMergeSelection,
    enterMergeMode,
    openContextMenu,
    index,
    onRowPointerDown,
    onRowPointerEnter,
  };

  return (
    <div
      style={style}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openContextMenu(g.id, e.clientX, e.clientY);
      }}
    >
      <HistoryRowBody d={data} />
    </div>
  );
}

type KillRowData = {
  key: string;
  mobName: string;
  ordinal: number;
  ts: number;
  zone: string | null;
  group: Group | null;
};

interface KillRowExtraProps {
  rows: KillRowData[];
  selected: string | null;
  onOpenGroup: (members: string[]) => void;
}

function KillRow({
  index, style, rows, selected, onOpenGroup,
}: RowComponentProps<KillRowExtraProps>) {
  const row = rows[index];
  const on = row.group ? row.group.members.includes(selected ?? '') : false;
  const handleOpen = () => {
    if (row.group) onOpenGroup(row.group.members);
  };
  return (
    <div style={style}>
      <div
        onClick={handleOpen}
        className={`group w-full rounded px-2.5 py-2 cursor-pointer transition-colors mb-1 flex items-center gap-2.5 ${
          on ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
        }`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className={`text-[13px] font-semibold truncate ${on ? 'text-white' : 'text-gray-100'}`}>{row.mobName}</span>
            <span className="text-[12px] font-mono text-accent shrink-0">#{row.ordinal.toLocaleString()}</span>
          </div>
          <div className="text-[10px] text-gray-500 font-mono mt-1 truncate"
               data-tooltip={new Date(row.ts * 1000).toLocaleString()}>
            {fmtRowDate(row.ts)}
            {row.zone && (
              <>
                <span className="mx-1.5 text-gray-700">|</span>
                <span className="text-gray-400">{row.zone}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface Props {
  active: boolean;
  inTauri: boolean;
  paths: string[];
  encSummaries: Record<string, EncSummary>;
  lootSummaries: Record<string, LootEncounterSummary>;
  selected: string | null;
  error: string | null;
  views: ViewEntry[];
  onViewsChange: (next: ViewEntry[]) => void;
  onOpenGroup: (members: string[], view?: { boundaries?: number[]; segIndex?: number }) => void;
  onRemoveGroup: (members: string[]) => void;
  /** Browser-mode fallback: open a file picker and load one report. */
  onPickFile: (file: File) => void;
  /** 'idle' = no loader. 'working' = animated loader with progress.
   *  'complete' = LoadingScreen complete state (confetti) for ~2s before auto-open. */
  onMergeStatusChange?: (status: 'idle' | 'working' | 'complete') => void;
  /** Live progress while merging or splitting. null when idle. */
  onMergeProgress?: (p: { current: number; total: number; label: string } | null) => void;
  /** Mirrors onMergeStatusChange for the split operation; App reads both. */
  onSplitStatusChange?: (status: 'idle' | 'working' | 'complete') => void;
}

function HistoryViewImpl({
  inTauri, paths, encSummaries, lootSummaries, selected, error,
  views, onViewsChange,
  onOpenGroup, onRemoveGroup, onPickFile, onMergeStatusChange, onMergeProgress, onSplitStatusChange,
}: Props) {
  const [search, setSearch] = useState('');
  const [searchFocus, setSearchFocus] = useState(false);
  const [newestFirst, setNewestFirst] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [splitGroup, setSplitGroup] = useState<Group | null>(null);
  const [splitStep, setSplitStep] = useState<'idle' | 'confirm' | 'working' | 'done' | 'error'>('idle');
  const [splitError, setSplitError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ groupId: string; x: number; y: number } | null>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [mergeSelection, setMergeSelection] = useState<Set<string>>(() => new Set());
  const [mergeStep, setMergeStep] = useState<'idle' | 'confirm' | 'working' | 'done' | 'error'>('idle');
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [bulkDeleteStep, setBulkDeleteStep] = useState<'idle' | 'confirm' | 'working' | 'error'>('idle');
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const mergeAnchorRef = useRef<string | null>(null);
  const orderedGroupIdsRef = useRef<string[]>([]);
  const dragStateRef = useRef<{ active: boolean; anchor: number; base: Set<string>; moved: boolean; groupId?: string; mode: 'add' | 'remove' } | null>(null);
  const toggleMergeSelection = useCallback((groupId: string, shiftKey: boolean) => {
    if (mergeStep === 'confirm' || mergeStep === 'working') return;
    if (shiftKey && mergeAnchorRef.current && mergeAnchorRef.current !== groupId) {
      const ids = orderedGroupIdsRef.current;
      const a = ids.indexOf(mergeAnchorRef.current);
      const b = ids.indexOf(groupId);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setMergeSelection(prev => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) next.add(ids[i]);
          return next;
        });
        return;
      }
    }
    mergeAnchorRef.current = groupId;
    setMergeSelection(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  }, [mergeStep]);
  const clearMergeSelection = useCallback(() => {
    setMergeSelection(new Set());
    mergeAnchorRef.current = null;
  }, []);
  const exitMergeMode = useCallback(() => {
    setMergeMode(false);
    clearMergeSelection();
  }, [clearMergeSelection]);
  const mergeBusy = mergeStep === 'confirm' || mergeStep === 'working' || bulkDeleteStep === 'confirm' || bulkDeleteStep === 'working';
  const onMergeButton = useCallback(() => {
    if (mergeBusy) return;
    if (mergeMode) { exitMergeMode(); return; }
    setMergeMode(true);
  }, [mergeMode, exitMergeMode, mergeBusy]);
  const onConfirmMerge = useCallback(() => {
    if (mergeBusy || mergeSelection.size < 2) return;
    setMergeError(null);
    setMergeStep('confirm');
  }, [mergeSelection.size, mergeBusy]);
  const onConfirmBulkDelete = useCallback(() => {
    if (mergeBusy || mergeSelection.size < 1) return;
    setBulkDeleteError(null);
    setBulkDeleteStep('confirm');
  }, [mergeSelection.size, mergeBusy]);
  const applyRange = useCallback((fromIndex: number, toIndex: number, base: Set<string>, mode: 'add' | 'remove') => {
    const ids = orderedGroupIdsRef.current;
    const [lo, hi] = fromIndex <= toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
    const next = new Set(base);
    for (let i = lo; i <= hi; i++) {
      if (!ids[i]) continue;
      if (mode === 'add') next.add(ids[i]); else next.delete(ids[i]);
    }
    setMergeSelection(next);
  }, []);
  const onRowPointerDown = useCallback((index: number, groupId: string, e: React.PointerEvent) => {
    if (!mergeMode || mergeBusy || e.button !== 0) return;
    if (e.shiftKey && mergeAnchorRef.current) {
      const a = orderedGroupIdsRef.current.indexOf(mergeAnchorRef.current);
      if (a >= 0) {
        applyRange(a, index, mergeSelection, 'add');
        dragStateRef.current = { active: true, anchor: index, base: new Set(mergeSelection), moved: true, mode: 'add' };
        return;
      }
    }
    mergeAnchorRef.current = groupId;
    const mode: 'add' | 'remove' = mergeSelection.has(groupId) ? 'remove' : 'add';
    dragStateRef.current = { active: true, anchor: index, base: new Set(mergeSelection), moved: false, groupId, mode };
  }, [mergeMode, mergeBusy, mergeSelection, applyRange]);
  const onRowPointerEnter = useCallback((index: number) => {
    const drag = dragStateRef.current;
    if (!drag?.active) return;
    if (index !== drag.anchor) drag.moved = true;
    applyRange(drag.anchor, index, drag.base, drag.mode);
  }, [applyRange]);
  useEffect(() => {
    const onUp = () => {
      const drag = dragStateRef.current;
      if (drag?.active && !drag.moved && drag.groupId) {
        const gid = drag.groupId;
        setMergeSelection(prev => {
          const next = new Set(prev);
          if (next.has(gid)) next.delete(gid); else next.add(gid);
          return next;
        });
      }
      if (dragStateRef.current) dragStateRef.current.active = false;
    };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, []);
  useEffect(() => {
    if (!mergeMode || mergeBusy) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exitMergeMode(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mergeMode, exitMergeMode, mergeBusy]);
  // Starred runs - persisted to localStorage, mirrored to React state so
  // toggles trigger a re-render of the list (and the per-row star icon).
  const [starredPaths, setStarredPaths] = useState<Set<string>>(() => loadStarred());
  // Cross-window/storage sync: if the user stars from a future feature
  // running in another WebView (e.g. the overlay window), refresh here too.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STARRED_KEY) setStarredPaths(loadStarred());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const onToggleStar = useCallback((members: string[]) => {
    setStarredPaths(prev => {
      const next = new Set(prev);
      const anyOn = members.some(m => next.has(m));
      if (anyOn) for (const m of members) next.delete(m);
      else for (const m of members) next.add(m);
      saveStarred(next);
      return next;
    });
  }, []);
  const [sharedPaths, setSharedPaths] = useState<SharedPathMap>(() => loadSharedPaths());
  useEffect(() => {
    const tick = () => setSharedPaths(loadSharedPaths());
    const onStorage = (e: StorageEvent) => { if (e.key === 'ff_shared_paths') tick(); };
    const onVis = () => { if (!document.hidden) tick(); };
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVis);
    const id = setInterval(() => { if (!document.hidden) tick(); }, 2000);
    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(id);
    };
  }, []);
  const searchRef = useRef<HTMLInputElement>(null);

  const visiblePaths = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = paths.filter(p => {
      const k = kindFromName(p);
      if (!k || !KIND_ORDER.includes(k)) return false;
      if (q && !matchesQuery(buildHay(p, encSummaries[p], starredPaths.has(p)), q)) return false;
      return true;
    });
    if (!newestFirst) list = [...list].reverse();
    return list;
  }, [paths, search, encSummaries, newestFirst, starredPaths]);

  const groups = useMemo(
    () => groupMultiboxPaths(visiblePaths, encSummaries, views),
    [visiblePaths, encSummaries, views],
  );
  const viewStats = useMemo(() => {
    const out = new Map<string, { dur: number; enemies: number }>();
    const seen = new Set<string>();
    for (const g of groups) {
      if (!g.view || seen.has(g.view.id)) continue;
      seen.add(g.view.id);
      const wins: { s: number; e: number; n: number }[] = [];
      let ok = true;
      for (const m of g.members) {
        const s = encSummaries[m];
        if (!s) { ok = false; break; }
        const st = fileTs(m);
        wins.push({ s: st, e: st + (s.dur ?? 0), n: s.enemies ?? 0 });
      }
      if (!ok || wins.length === 0) continue;
      wins.sort((a, b) => a.s - b.s);
      const span = Math.max(...wins.map(w => w.e)) - Math.min(...wins.map(w => w.s));
      let mobs = 0;
      let curEnd = -Infinity;
      let curMax = -1;
      for (const w of wins) {
        if (w.s >= curEnd) {
          if (curMax >= 0) mobs += curMax;
          curMax = w.n;
          curEnd = w.e;
        } else {
          curMax = Math.max(curMax, w.n);
          curEnd = Math.max(curEnd, w.e);
        }
      }
      if (curMax >= 0) mobs += curMax;
      out.set(g.view.id, { dur: span, enemies: mobs });
    }
    return out;
  }, [groups, encSummaries]);
  orderedGroupIdsRef.current = groups.map(g => g.id);

  const mobQuery = useMemo<string | null>(() => {
    for (const term of search.toLowerCase().split(/\s+/)) {
      if (term.startsWith('mob:') || term.startsWith('enemy:') || term.startsWith('enemies:') || term.startsWith('m:')) {
        const v = term.slice(term.indexOf(':') + 1);
        if (v) return v;
      }
    }
    return null;
  }, [search]);

  const killRows = useMemo(() => {
    if (!mobQuery) return null;
    const groupByMember = new Map<string, Group>();
    for (const g of groups) for (const m of g.members) groupByMember.set(m, g);
    const allReps = representativeLootSummaries(Object.values(lootSummaries));
    allReps.sort((a, b) => a.ts - b.ts);
    type KR = { key: string; mobName: string; ordinal: number; ts: number; zone: string | null; group: Group | null };
    const rows: KR[] = [];
    let n = 0;
    for (const rep of allReps) {
      const g = groupByMember.get(rep.path) ?? null;
      const kills = [...rep.killLog].sort((a, b) => a.elapsed - b.elapsed);
      for (const k of kills) {
        if (!k?.name) continue;
        if (!k.name.toLowerCase().includes(mobQuery)) continue;
        n += 1;
        if (!g) continue;
        rows.push({
          key: `${rep.path}|${k.id}|${k.elapsed}|${n}`,
          mobName: k.name,
          ordinal: n,
          ts: rep.ts + k.elapsed,
          zone: rep.zone ?? null,
          group: g,
        });
      }
    }
    if (newestFirst) rows.reverse();
    return rows;
  }, [mobQuery, lootSummaries, groups, newestFirst]);

  const searchSuggest = useMemo(() => {
    const last = (search.match(/(\S*)$/)?.[1] ?? '').toLowerCase();
    if (last.includes(':')) return [];
    return SEARCH_FIELDS.filter(f => !last || f.prefix.startsWith(last) || f.label.startsWith(last));
  }, [search]);

  const pendingDelete = confirmDelete ? groups.find(g => g.id === confirmDelete) ?? null : null;

  // Esc closes the modal. Captured at document level rather than via input
  // because the modal has no focusable surface to hang a key handler on.
  useEffect(() => {
    if (!pendingDelete) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setConfirmDelete(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingDelete]);

  const starredActive = /(^|\s)(is:starred|starred:?|starred)(\s|$)/.test(search);
  const onStarredToggle = () => setSearch(s => {
    const cleaned = s.replace(/(^|\s)(is:starred|starred:?|starred)(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
    const wasOn = /(^|\s)(is:starred|starred:?|starred)(\s|$)/.test(s);
    return wasOn ? cleaned : (cleaned ? `${cleaned} is:starred` : 'is:starred');
  });

  return (
    <aside className="bg-nav w-72 h-full flex flex-col border-r border-white/10">
      {/* Pinned controls */}
      <div className="p-3 space-y-3 border-b border-white/5 shrink-0">
        <div>
          <h1 className="text-lg font-bold text-accent leading-tight">Encounter History</h1>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <p className="text-[10px] text-gray-500 font-mono">
              {killRows
                ? `${killRows.length} kill${killRows.length === 1 ? '' : 's'}`
                : `${groups.length} encounter${groups.length === 1 ? '' : 's'}`}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onStarredToggle}
                data-tooltip="Show only starred runs"
                aria-pressed={starredActive}
                className={`inline-flex items-center justify-center w-6 h-6 rounded border transition-colors ${
                  starredActive
                    ? 'border-amber-400/50 bg-amber-400/10 text-amber-300'
                    : 'border-white/15 text-gray-500 hover:text-amber-300 hover:bg-white/[0.06]'
                }`}
              >
                <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true">
                  <path d="M12 17.27l5.18 3.04-1.37-5.88L20.5 9.55l-6.04-.52L12 3.5l-2.46 5.53-6.04.52 4.69 4.88-1.37 5.88L12 17.27z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setNewestFirst(v => !v)}
                data-tooltip="Toggle sort order"
                className="inline-flex items-center gap-1 px-2 h-6 rounded border border-white/15 text-[10px] uppercase tracking-wider font-semibold text-gray-300 hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                <span>{newestFirst ? 'Newest' : 'Oldest'}</span>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${newestFirst ? '' : 'rotate-180'}`} aria-hidden="true">
                  <path d="M6 9l6-6 6 6" />
                  <path d="M12 3v18" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {inTauri && paths.length > 0 && (
          <div className="space-y-2">
            <div className="relative">
              <div className={`flex items-center gap-2 rounded-lg bg-panel-alt/70 border px-2.5 py-1.5 transition-all ${
                searchFocus ? 'border-accent/50 ring-1 ring-accent/25' : 'border-white/10'
              }`}>
                <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 shrink-0 text-gray-500" aria-hidden>
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input
                  ref={searchRef}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onFocus={() => setSearchFocus(true)}
                  onBlur={() => setSearchFocus(false)}
                  placeholder="Search encounters…"
                  className="flex-1 min-w-0 bg-transparent text-xs text-gray-200 placeholder-gray-500 outline-none"
                />
                {search && (
                  <button
                    onClick={() => { setSearch(''); searchRef.current?.focus(); }}
                    data-tooltip="Clear search"
                    className="shrink-0 text-gray-500 hover:text-gray-200 text-sm leading-none -mr-0.5"
                  >
                    ✕
                  </button>
                )}
              </div>

              {searchFocus && searchSuggest.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1.5 z-30 rounded-lg bg-surface border border-white/10 shadow-xl shadow-black/50 overflow-hidden py-1">
                  <div className="px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-gray-500">Search filters</div>
                  {searchSuggest.map(f => (
                    <button
                      key={f.prefix}
                      onMouseDown={e => { e.preventDefault(); setSearch(s => applyPrefix(s, f.prefix)); searchRef.current?.focus(); }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/[0.06] transition-colors"
                    >
                      <span className="shrink-0 font-mono text-[11px] text-accent bg-accent/10 border border-accent/20 rounded px-1.5 py-0.5 leading-none">{f.prefix}</span>
                      <span className="text-[11px] text-gray-400 truncate">{f.hint}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {(() => {
              const mergeLabel = mergeMode ? 'Cancel' : 'Select';
              const mergeActive = mergeMode;
              const baseBtn = 'flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md border text-[10px] uppercase tracking-wider font-semibold transition-colors whitespace-nowrap';
              const selectedGroup = selected ? (groups.find(g => g.members.includes(selected)) ?? null) : null;
              const splitDisabled = !selectedGroup || mergeBusy
                || selectedGroup.view?.segIndex != null
                || kindFromName(selectedGroup.rep) !== 'encounter';
              const onSplitClick = () => {
                if (splitDisabled || !selectedGroup) return;
                setSplitGroup(selectedGroup);
                setSplitError(null);
                setSplitStep('confirm');
              };
              return (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onSplitClick}
                    disabled={splitDisabled}
                    data-tooltip={!selectedGroup ? 'Open an encounter first' : 'Split the current encounter into segments'}
                    className={`le-tap ${baseBtn} border-white/15 text-gray-300 hover:text-white hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 12h4l3-3 4 6 3-3h4" />
                    </svg>
                    <span>Split</span>
                  </button>
                  <button
                    type="button"
                    onClick={onMergeButton}
                    disabled={mergeBusy}
                    data-tooltip={mergeBusy ? 'Busy…' : mergeMode ? 'Exit select mode' : 'Select multiple encounters to merge or delete'}
                    className={`le-tap ${baseBtn} ${mergeActive ? 'border-rose-500/50 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20' : 'border-white/15 text-gray-300 hover:text-white hover:bg-white/[0.06]'} disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 11l3 3L22 4" />
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </svg>
                    <span>{mergeLabel}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCleanupOpen(true)}
                    disabled={paths.length === 0 || mergeBusy}
                    data-tooltip="Bulk-delete incidental/garbage encounters by rule"
                    className={`le-tap ${baseBtn} border-white/15 text-gray-300 hover:text-white hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 6h18" />
                      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
                    </svg>
                    <span>Clean Up</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRestoreOpen(true)}
                    disabled={paths.length === 0}
                    data-tooltip="Restore originals from a prior merge, split, or bulk delete"
                    className={`le-tap ${baseBtn} border-white/15 text-gray-300 hover:text-white hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 12a9 9 0 1 0 3-6.7" />
                      <path d="M3 4v5h5" />
                    </svg>
                    <span>Restore</span>
                  </button>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Scrolling list - VIRTUALIZED. Only the rows currently in the
          viewport (+ a small overscan) are mounted, so a 1000+ run library
          renders the same ~30 DOM nodes as a 30-run one. Scroll smoothness
          + filter latency stay constant regardless of library size.

          react-window's List fills its parent's height, so we wrap it in a
          flex-1 div that already sets the available height; the empty-state
          /error fallbacks stay outside the List so they don't fight its
          virtualization (the List would otherwise eat their whole height). */}
      <div className="flex-1 min-h-0 px-3 pb-3 flex flex-col">
        {mergeMode && (
          <div className="mb-2 shrink-0 px-2.5 py-1.5 rounded border border-accent/30 bg-accent/[0.06] text-[10px] text-accent/90 italic space-y-1.5">
            <div>
              {mergeSelection.size === 0
                ? 'Click+Drag to Select. Merge requires same zone.'
                : `${mergeSelection.size} Encounters Selected`}
            </div>
            <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onConfirmMerge}
              disabled={mergeBusy || mergeSelection.size < 2}
              data-tooltip={mergeBusy ? 'Busy…' : mergeSelection.size < 2 ? 'Select at least 2 encounters' : `Merge ${mergeSelection.size} selected`}
              className="le-tap flex-1 not-italic whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold border border-emerald-500/60 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 hover:text-emerald-100 disabled:border-white/10 disabled:bg-white/5 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              ✓ MERGE
            </button>
            <button
              type="button"
              onClick={onConfirmBulkDelete}
              disabled={mergeBusy || mergeSelection.size < 1}
              data-tooltip={mergeBusy ? 'Busy…' : mergeSelection.size < 1 ? 'Select at least 1 encounter' : `Delete ${mergeSelection.size} selected`}
              className="le-tap flex-1 not-italic whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold border border-rose-500/60 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 hover:text-rose-100 disabled:border-white/10 disabled:bg-white/5 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              🗑 DELETE
            </button>
            <button
              type="button"
              onClick={exitMergeMode}
              disabled={mergeBusy}
              data-tooltip={mergeBusy ? 'Wait for the operation to finish' : 'Exit select mode (Esc)'}
              className="le-tap flex-1 not-italic whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold border border-white/25 bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white disabled:border-white/10 disabled:bg-white/5 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              ✕ EXIT
            </button>
            </div>
          </div>
        )}
        {inTauri ? (
          <>
            {error && <div className="text-red-400 text-xs mb-2 break-words shrink-0">{error}</div>}
            {paths.length === 0 && !error && (
              <div className="text-gray-600 text-xs shrink-0">No runs yet. Finish a run or track a fight in-game and it&apos;ll appear here.</div>
            )}
            {paths.length > 0 && visiblePaths.length === 0 && !killRows && (
              <div className="text-gray-600 text-xs shrink-0">No runs match the current filter.</div>
            )}
            {killRows && killRows.length === 0 && (
              <div className="text-gray-600 text-xs shrink-0">No kills match &quot;{mobQuery}&quot;.</div>
            )}
            {killRows && killRows.length > 0 && (
              <div className="flex-1 min-h-0">
                <List<KillRowExtraProps>
                  rowComponent={KillRow}
                  rowCount={killRows.length}
                  rowHeight={ROW_HEIGHT}
                  overscanCount={5}
                  style={{ height: '100%' }}
                  rowProps={{ rows: killRows, selected, onOpenGroup }}
                />
              </div>
            )}
            {!killRows && groups.length > 0 && (
              <div className="flex-1 min-h-0">
                <List<RowExtraProps>
                  rowComponent={HistoryRow}
                  rowCount={groups.length}
                  rowHeight={ROW_HEIGHT}
                  overscanCount={10}
                  onRowsRendered={({ startIndex, stopIndex }) => {
                    const head = Math.max(0, startIndex - 10);
                    const tail = Math.min(groups.length - 1, stopIndex + 10);
                    const pathsToRequest: string[] = [];
                    for (let i = head; i <= tail; i++) {
                      const g = groups[i];
                      if (!g) continue;
                      for (const m of g.members) pathsToRequest.push(m);
                    }
                    if (pathsToRequest.length) storeRequestSummaries(pathsToRequest);
                  }}
                  style={{ height: '100%' }}
                  rowProps={{
                    groups,
                    selected,
                    confirmDelete,
                    setConfirmDelete,
                    onOpenGroup,
                    onRemoveGroup,
                    sharedPaths,
                    starredPaths,
                    onToggleStar,
                    mergeMode,
                    mergeSelection,
                    toggleMergeSelection,
                    enterMergeMode: () => setMergeMode(true),
                    openContextMenu: (gid, x, y) => setContextMenu({ groupId: gid, x, y }),
                    onRowPointerDown,
                    onRowPointerEnter,
                    viewStats,
                  }}
                />
              </div>
            )}
          </>
        ) : (
          <label className="cursor-pointer text-sm bg-surface border border-white/10 rounded-lg px-3 py-2 block text-center text-gray-200 hover:bg-surface-hover">
            Open report…
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) onPickFile(f); }}
            />
          </label>
        )}
      </div>
      {pendingDelete && (
        <DeleteConfirmModal
          group={pendingDelete}
          encSummary={encSummaries[pendingDelete.rep]}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => { onRemoveGroup(pendingDelete.members); setConfirmDelete(null); }}
        />
      )}
      {(mergeStep === 'confirm' || mergeStep === 'error') && (
        <MergeConfirmModal
          selection={Array.from(mergeSelection).map(id => groups.find(g => g.id === id)).filter((g): g is Group => !!g)}
          encSummaries={encSummaries}
          step={mergeStep}
          error={mergeError}
          onCancel={() => {
            setMergeStep('idle');
            setMergeError(null);
          }}
          onConfirm={(selectedGroups) => {
            if (selectedGroups.some(g => g.view?.segIndex != null)) {
              setMergeError('One of the selected encounters is a split segment. Unsplit it first, then merge.');
              setMergeStep('error');
              return;
            }
            const kinds = new Set(selectedGroups.flatMap(g => g.members.map(m => kindFromName(m))));
            if (kinds.size > 1) {
              setMergeError('Only encounters of the same type can be merged together.');
              setMergeStep('error');
              return;
            }
            const members = [...new Set(selectedGroups.flatMap(g => g.members))];
            const consumed = new Set(selectedGroups.map(g => g.view?.id).filter((id): id is string => !!id));
            const entry: ViewEntry = { id: newViewId(), members };
            onViewsChange(views.filter(v => !consumed.has(v.id)).concat(entry));
            setMergeStep('idle');
            setMergeError(null);
            exitMergeMode();
            onOpenGroup(members);
          }}
        />
      )}
      {(bulkDeleteStep === 'confirm' || bulkDeleteStep === 'error') && (
        <BulkDeleteConfirmModal
          selection={Array.from(mergeSelection).map(id => groups.find(g => g.id === id)).filter((g): g is Group => !!g)}
          encSummaries={encSummaries}
          step={bulkDeleteStep}
          error={bulkDeleteError}
          onCancel={() => { setBulkDeleteStep('idle'); setBulkDeleteError(null); }}
          onConfirm={async (selectedGroups) => {
            setBulkDeleteStep('working');
            setBulkDeleteError(null);
            const members = selectedGroups.flatMap(g => g.members);
            try {
              const { archiveForDelete } = await import('./bulkDeleteDisk');
              await archiveForDelete(members);
              onRemoveGroup(members);
              setBulkDeleteStep('idle');
              exitMergeMode();
            } catch (e) {
              setBulkDeleteStep('error');
              setBulkDeleteError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      )}
      {restoreOpen && paths.length > 0 && (() => {
        const sample = paths[0];
        const zoneDir = sample.replace(/[\\/][^\\/]+$/, '');
        const dataDir = zoneDir.replace(/[\\/][^\\/]+$/, '');
        return (
          <RestoreArchiveModal
            dataDir={dataDir}
            onClose={() => setRestoreOpen(false)}
            onRestored={() => { /* parent watcher picks up new files */ }}
          />
        );
      })()}
      {cleanupOpen && (
        <CleanupModal
          groups={groups}
          encSummaries={encSummaries}
          onClose={() => setCleanupOpen(false)}
          onDelete={async (members) => {
            const { archiveForDelete } = await import('./bulkDeleteDisk');
            await archiveForDelete(members);
            onRemoveGroup(members);
          }}
        />
      )}
      {(splitStep === 'confirm' || splitStep === 'done' || splitStep === 'error') && splitGroup && (
        <SplitConfirmModal
          group={splitGroup}
          encSummary={encSummaries[splitGroup.rep]}
          step={splitStep}
          error={splitError}
          onCancel={() => {
            setSplitStep('idle');
            setSplitError(null);
            setSplitGroup(null);
          }}
          onConfirm={(_mode, opts) => {
            const bs = [...new Set(opts.boundaries ?? [])].filter(b => b > 0).sort((a, b) => a - b);
            if (bs.length === 0) {
              setSplitError('No split boundaries produced - try a different mode or pick boundaries manually.');
              setSplitStep('error');
              return;
            }
            const entry: ViewEntry = { id: newViewId(), members: splitGroup.members, boundaries: bs };
            const next = views.filter(v => v.id !== splitGroup.view?.id).concat(entry);
            onViewsChange(next);
            setSplitStep('idle');
            setSplitError(null);
            setSplitGroup(null);
            onOpenGroup(splitGroup.members, { boundaries: bs, segIndex: 0 });
          }}
        />
      )}
      {contextMenu && (() => {
        const g = groups.find(gg => gg.id === contextMenu.groupId);
        if (!g) return null;
        const selSize = mergeSelection.size;
        const inSelection = mergeSelection.has(g.id);
        const selectedGroupsForMerge: Group[] = inSelection && selSize >= 2
          ? groups.filter(gg => mergeSelection.has(gg.id))
          : [];
        const isSegment = g.view?.segIndex != null;
        const items: { label: string; tone?: 'danger' | 'accent' | 'default'; onClick: () => void; disabled?: boolean }[] = [];
        items.push({ label: 'Open', onClick: () => onOpenGroup(g.members, segSpecOf(g)) });
        if (inSelection && selSize >= 2) {
          items.push({
            label: `Merge ${selSize} encounters`,
            tone: 'accent',
            disabled: mergeBusy,
            onClick: () => {
              if (mergeBusy) return;
              setMergeError(null);
              setMergeStep('confirm');
            },
          });
        } else if (!isSegment && kindFromName(g.rep) === 'encounter') {
          items.push({
            label: 'Split this encounter',
            tone: 'accent',
            onClick: () => {
              setSplitGroup(g);
              setSplitError(null);
              setSplitStep('confirm');
            },
          });
        }
        if (g.view) {
          const viewId = g.view.id;
          const mergedUnderneath = g.members.length > 1;
          if (isSegment) {
            if (mergedUnderneath) {
              items.push({
                label: 'Unsplit (back to merged)',
                tone: 'accent',
                onClick: () => onViewsChange(views.map(v => v.id === viewId ? { id: v.id, members: v.members } : v)),
              });
              items.push({
                label: 'Unmerge (back to originals)',
                tone: 'accent',
                onClick: () => onViewsChange(views.filter(v => v.id !== viewId)),
              });
            } else {
              items.push({
                label: 'Unsplit',
                tone: 'accent',
                onClick: () => onViewsChange(views.filter(v => v.id !== viewId)),
              });
            }
          } else {
            items.push({
              label: 'Unmerge',
              tone: 'accent',
              onClick: () => onViewsChange(views.filter(v => v.id !== viewId)),
            });
          }
        }
        const isStarred = g.members.some(m => starredPaths.has(m));
        items.push({ label: isStarred ? 'Unstar' : 'Star', onClick: () => onToggleStar(g.members) });
        if (selSize > 0) {
          items.push({ label: `Clear selection (${selSize})`, onClick: clearMergeSelection });
        }
        if (!isSegment) {
          items.push({
            label: g.members.length > 1 ? `Delete ${g.members.length} files` : 'Delete',
            tone: 'danger',
            onClick: () => setConfirmDelete(g.id),
          });
        }
        return (
          <RowContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={items}
            onClose={() => setContextMenu(null)}
            title={selectedGroupsForMerge.length > 0
              ? `${selectedGroupsForMerge.length} encounters selected`
              : (kindFromName(g.rep) === 'encounter'
                  ? (encSummaries[g.rep]?.zones?.join(' + ') ?? labelFromName(g.rep))
                  : labelFromName(g.rep))}
          />
        );
      })()}
    </aside>
  );
}

function RowContextMenu({ x, y, items, onClose, title }: {
  x: number;
  y: number;
  items: { label: string; tone?: 'danger' | 'accent' | 'default'; onClick: () => void; disabled?: boolean }[];
  onClose: () => void;
  title?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
    const PAD = 6;
    const APPROX_W = 200;
    const APPROX_H = 220;
    let left = x;
    let top = y;
    if (vw && left + APPROX_W > vw - PAD) left = Math.max(PAD, vw - PAD - APPROX_W);
    if (vh && top + APPROX_H > vh - PAD) top = Math.max(PAD, vh - PAD - APPROX_H);
    return { left, top };
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const PAD = 6;
    let left = x;
    let top = y;
    if (left + r.width > vw - PAD) left = Math.max(PAD, vw - PAD - r.width);
    if (top + r.height > vh - PAD) top = Math.max(PAD, vh - PAD - r.height);
    setPos({ left, top });
  }, [x, y]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const onCtx = (e: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
    };
    const t = window.setTimeout(() => {
      window.addEventListener('keydown', onKey);
      window.addEventListener('mousedown', onDown);
      window.addEventListener('contextmenu', onCtx);
      window.addEventListener('scroll', onClose, true);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[10001] min-w-[12rem] max-w-xs bg-zinc-950/95 border border-white/15 rounded-lg shadow-2xl py-1 backdrop-blur-sm"
      style={{ left: pos.left, top: pos.top }}
    >
      {title && (
        <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 font-semibold border-b border-white/10 truncate">
          {title}
        </div>
      )}
      {items.map((item, i) => {
        const tone = item.tone === 'danger'
          ? 'text-rose-300 hover:bg-rose-500/15'
          : item.tone === 'accent'
            ? 'text-accent hover:bg-accent/15'
            : 'text-gray-200 hover:bg-white/[0.06]';
        return (
          <button
            key={i}
            type="button"
            disabled={item.disabled}
            onClick={() => { if (!item.disabled) { item.onClick(); onClose(); } }}
            className={`w-full text-left text-xs px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${tone}`}
          >
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

function BulkDeleteConfirmModal({
  selection, encSummaries, step, error, onCancel, onConfirm,
}: {
  selection: Group[];
  encSummaries: Record<string, EncSummary>;
  step: 'confirm' | 'error';
  error: string | null;
  onCancel: () => void;
  onConfirm: (selectedGroups: Group[]) => void;
}) {
  const sorted = useMemo(() => [...selection].sort((a, b) => fileTs(b.rep) - fileTs(a.rep)), [selection]);
  const fileCount = useMemo(() => selection.reduce((n, g) => n + g.members.length, 0), [selection]);
  return createPortal((
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/60" onClick={onCancel}>
      <div className="bg-surface border border-white/15 rounded-xl shadow-2xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-rose-300 uppercase tracking-wide mb-3">
          {step === 'error' ? 'Delete failed' : 'Delete encounters'}
        </h3>
        {step === 'confirm' && (
          <>
            <p className="text-xs text-gray-300 mb-3">
              {selection.length} encounter{selection.length === 1 ? '' : 's'} ({fileCount} file{fileCount === 1 ? '' : 's'}) will be deleted.
              A copy is moved to <code className="text-[10px] bg-black/40 px-1 rounded">data/_deleted/</code> first, so you can restore it from the Restore button.
            </p>
            <ul className="text-[11px] text-gray-400 mb-3 space-y-0.5 max-h-40 overflow-y-auto">
              {sorted.map((g, i) => {
                const enc = encSummaries[g.rep];
                const zones = enc?.zones ?? (enc?.zone ? [enc.zone] : []);
                const label = kindFromName(g.rep) === 'encounter'
                  ? (zones.length > 0 ? zones.join(' + ') : 'Encounter')
                  : labelFromName(g.rep);
                return (
                  <li key={g.id} className="font-mono truncate">
                    {i + 1}. {new Date(fileTs(g.rep) * 1000).toLocaleString()} · {label}{g.members.length > 1 ? ` · ${g.members.length} chars` : ''}
                  </li>
                );
              })}
            </ul>
            <div className="flex justify-end gap-2">
              <button onClick={onCancel} className="le-tap px-3 py-1.5 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/5">Cancel</button>
              <button
                onClick={() => onConfirm(sorted)}
                className="le-tap px-3 py-1.5 text-xs rounded bg-rose-600 text-white font-semibold hover:bg-rose-500"
              >
                Delete {fileCount} file{fileCount === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}
        {step === 'error' && (
          <>
            <p className="text-xs text-rose-300 mb-3 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1.5 break-words">{error ?? 'Unknown error.'}</p>
            <div className="flex justify-end">
              <button onClick={onCancel} className="le-tap px-3 py-1.5 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/5">Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  ), document.body);
}

function MergeConfirmModal({
  selection, encSummaries, step, error, onCancel, onConfirm,
}: {
  selection: Group[];
  encSummaries: Record<string, EncSummary>;
  step: 'confirm' | 'error';
  error: string | null;
  onCancel: () => void;
  onConfirm: (selectedGroups: Group[]) => void;
}) {
  const sorted = useMemo(() => [...selection].sort((a, b) => fileTs(a.rep) - fileTs(b.rep)), [selection]);
  const zones = useMemo(() => {
    const s = new Set<string>();
    for (const g of selection) {
      const enc = encSummaries[g.rep];
      const zs = enc?.zones ?? (enc?.zone ? [enc.zone] : []);
      for (const z of zs) s.add(z);
    }
    return Array.from(s);
  }, [selection, encSummaries]);
  const crossZone = zones.length > 1;
  const gaps = useMemo(() => {
    const out: { idx: number; gapSec: number }[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prevEnc = encSummaries[sorted[i - 1].rep];
      const prevEnd = fileTs(sorted[i - 1].rep) + (prevEnc?.dur ?? 0);
      const gap = fileTs(sorted[i].rep) - prevEnd;
      if (gap > 300) out.push({ idx: i, gapSec: gap });
    }
    return out;
  }, [sorted, encSummaries]);

  return createPortal((
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/60" onClick={onCancel}>
      <div className="bg-surface border border-white/15 rounded-xl shadow-2xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-accent uppercase tracking-wide mb-3">
          {step === 'error' ? 'Merge failed' : 'Merge encounters'}
        </h3>
        {step === 'confirm' && (
          <>
            <p className="text-xs text-gray-300 mb-3">
              {selection.length} encounters will be merged into 1.
              Non-destructive: the original files stay untouched; undo any time via right-click → Unmerge.
            </p>
            <ul className="text-[11px] text-gray-400 mb-3 space-y-0.5 max-h-32 overflow-y-auto">
              {sorted.map((g, i) => {
                const enc = encSummaries[g.rep];
                return (
                  <li key={g.id} className="font-mono">
                    {i + 1}. {new Date(fileTs(g.rep) * 1000).toLocaleTimeString()} · {enc?.dur ? `${Math.round(enc.dur / 60)}m` : '?'} · {enc?.enemies ?? 0} mobs
                  </li>
                );
              })}
            </ul>
            {crossZone && (
              <p className="text-xs text-rose-400 mb-3 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1.5">
                <strong>Cross-zone merge blocked.</strong> Selected encounters span: {zones.join(', ')}.
              </p>
            )}
            {!crossZone && gaps.length > 0 && (
              <p className="text-xs text-amber-300 mb-3 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
                <strong>Large gap{gaps.length > 1 ? 's' : ''}:</strong> {gaps.map(g => `${Math.round(g.gapSec / 60)}m`).join(', ')} between encounters. Timeline DPS will dilute.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={onCancel} className="le-tap px-3 py-1.5 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/5">Cancel</button>
              <button
                onClick={() => onConfirm(sorted)}
                disabled={crossZone}
                className="le-tap px-3 py-1.5 text-xs rounded bg-accent text-black font-semibold hover:bg-accent/90 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed"
              >
                Merge {selection.length} encounters
              </button>
            </div>
          </>
        )}
        {step === 'error' && (
          <>
            <p className="text-xs text-rose-300 mb-3 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1.5 break-words">{error ?? 'Unknown error.'}</p>
            <div className="flex justify-end">
              <button onClick={onCancel} className="le-tap px-3 py-1.5 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/5">Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  ), document.body);
}

/**
 * Manual-mode timeline scrubber. Renders the encounter as a horizontal bar
 * with kill ticks (amber) and zone-change ticks (sky), plus an action-density
 * heatmap underneath. Click anywhere on the bar to add a boundary at that
 * elapsed time. Click an existing marker to remove it. Markers snap to the
 * nearest event within 3% of the bar width for ergonomic precision.
 */
function SplitScrubber({
  enc, boundaries, onChange,
}: {
  enc: import('@/lib/encounter').Encounter;
  boundaries: number[];
  onChange: (next: number[]) => void;
}) {
  const dur = Math.max(1, enc.durationSeconds);
  const barRef = useRef<HTMLDivElement | null>(null);

  // Event ticks for visual context.
  const killTicks = (enc.killLog ?? []).map(k => k.elapsed).filter(t => t > 0 && t < dur);
  const zoneTicks = (enc.zoneLog ?? []).map(z => z.elapsed).filter(t => t > 0 && t < dur);

  // Action density buckets - 60 columns across the bar.
  const buckets = 60;
  const density = new Array(buckets).fill(0);
  for (const e of enc.actionLog ?? []) {
    const i = Math.min(buckets - 1, Math.max(0, Math.floor((e.elapsed / dur) * buckets)));
    density[i] += 1;
  }
  const peak = Math.max(1, ...density);

  const snapThresholdSec = dur * 0.03;
  const snapToEvent = (t: number): number => {
    const events = [...killTicks, ...zoneTicks];
    let best = t; let bestDelta = snapThresholdSec;
    for (const ev of events) {
      const d = Math.abs(ev - t);
      if (d < bestDelta) { bestDelta = d; best = ev; }
    }
    return Math.round(best);
  };

  const onBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = barRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const tRaw = (x / rect.width) * dur;
    const t = snapToEvent(tRaw);
    if (t <= 0 || t >= dur) return;
    // Toggle: if a nearby existing boundary exists, remove it; else add.
    const existing = boundaries.findIndex(b => Math.abs(b - t) < snapThresholdSec);
    if (existing >= 0) {
      onChange(boundaries.filter((_, i) => i !== existing));
    } else {
      onChange([...boundaries, t].sort((a, b) => a - b));
    }
  };

  const fmtSecs = (s: number) => {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${m}:${ss.toString().padStart(2, '0')}`;
  };

  return (
    <div className="mb-3 mt-1">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Timeline</span>
        <span className="text-[10px] text-gray-500 font-mono">
          {boundaries.length} marker{boundaries.length === 1 ? '' : 's'} · {fmtSecs(dur)} total
        </span>
      </div>
      <div
        ref={barRef}
        onClick={onBarClick}
        className="relative h-12 bg-black/30 border border-white/[0.08] rounded cursor-crosshair overflow-hidden select-none"
        data-tooltip="Click to add a marker · click a marker to remove · snaps to nearest kill/zone"
      >
        {/* Action density heatmap (bottom half) */}
        <div className="absolute inset-x-0 bottom-0 h-1/2 flex">
          {density.map((v, i) => (
            <div
              key={i}
              className="flex-1 bg-accent/40"
              style={{ opacity: v / peak * 0.7 + 0.05 }}
            />
          ))}
        </div>
        {/* Zone-change ticks (sky, full height) */}
        {zoneTicks.map((t, i) => (
          <div
            key={`z-${i}`}
            className="absolute top-0 bottom-0 w-px bg-sky-400/50"
            style={{ left: `${(t / dur) * 100}%` }}
          />
        ))}
        {/* Kill ticks (amber, top half) */}
        {killTicks.map((t, i) => (
          <div
            key={`k-${i}`}
            className="absolute top-0 h-1/2 w-px bg-amber-400/60"
            style={{ left: `${(t / dur) * 100}%` }}
          />
        ))}
        {/* User-placed boundary markers (rose, full height, with handle) */}
        {boundaries.map((b, i) => (
          <div
            key={`b-${i}`}
            className="absolute top-0 bottom-0 w-0.5 bg-rose-500"
            style={{ left: `${(b / dur) * 100}%` }}
            data-tooltip={`${fmtSecs(b)} - click to remove`}
          >
            <div className="absolute -top-1 -left-[3px] w-2 h-2 rounded-full bg-rose-500" />
            <div className="absolute -bottom-1 -left-[3px] w-2 h-2 rounded-full bg-rose-500" />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-1 text-[10px] text-gray-600 font-mono">
        <span>0:00</span>
        <span className="text-amber-400/70">| kill</span>
        <span className="text-sky-400/70">| zone change</span>
        <span className="text-rose-400">| your marker</span>
        <span>{fmtSecs(dur)}</span>
      </div>
    </div>
  );
}

function SplitConfirmModal({
  group, encSummary, step, error, onCancel, onConfirm,
}: {
  group: Group;
  encSummary: EncSummary | undefined;
  step: 'confirm' | 'done' | 'error';
  error: string | null;
  onCancel: () => void;
  onConfirm: (
    mode: 'per-kill' | 'per-zone' | 'idle-gaps' | 'per-boss' | 'manual',
    opts: { boundaries?: number[]; gapSeconds?: number },
  ) => void;
}) {
  type SplitMode = 'per-kill' | 'per-zone' | 'idle-gaps' | 'per-boss' | 'manual';
  const [mode, setMode] = useState<SplitMode>('per-kill');
  const [gapSeconds, setGapSeconds] = useState<number>(60);
  const [manualBoundaries, setManualBoundaries] = useState<number[]>([]);
  const [loadedEnc, setLoadedEnc] = useState<import('@/lib/encounter').Encounter | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const didAutoModeRef = useRef(false);

  useEffect(() => {
    if (didAutoModeRef.current || !loadedEnc) return;
    const byName = new Map<string, number>();
    for (const e of loadedEnc.enemies ?? []) byName.set(e.name, (byName.get(e.name) ?? 0) + 1);
    const maxAttempts = Math.max(0, ...[...byName.values()]);
    if (maxAttempts >= 2) { setMode('per-boss'); didAutoModeRef.current = true; }
  }, [loadedEnc]);

  // Load the group's MATERIALIZED encounter for preview calculations, so a
  // merged view splits on its merged timeline rather than one slice's.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { readText } = await import('./library');
        const loads = await Promise.all(group.members.map(async p => ({ path: p, text: await readText(p) })));
        const { materializeGroup } = await import('./viewMaterialize');
        const c = materializeGroup(loads);
        if (c.kind !== 'encounter') throw new Error('Only encounters can be split.');
        if (!cancelled) setLoadedEnc(c.encounter);
      } catch (e) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [group]);

  // Preview the boundary list for the current mode.
  const [boundaries, setBoundaries] = useState<number[]>([]);
  useEffect(() => {
    if (!loadedEnc) { setBoundaries([]); return; }
    (async () => {
      const { suggestSplits } = await import('./splitEncounter');
      if (mode === 'manual') {
        setBoundaries(manualBoundaries);
      } else {
        setBoundaries(suggestSplits(loadedEnc, mode, { gapSeconds }));
      }
    })();
  }, [loadedEnc, mode, gapSeconds, manualBoundaries]);

  const [preview, setPreview] = useState<import('./splitEncounter').SplitPreviewSegment[]>([]);
  useEffect(() => {
    if (!loadedEnc) { setPreview([]); return; }
    (async () => {
      const { previewSplit } = await import('./splitEncounter');
      setPreview(previewSplit(loadedEnc, boundaries));
    })();
  }, [loadedEnc, boundaries]);

  useEffect(() => {
    if (step !== 'confirm') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, onCancel]);

  const zones = encSummary?.zones ?? (encSummary?.zone ? [encSummary.zone] : []);
  const title = zones.length > 0 ? zones.join(' + ') : '…';
  const dur = encSummary?.dur ?? loadedEnc?.durationSeconds ?? 0;

  const fmtSecs = (s: number) => {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${m}:${ss.toString().padStart(2, '0')}`;
  };

  return createPortal((
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/60" onClick={onCancel}>
      <div className="bg-surface border border-white/15 rounded-xl shadow-2xl max-w-xl w-full p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-accent uppercase tracking-wide mb-3">
          {step === 'done' ? 'Split complete' : step === 'error' ? 'Split failed' : 'Split encounter'}
        </h3>
        {step === 'confirm' && (
          <>
            <p className="text-xs text-gray-300 mb-3">
              <span className="font-semibold text-gray-100">{title}</span> · {fmtSecs(dur)}
              {group.members.length > 1 && <> · <span className="text-accent">{group.members.length}× multibox</span></>}
              <span className="text-gray-500"> - each character will be split with the same boundaries.</span>
            </p>

            <div className="space-y-2 mb-3">
              {(() => {
                const enemies = loadedEnc?.enemies ?? [];
                const byName = new Map<string, number>();
                for (const e of enemies) byName.set(e.name, (byName.get(e.name) ?? 0) + 1);
                const attempts = Math.max(0, ...[...byName.values()]);
                if (attempts < 2) return null;
                const bossName = [...byName.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0]?.[0];
                return (
                  <label className="flex items-start gap-2 text-xs text-gray-300 cursor-pointer">
                    <input type="radio" checked={mode === 'per-boss'} onChange={() => setMode('per-boss')} className="mt-0.5 accent-accent" />
                    <div className="flex-1">
                      <div className="font-medium">Per boss attempt</div>
                      <div className="text-[10px] text-gray-500">{bossName} fought {attempts}× → splits at each fresh engagement</div>
                    </div>
                  </label>
                );
              })()}
              <label className="flex items-start gap-2 text-xs text-gray-300 cursor-pointer">
                <input type="radio" checked={mode === 'per-kill'} onChange={() => setMode('per-kill')} className="mt-0.5 accent-accent" />
                <div className="flex-1">
                  <div className="font-medium">At each kill</div>
                  <div className="text-[10px] text-gray-500">{(loadedEnc?.killLog?.length ?? 0)} kills → up to {(loadedEnc?.killLog?.length ?? 0) + 1} segments</div>
                </div>
              </label>
              <label className="flex items-start gap-2 text-xs text-gray-300 cursor-pointer">
                <input type="radio" checked={mode === 'per-zone'} onChange={() => setMode('per-zone')} className="mt-0.5 accent-accent" />
                <div className="flex-1">
                  <div className="font-medium">At each zone transition</div>
                  <div className="text-[10px] text-gray-500">{(loadedEnc?.zoneLog?.length ?? 0)} zones logged</div>
                </div>
              </label>
              <label className="flex items-start gap-2 text-xs text-gray-300 cursor-pointer">
                <input type="radio" checked={mode === 'idle-gaps'} onChange={() => setMode('idle-gaps')} className="mt-0.5 accent-accent" />
                <div className="flex-1">
                  <div className="font-medium">At idle gaps ≥
                    <input
                      type="number"
                      min={5}
                      max={3600}
                      step={5}
                      value={gapSeconds}
                      onClick={e => { e.stopPropagation(); setMode('idle-gaps'); }}
                      onChange={e => { setMode('idle-gaps'); setGapSeconds(Math.max(5, Math.min(3600, Number(e.target.value) || 60))); }}
                      className="mx-1.5 w-14 px-1 py-0.5 text-[11px] bg-black/40 border border-white/15 rounded font-mono text-gray-100"
                    />
                    seconds
                  </div>
                  <div className="text-[10px] text-gray-500">Scans action log; splits at midpoint of each long gap</div>
                </div>
              </label>
              <label className="flex items-start gap-2 text-xs text-gray-300 cursor-pointer">
                <input type="radio" checked={mode === 'manual'} onChange={() => setMode('manual')} className="mt-0.5 accent-accent" />
                <div className="flex-1">
                  <div className="font-medium">Manual time markers</div>
                  <div className="text-[10px] text-gray-500">Click on the timeline below to add / remove split points.</div>
                </div>
              </label>
            </div>

            {mode === 'manual' && loadedEnc && (
              <SplitScrubber
                enc={loadedEnc}
                boundaries={manualBoundaries}
                onChange={setManualBoundaries}
              />
            )}

            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mt-3 mb-1">Preview ({preview.length} segments)</div>
            {loadErr ? (
              <p className="text-xs text-rose-400">Failed to load source encounter: {loadErr}</p>
            ) : !loadedEnc ? (
              <p className="text-xs text-gray-500">Loading source encounter…</p>
            ) : preview.length === 0 ? (
              <p className="text-xs text-gray-500 italic">No split boundaries - pick a mode or click the timeline.</p>
            ) : (
              <ul className="text-[11px] text-gray-400 mb-3 space-y-0.5 max-h-40 overflow-y-auto bg-black/20 border border-white/[0.06] rounded p-2 font-mono">
                {preview.map((s) => (
                  <li key={s.index}>
                    {(s.index + 1).toString().padStart(2)}. {fmtSecs(s.startSec)}–{fmtSecs(s.endSec)}
                    {' · '}
                    <span className="text-gray-500">{fmtSecs(s.durationSec)}</span>
                    {' · '}
                    <span className="text-amber-300/80">{s.killCount} kill{s.killCount === 1 ? '' : 's'}</span>
                    {s.zone && <span className="text-gray-500"> · {s.zone}</span>}
                  </li>
                ))}
              </ul>
            )}

            <p className="text-[10px] text-gray-500 mb-3">
              Non-destructive: the original files stay untouched; undo any time via right-click → Unsplit.
              Per-segment stats (XP/CP totals, combat stats) are recomputed; cross-segment skillchains may cut.
            </p>

            <div className="flex justify-end gap-2">
              <button onClick={onCancel} className="le-tap px-3 py-1.5 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/5">Cancel</button>
              <button
                onClick={() => onConfirm(mode, { gapSeconds, boundaries })}
                disabled={preview.length < 2}
                className="px-3 py-1.5 text-xs rounded bg-accent text-black font-semibold hover:bg-accent/90 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed"
              >
                Split into {preview.length} segments
              </button>
            </div>
          </>
        )}
        {step === 'done' && (
          <>
            <p className="text-xs text-emerald-300 mb-3">Segments written; originals archived to <code className="text-[10px] bg-black/40 px-1 rounded">data/_split/</code>. Opening the first segment.</p>
            <div className="flex justify-end">
              <button onClick={onCancel} className="le-tap px-3 py-1.5 text-xs rounded bg-accent text-black font-semibold">Close</button>
            </div>
          </>
        )}
        {step === 'error' && (
          <>
            <p className="text-xs text-rose-300 mb-3 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1.5 break-words">{error ?? 'Unknown error.'}</p>
            <div className="flex justify-end">
              <button onClick={onCancel} className="le-tap px-3 py-1.5 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/5">Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  ), document.body);
}

function DeleteConfirmModal({
  group, encSummary, onCancel, onConfirm,
}: {
  group: Group;
  encSummary: EncSummary | undefined;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const kind = kindFromName(group.rep)!;
  const zones = encSummary?.zones ?? (encSummary?.zone ? [encSummary.zone] : []);
  const title = kind === 'encounter'
    ? (zones.length > 0 ? zones.join(' + ') : labelFromName(group.rep))
    : labelFromName(group.rep);
  const when = new Date(fileTs(group.rep) * 1000).toLocaleString();
  const multibox = group.members.length > 1;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/65" onClick={onCancel} />
      <div className="relative w-full max-w-md bg-surface border border-white/10 rounded-xl p-5 shadow-2xl shadow-black/50">
        <div className="text-sm font-bold text-gray-100">Delete encounter?</div>
        <div className="text-[12px] text-gray-400 mt-3 space-y-1.5">
          <div><span className="text-gray-500">Encounter:</span> <span className="text-gray-200">{title}</span></div>
          <div><span className="text-gray-500">Time:</span> <span className="text-gray-200">{when}</span></div>
          {multibox && (
            <div><span className="text-gray-500">Characters:</span> <span className="text-gray-200">{group.chars.join(', ')}</span></div>
          )}
          <div className="pt-2 text-[11px] text-rose-300/80">
            {multibox
              ? `This will delete ${group.members.length} character files. The local data is gone permanently.`
              : 'The local data is gone permanently. Uploaded shares on the website are not affected.'}
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs rounded px-3 py-1.5 border border-white/10 text-gray-300 hover:bg-white/[0.05] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="text-xs font-semibold rounded px-3 py-1.5 bg-rose-500/80 hover:bg-rose-500 text-white transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default memo(HistoryViewImpl, (prev, next) => {
  if (!next.active) return true;
  return prev.active === next.active
    && prev.paths === next.paths
    && prev.views === next.views
    && prev.encSummaries === next.encSummaries
    && prev.lootSummaries === next.lootSummaries
    && prev.selected === next.selected
    && prev.error === next.error
    && prev.inTauri === next.inTauri;
});
