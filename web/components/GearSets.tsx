'use client';

import { useState, type ReactNode } from 'react';
import ItemIcon from '@/components/ItemIcon';
import GearReveal from '@/components/GearReveal';
import type { GearLogEntry, GearStateVariant, BuffLogEntry, PositionLogEntry, ActionLogEntry, PartyTpEntry } from '@/lib/types';

const clockUp = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const clockDown = (s: number) => { const r = Math.max(0, 3600 - s); return `${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')}`; };

type GearSlots = Record<string, { id: number; name: string; augments?: string[] }>;

const SLOT_ORDER = ['main', 'sub', 'range', 'ammo', 'head', 'neck', 'left_ear', 'right_ear', 'body', 'hands', 'left_ring', 'right_ring', 'back', 'waist', 'legs', 'feet'] as const;
const SLOT_LABEL: Record<string, string> = {
  main: 'Main', sub: 'Sub', range: 'Range', ammo: 'Ammo', head: 'Head', neck: 'Neck',
  left_ear: 'Ear', right_ear: 'Ear', body: 'Body', hands: 'Hands', left_ring: 'Ring', right_ring: 'Ring',
  back: 'Back', waist: 'Waist', legs: 'Legs', feet: 'Feet',
};
const gearTypeColor = (t: string) =>
  ({ ws: 'text-amber-300', spell: 'text-sky-300', mb: 'text-teal-300', enfeeb: 'text-indigo-300', ja: 'text-emerald-300', ranged: 'text-green-300' } as Record<string, string>)[t] ?? 'text-gray-200';

// Observed-state gearsets (worn between actions). Ordered + colored for display.
const STATE_ORDER = ['Engaged', 'Idle', 'Idle (Pet)', 'Resting', 'Ranged'];
const STATE_COLOR: Record<string, string> = {
  Engaged: 'text-rose-300',
  Idle: 'text-sky-300',
  'Idle (Pet)': 'text-teal-300',
  Resting: 'text-emerald-300',
  Ranged: 'text-green-300',
};

const ACTION_GROUPS: { type: string; label: string }[] = [
  { type: 'ws', label: 'Weaponskills' },
  { type: 'spell', label: 'Spells' },
  { type: 'mb', label: 'Magic Bursts' },
  { type: 'enfeeb', label: 'Enfeebles' },
  { type: 'ja', label: 'Job Abilities' },
  { type: 'ranged', label: 'Ranged' },
];

