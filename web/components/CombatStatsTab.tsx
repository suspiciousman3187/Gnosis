'use client';

import { Fragment, useMemo, useState } from 'react';
import JobIcon from '@/components/JobIcon';
import MobSelector, { mobDisplay, type MobOption } from '@/components/MobSelector';
import type { ContentDef } from '@/lib/contentRegistry';
import Collapse from '@/components/Collapse';
import type {
  ParseCombatStats,
  ParsePlayerCombat,
  ParseStatLeaf,
  ParseAbilityMap,
  PartyMember,
  ActionLogEntry,
  PartyHpEntry,
} from '@/lib/types';

function fmtClock(elapsed: number): string {
  const s = Math.max(0, Math.round(elapsed));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

type TakenKind = 'auto' | 'ws' | 'spell' | 'mb' | 'ja' | 'ranged' | 'enfeeb';
type TakenAbility = { name: string; type: TakenKind; count: number; damage: number; maxHit: number; sources: Record<string, number> };
type TakenTypeStat = { damage: number; count: number; maxHit: number };
type TakenBreakdown = {
  total: number;
  hits: number;
  byType: Record<TakenKind, TakenTypeStat>;
  byAbility: TakenAbility[];
  peak1sDamage: number;
  peak1sAt: number;
};

function emptyByType(): Record<TakenKind, TakenTypeStat> {
  return {
    auto:   { damage: 0, count: 0, maxHit: 0 },
    ws:     { damage: 0, count: 0, maxHit: 0 },
    spell:  { damage: 0, count: 0, maxHit: 0 },
    mb:     { damage: 0, count: 0, maxHit: 0 },
    ja:     { damage: 0, count: 0, maxHit: 0 },
    ranged: { damage: 0, count: 0, maxHit: 0 },
    enfeeb: { damage: 0, count: 0, maxHit: 0 },
  };
}

const TAKEN_KIND_LABEL: Record<TakenKind, string> = {
  auto: 'Auto-Attack', ws: 'TP Move', spell: 'Spell', mb: 'Magic Burst',
  ja: 'Job Ability', ranged: 'Ranged', enfeeb: 'Enfeeble',
};

const TAKEN_KIND_BAR: Record<TakenKind, string> = {
  auto: 'bg-sky-500', ws: 'bg-amber-500', spell: 'bg-violet-500',
  mb: 'bg-fuchsia-500', ja: 'bg-emerald-500', ranged: 'bg-teal-500',
  enfeeb: 'bg-rose-500',
};

const TAKEN_KIND_TEXT: Record<TakenKind, string> = {
  auto: 'text-sky-300', ws: 'text-amber-300', spell: 'text-violet-300',
  mb: 'text-fuchsia-300', ja: 'text-emerald-300', ranged: 'text-teal-300',
  enfeeb: 'text-rose-300',
};

function isTakenKind(t: string): t is TakenKind {
  return t === 'auto' || t === 'ws' || t === 'spell' || t === 'mb' ||
         t === 'ja' || t === 'ranged' || t === 'enfeeb';
}

function computeTakenBreakdowns(
  log: ActionLogEntry[] | null | undefined,
  selectedMob: string,
): Record<string, TakenBreakdown> {
  const out: Record<string, TakenBreakdown> = {};
  if (!log) return out;
  const peakBuckets: Record<string, Map<number, number>> = {};
  for (const e of log) {
    if (e.from !== 'boss' && e.from !== 'enemy') continue;
    if (selectedMob !== '_all_' && e.player !== selectedMob) continue;
    if (!isTakenKind(e.type)) continue;
    const targets = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' }] : []);
    for (const t of targets) {
      const dmg = t.damage ?? 0;
      if (dmg <= 0) continue;
      const player = t.mob;
      let b = out[player];
      if (!b) {
        b = { total: 0, hits: 0, byType: emptyByType(), byAbility: [], peak1sDamage: 0, peak1sAt: 0 };
        out[player] = b;
      }
      const kind: TakenKind = (e.type === 'spell' && t.result === 'burst') ? 'mb' : e.type;
      b.total += dmg;
      b.hits += 1;
      const tStat = b.byType[kind];
      tStat.damage += dmg;
      tStat.count += 1;
      if (dmg > tStat.maxHit) tStat.maxHit = dmg;
      const source = e.player;
      const idx = b.byAbility.findIndex(a => a.name === e.name && a.type === kind);
      if (idx >= 0) {
        const a = b.byAbility[idx];
        a.count += 1;
        a.damage += dmg;
        if (dmg > a.maxHit) a.maxHit = dmg;
        if (source) a.sources[source] = (a.sources[source] ?? 0) + 1;
      } else {
        b.byAbility.push({ name: e.name, type: kind, count: 1, damage: dmg, maxHit: dmg, sources: source ? { [source]: 1 } : {} });
      }
      let buckets = peakBuckets[player];
      if (!buckets) { buckets = new Map(); peakBuckets[player] = buckets; }
      const sec = Math.floor(e.elapsed);
      buckets.set(sec, (buckets.get(sec) ?? 0) + dmg);
    }
  }
  for (const [player, buckets] of Object.entries(peakBuckets)) {
    const b = out[player];
    if (!b) continue;
    for (const [sec, dmg] of buckets) {
      if (dmg > b.peak1sDamage) { b.peak1sDamage = dmg; b.peak1sAt = sec; }
    }
  }
  for (const b of Object.values(out)) {
    b.byAbility.sort((a, c) => c.damage - a.damage);
  }
  return out;
}

type HpStress = { lowestHpp: number; timeLowSecs: number };

function computeHpStress(log: PartyHpEntry[] | null | undefined): Record<string, HpStress> {
  const out: Record<string, HpStress> = {};
  if (!log || log.length === 0) return out;
  const byPlayer = new Map<string, PartyHpEntry[]>();
  for (const s of log) {
    let arr = byPlayer.get(s.player);
    if (!arr) { arr = []; byPlayer.set(s.player, arr); }
    arr.push(s);
  }
  for (const [name, arr] of byPlayer) {
    arr.sort((a, b) => a.elapsed - b.elapsed);
    let lowest = 100;
    let timeLow = 0;
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      if (s.hpp < lowest) lowest = s.hpp;
      if (s.hpp < 25 && s.hpp > 0) {
        const next = arr[i + 1];
        const dt = next ? Math.max(0, next.elapsed - s.elapsed) : 1;
        timeLow += Math.min(dt, 5);
      }
    }
    out[name] = { lowestHpp: lowest, timeLowSecs: Math.round(timeLow) };
  }
  return out;
}

type EnfeebResistBucket = { name: string; resists: number; attempts: number };
type MagicDefense = {
  spellResists: number;
  spellAttempts: number;
  enfeebResists: number;
  enfeebAttempts: number;
  enfeebByName: EnfeebResistBucket[];
};

function computeMagicDefense(
  log: ActionLogEntry[] | null | undefined,
  selectedMob: string,
): Record<string, MagicDefense> {
  const out: Record<string, MagicDefense> = {};
  if (!log) return out;
  for (const e of log) {
    if (e.from !== 'boss' && e.from !== 'enemy') continue;
    if (selectedMob !== '_all_' && e.player !== selectedMob) continue;
    if (e.type !== 'spell' && e.type !== 'enfeeb') continue;
    const targets = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' }] : []);
    for (const t of targets) {
      const player = t.mob;
      if (!player) continue;
      let m = out[player];
      if (!m) m = out[player] = { spellResists: 0, spellAttempts: 0, enfeebResists: 0, enfeebAttempts: 0, enfeebByName: [] };
      const resisted = t.result === 'resist';
      if (e.type === 'spell') {
        m.spellAttempts += 1;
        if (resisted) m.spellResists += 1;
      } else {
        m.enfeebAttempts += 1;
        if (resisted) m.enfeebResists += 1;
        let bucket = m.enfeebByName.find(b => b.name === e.name);
        if (!bucket) {
          bucket = { name: e.name, resists: 0, attempts: 0 };
          m.enfeebByName.push(bucket);
        }
        bucket.attempts += 1;
        if (resisted) bucket.resists += 1;
      }
    }
  }
  for (const m of Object.values(out)) {
    m.enfeebByName.sort((a, b) => b.attempts - a.attempts || a.name.localeCompare(b.name));
  }
  return out;
}

const CURE_RE = /^(cure|curaga|cura|full cure|healing breath|healing breeze|pollen|wild carrot|magic fruit|restoral|plenilune embrace|curing waltz|divine waltz|chakra|spring water|healing ruby|sacrosanctity|metta)/i;

type HealCast = { elapsed: number; spell: string; target: string; amount: number; preHpp?: number };
type HealReceived = { elapsed: number; spell: string; healer: string; amount: number; preHpp?: number };
type HealBreakdown = {
  castHealed: number;
  castCount: number;
  castSpells: Map<string, number>;
  castList: HealCast[];
  receivedHealed: number;
  receivedCount: number;
  receivedFromHealer: Map<string, number>;
  receivedList: HealReceived[];
};

function emptyHeal(): HealBreakdown {
  return {
    castHealed: 0, castCount: 0, castSpells: new Map(), castList: [],
    receivedHealed: 0, receivedCount: 0, receivedFromHealer: new Map(), receivedList: [],
  };
}

function buildHpLookup(log: PartyHpEntry[] | null | undefined): (name: string, atSec: number) => number | undefined {
  if (!log || log.length === 0) return () => undefined;
  const byName = new Map<string, PartyHpEntry[]>();
  for (const e of log) {
    let arr = byName.get(e.player);
    if (!arr) { arr = []; byName.set(e.player, arr); }
    arr.push(e);
  }
  for (const arr of byName.values()) arr.sort((a, b) => a.elapsed - b.elapsed);
  return (name, atSec) => {
    const arr = byName.get(name);
    if (!arr || arr.length === 0) return undefined;
    let lo = 0, hi = arr.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].elapsed <= atSec) { idx = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (idx < 0) return undefined;
    return arr[idx].hpp;
  };
}

