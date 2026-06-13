
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import LoadingScreen from './LoadingScreen';
import { useLootAggregation } from './useLootAggregation';
import ItemIcon from '@/components/ItemIcon';
import {
  aggregateLoot, zonesFromLootEntries,
  type LootCatalog, type LootEncounterSummary, type LootFilters, type MobLootStats, type ItemLootStats,
} from '@/lib/dropAggregator';
import {
  classify, mobNamesFromLootSummary, itemNamesFromLootSummary, CONTENT_REGISTRY, type ContentDef,
} from '@/lib/contentRegistry';
import type { ActivityEncounter } from '@/lib/contentAggregator';
import { kindFromName, fileTs, labelFromName, representativeLootSummaries } from './content';
import { useLootsRecord, requestLoots, evictLootsExcept } from './summaryStore';
import { useDisplayLanguage } from '@/lib/displayLanguage';
import { translateForDisplay } from '@/lib/translate';

type Tab = 'recent' | 'mobs' | 'items' | 'content';

const RECENT_LIMIT = 15;

const fmtDate = (ts: number | null) => ts == null ? '-' : new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

function fmtTimeAgo(ts: number): string {
  const now = Date.now() / 1000;
  const diff = Math.max(0, now - ts);
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function RatePill({ rate, drops }: { rate: number; drops: number }) {
  if (drops === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 shrink-0">
        <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Drop Rate</span>
        <span className="text-xs text-gray-500 font-mono">0% (0 drops)</span>
      </span>
    );
  }
  const stacks = rate > 1;
  const pct = stacks ? 100 : rate * 100;
  const avg = rate >= 10 ? rate.toFixed(1) : rate.toFixed(2);
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0">
      <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Drop Rate</span>
      <span className="text-xs text-amber-300 font-mono">
        {pct.toFixed(1)}%
        {stacks && <span className="text-amber-200/80"> (x{avg}/kill)</span>}
      </span>
    </span>
  );
}

// Strip viz: small SVG bar with tick marks at each kill # where the item
// dropped, normalized into [0,1]. Compact enough to inline in a row.
const STRIP_BUCKETS = 200;
function DropMarkersStrip({ kills, marks, width, height = 14 }: {
  kills: number;
  marks: number[];
  width?: number | string;
  height?: number;
}) {
  const ticks = useMemo(() => {
    if (kills <= 0 || marks.length === 0) return [] as { x: number; opacity: number }[];
    const counts = new Uint32Array(STRIP_BUCKETS);
    for (let i = 0; i < marks.length; i++) {
      const k = marks[i];
      let slot = Math.floor(((k - 0.5) / kills) * STRIP_BUCKETS);
      if (slot < 0) slot = 0; else if (slot >= STRIP_BUCKETS) slot = STRIP_BUCKETS - 1;
      counts[slot]++;
    }
    let maxCount = 1;
    for (let i = 0; i < counts.length; i++) if (counts[i] > maxCount) maxCount = counts[i];
    const out: { x: number; opacity: number }[] = [];
    for (let i = 0; i < counts.length; i++) {
      const c = counts[i];
      if (c === 0) continue;
      const opacity = 0.35 + 0.65 * Math.sqrt(c / maxCount);
      out.push({ x: ((i + 0.5) / STRIP_BUCKETS) * 100, opacity });
    }
    return out;
  }, [kills, marks]);

  if (kills <= 0) return null;
  return (
    <svg viewBox="0 0 100 10" preserveAspectRatio="none" style={{ width: width ?? '100%', height }} className="bg-black/30 rounded block">
      <line x1={0} y1={5} x2={100} y2={5} stroke="rgba(255,255,255,0.12)" strokeWidth={0.6} />
      {ticks.map((t, i) => (
        <line key={i} x1={t.x} y1={1} x2={t.x} y2={9} stroke="#fbbf24" strokeWidth={1.4} strokeOpacity={t.opacity} />
      ))}
    </svg>
  );
}

