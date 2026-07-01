'use client';

import { useMemo, useState } from 'react';

export type ActionRow = {
  id: number;
  ts_elapsed: number | null;
  target_mob: string | null;
  actor_main_job: string | null;
  actor_sub_job: string | null;
  actor_main_lvl: number | null;
  actor_sub_lvl: number | null;
  category: string | null;
  ability_name: string | null;
  damage: number | null;
  result: string | null;
  quality: string;
};

const QUALITY_FILTERS = [
  { id: 'all',         label: 'All' },
  { id: 'implausible', label: 'Implausible' },
  { id: 'flagged',     label: 'Any flagged' },
  { id: 'ok',          label: 'Clean only' },
] as const;
type QualityFilter = typeof QUALITY_FILTERS[number]['id'];

const KNOWN_JOBS = new Set([
  'WAR','MNK','WHM','BLM','RDM','THF','PLD','DRK','BST','BRD','RNG','SAM',
  'NIN','DRG','SMN','BLU','COR','PUP','DNC','SCH','GEO','RUN','?','',
]);
const KNOWN_CATEGORIES = new Set(['ws','ja','spell','mb','melee','ranged','enfeeb','mob_ability']);
const KNOWN_RESULTS = new Set(['hit','miss','crit','resist','land','burst']);
const MAX_SANE_DAMAGE = 999_999;

function whyImplausible(r: ActionRow): string | null {
  if (r.actor_main_job && !KNOWN_JOBS.has(r.actor_main_job.toUpperCase())) return `bad main job "${r.actor_main_job}"`;
  if (r.actor_sub_job  && !KNOWN_JOBS.has(r.actor_sub_job.toUpperCase()))  return `bad sub job "${r.actor_sub_job}"`;
  if (r.actor_main_lvl != null && (r.actor_main_lvl < 1 || r.actor_main_lvl > 99)) return `main lvl out of range (${r.actor_main_lvl})`;
  if (r.actor_sub_lvl  != null && (r.actor_sub_lvl  < 1 || r.actor_sub_lvl  > 99)) return `sub lvl out of range (${r.actor_sub_lvl})`;
  if (r.category && !KNOWN_CATEGORIES.has(r.category)) return `bad category "${r.category}"`;
  if (r.result   && !KNOWN_RESULTS.has(r.result))      return `bad result "${r.result}"`;
  if (r.damage != null && (r.damage < 0 || r.damage > MAX_SANE_DAMAGE)) return `damage out of range (${r.damage})`;
  if (r.ts_elapsed != null && r.ts_elapsed < 0) return `negative timestamp (${r.ts_elapsed})`;
  return null;
}

function fmtTs(s: number | null): string {
  if (s == null) return '-';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function AdminShareActions({
  rows, totals,
}: {
  rows: ActionRow[];
  totals: { total: number; implausible: number; flaggedManual: number };
}) {
  const [filter, setFilter] = useState<QualityFilter>(totals.implausible > 0 ? 'implausible' : 'all');

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filter === 'implausible') return r.quality === 'flagged_implausible';
      if (filter === 'flagged')     return r.quality !== 'ok';
      if (filter === 'ok')          return r.quality === 'ok';
      return true;
    });
  }, [rows, filter]);

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1 bg-surface border border-white/10 rounded-lg p-1">
          {QUALITY_FILTERS.map(opt => {
            const on = filter === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setFilter(opt.id)}
                className={`le-tap text-xs px-2.5 py-1 rounded transition-colors ${on ? 'bg-accent/20 text-accent font-semibold' : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'}`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-400">
          {filtered.length === rows.length ? `${rows.length} actions` : `${filtered.length} of ${rows.length}`}
          {totals.implausible > 0 && <span className="ml-2 text-amber-300/80">· {totals.implausible} implausible</span>}
          {totals.flaggedManual > 0 && <span className="ml-2 text-rose-300/80">· {totals.flaggedManual} manually flagged</span>}
        </p>
      </div>

      <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400/80 bg-white/[0.03] border-b border-white/10">
              <th className="px-3 py-2 font-semibold w-14">t</th>
              <th className="px-3 py-2 font-semibold">Actor</th>
              <th className="px-3 py-2 font-semibold">Cat</th>
              <th className="px-3 py-2 font-semibold">Ability</th>
              <th className="px-3 py-2 font-semibold">Target</th>
              <th className="px-3 py-2 font-semibold text-right">Damage</th>
              <th className="px-3 py-2 font-semibold">Result</th>
              <th className="px-3 py-2 font-semibold">Quality</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const flagged = r.quality !== 'ok';
              const why = r.quality === 'flagged_implausible' ? whyImplausible(r) : null;
              return (
                <tr
                  key={r.id}
                  className={`border-b border-white/[0.06] last:border-0 ${
                    r.quality === 'flagged_implausible' ? 'bg-amber-500/[0.06]'
                    : r.quality === 'flagged_manual'    ? 'bg-rose-500/[0.06]'
                    : 'hover:bg-white/[0.02]'
                  }`}
                >
                  <td className="px-3 py-2 font-mono text-gray-400 text-xs">{fmtTs(r.ts_elapsed)}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <span className="text-gray-200">{r.actor_main_job ?? '?'}{r.actor_main_lvl != null ? r.actor_main_lvl : ''}</span>
                    {r.actor_sub_job && (
                      <>
                        <span className="text-gray-400">/</span>
                        <span className="text-gray-400">{r.actor_sub_job}{r.actor_sub_lvl != null ? r.actor_sub_lvl : ''}</span>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-400">{r.category ?? '-'}</td>
                  <td className="px-3 py-2 text-gray-100">{r.ability_name ?? '-'}</td>
                  <td className="px-3 py-2 text-gray-300 text-xs">{r.target_mob ?? '-'}</td>
                  <td className={`px-3 py-2 font-mono text-right ${flagged && r.damage != null && r.damage > MAX_SANE_DAMAGE ? 'text-rose-300 font-bold' : 'text-gray-200'}`}>
                    {r.damage != null ? r.damage.toLocaleString() : '-'}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400">{r.result ?? '-'}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.quality === 'flagged_implausible' && (
                      <span title={why ?? 'flagged'} className="text-amber-300 font-mono">IMP {why && <span className="text-amber-300/70 ml-1">({why})</span>}</span>
                    )}
                    {r.quality === 'flagged_manual' && <span className="text-rose-300 font-mono">FLAG</span>}
                    {r.quality === 'ok' && <span className="text-gray-400">-</span>}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-sm text-gray-400">
                  No actions match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