function computeHealBreakdowns(
  log: ActionLogEntry[] | null | undefined,
  partyNames: Set<string>,
  hpLookup: (name: string, atSec: number) => number | undefined,
): Record<string, HealBreakdown> {
  const out: Record<string, HealBreakdown> = {};
  if (!log) return out;
  for (const e of log) {
    if (!CURE_RE.test(e.name)) continue;
    if (!partyNames.has(e.player)) continue;
    const targets = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' }] : []);
    const amount = targets.reduce((s, t) => s + (t.damage || 0), 0);
    if (amount <= 0) continue;
    let caster = out[e.player];
    if (!caster) caster = out[e.player] = emptyHeal();
    caster.castCount += 1;
    caster.castHealed += amount;
    caster.castSpells.set(e.name, (caster.castSpells.get(e.name) ?? 0) + 1);
    for (const t of targets) {
      const amt = t.damage ?? 0;
      if (!t.mob || amt <= 0) continue;
      const preHpp = hpLookup(t.mob, e.elapsed);
      caster.castList.push({ elapsed: e.elapsed, spell: e.name, target: t.mob, amount: amt, preHpp });
      if (!partyNames.has(t.mob)) continue;
      let recv = out[t.mob];
      if (!recv) recv = out[t.mob] = emptyHeal();
      recv.receivedHealed += amt;
      recv.receivedCount += 1;
      recv.receivedFromHealer.set(e.player, (recv.receivedFromHealer.get(e.player) ?? 0) + amt);
      recv.receivedList.push({ elapsed: e.elapsed, spell: e.name, healer: e.player, amount: amt, preHpp });
    }
  }
  for (const b of Object.values(out)) {
    b.castList.sort((a, c) => a.elapsed - c.elapsed);
    b.receivedList.sort((a, c) => a.elapsed - c.elapsed);
  }
  return out;
}

// ── Math helpers ─────────────────────────────────────────────────────────────

function pct(num: number, denom: number): number {
  if (!denom) return 0;
  return Math.round((num / denom) * 1000) / 10;
}

function avg(leaf: ParseStatLeaf | undefined): number | null {
  if (!leaf?.damage || !leaf?.tally) return null;
  return Math.round(leaf.damage / leaf.tally);
}

function tally(leaf: ParseStatLeaf | undefined): number {
  return leaf?.tally ?? 0;
}

function damage(leaf: ParseStatLeaf | undefined): number {
  return leaf?.damage ?? 0;
}

function maxHit(leaf: ParseStatLeaf | undefined): number {
  return leaf?.max ?? 0;
}

function sumAbilityDamage(m: ParseAbilityMap | undefined): number {
  if (!m) return 0;
  let s = 0;
  for (const v of Object.values(m)) s += v.damage ?? 0;
  return s;
}


export type DmgSegment = { label: string; dmg: number; bar: string; text: string };

export function damageBreakdownFromCombatStats(data: ParsePlayerCombat): DmgSegment[] {
  const ws        = sumAbilityDamage(data.category?.ws);
  const ja        = sumAbilityDamage(data.category?.ja);
  const spell     = sumAbilityDamage(data.category?.spell);
  const mb        = sumAbilityDamage(data.category?.mb);
  const enfeeb    = sumAbilityDamage(data.category?.enfeeb);
  const meleeAuto = damage(data.melee?.melee)  + damage(data.melee?.crit);
  const rangedAuto= damage(data.ranged?.ranged) + damage(data.ranged?.r_crit);
  return ([
    { label: 'Weaponskill', dmg: ws,             bar: 'bg-amber-500',   text: 'text-amber-300'   },
    { label: 'Magic Burst', dmg: mb,             bar: 'bg-fuchsia-500', text: 'text-fuchsia-300' },
    { label: 'Magic',       dmg: spell + enfeeb, bar: 'bg-violet-500',  text: 'text-violet-300'  },
    { label: 'Ranged',      dmg: rangedAuto,     bar: 'bg-teal-500',    text: 'text-teal-300'    },
    { label: 'Ability',     dmg: ja,             bar: 'bg-emerald-500', text: 'text-emerald-300' },
    { label: 'Auto-Attack', dmg: meleeAuto,      bar: 'bg-sky-500',     text: 'text-sky-300'     },
  ]).filter(c => c.dmg > 0).sort((a, b) => b.dmg - a.dmg);
}