function ZoneChips({ zones, selected, onToggle, onClear }: {
  zones: string[];
  selected: Set<string>;
  onToggle: (z: string) => void;
  onClear: () => void;
}) {
  if (zones.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mr-1">Zone</span>
      <button
        onClick={onClear}
        className={`text-xs px-2.5 py-1 rounded border transition-colors ${
          selected.size === 0
            ? 'bg-accent/20 border-accent/50 text-accent font-semibold'
            : 'border-white/10 text-gray-400 hover:bg-white/[0.05]'
        }`}
      >
        All
      </button>
      {zones.map(z => (
        <button
          key={z}
          onClick={() => onToggle(z)}
          className={`text-xs px-2.5 py-1 rounded border transition-colors ${
            selected.has(z)
              ? 'bg-accent/20 border-accent/50 text-accent font-semibold'
              : 'border-white/10 text-gray-400 hover:bg-white/[0.05]'
          }`}
        >
          {z}
        </button>
      ))}
    </div>
  );
}

function OpenLink({ path, onOpen, className, title, children }: { path: string; onOpen: (p: string) => void; className: string; title?: string; children: React.ReactNode }) {
  return (
    <span
      role="link"
      tabIndex={0}
      onClick={e => { e.stopPropagation(); onOpen(path); }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpen(path); } }}
      className={className}
      data-tooltip={title}
    >
      {children}
    </span>
  );
}

