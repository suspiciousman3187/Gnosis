
import { useMemo, useState } from 'react';
import LootView from './LootView';
import {
  aggregateActivities,
  encountersForActivity,
  type ActivityEncounter, type ActivityRollup, type ActivitiesCatalog,
} from '@/lib/contentAggregator';
import ItemIcon from '@/components/ItemIcon';

type DrillTab = 'overview' | 'loot' | 'runs';

const fmtDur = (s: number) => {
  if (s <= 0) return '-';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};
const fmtDate = (ts: number | null) => ts == null || ts === 0
  ? '-'
  : new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fmtRelative = (ts: number | null) => {
  if (ts == null || ts === 0) return '-';
  const diff = Date.now() / 1000 - ts;
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(ts);
};

interface Props {
  entries: ActivityEncounter[];
  onOpenRun: (path: string) => void;
  labelOf: (path: string) => string;
}

export default function ActivitiesView({ entries, onOpenRun, labelOf }: Props) {
  const catalog = useMemo(() => aggregateActivities(entries), [entries]);
  const [selected, setSelected] = useState<string | null>(null);
  const active = selected ? catalog.rollups.find(r => r.def.id === selected) ?? null : null;

  if (active) {
    return (
      <ActivityDrillDown
        rollup={active}
        catalog={catalog}
        onBack={() => setSelected(null)}
        onOpenRun={onOpenRun}
        labelOf={labelOf}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[11px] text-gray-500">
          {catalog.rollups.length} activit{catalog.rollups.length === 1 ? 'y' : 'ies'} tracked
          {catalog.earliestTs && catalog.latestTs && (
            <> · since {fmtDate(catalog.earliestTs)}</>
          )}
          {catalog.uncategorized.length > 0 && (
            <> · {catalog.uncategorized.length} uncategorized</>
          )}
        </span>
      </div>

      {catalog.rollups.length === 0 ? (
        <div className="bg-row-even border border-white/10 rounded-xl p-12 text-center text-sm text-gray-500">
          <p className="mb-2">No recognized activities yet.</p>
          <p className="text-[11px]">
            Activities recognized in v1: Sortie, Omen, Sheol A/B/C. Other content
            falls into the Library until its registry entry is added.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {catalog.rollups.map(r => (
            <ActivityTile key={r.def.id} rollup={r} onClick={() => setSelected(r.def.id)} />
          ))}
        </div>
      )}

      {catalog.uncategorized.length > 0 && (
        <div className="bg-row-even border border-white/10 rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-sm font-semibold text-gray-300">Uncategorized</h3>
            <span className="text-[10px] text-gray-500">
              {catalog.uncategorized.length} encounter{catalog.uncategorized.length === 1 ? '' : 's'} that didn&apos;t match any registered activity
            </span>
          </div>
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Generic-tracker zones (Bibiki Bay, Ru&apos;Aun, etc.) and any
            content type not yet in the registry land here. Add new content
            types by editing <span className="font-mono">web/lib/contentRegistry.ts</span>.
          </p>
        </div>
      )}

      <p className="text-[10px] text-gray-500 italic px-1">
        v1 scope: per-Activity tiles + drill-down. Sortie / Sheol / Limbus / Ambuscade
        reports show counts + last-run only - full per-boss loot tracking for those
        kinds arrives when content modules switch to the universal drop log.
      </p>
    </div>
  );
}

function ActivityTile({ rollup, onClick }: { rollup: ActivityRollup; onClick: () => void }) {
  const { def, runCount, totalSeconds, notableBossesSeen, notableBossesTotal, lastRunTs } = rollup;
  const completion = notableBossesTotal > 0
    ? `${notableBossesSeen}/${notableBossesTotal} Bosses Defeated`
    : null;
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-stretch bg-row-even border border-white/10 rounded-xl p-4 text-left hover:bg-white/[0.03] hover:border-accent/40 transition-colors group"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-bold text-base text-white group-hover:text-accent transition-colors">{def.name}</h3>
          {def.shortDescription && (
            <p className="text-[10px] text-gray-500">{def.shortDescription}</p>
          )}
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600 shrink-0 mt-1"><path d="M9 6l6 6-6 6" /></svg>
      </div>

      <div className="space-y-1.5 text-xs">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-amber-300 text-base font-bold">{runCount}</span>
          <span className="text-gray-500">{runCount === 1 ? 'run' : 'runs'} total</span>
          {totalSeconds > 0 && <span className="text-gray-500">· {fmtDur(totalSeconds)} time spent</span>}
        </div>
        {completion && (
          <div className="text-[11px] text-gray-400">{completion}</div>
        )}
        {lastRunTs > 0 && (
          <div className="text-[10px] text-gray-500">last run {fmtRelative(lastRunTs)}</div>
        )}
      </div>
    </button>
  );
}