export function DamageSpread({ segments }: { segments: DmgSegment[] }) {
  const total = segments.reduce((s, c) => s + c.dmg, 0);
  if (total === 0) return null;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[10px] text-gray-400 uppercase tracking-wide">Damage Spread</span>
        <span className="text-[10px] text-gray-400 font-mono">{total.toLocaleString()} total</span>
      </div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-panel-alt">
        {segments.map(c => (
          <div
            key={c.label}
            className={`h-full ${c.bar}`}
            style={{ width: `${(c.dmg / total) * 100}%` }}
            data-tooltip={`${c.label} · ${c.dmg.toLocaleString()}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mt-1.5 font-mono">
        {segments.map(c => (
          <span key={c.label} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${c.bar}`} />
            <span className={c.text}>{c.label} {Math.round((c.dmg / total) * 100)}% · {c.dmg.toLocaleString()}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// Strikes-per-swing → FFXI multi-attack terminology.
const MULTIHIT_NAMES: Record<number, string> = {
  1: 'Single Attack', 2: 'Double Attack', 3: 'Triple Attack', 4: 'Quadruple Attack',
  5: 'Quintuple Attack', 6: 'Sextuple Attack', 7: 'Septuple Attack', 8: 'Octuple Attack',
};

function sortedAbilities(map: ParseAbilityMap | undefined): [string, ParseStatLeaf][] {
  if (!map) return [];
  return Object.entries(map).sort(([, a], [, b]) => (damage(b) - damage(a)) || (tally(b) - tally(a)));
}

function meleeHitRate(m: ParsePlayerCombat['melee']): number | null {
  const hits   = tally(m?.melee) + tally(m?.crit);
  const misses = tally(m?.miss);
  const total  = hits + misses;
  if (!total) return null;
  return pct(hits, total);
}

function meleeCritRate(m: ParsePlayerCombat['melee']): number | null {
  const hits  = tally(m?.melee);
  const crits = tally(m?.crit);
  const total = hits + crits;
  if (!total) return null;
  return pct(crits, total);
}

function rangedHitRate(r: ParsePlayerCombat['ranged']): number | null {
  const hits   = tally(r?.ranged) + tally(r?.r_crit);
  const misses = tally(r?.r_miss);
  const total  = hits + misses;
  if (!total) return null;
  return pct(hits, total);
}

function rangedCritRate(r: ParsePlayerCombat['ranged']): number | null {
  const hits  = tally(r?.ranged);
  const crits = tally(r?.r_crit);
  const total = hits + crits;
  if (!total) return null;
  return pct(crits, total);
}

function wsHitRate(ws: ParseAbilityMap | undefined, wsMiss: ParseAbilityMap | undefined): number | null {
  let hits = 0, misses = 0;
  if (ws) for (const v of Object.values(ws)) hits += tally(v);
  if (wsMiss) for (const v of Object.values(wsMiss)) misses += tally(v);
  const total = hits + misses;
  if (!total) return null;
  return pct(hits, total);
}

function blockRate(d: ParsePlayerCombat['defense']): number | null {
  const b  = tally(d?.block);
  const nb = tally(d?.nonblock);
  const total = b + nb;
  if (!total) return null;
  return pct(b, total);
}

function parryRate(d: ParsePlayerCombat['defense']): number | null {
  const p  = tally(d?.parry);
  const np = tally(d?.nonparry);
  const total = p + np;
  if (!total) return null;
  return pct(p, total);
}

function evadeRate(d: ParsePlayerCombat['defense']): number | null {
  const e = tally(d?.evade);
  const h = tally(d?.hit);
  const total = e + h;
  if (!total) return null;
  return pct(e, total);
}

function multiAvg(multi: ParsePlayerCombat['multi']): number | null {
  if (!multi) return null;
  let total = 0, count = 0;
  for (let i = 1; i <= 8; i++) {
    const t = tally(multi[String(i)]);
    total += i * t;
    count += t;
  }
  if (!count) return null;
  return Math.round((total / count) * 100) / 100;
}

// Attempt to match "SC-Pla" back to a real player name by 3-char prefix
function matchScToPlayer(scName: string, allPlayerNames: string[]): string {
  const prefix = scName.slice(3).toLowerCase();
  const match = allPlayerNames.find((p) => p.toLowerCase().startsWith(prefix));
  return match ?? scName.slice(3); // fallback: strip "SC-" prefix
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function mergeLeaf(a: ParseStatLeaf | undefined, b: ParseStatLeaf | undefined): ParseStatLeaf {
  const max = Math.max(a?.max ?? 0, b?.max ?? 0);
  const leaf: ParseStatLeaf = {
    tally:  (a?.tally  ?? 0) + (b?.tally  ?? 0),
    damage: (a?.damage ?? 0) + (b?.damage ?? 0),
  };
  if (max > 0) leaf.max = max;
  return leaf;
}

function mergeAbilityMap(a: ParseAbilityMap | undefined, b: ParseAbilityMap | undefined): ParseAbilityMap {
  const result: ParseAbilityMap = { ...(a ?? {}) };
  if (!b) return result;
  for (const [k, v] of Object.entries(b)) {
    result[k] = mergeLeaf(result[k], v);
  }
  return result;
}

function mergePlayerCombat(a: ParsePlayerCombat, b: ParsePlayerCombat): ParsePlayerCombat {
  return {
    total_damage: (a.total_damage ?? 0) + (b.total_damage ?? 0),
    melee: {
      melee: mergeLeaf(a.melee?.melee, b.melee?.melee),
      miss:  mergeLeaf(a.melee?.miss,  b.melee?.miss),
      crit:  mergeLeaf(a.melee?.crit,  b.melee?.crit),
    },
    ranged: {
      ranged: mergeLeaf(a.ranged?.ranged, b.ranged?.ranged),
      r_miss: mergeLeaf(a.ranged?.r_miss, b.ranged?.r_miss),
      r_crit: mergeLeaf(a.ranged?.r_crit, b.ranged?.r_crit),
    },
    category: {
      ws:          mergeAbilityMap(a.category?.ws,          b.category?.ws),
      ja:          mergeAbilityMap(a.category?.ja,          b.category?.ja),
      spell:       mergeAbilityMap(a.category?.spell,       b.category?.spell),
      mb:          mergeAbilityMap(a.category?.mb,          b.category?.mb),
      enfeeb:      mergeAbilityMap(a.category?.enfeeb,      b.category?.enfeeb),
      ws_miss:     mergeAbilityMap(a.category?.ws_miss,     b.category?.ws_miss),
      ja_miss:     mergeAbilityMap(a.category?.ja_miss,     b.category?.ja_miss),
      enfeeb_miss: mergeAbilityMap(a.category?.enfeeb_miss, b.category?.enfeeb_miss),
    },
    other: {
      sc:    mergeLeaf(a.other?.sc,    b.other?.sc),
      add:   mergeLeaf(a.other?.add,   b.other?.add),
      spike: mergeLeaf(a.other?.spike, b.other?.spike),
    },
    multi: (() => {
      const result: ParsePlayerCombat['multi'] = {};
      for (let i = 1; i <= 8; i++) {
        const k = String(i);
        const m = mergeLeaf(a.multi?.[k], b.multi?.[k]);
        if (m.tally) result[k] = m;
      }
      return result;
    })(),
    defense: {
      hit:        mergeLeaf(a.defense?.hit,        b.defense?.hit),
      block:      mergeLeaf(a.defense?.block,      b.defense?.block),
      parry:      mergeLeaf(a.defense?.parry,      b.defense?.parry),
      evade:      mergeLeaf(a.defense?.evade,      b.defense?.evade),
      absorb:     mergeLeaf(a.defense?.absorb,     b.defense?.absorb),
      intimidate: mergeLeaf(a.defense?.intimidate, b.defense?.intimidate),
      shadow:     mergeLeaf(a.defense?.shadow,     b.defense?.shadow),
      anticipate: mergeLeaf(a.defense?.anticipate, b.defense?.anticipate),
      nonblock:   mergeLeaf(a.defense?.nonblock,   b.defense?.nonblock),
      nonparry:   mergeLeaf(a.defense?.nonparry,   b.defense?.nonparry),
      retrate:    mergeLeaf(a.defense?.retrate,    b.defense?.retrate),
      nonret:     mergeLeaf(a.defense?.nonret,     b.defense?.nonret),
    },
  };
}

function aggregateAllMobs(combatStats: ParseCombatStats): Record<string, ParsePlayerCombat> {
  const result: Record<string, ParsePlayerCombat> = {};
  for (const mobData of Object.values(combatStats)) {
    for (const [player, data] of Object.entries(mobData)) {
      result[player] = result[player] ? mergePlayerCombat(result[player], data) : { ...data };
    }
  }
  return result;
}

// ── Shared UI primitives ──────────────────────────────────────────────────────

type PillColor = 'sky' | 'amber' | 'green' | 'purple' | 'orange' | 'rose' | 'teal';

function StatPill({ label, value, color = 'sky' }: { label: string; value: string | number; color?: PillColor }) {
  const colors: Record<PillColor, string> = {
    sky:    'bg-sky-900/30 border-sky-800/40 text-sky-300',
    amber:  'bg-amber-900/30 border-amber-800/40 text-amber-300',
    green:  'bg-emerald-900/30 border-emerald-800/40 text-emerald-300',
    purple: 'bg-white/[0.04] border-white/10 text-gray-300',
    orange: 'bg-orange-900/30 border-orange-800/40 text-orange-300',
    rose:   'bg-rose-900/30 border-rose-800/40 text-rose-300',
    teal:   'bg-teal-900/30 border-teal-800/40 text-teal-300',
  };
  return (
    <div className={`border rounded-lg px-3 py-1.5 text-center ${colors[color]}`}>
      <div className="text-xs text-gray-400 mb-0.5">{label}</div>
      <div className="text-sm font-bold font-mono">{value}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h5 className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1.5">
      {children}
    </h5>
  );
}

// ── Ability table ─────────────────────────────────────────────────────────────

function AbilityTable({
  title, entries, missEntries, showHitRate, accentColor = 'amber',
}: {
  title: string;
  entries: [string, ParseStatLeaf][];
  missEntries?: [string, ParseStatLeaf][];
  showHitRate?: boolean;
  accentColor?: 'amber' | 'sky' | 'teal' | 'rose';
}) {
  if (!entries.length) return null;

  const missMap: Record<string, number> = {};
  if (missEntries) {
    for (const [name, leaf] of missEntries) missMap[name] = tally(leaf);
  }

  const totalDmg  = entries.reduce((s, [, v]) => s + damage(v), 0);
  const totalCnt  = entries.reduce((s, [, v]) => s + tally(v), 0);
  const totalMiss = Object.values(missMap).reduce((s, v) => s + v, 0);
  const overallHitRate = showHitRate ? pct(totalCnt, totalCnt + totalMiss) : null;

  const dmgColors: Record<string, string> = {
    amber: 'text-amber-400',
    sky:   'text-sky-400',
    teal:  'text-teal-400',
    rose:  'text-rose-400',
  };

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <SectionLabel>{title}</SectionLabel>
        {overallHitRate !== null && (
          <span className="text-xs text-sky-400/70 font-mono">{overallHitRate}% land rate</span>
        )}
        {totalDmg > 0 && (
          <span className="text-xs text-gray-400/70 font-mono ml-auto">{totalDmg.toLocaleString()} total</span>
        )}
      </div>
      {/* Wrap the table so its many columns scroll horizontally on narrow
          screens instead of crushing the cell text to overlap. */}
      <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full min-w-[400px] text-xs">
        <thead>
          <tr className="text-gray-400/70 border-b border-white/[0.08]">
            <th className="text-left pb-1">Ability</th>
            <th className="text-right pb-1">Uses</th>
            {showHitRate && <th className="text-right pb-1">Land%</th>}
            {totalDmg > 0 && <th className="text-right pb-1">Avg</th>}
            {totalDmg > 0 && <th className="text-right pb-1">Max</th>}
            {totalDmg > 0 && <th className="text-right pb-1">Total</th>}
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, leaf]) => {
            const a  = avg(leaf);
            const t  = tally(leaf);
            const m  = missMap[name] ?? 0;
            const hr = showHitRate ? pct(t, t + m) : null;
            const missLabel = m > 0 ? ` (${m} miss${m === 1 ? '' : 'es'})` : '';
            return (
              <tr key={name} className="border-b border-white/[0.06] last:border-0">
                <td className="py-1 pr-2 text-gray-100 font-mono">
                  {name.replace(/_/g, ' ')}
                  {showHitRate && m > 0 && (
                    <span className="text-rose-400/60 text-xs ml-1">{missLabel}</span>
                  )}
                </td>
                <td className="py-1 text-right text-gray-400">{t}</td>
                {showHitRate && (
                  <td className={`py-1 text-right font-mono ${hr !== null && hr < 50 ? 'text-rose-400' : 'text-sky-400'}`}>
                    {hr !== null ? `${hr}%` : '-'}
                  </td>
                )}
                {totalDmg > 0 && (
                  <td className={`py-1 text-right font-mono ${dmgColors[accentColor]}`}>
                    {a !== null ? a.toLocaleString() : '-'}
                  </td>
                )}
                {totalDmg > 0 && (
                  <td className="py-1 text-right font-mono text-gray-300">
                    {maxHit(leaf) > 0 ? maxHit(leaf).toLocaleString() : '-'}
                  </td>
                )}
                {totalDmg > 0 && (
                  <td className="py-1 text-right font-mono text-gray-400">
                    {damage(leaf).toLocaleString()}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// ── Multihit section ──────────────────────────────────────────────────────────

function MultihitSection({ multi }: { multi: ParsePlayerCombat['multi'] }) {
  if (!multi) return null;
  const entries: [number, number][] = [];
  let total = 0;
  for (let i = 1; i <= 8; i++) {
    const t = tally(multi[String(i)]);
    if (t > 0) { entries.push([i, t]); total += t; }
  }
  if (entries.length < 2) return null;
  const mavg = multiAvg(multi);
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <SectionLabel>Multihit Distribution</SectionLabel>
        {mavg !== null && (
          <span className="text-xs text-sky-400/70 font-mono">{mavg}× avg strikes/swing</span>
        )}
      </div>
      <div className="flex gap-2 flex-wrap">
        {entries.map(([n, t]) => (
          <StatPill key={n} label={MULTIHIT_NAMES[n] ?? `${n}-Hit`} value={`${pct(t, total)}% (${t})`} color="purple" />
        ))}
      </div>
    </div>
  );
}

// ── Defense section ───────────────────────────────────────────────────────────

function DefenseSection({ defense, magicDefense, hpStress }: { defense: ParsePlayerCombat['defense']; magicDefense?: MagicDefense; hpStress?: HpStress }) {
  if (!defense && !magicDefense && !hpStress) return null;
  const def = defense ?? ({} as NonNullable<ParsePlayerCombat['defense']>);
  const hitCount    = tally(def.hit);
  const critCount   = tally(def.crit_taken);
  const blockCount  = tally(def.block);
  const parryCount  = tally(def.parry);
  const evadeCount  = tally(def.evade);
  const shadowCount = tally(def.shadow);
  const anticCount  = tally(def.anticipate);
  const intimCount  = tally(def.intimidate);
  const meleeData = hitCount + critCount + blockCount + parryCount + evadeCount + shadowCount + anticCount + intimCount > 0;
  const magicData = !!magicDefense && (magicDefense.spellAttempts + magicDefense.enfeebAttempts) > 0;
  const hpData = !!hpStress && (hpStress.lowestHpp < 100 || hpStress.timeLowSecs > 0);
  if (!meleeData && !magicData && !hpData) return null;

  const br     = blockRate(def);
  const pr     = parryRate(def);
  const er     = evadeRate(def);
  const avgHit = avg(def.hit);
  const avgCrit = avg(def.crit_taken);
  const avgBlk = avg(def.block);
  const retR   = (tally(def.retrate) && tally(def.nonret))
    ? pct(tally(def.retrate), tally(def.retrate) + tally(def.nonret))
    : null;
  const critRate = (hitCount + critCount) > 0 ? pct(critCount, hitCount + critCount) : null;

  const spellResistRate = magicDefense && magicDefense.spellAttempts > 0
    ? pct(magicDefense.spellResists, magicDefense.spellAttempts) : null;
  const enfeebResistRate = magicDefense && magicDefense.enfeebAttempts > 0
    ? pct(magicDefense.enfeebResists, magicDefense.enfeebAttempts) : null;

  return (
    <div className="space-y-3">
      {(meleeData || hpData) && (
        <div>
          <SectionLabel>Defense</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {hitCount   > 0 && avgHit !== null && <StatPill label="Avg Hit Taken"    value={avgHit.toLocaleString()} color="orange" />}
            {hitCount   > 0 &&                    <StatPill label="Times Hit"        value={hitCount} color="orange" />}
            {critCount  > 0 && critRate !== null && <StatPill label="Crit Hits Taken" value={`${critCount} (${critRate}%)`} color="rose" />}
            {critCount  > 0 && avgCrit !== null && <StatPill label="Avg Crit Taken" value={avgCrit.toLocaleString()} color="rose" />}
            {shadowCount > 0 &&                   <StatPill label="Shadows"          value={shadowCount} color="purple" />}
            {evadeCount > 0 &&                    <StatPill label={`Evades${er !== null ? ` (${er}%)` : ''}`} value={evadeCount} color="sky" />}
            {blockCount > 0 && br !== null &&      <StatPill label="Block Rate"      value={`${br}%`} color="green" />}
            {blockCount > 0 && avgBlk !== null &&  <StatPill label="Avg Block"       value={avgBlk.toLocaleString()} color="green" />}
            {parryCount > 0 && pr !== null &&      <StatPill label="Parry Rate"      value={`${pr}%`} color="green" />}
            {parryCount > 0 && pr === null &&      <StatPill label="Parries"         value={parryCount} color="green" />}
            {anticCount > 0 &&                    <StatPill label="Anticipate"       value={anticCount} color="teal" />}
            {intimCount > 0 &&                    <StatPill label="Intimidated"      value={intimCount} color="purple" />}
            {retR       !== null &&               <StatPill label="Retaliation Rate" value={`${retR}%`} color="amber" />}
            {hpStress && hpStress.lowestHpp < 100 && <StatPill label="Lowest HP" value={`${hpStress.lowestHpp}%`} color="rose" />}
            {hpStress && hpStress.timeLowSecs > 0 && <StatPill label="Time Below 25% HP" value={`${hpStress.timeLowSecs}s`} color="rose" />}
          </div>
        </div>
      )}

      {magicData && magicDefense && (
        <div>
          <SectionLabel>Magic Defense</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {spellResistRate !== null && (
              <StatPill label="Spell Resist Rate" value={`${magicDefense.spellResists}/${magicDefense.spellAttempts} (${spellResistRate}%)`} color="sky" />
            )}
            {enfeebResistRate !== null && (
              <StatPill label="Enfeeb Resist Rate" value={`${magicDefense.enfeebResists}/${magicDefense.enfeebAttempts} (${enfeebResistRate}%)`} color="purple" />
            )}
          </div>
          {magicDefense.enfeebByName.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {magicDefense.enfeebByName.map(e => {
                const rate = e.attempts > 0 ? pct(e.resists, e.attempts) : 0;
                return (
                  <span key={e.name} className="text-xs font-mono rounded px-2 py-0.5 border bg-purple-500/10 border-purple-400/30 text-purple-200">
                    {e.name}: {e.resists}/{e.attempts} ({rate}%)
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Skillchain summary (mob-level section, not per-player) ────────────────────

function SkillchainSummary({
  scEntries,
  realPlayerNames,
  totalGroupDmg,
  durationSeconds,
}: {
  scEntries: [string, ParsePlayerCombat][];
  realPlayerNames: string[];
  totalGroupDmg: number;
  durationSeconds?: number;
}) {
  if (!scEntries.length) return null;

  // Sort by damage desc
  const sorted = [...scEntries].sort(([, a], [, b]) => (b.total_damage ?? 0) - (a.total_damage ?? 0));
  const totalScDmg = sorted.reduce((s, [, d]) => s + (d.total_damage ?? 0), 0);

  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-4">
      <div className="flex items-center gap-3 mb-3">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Skillchain Damage by Opener</h4>
        <span className="text-xs font-mono text-gray-400/70 ml-auto">
          {totalScDmg.toLocaleString()} total
        </span>
      </div>
      <div className="space-y-2">
        {sorted.map(([scName, data]) => {
          const dmg    = data.total_damage ?? 0;
          const opener = matchScToPlayer(scName, realPlayerNames);
          const share  = totalGroupDmg > 0 ? pct(dmg, totalGroupDmg) : pct(dmg, totalScDmg);
          const dps    = durationSeconds && durationSeconds > 0 ? Math.round(dmg / durationSeconds) : null;
          return (
            <div key={scName} className="flex items-center gap-3">
              <span className="text-xs text-gray-200 font-mono w-28 truncate">{opener}</span>
              <div className="flex-1 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-panel-alt rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white/10 rounded-full"
                    style={{ width: `${totalGroupDmg > 0 ? share : 100}%` }}
                  />
                </div>
                {totalGroupDmg > 0 && (
                  <span className="text-xs font-mono text-gray-400 w-10 text-right">{share}%</span>
                )}
                {/* DPS-primary readout - see the matching comment on the
                    per-player accordion row. Skillchain openers without a
                    duration fall back to showing raw damage. */}
                <div className="w-28 text-right leading-tight">
                  {dps != null ? (
                    <>
                      <div className="text-xs font-mono text-gray-300">{dps.toLocaleString()} <span className="text-gray-400">DPS</span></div>
                      <div className="text-[10px] font-mono text-gray-400">{dmg.toLocaleString()} DMG</div>
                    </>
                  ) : (
                    <div className="text-xs font-mono text-gray-300">{dmg.toLocaleString()}</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SkillchainOpenerSummary({
  combatStats, durationSeconds,
}: {
  combatStats: ParseCombatStats;
  durationSeconds?: number;
}) {
  const { scEntries, realPlayerNames, totalGroupDmg } = useMemo(() => {
    const rawMap = aggregateAllMobs(combatStats);
    const RESERVED = new Set(['total_damage', 'melee', 'ranged', 'category', 'other', 'defense', 'multi']);
    const real: [string, ParsePlayerCombat][] = [];
    const sc: [string, ParsePlayerCombat][] = [];
    for (const [name, data] of Object.entries(rawMap)) {
      if (RESERVED.has(name)) continue;
      if (name.startsWith('SC-')) sc.push([name, data]);
      else real.push([name, data]);
    }
    const names = real.map(([n]) => n);
    const tot = real.reduce((s, [, d]) => s + (d.total_damage ?? 0), 0);
    return { scEntries: sc, realPlayerNames: names, totalGroupDmg: tot };
  }, [combatStats]);

  if (scEntries.length === 0) return null;
  return (
    <SkillchainSummary
      scEntries={scEntries}
      realPlayerNames={realPlayerNames}
      totalGroupDmg={totalGroupDmg}
      durationSeconds={durationSeconds}
    />
  );
}

// ── Per-player accordion ──────────────────────────────────────────────────────

function PlayerTakenRow({
  playerName, data, jobLine, taken, totalGroupTaken, magicDefense, hpStress,
}: {
  playerName: string;
  data: ParsePlayerCombat;
  jobLine: string;
  taken?: TakenBreakdown;
  totalGroupTaken: number;
  magicDefense?: MagicDefense;
  hpStress?: HpStress;
}) {
  const [open, setOpen] = useState(false);
  const total = taken?.total ?? 0;
  const sharePct = totalGroupTaken > 0 ? pct(total, totalGroupTaken) : 0;
  const fmtAvg = (s: TakenTypeStat | undefined) =>
    s && s.count > 0 ? Math.round(s.damage / s.count).toLocaleString() : '-';
  const maxHitTaken = taken
    ? Object.values(taken.byType).reduce((m, t) => (t.maxHit > m ? t.maxHit : m), 0)
    : 0;

  return (
    <div className="border-b border-white/[0.06] last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative w-full text-left hover:bg-white/[0.04] transition-colors overflow-hidden"
      >
        {sharePct > 0 && (
          <div
            className="absolute bottom-0 left-0 h-[2px] bg-rose-400 pointer-events-none"
            style={{ width: `${sharePct}%` }}
          />
        )}
        <div className="relative hidden sm:grid grid-cols-[minmax(0,1.4fr)_repeat(6,minmax(0,1fr))_24px] gap-2 items-center px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <JobIcon job={jobLine} size={26} />
            <div className="min-w-0">
              <div className="text-sm font-bold text-white truncate">{playerName}</div>
              <div className="text-[10px] text-gray-400 font-mono truncate">{jobLine}</div>
            </div>
          </div>
          <div className="text-right text-xs font-mono text-gray-300">{taken?.hits.toLocaleString() ?? 0}</div>
          <div className="text-right text-xs font-mono text-sky-300">{fmtAvg(taken?.byType.auto)}</div>
          <div className="text-right text-xs font-mono text-amber-300">{fmtAvg(taken?.byType.ws)}</div>
          <div className="text-right text-xs font-mono text-violet-300">{fmtAvg(taken?.byType.spell)}</div>
          <div className="text-right text-xs font-mono text-rose-300">{maxHitTaken > 0 ? maxHitTaken.toLocaleString() : '-'}</div>
          <div className="text-right">
            <div className="text-sm font-mono text-rose-400">{total.toLocaleString()}</div>
            <div className="text-[10px] font-mono text-rose-400/60">{sharePct}%</div>
          </div>
          <span className={`text-gray-400/70 text-xs text-center transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
        </div>
        <div className="relative sm:hidden flex items-center gap-3 px-4 py-3">
          <JobIcon job={jobLine} size={26} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white truncate">{playerName}</div>
            <div className="text-[10px] text-gray-400 font-mono truncate">{jobLine}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm font-mono text-rose-400">{total.toLocaleString()}</div>
            <div className="text-[10px] font-mono text-rose-400/60">{sharePct}% · {taken?.hits ?? 0} hits</div>
          </div>
          <span className={`text-gray-400/70 text-xs transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
        </div>
      </button>
      <Collapse open={open}>{() => (
        <div className="px-4 pb-4 space-y-4 border-t border-white/[0.08] pt-4 bg-black/20">
          <TakenDetail taken={taken} defense={data.defense} magicDefense={magicDefense} hpStress={hpStress} />
        </div>
      )}</Collapse>
    </div>
  );
}

function PlayerDealtRow({
  playerName, data, jobLine, totalGroupDmg, durationSeconds, wsTp,
}: {
  playerName: string;
  data: ParsePlayerCombat;
  jobLine: string;
  totalGroupDmg: number;
  durationSeconds?: number;
  wsTp?: { avg: number; count: number };
}) {
  const [open, setOpen] = useState(false);
  const playerDmg = data.total_damage ?? 0;
  const sharePct = totalGroupDmg > 0 ? pct(playerDmg, totalGroupDmg) : 0;
  const dps = durationSeconds && durationSeconds > 0 ? Math.round(playerDmg / durationSeconds) : null;

  const mAcc = meleeHitRate(data.melee);
  const rAcc = rangedHitRate(data.ranged);
  const accuracy = mAcc !== null ? mAcc : rAcc;

  const wsList = sortedAbilities(data.category?.ws);
  const wsHits = wsList.reduce((s, [, v]) => s + tally(v), 0);
  const wsDmg = sumAbilityDamage(data.category?.ws);
  const wsMax = wsList.reduce((m, [, v]) => Math.max(m, maxHit(v)), 0);
  const avgWs = wsHits > 0 ? Math.round(wsDmg / wsHits) : 0;
  const wsPerMin = durationSeconds && durationSeconds > 0 ? wsHits / (durationSeconds / 60) : 0;
  const wsMissCount = sortedAbilities(data.category?.ws_miss).reduce((s, [, v]) => s + tally(v), 0);

  return (
    <div className="border-b border-white/[0.06] last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative w-full text-left hover:bg-white/[0.04] transition-colors overflow-hidden"
      >
        {sharePct > 0 && (
          <div
            className="absolute bottom-0 left-0 h-[2px] bg-amber-400 pointer-events-none"
            style={{ width: `${sharePct}%` }}
          />
        )}
        <div className="relative hidden sm:grid grid-cols-[minmax(0,1.4fr)_repeat(7,minmax(0,1fr))_24px] gap-2 items-center px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <JobIcon job={jobLine} size={26} />
            <div className="min-w-0">
              <div className="text-sm font-bold text-white truncate">{playerName}</div>
              <div className="text-[10px] text-gray-400 font-mono truncate">{jobLine}</div>
            </div>
          </div>
          <div className="text-right text-xs font-mono text-sky-300">{accuracy !== null ? `${accuracy}%` : '-'}</div>
          <div className={`text-right text-xs font-mono ${wsMissCount > 0 ? 'text-rose-300' : 'text-gray-400'}`}>{wsMissCount > 0 ? wsMissCount : '-'}</div>
          <div className="text-right text-xs font-mono text-gray-300">{wsHits > 0 ? wsPerMin.toFixed(1) : '-'}</div>
          <div className="text-right text-xs font-mono text-amber-300">{wsHits > 0 ? avgWs.toLocaleString() : '-'}</div>
          <div className="text-right text-xs font-mono text-amber-400">{wsMax > 0 ? wsMax.toLocaleString() : '-'}</div>
          <div className="text-right text-xs font-mono text-amber-300">{wsTp ? Math.round(wsTp.avg).toLocaleString() : '-'}</div>
          <div className="text-right">
            {dps !== null && (
              <div className="text-sm font-mono text-amber-400">{dps.toLocaleString()} <span className="text-[10px] text-amber-400/50">DPS</span></div>
            )}
            <div className="text-[10px] font-mono text-amber-400/60">{playerDmg.toLocaleString()} · {sharePct}%</div>
          </div>
          <span className={`text-gray-400/70 text-xs text-center transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
        </div>
        <div className="relative sm:hidden flex items-center gap-3 px-4 py-3">
          <JobIcon job={jobLine} size={26} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white truncate">{playerName}</div>
            <div className="text-[10px] text-gray-400 font-mono truncate">{jobLine}</div>
          </div>
          <div className="text-right shrink-0">
            {dps !== null && <div className="text-sm font-mono text-amber-400">{dps.toLocaleString()} DPS</div>}
            <div className="text-[10px] font-mono text-amber-400/60">{playerDmg.toLocaleString()} · {sharePct}%</div>
          </div>
          <span className={`text-gray-400/70 text-xs transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
        </div>
      </button>
      <Collapse open={open}>{() => (
        <div className="px-4 pb-4 space-y-4 border-t border-white/[0.08] pt-4 bg-black/20">
          <DealtDetail data={data} />
        </div>
      )}</Collapse>
    </div>
  );
}

function DealtDetail({ data }: { data: ParsePlayerCombat }) {
  const wsList     = sortedAbilities(data.category?.ws);
  const jaList     = sortedAbilities(data.category?.ja);
  const spellList  = sortedAbilities(data.category?.spell);
  const mbList     = sortedAbilities(data.category?.mb);
  const enfeebList = sortedAbilities(data.category?.enfeeb);

  const hasMelee   = (tally(data.melee?.melee) + tally(data.melee?.crit) + tally(data.melee?.miss)) > 0;
  const hasRanged  = (tally(data.ranged?.ranged) + tally(data.ranged?.r_crit) + tally(data.ranged?.r_miss)) > 0;
  const hasOffense = hasMelee || hasRanged || wsList.length > 0 || jaList.length > 0 ||
                     spellList.length > 0 || mbList.length > 0 || enfeebList.length > 0;

  const hitRate  = meleeHitRate(data.melee);
  const critRate = meleeCritRate(data.melee);
  const meleeAvg = avg(data.melee?.melee);
  const critAvg  = avg(data.melee?.crit);

  const rHitRate  = rangedHitRate(data.ranged);
  const rCritRate = rangedCritRate(data.ranged);
  const rangedAvg = avg(data.ranged?.ranged);
  const rCritAvg  = avg(data.ranged?.r_crit);
  const rHits     = tally(data.ranged?.ranged) + tally(data.ranged?.r_crit);
  const rMisses   = tally(data.ranged?.r_miss);

  const scDmg    = damage(data.other?.sc);
  const scCnt    = tally(data.other?.sc);
  const addDmg   = damage(data.other?.add);
  const addCnt   = tally(data.other?.add);
  const spkDmg   = damage(data.other?.spike);
  const spkCnt   = tally(data.other?.spike);
  const hasOther = scDmg + addDmg + spkDmg > 0;

  return (
    <>
      <DamageSpread segments={damageBreakdownFromCombatStats(data)} />

      {hasMelee && (
        <div>
          <SectionLabel>Melee</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {hitRate  !== null && <StatPill label="Hit Rate"   value={`${hitRate}%`}  color="sky" />}
            {critRate !== null && <StatPill label="Crit Rate"  value={`${critRate}%`} color="amber" />}
            {meleeAvg !== null && <StatPill label="Avg Hit"    value={meleeAvg.toLocaleString()} color="purple" />}
            {critAvg  !== null && <StatPill label="Avg Crit"   value={critAvg.toLocaleString()}  color="amber" />}
            <StatPill label="Hits"    value={tally(data.melee?.melee) + tally(data.melee?.crit)} color="purple" />
            <StatPill label="Misses"  value={tally(data.melee?.miss)} color="orange" />
          </div>
        </div>
      )}

      {hasRanged && (
        <div>
          <SectionLabel>Ranged</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {rHitRate  !== null && <StatPill label="Hit Rate"  value={`${rHitRate}%`}  color="sky" />}
            {rCritRate !== null && <StatPill label="Crit Rate" value={`${rCritRate}%`} color="amber" />}
            {rangedAvg !== null && <StatPill label="Avg Hit"   value={rangedAvg.toLocaleString()} color="purple" />}
            {rCritAvg  !== null && <StatPill label="Avg Crit"  value={rCritAvg.toLocaleString()}  color="amber" />}
            {rHits     > 0      && <StatPill label="Hits"      value={rHits}    color="purple" />}
            {rMisses   > 0      && <StatPill label="Misses"    value={rMisses}  color="orange" />}
          </div>
        </div>
      )}

      <MultihitSection multi={data.multi} />

      <AbilityTable
        title="Weapon Skills"
        entries={wsList}
        missEntries={sortedAbilities(data.category?.ws_miss)}
        showHitRate={true}
        accentColor="amber"
      />

      <AbilityTable
        title="Job Abilities"
        entries={jaList}
        missEntries={sortedAbilities(data.category?.ja_miss)}
        showHitRate={jaList.some(([, v]) => damage(v) > 0)}
        accentColor="sky"
      />

      <AbilityTable
        title="Spells"
        entries={spellList}
        accentColor="teal"
      />

      {mbList.length > 0 && (
        <div>
          <div className="flex items-baseline gap-2 mb-1.5">
            <SectionLabel>Magic Bursts</SectionLabel>
            <span className="text-xs text-teal-400/60 font-mono">
              {mbList.reduce((s, [, v]) => s + tally(v), 0)} bursts /{' '}
              {mbList.reduce((s, [, v]) => s + damage(v), 0).toLocaleString()} dmg
            </span>
          </div>
          <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full min-w-[380px] text-xs">
            <thead>
              <tr className="text-gray-400/70 border-b border-white/[0.08]">
                <th className="text-left pb-1">Spell</th>
                <th className="text-right pb-1">Bursts</th>
                <th className="text-right pb-1">Avg</th>
                <th className="text-right pb-1">Max</th>
                <th className="text-right pb-1">Total</th>
              </tr>
            </thead>
            <tbody>
              {mbList.map(([name, leaf]) => (
                <tr key={name} className="border-b border-white/[0.06] last:border-0">
                  <td className="py-1 pr-2 text-gray-100 font-mono">{name.replace(/_/g, ' ')}</td>
                  <td className="py-1 text-right text-gray-400">{tally(leaf)}</td>
                  <td className="py-1 text-right font-mono text-teal-400">
                    {avg(leaf) !== null ? avg(leaf)!.toLocaleString() : '-'}
                  </td>
                  <td className="py-1 text-right font-mono text-gray-300">
                    {maxHit(leaf) > 0 ? maxHit(leaf).toLocaleString() : '-'}
                  </td>
                  <td className="py-1 text-right font-mono text-gray-400">{damage(leaf).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {enfeebList.length > 0 && (
        <div>
          <div className="flex items-baseline gap-2 mb-1.5">
            <SectionLabel>Enfeebles</SectionLabel>
            {(() => {
              const lands  = enfeebList.reduce((s, [, v]) => s + tally(v), 0);
              const misses = sortedAbilities(data.category?.enfeeb_miss).reduce((s, [, v]) => s + tally(v), 0);
              return lands + misses > 0 ? (
                <span className="text-xs font-mono text-sky-400/70">
                  {pct(lands, lands + misses)}% land rate ({lands}/{lands + misses})
                </span>
              ) : null;
            })()}
          </div>
          <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full min-w-[340px] text-xs">
            <thead>
              <tr className="text-gray-400/70 border-b border-white/[0.08]">
                <th className="text-left pb-1">Spell</th>
                <th className="text-right pb-1">Lands</th>
                <th className="text-right pb-1">Resists</th>
                <th className="text-right pb-1">Land%</th>
              </tr>
            </thead>
            <tbody>
              {enfeebList.map(([name, leaf]) => {
                const missLeaf = (data.category?.enfeeb_miss ?? {})[name];
                const lands   = tally(leaf);
                const resists = tally(missLeaf);
                const landPct = pct(lands, lands + resists);
                return (
                  <tr key={name} className="border-b border-white/[0.06] last:border-0">
                    <td className="py-1 pr-2 text-gray-100 font-mono">{name.replace(/_/g, ' ')}</td>
                    <td className="py-1 text-right text-emerald-400">{lands}</td>
                    <td className="py-1 text-right text-rose-400/70">{resists > 0 ? resists : '-'}</td>
                    <td className={`py-1 text-right font-mono font-semibold ${landPct < 50 ? 'text-rose-400' : landPct < 75 ? 'text-amber-400' : 'text-sky-400'}`}>
                      {lands + resists > 0 ? `${landPct}%` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {hasOther && (
        <div>
          <SectionLabel>Additional Damage</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {scDmg  > 0 && <StatPill label={`SC Procs (${scCnt})`}         value={scDmg.toLocaleString()}  color="purple" />}
            {addDmg > 0 && <StatPill label={`Add. Effects (${addCnt})`}     value={addDmg.toLocaleString()} color="sky" />}
            {spkDmg > 0 && <StatPill label={`Spikes/Counter (${spkCnt})`}   value={spkDmg.toLocaleString()} color="amber" />}
          </div>
        </div>
      )}

      {!hasOffense && (
        <p className="text-xs text-gray-400 italic">No offensive combat data recorded for this player.</p>
      )}
    </>
  );
}

function TakenSpread({ byType, total, peak1sDamage, peak1sAt }: { byType: Record<TakenKind, TakenTypeStat>; total: number; peak1sDamage?: number; peak1sAt?: number }) {
  if (total <= 0) return null;
  const segments = (Object.keys(byType) as TakenKind[])
    .map(k => ({ k, v: byType[k].damage }))
    .filter(s => s.v > 0)
    .sort((a, b) => b.v - a.v);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[10px] text-gray-400 uppercase tracking-wide">Damage Taken by Source</span>
        <span className="text-[10px] text-gray-400 font-mono">
          {peak1sDamage != null && peak1sDamage > 0 && (
            <span className="text-rose-400/80 mr-3">Peak: {peak1sDamage.toLocaleString()} @ {fmtClock(peak1sAt ?? 0)}</span>
          )}
          {total.toLocaleString()} total
        </span>
      </div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-panel-alt">
        {segments.map(s => (
          <div
            key={s.k}
            className={`h-full ${TAKEN_KIND_BAR[s.k]}`}
            style={{ width: `${(s.v / total) * 100}%` }}
            data-tooltip={`${TAKEN_KIND_LABEL[s.k]} · ${s.v.toLocaleString()}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mt-1.5 font-mono">
        {segments.map(s => (
          <span key={s.k} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${TAKEN_KIND_BAR[s.k]}`} />
            <span className={TAKEN_KIND_TEXT[s.k]}>
              {TAKEN_KIND_LABEL[s.k]} {Math.round((s.v / total) * 100)}% · {s.v.toLocaleString()}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function TakenDetail({ taken, defense, magicDefense, hpStress }: { taken?: TakenBreakdown; defense?: ParsePlayerCombat['defense']; magicDefense?: MagicDefense; hpStress?: HpStress }) {
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const toggleSources = (key: string) => setExpandedSources(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const SOURCE_LIMIT = 4;
  const hasTaken = taken && taken.total > 0;
  const sumOfHits = taken ? Object.values(taken.byType).reduce((s, n) => s + n.damage, 0) : 0;
  return (
    <>
      {hasTaken ? <TakenSpread byType={taken.byType} total={taken.total} peak1sDamage={taken.peak1sDamage} peak1sAt={taken.peak1sAt} /> : null}

      {hasTaken && (
        <div>
          <SectionLabel>Enemy Attacks</SectionLabel>
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full min-w-[420px] text-xs" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col />
                <col style={{ width: '72px' }} />
                <col style={{ width: '48px' }} />
                <col style={{ width: '56px' }} />
                <col style={{ width: '64px' }} />
                <col style={{ width: '72px' }} />
                <col style={{ width: '48px' }} />
              </colgroup>
              <thead>
                <tr className="text-gray-400/70 border-b border-white/[0.08]">
                  <th className="text-left pb-1">Ability</th>
                  <th className="text-left pb-1">Type</th>
                  <th className="text-right pb-1">Uses</th>
                  <th className="text-right pb-1">Avg</th>
                  <th className="text-right pb-1">Max</th>
                  <th className="text-right pb-1">Total</th>
                  <th className="text-right pb-1">Share</th>
                </tr>
              </thead>
              <tbody>
                {taken!.byAbility.map(a => {
                  const share = sumOfHits > 0 ? Math.round((a.damage / sumOfHits) * 100) : 0;
                  const avgHit = a.count > 0 ? Math.round(a.damage / a.count) : 0;
                  const sourceList = Object.entries(a.sources).sort((x, y) => y[1] - x[1]);
                  const rowKey = `${a.type}:${a.name}`;
                  const expanded = expandedSources.has(rowKey);
                  const visible = expanded ? sourceList : sourceList.slice(0, SOURCE_LIMIT);
                  const hiddenCount = sourceList.length - visible.length;
                  return (
                    <tr key={rowKey} className="border-b border-white/[0.06] last:border-0 align-top">
                      <td className="py-1 pr-2 min-w-0">
                        <div className="text-gray-100 font-mono truncate">{a.name.replace(/_/g, ' ')}</div>
                        {sourceList.length > 0 && (
                          <div className="text-[10px] text-gray-400 mt-0.5 leading-tight flex flex-wrap gap-x-1.5 gap-y-0.5">
                            {visible.map(([name, n]) => (
                              <span key={name} className="shrink-0">
                                <span className="text-gray-400">{name.replace(/_/g, ' ')}</span>
                                {n > 1 && <span className="text-gray-400"> ×{n}</span>}
                              </span>
                            ))}
                            {hiddenCount > 0 && !expanded && (
                              <button
                                onClick={() => toggleSources(rowKey)}
                                className="text-accent/80 hover:text-accent shrink-0 font-medium"
                              >
                                +{hiddenCount} more
                              </button>
                            )}
                            {expanded && sourceList.length > SOURCE_LIMIT && (
                              <button
                                onClick={() => toggleSources(rowKey)}
                                className="text-gray-400 hover:text-gray-300 shrink-0"
                              >
                                show less
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className={`py-1 pr-2 text-[10px] uppercase tracking-wide ${TAKEN_KIND_TEXT[a.type]}`}>{TAKEN_KIND_LABEL[a.type]}</td>
                      <td className="py-1 text-right text-gray-400">{a.count}</td>
                      <td className="py-1 text-right font-mono text-gray-300">{avgHit.toLocaleString()}</td>
                      <td className="py-1 text-right font-mono text-gray-300">{a.maxHit.toLocaleString()}</td>
                      <td className="py-1 text-right font-mono text-rose-300">{a.damage.toLocaleString()}</td>
                      <td className="py-1 text-right font-mono text-gray-400">{share}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DefenseSection defense={defense} magicDefense={magicDefense} hpStress={hpStress} />

      {!hasTaken && !defense && !magicDefense && !hpStress && (
        <p className="text-xs text-gray-400 italic">No incoming damage or defensive data recorded for this player.</p>
      )}
    </>
  );
}


function HealingPanel({
  breakdowns,
  party,
  durationSeconds,
  partyMaxHp,
}: {
  breakdowns: Record<string, HealBreakdown>;
  party: PartyMember[];
  durationSeconds?: number;
  partyMaxHp?: Record<string, number> | null;
}) {
  const fmtTargetHp = (preHpp: number | undefined, name: string): string => {
    if (preHpp == null) return '-';
    const max = partyMaxHp?.[name];
    if (max && max > 0) {
      const cur = Math.round((preHpp / 100) * max);
      return `${cur.toLocaleString()} / ${max.toLocaleString()}`;
    }
    return `${preHpp}%`;
  };
  const healDeltaPct = (amount: number, name: string): number | null => {
    const max = partyMaxHp?.[name];
    if (!max || max <= 0) return null;
    return Math.round((amount / max) * 1000) / 10;
  };
  const jobByPlayer = new Map(party.map(m => [m.name, m.mainJob]));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });

  const rows = Object.entries(breakdowns)
    .filter(([, h]) => h.castHealed > 0 || h.receivedHealed > 0)
    .sort((a, b) => (b[1].castHealed + b[1].receivedHealed) - (a[1].castHealed + a[1].receivedHealed));

  if (rows.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 text-sm">
        No healing recorded.
      </div>
    );
  }

  return (
    <>
      <div className="hidden sm:grid grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_24px] gap-2 px-4 py-2 border-b border-white/10 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
        <div>Player</div>
        <div className="text-right">HP Healed</div>
        <div className="text-right">Casts</div>
        <div className="text-right">HP Received</div>
        <div className="text-right">Times Healed</div>
        <div></div>
      </div>

      {(() => {
        const totalCast = rows.reduce((s, [, r]) => s + r.castHealed, 0);
        return rows.map(([name, h]) => {
        const isOpen = expanded.has(name);
        const job = jobByPlayer.get(name) ?? '';
        const sharePct = totalCast > 0 ? pct(h.castHealed, totalCast) : 0;
        return (
          <Fragment key={name}>
            <button
              type="button"
              onClick={() => toggle(name)}
              className="relative w-full grid grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_24px] gap-2 px-4 py-2 border-b border-white/[0.08] text-sm hover:bg-white/[0.03] text-left items-center overflow-hidden"
            >
              {sharePct > 0 && (
                <div
                  className="absolute bottom-0 left-0 h-[2px] bg-emerald-400 pointer-events-none"
                  style={{ width: `${sharePct}%` }}
                />
              )}
              <div className="flex items-center gap-2 min-w-0">
                <JobIcon job={job} label={job} size={28} />
                <span className="text-white truncate">{name}</span>
              </div>
              <div className="text-right font-mono text-emerald-200">{h.castHealed > 0 ? h.castHealed.toLocaleString() : <span className="text-gray-400">-</span>}</div>
              <div className="text-right font-mono text-gray-300">{h.castCount > 0 ? h.castCount.toLocaleString() : <span className="text-gray-400">-</span>}</div>
              <div className="text-right font-mono text-emerald-200">{h.receivedHealed > 0 ? h.receivedHealed.toLocaleString() : <span className="text-gray-400">-</span>}</div>
              <div className="text-right font-mono text-gray-300">{h.receivedCount > 0 ? h.receivedCount.toLocaleString() : <span className="text-gray-400">-</span>}</div>
              <div className="text-right text-gray-400">{isOpen ? '▾' : '▸'}</div>
            </button>
            <Collapse open={isOpen}>{() => (
              <div className="bg-panel-alt/30 border-b border-white/[0.08] px-4 py-3 space-y-4">
                {h.castList.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-emerald-300/70 mb-2 font-semibold">Healing Cast</div>
                    {h.castSpells.size > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {Array.from(h.castSpells.entries())
                          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                          .map(([sp, n]) => (
                            <span key={sp} className="text-xs font-mono rounded px-2 py-0.5 border bg-emerald-500/10 border-emerald-400/30 text-emerald-200">
                              {sp}{n > 1 ? ` ×${n}` : ''}
                            </span>
                          ))}
                      </div>
                    )}
                    <div className="overflow-x-auto -mx-4 px-4">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-400 text-xs border-b border-white/10">
                            <th className="text-right pb-1 w-20">Time</th>
                            <th className="text-left pb-1 px-3">Spell</th>
                            <th className="text-left pb-1">Target</th>
                            <th className="text-right pb-1 w-32">Target HP</th>
                            <th className="text-right pb-1 w-24">HP Healed</th>
                            <th className="text-right pb-1 w-20">% Healed</th>
                          </tr>
                        </thead>
                        <tbody>
                          {h.castList.map((c, i) => {
                            const deltaPct = healDeltaPct(c.amount, c.target);
                            return (
                            <tr key={i} className="border-b border-white/[0.05] last:border-0">
                              <td className="py-1 text-right text-gray-400 font-mono text-xs pr-3">{fmtClock(c.elapsed)}</td>
                              <td className="py-1 px-3 text-emerald-200">{c.spell}</td>
                              <td className="py-1 text-gray-400 text-xs">{c.target}</td>
                              <td className={`py-1 text-right font-mono text-xs ${c.preHpp == null ? 'text-gray-400' : c.preHpp < 25 ? 'text-rose-400' : c.preHpp < 50 ? 'text-amber-400' : c.preHpp < 75 ? 'text-yellow-300/80' : 'text-gray-400'}`}>
                                {fmtTargetHp(c.preHpp, c.target)}
                              </td>
                              <td className="py-1 text-right text-emerald-200 font-mono">+{c.amount.toLocaleString()}</td>
                              <td className="py-1 text-right font-mono text-xs text-emerald-300/80">{deltaPct != null ? `${deltaPct}%` : '-'}</td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {h.receivedList.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-emerald-300/70 mb-2 font-semibold">Healing Received</div>
                    {h.receivedFromHealer.size > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {Array.from(h.receivedFromHealer.entries())
                          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                          .map(([healer, amt]) => (
                            <span key={healer} className="text-xs font-mono rounded px-2 py-0.5 border bg-emerald-500/10 border-emerald-400/30 text-emerald-200">
                              {healer}: {amt.toLocaleString()}
                            </span>
                          ))}
                      </div>
                    )}
                    <div className="overflow-x-auto -mx-4 px-4">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-400 text-xs border-b border-white/10">
                            <th className="text-right pb-1 w-20">Time</th>
                            <th className="text-left pb-1 px-3">Spell</th>
                            <th className="text-left pb-1">From</th>
                            <th className="text-right pb-1 w-32">Target HP</th>
                            <th className="text-right pb-1 w-24">HP Healed</th>
                            <th className="text-right pb-1 w-20">% Healed</th>
                          </tr>
                        </thead>
                        <tbody>
                          {h.receivedList.map((c, i) => {
                            const deltaPct = healDeltaPct(c.amount, name);
                            return (
                            <tr key={i} className="border-b border-white/[0.05] last:border-0">
                              <td className="py-1 text-right text-gray-400 font-mono text-xs pr-3">{fmtClock(c.elapsed)}</td>
                              <td className="py-1 px-3 text-emerald-200">{c.spell}</td>
                              <td className="py-1 text-gray-400 text-xs">{c.healer}</td>
                              <td className={`py-1 text-right font-mono text-xs ${c.preHpp == null ? 'text-gray-400' : c.preHpp < 25 ? 'text-rose-400' : c.preHpp < 50 ? 'text-amber-400' : c.preHpp < 75 ? 'text-yellow-300/80' : 'text-gray-400'}`}>
                                {fmtTargetHp(c.preHpp, name)}
                              </td>
                              <td className="py-1 text-right text-emerald-200 font-mono">+{c.amount.toLocaleString()}</td>
                              <td className="py-1 text-right font-mono text-xs text-emerald-300/80">{deltaPct != null ? `${deltaPct}%` : '-'}</td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}</Collapse>
          </Fragment>
        );
      });
      })()}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CombatStatsTab({
  combatStats,
  party,
  durationSeconds,
  actionLog,
  partyHpLog,
  partyMaxHp,
  contentDef,
}: {
  combatStats: ParseCombatStats;
  party: PartyMember[];
  durationSeconds?: number;
  actionLog?: ActionLogEntry[] | null;
  partyHpLog?: PartyHpEntry[] | null;
  partyMaxHp?: Record<string, number> | null;
  contentDef?: ContentDef | null;
}) {
  const mobNames = Object.keys(combatStats).sort();
  const mobOptions = useMemo<MobOption[]>(() => {
    const finalBosses = new Set<string>();
    const midBosses = new Set<string>();
    for (const b of contentDef?.bosses ?? []) {
      if (b.category === 'final') finalBosses.add(b.name.toLowerCase());
      else if (b.category === 'mid' || b.category === 'mini-nm' || b.category === 'naakual') midBosses.add(b.name.toLowerCase());
    }
    return mobNames.map(n => {
      const label = mobDisplay(n);
      const key = label.toLowerCase();
      const group: MobOption['group'] = finalBosses.has(key) ? 'boss' : midBosses.has(key) ? 'miniboss' : 'other';
      return { value: n, label, group };
    });
  }, [mobNames, contentDef]);
  const [selectedMob, setSelectedMob] = useState<string>('_all_');
  const [viewType, setViewType] = useState<'dealt' | 'taken' | 'healing'>('dealt');
  const takenBreakdowns = useMemo(() => computeTakenBreakdowns(actionLog, selectedMob), [actionLog, selectedMob]);
  const magicDefenseByPlayer = useMemo(() => computeMagicDefense(actionLog, selectedMob), [actionLog, selectedMob]);
  const hpStressByPlayer = useMemo(() => computeHpStress(partyHpLog), [partyHpLog]);
  const partyNameSet = useMemo(() => new Set(party.map(m => m.name)), [party]);
  const healBreakdowns = useMemo(() => {
    const lookup = buildHpLookup(partyHpLog);
    return computeHealBreakdowns(actionLog, partyNameSet, lookup);
  }, [actionLog, partyNameSet, partyHpLog]);

  const jobMap: Record<string, string> = {};
  for (const p of party) {
    jobMap[p.name] = p.mainJob === 'TRUST'
      ? 'TRUST'
      : `${p.mainJob}${p.mainLevel}/${p.subJob}${p.subLevel}`;
  }

  const rawMap = useMemo<Record<string, ParsePlayerCombat>>(
    () => selectedMob === '_all_'
      ? aggregateAllMobs(combatStats)
      : (combatStats[selectedMob] ?? {}),
    [combatStats, selectedMob],
  );

  const effectiveDuration = useMemo(() => {
    if (selectedMob === '_all_') return durationSeconds;
    if (!actionLog || actionLog.length === 0) return durationSeconds;
    let first = Infinity, last = -Infinity;
    for (const e of actionLog) {
      const tgts = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0 }] : []);
      for (const t of tgts) {
        if (t.mob !== selectedMob) continue;
        if ((t.damage ?? 0) <= 0) continue;
        if (e.elapsed < first) first = e.elapsed;
        if (e.elapsed > last)  last  = e.elapsed;
      }
    }
    if (first === Infinity || last === -Infinity) return durationSeconds;
    const span = Math.max(1, last - first);
    return span;
  }, [selectedMob, actionLog, durationSeconds]);

  const wsTpByPlayer = useMemo<Record<string, { avg: number; count: number }>>(() => {
    const acc: Record<string, { sum: number; count: number }> = {};
    if (!actionLog) return {};
    for (const e of actionLog) {
      if (e.type !== 'ws') continue;
      if (typeof e.tp !== 'number') continue;
      if (selectedMob !== '_all_') {
        const tgts = e.targets ?? (e.mob ? [{ mob: e.mob }] : []);
        if (!tgts.some(t => t.mob === selectedMob)) continue;
      }
      const a = acc[e.player] ?? { sum: 0, count: 0 };
      a.sum += Math.max(1000, e.tp);
      a.count += 1;
      acc[e.player] = a;
    }
    const out: Record<string, { avg: number; count: number }> = {};
    for (const [p, { sum, count }] of Object.entries(acc)) {
      if (count > 0) out[p] = { avg: sum / count, count };
    }
    return out;
  }, [actionLog, selectedMob]);

  const RESERVED_KEYS = new Set([
    'total_damage', 'melee', 'ranged', 'category', 'other', 'defense', 'multi',
  ]);

  const realPlayers: [string, ParsePlayerCombat][] = [];
  const scEntries:   [string, ParsePlayerCombat][] = [];
  for (const [name, data] of Object.entries(rawMap)) {
    if (RESERVED_KEYS.has(name)) continue;
    if (name.startsWith('SC-')) scEntries.push([name, data]);
    else if (partyNameSet.has(name)) realPlayers.push([name, data]);
  }

  const takenByPlayer: Record<string, number> = {};
  for (const [name] of realPlayers) {
    takenByPlayer[name] = takenBreakdowns[name]?.total ?? 0;
  }
  const totalGroupTaken = Object.values(takenByPlayer).reduce((s, n) => s + n, 0);

  const sortedPlayers = [...realPlayers].sort(([n1, a], [n2, b]) => viewType === 'dealt'
    ? (b.total_damage ?? 0) - (a.total_damage ?? 0)
    : (takenByPlayer[n2] ?? 0) - (takenByPlayer[n1] ?? 0));
  const totalGroupDmg = sortedPlayers.reduce((s, [, d]) => s + (d.total_damage ?? 0), 0);
  const totalScDmg    = scEntries.reduce((s, [, d]) => s + (d.total_damage ?? 0), 0);
  const healTotalCast = Object.values(healBreakdowns).reduce((s, h) => s + h.castHealed, 0);
  const healTotalReceived = Object.values(healBreakdowns).reduce((s, h) => s + h.receivedHealed, 0);

  return (
    <div className="space-y-4">
      {(() => {
        const dps = effectiveDuration && effectiveDuration > 0 ? Math.round(totalGroupDmg / effectiveDuration) : null;
        const dpst = effectiveDuration && effectiveDuration > 0 ? Math.round(totalGroupTaken / effectiveDuration) : null;
        const hps = effectiveDuration && effectiveDuration > 0 ? Math.round(healTotalCast / effectiveDuration) : null;
        const metrics: { label: string; value: string; tone: string }[] =
          viewType === 'dealt'
            ? [
                { label: 'Total DPS',    value: dps != null ? dps.toLocaleString() : '-', tone: 'text-amber-300' },
                { label: 'Total Damage', value: totalGroupDmg.toLocaleString(),           tone: 'text-amber-300' },
                ...(totalScDmg > 0 ? [{ label: 'SC Damage', value: totalScDmg.toLocaleString(), tone: 'text-gray-300' }] : []),
              ]
            : viewType === 'taken'
            ? [
                { label: 'Total DPS Taken', value: dpst != null ? dpst.toLocaleString() : '-', tone: 'text-rose-300' },
                { label: 'Total Damage Taken', value: totalGroupTaken.toLocaleString(),         tone: 'text-rose-300' },
              ]
            : [
                { label: 'Total HPS',          value: hps != null ? hps.toLocaleString() : '-', tone: 'text-emerald-300' },
                { label: 'Total HP Healed',    value: healTotalCast.toLocaleString(),            tone: 'text-emerald-300' },
                ...(healTotalReceived > 0 ? [{ label: 'Total HP Received', value: healTotalReceived.toLocaleString(), tone: 'text-emerald-300/80' }] : []),
              ];
        return (
          <div className="relative z-30 bg-row-even border border-white/10 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
            <div className="w-full sm:w-56 shrink-0">
              <MobSelector options={mobOptions} value={selectedMob} onChange={setSelectedMob} bossColor={contentDef?.color} />
            </div>
            <div className="flex-1 flex flex-wrap items-start justify-start sm:justify-end gap-x-8 gap-y-3">
              {metrics.map(m => (
                <div key={m.label} className="text-right min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold whitespace-nowrap">{m.label}</div>
                  <div className={`text-xl font-mono font-semibold ${m.tone} tabular-nums`}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <div className="bg-row-even border border-white/10 rounded-xl overflow-hidden">
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setViewType('dealt')}
            className={`relative flex-1 flex items-center justify-center px-3 py-2.5 text-sm font-medium transition-colors ${viewType === 'dealt' ? 'text-amber-300' : 'text-gray-400 hover:text-white'}`}
          >
            Offense {viewType === 'dealt' && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-amber-400" />}
          </button>
          <button
            onClick={() => setViewType('taken')}
            className={`relative flex-1 flex items-center justify-center px-3 py-2.5 text-sm font-medium transition-colors ${viewType === 'taken' ? 'text-rose-300' : 'text-gray-400 hover:text-white'}`}
          >
            Defense {viewType === 'taken' && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-rose-400" />}
          </button>
          <button
            onClick={() => setViewType('healing')}
            className={`relative flex-1 flex items-center justify-center px-3 py-2.5 text-sm font-medium transition-colors ${viewType === 'healing' ? 'text-emerald-300' : 'text-gray-400 hover:text-white'}`}
          >
            Healing {viewType === 'healing' && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-emerald-400" />}
          </button>
        </div>

        {viewType === 'healing' ? (
          <HealingPanel breakdowns={healBreakdowns} party={party} durationSeconds={effectiveDuration} partyMaxHp={partyMaxHp} />
        ) : sortedPlayers.length === 0 && scEntries.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            No combat data for {selectedMob === '_all_' ? 'any mob' : selectedMob.replace(/_/g, ' ')}.
          </div>
        ) : viewType === 'taken' ? (
          <>
            <div className="hidden sm:grid grid-cols-[minmax(0,1.4fr)_repeat(6,minmax(0,1fr))_24px] gap-2 px-4 py-2 border-b border-white/10 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
              <div>Player</div>
              <div className="text-right">Times Hit</div>
              <div className="text-right">Auto Avg</div>
              <div className="text-right">TP Move Avg</div>
              <div className="text-right">Spell Avg</div>
              <div className="text-right">Max Hit</div>
              <div className="text-right">Total Taken</div>
              <div></div>
            </div>
            {sortedPlayers.map(([playerName, data]) => (
              <PlayerTakenRow
                key={playerName}
                playerName={playerName}
                data={data}
                jobLine={jobMap[playerName] ?? ''}
                taken={takenBreakdowns[playerName]}
                totalGroupTaken={totalGroupTaken}
                magicDefense={magicDefenseByPlayer[playerName]}
                hpStress={hpStressByPlayer[playerName]}
              />
            ))}
          </>
        ) : (
          <>
            <div className="hidden sm:grid grid-cols-[minmax(0,1.4fr)_repeat(7,minmax(0,1fr))_24px] gap-2 px-4 py-2 border-b border-white/10 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
              <div>Player</div>
              <div className="text-right">Accuracy</div>
              <div className="text-right">WS Miss</div>
              <div className="text-right">WS/Min</div>
              <div className="text-right">Avg WS</div>
              <div className="text-right">Max WS</div>
              <div className="text-right">Avg WS TP</div>
              <div className="text-right">Total DPS</div>
              <div></div>
            </div>
            {sortedPlayers.map(([playerName, data]) => (
              <PlayerDealtRow
                key={playerName}
                playerName={playerName}
                data={data}
                jobLine={jobMap[playerName] ?? ''}
                totalGroupDmg={totalGroupDmg}
                durationSeconds={effectiveDuration}
                wsTp={wsTpByPlayer[playerName]}
              />
            ))}
          </>
        )}
      </div>

      {/* Skillchain Damage by Opener moved to the Skillchains subtab
          under Actions, where it sits alongside the per-instance
          skillchain log - keeps all skillchain views in one place,
          matching how EncounterView groups them. Rendered via
          SkillchainOpenerSummary inside SkillchainsPanel. */}
    </div>
  );
}