function MobRow({ stats, onOpen }: { stats: MobLootStats; onOpen?: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-white/[0.03] transition-colors text-left"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-gray-500 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}><path d="M9 6l6 6-6 6" /></svg>
        <span className="font-semibold text-gray-100 truncate">{stats.mob}</span>
        <span className="text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded bg-white/10 text-gray-300 border border-white/10 shrink-0">
          {stats.kills} kill{stats.kills === 1 ? '' : 's'}
        </span>
        <span className="text-[10px] text-gray-500 shrink-0">
          {stats.uniqueItems} unique drop{stats.uniqueItems === 1 ? '' : 's'}
        </span>
        <span className="ml-auto text-[10px] text-gray-500 font-mono shrink-0">
          {fmtDate(stats.firstKillTs)} – {fmtDate(stats.lastKillTs)}
        </span>
      </button>
      {open && (
        <div className="border-t border-white/10 divide-y divide-white/[0.05]">
          {stats.items.length === 0 ? (
            <div className="px-5 py-4 text-xs text-gray-500 italic">No pool drops recorded for this enemy.</div>
          ) : stats.items.map(item => (
            <div key={item.item} className="px-5 py-3">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 shrink-0 min-w-[200px]">
                  <MobItemIcon item={item} />
                  <span className="text-xs text-gray-400 font-mono">×{item.drops}</span>
                </div>
                <RatePill rate={item.rate} drops={item.drops} />
                <div className="flex-1 min-w-0 px-2">
                  {item.dropKillIndexes.length > 0 && (
                    <DropMarkersStrip kills={stats.kills} marks={item.dropKillIndexes} />
                  )}
                </div>
                <span className="text-xs text-gray-400 shrink-0">
                  {item.lastDropKillIndex != null ? (
                    item.lastDropPath && onOpen ? (
                      <>last <OpenLink path={item.lastDropPath} onOpen={onOpen} className="font-mono text-accent hover:text-accent/80 underline-offset-2 hover:underline cursor-pointer" title="Open the encounter where this last dropped">#{item.lastDropKillIndex}</OpenLink></>
                    ) : (
                      <>last <span className="font-mono text-gray-200">#{item.lastDropKillIndex}</span></>
                    )
                  ) : (
                    <span className="italic">never</span>
                  )}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400 pl-[212px]">
                <span>dry: <span className="font-mono text-rose-300">{item.killsSinceLastDrop}</span></span>
                <span>longest: <span className="font-mono text-gray-200">{item.longestDryStreak}</span></span>
                <span>
                  first seen{' '}
                  {item.firstDropPath && onOpen ? (
                    <OpenLink path={item.firstDropPath} onOpen={onOpen} className="font-mono text-accent hover:text-accent/80 underline-offset-2 hover:underline cursor-pointer" title="Open the encounter where this was first seen">{fmtDate(item.firstDropTs)}</OpenLink>
                  ) : (
                    <span className="font-mono">{fmtDate(item.firstDropTs)}</span>
                  )}
                </span>
              </div>
              {item.looters.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400 pl-[212px]">
                  <span className="font-semibold text-gray-300">looters:</span>
                  {item.looters.map(l => (
                    <span key={l.name} className="font-mono">
                      <span className="text-gray-200">{l.name}</span> ×{l.count} ({l.pct}%)
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Per-item row + expansion ─────────────────────────────────────────────────
// Same outer-panel convention as MobRow.
function MobItemIcon({ item }: { item: MobLootStats['items'][number] }) {
  const displayLang = useDisplayLanguage();
  const name = translateForDisplay('items', item.itemId, item.item, displayLang);
  return <ItemIcon id={item.itemId} name={name} size={20} nameClass="text-lime-200 font-medium" />;
}

function ItemRow({ stats, onOpen }: { stats: ItemLootStats; onOpen?: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const displayLang = useDisplayLanguage();
  const itemName = translateForDisplay('items', stats.itemId, stats.item, displayLang);
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-white/[0.03] transition-colors text-left"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-gray-500 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}><path d="M9 6l6 6-6 6" /></svg>
        <ItemIcon id={stats.itemId} name={itemName} size={20} nameClass="text-lime-200 font-semibold" />
        <span className="text-xs font-bold tracking-wide px-1.5 py-0.5 rounded bg-white/10 text-gray-200 border border-white/10 shrink-0">
          ×{stats.totalDrops}
        </span>
        <span className="text-xs text-gray-400 shrink-0">
          {stats.sources.length} source{stats.sources.length === 1 ? '' : 's'}
        </span>
        <span className="ml-auto flex items-center gap-2 shrink-0">
          {stats.firstDropPath && onOpen && (
            <OpenLink
              path={stats.firstDropPath}
              onOpen={onOpen}
              className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide rounded-md border border-sky-400/40 bg-sky-500/10 text-sky-300 px-2 py-0.5 hover:bg-sky-500/20 hover:border-sky-400/60 cursor-pointer transition-colors"
              title="Open the encounter where this was first seen"
            >
              First Seen: <span className="font-mono normal-case tracking-normal">{fmtDate(stats.firstDropTs)}</span>
            </OpenLink>
          )}
          {stats.lastDropPath && onOpen ? (
            <OpenLink
              path={stats.lastDropPath}
              onOpen={onOpen}
              className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide rounded-md border border-emerald-400/40 bg-emerald-500/10 text-emerald-300 px-2 py-0.5 hover:bg-emerald-500/20 hover:border-emerald-400/60 cursor-pointer transition-colors"
              title="Open the encounter where this last dropped"
            >
              Last Seen: <span className="font-mono normal-case tracking-normal">{fmtDate(stats.lastDropTs)}</span>
            </OpenLink>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide rounded-md border border-white/10 bg-white/[0.04] text-gray-400 px-2 py-0.5">
              Last Seen: <span className="font-mono normal-case tracking-normal">{fmtDate(stats.lastDropTs)}</span>
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="border-t border-white/10 divide-y divide-white/[0.05]">
          {stats.sources.map(src => (
            <div key={src.mob} className="px-5 py-2.5 flex items-center gap-3 text-xs">
              <span className="text-gray-200 truncate flex-1">{src.mob}</span>
              <span className="inline-flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Kills</span>
                <span className="text-xs text-gray-400 font-mono">{src.drops} / {src.killsOfMob}</span>
              </span>
              <RatePill rate={src.rate} drops={src.drops} />
            </div>
          ))}
          {stats.looters.length > 0 && (
            <div className="px-5 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
              <span className="font-semibold text-gray-300">looters:</span>
              {stats.looters.map(l => (
                <span key={l.name} className="font-mono">
                  <span className="text-gray-200">{l.name}</span> ×{l.count} ({l.pct}%)
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ContentRollup {
  def: ContentDef | null;  // null = uncategorized
  runs: number;
  kills: number;
  drops: number;
  firstTs: number | null;
  lastTs: number | null;
  lootEntries: LootEncounterSummary[];
  /** Total entry count INCLUDING content-module entries, for the "runs"
   *  label. May exceed `lootEntries.length` for content-module-heavy rows. */
  hasContentModuleEntries: boolean;
}
const ContentRow = memo(function ContentRow({ rollup, onOpen }: { rollup: ContentRollup; onOpen?: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const catalog = useMemo(
    () => (open && rollup.lootEntries.length > 0 ? aggregateLoot(rollup.lootEntries) : null),
    [open, rollup.lootEntries],
  );
  const title = rollup.def?.name ?? 'Uncategorized';
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-white/[0.03] transition-colors text-left"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-gray-500 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}><path d="M9 6l6 6-6 6" /></svg>
        <span className="font-semibold text-gray-100 truncate">{title}</span>
        <span className="text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded bg-white/10 text-gray-300 border border-white/10 shrink-0">
          {rollup.runs} run{rollup.runs === 1 ? '' : 's'}
        </span>
        {rollup.kills > 0 && (
          <span className="text-[10px] text-gray-500 shrink-0">{rollup.kills.toLocaleString()} kills</span>
        )}
        {rollup.drops > 0 && (
          <span className="text-[10px] text-gray-500 shrink-0">{rollup.drops.toLocaleString()} drops</span>
        )}
        <span className="ml-auto text-[10px] text-gray-500 font-mono shrink-0">
          {fmtDate(rollup.firstTs)} – {fmtDate(rollup.lastTs)}
        </span>
      </button>
      {open && (
        <div className="border-t border-white/10 bg-black/20">
          {catalog && catalog.mobs.length > 0 ? (
            <div className="divide-y divide-white/[0.05]">
              {catalog.mobs.map(m => <MobRow key={m.mob} stats={m} onOpen={onOpen} />)}
            </div>
          ) : rollup.hasContentModuleEntries ? (
            <div className="px-5 py-4 text-xs text-gray-500 italic">
              This activity is tracked through its content-module reports (Sortie / Limbus / Odyssey /
              Ambuscade). Per-mob drop attribution lives on those reports directly - open one from
              the History tab or the Activities tab for the breakdown. Generic-tracker encounters in
              the same zone (if any) would surface their per-mob loot here.
            </div>
          ) : (
            <div className="px-5 py-4 text-xs text-gray-500 italic">No mob-attributed drops recorded for this content.</div>
          )}
        </div>
      )}
    </div>
  );
});

interface RecentDropRow {
  absTs: number;
  itemId?: number;
  item: string;
  count: number;
  source: string | null;
  looter: string | null;
  zone: string | null;
  path: string;
  type?: 'pool' | 'direct' | 'temporary';
}

function RecentRow({ row, onOpen }: { row: RecentDropRow; onOpen?: (path: string) => void }) {
  const displayLang = useDisplayLanguage();
  const itemName = translateForDisplay('items', row.itemId, row.item, displayLang);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-white/[0.03] transition-colors">
      <ItemIcon id={row.itemId} name={itemName} size={20} nameClass="text-lime-200 font-medium" />
      {row.count > 1 && (
        <span className="text-xs text-amber-300 font-mono shrink-0">x{row.count}</span>
      )}
      {row.source && (
        <span className="text-xs text-gray-400 shrink-0">
          from <span className="text-gray-200">{row.source}</span>
        </span>
      )}
      {row.looter && (
        <span className="text-xs text-gray-400 shrink-0">
          by <span className="text-gray-200">{row.looter}</span>
        </span>
      )}
      <span className="ml-auto flex items-center gap-3 shrink-0">
        {row.zone && (
          onOpen ? (
            <OpenLink path={row.path} onOpen={onOpen} className="text-xs text-accent hover:text-accent/80 underline-offset-2 hover:underline cursor-pointer" title="Open this encounter">
              {row.zone}
            </OpenLink>
          ) : (
            <span className="text-xs text-gray-400">{row.zone}</span>
          )
        )}
        <span className="text-[11px] text-gray-500 font-mono w-20 text-right">{fmtTimeAgo(row.absTs)}</span>
      </span>
    </div>
  );
}

function LootTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-row-even border border-white/10 rounded-xl overflow-hidden divide-y divide-white/[0.06]">
      {children}
    </div>
  );
}

export default function LootView({ paths, entries: entriesProp, activityEntries, onOpen }: {
  paths?: string[];
  entries?: LootEncounterSummary[];
  activityEntries: ActivityEncounter[];
  onOpen?: (path: string) => void;
}) {
  const lootSummaries = useLootsRecord();
  const [tab, setTab] = useState<Tab>('recent');
  const [scope, setScope] = useState<'30d' | '90d' | 'all'>('30d');

  const tabIsAgg = tab === 'mobs' || tab === 'items' || tab === 'content';

  const RECENT_HYDRATE_LIMIT = 100;
  useEffect(() => {
    if (entriesProp || !paths || paths.length === 0) return;
    if (tab === 'recent') {
      const encounterPaths = paths.filter(p => kindFromName(p) === 'encounter');
      const sorted = [...encounterPaths].sort((a, b) => fileTs(b) - fileTs(a));
      requestLoots(sorted.slice(0, RECENT_HYDRATE_LIMIT));
    }
  }, [paths, entriesProp, tab]);

  useEffect(() => {
    return () => { evictLootsExcept(new Set()); };
  }, []);

  const aggResult = useLootAggregation({
    paths,
    enabled: !entriesProp && tabIsAgg,
    scope,
  });

  const inMemoryEntries = useMemo<LootEncounterSummary[]>(() => {
    if (entriesProp) return representativeLootSummaries(entriesProp);
    if (tabIsAgg) return [];
    const out: LootEncounterSummary[] = [];
    for (const p of paths ?? []) {
      if (kindFromName(p) !== 'encounter') continue;
      const s = lootSummaries[p];
      if (s) out.push(s);
    }
    return representativeLootSummaries(out);
  }, [paths, entriesProp, tabIsAgg, lootSummaries]);

  const entries = tabIsAgg && !entriesProp ? aggResult.entries : inMemoryEntries;

  const [query, setQuery] = useState('');
  const [selectedZones, setSelectedZones] = useState<Set<string>>(new Set());
  // Date range: bound dates in ISO yyyy-mm-dd form, stored empty = open-ended.
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const zones = useMemo(() => zonesFromLootEntries(entries), [entries]);

  const filters: LootFilters = useMemo(() => ({
    query: query.trim() || undefined,
    zones: selectedZones.size > 0 ? selectedZones : undefined,
    startTs: startDate ? Math.floor(new Date(startDate + 'T00:00:00').getTime() / 1000) : undefined,
    // endTs is END-of-day so an entry at 23:55 on that day still passes.
    endTs:   endDate   ? Math.floor(new Date(endDate   + 'T23:59:59').getTime() / 1000) : undefined,
  }), [query, selectedZones, startDate, endDate]);

  const catalog = useMemo<LootCatalog | null>(() => {
    if (tab === 'recent' || tab === 'content') return null;
    if (tabIsAgg && !entriesProp && aggResult.loading) return null;
    return aggregateLoot(entries, filters);
  }, [tab, tabIsAgg, entriesProp, aggResult.loading, entries, filters]);

  const recentDrops = useMemo<RecentDropRow[]>(() => {
    if (tab !== 'recent') return [];
    const q = (filters.query ?? '').toLowerCase();
    const grouped = new Map<string, RecentDropRow>();
    for (const e of entries) {
      if (filters.zones && filters.zones.size > 0 && !(e.zone && filters.zones.has(e.zone))) continue;
      if (filters.startTs != null && e.ts < filters.startTs) continue;
      if (filters.endTs != null && e.ts > filters.endTs) continue;
      for (const d of e.dropLog) {
        if (d.type === 'temporary') continue;
        const source = d.source ?? null;
        if (q && !d.name.toLowerCase().includes(q) && !(source && source.toLowerCase().includes(q))) continue;
        const key = `${e.path}|${d.name}|${source ?? ''}`;
        const absTs = e.ts + (d.elapsed ?? 0);
        const existing = grouped.get(key);
        if (existing) {
          existing.count += d.count ?? 1;
          if (absTs > existing.absTs) existing.absTs = absTs;
        } else {
          grouped.set(key, {
            absTs,
            itemId: d.itemId,
            item:   d.name,
            count:  d.count ?? 1,
            source,
            looter: d.by ?? null,
            zone:   e.zone,
            path:   e.path,
            type:   d.type,
          });
        }
      }
    }
    const out = [...grouped.values()];
    out.sort((a, b) => b.absTs - a.absTs);
    return out.slice(0, RECENT_LIMIT);
  }, [tab, entries, filters]);

  const drilldownActivity = entriesProp ? activityEntries : null;
  const contentActivityEntries = useMemo<ActivityEncounter[]>(() => {
    if (tab !== 'content') return [];
    if (drilldownActivity) return drilldownActivity;
    const lootByPath = new Map<string, LootEncounterSummary>();
    for (const e of aggResult.entries) lootByPath.set(e.path, e);
    const out: ActivityEncounter[] = [];
    for (const p of paths ?? []) {
      const kind = kindFromName(p);
      if (!kind) continue;
      const ts = fileTs(p);
      const label = labelFromName(p);
      if (kind === 'encounter') {
        out.push({ path: p, ts, kind, loot: lootByPath.get(p), label });
      } else {
        out.push({ path: p, ts, kind, label });
      }
    }
    return out;
  }, [tab, drilldownActivity, paths, aggResult.entries]);

  const contentRollups = useMemo<ContentRollup[]>(() => {
    if (tab !== 'content') return [];
    const q = (filters.query ?? '').toLowerCase();
    const matchesFilters = (e: ActivityEncounter): boolean => {
      if (filters.startTs != null && e.ts < filters.startTs) return false;
      if (filters.endTs != null && e.ts > filters.endTs) return false;
      if (filters.zones && filters.zones.size > 0) {
        if (e.loot && !(e.loot.zone && filters.zones.has(e.loot.zone))) return false;
      }
      if (q) {
        const zone = e.loot?.zone?.toLowerCase() ?? '';
        const label = e.label?.toLowerCase() ?? '';
        if (!zone.includes(q) && !label.includes(q)) {
          let hit = false;
          if (e.loot) {
            for (const k of e.loot.killLog) if (k.name?.toLowerCase().includes(q)) { hit = true; break; }
            if (!hit) for (const d of e.loot.dropLog) if (d.name?.toLowerCase().includes(q)) { hit = true; break; }
          }
          if (!hit) return false;
        }
      }
      return true;
    };
    const byId = new Map<string, ContentRollup>();
    let uncategorized: ContentRollup | null = null;
    for (const e of contentActivityEntries) {
      if (!matchesFilters(e)) continue;
      const def = classify({
        kind: e.kind,
        zoneId: e.loot?.zoneId ?? null,
        zoneName: e.loot?.zone ?? null,
        mobNames: e.loot ? mobNamesFromLootSummary(e.loot) : new Set<string>(),
        itemNames: e.loot ? itemNamesFromLootSummary(e.loot) : new Set<string>(),
        sheolType: e.sheolType,
      });
      const target = (() => {
        if (def) {
          const existing = byId.get(def.id);
          if (existing) return existing;
          const fresh: ContentRollup = { def, runs: 0, kills: 0, drops: 0, firstTs: null, lastTs: null, lootEntries: [], hasContentModuleEntries: false };
          byId.set(def.id, fresh);
          return fresh;
        }
        if (!uncategorized) {
          uncategorized = { def: null, runs: 0, kills: 0, drops: 0, firstTs: null, lastTs: null, lootEntries: [], hasContentModuleEntries: false };
        }
        return uncategorized;
      })();
      target.runs += 1;
      if (e.loot) {
        target.kills += e.loot.killLog.length;
        for (const d of e.loot.dropLog) target.drops += d.count ?? 1;
        target.lootEntries.push(e.loot);
      } else {
        target.hasContentModuleEntries = true;
      }
      target.firstTs = target.firstTs == null ? e.ts : Math.min(target.firstTs, e.ts);
      target.lastTs  = target.lastTs  == null ? e.ts : Math.max(target.lastTs,  e.ts);
    }
    // Walk registry order for deterministic display; uncategorized last.
    const out: ContentRollup[] = [];
    for (const def of CONTENT_REGISTRY) {
      const r = byId.get(def.id);
      if (r) out.push(r);
    }
    if (uncategorized) out.push(uncategorized);
    return out;
  }, [tab, contentActivityEntries, filters]);

  const toggleZone = (z: string) => setSelectedZones(prev => {
    const next = new Set(prev);
    if (next.has(z)) next.delete(z); else next.add(z);
    return next;
  });

  return (
    <div className="ff-view space-y-4">
      <div className="flex items-start gap-3 bg-amber-950/70 border border-amber-500/50 rounded-xl px-4 py-3 backdrop-blur-sm">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5 text-amber-300">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <p className="text-sm text-amber-100 leading-relaxed font-medium">
          Drop rates are based on captured kills only. Accuracy improves with sample size. Per-mob breakdowns require pool drops.
        </p>
      </div>

      <div className="bg-row-even border border-white/10 rounded-xl overflow-hidden">
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setTab('recent')}
            className={`relative flex-1 min-w-0 flex items-center justify-center px-3 py-2.5 text-sm font-medium transition-colors ${tab === 'recent' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
          >
            Recent {tab === 'recent' && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
          <button
            onClick={() => setTab('mobs')}
            className={`relative flex-1 min-w-0 flex items-center justify-center px-3 py-2.5 text-sm font-medium transition-colors ${tab === 'mobs' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
          >
            By Enemy {tab === 'mobs' && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
          <button
            onClick={() => setTab('items')}
            className={`relative flex-1 min-w-0 flex items-center justify-center px-3 py-2.5 text-sm font-medium transition-colors ${tab === 'items' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
          >
            By Item {tab === 'items' && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
          <button
            onClick={() => setTab('content')}
            className={`relative flex-1 min-w-0 flex items-center justify-center px-3 py-2.5 text-sm font-medium transition-colors ${tab === 'content' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
          >
            By Content {tab === 'content' && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        </div>
        <div className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold block mb-1">Search</label>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={tab === 'recent' || tab === 'items' ? 'item or source mob…' : 'mob or item name…'}
              className="w-full bg-panel-alt/70 border border-white/10 rounded px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-500 outline-none focus:border-accent/50"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold block mb-1">From</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="bg-panel-alt/70 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-accent/50"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold block mb-1">To</label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="bg-panel-alt/70 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200 outline-none focus:border-accent/50"
            />
          </div>
          {(query || startDate || endDate || selectedZones.size > 0) && (
            <button
              onClick={() => { setQuery(''); setStartDate(''); setEndDate(''); setSelectedZones(new Set()); }}
              className="text-xs text-gray-400 hover:text-accent transition-colors px-2 py-1.5"
            >
              Clear all
            </button>
          )}
        </div>
        <ZoneChips
          zones={zones}
          selected={selectedZones}
          onToggle={toggleZone}
          onClear={() => setSelectedZones(new Set())}
        />
        {(tab === 'mobs' || tab === 'items') && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mr-1">Scope</span>
            {([
              { id: '30d' as const, label: 'Last 30 days' },
              { id: '90d' as const, label: 'Last 90 days' },
              { id: 'all' as const, label: 'All time' },
            ]).map(opt => (
              <button
                key={opt.id}
                onClick={() => setScope(opt.id)}
                data-tooltip={opt.id === 'all' ? 'Loads every encounter into memory - heaviest option' : 'Limits the aggregation to encounters within this window'}
                className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                  scope === opt.id
                    ? 'bg-accent/20 border-accent/50 text-accent font-semibold'
                    : 'border-white/10 text-gray-400 hover:bg-white/[0.05]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────
          Single LootTable wrapper per tab so every row reads as part of one
          panel (was: each row had its own rounded-xl card, creating a stack
          of disconnected tiles). MobRow / ItemRow / ContentRow are
          chrome-free; LootTable provides the panel + dividers. */}
      <div key={`${tab}|${tabIsAgg && !entriesProp && aggResult.loading ? 'loading' : 'ready'}`} className="ff-view">
      {tabIsAgg && !entriesProp && aggResult.loading ? (
        <div className="min-h-[60vh] flex items-center justify-center">
          <LoadingScreen fill={false} hideQuote caption="loading loot data" />
        </div>
      ) : (tab === 'content' ? contentActivityEntries.length === 0 : entries.length === 0) ? (
        <div className="bg-row-even border border-white/10 rounded-xl p-12 text-center text-sm text-gray-500">
          No encounter data yet. Track a fight in-game (Encounter or Zone mode) and a record will appear here.
        </div>
      ) : tab === 'recent' ? (
        recentDrops.length === 0 ? (
          <div className="bg-row-even border border-white/10 rounded-xl p-8 text-center text-sm text-gray-500">
            No drops match the current filters.
          </div>
        ) : (
          <LootTable>{recentDrops.map((r, i) => <RecentRow key={`${r.path}|${r.absTs}|${r.item}|${i}`} row={r} onOpen={onOpen} />)}</LootTable>
        )
      ) : tab === 'content' ? (
        contentRollups.length === 0 ? (
          <div className="bg-row-even border border-white/10 rounded-xl p-8 text-center text-sm text-gray-500">
            No content matched the current filters.
          </div>
        ) : (
          <LootTable>
            {contentRollups.map(r => (
              <ContentRow key={r.def?.id ?? '__uncategorized__'} rollup={r} onOpen={onOpen} />
            ))}
          </LootTable>
        )
      ) : !catalog ? (
        <div className="min-h-[320px]" />
      ) : tab === 'mobs' ? (
        catalog.mobs.length === 0 ? (
          <div className="bg-row-even border border-white/10 rounded-xl p-8 text-center text-sm text-gray-500">
            No enemies matched the current filters.
          </div>
        ) : (
          <LootTable>{catalog.mobs.map(m => <MobRow key={m.mob} stats={m} onOpen={onOpen} />)}</LootTable>
        )
      ) : (
        catalog.items.length === 0 ? (
          <div className="bg-row-even border border-white/10 rounded-xl p-8 text-center text-sm text-gray-500">
            No items matched the current filters.
          </div>
        ) : (
          <LootTable>{catalog.items.map(i => <ItemRow key={i.item} stats={i} onOpen={onOpen} />)}</LootTable>
        )
      )}
      </div>
    </div>
  );
}