function GearGrid({ gear }: { gear: GearSlots }) {
  return (
    <div className="columns-2 gap-x-5 text-[11px]">
      {SLOT_ORDER.filter(sl => gear[sl]).map(sl => {
        const g = gear[sl];
        return (
          <div key={sl} className="break-inside-avoid mb-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-gray-400 w-10 shrink-0">{SLOT_LABEL[sl]}</span>
              <ItemIcon id={g.id} name={g.name} size={20} nameClass="truncate text-gray-300" />
            </div>
            {g.augments && g.augments.length > 0 && (
              <div className="pl-7 mt-0.5 flex flex-col gap-px">
                {g.augments.map((a, i) => (
                  <span key={i} className="text-[10px] leading-snug text-amber-200/70">{a}</span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StateSetCard({ label, variant, index, total }: { label: string; variant: GearStateVariant; index: number; total: number }) {
  return (
    <div className="border border-white/[0.08] rounded-lg p-3">
      <div className="flex items-baseline gap-2 mb-2">
        <span className={`text-sm font-bold ${STATE_COLOR[label] ?? 'text-gray-200'}`}>{label}</span>
        {total > 1 && <span className="text-[10px] text-gray-400 uppercase">variant {index + 1}/{total}</span>}
        <span className="ml-auto text-[10px] text-gray-400">×{variant.count}</span>
      </div>
      <GearGrid gear={variant.gear} />
    </div>
  );
}

export function GearSetCard({ set }: { set: { type: string; name: string; gear: GearSlots; precast?: GearSlots; count: number } }) {
  const [showPrecast, setShowPrecast] = useState(false);
  const hasPrecast = !!set.precast;
  const shown = showPrecast && set.precast ? set.precast : set.gear;
  // For spells the captured set is midcast; label it and offer a precast toggle.
  const phaseLabel = set.type === 'spell' ? (showPrecast ? 'precast' : 'midcast') : set.type;
  return (
    <div className="border border-white/[0.08] rounded-lg p-3">
      <div className="flex items-baseline gap-2 mb-2">
        <span className={`text-sm font-bold ${gearTypeColor(set.type)}`}>{set.name}</span>
        <span className="text-[10px] text-gray-400 uppercase">{phaseLabel}</span>
        {hasPrecast && (
          <button onClick={() => setShowPrecast(v => !v)} className="text-[10px] text-gray-400 hover:text-gray-300 underline decoration-dotted">
            {showPrecast ? 'show midcast' : 'show precast'}
          </button>
        )}
        <span className="ml-auto text-[10px] text-gray-400">×{set.count}</span>
      </div>
      <GearGrid gear={shown} />
    </div>
  );
}

type UsageRow = { elapsed: number; type: string; name: string; target: string; tp: number | null; damage: number; resisted: boolean; gear: GearLogEntry };

function GearUsageTable({ groupKey, rows, countdown }: { groupKey: string; rows: UsageRow[]; countdown?: boolean }) {
  const fmt = countdown ? clockDown : clockUp;
  const showTp = groupKey === 'ws';
  const showDmg = groupKey !== 'ja';
  return (
    <div className="mt-4 pt-4 border-t border-white/10">
      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-2">Usage</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-400 text-xs border-b border-white/10">
            <th className="text-left pb-2 w-14">Time</th>
            <th className="text-left pb-2">Action</th>
            <th className="text-left pb-2">Target</th>
            {showTp && <th className="text-right pb-2 w-16">TP</th>}
            {showDmg && <th className="text-right pb-2 w-24">Damage</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-white/[0.05] last:border-0">
              <td className="py-1.5 text-gray-400 font-mono text-xs">{fmt(r.elapsed)}</td>
              <td className="py-1.5"><span className={gearTypeColor(r.type)}>{r.name}</span><GearReveal entry={r.gear} /></td>
              <td className="py-1.5 text-gray-400 text-xs truncate max-w-[12rem]">{r.target || '-'}</td>
              {showTp && <td className="py-1.5 text-right font-mono text-sky-300">{r.tp != null ? r.tp : '-'}</td>}
              {showDmg && (
                <td className="py-1.5 text-right font-mono">
                  {r.resisted ? <span className="text-gray-400">resisted</span> : r.damage > 0 ? <span className="text-gray-200">{r.damage.toLocaleString()}</span> : <span className="text-gray-400">-</span>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GearSetsBody({ gearLog, stateSets, actionLog, partyTpLog, countdown, headerSlot }: {
  gearLog?: GearLogEntry[] | null;
  stateSets?: Record<string, GearStateVariant[]> | null;
  actionLog?: ActionLogEntry[] | null;
  partyTpLog?: PartyTpEntry[] | null;
  countdown?: boolean;
  headerSlot?: ReactNode;
}) {
  const [cat, setCat] = useState('');
  // Distinct gear sets used per action. Dedupe by action name + set so a normal
  // vs magic-burst set on the same spell both surface.
  const actionSets = (() => {
    const log = gearLog ?? [];
    const by: Record<string, { type: string; name: string; gear: GearSlots; precast?: GearSlots; count: number }> = {};
    for (const g of log) {
      const key = `${g.name}|${JSON.stringify(g.gear)}`;
      if (by[key]) { by[key].count++; if (!by[key].precast && g.precast) by[key].precast = g.precast; }
      else by[key] = { type: g.type, name: g.name, gear: g.gear, precast: g.precast, count: 1 };
    }
    return Object.values(by).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  })();

  // Usage timeline: each captured cast (gearLog entry) enriched with target/damage
  // from the action log and TP from the TP log, so each set's employment is shown.
  const allUsage: UsageRow[] = (() => {
    const log = gearLog ?? [];
    if (log.length === 0 || !actionLog) return [];
    const targetsOf = (a: ActionLogEntry) => a.targets ?? (a.mob ? [{ mob: a.mob, damage: a.damage ?? 0, result: a.result ?? 'hit' as const }] : []);
    const actByKey = new Map<string, ActionLogEntry[]>();
    for (const a of actionLog) {
      const k = `${a.player}|${a.name}`;
      const arr = actByKey.get(k); if (arr) arr.push(a); else actByKey.set(k, [a]);
    }
    const tpByPlayer = new Map<string, PartyTpEntry[]>();
    for (const t of partyTpLog ?? []) {
      const arr = tpByPlayer.get(t.player); if (arr) arr.push(t); else tpByPlayer.set(t.player, [t]);
    }
    for (const arr of tpByPlayer.values()) arr.sort((a, b) => a.elapsed - b.elapsed);
    const tpAt = (player: string, elapsed: number): number | null => {
      const arr = tpByPlayer.get(player);
      if (!arr) return null;
      let idx = -1;
      for (let i = 0; i < arr.length; i++) { if (arr[i].elapsed <= elapsed) idx = i; else break; }
      if (idx < 0) return null;
      for (let i = idx; i >= 0; i--) if (arr[i].tp >= 1000) return arr[i].tp;
      return arr[idx].tp;
    };
    const matchAction = (player: string, name: string, elapsed: number): ActionLogEntry | null => {
      const arr = actByKey.get(`${player}|${name}`);
      if (!arr) return null;
      let best: ActionLogEntry | null = null, bestD = Infinity;
      for (const a of arr) { const d = Math.abs(a.elapsed - elapsed); if (d < bestD) { bestD = d; best = a; } }
      return bestD <= 3 ? best : null;
    };
    return log.map(g => {
      const a = matchAction(g.player, g.name, g.elapsed);
      const tgts = a ? targetsOf(a) : [];
      const target = tgts.map(t => t.mob).filter(Boolean).join(', ');
      const damage = tgts.reduce((s, t) => s + (t.damage ?? 0), 0);
      const resisted = tgts.length > 0 && tgts.every(t => t.result === 'resist');
      return { elapsed: g.elapsed, type: g.type, name: g.name, target, tp: g.type === 'ws' ? tpAt(g.player, g.elapsed) : null, damage, resisted, gear: g };
    }).sort((a, b) => a.elapsed - b.elapsed);
  })();
  const usageFor = (key: string): UsageRow[] => {
    if (key === 'states') return [];
    if (key === 'other') { const known = new Set(ACTION_GROUPS.map(g => g.type)); return allUsage.filter(r => !known.has(r.type)); }
    return allUsage.filter(r => r.type === key);
  };

  // State gearsets flattened to ordered cards, most-seen variant first per state.
  const stateSetCards = (() => {
    if (!stateSets) return [];
    const out: { label: string; variant: GearStateVariant; index: number; total: number }[] = [];
    const ord = (l: string) => { const i = STATE_ORDER.indexOf(l); return i < 0 ? 99 : i; };
    for (const label of Object.keys(stateSets).sort((a, b) => ord(a) - ord(b) || a.localeCompare(b))) {
      const variants = (stateSets[label] ?? []).slice().sort((a, b) => b.count - a.count);
      variants.forEach((variant, index) => out.push({ label, variant, index, total: variants.length }));
    }
    return out;
  })();

  const groups: { key: string; label: string; cards: ReactNode[] }[] = [];
  if (stateSetCards.length > 0) {
    groups.push({ key: 'states', label: 'States', cards: stateSetCards.map((c, i) => <StateSetCard key={`st-${i}`} {...c} />) });
  }
  for (const g of ACTION_GROUPS) {
    const sets = actionSets.filter(s => s.type === g.type);
    if (sets.length > 0) groups.push({ key: g.type, label: g.label, cards: sets.map((s, i) => <GearSetCard key={`${g.type}-${i}`} set={s} />) });
  }
  const known = new Set(ACTION_GROUPS.map(g => g.type));
  const otherSets = actionSets.filter(s => !known.has(s.type));
  if (otherSets.length > 0) groups.push({ key: 'other', label: 'Other', cards: otherSets.map((s, i) => <GearSetCard key={`o-${i}`} set={s} />) });

  if (groups.length === 0) return null;
  const active = groups.find(g => g.key === cat) ?? groups[0];

  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-5">
      {headerSlot && (
        <div className="pb-3 mb-3 border-b border-white/10">{headerSlot}</div>
      )}
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-1">Gear Sets</h3>
      <p className="text-[11px] text-gray-400 mb-3">Your captured gear - states worn between actions and the set equipped per action (precast/midcast). FFXI only exposes your own full gear.</p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {groups.map(g => {
          const on = g.key === active.key;
          return (
            <button
              key={g.key}
              onClick={() => setCat(g.key)}
              className={`flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5 border transition-colors ${
                on ? 'bg-accent/20 border-accent/50 text-accent' : 'border-white/10 text-gray-300 hover:bg-white/[0.05]'
              }`}
            >
              {g.label}<span className="font-mono opacity-60">{g.cards.length}</span>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {active.cards}
      </div>
      {(() => {
        const rows = usageFor(active.key);
        return rows.length > 0 ? <GearUsageTable groupKey={active.key} rows={rows} countdown={countdown} /> : null;
      })()}
    </div>
  );
}

export default function GearSets({ gearLog, stateSets, gearByPlayer, actionLog, partyTpLog, countdown }: {
  gearLog?: GearLogEntry[] | null;
  stateSets?: Record<string, GearStateVariant[]> | null;
  gearByPlayer?: Record<string, { gearLog?: GearLogEntry[] | null; stateSets?: Record<string, GearStateVariant[]> | null; buffLog?: BuffLogEntry[] | null; positionLog?: PositionLogEntry[] | null }> | null;
  actionLog?: ActionLogEntry[] | null;
  partyTpLog?: PartyTpEntry[] | null;
  countdown?: boolean;
}) {
  const players = gearByPlayer ? Object.keys(gearByPlayer).sort() : [];
  const [sel, setSel] = useState('');
  if (players.length > 0) {
    const active = players.includes(sel) ? sel : players[0];
    const g = gearByPlayer![active] ?? {};
    const characterTabs = (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mr-1">Character</span>
        {players.map(p => (
          <button
            key={p}
            onClick={() => setSel(p)}
            className={`text-xs px-2.5 py-1 rounded border transition-colors ${active === p ? 'bg-accent/20 border-accent/50 text-accent font-semibold' : 'border-white/10 text-gray-400 hover:bg-white/[0.05]'}`}
          >
            {p}
          </button>
        ))}
      </div>
    );
    return (
      <GearSetsBody
        gearLog={g.gearLog}
        stateSets={g.stateSets}
        actionLog={actionLog}
        partyTpLog={partyTpLog}
        countdown={countdown}
        headerSlot={characterTabs}
      />
    );
  }
  return <GearSetsBody gearLog={gearLog} stateSets={stateSets} actionLog={actionLog} partyTpLog={partyTpLog} countdown={countdown} />;
}
