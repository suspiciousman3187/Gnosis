import { useEffect, useMemo, useRef, useState } from 'react';
import LoadingScreen from './LoadingScreen';
import { useLootAggregation } from './useLootAggregation';
import ItemIcon from '@/components/ItemIcon';
import { fmtDur, fmtDateTime } from './trendsShared';
import { kindFromName, fileTs } from './content';
import { getActiveDir } from './summaryStore';
import { dbMetaGet, dbMetaSet } from './db';
import { buildRecordsRollup, recordsFingerprint, RECORDS_ROLLUP_VERSION, type RecordRow } from '@/lib/recordsRollup';
import { LOOT_SCHEMA_VERSION } from '@/lib/dropAggregator';
import AnchoredPopover from './AnchoredPopover';

type Scope = '30d' | '90d' | 'all';
const SCOPES: { key: Scope; label: string }[] = [
  { key: 'all', label: 'All Time' },
  { key: '30d', label: '30 Days' },
  { key: '90d', label: '90 Days' },
];

function scopeCutoff(scope: Scope): number | null {
  if (scope === 'all') return null;
  return Math.floor(Date.now() / 1000) - (scope === '30d' ? 30 : 90) * 24 * 60 * 60;
}

function Stat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'accent' | 'gold' }) {
  const color = tone === 'accent' ? 'text-accent' : tone === 'gold' ? 'text-amber-300' : 'text-gray-200';
  return (
    <div className="rounded-lg bg-black/20 border border-white/[0.06] px-3 py-2 min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-sm font-mono ${color} truncate`}>{value}</div>
    </div>
  );
}

function DropList({ row }: { row: RecordRow }) {
  if (row.drops.length === 0) {
    return <div className="text-[11px] text-gray-600 italic px-1 py-2">No drops recorded.</div>;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 pt-1">
      {row.drops.map(it => (
        <div key={it.item} className="flex items-center justify-between gap-3 min-w-0 text-sm">
          <ItemIcon id={it.itemId} name={it.item} size={20} nameClass="truncate text-gray-300" />
          <span className="shrink-0 font-mono text-[11px] text-gray-500">
            <span className="text-gray-300">{it.count}</span>× · {row.kills > 0 ? Math.round((it.count / row.kills) * 100) : 0}%
          </span>
        </div>
      ))}
    </div>
  );
}

const fieldCls = 'bg-panel-alt/70 border border-white/10 rounded px-2 py-1 text-[11px] text-gray-200 placeholder:text-gray-600 outline-none focus:border-accent/50';