// ── Drill-down ───────────────────────────────────────────────────────────────
function ActivityDrillDown({
  rollup, catalog, onBack, onOpenRun, labelOf,
}: {
  rollup: ActivityRollup;
  catalog: ActivitiesCatalog;
  onBack: () => void;
  onOpenRun: (path: string) => void;
  labelOf: (path: string) => string;
}) {
  const [tab, setTab] = useState<DrillTab>('overview');
  const encounters = encountersForActivity(catalog, rollup.def.id);
  const lootEntries = encounters
    .map(e => e.loot)
    .filter((x): x is NonNullable<typeof x> => !!x);

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-accent transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        All activities
      </button>

      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-accent">{rollup.def.name}</h2>
          {rollup.def.shortDescription && (
            <p className="text-[11px] text-gray-500">{rollup.def.shortDescription}</p>
          )}
        </div>
        <div className="text-[11px] text-gray-500 text-right">
          <div>{rollup.runCount} run{rollup.runCount === 1 ? '' : 's'} · {fmtDur(rollup.totalSeconds)} tracked</div>
          {rollup.lastRunTs > 0 && (
            <div>last run {fmtRelative(rollup.lastRunTs)}</div>
          )}
        </div>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div className="flex bg-row-even border border-white/10 rounded-xl">
        <TabBtn id="overview" label="Overview"          tab={tab} setTab={setTab} />
        <TabBtn id="loot"     label={`Loot (${lootEntries.length})`} tab={tab} setTab={setTab} />
        <TabBtn id="runs"     label={`Runs (${encounters.length})`}  tab={tab} setTab={setTab} />
      </div>

      {tab === 'overview' && <OverviewTab rollup={rollup} />}
      {tab === 'loot' && (
        lootEntries.length === 0 ? (
          <div className="bg-row-even border border-white/10 rounded-xl p-8 text-center text-sm text-gray-500">
            <p className="mb-1">No drops captured for this activity yet.</p>
            <p className="text-[11px]">
              Once a run for this activity is recorded with the tracker, its
              drops will appear here.
            </p>
          </div>
        ) : (
          <LootView entries={lootEntries} activityEntries={encounters} />
        )
      )}
      {tab === 'runs' && (
        <RunsTab encounters={encounters} onOpenRun={onOpenRun} labelOf={labelOf} dotClass={CONTENT_COLOR_PALETTE[rollup.def.color].dot} />
      )}
    </div>
  );
}

