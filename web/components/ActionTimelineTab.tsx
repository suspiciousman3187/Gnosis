'use client';

import React, { useState, useMemo, useRef, useCallback, useEffect, Fragment } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDisplayLanguageEager } from '@/lib/displayLanguage';
import { makeActionTranslator } from '@/lib/translate';
import type { EncounterLanguage } from '@/lib/encounter';
import type { ActionLogEntry, ActionLogTarget, BossReport, AminonData, PartyMember, ItemUseLogEntry, BossHpEntry, PartyHpEntry, PartyMpEntry, PartyTpEntry, BuffLogEntry, CharacterGear, SkillchainEntry, ZoneLogEntry, ParseCombatStats } from '@/lib/types';
import { SkillchainOpenerSummary } from './CombatStatsTab';
import { SP_ABILITIES } from '@/lib/spAbilities';
import { isPetName, buildPetNameSet } from '@/lib/petDetect';
import JobIcon from './JobIcon';
import ItemIcon from './ItemIcon';
import BuffIcon from './BuffIcon';
import Collapse from './Collapse';
import GearReveal from './GearReveal';
import { useEnemyTerm, withTerm } from './EnemyTerm';
import type { GearIndex } from '@/lib/gearLookup';
import { canonicalTypeOf, isJobAbility, isSpell, isMagicBurst } from '@/lib/actionCategory';
import {
  consolidateBuffLog,
  computeFightBuffIntervals,
  listStatusChoices,
  StatusOverlayPicker,
  StatusOverlayBands,
} from './FightStatusDemo';

// ── Compat helper: normalise v1 (flat) and v2 (targets array) entries ─────────

function getTargets(e: ActionLogEntry): ActionLogTarget[] {
  if (e.targets?.length) return e.targets;
  if (e.mob != null) return [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' }];
  return [];
}

function totalDamage(e: ActionLogEntry): number {
  return getTargets(e).reduce((s, t) => s + t.damage, 0);
}

function primaryResult(e: ActionLogEntry): ActionLogEntry['result'] {
  return getTargets(e)[0]?.result ?? e.result ?? 'hit';
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PX_PER_SEC = 10;
const MIN_TRACK_PX = 560;
function pxPerSecFor(durationSeconds: number): number {
  return Math.max(PX_PER_SEC, Math.ceil(MIN_TRACK_PX / Math.max(durationSeconds, 1)));
}
const LABEL_WIDTH = 140; // px, fixed left column for player names
const ROW_HEIGHT = 40;   // px per player swimlane
const DOT_SIZE = 14;     // px, event circle diameter

type ActionType = ActionLogEntry['type'];
type ActionResult = ActionLogEntry['result'];
type LogCat = 'player' | 'boss' | 'buff' | 'mob';

const TYPE_META: Record<ActionType, { color: string; dot: string; label: string }> = {
  ws:     { color: 'text-amber-300',   dot: 'bg-amber-500 border-amber-400',     label: 'Weapon Skill' },
  spell:  { color: 'text-sky-300',     dot: 'bg-sky-500 border-sky-400',         label: 'Spell'        },
  mb:     { color: 'text-teal-300',    dot: 'bg-teal-400 border-teal-300',       label: 'Magic Burst'  },
  enfeeb: { color: 'text-indigo-300',  dot: 'bg-indigo-500 border-indigo-400',   label: 'Enfeeble'     },
  ja:     { color: 'text-emerald-300', dot: 'bg-emerald-500 border-emerald-400', label: 'Job Ability'  },
  auto:   { color: 'text-zinc-300',    dot: 'bg-zinc-500 border-zinc-400',       label: 'Auto Attack' },
  ranged: { color: 'text-green-300',   dot: 'bg-green-500 border-green-400',     label: 'Ranged'      },
};

type RenderCat = ActionType | 'spAbility' | 'buffSpell' | 'buffJa' | 'item' | 'bossAuto' | 'bossTp' | 'bossSpell';
const RENDER_META: Record<RenderCat, { color: string; dot: string; label: string }> = {
  ws:        { color: 'text-amber-300',   dot: 'bg-amber-500 border-amber-400',     label: 'Weapon Skill'    },
  spell:     { color: 'text-sky-300',     dot: 'bg-sky-500 border-sky-400',         label: 'Spell'           },
  mb:        { color: 'text-teal-300',    dot: 'bg-teal-400 border-teal-300',       label: 'Magic Burst'     },
  enfeeb:    { color: 'text-indigo-300',  dot: 'bg-indigo-500 border-indigo-400',   label: 'Enfeeble'        },
  ja:        { color: 'text-emerald-300', dot: 'bg-emerald-500 border-emerald-400', label: 'Job Ability'     },
  auto:      { color: 'text-zinc-300',    dot: 'bg-zinc-500 border-zinc-400',       label: 'Auto Attack'     },
  ranged:    { color: 'text-green-300',   dot: 'bg-green-500 border-green-400',     label: 'Ranged'          },
  spAbility: { color: 'text-fuchsia-200', dot: 'bg-fuchsia-500 border-fuchsia-300 ring-2 ring-fuchsia-300/60', label: 'SP Ability' },
  buffSpell: { color: 'text-violet-300',  dot: 'bg-violet-500 border-violet-400',   label: 'Buff (Spell)'    },
  buffJa:    { color: 'text-cyan-300',    dot: 'bg-cyan-500 border-cyan-400',       label: 'Buff (JA)'       },
  item:      { color: 'text-lime-300',    dot: 'bg-lime-500 border-lime-400',       label: 'Item Use'       },
  bossAuto:  { color: 'text-rose-300/70', dot: 'bg-rose-400/40 border-rose-300/40', label: 'Boss Auto'      },
  bossTp:    { color: 'text-rose-300',    dot: 'bg-rose-600 border-rose-400',       label: 'Boss TP'        },
  bossSpell: { color: 'text-orange-300',  dot: 'bg-orange-600 border-orange-400',   label: 'Boss Spell'     },
};
const RENDER_CAT_ORDER: RenderCat[] = [
  'ws', 'spell', 'mb', 'enfeeb', 'ja', 'auto', 'ranged', 'spAbility', 'buffSpell', 'buffJa', 'item',
  'bossAuto', 'bossTp', 'bossSpell',
];
// Legend layout: deliberate labeled rows instead of an uneven wrap.
const RENDER_CAT_GROUPS: { label: string; cats: RenderCat[] }[] = [
  { label: 'Damage',  cats: ['ws', 'spell', 'mb', 'enfeeb', 'auto', 'ranged'] },
  { label: 'Support', cats: ['buffSpell', 'buffJa', 'item', 'ja', 'spAbility'] },
  { label: 'Boss',    cats: ['bossAuto', 'bossTp', 'bossSpell'] },
];
// Boss auto-attacks are logged with names like "Auto Attack 1/2/3".
const BOSS_AUTO_RE = /auto[- ]?attack/i;
function eventCat(e: ActionLogEntry): RenderCat {
  if (e.from === 'item') return 'item';
  if (e.from === 'boss') {
    if (BOSS_AUTO_RE.test(e.name)) return 'bossAuto';
    if (isSpell(e)) return 'bossSpell';
    return 'bossTp';
  }
  if (SP_ABILITIES.has(e.name)) return 'spAbility';
  if (e.from === 'buff') return isJobAbility(e) ? 'buffJa' : 'buffSpell';
  const t = canonicalTypeOf(e);
  return (t === 'mob_ability' || t === 'unknown') ? e.type : t;
}

// Name colors for the hover tooltip
const BOSS_COLOR = 'text-rose-400';
const BUFF_COLOR = 'text-violet-400';

// Miss/resist renders dimmed - checked against the primary (first) target
const MISS_RESULTS = new Set<ActionResult>(['miss', 'resist']);

// Full-log display categories - like LogCat but Buff is split into the
// Spell/JA sub-kinds so it matches the timeline's Buff (Spell)/Buff (JA).
type LogDisplayCat = 'player' | 'spAbility' | 'buffSpell' | 'buffJa' | 'bossAuto' | 'bossTp' | 'bossSpell' | 'mob';
const LOG_CAT_META: Record<LogDisplayCat, { label: string; cls: string; color: string; dot: string }> = {
  player:    { label: 'Attack',       cls: 'bg-amber-900/40 text-amber-300 border-amber-700/40',       color: 'text-amber-300',     dot: 'bg-amber-400'   },
  spAbility: { label: 'SP Ability',   cls: 'bg-fuchsia-900/50 text-fuchsia-200 border-fuchsia-400/50', color: 'text-fuchsia-200',   dot: 'bg-fuchsia-400' },
  buffSpell: { label: 'Buff (Spell)', cls: 'bg-violet-900/40 text-violet-300 border-violet-700/40',    color: 'text-violet-300',    dot: 'bg-violet-400'  },
  buffJa:    { label: 'Buff (JA)',    cls: 'bg-cyan-900/40 text-cyan-300 border-cyan-700/40',          color: 'text-cyan-300',      dot: 'bg-cyan-400'    },
  bossAuto:  { label: 'Boss Auto',    cls: 'bg-rose-950/30 text-rose-300/70 border-rose-800/30',       color: 'text-rose-300/70',   dot: 'bg-rose-400/50' },
  bossTp:    { label: 'Boss TP',      cls: 'bg-rose-900/40 text-rose-300 border-rose-700/40',          color: 'text-rose-300',      dot: 'bg-rose-500'    },
  bossSpell: { label: 'Boss Spell',   cls: 'bg-orange-900/40 text-orange-300 border-orange-700/40',    color: 'text-orange-300',    dot: 'bg-orange-500'  },
  mob:       { label: 'Mob',          cls: 'bg-gray-800 text-gray-400 border-gray-600/40',             color: 'text-gray-400',      dot: 'bg-gray-500'    },
};
const LOG_CAT_ORDER: LogDisplayCat[] = [
  'player', 'spAbility', 'buffSpell', 'buffJa', 'bossAuto', 'bossTp', 'bossSpell', 'mob',
];
// Labeled segmented-row groups for the full-log filters (mirrors the timeline
// legend's Damage/Support/Enemy layout).
const LOG_CAT_GROUPS: { label: string; cats: LogDisplayCat[] }[] = [
  { label: 'Player', cats: ['player', 'spAbility', 'buffSpell', 'buffJa'] },
  { label: 'Enemy',  cats: ['bossAuto', 'bossTp', 'bossSpell', 'mob'] },
];

// ── Boss data unification ─────────────────────────────────────────────────────

interface BossFight {
  name: string;
  fightStartElapsed: number;
  fightDurationSeconds: number;
}

function buildBossFights(
  bossReports: Record<string, BossReport> | null,
  aminon: AminonData | null,
  actionLog: ActionLogEntry[],
): BossFight[] {
  const fights: BossFight[] = [];

  const inferStart = (stored: number | null | undefined, mobName: string) =>
    stored != null && stored > 0
      ? stored
      : actionLog
          .filter(e => e.mob === mobName || (e.targets ?? []).some(t => t.mob === mobName))
          .reduce((m, e) => Math.min(m, e.elapsed), Infinity);

  if (bossReports) {
    for (const [name, r] of Object.entries(bossReports)) {
      const start = inferStart(r.fightStartElapsed, name);
      if (r.fightDurationSeconds > 0 && isFinite(start)) {
        fights.push({ name, fightStartElapsed: start, fightDurationSeconds: r.fightDurationSeconds });
      }
    }
  }

  if (aminon) {
    const start = inferStart(aminon.fightStartElapsed, 'Aminon');
    if (aminon.fightDurationSeconds > 0 && isFinite(start)) {
      fights.push({ name: 'Aminon', fightStartElapsed: start, fightDurationSeconds: aminon.fightDurationSeconds });
    }
  }

  fights.sort((a, b) => a.fightStartElapsed - b.fightStartElapsed);
  return fights;
}

// ── Helper: format seconds as M:SS ───────────────────────────────────────────

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtCountdown(s: number): string {
  const r = Math.max(0, 3600 - s);
  return `${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')}`;
}
const clockFor = (countdown?: boolean) => (countdown ? fmtCountdown : fmt);

// ── Tick marks ────────────────────────────────────────────────────────────────

function TimeAxis({ duration, pxPerSec }: { duration: number; pxPerSec: number }) {
  const interval = duration > 180 ? 30 : duration > 60 ? 15 : 10;
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += interval) ticks.push(t);

  return (
    <div
      className="relative border-b border-white/10"
      style={{ height: 20, width: duration * pxPerSec }}
    >
      {ticks.map((t) => (
        <div
          key={t}
          className="absolute flex flex-col items-center"
          style={{ left: t * pxPerSec, transform: 'translateX(-50%)' }}
        >
          <span className="text-xs text-gray-400/70 font-mono leading-none">{fmt(t)}</span>
        </div>
      ))}
      {ticks.map((t) => (
        <div
          key={`tick-${t}`}
          className="absolute top-0 bottom-0 w-px bg-white/[0.04]"
          style={{ left: t * pxPerSec }}
        />
      ))}
    </div>
  );
}

// ── Single event dot ──────────────────────────────────────────────────────────

function EventDot({
  entry,
  left,
  pxPerSec,
  onHover,
  onLeave,
}: {
  entry: ActionLogEntry;
  left: number;
  pxPerSec: number;
  onHover: (e: ActionLogEntry) => void;
  onLeave: () => void;
}) {
  const dimmed = MISS_RESULTS.has(primaryResult(entry));
  const cat = eventCat(entry);
  const castWidth = entry.castTimeMs != null && entry.castTimeMs > 0
    ? Math.min((entry.castTimeMs / 1000) * pxPerSec, 320)
    : 0;
  const isInterrupted = entry.phase === 'interrupt' || entry.interrupted === true;
  const isStart = entry.phase === 'start';

  if (isStart) {
    const startDot = (RENDER_META[cat] ?? RENDER_META.ws).dot;
    const size = DOT_SIZE - 4;
    return (
      <div
        className={`absolute rounded-full cursor-default transition-transform hover:scale-150 border-2 ${startDot} bg-transparent ${dimmed ? 'opacity-30' : 'opacity-70'}`}
        style={{
          left: left - size / 2,
          top: (ROW_HEIGHT - size) / 2,
          width: size,
          height: size,
        }}
        onMouseEnter={() => onHover(entry)}
        onMouseLeave={onLeave}
      />
    );
  }

  if (isInterrupted) {
    const size = DOT_SIZE + 4;
    return (
      <>
        {castWidth > 1 && (
          <div
            className="absolute pointer-events-none rounded-sm"
            style={{
              left: left - castWidth,
              top: (ROW_HEIGHT - 4) / 2,
              width: castWidth,
              height: 4,
              background: 'repeating-linear-gradient(90deg, rgba(244,63,94,0.7) 0 4px, transparent 4px 8px)',
            }}
          />
        )}
        <div
          className="absolute flex items-center justify-center cursor-default leading-none text-rose-400 font-bold"
          style={{ left: left - size / 2, top: (ROW_HEIGHT - size) / 2, width: size, height: size, fontSize: size - 2 }}
          onMouseEnter={() => onHover(entry)}
          onMouseLeave={onLeave}
        >
          ✕
        </div>
      </>
    );
  }

  if (cat === 'spAbility') {
    const size = DOT_SIZE + 8;
    return (
      <div
        className={`absolute flex items-center justify-center cursor-default transition-transform hover:scale-125 leading-none text-fuchsia-400 ${dimmed ? 'opacity-30' : 'opacity-100'}`}
        style={{
          left: left - size / 2,
          top: (ROW_HEIGHT - size) / 2,
          width: size,
          height: size,
          fontSize: size,
        }}
        onMouseEnter={() => onHover(entry)}
        onMouseLeave={onLeave}
      >
        ★
      </div>
    );
  }

  const dot = (RENDER_META[cat] ?? RENDER_META.ws).dot;
  const barColor = (RENDER_META[cat] ?? RENDER_META.ws).color;

  return (
    <>
      {castWidth > 1 && (
        <div
          className={`absolute pointer-events-none rounded-sm ${barColor.replace('text-', 'bg-')}/25 ring-1 ring-inset ${barColor.replace('text-', 'ring-')}/40`}
          style={{
            left: left - castWidth,
            top: (ROW_HEIGHT - 4) / 2,
            width: castWidth,
            height: 4,
          }}
        />
      )}
      <div
        className={`absolute border rounded-full cursor-default transition-transform hover:scale-125 ${dot} ${dimmed ? 'opacity-30' : 'opacity-90'}`}
        style={{
          left: left - DOT_SIZE / 2,
          top: (ROW_HEIGHT - DOT_SIZE) / 2,
          width: DOT_SIZE,
          height: DOT_SIZE,
        }}
        onMouseEnter={() => onHover(entry)}
        onMouseLeave={onLeave}
      />
    </>
  );
}

// ── Player/Boss swimlane row ──────────────────────────────────────────────────

function HpCurve({
  samples,
  fightStart,
  duration,
  pxPerSec,
  height,
  stroke,
  fill,
}: {
  samples: { elapsed: number; hpp: number }[];
  fightStart: number;
  duration: number;
  pxPerSec: number;
  height: number;
  stroke: string;
  fill: string;
}) {
  if (samples.length === 0) return null;
  const width = duration * pxPerSec;
  const sorted = [...samples].sort((a, b) => a.elapsed - b.elapsed);
  // Anchor: assume 100% at fight start. Walk samples and emit step points.
  let prevHpp = 100;
  const xy = (sec: number, hpp: number) => `${Math.max(0, Math.min(sec * pxPerSec, width))},${(1 - hpp / 100) * (height - 2) + 1}`;
  const points: string[] = [xy(0, prevHpp)];
  for (const s of sorted) {
    const t = s.elapsed - fightStart;
    if (t < 0) { prevHpp = s.hpp; continue; }
    if (t > duration) break;
    points.push(xy(t, prevHpp));
    points.push(xy(t, s.hpp));
    prevHpp = s.hpp;
  }
  points.push(xy(duration, prevHpp));
  const linePath = `M ${points.join(' L ')}`;
  const fillPath = `${linePath} L ${xy(duration, 0)} L ${xy(0, 0)} Z`;
  return (
    <svg className="absolute inset-0 pointer-events-none" width={width} height={height}>
      <path d={fillPath} fill={fill} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth={1.5} />
    </svg>
  );
}

// HP% at a given fight-relative second, using the same step model as HpCurve
// (100% until the first sample, then holds each sample's value forward).
function hppAtRel(
  samples: { elapsed: number; hpp: number }[],
  fightStart: number,
  relSec: number,
): number {
  let hpp = 100;
  for (const s of [...samples].sort((a, b) => a.elapsed - b.elapsed)) {
    if (s.elapsed - fightStart <= relSec) hpp = s.hpp;
    else break;
  }
  return hpp;
}

const PlayerRow = React.memo(function PlayerRow({
  label,
  labelClassName,
  entries,
  fightStart,
  duration,
  pxPerSec,
  enabledCats,
  onHover,
  onLeave,
  hpSamples,
  hpStroke,
  hpFill,
  mpSamples,
  tpSamples,
  onHpHover,
  onHpLeave,
}: {
  label: string;
  labelClassName?: string;
  entries: ActionLogEntry[];
  fightStart: number;
  duration: number;
  pxPerSec: number;
  enabledCats: Set<RenderCat>;
  onHover: (e: ActionLogEntry) => void;
  onLeave: () => void;
  hpSamples?: { elapsed: number; hpp: number }[];
  hpStroke?: string;
  hpFill?: string;
  mpSamples?: { elapsed: number; hpp: number }[];
  tpSamples?: { elapsed: number; hpp: number }[];
  onHpHover?: (relSec: number, clientX: number, clientY: number) => void;
  onHpLeave?: () => void;
}) {
  const filtered = useMemo(
    () => entries.filter(e => enabledCats.has(eventCat(e))),
    [entries, enabledCats],
  );
  const timelineWidth = duration * pxPerSec;
  const hpInteractive = !!onHpHover && (
    (!!hpSamples && hpSamples.length > 0) ||
    (!!mpSamples && mpSamples.length > 0) ||
    (!!tpSamples && tpSamples.length > 0)
  );

  return (
    <div className="flex border-b border-white/[0.06] last:border-0" style={{ height: ROW_HEIGHT }}>
      <div
        className={`sticky left-0 z-10 bg-panel shrink-0 flex items-center pl-3 pr-3 text-xs font-mono truncate border-r border-white/[0.06] ${labelClassName ?? 'text-gray-200'}`}
        style={{ width: LABEL_WIDTH }}
      >
        {label}
      </div>

      <div
        className="relative overflow-hidden"
        style={{ width: timelineWidth, height: ROW_HEIGHT }}
        onMouseMove={hpInteractive ? (e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relSec = Math.max(0, Math.min(duration, (e.clientX - rect.left) / pxPerSec));
          onHpHover!(relSec, e.clientX, e.clientY);
        } : undefined}
        onMouseLeave={hpInteractive ? () => onHpLeave?.() : undefined}
      >
        <div className="absolute inset-0 bg-white/[0.02]" />

        {mpSamples && mpSamples.length > 0 && (
          <HpCurve
            samples={mpSamples}
            fightStart={fightStart}
            duration={duration}
            pxPerSec={pxPerSec}
            height={ROW_HEIGHT}
            stroke="rgba(96, 165, 250, 0.55)"
            fill="rgba(96, 165, 250, 0.07)"
          />
        )}

        {tpSamples && tpSamples.length > 0 && (
          <HpCurve
            samples={tpSamples}
            fightStart={fightStart}
            duration={duration}
            pxPerSec={pxPerSec}
            height={ROW_HEIGHT}
            stroke="rgba(251, 191, 36, 0.55)"
            fill="rgba(251, 191, 36, 0.07)"
          />
        )}

        {hpSamples && hpSamples.length > 0 && (
          <HpCurve
            samples={hpSamples}
            fightStart={fightStart}
            duration={duration}
            pxPerSec={pxPerSec}
            height={ROW_HEIGHT}
            stroke={hpStroke ?? 'rgba(244, 63, 94, 0.6)'}
            fill={hpFill ?? 'rgba(244, 63, 94, 0.08)'}
          />
        )}

        {filtered.map((entry, i) => {
          const relSec = entry.elapsed - fightStart;
          if (relSec < -2 || relSec > duration + 5) return null;
          const left = Math.max(0, Math.min(relSec * pxPerSec, timelineWidth));
          return (
            <EventDot
              key={i}
              entry={entry}
              left={left}
              pxPerSec={pxPerSec}
              onHover={onHover}
              onLeave={onLeave}
            />
          );
        })}
      </div>
    </div>
  );
});

// ── Hovered event info bar ────────────────────────────────────────────────────

import { createStore, type Store } from '@/lib/createStore';

type HoverEntry = ActionLogEntry | null;

type HpTipKind = 'boss-hp' | 'player-hp' | 'player-mp' | 'player-tp';
type HpTipState = { hpp: number; sec: number; left: number; top: number; boxW: number; kind: HpTipKind; label: string } | null;

function HpTip({ store }: { store: Store<HpTipState> }) {
  const hpTip = store.useStore();
  if (!hpTip) return null;
  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2"
      style={{
        left: Math.min(Math.max(hpTip.left, 70), hpTip.boxW - 70),
        top: hpTip.top + 14,
      }}
    >
      <div className="w-0 h-0 mx-auto border-x-[6px] border-x-transparent border-b-[6px] border-b-black/90" />
      <div className="rounded-md bg-black/90 border border-white/15 px-3 py-2 shadow-lg whitespace-nowrap flex items-center gap-3">
        <span className={`text-sm font-semibold ${
          hpTip.kind === 'boss-hp' ? 'text-rose-300'
          : hpTip.kind === 'player-hp' ? 'text-emerald-300'
          : hpTip.kind === 'player-mp' ? 'text-sky-300'
          : 'text-amber-300'
        }`}>
          {hpTip.kind === 'player-tp' ? Math.round(hpTip.hpp * 30) : `${hpTip.hpp}%`}
          {' '}
          {hpTip.kind === 'player-mp' ? 'MP' : hpTip.kind === 'player-tp' ? 'TP' : 'HP'}
        </span>
        <span className="text-xs text-gray-400">{hpTip.label}</span>
        <span className="text-xs text-gray-400 font-mono">{fmt(hpTip.sec)} into fight</span>
      </div>
    </div>
  );
}

