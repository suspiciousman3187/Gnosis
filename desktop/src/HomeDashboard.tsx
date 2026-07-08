
import { useMemo, useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { inTauri } from './library';
import type { EncSummary } from './App';
import type { Section } from './NavRail';
import type { BoxState } from './multibox';
import { useBoxes } from './multibox';
import type { ActivityEncounter } from '@/lib/contentAggregator';
import type { LootEncounterSummary } from '@/lib/dropAggregator';
import { classify, mobNamesFromLootSummary, itemNamesFromLootSummary, CONTENT_REGISTRY, contentById, type ContentDef } from '@/lib/contentRegistry';
import { kindFromName, labelFromName, fileTs, groupMultiboxPaths, representativeLootSummaries, buildKillCounts } from './content';
import ItemIcon from '@/components/ItemIcon';
import JobIcon from '@/components/JobIcon';
import UpdateBanner from './UpdateBanner';

// ── Time helpers ─────────────────────────────────────────────────────────────

/** Calendar-day boundaries the user explicitly chose. `today` = midnight
 *  local time; we lock this in once per render so all card math agrees. */
function dayBoundaries() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  const yesterdayStart = todayStart - 86400;
  const weekStart = todayStart - 6 * 86400;            // last 7 days incl. today
  return { todayStart, yesterdayStart, weekStart, nowSec: Math.floor(Date.now() / 1000) };
}

const fmtDur = (s: number) => {
  if (s <= 0) return '-';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};
