import { Fragment, useMemo, useState } from 'react';
import { groupMultiboxPaths, kindFromName, fileTs, type PathGroup } from './content';
import RestorePanel from './RestorePanel';
import type { EncSummary } from './App';
import type { ViewEntry } from './viewManifest';

function fmtDur(s: number): string {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function fmtDateFull(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function truncList(arr: string[] | undefined, n: number): string {
  if (!arr || arr.length === 0) return 'None';
  return arr.length <= n ? arr.join(', ') : `${arr.slice(0, n).join(', ')} +${arr.length - n} more`;
}

function DeleteOverview({ g, s }: { g: PathGroup; s: EncSummary | undefined }) {
  const party = s?.playerNames ?? [];
  const jobs = s?.jobs ?? [];
  const partyList = party.length > 0 && party.length === jobs.length
    ? party.map((n, i) => `${n} (${jobs[i]})`)
    : party;
  const contentType = (s?.source && s.source !== 'generic') ? s.source : 'Generic combat';
  const meta = (label: string, value: string) => (
    <span><span className="text-gray-500">{label} </span><span className="text-gray-200 font-medium">{value}</span></span>
  );
  const tag = (label: string, value: string) => (
    <div><span className="text-[10px] uppercase tracking-wide text-gray-500 mr-1.5">{label}</span><span className="text-gray-300">{value}</span></div>
  );
  return (
    <div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
        {meta('Started', fmtDateFull(fileTs(g.rep)))}
        {meta('Duration', fmtDur(s?.dur ?? 0))}
        {meta('Damage', fmtNum(s?.metrics?.totalDamage ?? 0))}
        {meta('Enemies', String(s?.enemies ?? 0))}
        {meta('Logs', `${g.members.length} file${g.members.length === 1 ? '' : 's'}`)}
        {meta('Type', contentType)}
      </div>
      <div className="mt-2 grid gap-1 text-[11px]">
        {tag('Party', truncList(partyList, 8))}
        {tag('Foes', truncList(s?.enemyNames, 6))}
        {g.chars.length > 1 && tag('Captured By', truncList(g.chars, 8))}
        {s?.sortie && tag('Sortie', `${s.sortie.defeated} boss${s.sortie.defeated === 1 ? '' : 'es'} defeated${s.sortie.aminon ? `, Aminon ${s.sortie.aminon.killed ? 'killed' : 'reached'} (${s.sortie.aminon.mode})` : ''}`)}
      </div>
    </div>
  );
}

function isProtectedContent(rep: string, s: EncSummary | undefined): boolean {
  if (kindFromName(rep) !== 'encounter') return true;
  if (s?.contentDefId) return true;
  if (s?.source && s.source !== 'generic') return true;
  return false;
}

function zoneLabel(s: EncSummary | undefined): string {
  if (!s) return '…';
  if (s.zones?.length) return s.zones.join(' + ');
  return s.zone ?? '…';
}

type SortKey = 'oldest' | 'newest' | 'shortest' | 'leastDmg';

type Filters = {
  useDuration: boolean; durMax: number;
  useDamage: boolean; dmgMax: number;
  useMobs: boolean; mobsMax: number;
  useAge: boolean; ageDays: number;
  useZone: boolean; zone: string;
  protectContent: boolean;
};

const DEFAULT_FILTERS: Filters = {
  useDuration: true, durMax: 30,
  useDamage: false, dmgMax: 1000,
  useMobs: false, mobsMax: 2,
  useAge: false, ageDays: 30,
  useZone: false, zone: '',
  protectContent: true,
};

const PREVIEW_CAP = 400;

export default function CleanupView({
  paths,
  encSummaries,
  views,
  busy,
  dataDir,
  onDelete,
  onInspect,
  onRestored,
}: {
  paths: string[];
  encSummaries: Record<string, EncSummary>;
  views: ViewEntry[];
  busy: { current: number; total: number; label: string } | null;
  dataDir: string;
  onDelete: (members: string[]) => Promise<void>;
  onInspect: (g: PathGroup) => void;
  onRestored: () => void;
}) {
  const [tab, setTab] = useState<'delete' | 'restore'>('delete');
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortKey>('oldest');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(
    () => groupMultiboxPaths(paths, encSummaries, views).filter(g => g.view?.segIndex == null),
    [paths, encSummaries, views],
  );

  const stats = useMemo(() => {
    let generic = 0, content = 0, fragments = 0;
    for (const g of groups) {
      const s = encSummaries[g.rep];
      if (isProtectedContent(g.rep, s)) { content += 1; continue; }
      generic += 1;
      if ((s?.dur ?? 0) < 30) fragments += 1;
    }
    return { total: groups.length, generic, content, fragments };
  }, [groups, encSummaries]);

  const zones = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      const s = encSummaries[g.rep];
      const z = s?.zones?.length ? s.zones : (s?.zone ? [s.zone] : []);
      for (const zn of z) if (zn) set.add(zn);
    }
    return [...set].sort();
  }, [groups, encSummaries]);

  const anyFilter = f.useDuration || f.useDamage || f.useMobs || f.useAge || f.useZone;
  const ageCutoff = f.useAge ? (Date.now() / 1000) - f.ageDays * 86400 : 0;

  const matches = useMemo(() => {
    if (!anyFilter) return [];
    const out = groups.filter(g => {
      const s = encSummaries[g.rep];
      if (f.protectContent && isProtectedContent(g.rep, s)) return false;
      if (f.useDuration && !((s?.dur ?? 0) < f.durMax)) return false;
      if (f.useDamage && !((s?.metrics?.totalDamage ?? 0) < f.dmgMax)) return false;
      if (f.useMobs && !((s?.enemies ?? 0) < f.mobsMax)) return false;
      if (f.useAge && !(fileTs(g.rep) < ageCutoff)) return false;
      if (f.useZone) {
        const z = s?.zones?.length ? s.zones : (s?.zone ? [s.zone] : []);
        if (!z.includes(f.zone)) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      const sa = encSummaries[a.rep], sb = encSummaries[b.rep];
      switch (sort) {
        case 'newest': return fileTs(b.rep) - fileTs(a.rep);
        case 'shortest': return (sa?.dur ?? 0) - (sb?.dur ?? 0);
        case 'leastDmg': return (sa?.metrics?.totalDamage ?? 0) - (sb?.metrics?.totalDamage ?? 0);
        case 'oldest':
        default: return fileTs(a.rep) - fileTs(b.rep);
      }
    });
    return out;
  }, [groups, encSummaries, f, anyFilter, ageCutoff, sort]);

  const kept = useMemo(() => matches.filter(g => !excluded.has(g.id)), [matches, excluded]);
  const fileCount = useMemo(() => kept.reduce((n, g) => n + g.members.length, 0), [kept]);

  const toggleExclude = (id: string) =>
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleExpand = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const runDelete = async () => {
    setConfirming(false);
    setError(null);
    try {
      await onDelete(kept.flatMap(g => g.members));
      setExcluded(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const numInput = (val: number, set: (n: number) => void, enable: () => void) => (
    <input
      type="number"
      value={val}
      onClick={e => { e.stopPropagation(); enable(); }}
      onChange={e => { enable(); set(Math.max(0, Number(e.target.value) || 0)); }}
      className="mx-1.5 w-16 px-1.5 py-0.5 text-xs bg-black/40 border border-white/15 rounded font-mono text-gray-100"
    />
  );

  const kpi = (label: string, value: number, tone: string) => (
    <div className="p-4">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className={`font-bold text-2xl leading-none tabular-nums ${tone}`}>{fmtNum(value)}</div>
    </div>
  );

  return (
    <div className="pb-6">
      <div className="flex w-full items-center gap-1 p-1 rounded-lg bg-row-even border border-white/10 mb-5">
        <button
          onClick={() => setTab('delete')}
          className={`le-tap flex-1 px-4 py-2 text-sm font-semibold rounded-md transition-colors inline-flex items-center justify-center gap-2 ${tab === 'delete' ? 'bg-rose-600 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-white/[0.05]'}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18" />
            <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
          </svg>
          Delete
        </button>
        <button
          onClick={() => { setTab('restore'); setConfirming(false); }}
          className={`le-tap flex-1 px-4 py-2 text-sm font-semibold rounded-md transition-colors inline-flex items-center justify-center gap-2 ${tab === 'restore' ? 'bg-accent text-black shadow-sm' : 'text-gray-400 hover:text-white hover:bg-white/[0.05]'}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
          </svg>
          Restore
        </button>
      </div>

      {tab === 'restore' ? (
        <RestorePanel dataDir={dataDir} onRestored={onRestored} />
      ) : (
      <>
      <div className="bg-row-even border border-white/10 rounded-xl grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-white/10 overflow-hidden mb-5">
        {kpi('Total Encounters', stats.total, 'text-gray-200')}
        {kpi('Generic Combat', stats.generic, 'text-amber-300')}
        {kpi('Recognized Content', stats.content, 'text-emerald-300')}
        {kpi('Fragments Under 30s', stats.fragments, 'text-rose-300')}
      </div>

      <div className="flex flex-col lg:flex-row gap-5 items-start">
        <div className="w-full lg:w-[300px] shrink-0 rounded-xl border border-white/10 bg-row-even p-4">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-3">Filters</div>
          <div className="space-y-2.5">
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" checked={f.useDuration} onChange={e => setF(v => ({ ...v, useDuration: e.target.checked }))} className="accent-accent" />
              <span>Shorter than {numInput(f.durMax, n => setF(v => ({ ...v, durMax: n })), () => setF(v => ({ ...v, useDuration: true })))} sec</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" checked={f.useDamage} onChange={e => setF(v => ({ ...v, useDamage: e.target.checked }))} className="accent-accent" />
              <span>Total damage under {numInput(f.dmgMax, n => setF(v => ({ ...v, dmgMax: n })), () => setF(v => ({ ...v, useDamage: true })))}</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" checked={f.useMobs} onChange={e => setF(v => ({ ...v, useMobs: e.target.checked }))} className="accent-accent" />
              <span>Fewer than {numInput(f.mobsMax, n => setF(v => ({ ...v, mobsMax: n })), () => setF(v => ({ ...v, useMobs: true })))} enemies</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" checked={f.useAge} onChange={e => setF(v => ({ ...v, useAge: e.target.checked }))} className="accent-accent" />
              <span>Older than {numInput(f.ageDays, n => setF(v => ({ ...v, ageDays: n })), () => setF(v => ({ ...v, useAge: true })))} days</span>
            </label>
            <label className="flex items-start gap-2 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" checked={f.useZone} onChange={e => setF(v => ({ ...v, useZone: e.target.checked }))} className="accent-accent mt-1" />
              <span className="flex-1 min-w-0">
                <span className="block mb-1">In zone</span>
                <select
                  value={f.zone}
                  onChange={e => setF(v => ({ ...v, useZone: true, zone: e.target.value }))}
                  className="w-full px-1.5 py-1 text-[11px] bg-black/40 border border-white/15 rounded text-gray-100"
                >
                  <option value="">Select zone…</option>
                  {zones.map(z => <option key={z} value={z}>{z}</option>)}
                </select>
              </span>
            </label>
          </div>

          <label className="flex items-start gap-2 text-xs text-gray-300 cursor-pointer mt-4 pt-3 border-t border-white/[0.06]">
            <input type="checkbox" checked={f.protectContent} onChange={e => setF(v => ({ ...v, protectContent: e.target.checked }))} className="accent-accent mt-0.5" />
            <span>Protect recognized content (Sortie, Limbus, Odyssey, …) from the sweep</span>
          </label>

          <button
            onClick={() => { setF(DEFAULT_FILTERS); setExcluded(new Set()); setConfirming(false); }}
            className="le-tap mt-4 w-full px-3 py-1.5 text-[11px] rounded border border-white/10 text-gray-400 hover:text-white hover:bg-white/[0.04]"
          >
            Reset Filters
          </button>
        </div>

        <div className="flex-1 min-w-0 w-full rounded-xl border border-white/10 bg-row-even flex flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.06]">
            <div className="text-xs text-gray-300">
              {!anyFilter ? (
                <span className="text-gray-500 italic">Enable a filter or pick a preset to preview matches.</span>
              ) : (
                <>
                  <span className="text-accent font-semibold text-sm">{fmtNum(kept.length)}</span>
                  <span className="text-gray-500"> of {fmtNum(stats.total)} encounters</span>
                  {excluded.size > 0 && <span className="text-gray-500"> ({fmtNum(excluded.size)} kept)</span>}
                </>
              )}
            </div>
            {anyFilter && matches.length > 0 && (
              <select
                value={sort}
                onChange={e => setSort(e.target.value as SortKey)}
                className="px-2 py-1 text-[11px] bg-black/40 border border-white/15 rounded text-gray-200"
              >
                <option value="oldest">Oldest first</option>
                <option value="newest">Newest first</option>
                <option value="shortest">Shortest first</option>
                <option value="leastDmg">Least damage first</option>
              </select>
            )}
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: '52vh' }}>
            {!anyFilter ? (
              <div className="px-4 py-12 text-center text-xs text-gray-600 italic">Nothing selected yet.</div>
            ) : matches.length === 0 ? (
              <div className="px-4 py-12 text-center text-xs text-gray-600 italic">No encounters match these filters.</div>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {matches.slice(0, PREVIEW_CAP).map(g => {
                    const s = encSummaries[g.rep];
                    const isKept = excluded.has(g.id);
                    const isOpen = expanded.has(g.id);
                    return (
                      <Fragment key={g.id}>
                      <tr
                        className={`border-b border-white/[0.04] transition-colors ${isKept ? 'opacity-40' : 'hover:bg-white/[0.03]'}`}
                      >
                        <td className="pl-3 pr-1 py-1.5 w-8">
                          <input
                            type="checkbox"
                            checked={!isKept}
                            onChange={() => toggleExclude(g.id)}
                            title={isKept ? 'Keep this encounter' : 'Include in sweep'}
                            className="accent-rose-500"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-gray-200 truncate max-w-[220px]">
                          <button onClick={() => onInspect(g)} className="hover:text-accent hover:underline text-left truncate w-full" title="Open full report">
                            {zoneLabel(s)}
                          </button>
                        </td>
                        <td className="px-2 py-1.5 text-right text-gray-400 font-mono whitespace-nowrap tabular-nums">{fmtDur(s?.dur ?? 0)}</td>
                        <td className="px-2 py-1.5 text-right text-gray-500 font-mono whitespace-nowrap tabular-nums">{fmtNum(s?.metrics?.totalDamage ?? 0)} dmg</td>
                        <td className="px-2 py-1.5 text-right text-gray-500 font-mono whitespace-nowrap tabular-nums">{s?.enemies ?? 0} mob{(s?.enemies ?? 0) === 1 ? '' : 's'}</td>
                        <td className="px-2 py-1.5 text-right text-gray-500 font-mono whitespace-nowrap">{fmtDate(fileTs(g.rep))}</td>
                        <td className="pr-2 pl-1 py-1.5 w-7 text-right">
                          <button onClick={() => toggleExpand(g.id)} className="le-tap text-gray-500 hover:text-white p-0.5 align-middle" title={isOpen ? 'Hide details' : 'Show details'}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                              <path d="M9 6l6 6-6 6" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-white/[0.04] bg-black/25">
                          <td colSpan={7} className="px-4 py-3">
                            <DeleteOverview g={g} s={s} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
            {matches.length > PREVIEW_CAP && (
              <div className="px-3 py-2 text-[10px] text-gray-500 italic text-center border-t border-white/[0.04]">
                Showing first {PREVIEW_CAP} of {fmtNum(matches.length)} matches. All matched encounters (minus any you keep) will be deleted.
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-3 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2 break-words">{error}</div>
      )}
      </>
      )}

      {(busy || (tab === 'delete' && anyFilter && kept.length > 0)) && (
        <div className="sticky bottom-0 z-40 mt-4 -mx-6 border-t border-white/10 bg-nav/95 backdrop-blur px-6 py-3">
          {busy ? (
            (() => {
              const pct = busy.total > 0 ? Math.min(100, Math.round((busy.current / busy.total) * 100)) : 0;
              return (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-100 font-medium">Archiving log file {fmtNum(busy.current)} of {fmtNum(busy.total)}</span>
                    <span className="text-gray-400 font-mono tabular-nums">{pct}%</span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-white/[0.08] overflow-hidden">
                    <div className="h-full bg-accent transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-[11px] text-gray-500 truncate">{busy.label}. Archiving to data/_deleted/, safe to keep browsing.</div>
                </div>
              );
            })()
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div className="text-xs text-gray-400">
                {confirming ? (
                  <span className="text-rose-200">Archive then remove <span className="font-semibold text-rose-100">{fmtNum(kept.length)}</span> encounter{kept.length === 1 ? '' : 's'}{fileCount !== kept.length && <span className="text-gray-400"> ({fmtNum(fileCount)} underlying log file{fileCount === 1 ? '' : 's'})</span>}. Recoverable from Restore in History.</span>
                ) : (
                  <><span className="text-white font-semibold text-sm">{fmtNum(kept.length)}</span> encounter{kept.length === 1 ? '' : 's'} selected{fileCount !== kept.length && <span className="text-gray-500"> ({fmtNum(fileCount)} underlying log file{fileCount === 1 ? '' : 's'})</span>}</>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {confirming ? (
                  <>
                    <button onClick={() => setConfirming(false)} className="le-tap px-3 py-1.5 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/5">Cancel</button>
                    <button onClick={runDelete} className="le-tap px-4 py-1.5 text-xs rounded bg-rose-600 text-white font-semibold hover:bg-rose-500">
                      Confirm Delete {fmtNum(kept.length)} Encounter{kept.length === 1 ? '' : 's'}
                    </button>
                  </>
                ) : (
                  <button onClick={() => setConfirming(true)} className="le-tap px-4 py-1.5 text-xs rounded bg-rose-600 text-white font-semibold hover:bg-rose-500 inline-flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 6h18" />
                      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
                    </svg>
                    Delete {fmtNum(kept.length)} Encounter{kept.length === 1 ? '' : 's'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