function HoverInfo({ store, fightStart }: { store: Store<HoverEntry>; fightStart?: number }) {
  const entry = store.useStore();
  const enemyTerm = useEnemyTerm();
  const wrapperCls = "h-16 overflow-hidden flex flex-wrap items-center gap-4 px-3 py-2 text-xs border border-white/10 rounded-lg";

  if (!entry) {
    return (
      <div className={wrapperCls}>
        <span className="text-gray-400 italic">Hover over an event to see details</span>
      </div>
    );
  }

  const meta = TYPE_META[entry.type];
  // In the per-boss timeline, show time relative to fight start (0:00–fight
  // length) instead of the absolute sortie-elapsed timestamp.
  const relTime = fightStart != null
    ? fmt(Math.max(0, entry.elapsed - fightStart))
    : fmt(entry.elapsed);
  const timeLabel = fightStart != null ? '' : 'elapsed';
  const tgts = getTargets(entry);
  const dmg = totalDamage(entry);
  const allMiss = tgts.length > 0 && tgts.every(t => MISS_RESULTS.has(t.result));
  const resultColor = allMiss ? 'text-rose-400' : 'text-emerald-400';

  let nameColor: string;
  let typeLabel: string;

  if (entry.from === 'boss') {
    nameColor = BOSS_COLOR;
    typeLabel = `${enemyTerm} ${meta?.label ?? entry.type}`;
  } else if (entry.from === 'buff') {
    nameColor = BUFF_COLOR;
    typeLabel = `Buff (${meta?.label ?? entry.type})`;
  } else {
    nameColor = meta?.color ?? 'text-gray-300';
    typeLabel = meta?.label ?? entry.type;
  }

  const targetSummary = tgts.length === 1
    ? tgts[0].mob
    : tgts.map(t => t.mob).join(', ');

  if (entry.from === 'item') {
    return (
      <div className="min-h-10 flex flex-wrap items-center gap-4 px-3 py-2 text-xs border border-white/10 rounded-lg">
        <span className="font-bold font-mono text-lime-300">{entry.name}</span>
        <span className="text-gray-400">{entry.player} used an item</span>
        <span className="text-gray-400/70">Item Use</span>
        <span className="text-gray-400 font-mono ml-auto">{relTime} {timeLabel}</span>
      </div>
    );
  }

  const isInterrupted = entry.phase === 'interrupt' || entry.interrupted === true;
  const isStart = entry.phase === 'start';
  const hasCrit = tgts.some(t => t.crit === true);
  const showBurst = tgts.some(t => t.result === 'burst');
  const showResist = tgts.some(t => t.result === 'resist');
  const spread = tgts.length > 1 && tgts.some(t => t.damage > 0)
    ? tgts.filter(t => t.damage > 0).map(t => t.damage).sort((a, b) => b - a)
    : null;

  return (
    <div className="h-16 overflow-hidden flex flex-wrap items-center gap-4 px-3 py-2 text-xs border border-white/10 rounded-lg">
      <span className={`font-bold font-mono ${nameColor} ${isInterrupted ? 'line-through opacity-70' : ''}`}>{entry.name}</span>
      {entry.castTimeMs != null && entry.castTimeMs > 0 && (
        <span className="font-mono text-sky-300/70">~{(entry.castTimeMs / 1000).toFixed(1)}s</span>
      )}
      {isInterrupted && (
        <span className="font-semibold text-rose-400 uppercase text-[10px] tracking-wide">Interrupted</span>
      )}
      {isStart && (
        <span className="font-semibold text-sky-300 uppercase text-[10px] tracking-wide">Starting</span>
      )}
      <span className="text-gray-400">{entry.player}{isStart ? '' : ` → ${targetSummary}`}</span>
      <span className="text-gray-400/70">{typeLabel}</span>
      {!isInterrupted && !isStart && (
        <span className={`font-semibold ${resultColor}`}>{allMiss ? 'MISS' : 'HIT'}</span>
      )}
      {dmg > 0 && (
        <span className="font-mono text-amber-400">{dmg.toLocaleString()} dmg</span>
      )}
      {spread && spread.length > 1 && (
        <span className="font-mono text-gray-400/80 text-[10px]">[{spread.slice(0, 6).map(d => d.toLocaleString()).join(' · ')}{spread.length > 6 ? ' …' : ''}]</span>
      )}
      {tgts.length > 1 && (
        <span className="text-gray-400">{tgts.length} targets</span>
      )}
      {hasCrit && (
        <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-amber-500/15 text-amber-300 border border-amber-500/40 rounded">CRIT</span>
      )}
      {showBurst && (
        <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-teal-500/15 text-teal-300 border border-teal-500/40 rounded">MB</span>
      )}
      {showResist && (
        <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-slate-500/15 text-slate-300 border border-slate-500/40 rounded">RESIST</span>
      )}
      <span className="text-gray-400 font-mono ml-auto">{relTime} {timeLabel}</span>
    </div>
  );
}