const fmtRelative = (ts: number | null) => {
  if (ts == null || ts === 0) return '-';
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// ── Streak math ──────────────────────────────────────────────────────────────

/** "Any saved run" streak - walks backwards day-by-day from today, breaks
 *  at the first day with zero entries. Matches the user's pick. */
function activeStreak(allTs: number[]): number {
  if (allTs.length === 0) return 0;
  // Bucket every run's timestamp into a YYYY-MM-DD key. Use local time.
  const days = new Set<string>();
  for (const ts of allTs) {
    const d = new Date(ts * 1000);
    days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  // Allow the streak to skip a day only if TODAY itself has no runs -
  // walking from today, if today is empty we still let yesterday start it.
  let allowMissingFirst = true;
  while (true) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;
    if (days.has(key)) { streak++; allowMissingFirst = false; }
    else if (allowMissingFirst) { allowMissingFirst = false; }
    else break;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ── Cards ────────────────────────────────────────────────────────────────────

type GroupedPath = ReturnType<typeof groupMultiboxPaths>[number];

export type HomeData = {
  todayKpis: { encounterCount: number; timeTracked: number; drops: number; streak: number };
  recentGroups: GroupedPath[];
  todayDrops: { all: DropRow[]; notable: DropRow[] };
  recentEnemies: { name: string; path: string; ts: number; kills: number }[];
  todayStart: number;
  yesterdayStart: number;
  weekStart: number;
  nowSec: number;
};

export function computeHomeData(
  paths: string[],
  encSummaries: Record<string, EncSummary>,
  lootSummaries: Record<string, LootEncounterSummary>,
  views?: { id: string; members: string[]; boundaries?: number[] }[],
): HomeData {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  const yesterdayStart = todayStart - 86400;
  const weekStart = todayStart - 6 * 86400;
  const nowSec = Math.floor(Date.now() / 1000);

  const reps = representativeLootSummaries(Object.values(lootSummaries));
  const repPaths = new Set(reps.map(r => r.path));
  let encounterCount = 0, timeTracked = 0, drops = 0;
  const allTs: number[] = [];
  for (const p of paths) {
    const startTs = fileTs(p);
    allTs.push(startTs);
    const s = lootSummaries[p];
    if (s && !repPaths.has(p)) continue;
    const endTs = s ? startTs + (s.durationSeconds || 0) : startTs;
    if (endTs < todayStart) continue;
    encounterCount += 1;
    if (s) {
      timeTracked += s.durationSeconds || 0;
      for (const d of s.dropLog) drops += d.count ?? 1;
    }
  }

  const sortedPaths = [...paths].sort((a, b) => fileTs(b) - fileTs(a));
  const recentGroups = groupMultiboxPaths(sortedPaths, encSummaries, views).slice(0, 8);

  const flagged = new Set<string>();
  for (const def of CONTENT_REGISTRY) for (const h of def.highlightDrops ?? []) flagged.add(h);
  const allDrops = collectDropRows(lootSummaries, todayStart);
  const notableDrops = allDrops.filter(r => flagged.has(r.itemName));

  const killCounts = buildKillCounts(lootSummaries);
  const byEnemy = new Map<string, { path: string; ts: number }>();
  for (const p of sortedPaths) {
    if (kindFromName(p) !== 'encounter') continue;
    const enc = encSummaries[p];
    if (!enc?.enemyNames?.length) continue;
    const ts = fileTs(p);
    for (const name of enc.enemyNames) {
      if (!name) continue;
      if (byEnemy.has(name)) continue;
      byEnemy.set(name, { path: p, ts });
    }
  }
  const recentEnemies = [...byEnemy.entries()]
    .sort((a, b) => b[1].ts - a[1].ts)
    .slice(0, 12)
    .map(([name, info]) => ({ name, ...info, kills: killCounts.get(name)?.total ?? 0 }));

  return {
    todayKpis: { encounterCount, timeTracked, drops, streak: activeStreak(allTs) },
    recentGroups,
    todayDrops: { all: allDrops, notable: notableDrops },
    recentEnemies,
    todayStart, yesterdayStart, weekStart, nowSec,
  };
}

interface Props {
  paths: string[];
  encSummaries: Record<string, EncSummary>;
  lootSummaries: Record<string, LootEncounterSummary>;
  activityEntries: ActivityEncounter[];
  views?: { id: string; members: string[]; boundaries?: number[] }[];
  onOpenRun: (path: string) => void;
  onNavigate: (section: Section) => void;
  dataDir: string;
}

export default function HomeDashboard(props: Props) {
  const boxes = useBoxes();
  const homeData = useMemo(
    () => computeHomeData(props.paths, props.encSummaries, props.lootSummaries, props.views),
    [props.paths, props.encSummaries, props.lootSummaries, props.views],
  );
  const { todayKpis, recentGroups, todayDrops, recentEnemies, nowSec } = homeData;

  useEffect(() => {
    const HOME_LOOKBACK_SEC = 14 * 86400;
    const HOME_LOOT_CAP = 50;
    const cutoff = Math.floor(Date.now() / 1000) - HOME_LOOKBACK_SEC;
    const recent = props.paths.filter(p => fileTs(p) >= cutoff);
    if (recent.length === 0) return;
    const lootSlice = recent
      .slice()
      .sort((a, b) => fileTs(b) - fileTs(a))
      .slice(0, HOME_LOOT_CAP);
    void import('./summaryStore').then(m => {
      m.requestSummaries(recent);
      m.requestLoots(lootSlice);
    });
  }, [props.paths]);

  return (
    <div className="space-y-4">
      <UpdateBanner dataDir={props.dataDir} />
      <TodayKpis stats={todayKpis} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ConnectedCharactersCard boxes={boxes} nowSec={nowSec} />
        <RecentRunsCard recent={recentGroups} encSummaries={props.encSummaries} onOpenRun={props.onOpenRun} onNavigate={props.onNavigate} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopDropsTodayCard slices={todayDrops} onOpenRun={props.onOpenRun} />
        <RecentEnemiesCard rows={recentEnemies} onOpenRun={props.onOpenRun} />
      </div>
    </div>
  );
}

function TodayKpis({ stats }: { stats: HomeData['todayKpis'] }) {
  return (
    <div className="bg-row-even border border-white/10 rounded-xl grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-white/10 overflow-hidden">
      <Kpi label="Encounters today" value={stats.encounterCount.toLocaleString()} tone="amber" />
      <Kpi label="Time tracked" value={fmtDur(stats.timeTracked)} tone="amber" />
      <Kpi label="Drops today" value={stats.drops.toLocaleString()} tone="lime" />
      <Kpi label="Active streak" value={`${stats.streak}d`} tone={stats.streak > 0 ? 'emerald' : 'gray'} />
    </div>
  );
}

function Kpi({ label, value, tone, subtle }: { label: string; value: string; tone: 'amber'|'lime'|'emerald'|'gray'; subtle?: string }) {
  const c = {
    amber:   'text-amber-300',
    lime:    'text-lime-300',
    emerald: 'text-emerald-300',
    gray:    'text-gray-400',
  }[tone];
  return (
    <div className="p-4">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className={`font-bold text-2xl leading-none ${c}`}>{value}</div>
      {subtle && <div className="text-[10px] text-gray-600 mt-1">{subtle}</div>}
    </div>
  );
}

function ConnectedCharactersCard({ boxes, nowSec }: { boxes: BoxState[]; nowSec: number }) {
  const LIVE_FRESH_MS = 5000;
  const [ipcBound, setIpcBound] = useState<boolean | null>(null);
  useEffect(() => {
    if (!inTauri) { setIpcBound(true); return; }
    let cancelled = false;
    const check = () => { invoke<boolean>('ipc_bound').then(v => { if (!cancelled) setIpcBound(v); }).catch(() => { if (!cancelled) setIpcBound(null); }); };
    check();
    const id = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  return (
    <Card title="Connected Characters" right={`${boxes.length} ${boxes.length === 1 ? 'character' : 'characters'}`}>
      {ipcBound === false && (
        <div className="mb-2 px-2.5 py-1.5 rounded border border-rose-500/40 bg-rose-500/10 text-[11px] text-rose-200">
          <span className="font-semibold">IPC port 24199 in use.</span>{' '}
          Another Gnosis is already running. Close every other <code className="font-mono">Gnosis.exe</code> / <code className="font-mono">app.exe</code> in Task Manager, then relaunch this build.
        </div>
      )}
      {boxes.length === 0 ? (
        <p className="text-xs text-gray-500 italic">
          No characters connected. Load Gnosis in-game to see them here.
        </p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-[9px] uppercase tracking-wider text-gray-600">
            <tr>
              <th className="text-left font-semibold pb-1.5 pl-2">Character</th>
              <th className="text-left font-semibold pb-1.5">Job</th>
              <th className="text-left font-semibold pb-1.5">Zone</th>
              <th className="text-right font-semibold pb-1.5 pr-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {boxes.map((b, i) => {
              const s = b.self;
              if (!s) return null;
              const live = b.live?.recording === true && b.liveAt > 0 && (nowSec * 1000 - b.liveAt) < LIVE_FRESH_MS;
              const mainTxt = s.main ? `${s.main}${s.mainLvl ? s.mainLvl : ''}` : '-';
              const subTxt  = s.sub  ? `/${s.sub}${s.subLvl ? s.subLvl : ''}` : '';
              return (
                <tr
                  key={b.conn}
                  className="border-t border-white/[0.05] hover:bg-white/[0.03]"
                >
                  <td className="py-1.5 pl-2">
                    <div className="flex items-center gap-2">
                      <JobIcon job={s.main ?? null} size={24} />
                      <span className="font-medium text-gray-200 truncate">{s.name}</span>
                    </div>
                  </td>
                  <td className="py-1.5">
                    <span className="font-mono text-gray-300">{mainTxt}</span>
                    <span className="font-mono text-gray-500">{subTxt}</span>
                  </td>
                  <td className="py-1.5 text-gray-400 truncate max-w-[14rem]">
                    {s.zoneName || '-'}
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`} />
                      <span className={live ? 'text-emerald-300 font-medium' : 'text-gray-500'}>
                        {live ? 'In combat' : 'Idle'}
                      </span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── Activity Snapshot ──────────────────────────────────────────────────────
function ActivitySnapshotCard({
  entries, todayStart, yesterdayStart, weekStart, onNavigate,
}: {
  entries: ActivityEncounter[];
  todayStart: number; yesterdayStart: number; weekStart: number;
  onNavigate: (section: Section) => void;
}) {
  // Count runs per Activity over the three windows. Re-runs the classifier
  // on each entry - cheap (constant-time per registry walk).
  const rows = useMemo(() => {
    const counts = new Map<string, { today: number; yesterday: number; week: number }>();
    for (const e of entries) {
      const input = {
        kind: e.kind,
        zoneId: e.loot?.zoneId ?? null,
        zoneName: e.loot?.zone ?? null,
        mobNames: e.loot ? mobNamesFromLootSummary(e.loot) : new Set<string>(),
        itemNames: e.loot ? itemNamesFromLootSummary(e.loot) : new Set<string>(),
        sheolType: e.sheolType,
      };
      const def = classify(input);
      if (!def) continue;
      const row = counts.get(def.id) ?? { today: 0, yesterday: 0, week: 0 };
      if (e.ts >= todayStart) row.today += 1;
      else if (e.ts >= yesterdayStart) row.yesterday += 1;
      if (e.ts >= weekStart) row.week += 1;
      counts.set(def.id, row);
    }
    const out: { def: ContentDef; today: number; yesterday: number; week: number }[] = [];
    // Walk registry order so display is deterministic regardless of activity.
    for (const def of CONTENT_REGISTRY) {
      const row = counts.get(def.id);
      if (!row || (row.today === 0 && row.yesterday === 0 && row.week === 0)) continue;
      out.push({ def, ...row });
    }
    return out;
  }, [entries, todayStart, yesterdayStart, weekStart]);

  return (
    <Card
      title="Activity Snapshot"
      right={
        <button
          onClick={() => onNavigate('activities')}
          className="text-[10px] text-accent hover:text-white transition-colors uppercase tracking-wide"
        >
          all activities →
        </button>
      }
    >
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500 italic">No activities run in the past week.</p>
      ) : (
        <div className="space-y-1">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-[9px] uppercase tracking-wider text-gray-600 px-2 pb-1">
            <span>Activity</span>
            <span className="text-right w-12">Today</span>
            <span className="text-right w-14">Yest.</span>
            <span className="text-right w-12">7d</span>
          </div>
          {rows.map(r => (
            <button
              key={r.def.id}
              onClick={() => onNavigate('activities')}
              className="w-full grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center text-xs py-1.5 px-2 rounded hover:bg-white/[0.03] text-left"
            >
              <span className="text-gray-200 font-medium truncate">{r.def.name}</span>
              <span className={`text-right w-12 font-mono ${r.today > 0 ? 'text-amber-300' : 'text-gray-600'}`}>{r.today}</span>
              <span className={`text-right w-14 font-mono ${r.yesterday > 0 ? 'text-gray-300' : 'text-gray-600'}`}>{r.yesterday}</span>
              <span className={`text-right w-12 font-mono ${r.week > 0 ? 'text-gray-400' : 'text-gray-600'}`}>{r.week}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function RecentRunsCard({ recent, encSummaries, onOpenRun, onNavigate }: {
  recent: GroupedPath[];
  encSummaries: Record<string, EncSummary>;
  onOpenRun: (path: string) => void;
  onNavigate: (section: Section) => void;
}) {
  return (
    <Card
      title="Recent Encounters"
      right={
        <button
          onClick={() => onNavigate('history')}
          className="text-[10px] text-accent hover:text-white transition-colors uppercase tracking-wide"
        >
          full history →
        </button>
      }
    >
      {recent.length === 0 ? (
        <p className="text-xs text-gray-500 italic">No encounters recorded yet.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-[9px] uppercase tracking-wider text-gray-600">
            <tr>
              <th className="text-left font-semibold pb-1.5 pl-2">Zone</th>
              <th className="text-right font-semibold pb-1.5">Time Spent</th>
              <th className="text-right font-semibold pb-1.5 pr-2">Recorded</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((g, i) => {
              const p = g.rep;
              const kind = kindFromName(p)!;
              const enc = encSummaries[p];
              const zones = enc?.zones ?? (enc?.zone ? [enc.zone] : []);
              const title = kind === 'encounter'
                ? (zones.length > 0 ? zones.join(' + ') : '…')
                : labelFromName(p);
              const ts = fileTs(p);
              const absDate = new Date(ts * 1000).toLocaleString();
              const multibox = g.members.length > 1;
              return (
                <tr
                  key={g.id}
                  onClick={() => onOpenRun(p)}
                  className="border-t border-white/[0.05] hover:bg-white/[0.03] cursor-pointer"
                >
                  <td className="py-1.5 pl-2">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotColorFor(enc?.contentDefId ? enc.contentDefId : (enc?.source && enc.source !== 'generic' ? enc.source : kind))}`} />
                      <span className="text-gray-200 font-medium truncate">{title}</span>
                      {multibox && (
                        <span
                          data-tooltip={g.chars.join(', ')}
                          className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded bg-accent/20 text-accent leading-none"
                        >
                          {g.members.length}×
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-1.5 text-right font-mono text-gray-400 shrink-0">
                    {enc?.dur ? fmtDur(enc.dur) : '-'}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono text-gray-500" title={absDate}>
                    {fmtRelative(ts)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

import { ADDON_SOURCE_COLOR, CONTENT_COLOR_PALETTE, type ContentColorKey } from '@/lib/contentRegistry';
import type { EncounterSource } from '@/lib/encounter';

function dotColorFor(sourceOrKind: string): string {
  const def = contentById(sourceOrKind);
  if (def) return CONTENT_COLOR_PALETTE[def.color].dot;
  const key = ADDON_SOURCE_COLOR[sourceOrKind as EncounterSource] as ContentColorKey | null | undefined;
  if (key) return CONTENT_COLOR_PALETTE[key].dot;
  return 'bg-slate-400';
}


type DropRow = {
  key: string;
  path: string;
  itemName: string;
  itemId?: number;
  count: number;
  zone: string;
  ts: number;       // absolute unix seconds (when the drop landed in real time)
};

function collectDropRows(
  lootSummaries: Record<string, LootEncounterSummary>,
  fromTs: number,
  filterByName?: Set<string>,
): DropRow[] {
  const groups = new Map<string, DropRow>();
  const reps = representativeLootSummaries(Object.values(lootSummaries));
  for (const s of reps) {
    // End-time gate - same rule as TodayKpis. An encounter that crossed the
    // window boundary still counts if it ENDED in-window.
    if ((s.ts + (s.durationSeconds || 0)) < fromTs) continue;
    for (const d of s.dropLog) {
      if (!d.name) continue;
      if (filterByName && !filterByName.has(d.name)) continue;
      const key = `${s.path}|${d.name}`;
      let row = groups.get(key);
      if (!row) {
        row = {
          key,
          path: s.path,
          itemName: d.name,
          itemId: d.itemId,
          count: 0,
          zone: s.zone ?? '-',
          ts: 0,
        };
        groups.set(key, row);
      }
      row.count += d.count ?? 1;
      // Promote itemId on first non-null sighting (some drops are missing it).
      if (row.itemId == null && d.itemId != null) row.itemId = d.itemId;
      const dropTs = s.ts + d.elapsed;
      if (dropTs > row.ts) row.ts = dropTs;
    }
  }
  return [...groups.values()].sort((a, b) => b.ts - a.ts);
}

function DropTable({
  rows, cap, emptyMsg, onOpenRun,
}: {
  rows: DropRow[];
  cap?: number;
  emptyMsg: string;
  onOpenRun: (path: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-[11px] text-gray-600 italic">{emptyMsg}</p>;
  }
  const visible = cap != null ? rows.slice(0, cap) : rows;
  const overflow = rows.length - visible.length;
  return (
    <>
      <table className="w-full text-xs">
        <thead className="text-[9px] uppercase tracking-wider text-gray-600">
          <tr>
            <th className="text-left font-semibold pb-1.5 pl-2">Loot</th>
            <th className="text-right font-semibold pb-1.5">Amount</th>
            <th className="text-left font-semibold pb-1.5 pl-3">Zone</th>
            <th className="text-right font-semibold pb-1.5 pr-2">Time</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r, i) => {
            const absDate = new Date(r.ts * 1000).toLocaleString();
            return (
              <tr
                key={r.key}
                onClick={() => onOpenRun(r.path)}
                className="border-t border-white/[0.05] hover:bg-white/[0.03] cursor-pointer"
              >
                <td className="py-1.5 pl-2">
                  <ItemIcon id={r.itemId} name={r.itemName} size={18} nameClass="text-lime-200 truncate font-medium" />
                </td>
                <td className="py-1.5 text-right font-mono text-gray-300">
                  ×{r.count.toLocaleString()}
                </td>
                <td className="py-1.5 pl-3 text-gray-400 truncate max-w-[12rem]" title={r.zone}>
                  {r.zone}
                </td>
                <td className="py-1.5 pr-2 text-right font-mono text-gray-500" title={absDate}>
                  {fmtRelative(r.ts)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {overflow > 0 && (
        <p className="text-[10px] text-gray-600 italic mt-1.5 text-center">
          + {overflow.toLocaleString()} more not shown
        </p>
      )}
    </>
  );
}

function TopDropsTodayCard({
  slices, onOpenRun,
}: {
  slices: HomeData['todayDrops'];
  onOpenRun: (path: string) => void;
}) {
  const empty = slices.all.length === 0;

  return (
    <Card title="Recent Drops">
      {empty ? (
        <p className="text-xs text-gray-500 italic">
          No tracked drops today. Drops flow in from any encounter once a
          fight ends.
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <h4 className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">Notable</h4>
            <DropTable
              rows={slices.notable}
              cap={8}
              emptyMsg="No registry-flagged drops yet today."
              onOpenRun={onOpenRun}
            />
          </div>
          <div>
            <h4 className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">All Drops</h4>
            <DropTable
              rows={slices.all}
              cap={12}
              emptyMsg="No drops captured today yet."
              onOpenRun={onOpenRun}
            />
          </div>
        </div>
      )}
    </Card>
  );
}

function RecentEnemiesCard({
  rows, onOpenRun,
}: {
  rows: HomeData['recentEnemies'];
  onOpenRun: (path: string) => void;
}) {
  return (
    <Card title="Recent Enemies">
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500 italic">No enemies recorded yet.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-[9px] uppercase tracking-wider text-gray-600">
            <tr>
              <th className="text-left font-semibold pb-1.5 pl-2">Enemy</th>
              <th className="text-right font-semibold pb-1.5">Kill #</th>
              <th className="text-right font-semibold pb-1.5">Total Kills</th>
              <th className="text-right font-semibold pb-1.5 pr-2">Recorded</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const absDate = new Date(r.ts * 1000).toLocaleString();
              return (
                <tr
                  key={r.name}
                  onClick={() => onOpenRun(r.path)}
                  className="border-t border-white/[0.05] hover:bg-white/[0.03] cursor-pointer"
                  data-tooltip={`Open the encounter where ${r.name} was last fought (${absDate})${r.kills > 0 ? ` - ${r.kills} total kill${r.kills === 1 ? '' : 's'} lifetime` : ''}`}
                >
                  <td className="py-1.5 pl-2">
                    <span className="text-gray-200 font-medium truncate">{r.name}</span>
                  </td>
                  <td className="py-1.5 text-right font-mono text-accent">
                    {r.kills > 0 ? <>#{r.kills.toLocaleString()}</> : '-'}
                  </td>
                  <td className="py-1.5 text-right font-mono text-gray-300">
                    {r.kills > 0 ? r.kills.toLocaleString() : '-'}
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono text-gray-500" title={absDate}>
                    {fmtRelative(r.ts)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── Shared card chrome ─────────────────────────────────────────────────────
function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{title}</h3>
        {right && <div className="text-[10px] text-gray-500">{right}</div>}
      </div>
      {children}
    </div>
  );
}

export { contentById };