// App-styled multi-select combobox (replaces native/chip filters).
function MultiSelect({ options, selected, onChange, placeholder }: {
  options: string[]; selected: Set<string>; onChange: (s: Set<string>) => void; placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLButtonElement>(null);
  const filtered = options.filter(o => o.toLowerCase().includes(q.trim().toLowerCase()));
  const label = selected.size === 0 ? placeholder : selected.size <= 2 ? [...selected].join(', ') : `${selected.size} selected`;
  const toggle = (o: string) => { const n = new Set(selected); if (n.has(o)) n.delete(o); else n.add(o); onChange(n); };
  return (
    <>
      <button
        ref={ref}
        onClick={() => setOpen(o => !o)}
        className={`flex items-center justify-between gap-2 ${fieldCls} min-w-[9rem] max-w-[13rem]`}
      >
        <span className={`truncate ${selected.size ? 'text-gray-200' : 'text-gray-500'}`}>{label}</span>
        <span className="text-gray-500 text-[9px] shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      <AnchoredPopover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={224}>
        <div className="p-1.5 border-b border-white/10 flex items-center gap-1.5 sticky top-0 bg-black/95">
          <input
            autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
            className="flex-1 px-2 py-1 text-[11px] rounded bg-white/[0.04] border border-white/10 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/40"
          />
          {selected.size > 0 && <button onClick={() => onChange(new Set())} className="text-[10px] text-gray-400 hover:text-accent px-1">Clear</button>}
        </div>
        <ul className="py-1">
          {filtered.length === 0 && <li className="px-3 py-2 text-[11px] text-gray-500 italic">No matches.</li>}
          {filtered.map(o => (
            <li key={o}>
              <button onClick={() => toggle(o)} className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left hover:bg-white/[0.06]">
                <span className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded border shrink-0 ${selected.has(o) ? 'bg-accent border-accent text-zinc-950' : 'border-white/25'}`}>
                  {selected.has(o) && <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M2 6.5l2.5 2.5L10 3" /></svg>}
                </span>
                <span className={selected.has(o) ? 'text-gray-100' : 'text-gray-300'}>{o}</span>
              </button>
            </li>
          ))}
        </ul>
      </AnchoredPopover>
    </>
  );
}

const CAL_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="shrink-0 text-gray-500">
    <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" />
  </svg>
);

// App-styled date picker (replaces the native OS calendar). value = 'yyyy-mm-dd'.
function DateField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const init = value ? new Date(`${value}T00:00:00`) : new Date();
  const [view, setView] = useState({ y: init.getFullYear(), m: init.getMonth() });
  const label = value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : placeholder;
  const pick = (d: Date) => { onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); setOpen(false); };
  const first = new Date(view.y, view.m, 1);
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(view.y, view.m, d));
  const sel = value ? new Date(`${value}T00:00:00`) : null;
  const same = (a: Date, b: Date | null) => !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  return (
    <>
      <button ref={ref} onClick={() => setOpen(o => !o)} className={`flex items-center gap-1.5 ${fieldCls} min-w-[7.5rem]`}>
        {CAL_ICON}
        <span className={value ? 'text-gray-200' : 'text-gray-500'}>{label}</span>
      </button>
      <AnchoredPopover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={240}>
        <div className="p-2">
          <div className="flex items-center justify-between mb-1.5">
            <button onClick={() => setView(v => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))} className="px-2 py-0.5 rounded text-gray-400 hover:text-accent hover:bg-white/[0.06]">‹</button>
            <span className="text-[11px] font-medium text-gray-200">{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
            <button onClick={() => setView(v => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))} className="px-2 py-0.5 rounded text-gray-400 hover:text-accent hover:bg-white/[0.06]">›</button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="text-[9px] text-gray-600 py-0.5">{d}</div>)}
            {cells.map((d, i) => d
              ? <button key={i} onClick={() => pick(d)} className={`text-[11px] rounded py-1 transition-colors ${same(d, sel) ? 'bg-accent text-zinc-950 font-semibold' : 'text-gray-300 hover:bg-white/[0.08]'}`}>{d.getDate()}</button>
              : <div key={i} />)}
          </div>
          <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-white/10">
            <button onClick={() => { onChange(''); setOpen(false); }} className="text-[10px] text-gray-400 hover:text-accent">Clear</button>
            <button onClick={() => pick(new Date())} className="text-[10px] text-accent hover:underline">Today</button>
          </div>
        </div>
      </AnchoredPopover>
    </>
  );
}

type SortKey = 'date' | 'kt' | 'players' | 'loot';

function SortHeader({ label, col, sort, onSort, className = '' }: {
  label: string; col: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (k: SortKey) => void; className?: string;
}) {
  const active = sort.key === col;
  return (
    <th className={`font-semibold px-2 py-1.5 select-none ${className}`}>
      <button onClick={() => onSort(col)} className={`inline-flex items-center gap-1 group ${active ? 'text-gray-200' : 'text-gray-500 hover:text-gray-300'}`}>
        {label}
        <span className="text-[8px] leading-none flex flex-col -space-y-1">
          <span className={active && sort.dir === 'asc' ? 'text-accent' : 'text-gray-600'}>▲</span>
          <span className={active && sort.dir === 'desc' ? 'text-accent' : 'text-gray-600'}>▼</span>
        </span>
      </button>
    </th>
  );
}

function KillTable({ row, onOpen }: { row: RecordRow; onOpen?: (path: string) => void }) {
  const [dFrom, setDFrom] = useState('');
  const [dTo, setDTo] = useState('');
  const [ktMin, setKtMin] = useState('');
  const [ktMax, setKtMax] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [lootQ, setLootQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });

  const players = useMemo(() => {
    const s = new Set<string>();
    for (const i of row.instances) for (const p of i.players) s.add(p);
    return [...s].sort();
  }, [row]);

  const filtered = useMemo(() => {
    const fromTs = dFrom ? new Date(`${dFrom}T00:00:00`).getTime() / 1000 : null;
    const toTs = dTo ? new Date(`${dTo}T23:59:59`).getTime() / 1000 : null;
    const kMin = ktMin ? parseInt(ktMin, 10) : null;
    const kMax = ktMax ? parseInt(ktMax, 10) : null;
    const lq = lootQ.trim().toLowerCase();
    const rows = row.instances.filter(i => {
      if (fromTs != null && i.ts < fromTs) return false;
      if (toTs != null && i.ts > toTs) return false;
      if (kMin != null && (i.kt == null || i.kt < kMin)) return false;
      if (kMax != null && (i.kt == null || i.kt > kMax)) return false;
      if (sel.size > 0) { for (const p of sel) if (!i.players.includes(p)) return false; }
      if (lq && !i.drops.some(d => d.item.toLowerCase().includes(lq))) return false;
      return true;
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    const val = (i: typeof rows[number]) => {
      switch (sort.key) {
        case 'date': return i.ts;
        case 'kt': return i.kt ?? -1;
        case 'players': return i.players.join(', ').toLowerCase();
        case 'loot': return i.drops.map(d => d.item).join(', ').toLowerCase();
      }
    };
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [row, dFrom, dTo, ktMin, ktMax, sel, lootQ, sort]);

  const onSort = (k: SortKey) => setSort(s => s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'desc' });
  const numOnly = (v: string) => v.replace(/[^0-9]/g, '');
  const hasFilter = !!(dFrom || dTo || ktMin || ktMax || sel.size > 0 || lootQ);
  const clear = () => { setDFrom(''); setDTo(''); setKtMin(''); setKtMax(''); setSel(new Set()); setLootQ(''); };

  if (row.instances.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
          Kill log ({filtered.length}{filtered.length !== row.instances.length ? ` of ${row.instances.length}` : ''}{row.instances.length >= 500 ? ', recent 500' : ''})
        </div>
        {hasFilter && <button onClick={clear} className="text-[11px] text-gray-400 hover:text-accent transition-colors">Clear filters</button>}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <DateField value={dFrom} onChange={setDFrom} placeholder="From date" />
        <span className="text-gray-600 text-[10px]">to</span>
        <DateField value={dTo} onChange={setDTo} placeholder="To date" />
        <div className="flex items-center gap-1 text-[10px] text-gray-500 ml-1">
          <span>Kill time (s)</span>
          <input inputMode="numeric" placeholder="min" value={ktMin} onChange={e => setKtMin(numOnly(e.target.value))} className={`${fieldCls} w-14`} />
          <span className="text-gray-600">–</span>
          <input inputMode="numeric" placeholder="max" value={ktMax} onChange={e => setKtMax(numOnly(e.target.value))} className={`${fieldCls} w-14`} />
        </div>
        {players.length > 0 && <MultiSelect options={players} selected={sel} onChange={setSel} placeholder="Any players" />}
        <input value={lootQ} onChange={e => setLootQ(e.target.value)} placeholder="Loot contains…" className={`${fieldCls} flex-1 min-w-[8rem]`} />
      </div>

      <div className="max-h-96 overflow-y-auto rounded-lg border border-white/[0.06]">
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 z-10 bg-panel-alt uppercase text-[10px]">
            <tr className="text-left">
              <SortHeader label="Date" col="date" sort={sort} onSort={onSort} />
              <SortHeader label="Kill time" col="kt" sort={sort} onSort={onSort} />
              <SortHeader label="Players" col="players" sort={sort} onSort={onSort} />
              <SortHeader label="Loot" col="loot" sort={sort} onSort={onSort} />
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-2 py-4 text-center text-gray-600">No kills match these filters.</td></tr>
            ) : filtered.map((i, idx) => (
              <tr key={`${i.path}-${i.ts}-${idx}`} className="border-t border-white/[0.04] align-top">
                <td className="px-2 py-1.5 text-gray-300 whitespace-nowrap">{fmtDateTime(i.ts)}</td>
                <td className="px-2 py-1.5 font-mono text-amber-300/80 whitespace-nowrap">{i.kt != null ? fmtDur(i.kt) : '—'}</td>
                <td className="px-2 py-1.5 text-gray-400">{i.players.length ? i.players.join(', ') : '—'}</td>
                <td className="px-2 py-1.5 text-gray-300">{i.drops.length ? i.drops.map(d => d.item + (d.count > 1 ? ` ×${d.count}` : '')).join(', ') : '—'}</td>
                <td className="px-2 py-1.5 whitespace-nowrap text-right">
                  {onOpen && <button onClick={() => onOpen(i.path)} className="text-accent hover:underline">Open</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function RecordsView({ paths, enabled, onOpen }: { paths: string[]; enabled: boolean; onOpen?: (path: string) => void }) {
  const [scope, setScope] = useState<Scope>('all');
  const [query, setQuery] = useState('');
  const [openMob, setOpenMob] = useState<string | null>(null);

  // Paths that feed the rollup for this scope (mirrors useLootAggregation's filter).
  const scopedPaths = useMemo(() => {
    const cut = scopeCutoff(scope);
    return paths.filter(p => {
      const k = kindFromName(p);
      if (k !== 'encounter' && k !== 'sortie') return false;
      if (cut != null && fileTs(p) < cut) return false;
      return true;
    });
  }, [paths, scope]);
  const fingerprint = useMemo(() => recordsFingerprint(scopedPaths), [scopedPaths]);

  // Persisted rollup: on scope/fingerprint change, try the cache first. A hit
  // renders instantly and skips the whole aggregation; a miss triggers a rebuild.
  const [rows, setRows] = useState<RecordRow[] | null>(null);
  const [cacheChecked, setCacheChecked] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [keepAggregating, setKeepAggregating] = useState(false);
  const [refineInfo, setRefineInfo] = useState<{ done: number; total: number } | null>(null);
  // Tracks reparse progress so a few files that can't convert don't refine forever.
  const stallRef = useRef({ last: Infinity, stalls: 0, cycles: 0 });
  const metaKey = `records_rollup_${scope}`;
  useEffect(() => {
    let alive = true;
    setCacheChecked(false);
    setRows(null);
    setKeepAggregating(false);
    setRefineInfo(null);
    stallRef.current = { last: Infinity, stalls: 0, cycles: 0 };
    (async () => {
      const dir = getActiveDir();
      if (!dir) { if (alive) setCacheChecked(true); return; }
      try {
        const raw = await dbMetaGet(dir, metaKey);
        if (!alive) return;
        if (raw) {
          const c = JSON.parse(raw) as { v: number; fp: string; rows: RecordRow[] };
          if (c.v === RECORDS_ROLLUP_VERSION && c.fp === fingerprint && Array.isArray(c.rows)) {
            setRows(c.rows);
            setCacheChecked(true);
            return;
          }
        }
      } catch { /* fall through to rebuild */ }
      if (alive) setCacheChecked(true);
    })();
    return () => { alive = false; };
  }, [metaKey, fingerprint]);

  // Keep the aggregation enabled while we have no rows yet OR a background
  // reparse is still pending (so we can refill via nonce).
  const needRebuild = enabled && cacheChecked && (rows === null || keepAggregating);
  const { entries, loading, phase, progress, pending } = useLootAggregation({ paths, enabled: needRebuild, scope, includeSortie: true, nonce });

  // Build once the aggregation settles (phase 'ready'). If a reparse is still
  // pending, show the partial rollup but DON'T cache it - keep aggregating and
  // re-read shortly (nonce bump) until it's complete, then persist.
  useEffect(() => {
    if (!needRebuild || phase !== 'ready') return;
    const built = buildRecordsRollup(entries);
    setRows(built);
    if (pending) {
      const remaining = entries.filter(e => kindFromName(e.path) === 'sortie' && (e.sv ?? 0) < LOOT_SCHEMA_VERSION).length;
      const st = stallRef.current;
      st.cycles += 1;
      st.stalls = remaining >= st.last ? st.stalls + 1 : 0; // no progress this cycle
      st.last = remaining;
      // Give up on a handful of files that can't reparse (corrupt/unreadable),
      // rather than spin forever: cache what we have and stop.
      const giveUp = st.stalls >= 3 || st.cycles >= 30;
      if (!giveUp) {
        setRefineInfo(prev => {
          const total = prev && prev.total >= remaining ? prev.total : remaining;
          return { total, done: total - remaining };
        });
        setKeepAggregating(true);
        const t = setTimeout(() => setNonce(n => n + 1), 4000);
        return () => clearTimeout(t);
      }
    }
    setRefineInfo(null);
    setKeepAggregating(false);
    const dir = getActiveDir();
    if (dir) void dbMetaSet(dir, metaKey, JSON.stringify({ v: RECORDS_ROLLUP_VERSION, fp: fingerprint, rows: built })).catch(() => {});
  }, [needRebuild, phase, entries, pending, fingerprint, metaKey]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return q ? rows.filter(r => r.mob.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  const showLoading = rows === null && (!cacheChecked || loading || phase !== 'ready');

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="bg-surface border border-white/10 rounded-xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">Records</h2>
            <p className="text-[11px] text-gray-500">
              Your lifetime history per enemy: kills, kill times, and drops seen.
              {keepAggregating && (
                <span className="text-amber-300/80">
                  {' · '}updating sortie player rosters
                  {refineInfo && refineInfo.total > 0 ? ` (${refineInfo.done.toLocaleString()}/${refineInfo.total.toLocaleString()})` : ''}
                  <span className="inline-block animate-pulse">…</span>
                </span>
              )}
            </p>
          </div>
          <div className="flex rounded-lg border border-white/10 overflow-hidden shrink-0">
            {SCOPES.map(s => (
              <button
                key={s.key}
                onClick={() => setScope(s.key)}
                className={`text-[11px] px-3 py-1.5 transition-colors ${
                  scope === s.key ? 'bg-accent/20 text-accent font-semibold' : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.06]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search an enemy (Lady Lilith, Shinryu, Aminon...)"
          className="w-full mt-3 bg-panel-alt/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-accent/50"
        />
      </div>

      {showLoading ? (
        <LoadingScreen fill={false} hideQuote caption={`Building your records${progress.total > 0 ? ` (${Math.round((progress.loaded / progress.total) * 100)}%)` : ''}`} />
      ) : visible.length === 0 ? (
        <div className="bg-row-even border border-white/10 rounded-xl p-12 text-center text-sm text-gray-500">
          {query ? 'No enemy matches that search.' : 'No kills recorded yet in this range.'}
        </div>
      ) : (
        <div className="bg-row-even border border-white/10 rounded-xl overflow-hidden divide-y divide-white/[0.06]">
          {visible.map(r => {
            const open = openMob === r.mob;
            return (
              <div key={r.mob}>
                <button
                  onClick={() => setOpenMob(open ? null : r.mob)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
                >
                  <span className={`text-gray-600 text-[10px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
                  <span className="flex-1 min-w-0 flex items-baseline gap-2">
                    <span className="text-sm font-medium text-gray-100 truncate">{r.mob}</span>
                    {r.lastTs > 0 && <span className="shrink-0 text-[10px] text-gray-500 whitespace-nowrap">Last Killed: {new Date(r.lastTs * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                  </span>
                  {r.best != null && <span className="shrink-0 text-[11px] font-mono text-amber-300/80">{fmtDur(r.best)}</span>}
                  <span className="shrink-0 text-[11px] font-mono text-accent w-20 text-right">{r.kills.toLocaleString()} {r.kills === 1 ? 'kill' : 'kills'}</span>
                </button>
                {open && (
                  <div className="px-4 pb-4 pt-1 space-y-3 bg-black/10">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Stat label="Kills" value={r.kills.toLocaleString()} tone="accent" />
                      <Stat label="Fastest Killtime" value={r.best != null ? fmtDur(r.best) : '—'} tone="gold" />
                      <Stat label="Average Killtime" value={r.avg != null ? fmtDur(r.avg) : '—'} />
                      <Stat label="Longest Killtime" value={r.worst != null ? fmtDur(r.worst) : '—'} />
                    </div>
                    {r.perCharacter.length > 0 && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1.5">Kills by character</div>
                        <div className="flex flex-wrap gap-1.5">
                          {r.perCharacter.map(c => (
                            <span key={c.name} className="inline-flex items-center gap-1.5 rounded-md bg-black/20 border border-white/[0.06] px-2 py-1 text-[11px]">
                              <span className="text-gray-300">{c.name}</span>
                              <span className="font-mono text-accent">{c.count.toLocaleString()}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Drops seen</div>
                      <DropList row={r} />
                    </div>
                    <KillTable row={r} onOpen={onOpen} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
