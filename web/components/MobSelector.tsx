'use client';

import { useState } from 'react';
import { CONTENT_COLOR_PALETTE, type ContentColorKey } from '@/lib/contentRegistry';

export const ALL_MOBS = '_all_';

const BOSS_SET = new Set([
  'ghatjot', 'leshonn', 'skomora', 'degei', 'dhartok', 'gartell',
  'triboulex', 'aita', 'aminon',
]);
const MINIBOSS_SET = new Set([
  'cachaemic bhoot', 'abject obdella', 'demisang deleterious', 'biune porxie',
  'gyvewrapped naraka', 'fetid ixion', 'haughty tulittia', 'esurient botulus',
]);
export const mobDisplay = (name: string) => name.replace(/_/g, ' ');
export function mobGroup(name: string): 'boss' | 'miniboss' | 'other' {
  const n = mobDisplay(name).toLowerCase();
  if (BOSS_SET.has(n)) return 'boss';
  if (MINIBOSS_SET.has(n)) return 'miniboss';
  return 'other';
}

export type MobOption = { value: string; label: string; group?: 'boss' | 'miniboss' | 'other' };

export default function MobSelector({ mobs, options, value, onChange, allLabel = 'All Mobs', bossColor }: {
  mobs?: string[];
  options?: MobOption[];
  value: string;
  onChange: (v: string) => void;
  allLabel?: string;
  bossColor?: ContentColorKey;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const opts: MobOption[] = options ?? (mobs ?? []).map(n => ({ value: n, label: mobDisplay(n), group: mobGroup(n) }));
  const groupOf = (o: MobOption) => o.group ?? 'other';

  const GROUP_RANK = { boss: 0, miniboss: 1, other: 2 } as const;
  const filtered = opts
    .filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => {
      const ga = GROUP_RANK[groupOf(a)], gb = GROUP_RANK[groupOf(b)];
      return ga !== gb ? ga - gb : a.label.localeCompare(b.label);
    });
  const present = (['boss', 'miniboss', 'other'] as const).filter(g => filtered.some(o => groupOf(o) === g));
  const showHeadings = present.length > 1;
  const selectedLabel = value === ALL_MOBS ? allLabel : (opts.find(o => o.value === value)?.label ?? mobDisplay(value));
  const pick = (v: string) => { onChange(v); setOpen(false); setQuery(''); };

  return (
    <div className="relative max-w-sm">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border border-white/10 bg-panel hover:bg-white/[0.04] transition-colors"
      >
        <span className="font-medium text-gray-200 truncate">{selectedLabel}</span>
        <span className="text-gray-400 text-xs shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-white/15 bg-black/95 shadow-xl overflow-hidden">
            <div className="p-2 border-b border-white/10">
              <input
                autoFocus
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search…"
                className="w-full px-2 py-1.5 text-sm rounded-md bg-white/[0.04] border border-white/10 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/40"
              />
            </div>
            <ul className="max-h-72 overflow-y-auto py-1 text-sm">
              <li>
                <button
                  onClick={() => pick(ALL_MOBS)}
                  className={`w-full text-left px-3 py-1.5 hover:bg-white/[0.06] ${value === ALL_MOBS ? 'text-accent font-medium' : 'text-gray-300'}`}
                >
                  {allLabel}
                </button>
              </li>
              {(['boss', 'miniboss', 'other'] as const).map(group => {
                const items = filtered.filter(o => groupOf(o) === group);
                if (items.length === 0) return null;
                const heading = group === 'boss' ? 'Bosses' : group === 'miniboss' ? 'Minibosses' : 'Other';
                const palette = bossColor ? CONTENT_COLOR_PALETTE[bossColor] : null;
                const headingClass = group === 'boss' && palette
                  ? `${palette.titleOff} border-t border-current/40`
                  : group === 'miniboss' && palette
                  ? `${palette.titleOff} opacity-80`
                  : 'text-gray-400';
                const rowAccent = group === 'boss' && palette ? `${palette.titleOff}` : '';
                return (
                  <li key={group}>
                    {showHeadings && (
                      <div className={`px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide font-semibold ${headingClass}`}>{heading}</div>
                    )}
                    {items.map(o => (
                      <button
                        key={o.value}
                        onClick={() => pick(o.value)}
                        className={`w-full text-left px-3 py-1.5 hover:bg-white/[0.06] ${value === o.value ? 'text-accent font-medium' : group === 'boss' && palette ? rowAccent : 'text-gray-300'}`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </li>
                );
              })}
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-xs text-gray-400 italic">No matches for “{query}”.</li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