// ── Full log table ─────────────────────────────────────────────────────────────

type ClassifiedEntry = ActionLogEntry & { _cat: LogCat };

// Split 'buff' into Spell/JA and 'boss' into Auto/TP/Spell for display +
// filtering; player/mob pass through unchanged.
function displayCat(e: ClassifiedEntry): LogDisplayCat {
  if (e._cat === 'boss') {
    if (BOSS_AUTO_RE.test(e.name)) return 'bossAuto';
    if (isSpell(e)) return 'bossSpell';
    return 'bossTp';
  }
  if ((e._cat === 'player' || e._cat === 'buff') && SP_ABILITIES.has(e.name)) return 'spAbility';
  if (e._cat === 'buff') return isJobAbility(e) ? 'buffJa' : 'buffSpell';
  return e._cat;
}

function FullLogView({
  entries,
  allActors,
  partyActors,
  gearIndex,
  translateAction,
}: {
  entries: ClassifiedEntry[];
  allActors: string[];
  partyActors: string[];
  gearIndex?: GearIndex;
  translateAction: (name: string, category?: number | null, param?: number | null) => string;
}) {
  const enemyTerm = useEnemyTerm();
  const [actorFilter, setActorFilter] = useState('');
  const [enabledCats, setEnabledCats] = useState<Set<LogDisplayCat>>(new Set(LOG_CAT_ORDER));
  const [enabledTypes, setEnabledTypes] = useState<Set<ActionType>>(new Set(['ws', 'spell', 'mb', 'enfeeb', 'ja', 'auto', 'ranged']));

  const filtered = useMemo(() => entries.filter(e => {
    if (actorFilter && e.player !== actorFilter) return false;
    if (!enabledCats.has(displayCat(e))) return false;
    if (!enabledTypes.has(e.type)) return false;
    return true;
  }), [entries, actorFilter, enabledCats, enabledTypes]);

  const toggleCat = (c: LogDisplayCat) =>
    setEnabledCats(prev => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n; });
  const toggleType = (t: ActionType) =>
    setEnabledTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    overscan: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length > 0 ? totalSize - virtualRows[virtualRows.length - 1].end : 0;

  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-5 space-y-3">
      {/* Filters - labeled segmented rows, matching the timeline legend's style. */}
      <div className="space-y-1.5">
        {/* Actor dropdown + entries count */}
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Actor</span>
          <select
            value={actorFilter}
            onChange={e => setActorFilter(e.target.value)}
            className="bg-gray-800 border border-white/10 text-xs text-gray-300 rounded-lg px-2 py-1 focus:outline-none"
          >
            <option value="">All actors</option>
            {partyActors.length > 0 && (
              <optgroup label="Party">
                {partyActors.map(n => <option key={n} value={n}>{n}</option>)}
              </optgroup>
            )}
            {allActors.filter(n => !partyActors.includes(n)).length > 0 && (
              <optgroup label="Enemies">
                {allActors.filter(n => !partyActors.includes(n)).map(n => <option key={n} value={n}>{n}</option>)}
              </optgroup>
            )}
          </select>
          <span className="ml-auto text-xs text-gray-400 font-mono">{filtered.length.toLocaleString()} entries</span>
        </div>

        {/* Category toggles - Player / Enemy segmented rows */}
        {LOG_CAT_GROUPS.map(group => (
          <div key={group.label} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{withTerm(group.label, enemyTerm)}</span>
            <div className="flex flex-1 rounded-md border border-white/15 overflow-hidden">
              {group.cats.map(c => {
                const m = LOG_CAT_META[c];
                const on = enabledCats.has(c);
                return (
                  <button key={c} onClick={() => toggleCat(c)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1 text-xs transition-colors border-r border-white/10 last:border-r-0 ${
                      on ? `bg-white/[0.06] ${m.color}` : 'text-gray-400 bg-transparent hover:bg-white/[0.02]'
                    }`}>
                    {c === 'spAbility'
                      ? <span className={`shrink-0 leading-none text-xs ${on ? 'text-fuchsia-300' : 'text-gray-400'}`}>★</span>
                      : <span className={`w-2 h-2 rounded-full inline-block shrink-0 ${on ? m.dot : 'bg-white/10'}`} />}
                    {withTerm(m.label, enemyTerm)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Type toggles - single segmented row */}
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Type</span>
          <div className="flex flex-1 rounded-md border border-white/15 overflow-hidden">
            {(Object.keys(TYPE_META) as ActionType[]).map(t => {
              const m = TYPE_META[t];
              const on = enabledTypes.has(t);
              return (
                <button key={t} onClick={() => toggleType(t)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1 text-xs transition-colors border-r border-white/10 last:border-r-0 ${
                    on ? `bg-white/[0.06] ${m.color}` : 'text-gray-400 bg-transparent hover:bg-white/[0.02]'
                  }`}>
                  <span className={`w-2 h-2 rounded-full inline-block shrink-0 ${on ? m.dot.split(' ')[0] : 'bg-white/10'}`} />
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="border border-white/10 rounded-lg overflow-hidden">
        <div ref={scrollRef} className="overflow-auto" style={{ maxHeight: '60vh' }}>
          <table className="w-full min-w-[640px] text-xs" style={{ tableLayout: 'fixed' }}>
            <thead className="sticky top-0 bg-gray-900 border-b border-white/10 z-10">
              <tr className="text-left text-gray-400 uppercase tracking-wide">
                <th className="px-3 py-2 font-medium w-14">Time</th>
                <th className="px-3 py-2 font-medium w-28">Cat</th>
                <th className="px-3 py-2 font-medium w-32">Actor</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Target</th>
                <th className="px-3 py-2 font-medium text-right w-20">Dmg</th>
              </tr>
            </thead>
            <tbody>
              {paddingTop > 0 && (
                <tr style={{ height: `${paddingTop}px` }}><td colSpan={6} className="p-0" /></tr>
              )}
              {virtualRows.map(vr => {
                const e = filtered[vr.index];
                const catMeta = LOG_CAT_META[displayCat(e)];
                const typeMeta = TYPE_META[e.type];
                const tgts = getTargets(e);
                const dmg = totalDamage(e);
                const allMiss = tgts.length > 0 && tgts.every(t => MISS_RESULTS.has(t.result));
                const targetLabel = tgts.length === 0 ? '-'
                  : tgts.length === 1 ? tgts[0].mob
                  : tgts.length <= 3 ? tgts.map(t => t.mob).join(', ')
                  : `${tgts.slice(0, 2).map(t => t.mob).join(', ')} +${tgts.length - 2}`;
                return (
                  <tr key={vr.key} data-index={vr.index} ref={rowVirtualizer.measureElement} className={`border-b border-white/[0.04] hover:bg-white/[0.02] ${allMiss ? 'opacity-40' : ''}`}>
                    <td className="px-3 py-1.5 font-mono text-gray-400">{fmt(e.elapsed)}</td>
                    <td className="px-3 py-1.5">
                      <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded border text-[10px] font-medium ${catMeta.cls}`}>
                        {withTerm(catMeta.label, enemyTerm)}
                      </span>
                    </td>
                    <td className={`px-3 py-1.5 font-mono ${e._cat === 'boss' ? 'text-rose-400' : e._cat === 'buff' || e._cat === 'player' ? 'text-gray-200' : 'text-gray-400'}`}>
                      {e.player}
                    </td>
                    <td className={`px-3 py-1.5 ${typeMeta?.color ?? 'text-gray-400'}`}>
                      {translateAction(e.name, e.category, e.param)}
                      {(() => { const ge = gearIndex?.lookup(e.player, e.name, e.elapsed); return ge ? <GearReveal entry={ge} changed={gearIndex!.changed(e.player, e.name, e.elapsed)} /> : null; })()}
                    </td>
                    <td className="px-3 py-1.5 text-gray-400">{targetLabel}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-amber-400/80">
                      {dmg > 0 ? dmg.toLocaleString() : ''}
                    </td>
                  </tr>
                );
              })}
              {paddingBottom > 0 && (
                <tr style={{ height: `${paddingBottom}px` }}><td colSpan={6} className="p-0" /></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Items used panel ──────────────────────────────────────────────────────────

function ItemsUsedPanel({ itemUseLog, party, countdown }: { itemUseLog: ItemUseLogEntry[]; party: PartyMember[]; countdown?: boolean }) {
  const jobByPlayer = new Map(party.map(m => [m.name, m.mainJob]));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (player: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(player)) next.delete(player); else next.add(player);
      return next;
    });

  // Per-player highlighted item: clicking an item chip pins it so its uses
  // are emphasized in that player's expanded timeline. Clicking it again clears.
  const [highlight, setHighlight] = useState<Record<string, string | null>>({});
  const selectItem = (player: string, item: string) => {
    setExpanded(prev => new Set(prev).add(player));
    setHighlight(prev => ({ ...prev, [player]: prev[player] === item ? null : item }));
  };

  // Group by player: total count, per-item tally, and chronological uses.
  type PlayerAgg = {
    player: string;
    total: number;
    items: Map<string, number>;
    itemIds: Map<string, number>;
    uses: { elapsed: number; item: string; itemId: number; area: string }[];
  };
  const byPlayer = new Map<string, PlayerAgg>();
  for (const u of itemUseLog) {
    let p = byPlayer.get(u.player);
    if (!p) {
      p = { player: u.player, total: 0, items: new Map(), itemIds: new Map(), uses: [] };
      byPlayer.set(u.player, p);
    }
    p.total += 1;
    p.items.set(u.item, (p.items.get(u.item) ?? 0) + 1);
    if (u.itemId) p.itemIds.set(u.item, u.itemId);
    p.uses.push({ elapsed: u.elapsed, item: u.item, itemId: u.itemId, area: u.area });
  }
  const players = Array.from(byPlayer.values()).sort(
    (a, b) => b.total - a.total || a.player.localeCompare(b.player),
  );
  for (const p of players) p.uses.sort((a, b) => a.elapsed - b.elapsed);
  const fmt = clockFor(countdown);

  if (players.length === 0) {
    return (
      <div className="bg-row-even border border-white/10 rounded-xl p-4">
        <p className="text-gray-400 text-sm">None found.</p>
      </div>
    );
  }

  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-4">
      <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="text-gray-400 text-xs border-b border-white/10">
            <th className="text-left pb-2 w-12">Job</th>
            <th className="text-left pb-2">Player</th>
            <th className="text-left pb-2">Items</th>
            <th className="text-right pb-2 w-16">Total</th>
          </tr>
        </thead>
        <tbody>
          {players.map(p => {
            const isOpen = expanded.has(p.player);
            return (
              <Fragment key={p.player}>
                <tr
                  className="border-b border-white/[0.08] cursor-pointer hover:bg-white/[0.03]"
                  onClick={() => toggle(p.player)}
                >
                  <td className="py-2">
                    <JobIcon job={jobByPlayer.get(p.player) ?? ''} label={jobByPlayer.get(p.player)} size={40} />
                  </td>
                  <td className="py-2 text-white">{p.player}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(p.items.entries())
                        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                        .map(([item, n]) => {
                          const active = highlight[p.player] === item;
                          return (
                            <button
                              key={item}
                              type="button"
                              onClick={e => { e.stopPropagation(); selectItem(p.player, item); }}
                              data-tooltip={active ? 'Clear highlight' : `Highlight ${item} uses`}
                              className={`text-xs font-mono rounded px-2 py-0.5 border transition-colors inline-flex items-center gap-1 ${
                                active
                                  ? 'bg-sky-500/25 border-sky-400 text-sky-100 ring-1 ring-sky-400/50'
                                  : 'bg-panel-alt/60 border-white/10 text-sky-300 hover:border-sky-400/40'
                              }`}
                            >
                              <ItemIcon id={p.itemIds.get(item)} name={item} size={16} nameClass="" />
                              {n > 1 ? `×${n}` : ''}
                            </button>
                          );
                        })}
                    </div>
                  </td>
                  <td className="py-2 text-right text-gray-300 font-mono">{p.total}</td>
                </tr>
                <tr>
                  <td></td>
                  <td colSpan={3} className="p-0">
                    <Collapse open={isOpen}>{() => (
                    <div className="bg-panel-alt/30 border-b border-white/[0.08] py-2">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-400 text-xs border-b border-white/10">
                            <th className="text-right pb-1 w-20">Time</th>
                            <th className="text-left pb-1 px-3">Item</th>
                            <th className="text-left pb-1">Area</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.uses.map((u, i) => {
                            const hl = highlight[p.player];
                            const match = hl != null && u.item === hl;
                            const dim = hl != null && !match;
                            return (
                              <tr
                                key={i}
                                className={`border-b border-white/[0.05] last:border-0 ${
                                  match ? 'bg-sky-500/15' : ''
                                } ${dim ? 'opacity-40' : ''}`}
                              >
                                <td className={`py-1 text-right font-mono text-xs pr-3 ${match ? 'text-sky-200' : 'text-gray-400'}`}>{fmt(u.elapsed)}</td>
                                <td className={`py-1 px-3 ${match ? 'text-sky-100 font-semibold' : 'text-sky-300'}`}><ItemIcon id={u.itemId} name={u.item} size={18} nameClass="" /></td>
                                <td className="py-1 text-gray-400 text-xs">{u.area}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    )}</Collapse>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// ── Buffs/Debuffs panel ───────────────────────────────────────────────────────

function makeAreaResolver(zoneLog?: ZoneLogEntry[] | null) {
  const zones = (zoneLog ?? []).filter(z => typeof z.area === 'string').sort((a, b) => a.elapsed - b.elapsed);
  return {
    has: zones.length > 0,
    at: (elapsed: number): string | null => {
      let area: string | null = null;
      for (const z of zones) { if (z.elapsed <= elapsed) area = z.area; else break; }
      return area;
    },
  };
}

export function BuffsPanel({ buffLog: rawBuffLog, bossSet, party, actionLog, zoneLog, countdown, durationSeconds, gearByPlayer }: { buffLog: BuffLogEntry[]; bossSet: Set<string>; party: PartyMember[]; actionLog: ActionLogEntry[]; zoneLog?: ZoneLogEntry[] | null; countdown?: boolean; durationSeconds?: number; gearByPlayer?: Record<string, { buffLog?: BuffLogEntry[] | null }> | null }) {
  const area = makeAreaResolver(zoneLog);
  const buffLog = rawBuffLog.filter(e => typeof e.buffName === 'string' && e.buffName.length > 0);
  let maxElapsed = 0;
  for (const e of buffLog) if (e.elapsed > maxElapsed) maxElapsed = e.elapsed;
  for (const e of actionLog) if (e.elapsed > maxElapsed) maxElapsed = e.elapsed;
  const denom = durationSeconds && durationSeconds > 0 ? durationSeconds : maxElapsed;
  // Buff name → status id, for icon lookup (the panel aggregates by name).
  const buffIdByName = new Map<string, number>();
  for (const e of buffLog) if (e.buffId != null && !buffIdByName.has(e.buffName)) buffIdByName.set(e.buffName, e.buffId);
  const jobByPlayer = new Map(party.map(m => [m.name, m.mainJob]));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (target: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(target)) next.delete(target); else next.add(target);
      return next;
    });
  const [scope, setScope] = useState<'pp' | 'pe' | 'ep' | 'self'>('pp');
  const [selfChar, setSelfChar] = useState('');
  const fmt = clockFor(countdown);

  const INFER_WINDOW = 4;
  const sourcedByBuff = new Map<string, { elapsed: number; by: string }[]>();
  for (const e of buffLog) {
    if (e.kind === 'gain' && e.appliedBy) {
      (sourcedByBuff.get(e.buffName) ?? sourcedByBuff.set(e.buffName, []).get(e.buffName)!)
        .push({ elapsed: e.elapsed, by: e.appliedBy });
    }
  }
  for (const arr of sourcedByBuff.values()) arr.sort((a, b) => a.elapsed - b.elapsed);

  const SELF_WINDOW = 6;
  const selfCasts = new Map<string, { player: string; elapsed: number }[]>();
  for (const a of actionLog) {
    if (a.phase === 'start') continue;
    if (a.from === 'boss') continue;
    if (!isJobAbility(a) && !isSpell(a)) continue;
    const key = a.name.toLowerCase();
    (selfCasts.get(key) ?? selfCasts.set(key, []).get(key)!)
      .push({ player: a.player, elapsed: a.elapsed });
  }
  for (const arr of selfCasts.values()) arr.sort((a, b) => a.elapsed - b.elapsed);

  // Returns [resolvedBy, inferred]. inferred = filled heuristically.
  const resolveBy = (e: BuffLogEntry): [string | undefined, boolean] => {
    if (e.appliedBy) return [e.appliedBy, false];
    if (e.kind !== 'gain') return [undefined, false];
    if (!e.buffName) return [undefined, false];
    // (1) nearby same-status gain that had a real applier (AoE spread).
    const arr = sourcedByBuff.get(e.buffName);
    if (arr) {
      let best: string | undefined, bestD = Infinity;
      for (const s of arr) {
        const d = Math.abs(s.elapsed - e.elapsed);
        if (d <= INFER_WINDOW && d < bestD) { bestD = d; best = s.by; }
      }
      if (best) return [best, true];
    }
    const casts = selfCasts.get(e.buffName.toLowerCase());
    if (casts) {
      let best: string | undefined, bestD = Infinity;
      for (const c of casts) {
        const d = Math.abs(c.elapsed - e.elapsed);
        if (d > SELF_WINDOW) continue;
        if (c.player === e.target) return [e.target, true];
        if (d < bestD) { bestD = d; best = c.player; }
      }
      if (best) return [best, true];
    }
    return [undefined, false];
  };

  type TargetAgg = {
    target: string;
    group: 'boss' | 'party';
    gains: number;
    buffs: Map<string, { count: number; by: Set<string> }>;
    events: { elapsed: number; kind: string; buffName: string; source?: string; appliedBy?: string; inferred?: boolean }[];
  };
  const partyMemberNames = new Set(party.map(m => m.name));
  const enemyNames = new Set<string>(bossSet);
  for (const e of actionLog) {
    if (!partyMemberNames.has(e.player)) continue;
    for (const t of getTargets(e)) {
      if ((t.damage ?? 0) > 0 && t.mob && !partyMemberNames.has(t.mob)) enemyNames.add(t.mob);
    }
  }
  const byTarget = new Map<string, TargetAgg>();
  for (const e of buffLog) {
    let t = byTarget.get(e.target);
    if (!t) {
      t = {
        target: e.target,
        group: enemyNames.has(e.target) ? 'boss' : 'party',
        gains: 0,
        buffs: new Map(),
        events: [],
      };
      byTarget.set(e.target, t);
    }
    const [by, inferred] = resolveBy(e);
    if (e.kind === 'gain') {
      t.gains += 1;
      let b = t.buffs.get(e.buffName);
      if (!b) { b = { count: 0, by: new Set() }; t.buffs.set(e.buffName, b); }
      b.count += 1;
      if (by) b.by.add(by);
    }
    t.events.push({ elapsed: e.elapsed, kind: e.kind, buffName: e.buffName, source: e.source, appliedBy: by, inferred });
  }
  for (const t of byTarget.values()) t.events.sort((a, b) => a.elapsed - b.elapsed);
  const uptimeByBuff = (events: TargetAgg['events']) => {
    const open = new Map<string, number>();
    const total = new Map<string, { secs: number; assumed: boolean }>();
    const bump = (buff: string, add: number, assumed: boolean) => {
      const cur = total.get(buff) ?? { secs: 0, assumed: false };
      cur.secs += add;
      cur.assumed = cur.assumed || assumed;
      total.set(buff, cur);
    };
    for (const ev of events) {
      if (ev.kind === 'gain') {
        if (!open.has(ev.buffName)) open.set(ev.buffName, ev.elapsed);
      } else {
        const start = open.get(ev.buffName);
        if (start != null) {
          bump(ev.buffName, Math.max(0, ev.elapsed - start), false);
          open.delete(ev.buffName);
        }
      }
    }
    for (const [buff, start] of open) bump(buff, Math.max(0, denom - start), true);
    return total;
  };
  const dur = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  // Human-readable span: "15s", "1m 40s", "2m".
  const durHuman = (s: number) => {
    s = Math.floor(s);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60), rem = s % 60;
    return rem ? `${m}m ${rem}s` : `${m}m`;
  };
  const all = Array.from(byTarget.values());

  const byGains = (a: TargetAgg, b: TargetAgg) => b.gains - a.gains || a.target.localeCompare(b.target);
  const DEBUFF_NAMES = new Set([
    'sleep', 'poison', 'paralysis', 'paralyze', 'blindness', 'blind', 'silence', 'petrification', 'petrify',
    'disease', 'curse', 'stun', 'bind', 'weight', 'gravity', 'slow', 'charm', 'doom', 'amnesia', 'terror',
    'addle', 'flash', 'encumbrance', 'taint', 'plague', 'bane', 'mute', 'frost', 'burn', 'choke', 'rasp',
    'shock', 'drown', 'dia', 'bio', 'requiem', 'threnody', 'elegy', 'lullaby',
  ]);
  const isDebuff = (name: string) => {
    const n = name.toLowerCase();
    if (n.startsWith('bar')) return false;
    if (/\bdown\b/.test(n) || n.endsWith(' daze')) return true;
    if (DEBUFF_NAMES.has(n)) return true;
    const id = buffIdByName.get(name);
    return id != null && ((id >= 128 && id <= 149) || id === 167 || id === 174 || id === 175);
  };
  const bucketByApplier = (targets: TargetAgg[], keep: (ev: TargetAgg['events'][number]) => boolean): TargetAgg[] => {
    const out: TargetAgg[] = [];
    for (const t of targets) {
      const names = new Set<string>();
      const buffs = new Map<string, { count: number; by: Set<string> }>();
      let gains = 0;
      for (const ev of t.events) {
        if (ev.kind !== 'gain' || !keep(ev)) continue;
        names.add(ev.buffName);
        let b = buffs.get(ev.buffName);
        if (!b) { b = { count: 0, by: new Set() }; buffs.set(ev.buffName, b); }
        b.count += 1;
        if (ev.appliedBy) b.by.add(ev.appliedBy);
        gains += 1;
      }
      if (gains === 0) continue;
      const events = t.events.filter(ev =>
        (ev.kind === 'gain' && keep(ev) && names.has(ev.buffName)) ||
        (ev.kind === 'wear' && names.has(ev.buffName)));
      out.push({ target: t.target, group: t.group, gains, buffs, events });
    }
    return out.sort(byGains);
  };
  const partyTargets = all.filter(t => t.group === 'party');
  const enemyTargets = all.filter(t => t.group === 'boss');
  const partyToParty = bucketByApplier(partyTargets, ev => ev.appliedBy ? partyMemberNames.has(ev.appliedBy) : !isDebuff(ev.buffName));
  const enemyToParty = bucketByApplier(partyTargets, ev => ev.appliedBy ? !partyMemberNames.has(ev.appliedBy) : isDebuff(ev.buffName));
  const partyToEnemy = enemyTargets.slice().sort(byGains);

  const detailFor = (t: TargetAgg) => (
    <div className="bg-panel-alt/25 rounded-lg px-3 py-2.5 mt-1 mb-2">
      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">Uptime</div>
        <div className="space-y-1">
          {Array.from(uptimeByBuff(t.events).entries())
            .sort((a, b) => b[1].secs - a[1].secs || a[0].localeCompare(b[0]))
            .map(([buff, u]) => {
              const pct = denom > 0 ? Math.min(100, Math.round((u.secs / denom) * 100)) : 0;
              return (
                <div key={buff} className="flex items-center gap-2 text-xs">
                  <span className="w-36 shrink-0 inline-flex items-center gap-1.5 min-w-0">
                    <BuffIcon id={buffIdByName.get(buff)} />
                    <span className="text-gray-300 truncate">{buff}</span>
                  </span>
                  <span className="flex-1 h-2 rounded-full bg-panel-alt overflow-hidden">
                    <span
                      className={`block h-full rounded-full ${u.assumed ? 'bg-violet-500/50 [background-image:repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(255,255,255,0.12)_4px,rgba(255,255,255,0.12)_8px)]' : 'bg-violet-500'}`}
                      style={{ width: `${u.secs > 0 ? Math.max(2, pct) : 0}%` }}
                    />
                  </span>
                  <span className="w-24 text-right font-mono text-gray-400 shrink-0">
                    {u.assumed
                      ? <span className="text-violet-300/70" title="No wear-off recorded - assumed up until the encounter ended">≈ {pct}%</span>
                      : `${dur(u.secs)} · ${pct}%`}
                  </span>
                </div>
              );
            })}
        </div>
      </div>
      <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-gray-400 text-xs border-b border-white/10">
            <th className="text-left pb-1 px-3 w-16">Time</th>
            <th className="text-left pb-1 px-3 w-28">Status</th>
            <th className="text-left pb-1">By</th>
            {area.has && <th className="text-left pb-1 px-3">Area</th>}
            <th className="text-right pb-1 w-20">Wore</th>
            <th className="text-right pb-1 w-20 pr-1">Duration</th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            type Row = { elapsed: number; buffName: string; appliedBy?: string; inferred?: boolean; source?: string; wear: number | null };
            const rows: Row[] = [];
            const open = new Map<string, number>();
            for (const ev of t.events) {
              if (ev.kind === 'gain') {
                rows.push({ elapsed: ev.elapsed, buffName: ev.buffName, appliedBy: ev.appliedBy, inferred: ev.inferred, source: ev.source, wear: null });
                open.set(ev.buffName, rows.length - 1);
              } else {
                const idx = open.get(ev.buffName);
                if (idx != null && rows[idx].wear == null) { rows[idx].wear = ev.elapsed; open.delete(ev.buffName); }
              }
            }
            return rows.map((r, i) => (
              <tr key={i} className="border-b border-white/[0.05] last:border-0">
                <td className="py-1 px-3 text-left text-gray-400 font-mono text-xs">{fmt(r.elapsed)}</td>
                <td className="py-1 px-3 text-violet-300"><span className="inline-flex items-center gap-1.5"><BuffIcon id={buffIdByName.get(r.buffName)} />{r.buffName}</span></td>
                <td className="py-1 text-sky-300 text-xs">
                  {r.appliedBy
                    ? <span className={r.inferred ? 'italic text-sky-300/60' : ''} title={r.inferred ? 'Inferred from a nearby same-status gain' : undefined}>{r.appliedBy}{r.inferred ? ' ~' : ''}</span>
                    : <span className="text-gray-700">-</span>}
                </td>
                {area.has && <td className="py-1 px-3 text-gray-400 text-xs">{area.at(r.elapsed) ?? '-'}</td>}
                <td className="py-1 text-right text-gray-400 font-mono text-xs">
                  {r.wear != null ? fmt(r.wear) : <span className="text-gray-700" title="No wear-off was recorded">-</span>}
                </td>
                <td className="py-1 text-right font-mono text-xs pr-1">
                  {r.wear != null
                    ? <span className="text-gray-300">{durHuman(Math.max(0, r.wear - r.elapsed))}</span>
                    : <span className="text-violet-300/70" title="No wear-off recorded - assumed up until the encounter ended">≈ {durHuman(Math.max(0, denom - r.elapsed))}</span>}
                </td>
              </tr>
            ));
          })()}
        </tbody>
      </table>
      </div>
    </div>
  );

  const row = (t: TargetAgg, withIcon: boolean, tileCls: string) => {
    const isOpen = expanded.has(t.target);
    const chips = Array.from(t.buffs.entries()).sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
    return (
      <div key={t.target} className="border-b border-white/[0.06] last:border-0">
        <button onClick={() => toggle(t.target)} className="w-full text-left py-2 px-2 -mx-2 rounded-md hover:bg-white/[0.03] transition-colors">
          <div className="flex items-center gap-2.5">
            {withIcon && <JobIcon job={jobByPlayer.get(t.target) ?? ''} label={jobByPlayer.get(t.target)} size={28} />}
            <span className="text-sm font-medium text-white">{t.target}</span>
            {withIcon && jobByPlayer.get(t.target) && <span className="text-[11px] text-gray-400 font-mono">{jobByPlayer.get(t.target)}</span>}
            <span className="text-[11px] text-gray-400">{t.buffs.size} {t.buffs.size === 1 ? 'status' : 'statuses'}</span>
            <span className="ml-auto text-gray-400 text-xs">{isOpen ? '▾' : '▸'}</span>
          </div>
          <div
            className="grid gap-1.5 mt-2 ml-0.5"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
          >
            {chips.map(([buff, info]) => (
              <div
                key={buff}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium border min-w-0 ${tileCls}`}
                data-tooltip={info.by.size > 0 ? `By: ${Array.from(info.by).join(', ')}` : undefined}
              >
                <BuffIcon id={buffIdByName.get(buff)} size={16} />
                <span className="truncate flex-1 text-left">{buff}</span>
                <span className="text-[10px] opacity-60 font-mono shrink-0">{info.count}</span>
              </div>
            ))}
          </div>
        </button>
        <Collapse open={isOpen}>{() => detailFor(t)}</Collapse>
      </div>
    );
  };

  const selfChars = Object.entries(gearByPlayer ?? {})
    .filter(([, g]) => Array.isArray(g?.buffLog) && g!.buffLog!.length > 0)
    .map(([name, g]) => ({ name, buffLog: g!.buffLog! }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const BUCKETS = {
    pp:   { rows: partyToParty, withIcon: true,  label: 'Party → Party',  tint: 'text-violet-300', chip: 'bg-panel-alt/60 border-white/10 text-violet-300', desc: 'status effects party members applied to the party', count: partyToParty.length },
    pe:   { rows: partyToEnemy, withIcon: false, label: 'Party → Enemy',  tint: 'text-rose-300',   chip: 'bg-rose-950/40 border-rose-700/40 text-rose-300',   desc: 'status effects the party applied to enemies',     count: partyToEnemy.length },
    ep:   { rows: enemyToParty, withIcon: true,  label: 'Enemy → Party',  tint: 'text-amber-300',  chip: 'bg-amber-950/40 border-amber-700/40 text-amber-300', desc: 'status effects enemies applied to the party',     count: enemyToParty.length },
    self: { rows: [],           withIcon: false, label: 'Self',           tint: 'text-emerald-300', chip: '',                                                    desc: 'per-character own-buff uptime, captured directly from each box',  count: selfChars.length },
  } as const;
  const ORDER: ('pp' | 'pe' | 'ep' | 'self')[] = ['pp', 'pe', 'ep', 'self'];
  const visible = ORDER.filter(k => BUCKETS[k].count > 0);
  const activeScope = BUCKETS[scope].count > 0 ? scope : (visible[0] ?? 'pp');
  const active = BUCKETS[activeScope];

  return (
    <div>
      <div className="flex bg-row-even border border-white/10 rounded-t-xl">
        {ORDER.filter(k => BUCKETS[k].count > 0).map(k => {
          const on = k === activeScope;
          return (
            <button
              key={k}
              onClick={() => setScope(k)}
              className={`relative flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 py-2.5 text-sm font-medium transition-colors ${
                on ? 'text-accent' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <span className="truncate">{BUCKETS[k].label}</span>
              <span className={`text-[11px] font-mono shrink-0 ${on ? BUCKETS[k].tint : 'text-gray-400'}`}>{BUCKETS[k].count}</span>
              {on && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>
      <div key={activeScope} className="ff-tab bg-row-even border border-white/10 border-t-0 rounded-b-xl p-4">
        <div className="text-[11px] text-gray-400 mb-3">{active.desc}</div>
        {activeScope === 'self' ? (
          <SelfBuffsTab chars={selfChars} selChar={selfChar} setSelChar={setSelfChar} />
        ) : active.rows.length === 0 ? (
          <div className="text-gray-400 text-sm py-6 text-center">Nothing recorded for {active.label}.</div>
        ) : (
          <div>{active.rows.map(t => row(t, active.withIcon, active.chip))}</div>
        )}
      </div>
    </div>
  );
}

function fmtDurHMS(s: number) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function buildSelfRows(buffLog: BuffLogEntry[]) {
  const end = buffLog.reduce((m, b) => Math.max(m, b.elapsed), 0);
  const open: Record<number, number> = {};
  const agg: Record<number, { id: number; name: string; secs: number; count: number }> = {};
  for (const b of [...buffLog].sort((a, c) => a.elapsed - c.elapsed)) {
    const a = (agg[b.buffId] ??= { id: b.buffId, name: b.buffName, secs: 0, count: 0 });
    if (b.kind === 'gain') { open[b.buffId] = b.elapsed; a.count += 1; }
    else if (open[b.buffId] != null) { a.secs += Math.max(0, b.elapsed - open[b.buffId]); delete open[b.buffId]; }
  }
  for (const [id, gainAt] of Object.entries(open)) { const a = agg[+id]; if (a) a.secs += Math.max(0, end - gainAt); }
  return Object.values(agg).sort((x, y) => y.secs - x.secs || y.count - x.count);
}

function SelfBuffsTab({ chars, selChar, setSelChar }: {
  chars: { name: string; buffLog: BuffLogEntry[] }[];
  selChar: string;
  setSelChar: (n: string) => void;
}) {
  if (chars.length === 0) return <div className="text-gray-400 text-sm py-6 text-center">No per-character self-buffs captured.</div>;
  const activeName = chars.some(c => c.name === selChar) ? selChar : chars[0].name;
  const active = chars.find(c => c.name === activeName)!;
  const rows = buildSelfRows(active.buffLog);
  const totalSecs = rows.reduce((s, r) => s + r.secs, 0);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mr-1">Character</span>
        {chars.map(c => (
          <button
            key={c.name}
            onClick={() => setSelChar(c.name)}
            className={`text-xs px-2.5 py-1 rounded border transition-colors ${activeName === c.name ? 'bg-accent/20 border-accent/50 text-accent font-semibold' : 'border-white/10 text-gray-400 hover:bg-white/[0.05]'}`}
          >
            {c.name}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-gray-400">
          {rows.length} {rows.length === 1 ? 'buff' : 'buffs'} · {fmtDurHMS(totalSecs)} total uptime
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No buff data captured for this character.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
          {rows.map(r => (
            <div key={r.id} className="flex items-center gap-2 text-sm py-1 border-b border-white/[0.04]">
              <BuffIcon id={r.id} />
              <span className="text-gray-200 truncate flex-1">{r.name}</span>
              <span className="text-gray-400 text-[11px]">×{r.count}</span>
              <span className="font-mono text-violet-300/90 text-xs w-16 text-right">{fmtDurHMS(r.secs)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Skillchains panel ─────────────────────────────────────────────────────────

export function SkillchainsPanel({ skillchainLog, party, countdown, combatStats, durationSeconds }: {
  skillchainLog: SkillchainEntry[];
  party: PartyMember[];
  countdown?: boolean;
  combatStats?: ParseCombatStats | null;
  durationSeconds?: number;
}) {
  const SC_FMT = clockFor(countdown);
  const jobByPlayer = new Map(party.map(m => [m.name, m.mainJob]));
  // Only real party members - excludes mob/NM "closers" (e.g. Demisang Warrior).
  const partyNames = new Set(party.map(m => m.name));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });

  type Agg = {
    closer: string;
    count: number;
    damage: number;
    chains: Map<string, number>;
    events: SkillchainEntry[];
  };
  const byCloser = new Map<string, Agg>();
  for (const e of skillchainLog) {
    if (!partyNames.has(e.closer)) continue;
    let a = byCloser.get(e.closer);
    if (!a) { a = { closer: e.closer, count: 0, damage: 0, chains: new Map(), events: [] }; byCloser.set(e.closer, a); }
    a.count += 1;
    a.damage += e.damage || 0;
    a.chains.set(e.sc, (a.chains.get(e.sc) ?? 0) + 1);
    a.events.push(e);
  }
  const rows = Array.from(byCloser.values()).sort((a, b) => b.damage - a.damage || a.closer.localeCompare(b.closer));
  for (const r of rows) r.events.sort((a, b) => a.elapsed - b.elapsed);
  const totalDmg = rows.reduce((s, r) => s + r.damage, 0);

  const openerSummary = combatStats
    ? <SkillchainOpenerSummary combatStats={combatStats} durationSeconds={durationSeconds} />
    : null;

  if (rows.length === 0) {
    return (
      <div className="space-y-3">
        {openerSummary}
        <div className="bg-row-even border border-white/10 rounded-xl p-4">
          <p className="text-gray-400 text-sm">No skillchain events recorded.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
    {openerSummary}
    <div className="bg-row-even border border-white/10 rounded-xl p-4">
      <div className="text-xs text-gray-400 mb-3"><span className="text-amber-300 font-mono">{totalDmg.toLocaleString()}</span> total damage</div>
      <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="text-gray-400 text-xs border-b border-white/10">
            <th className="text-left pb-2 w-12">Job</th>
            <th className="text-left pb-2">Closer</th>
            <th className="text-left pb-2">Skillchains</th>
            <th className="text-right pb-2 w-16">Count</th>
            <th className="text-right pb-2 w-24">Damage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const isOpen = expanded.has(r.closer);
            return (
              <Fragment key={r.closer}>
                <tr className="border-b border-white/[0.08] cursor-pointer hover:bg-white/[0.03]" onClick={() => toggle(r.closer)}>
                  <td className="py-2">
                    <JobIcon job={jobByPlayer.get(r.closer) ?? ''} label={jobByPlayer.get(r.closer)} size={40} />
                  </td>
                  <td className="py-2 text-white">{r.closer}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(r.chains.entries())
                        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                        .map(([sc, n]) => (
                          <span key={sc} className="text-xs font-mono rounded px-2 py-0.5 border bg-amber-500/10 border-amber-400/30 text-amber-200">
                            {sc}{n > 1 ? ` ×${n}` : ''}
                          </span>
                        ))}
                    </div>
                  </td>
                  <td className="py-2 text-right text-gray-300 font-mono">{r.count}</td>
                  <td className="py-2 text-right text-amber-200 font-mono">{r.damage.toLocaleString()}</td>
                </tr>
                <tr>
                    <td></td>
                    <td colSpan={4} className="p-0">
                    <Collapse open={isOpen}>{() => (
                    <div className="bg-panel-alt/30 border-b border-white/[0.08] py-2">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-400 text-xs border-b border-white/10">
                            <th className="text-right pb-1 w-20">Time</th>
                            <th className="text-left pb-1 px-3">Skillchain</th>
                            <th className="text-left pb-1">Closing WS</th>
                            <th className="text-left pb-1">Target</th>
                            <th className="text-right pb-1 w-24">Damage</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.events.map((ev, i) => (
                            <tr key={i} className="border-b border-white/[0.05] last:border-0">
                              <td className="py-1 text-right text-gray-400 font-mono text-xs pr-3">{SC_FMT(ev.elapsed)}</td>
                              <td className="py-1 px-3 text-amber-200">{ev.sc}</td>
                              <td className="py-1 text-gray-300">{ev.ws}</td>
                              <td className="py-1 text-gray-400 text-xs">{ev.mob}</td>
                              <td className="py-1 text-right text-amber-200 font-mono">{(ev.damage || 0).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    )}</Collapse>
                    </td>
                  </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
    </div>
  );
}

export function MagicBurstsPanel({ actionLog, party, countdown }: { actionLog: ActionLogEntry[]; party: PartyMember[]; countdown?: boolean }) {
  const SC_FMT = clockFor(countdown);
  const jobByPlayer = new Map(party.map(m => [m.name, m.mainJob]));
  const partyNames = new Set(party.map(m => m.name));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });

  type Burst = { elapsed: number; spell: string; target: string; damage: number };
  type Agg = { caster: string; count: number; damage: number; spells: Map<string, number>; list: Burst[] };
  const byCaster = new Map<string, Agg>();
  for (const e of actionLog) {
    if (e.phase === 'start') continue;
    if (!partyNames.has(e.player)) continue;
    const tgts = getTargets(e);
    if (!isMagicBurst(e) && !tgts.some(t => t.result === 'burst')) continue;
    const damage = tgts.reduce((s, t) => s + (t.damage || 0), 0);
    let a = byCaster.get(e.player);
    if (!a) { a = { caster: e.player, count: 0, damage: 0, spells: new Map(), list: [] }; byCaster.set(e.player, a); }
    a.count += 1;
    a.damage += damage;
    a.spells.set(e.name, (a.spells.get(e.name) ?? 0) + 1);
    a.list.push({ elapsed: e.elapsed, spell: e.name, target: tgts.map(t => t.mob).join(', '), damage });
  }
  const rows = Array.from(byCaster.values()).sort((a, b) => b.damage - a.damage || a.caster.localeCompare(b.caster));
  for (const r of rows) r.list.sort((a, b) => a.elapsed - b.elapsed);
  const totalDmg = rows.reduce((s, r) => s + r.damage, 0);

  if (rows.length === 0) {
    return (
      <div className="bg-row-even border border-white/10 rounded-xl p-4">
        <p className="text-gray-400 text-sm">None found.</p>
      </div>
    );
  }

  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-4">
      <div className="text-xs text-gray-400 mb-3"><span className="text-fuchsia-300 font-mono">{totalDmg.toLocaleString()}</span> total damage</div>
      <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-gray-400 text-xs border-b border-white/10">
            <th className="text-left pb-2 w-12">Job</th>
            <th className="text-left pb-2">Caster</th>
            <th className="text-left pb-2">Spells</th>
            <th className="text-right pb-2 w-16">Bursts</th>
            <th className="text-right pb-2 w-24">Damage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const isOpen = expanded.has(r.caster);
            return (
              <Fragment key={r.caster}>
                <tr className="border-b border-white/[0.08] cursor-pointer hover:bg-white/[0.03]" onClick={() => toggle(r.caster)}>
                  <td className="py-2">
                    <JobIcon job={jobByPlayer.get(r.caster) ?? ''} label={jobByPlayer.get(r.caster)} size={40} />
                  </td>
                  <td className="py-2 text-white">{r.caster}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(r.spells.entries())
                        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                        .map(([sp, n]) => (
                          <span key={sp} className="text-xs font-mono rounded px-2 py-0.5 border bg-fuchsia-500/10 border-fuchsia-400/30 text-fuchsia-200">
                            {sp}{n > 1 ? ` ×${n}` : ''}
                          </span>
                        ))}
                    </div>
                  </td>
                  <td className="py-2 text-right text-gray-300 font-mono">{r.count}</td>
                  <td className="py-2 text-right text-fuchsia-200 font-mono">{r.damage.toLocaleString()}</td>
                </tr>
                <tr>
                    <td></td>
                    <td colSpan={4} className="p-0">
                    <Collapse open={isOpen}>{() => (
                    <div className="bg-panel-alt/30 border-b border-white/[0.08] py-2">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-400 text-xs border-b border-white/10">
                            <th className="text-right pb-1 w-20">Time</th>
                            <th className="text-left pb-1 px-3">Spell</th>
                            <th className="text-left pb-1">Target</th>
                            <th className="text-right pb-1 w-24">Damage</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.list.map((c, i) => (
                            <tr key={i} className="border-b border-white/[0.05] last:border-0">
                              <td className="py-1 text-right text-gray-400 font-mono text-xs pr-3">{SC_FMT(c.elapsed)}</td>
                              <td className="py-1 px-3 text-fuchsia-200">{c.spell}</td>
                              <td className="py-1 text-gray-400 text-xs">{c.target}</td>
                              <td className="py-1 text-right text-fuchsia-200 font-mono">{c.damage.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    )}</Collapse>
                    </td>
                  </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// ── Cures panel ───────────────────────────────────────────────────────────────

// Healing actions identified by name (covers WHM/RDM/SCH/BLU/DNC/PUP/SMN/MNK
// staples). Damage field on a cure entry is the HP restored.
const CURE_RE = /^(cure|curaga|cura|full cure|healing breath|healing breeze|pollen|wild carrot|magic fruit|restoral|plenilune embrace|curing waltz|divine waltz|chakra|spring water|healing ruby|sacrosanctity|metta)/i;

export function CuresPanel({ actionLog, party, countdown }: { actionLog: ActionLogEntry[]; party: PartyMember[]; countdown?: boolean }) {
  const SC_FMT = clockFor(countdown);
  const jobByPlayer = new Map(party.map(m => [m.name, m.mainJob]));
  // Strict party-member set - the augmented partySet would pull in mob healers
  // (e.g. Demisang White Mage) that cast Cure on a real member.
  const partyNames = new Set(party.map(m => m.name));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });

  type Cast = { elapsed: number; spell: string; targets: string; amount: number };
  type Agg = { healer: string; casts: number; healed: number; spells: Map<string, number>; list: Cast[] };
  const byHealer = new Map<string, Agg>();
  for (const e of actionLog) {
    if (e.phase === 'start') continue;
    if (!CURE_RE.test(e.name)) continue;
    if (!partyNames.has(e.player)) continue;
    const tgts = getTargets(e);
    const amount = tgts.reduce((s, t) => s + (t.damage || 0), 0);
    if (amount <= 0) continue;
    let a = byHealer.get(e.player);
    if (!a) { a = { healer: e.player, casts: 0, healed: 0, spells: new Map(), list: [] }; byHealer.set(e.player, a); }
    a.casts += 1;
    a.healed += amount;
    a.spells.set(e.name, (a.spells.get(e.name) ?? 0) + 1);
    a.list.push({ elapsed: e.elapsed, spell: e.name, targets: tgts.map(t => t.mob).join(', '), amount });
  }
  const rows = Array.from(byHealer.values()).sort((a, b) => b.healed - a.healed || a.healer.localeCompare(b.healer));
  for (const r of rows) r.list.sort((a, b) => a.elapsed - b.elapsed);
  const total = rows.reduce((s, r) => s + r.healed, 0);
  if (rows.length === 0) {
    return (
      <div className="bg-row-even border border-white/10 rounded-xl p-4">
        <p className="text-gray-400 text-sm">None found.</p>
      </div>
    );
  }

  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-4">
      <div className="text-xs text-gray-400 mb-3"><span className="text-emerald-300 font-mono">{total.toLocaleString()}</span> HP restored</div>
      <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-gray-400 text-xs border-b border-white/10">
            <th className="text-left pb-2 w-12">Job</th>
            <th className="text-left pb-2">Healer</th>
            <th className="text-left pb-2">Spells</th>
            <th className="text-right pb-2 w-16">Casts</th>
            <th className="text-right pb-2 w-28">HP Restored</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const isOpen = expanded.has(r.healer);
            return (
              <Fragment key={r.healer}>
                <tr className="border-b border-white/[0.08] cursor-pointer hover:bg-white/[0.03]" onClick={() => toggle(r.healer)}>
                  <td className="py-2">
                    <JobIcon job={jobByPlayer.get(r.healer) ?? ''} label={jobByPlayer.get(r.healer)} size={40} />
                  </td>
                  <td className="py-2 text-white">{r.healer}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(r.spells.entries())
                        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                        .map(([sp, n]) => (
                          <span key={sp} className="text-xs font-mono rounded px-2 py-0.5 border bg-emerald-500/10 border-emerald-400/30 text-emerald-200">
                            {sp}{n > 1 ? ` ×${n}` : ''}
                          </span>
                        ))}
                    </div>
                  </td>
                  <td className="py-2 text-right text-gray-300 font-mono">{r.casts}</td>
                  <td className="py-2 text-right text-emerald-200 font-mono">{r.healed.toLocaleString()}</td>
                </tr>
                <tr>
                    <td></td>
                    <td colSpan={4} className="p-0">
                    <Collapse open={isOpen}>{() => (
                    <div className="bg-panel-alt/30 border-b border-white/[0.08] py-2">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-400 text-xs border-b border-white/10">
                            <th className="text-right pb-1 w-20">Time</th>
                            <th className="text-left pb-1 px-3">Spell</th>
                            <th className="text-left pb-1">Target(s)</th>
                            <th className="text-right pb-1 w-24">HP</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.list.map((c, i) => (
                            <tr key={i} className="border-b border-white/[0.05] last:border-0">
                              <td className="py-1 text-right text-gray-400 font-mono text-xs pr-3">{SC_FMT(c.elapsed)}</td>
                              <td className="py-1 px-3 text-emerald-200">{c.spell}</td>
                              <td className="py-1 text-gray-400 text-xs">{c.targets}</td>
                              <td className="py-1 text-right text-emerald-200 font-mono">{c.amount.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    )}</Collapse>
                    </td>
                  </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// ── Job Abilities panel ───────────────────────────────────────────────────────

export function JobAbilitiesPanel({ actionLog, party, zoneLog, countdown }: { actionLog: ActionLogEntry[]; party: PartyMember[]; zoneLog?: ZoneLogEntry[] | null; countdown?: boolean }) {
  const SC_FMT = clockFor(countdown);
  const jobByPlayer = new Map(party.map(m => [m.name, m.mainJob]));
  const partyNames = new Set(party.map(m => m.name));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });

  // Resolve which area a JA was used in (Sortie only; column omitted otherwise).
  const area = makeAreaResolver(zoneLog);
  const hasAreas = area.has;

  type Use = { elapsed: number; ability: string; target: string; area: string | null };
  type Agg = { player: string; casts: number; abilities: Map<string, number>; list: Use[] };
  const byPlayer = new Map<string, Agg>();
  for (const e of actionLog) {
    if (e.phase === 'start') continue;
    if (!isJobAbility(e) || e.from === 'boss') continue;
    if (!partyNames.has(e.player)) continue;
    const tgts = getTargets(e);
    // Self-targeted JAs report the caster as the target (or no target).
    const tnames = tgts.map(t => t.mob).filter(Boolean);
    const target = tnames.length === 0 || (tnames.length === 1 && tnames[0] === e.player)
      ? 'self' : tnames.join(', ');
    let a = byPlayer.get(e.player);
    if (!a) { a = { player: e.player, casts: 0, abilities: new Map(), list: [] }; byPlayer.set(e.player, a); }
    a.casts += 1;
    a.abilities.set(e.name, (a.abilities.get(e.name) ?? 0) + 1);
    a.list.push({ elapsed: e.elapsed, ability: e.name, target, area: area.at(e.elapsed) });
  }
  const rows = Array.from(byPlayer.values()).sort((a, b) => b.casts - a.casts || a.player.localeCompare(b.player));
  for (const r of rows) r.list.sort((a, b) => a.elapsed - b.elapsed);
  if (rows.length === 0) {
    return (
      <div className="bg-row-even border border-white/10 rounded-xl p-4">
        <p className="text-gray-400 text-sm">None found.</p>
      </div>
    );
  }

  return (
    <div className="bg-row-even border border-white/10 rounded-xl p-4">
      {/* Wrap the table so the wide Abilities column can scroll horizontally
          on narrow screens - abilities chips already wrap vertically; the
          horizontal scroll keeps the Job/Player/Used columns legible. */}
      <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="text-gray-400 text-xs border-b border-white/10">
            <th className="text-left pb-2 w-12">Job</th>
            <th className="text-left pb-2">Player</th>
            <th className="text-left pb-2">Abilities</th>
            <th className="text-right pb-2 w-16">Used</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const isOpen = expanded.has(r.player);
            return (
              <Fragment key={r.player}>
                <tr className="border-b border-white/[0.08] cursor-pointer hover:bg-white/[0.03]" onClick={() => toggle(r.player)}>
                  <td className="py-2">
                    <JobIcon job={jobByPlayer.get(r.player) ?? ''} label={jobByPlayer.get(r.player)} size={40} />
                  </td>
                  <td className="py-2 text-white">{r.player}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(r.abilities.entries())
                        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                        .map(([ab, n]) => (
                          <span key={ab} className="text-xs font-mono rounded px-2 py-0.5 border bg-emerald-500/10 border-emerald-400/30 text-emerald-200">
                            {ab}{n > 1 ? ` ×${n}` : ''}
                          </span>
                        ))}
                    </div>
                  </td>
                  <td className="py-2 text-right text-gray-300 font-mono">{r.casts}</td>
                </tr>
                <tr>
                    <td></td>
                    <td colSpan={3} className="p-0">
                    <Collapse open={isOpen}>{() => (
                    <div className="bg-panel-alt/30 border-b border-white/[0.08] py-2">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-400 text-xs border-b border-white/10">
                            <th className="text-right pb-1 w-20">Time</th>
                            <th className="text-left pb-1 px-3">Ability</th>
                            <th className="text-left pb-1">Target</th>
                            {hasAreas && <th className="text-left pb-1 px-3">Area</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {r.list.map((u, i) => (
                            <tr key={i} className="border-b border-white/[0.05] last:border-0">
                              <td className="py-1 text-right text-gray-400 font-mono text-xs pr-3">{SC_FMT(u.elapsed)}</td>
                              <td className="py-1 px-3 text-emerald-200">{u.ability}</td>
                              <td className="py-1 text-gray-400 text-xs">{u.target}</td>
                              {hasAreas && <td className="py-1 px-3 text-gray-400 text-xs">{u.area ?? '-'}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    )}</Collapse>
                    </td>
                  </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ActionTimelineTab({
  actionLog,
  bossReports,
  aminon,
  party,
  itemUseLog,
  buffLog,
  zoneLog,
  gearIndex,
  countdown,
  skillchainLog,
  combatStats,
  durationSeconds,
  showStatus = true,
  showSkillchains = false,
  showCures = false,
  captureLanguage,
}: {
  actionLog: ActionLogEntry[];
  bossReports: Record<string, BossReport> | null;
  aminon: AminonData | null;
  party: PartyMember[];
  itemUseLog?: ItemUseLogEntry[] | null;
  buffLog?: BuffLogEntry[] | null;
  zoneLog?: ZoneLogEntry[] | null;
  gearIndex?: GearIndex;
  // Sortie shows a 60-minute countdown; everything else (incl. generic) counts up.
  countdown?: boolean;
  skillchainLog?: SkillchainEntry[] | null;
  combatStats?: ParseCombatStats | null;
  durationSeconds?: number;
  showStatus?: boolean;
  showSkillchains?: boolean;
  showCures?: boolean;
  captureLanguage?: EncounterLanguage | null;
}) {
  const displayLang = useDisplayLanguageEager();
  const translateAction = useMemo(() => makeActionTranslator(captureLanguage, displayLang), [captureLanguage, displayLang]);
  // Per-boss fight timelines now live in each sector's BOSS REPORT
  // (see BossActionTimeline). This tab is the run-wide Full Log + panels.

  const partyNameSet = useMemo(() => new Set(party.map(p => p.name)), [party]);
  const bossSet = useMemo(() => {
    const raw = new Set([
      ...Object.keys(bossReports ?? {}),
      ...(aminon ? ['Aminon'] : []),
    ]);
    for (const n of partyNameSet) raw.delete(n);
    return raw;
  }, [bossReports, aminon, partyNameSet]);

  const partySet = useMemo(() => {
    const set = new Set(party.map(p => p.name));
    for (const e of actionLog) {
      if (bossSet.has(e.player)) continue;
      const tgts = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' as const }] : []);
      // (1) self-target
      if (tgts.some(t => t.mob === e.player)) { set.add(e.player); continue; }
      // (2) targets a confirmed party member (use first-pass party-prop names as anchor)
      if (tgts.some(t => set.has(t.mob))) set.add(e.player);
    }
    return set;
  }, [party, actionLog, bossSet]);

  // Normalize: re-classify 'from' using bossSet/partySet so runs where party_jobs was
  // empty (all entries stored as 'player') still display correctly.
  const normalizedLog = useMemo(() => actionLog.map(e => {
    const tgts = getTargets(e);
    const anyPartyTarget = tgts.some(t => partySet.has(t.mob));
    let from: ActionLogEntry['from'];
    if (bossSet.has(e.player)) from = 'boss';
    else if (partySet.has(e.player) && anyPartyTarget) from = 'buff';
    else if (partySet.has(e.player)) from = 'player';
    else from = e.from ?? 'player';
    return from === e.from ? e : { ...e, from };
  }), [actionLog, bossSet, partySet]);

  // Full-log classified entries (adds _cat field for the log table)
  const classifiedLog = useMemo((): ClassifiedEntry[] => normalizedLog.map(e => {
    const anyPartyTarget = getTargets(e).some(t => partySet.has(t.mob));
    let _cat: LogCat;
    if (bossSet.has(e.player)) _cat = 'boss';
    else if (partySet.has(e.player) && anyPartyTarget) _cat = 'buff';
    else if (partySet.has(e.player)) _cat = 'player';
    else _cat = 'mob';
    return { ...e, _cat };
  }), [normalizedLog, bossSet, partySet]);

  const allActors = useMemo(() => [...new Set(actionLog.map(e => e.player))].sort(), [actionLog]);
  const partyActors = useMemo(() => allActors.filter(n => partySet.has(n)), [allActors, partySet]);

  const [actSub, setActSub] = useState<string>('');
  const subTabs = useMemo(() => {
    const pn = new Set(party.map(p => p.name));
    const burstCount = actionLog.filter(e => pn.has(e.player) && (isMagicBurst(e) || getTargets(e).some(t => t.result === 'burst'))).length;
    const jaCount = actionLog.filter(e => isJobAbility(e) && e.from !== 'boss' && pn.has(e.player)).length;
    const healCount = actionLog.filter(e => CURE_RE.test(e.name) && pn.has(e.player) && getTargets(e).reduce((s, t) => s + (t.damage || 0), 0) > 0).length;
    const list: { key: string; label: string; color: string; count: number }[] = [
      { key: 'items', label: 'Items', color: 'text-sky-300', count: (itemUseLog ?? []).length },
      { key: 'ja', label: 'Job Abilities', color: 'text-emerald-300', count: jaCount },
    ];
    if (showSkillchains) list.push({ key: 'sc', label: 'Skillchains', color: 'text-amber-300', count: (skillchainLog ?? []).length });
    if (showSkillchains) list.push({ key: 'mb', label: 'Magic Bursts', color: 'text-fuchsia-300', count: burstCount });
    if (showCures) list.push({ key: 'heal', label: 'Healing', color: 'text-emerald-300', count: healCount });
    if (showStatus && buffLog && buffLog.length > 0) list.push({ key: 'status', label: 'Status', color: 'text-violet-300', count: buffLog.length });
    list.push({ key: 'log', label: 'Action Log', color: 'text-sky-300', count: classifiedLog.length });
    return list;
  }, [party, itemUseLog, actionLog, showSkillchains, skillchainLog, showCures, showStatus, buffLog, classifiedLog]);
  const activeKey = subTabs.some(t => t.key === actSub) ? actSub : (subTabs.find(t => t.count > 0)?.key ?? subTabs[0].key);

  if (actionLog.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 text-sm">
        No action log data recorded for this run.
      </div>
    );
  }

  // Auto-scroll the active sub-tab into view on mobile so a tap on an
  // offscreen tab snaps it into the visible window.
  const activeSubTabRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    activeSubTabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeKey]);

  return (
    <div>
      {/* Mobile: horizontally scrollable strip with edge fades. Desktop: even
          flex-1 distribution (each label full + count). */}
      <div className="relative bg-row-even border border-white/10 rounded-t-xl">
        <div className="flex overflow-x-auto md:overflow-visible scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {subTabs.map(t => {
            const on = t.key === activeKey;
            return (
              <button
                key={t.key}
                ref={on ? activeSubTabRef : undefined}
                onClick={() => setActSub(t.key)}
                className={`relative shrink-0 md:flex-1 md:min-w-0 flex items-center justify-center gap-1.5 px-3 sm:px-2 py-2.5 text-sm font-medium transition-colors ${
                  on ? 'text-accent' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <span className="whitespace-nowrap md:truncate">{t.label}</span>
                <span className={`text-[11px] font-mono shrink-0 ${on ? t.color : 'text-gray-400'}`}>{t.count}</span>
                {on && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />}
              </button>
            );
          })}
        </div>
        {/* Edge fades - mobile only */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-row-even to-transparent md:hidden rounded-tr-xl" />
        <div className="pointer-events-none absolute inset-y-0 left-0 w-4 bg-gradient-to-r from-row-even to-transparent md:hidden rounded-tl-xl" />
      </div>

      <div key={activeKey} className="ff-tab [&>div]:rounded-t-none [&>div]:border-t-0">
        {activeKey === 'items' && <ItemsUsedPanel itemUseLog={itemUseLog ?? []} party={party} countdown={countdown} />}
        {activeKey === 'ja' && <JobAbilitiesPanel actionLog={actionLog} party={party} zoneLog={zoneLog ?? null} countdown={countdown} />}
        {activeKey === 'sc' && <SkillchainsPanel skillchainLog={skillchainLog ?? []} party={party} countdown={countdown} combatStats={combatStats ?? null} durationSeconds={durationSeconds} />}
        {activeKey === 'mb' && <MagicBurstsPanel actionLog={actionLog} party={party} countdown={countdown} />}
        {activeKey === 'heal' && <CuresPanel actionLog={actionLog} party={party} countdown={countdown} />}
        {activeKey === 'status' && buffLog && (
          <BuffsPanel buffLog={buffLog} bossSet={bossSet} party={party} actionLog={actionLog} zoneLog={zoneLog ?? null} countdown={countdown} />
        )}
        {activeKey === 'log' && (
          <FullLogView entries={classifiedLog} allActors={allActors} partyActors={partyActors} gearIndex={gearIndex} translateAction={translateAction} />
        )}
      </div>
    </div>
  );
}

export function BossActionTimeline({
  bossName,
  entityId,
  actionLog,
  party,
  bossReports,
  aminon,
  bossHpLog,
  partyHpLog,
  partyMpLog,
  partyTpLog,
  itemUseLog,
  buffLog,
  gearByPlayer,
  bare,
}: {
  bossName: string;
  entityId?: number;
  actionLog: ActionLogEntry[];
  party: PartyMember[];
  bossReports: Record<string, BossReport> | null;
  aminon: AminonData | null;
  bossHpLog?: BossHpEntry[] | null;
  partyHpLog?: PartyHpEntry[] | null;
  partyMpLog?: PartyMpEntry[] | null;
  partyTpLog?: PartyTpEntry[] | null;
  itemUseLog?: ItemUseLogEntry[] | null;
  buffLog?: BuffLogEntry[] | null;
  gearByPlayer?: Record<string, CharacterGear> | null;
  bare?: boolean;
}) {
  const enemyTerm = useEnemyTerm();
  const fights = useMemo(
    () => buildBossFights(bossReports, aminon, actionLog),
    [bossReports, aminon, actionLog],
  );
  const fight = fights.find(f => f.name === bossName);

  // Defensive: subtract party names from bossSet so Trusts never read as enemies.
  const partyNameSetInner = useMemo(() => new Set(party.map(p => p.name)), [party]);
  const bossSet = useMemo(() => {
    const raw = new Set([
      ...Object.keys(bossReports ?? {}),
      ...(aminon ? ['Aminon'] : []),
    ]);
    for (const n of partyNameSetInner) raw.delete(n);
    return raw;
  }, [bossReports, aminon, partyNameSetInner]);

  const partySet = useMemo(() => {
    const set = new Set(party.map(p => p.name));
    for (const e of actionLog) {
      if (bossSet.has(e.player)) continue;
      const tgts = e.targets ?? (e.mob ? [{ mob: e.mob, damage: e.damage ?? 0, result: e.result ?? 'hit' as const }] : []);
      if (tgts.some(t => t.mob === e.player)) { set.add(e.player); continue; }
      if (tgts.some(t => set.has(t.mob))) set.add(e.player);
    }
    return set;
  }, [party, actionLog, bossSet]);

  const normalizedLog = useMemo(() => actionLog.map(e => {
    const tgts = getTargets(e);
    const anyPartyTarget = tgts.some(t => partySet.has(t.mob));
    let from: ActionLogEntry['from'];
    if (bossSet.has(e.player)) from = 'boss';
    else if (partySet.has(e.player) && anyPartyTarget) from = 'buff';
    else if (partySet.has(e.player)) from = 'player';
    else from = e.from ?? 'player';
    return from === e.from ? e : { ...e, from };
  }), [actionLog, bossSet, partySet]);

  const [enabledCats, setEnabledCats] = useState<Set<RenderCat>>(
    () => new Set<RenderCat>(),
  );
  const hoverStore = useMemo(() => createStore<HoverEntry>(null), []);
  const hpTipStore = useMemo(() => createStore<HpTipState>(null), []);

  const unifiedBuffLog = useMemo(
    () => consolidateBuffLog(buffLog, gearByPlayer),
    [buffLog, gearByPlayer],
  );
  const partyAliasSet = useMemo(() => {
    const set = new Set<string>();
    if (gearByPlayer) {
      for (const k of Object.keys(gearByPlayer)) set.add(k);
    }
    return set;
  }, [gearByPlayer]);
  const enemyTargetSet = useMemo(() => new Set([bossName]), [bossName]);
  const buffIntervals = useMemo(
    () => computeFightBuffIntervals(
      unifiedBuffLog,
      party,
      enemyTargetSet,
      fights.find(f => f.name === bossName)?.fightStartElapsed,
      fights.find(f => f.name === bossName)?.fightDurationSeconds ?? 0,
      partyAliasSet,
    ),
    [unifiedBuffLog, party, enemyTargetSet, partyAliasSet, fights, bossName],
  );
  const statusChoices = useMemo(() => listStatusChoices(buffIntervals), [buffIntervals]);
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const toggleStatus = (name: string) => setSelectedStatuses(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const clearStatuses = () => setSelectedStatuses(new Set());
  const selectAllStatuses = () => setSelectedStatuses(new Set(statusChoices.map(c => c.key)));

  const [showBossHp, setShowBossHp] = useState(true);
  const [showPlayerHp, setShowPlayerHp] = useState(true);
  const [showPlayerMp, setShowPlayerMp] = useState(false);
  const [showPlayerTp, setShowPlayerTp] = useState(false);

  const applyDefaultFilters = () => {
    setEnabledCats(new Set());
    setSelectedStatuses(new Set());
    setShowBossHp(true);
    setShowPlayerHp(true);
    setShowPlayerMp(false);
    setShowPlayerTp(false);
  };
  const resetAllFilters = applyDefaultFilters;
  const clearAllFilters = () => {
    setEnabledCats(new Set());
    setSelectedStatuses(new Set());
    setShowBossHp(false);
    setShowPlayerHp(false);
    setShowPlayerMp(false);
    setShowPlayerTp(false);
  };
  const filtersAreDefault =
    enabledCats.size === 0 &&
    selectedStatuses.size === 0 &&
    showBossHp && showPlayerHp && !showPlayerMp && !showPlayerTp;
  // Boss-HP-curve hover tooltip
  const tlRef = useRef<HTMLDivElement | null>(null);
  const hpTipPending = useRef<HpTipState>(null);
  const hpTipRaf = useRef<number | null>(null);
  const scheduleHpTip = useCallback((v: HpTipState) => {
    hpTipPending.current = v;
    if (hpTipRaf.current != null) return;
    hpTipRaf.current = requestAnimationFrame(() => {
      hpTipRaf.current = null;
      hpTipStore.set(hpTipPending.current);
    });
  }, [hpTipStore]);
  const clearHpTip = useCallback(() => {
    if (hpTipRaf.current != null) {
      cancelAnimationFrame(hpTipRaf.current);
      hpTipRaf.current = null;
    }
    hpTipPending.current = null;
    hpTipStore.set(null);
  }, [hpTipStore]);
  useEffect(() => () => {
    if (hpTipRaf.current != null) cancelAnimationFrame(hpTipRaf.current);
  }, []);

  const toggleCat = (c: RenderCat) => {
    setEnabledCats(prev => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  };

  const { playerEntries, bossEntries, buffEntries, itemEntries, allPlayers, byPlayer } = useMemo(() => {
    if (!fight) {
      return {
        playerEntries: [] as ActionLogEntry[],
        bossEntries: [] as ActionLogEntry[],
        buffEntries: [] as ActionLogEntry[],
        itemEntries: [] as ActionLogEntry[],
        allPlayers: [] as string[],
        byPlayer: {} as Record<string, ActionLogEntry[]>,
      };
    }
    const partyNamesLocal = [...partySet];
    const pEntries = normalizedLog.filter(
      e => e.from === 'player' && getTargets(e).some(t => t.mob === fight.name),
    );
    const bEntries = normalizedLog.filter(e => e.player === fight.name && e.from === 'boss');
    const bfEntries = normalizedLog.filter(e =>
      e.from === 'buff' &&
      e.elapsed >= fight.fightStartElapsed &&
      e.elapsed <= fight.fightStartElapsed + fight.fightDurationSeconds,
    );
    const iEntries: ActionLogEntry[] = (itemUseLog ?? [])
      .filter(u =>
        u.elapsed >= fight.fightStartElapsed &&
        u.elapsed <= fight.fightStartElapsed + fight.fightDurationSeconds,
      )
      .map(u => ({ elapsed: u.elapsed, player: u.player, name: u.item, type: 'ja', from: 'item' }));
    const fightBuffTargets = new Set<string>();
    for (const iv of buffIntervals) fightBuffTargets.add(iv.player);
    const taggedPets = buildPetNameSet(normalizedLog);
    const isPet = (n: string) => isPetName(n, partyNamesLocal, taggedPets);
    const players = Array.from(new Set([
      ...partyNamesLocal.filter(n =>
        pEntries.some(e => e.player === n) || bfEntries.some(e => e.player === n) ||
        iEntries.some(e => e.player === n) || fightBuffTargets.has(n),
      ),
      ...pEntries.map(e => e.player).filter(n => !partyNamesLocal.includes(n) && !isPet(n)),
      ...bfEntries.map(e => e.player).filter(n => !partyNamesLocal.includes(n) && !isPet(n)),
      ...iEntries.map(e => e.player).filter(n => !partyNamesLocal.includes(n) && !isPet(n)),
    ]));
    const by: Record<string, ActionLogEntry[]> = {};
    for (const p of players) {
      by[p] = [
        ...pEntries.filter(e => e.player === p),
        ...bfEntries.filter(e => e.player === p),
        ...iEntries.filter(e => e.player === p),
      ];
    }
    return {
      playerEntries: pEntries,
      bossEntries: bEntries,
      buffEntries: bfEntries,
      itemEntries: iEntries,
      allPlayers: players,
      byPlayer: by,
    };
  }, [fight, normalizedLog, partySet, itemUseLog, buffIntervals]);
  const allFightEntries = useMemo(
    () => [...playerEntries, ...bossEntries, ...buffEntries, ...itemEntries],
    [playerEntries, bossEntries, buffEntries, itemEntries],
  );

  const bossRowData = useMemo(() => {
    if (!fight) return { samples: [] as { elapsed: number; hpp: number }[], onHpHover: undefined as ((relSec: number, clientX: number, clientY: number) => void) | undefined, onHpLeave: undefined as (() => void) | undefined };
    const samples = showBossHp ? (bossHpLog ?? [])
      .filter(s => s.name === fight.name && (entityId == null || s.id == null || s.id === entityId) && s.elapsed >= fight.fightStartElapsed - 2 && s.elapsed <= fight.fightStartElapsed + fight.fightDurationSeconds + 5)
      .map(s => ({ elapsed: s.elapsed, hpp: s.hpp })) : [];
    if (samples.length === 0) return { samples, onHpHover: undefined, onHpLeave: undefined };
    const onHpHover = (relSec: number, clientX: number, clientY: number) => {
      const box = tlRef.current?.getBoundingClientRect();
      if (!box) return;
      scheduleHpTip({
        hpp: hppAtRel(samples, fight.fightStartElapsed, relSec),
        sec: Math.round(relSec),
        left: clientX - box.left,
        top: clientY - box.top,
        boxW: box.width,
        kind: 'boss-hp',
        label: `${fight.name} HP`,
      });
    };
    return { samples, onHpHover, onHpLeave: clearHpTip };
  }, [fight, showBossHp, bossHpLog, entityId, scheduleHpTip, clearHpTip]);

  type PlayerRowData = {
    hpSamples: { elapsed: number; hpp: number }[];
    mpSamples: { elapsed: number; hpp: number }[];
    tpSamples: { elapsed: number; hpp: number }[];
    onHpHover?: (relSec: number, clientX: number, clientY: number) => void;
    onHpLeave?: () => void;
  };
  const playerRowData = useMemo(() => {
    const map = new Map<string, PlayerRowData>();
    if (!fight) return map;
    const winLo = fight.fightStartElapsed - 2;
    const winHi = fight.fightStartElapsed + fight.fightDurationSeconds + 5;
    for (const player of allPlayers) {
      const playerHpRaw = showPlayerHp ? (partyHpLog ?? []).filter(s => s.player === player && s.elapsed >= winLo && s.elapsed <= winHi) : [];
      const playerMpRaw = showPlayerMp ? (partyMpLog ?? []).filter(s => s.player === player && s.elapsed >= winLo && s.elapsed <= winHi) : [];
      const playerTpRaw = showPlayerTp ? (partyTpLog ?? []).filter(s => s.player === player && s.elapsed >= winLo && s.elapsed <= winHi) : [];
      let mpMin = Infinity, mpMax = -Infinity;
      for (const s of playerMpRaw) { if (s.mpp < mpMin) mpMin = s.mpp; if (s.mpp > mpMax) mpMax = s.mpp; }
      const mpVaries = playerMpRaw.length > 1 && (mpMax - mpMin) >= 5;
      let tpMin = Infinity, tpMax = -Infinity;
      for (const s of playerTpRaw) { if (s.tp < tpMin) tpMin = s.tp; if (s.tp > tpMax) tpMax = s.tp; }
      const tpVaries = playerTpRaw.length > 1 && (tpMax - tpMin) >= 100;
      const playerHpSamples = playerHpRaw.map(s => ({ elapsed: s.elapsed, hpp: s.hpp }));
      const playerMpSamples = mpVaries ? playerMpRaw.map(s => ({ elapsed: s.elapsed, hpp: s.mpp })) : [];
      // TP is 0-3000; normalize to the 0-100 scale HpCurve expects (/30).
      const playerTpSamples = tpVaries ? playerTpRaw.map(s => ({ elapsed: s.elapsed, hpp: Math.min(100, s.tp / 30) })) : [];
      const hasHp = playerHpSamples.length > 0;
      const hasMp = playerMpSamples.length > 0;
      const hasTp = playerTpSamples.length > 0;
      const curveCount = (hasHp ? 1 : 0) + (hasMp ? 1 : 0) + (hasTp ? 1 : 0);
      const hoverKind: 'hp' | 'mp' | 'tp' | null = curveCount !== 1
        ? null
        : hasHp ? 'hp' : hasMp ? 'mp' : 'tp';
      let onHpHover: PlayerRowData['onHpHover'];
      let onHpLeave: PlayerRowData['onHpLeave'];
      if (hoverKind != null) {
        const samples = hoverKind === 'hp' ? playerHpSamples : hoverKind === 'mp' ? playerMpSamples : playerTpSamples;
        const kind: HpTipKind = hoverKind === 'hp' ? 'player-hp' : hoverKind === 'mp' ? 'player-mp' : 'player-tp';
        const labelSuffix = hoverKind === 'hp' ? 'HP' : hoverKind === 'mp' ? 'MP' : 'TP';
        onHpHover = (relSec, clientX, clientY) => {
          const box = tlRef.current?.getBoundingClientRect();
          if (!box) return;
          scheduleHpTip({
            hpp: hppAtRel(samples, fight.fightStartElapsed, relSec),
            sec: Math.round(relSec),
            left: clientX - box.left,
            top: clientY - box.top,
            boxW: box.width,
            kind,
            label: `${player} ${labelSuffix}`,
          });
        };
        onHpLeave = clearHpTip;
      }
      map.set(player, { hpSamples: playerHpSamples, mpSamples: playerMpSamples, tpSamples: playerTpSamples, onHpHover, onHpLeave });
    }
    return map;
  }, [fight, allPlayers, partyHpLog, partyMpLog, partyTpLog, showPlayerHp, showPlayerMp, showPlayerTp, scheduleHpTip, clearHpTip]);

  const onEntryHover = useCallback((e: ActionLogEntry) => hoverStore.set(e), [hoverStore]);
  const onEntryLeave = useCallback(() => hoverStore.set(null), [hoverStore]);

  if (!fight) return null;

  const pxPerSec = pxPerSecFor(fight.fightDurationSeconds);
  const timelineWidth = fight.fightDurationSeconds * pxPerSec;

  const bossHpSamplesForRow = bossRowData.samples;
  const hasEnemyBandIntervals = buffIntervals.some(iv => iv.targetGroup === 'enemy');
  const bossRowShown = bossEntries.length > 0 || bossHpSamplesForRow.length > 0 || hasEnemyBandIntervals;
  const playerIdxMap = new Map(allPlayers.map((p, i) => [p, i]));
  const targetYOf = (target: string, group: 'party' | 'enemy'): number | null => {
    if (group === 'enemy') return bossRowShown ? 0 : null;
    const i = playerIdxMap.get(target);
    if (i == null) return null;
    return (bossRowShown ? ROW_HEIGHT : 0) + i * ROW_HEIGHT;
  };
  const rowsHeight = (bossRowShown ? ROW_HEIGHT : 0) + allPlayers.length * ROW_HEIGHT;

  if (allPlayers.length === 0 && bossEntries.length === 0) return null;

  return (
    <div className={bare ? 'border-t border-white/10 pt-5 mt-5 space-y-3' : 'bg-row-even border border-white/10 rounded-xl p-5 space-y-3'}>
      {/* Filter legend - one segmented control per category, plus a curves row
          for the boss/player HP and MP overlays, and Reset / Clear actions on
          the right. */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-[10px]">
          <span className="w-16 shrink-0 uppercase tracking-wide text-gray-400 font-semibold">Filters</span>
          <span className="text-gray-400">
            {enabledCats.size === RENDER_CAT_ORDER.length ? 'all' : `${enabledCats.size}/${RENDER_CAT_ORDER.length}`} categories
            {selectedStatuses.size > 0 && ` · ${selectedStatuses.size} status${selectedStatuses.size === 1 ? '' : 'es'}`}
            {(!showBossHp || !showPlayerHp) && ' · HP curves hidden'}
            {showPlayerMp && ' · MP shown'}
            {showPlayerTp && ' · TP shown'}
          </span>
          <div className="ml-auto flex gap-1.5">
            <button
              type="button"
              onClick={clearAllFilters}
              className="px-2.5 py-1 rounded-md text-[10px] font-medium uppercase tracking-wide border border-white/15 text-gray-300 hover:text-white hover:bg-white/[0.06] transition-colors"
              data-tooltip="Turn off every category, every selected status, and all three curves"
            >
              Clear Filters
            </button>
            <button
              type="button"
              onClick={resetAllFilters}
              disabled={filtersAreDefault}
              className={`px-2.5 py-1 rounded-md text-[10px] font-medium uppercase tracking-wide border transition-colors ${
                filtersAreDefault
                  ? 'border-white/[0.06] text-gray-700 cursor-default'
                  : 'border-accent/40 text-accent hover:bg-accent/15'
              }`}
              data-tooltip="Restore defaults: event categories off, status overlay cleared, boss + player HP curves shown, player MP hidden"
            >
              Reset All
            </button>
          </div>
        </div>
        {RENDER_CAT_GROUPS.map(group => (
          <div key={group.label} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
              {withTerm(group.label, enemyTerm)}
            </span>
            <div className="flex flex-1 rounded-md border border-white/15 overflow-hidden">
              {group.cats.map(c => {
                const meta = RENDER_META[c];
                const on = enabledCats.has(c);
                return (
                  <button
                    key={c}
                    onClick={() => toggleCat(c)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1 text-xs transition-colors border-r border-white/10 last:border-r-0 ${
                      on ? `bg-white/[0.06] ${meta.color}` : 'text-gray-400 bg-transparent hover:bg-white/[0.02]'
                    }`}
                  >
                    {c === 'spAbility'
                      ? <span className={`shrink-0 leading-none text-xs ${on ? 'text-fuchsia-300' : 'text-gray-400'}`}>★</span>
                      : <span className={`w-2 h-2 rounded-full inline-block shrink-0 ${on ? meta.dot.split(' ')[0] : 'bg-white/10'}`} />}
                    {withTerm(meta.label, enemyTerm)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {/* Curves row - Boss HP / Player HP / Player MP overlays. Mirrors the
            segmented-control styling of the category rows above for visual
            parity. */}
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Curves</span>
          <div className="flex flex-1 rounded-md border border-white/15 overflow-hidden">
            {([
              { id: 'bossHp',   on: showBossHp,   setter: setShowBossHp,   label: `${withTerm('Boss', enemyTerm)} HP`, dot: 'bg-rose-500',     color: 'text-rose-300' },
              { id: 'playerHp', on: showPlayerHp, setter: setShowPlayerHp, label: 'Player HP',                          dot: 'bg-emerald-500',   color: 'text-emerald-300' },
              { id: 'playerMp', on: showPlayerMp, setter: setShowPlayerMp, label: 'Player MP',                          dot: 'bg-sky-500',       color: 'text-sky-300' },
              { id: 'playerTp', on: showPlayerTp, setter: setShowPlayerTp, label: 'Player TP',                          dot: 'bg-amber-400',     color: 'text-amber-300' },
            ] as const).map(t => (
              <button
                key={t.id}
                onClick={() => t.setter(v => !v)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1 text-xs transition-colors border-r border-white/10 last:border-r-0 ${
                  t.on ? `bg-white/[0.06] ${t.color}` : 'text-gray-400 bg-transparent hover:bg-white/[0.02]'
                }`}
              >
                <span className={`w-2 h-2 rounded-full inline-block shrink-0 ${t.on ? t.dot : 'bg-white/10'}`} />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {statusChoices.length > 0 && (
        <div className="border border-white/10 rounded-lg p-2.5">
          <StatusOverlayPicker
            choices={statusChoices}
            selected={selectedStatuses}
            onToggle={toggleStatus}
            onClear={clearStatuses}
            onSelectAll={selectAllStatuses}
          />
        </div>
      )}

      <HoverInfo store={hoverStore} fightStart={fight.fightStartElapsed} />

      <div ref={tlRef} className="relative border border-white/10 rounded-xl overflow-hidden">
        <div className="flex items-center gap-4 px-4 py-2 border-b border-white/[0.08] text-xs text-gray-400">
          <span className="font-semibold text-gray-400">{fight.name}</span>
          <span>{fmt(fight.fightDurationSeconds)} fight</span>
          <span>{allFightEntries.length} actions logged</span>
          {bossEntries.length > 0 && <span className="text-rose-500/70">{bossEntries.length} boss moves</span>}
          {buffEntries.length > 0 && <span className="text-violet-500/70">{buffEntries.length} buffs</span>}
          <span>{allPlayers.length} players</span>
        </div>
        <div className="overflow-x-auto">
          <div style={{ width: LABEL_WIDTH + timelineWidth, minWidth: '100%' }}>
            <div className="flex border-b border-white/10">
              <div style={{ width: LABEL_WIDTH }} className="sticky left-0 z-10 bg-panel shrink-0 border-r border-white/[0.06]" />
              <TimeAxis duration={fight.fightDurationSeconds} pxPerSec={pxPerSec} />
            </div>
            <div className="relative" style={{ height: rowsHeight || undefined }}>
            {(bossEntries.length > 0 || bossRowData.samples.length > 0) && (
              <PlayerRow
                label={fight.name}
                labelClassName="text-rose-400 font-semibold"
                entries={bossEntries}
                fightStart={fight.fightStartElapsed}
                duration={fight.fightDurationSeconds}
                pxPerSec={pxPerSec}
                enabledCats={enabledCats}
                onHover={onEntryHover}
                onLeave={onEntryLeave}
                hpSamples={bossRowData.samples}
                hpStroke="rgba(244, 63, 94, 0.65)"
                hpFill="rgba(244, 63, 94, 0.10)"
                onHpHover={bossRowData.onHpHover}
                onHpLeave={bossRowData.onHpLeave}
              />
            )}
            {allPlayers.map(player => {
              const row = playerRowData.get(player);
              return (
                <PlayerRow
                  key={player}
                  label={player}
                  entries={byPlayer[player] ?? []}
                  fightStart={fight.fightStartElapsed}
                  duration={fight.fightDurationSeconds}
                  pxPerSec={pxPerSec}
                  enabledCats={enabledCats}
                  onHover={onEntryHover}
                  onLeave={onEntryLeave}
                  hpSamples={row?.hpSamples}
                  hpStroke="rgba(74, 222, 128, 0.55)"
                  hpFill="rgba(74, 222, 128, 0.08)"
                  mpSamples={row?.mpSamples}
                  tpSamples={row?.tpSamples}
                  onHpHover={row?.onHpHover}
                  onHpLeave={row?.onHpLeave}
                />
              );
            })}
            {/* Status overlay bands - per-player start dot + colored band
                + end dot for every selected status that landed on the
                player during the fight. Bands pack into vertical tracks
                when multiple statuses overlap in time on the same player. */}
            {selectedStatuses.size > 0 && (
              <div
                className="pointer-events-none absolute"
                style={{ left: LABEL_WIDTH, top: 0, width: timelineWidth, height: rowsHeight }}
              >
                <StatusOverlayBands
                  intervals={buffIntervals}
                  selected={selectedStatuses}
                  fightDuration={fight.fightDurationSeconds}
                  timelineWidth={timelineWidth}
                  targetYOf={targetYOf}
                  rowHeight={ROW_HEIGHT}
                />
              </div>
            )}
            </div>
          </div>
        </div>

        <HpTip store={hpTipStore} />
      </div>
    </div>
  );
}
