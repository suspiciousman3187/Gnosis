'use client';

import { useMemo, useState } from 'react';
import type { RawBattleMessage } from '@/lib/types';
import {
  BATTLE_MESSAGE_DICT,
  summarizeBattleMessages,
  type BattleMessageCategory,
} from '@/lib/battleMessages';
import { actionMessageText } from '@/lib/actionMessages';

const CATEGORY_LABELS: Record<BattleMessageCategory, string> = {
  death:            'Deaths',
  buff_gain:        'Buff gains',
  buff_wear:        'Buff wears',
  resist_no_effect: 'No effect',
  resist_full:      'Full resist',
  resist_half:      'Half resist',
  resist_quarter:   'Quarter resist',
  resist_eighth:    'Eighth resist',
  magic_burst:      'Magic burst',
  crit:             'Critical hits',
  shadow_absorb:    'Shadow absorbs',
  interrupt:        'Interrupts',
  cannot_use:       'Cannot use',
  out_of_range:     'Out of range',
  dot_tick:         'DoT ticks',
  sp_ability:       'SP abilities',
  recast_ready:     'Recast ready',
  misc:             'Misc',
};

const CATEGORY_COLOR: Record<BattleMessageCategory, string> = {
  death:            'text-rose-300',
  buff_gain:        'text-emerald-300',
  buff_wear:        'text-amber-300',
  resist_no_effect: 'text-slate-300',
  resist_full:      'text-slate-300',
  resist_half:      'text-slate-400',
  resist_quarter:   'text-slate-400',
  resist_eighth:    'text-slate-400',
  magic_burst:      'text-teal-300',
  crit:             'text-amber-300',
  shadow_absorb:    'text-indigo-300',
  interrupt:        'text-rose-300',
  cannot_use:       'text-orange-300',
  out_of_range:     'text-orange-300',
  dot_tick:         'text-violet-300',
  sp_ability:       'text-fuchsia-300',
  recast_ready:     'text-sky-300',
  misc:             'text-gray-300',
};

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function BattleMessagesPanel({
  raw,
  nameMap,
}: {
  raw?: RawBattleMessage[] | null;
  nameMap?: Map<number, string> | null;
}) {
  const summary = useMemo(() => summarizeBattleMessages(raw), [raw]);
  const [showUnknown, setShowUnknown] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<BattleMessageCategory | null>(null);

  if (!raw || raw.length === 0) return null;

  const idName = (id?: number) => (id && nameMap?.get(id)) || (id ? `#${id}` : '-');

  const categories = [...summary.byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const topUnknowns = [...summary.unknownIds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);

  const detailRows = selectedCategory
    ? raw.filter(m => {
        const meta = BATTLE_MESSAGE_DICT[m.msgId];
        return meta?.category === selectedCategory;
      }).slice(0, 100)
    : [];

  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-5">
      <div className="flex items-end justify-between gap-3 mb-1 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Battle Messages</h3>
        <span className="text-[11px] text-gray-400">
          {summary.total.toLocaleString()} captured · {summary.byCategory.size} known categories · {summary.unknownIds.size} unknown ids
        </span>
      </div>
      <p className="text-[11px] text-gray-400 mb-3">
        Raw 0x029 packet capture, classified via the message dictionary. Unknown ids surface here for
        future dictionary entries — click any category to see individual events.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mb-4">
        {categories.map(([cat, count]) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(c => c === cat ? null : cat)}
            className={`flex items-center justify-between text-xs rounded-lg px-2.5 py-2 border transition-colors ${
              selectedCategory === cat
                ? 'border-accent/50 bg-accent/15'
                : 'border-white/10 hover:bg-white/[0.05]'
            }`}
          >
            <span className={CATEGORY_COLOR[cat]}>{CATEGORY_LABELS[cat]}</span>
            <span className="font-mono text-gray-300">{count.toLocaleString()}</span>
          </button>
        ))}
      </div>

      {selectedCategory && detailRows.length > 0 && (
        <div className="border-t border-white/10 pt-3 mb-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">
            {CATEGORY_LABELS[selectedCategory]} · {detailRows.length} {detailRows.length === 100 ? 'shown (first 100)' : 'events'}
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-white/10">
                <th className="text-right pb-1.5 font-semibold w-16">Time</th>
                <th className="text-right pb-1.5 font-semibold w-14">MsgId</th>
                <th className="text-left pb-1.5 font-semibold pl-3">Label</th>
                <th className="text-left pb-1.5 font-semibold pl-3">Actor</th>
                <th className="text-left pb-1.5 font-semibold pl-3">Target</th>
                <th className="text-right pb-1.5 font-semibold w-20">Data</th>
              </tr>
            </thead>
            <tbody>
              {detailRows.map((m, i) => {
                const meta = BATTLE_MESSAGE_DICT[m.msgId];
                const raw = actionMessageText(m.msgId);
                const label = meta?.label ?? raw ?? '?';
                return (
                  <tr key={i} className="border-b border-white/[0.04] last:border-0">
                    <td className="py-1 text-right font-mono text-gray-400">{fmtTime(m.elapsed)}</td>
                    <td className="py-1 text-right font-mono text-gray-500">{m.msgId}</td>
                    <td className="py-1 pl-3 text-gray-200 truncate max-w-md" title={raw ?? undefined}>{label}</td>
                    <td className="py-1 pl-3 text-gray-300 truncate max-w-[10rem]">{idName(m.actorId)}</td>
                    <td className="py-1 pl-3 text-gray-300 truncate max-w-[10rem]">{idName(m.targetId)}</td>
                    <td className="py-1 text-right font-mono text-gray-500">{m.data ?? '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {summary.unknownIds.size > 0 && (
        <div className="border-t border-white/10 pt-3">
          <button
            onClick={() => setShowUnknown(v => !v)}
            className="text-[11px] uppercase tracking-wide text-gray-400 hover:text-gray-200 transition-colors"
          >
            {showUnknown ? '▼' : '▶'} Unknown message ids ({summary.unknownIds.size}) · top 20 by count
          </button>
          {showUnknown && (
            <div className="mt-2 space-y-1">
              {topUnknowns.map(([id, count]) => {
                const raw = actionMessageText(id);
                return (
                  <div key={id} className="flex items-center gap-2 text-[10px]">
                    <span className="font-mono px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/10 text-gray-400 shrink-0">
                      {id}<span className="text-gray-500">·{count}</span>
                    </span>
                    <span className="text-gray-300 truncate">{raw ?? '(no res entry)'}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