function TabBtn({ id, label, tab, setTab }: {
  id: DrillTab; label: string; tab: DrillTab; setTab: (t: DrillTab) => void;
}) {
  const on = id === tab;
  return (
    <button
      onClick={() => setTab(id)}
      className={`relative flex-1 min-w-0 flex items-center justify-center px-3 py-2.5 text-sm font-medium transition-colors ${
        on ? 'text-accent' : 'text-gray-400 hover:text-white'
      }`}
    >
      {label}
      {on && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />}
    </button>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────
function OverviewTab({ rollup }: { rollup: ActivityRollup }) {
  const { def, runCount, totalSeconds, firstRunTs, lastRunTs, notableBossesSeen, notableBossesTotal, topDrops, encounters } = rollup;
  const avgRunSec = runCount > 0 && totalSeconds > 0 ? totalSeconds / runCount : 0;
  // Notable-boss roster with per-boss seen status - drives the completion grid.
  const seenSet = new Set<string>();
  for (const e of encounters) {
    if (!e.loot) continue;
    for (const k of e.loot.killLog) seenSet.add(k.name);
    for (const en of e.loot.enemies) seenSet.add(en.name);
  }
  const notable = def.bosses.filter(b => b.notable);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Runs" value={runCount.toLocaleString()} />
        <Stat label="Time Tracked" value={fmtDur(totalSeconds)} />
        <Stat label="Avg / Run" value={fmtDur(Math.round(avgRunSec))} />
        <Stat label="Bosses Lifetime" value={notableBossesTotal > 0 ? `${notableBossesSeen}/${notableBossesTotal}` : '-'} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-row-even border border-white/10 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Timeline</h3>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">First run</span>
              <span className="font-mono text-gray-300">{fmtDate(firstRunTs)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Most recent</span>
              <span className="font-mono text-gray-300">{fmtDate(lastRunTs)} ({fmtRelative(lastRunTs)})</span>
            </div>
          </div>
        </div>

        <div className="bg-row-even border border-white/10 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Top Drops</h3>
          {topDrops.length === 0 ? (
            <p className="text-[11px] text-gray-500 italic">No drops captured yet.</p>
          ) : (
            <div className="space-y-1">
              {topDrops.map(d => (
                <div key={d.item} className="flex items-center gap-2 text-xs">
                  <ItemIcon id={d.itemId} name={d.item} size={16} nameClass="text-lime-200 truncate" />
                  <span className="ml-auto text-gray-500 font-mono shrink-0">×{d.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {notable.length > 0 && (
        <div className="bg-row-even border border-white/10 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Boss Roster</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {notable.map(b => {
              const seen = seenSet.has(b.name);
              return (
                <div
                  key={b.name}
                  className={`px-2.5 py-1.5 rounded border text-xs font-medium ${
                    seen
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200'
                      : 'bg-panel-alt/40 border-white/10 text-gray-500'
                  }`}
                >
                  <span className={seen ? '' : 'line-through'}>{b.name}</span>
                  {b.category === 'final' && (
                    <span className="ml-1 text-[10px] uppercase opacity-60">final</span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-500 italic mt-3">
            Bosses you&apos;ve seen in kill / enemy logs. Sortie / Sheol /
            Limbus / Ambuscade runs now feed this list via their saved kill
            log; runs recorded before that change may still appear unmarked.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-4">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="font-bold text-2xl text-amber-300 leading-none">{value}</div>
    </div>
  );
}

// ── Runs tab ─────────────────────────────────────────────────────────────────
function RunsTab({
  encounters, onOpenRun, labelOf, dotClass,
}: {
  encounters: ActivityEncounter[];
  onOpenRun: (path: string) => void;
  labelOf: (path: string) => string;
  dotClass: string;
}) {
  const sorted = useMemo(
    () => [...encounters].sort((a, b) => b.ts - a.ts),
    [encounters],
  );
  if (sorted.length === 0) {
    return (
      <div className="bg-row-even border border-white/10 rounded-xl p-8 text-center text-sm text-gray-500">
        No runs recorded for this activity yet.
      </div>
    );
  }
  return (
    <div className="bg-row-even border border-white/10 rounded-xl overflow-hidden divide-y divide-white/[0.06]">
      {sorted.map((e, i) => (
        <button
          key={e.path}
          onClick={() => onOpenRun(e.path)}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.03] transition-colors"
        >
          <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
          <span className="text-sm text-gray-200 truncate flex-1">{labelOf(e.path)}</span>
          {e.loot?.zone && (
            <span className="text-[11px] text-gray-500 truncate hidden sm:inline">{e.loot.zone}</span>
          )}
          {e.loot && e.loot.durationSeconds > 0 && (
            <span className="text-[11px] text-gray-500 font-mono shrink-0">{fmtDur(e.loot.durationSeconds)}</span>
          )}
          <span className="text-[10px] text-gray-500 font-mono shrink-0">
            {new Date(e.ts * 1000).toLocaleDateString()}
          </span>
        </button>
      ))}
    </div>
  );
}

import { CONTENT_COLOR_PALETTE } from '@/lib/contentRegistry';
