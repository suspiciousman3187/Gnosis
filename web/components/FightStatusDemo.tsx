'use client';


import { useMemo, useState } from 'react';
import type { BuffLogEntry, PartyMember, CharacterGear } from '@/lib/types';
import BuffIcon from './BuffIcon';


export interface BuffInterval {
  /** Target name: party member, boss, or other enemy that the status landed on. */
  player: string;
  /** 'party' = on a party member (friendly). 'enemy' = on the boss / mob. The
   *  rendering pipeline routes bands to different rows based on this. */
  targetGroup: 'party' | 'enemy';
  buffId?: number;
  buffName: string;
  start: number;   // seconds from fight start, clamped to [0, fightDuration]
  end: number;
  isDebuff: boolean;
  appliedBy?: string;
  /** 'party' = applied by a party member. 'enemy' = applied by a boss/mob.
   *  'unknown' when the addon couldn't attribute. */
  appliedByGroup: 'party' | 'enemy' | 'unknown';
  inferredOpen: boolean;
  inferredClose: boolean;
}

const DEBUFF_NAMES = new Set([
  'sleep', 'poison', 'paralysis', 'paralyze', 'blindness', 'blind', 'silence',
  'petrification', 'petrify', 'disease', 'curse', 'stun', 'bind', 'weight',
  'gravity', 'slow', 'charm', 'doom', 'amnesia', 'terror', 'addle', 'flash',
  'encumbrance', 'taint', 'plague', 'bane', 'mute', 'frost', 'burn', 'choke',
  'rasp', 'shock', 'drown', 'dia', 'bio', 'requiem', 'threnody', 'elegy',
  'lullaby', 'helix', 'frazzle', 'distract', 'inundation', 'impairment',
  'weakness',
]);
function isDebuffName(name: string): boolean {
  const lc = name.toLowerCase();
  if (DEBUFF_NAMES.has(lc)) return true;
  for (const d of DEBUFF_NAMES) if (lc.startsWith(d)) return true;
  if (lc.endsWith(' down')) return true;
  return false;
}

export function consolidateBuffLog(
  topBuffLog: BuffLogEntry[] | null | undefined,
  gearByPlayer: Record<string, CharacterGear> | null | undefined,
): BuffLogEntry[] {
  const all: BuffLogEntry[] = [];
  if (topBuffLog) all.push(...topBuffLog);
  if (gearByPlayer) {
    for (const gear of Object.values(gearByPlayer)) {
      if (gear?.buffLog) all.push(...gear.buffLog);
    }
  }
  if (all.length === 0) return all;
  all.sort((a, b) => a.elapsed - b.elapsed);
  const DEDUP_WINDOW = 2;
  const out: BuffLogEntry[] = [];
  const lastIdxByKey = new Map<string, number>();
  const sourceRank = (s?: BuffLogEntry['source']) =>
    s === '0x028' ? 3 : s === '0x029' ? 2 : s === '0x063' ? 1 : 0;
  for (const e of all) {
    const key = `${e.target}|${e.buffId}|${e.kind}`;
    const lastIdx = lastIdxByKey.get(key);
    if (lastIdx != null) {
      const last = out[lastIdx];
      if (Math.abs(e.elapsed - last.elapsed) <= DEDUP_WINDOW) {
        const eHasApplier = !!e.appliedBy;
        const lHasApplier = !!last.appliedBy;
        const eRank = sourceRank(e.source);
        const lRank = sourceRank(last.source);
        const eWins = (eHasApplier && !lHasApplier) || (eHasApplier === lHasApplier && eRank > lRank);
        if (eWins) {
          out[lastIdx] = {
            ...last,
            appliedBy: e.appliedBy ?? last.appliedBy,
            appliedBySpell: e.appliedBySpell ?? last.appliedBySpell,
            source: e.source ?? last.source,
            duration: e.duration ?? last.duration,
            elapsed: Math.min(e.elapsed, last.elapsed),
          };
        }
        continue;
      }
    }
    out.push(e);
    lastIdxByKey.set(key, out.length - 1);
  }
  return out;
}

export function computeFightBuffIntervals(
  buffLog: BuffLogEntry[] | null | undefined,
  party: PartyMember[] | null | undefined,
  enemyTargets: Iterable<string> | null | undefined,
  fightStartElapsed: number | null | undefined,
  fightDurationSeconds: number,
  partyAliases?: Iterable<string> | null,
): BuffInterval[] {
  const out: BuffInterval[] = [];
  if (!buffLog || fightStartElapsed == null || fightDurationSeconds <= 0) return out;
  const partyNames = new Set((party ?? []).map(p => p.name));
  if (partyAliases) {
    for (const a of partyAliases) partyNames.add(a);
  }
  const enemyNames = new Set(enemyTargets ?? []);
  const fEnd = fightStartElapsed + fightDurationSeconds;
  type OpenEvt = {
    id?: number;
    openedAtAbs: number;
    appliedBy?: string;
    appliedByGroup: 'party' | 'enemy' | 'unknown';
    debuff: boolean;
    inferredOpen: boolean;
    targetGroup: 'party' | 'enemy';
  };
  const openByKey = new Map<string, OpenEvt>();
  const key = (p: string, n: string) => `${p}|${n}`;
  const classifyApplier = (name: string | undefined): 'party' | 'enemy' | 'unknown' =>
    !name ? 'unknown' : partyNames.has(name) ? 'party' : enemyNames.has(name) ? 'enemy' : 'unknown';

  for (const e of buffLog) {
    if (e.elapsed > fEnd) break;
    const onParty = partyNames.has(e.target);
    const onEnemy = enemyNames.has(e.target);
    if (!onParty && !onEnemy) continue;
    const targetGroup: 'party' | 'enemy' = onParty ? 'party' : 'enemy';
    if (e.kind === 'gain') {
      openByKey.set(key(e.target, e.buffName), {
        id: e.buffId,
        openedAtAbs: e.elapsed,
        appliedBy: e.appliedBy,
        appliedByGroup: classifyApplier(e.appliedBy),
        debuff: isDebuffName(e.buffName),
        inferredOpen: e.elapsed < fightStartElapsed,
        targetGroup,
      });
    } else {
      const open = openByKey.get(key(e.target, e.buffName));
      if (open && e.elapsed >= fightStartElapsed) {
        out.push({
          player: e.target,
          targetGroup: open.targetGroup,
          buffId: open.id,
          buffName: e.buffName,
          start: Math.max(0, open.openedAtAbs - fightStartElapsed),
          end: Math.min(fightDurationSeconds, e.elapsed - fightStartElapsed),
          isDebuff: open.debuff,
          appliedBy: open.appliedBy,
          appliedByGroup: open.appliedByGroup,
          inferredOpen: open.inferredOpen,
          inferredClose: false,
        });
      }
      openByKey.delete(key(e.target, e.buffName));
    }
  }
  for (const [k, open] of openByKey) {
    const [player, buffName] = k.split('|');
    out.push({
      player,
      targetGroup: open.targetGroup,
      buffId: open.id,
      buffName,
      start: Math.max(0, open.openedAtAbs - fightStartElapsed),
      end: fightDurationSeconds,
      isDebuff: open.debuff,
      appliedBy: open.appliedBy,
      appliedByGroup: open.appliedByGroup,
      inferredOpen: open.inferredOpen,
      inferredClose: true,
    });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

export interface StatusChoice {
  /** Composite picker key - same name on party vs enemy stays distinct. */
  key: string;
  name: string;
  isDebuff: boolean;
  targetGroup: 'party' | 'enemy';
  count: number;
  buffId?: number;
}
export const statusKey = (name: string, targetGroup: 'party' | 'enemy') =>
  `${targetGroup}|${name}`;

export function listStatusChoices(intervals: BuffInterval[]): StatusChoice[] {
  const m = new Map<string, StatusChoice>();
  for (const iv of intervals) {
    const k = statusKey(iv.buffName, iv.targetGroup);
    const cur = m.get(k);
    if (cur) cur.count += 1;
    else m.set(k, { key: k, name: iv.buffName, isDebuff: iv.isDebuff, targetGroup: iv.targetGroup, count: 1, buffId: iv.buffId });
  }
  return [...m.values()].sort((a, b) => {
    // Primary: party targets first, enemy targets second (matches the two
    // picker sections "On Player" / "On Enemy").
    if (a.targetGroup !== b.targetGroup) return a.targetGroup === 'party' ? -1 : 1;
    // Secondary: debuffs before buffs within each section so the more
    // attention-grabbing rows surface first.
    if (a.isDebuff !== b.isDebuff) return a.isDebuff ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ── Picker UI ────────────────────────────────────────────────────────────────

function StatusChip({
  choice, on, onToggle,
}: {
  choice: StatusChoice;
  on: boolean;
  onToggle: (key: string) => void;
}) {
  const pal = paletteFor(choice.name, choice.isDebuff);
  const cls = on
    ? `${pal.fill} ${pal.border} text-white`
    : 'bg-white/[0.03] border-white/10 text-gray-400 hover:bg-white/[0.06] hover:text-gray-200';
  return (
    <button
      onClick={() => onToggle(choice.key)}
      className={`flex w-full items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium border transition-colors min-w-0 ${cls}`}
      data-tooltip={`${choice.isDebuff ? 'Debuff' : 'Buff'} on ${choice.targetGroup === 'party' ? 'party' : 'enemy'} · ${choice.count} interval${choice.count === 1 ? '' : 's'}`}
    >
      <BuffIcon id={choice.buffId} size={16} />
      <span className="truncate flex-1 text-left">{choice.name}</span>
      <span className="text-[10px] opacity-60 font-mono shrink-0">{choice.count}</span>
    </button>
  );
}

function PickerActionButton({
  onClick, children, variant = 'neutral',
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'neutral' | 'accent';
}) {
  const cls = variant === 'accent'
    ? 'border-accent/40 text-accent hover:bg-accent/15'
    : 'border-white/15 text-gray-300 hover:text-white hover:bg-white/[0.06]';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-[10px] font-medium uppercase tracking-wide border transition-colors ${cls}`}
    >
      {children}
    </button>
  );
}

export function StatusOverlayPicker({
  choices, selected, onToggle, onClear, onSelectAll, label,
}: {
  choices: StatusChoice[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onClear: () => void;
  onSelectAll: () => void;
  label?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (choices.length === 0) {
    return (
      <div className="text-[11px] text-gray-400 italic">
        No tracked status events landed during this fight.
      </div>
    );
  }
  const onPlayer = choices.filter(c => c.targetGroup === 'party');
  const onEnemy  = choices.filter(c => c.targetGroup === 'enemy');
  const selectedOnPlayer = onPlayer.filter(c => selected.has(c.key)).length;
  const selectedOnEnemy  = onEnemy.filter(c => selected.has(c.key)).length;
  // Per-section actions: select / clear ONLY that section, leaving the other
  // untouched. The global header keeps the "all / clear all" shortcut.
  const setForSection = (section: StatusChoice[], turnOn: boolean) => {
    for (const c of section) {
      const isOn = selected.has(c.key);
      if (turnOn !== isOn) onToggle(c.key);
    }
  };
  return (
    <div className="space-y-2.5">
      {/* Always-visible header. The chevron + title area toggles the picker;
          the action buttons are right-aligned and only render when expanded
          (otherwise clicking them while collapsed is awkward). */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-2 group focus:outline-none"
          aria-expanded={expanded}
          aria-controls="status-overlay-body"
        >
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`text-gray-400 group-hover:text-gray-200 transition-transform ${expanded ? 'rotate-90' : ''}`}
            aria-hidden="true"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
          <span className="text-[10px] uppercase tracking-wide text-gray-400 group-hover:text-gray-200 font-semibold transition-colors">
            {label ?? 'Status Overlay'}
          </span>
          <span className="text-[10px] text-gray-400">
            {selected.size} of {choices.length} selected
          </span>
        </button>
        {expanded && (
          <div className="ml-auto flex gap-1.5">
            <PickerActionButton onClick={onSelectAll}>Select All</PickerActionButton>
            <PickerActionButton onClick={onClear}>Clear</PickerActionButton>
          </div>
        )}
      </div>
      {expanded && (
        <div id="status-overlay-body" className="space-y-2.5">
          <StatusSection
            title="On Player"
            list={onPlayer}
            selectedCount={selectedOnPlayer}
            selected={selected}
            onToggle={onToggle}
            setForSection={setForSection}
          />
          <StatusSection
            title="On Enemy"
            list={onEnemy}
            selectedCount={selectedOnEnemy}
            selected={selected}
            onToggle={onToggle}
            setForSection={setForSection}
          />
        </div>
      )}
    </div>
  );
}

function StatusSection({
  title, list, selectedCount, selected, onToggle, setForSection,
}: {
  title: string;
  list: StatusChoice[];
  selectedCount: number;
  selected: Set<string>;
  onToggle: (key: string) => void;
  setForSection: (section: StatusChoice[], turnOn: boolean) => void;
}) {
  if (list.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-400">
          {title}
        </span>
        <span className="text-[10px] text-gray-400">
          {selectedCount} of {list.length} selected
        </span>
        <div className="ml-auto flex gap-1.5">
          <PickerActionButton onClick={() => setForSection(list, true)}>Select All</PickerActionButton>
          <PickerActionButton onClick={() => setForSection(list, false)}>Clear</PickerActionButton>
        </div>
      </div>
      {/* Auto-fit grid so chips share each row's width evenly. minmax(170px,
          1fr) gives enough room for a 16px icon + a typical buff name (e.g.
          "Haste Samba" / "Magic Def. Down") + the count, while still
          collapsing to fewer columns on narrow screens. */}
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
      >
        {list.map(c => (
          <StatusChip
            key={c.key}
            choice={c}
            on={selected.has(c.key)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}


function fmtClock(s: number): string {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
function fmtDur(s: number): string {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

interface PackedBand extends BuffInterval {
  track: number;
}
function packTracks(intervals: BuffInterval[]): PackedBand[] {
  // Greedy interval scheduling. Sort by start; each new band gets the lowest
  // track index whose last-end is <= its start. Tracks grow as needed.
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const trackEnds: number[] = [];
  const out: PackedBand[] = [];
  for (const iv of sorted) {
    let placed = -1;
    for (let t = 0; t < trackEnds.length; t++) {
      if (trackEnds[t] <= iv.start) { placed = t; break; }
    }
    if (placed === -1) { placed = trackEnds.length; trackEnds.push(0); }
    trackEnds[placed] = iv.end;
    out.push({ ...iv, track: placed });
  }
  return out;
}

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}
type BandPalette = { fill: string; border: string };
const BUFF_PALETTE: BandPalette[] = [
  { fill: 'bg-emerald-500/60', border: 'border-emerald-300/80' },
  { fill: 'bg-sky-500/60',     border: 'border-sky-300/80'     },
  { fill: 'bg-amber-500/60',   border: 'border-amber-300/80'   },
  { fill: 'bg-fuchsia-500/60', border: 'border-fuchsia-300/80' },
  { fill: 'bg-cyan-500/60',    border: 'border-cyan-300/80'    },
  { fill: 'bg-violet-500/60',  border: 'border-violet-300/80'  },
  { fill: 'bg-lime-500/60',    border: 'border-lime-300/80'    },
  { fill: 'bg-teal-500/60',    border: 'border-teal-300/80'    },
  { fill: 'bg-indigo-500/60',  border: 'border-indigo-300/80'  },
  { fill: 'bg-yellow-500/60',  border: 'border-yellow-300/80'  },
];
const DEBUFF_PALETTE: BandPalette[] = [
  { fill: 'bg-rose-500/60',   border: 'border-rose-300/80'   },
  { fill: 'bg-red-500/60',    border: 'border-red-300/80'    },
  { fill: 'bg-orange-600/60', border: 'border-orange-300/80' },
  { fill: 'bg-pink-500/60',   border: 'border-pink-300/80'   },
];
function paletteFor(buffName: string, isDebuff: boolean): BandPalette {
  const pal = isDebuff ? DEBUFF_PALETTE : BUFF_PALETTE;
  return pal[hashName(buffName) % pal.length];
}

export function StatusOverlayBands({
  intervals, selected, fightDuration, timelineWidth, targetYOf, rowHeight,
}: {
  intervals: BuffInterval[];
  selected: Set<string>;
  fightDuration: number;
  timelineWidth: number;
  targetYOf: (target: string, group: 'party' | 'enemy') => number | null;
  rowHeight: number;
}) {
  const packedByPlayer = useMemo(() => {
    const visible = intervals.filter(iv => selected.has(statusKey(iv.buffName, iv.targetGroup)));
    const byTarget = new Map<string, BuffInterval[]>();
    for (const iv of visible) {
      const k = `${iv.targetGroup}|${iv.player}`;
      let arr = byTarget.get(k);
      if (!arr) { arr = []; byTarget.set(k, arr); }
      arr.push(iv);
    }
    const out = new Map<string, PackedBand[]>();
    for (const [k, list] of byTarget) out.set(k, packTracks(list));
    return out;
  }, [intervals, selected]);

  if (packedByPlayer.size === 0 || fightDuration <= 0 || timelineWidth <= 0) return null;

  const BAND_H  = 6;
  const TRACK_GAP = 2;
  const ICON_SIZE = 16;
  const BANDS_TOP = rowHeight - 20;

  return (
    <div className="pointer-events-none absolute inset-0">
      {[...packedByPlayer.entries()].flatMap(([groupKey, bands]) => {
        const [groupStr, player] = groupKey.split('|');
        const group = groupStr === 'enemy' ? 'enemy' as const : 'party' as const;
        const y = targetYOf(player, group);
        if (y == null) return [];
        return bands.map((b, i) => {
          const xStart = (b.start / fightDuration) * timelineWidth;
          const xEnd   = (b.end   / fightDuration) * timelineWidth;
          const width  = Math.max(2, xEnd - xStart);
          const top    = y + BANDS_TOP + b.track * (BAND_H + TRACK_GAP);
          const pal    = paletteFor(b.buffName, b.isDebuff);
          const applier = b.appliedBy
            ? ` · from ${b.appliedBy}${b.appliedByGroup === 'enemy' ? ' (enemy)' : b.appliedByGroup === 'party' ? ' (party)' : ''}`
            : '';
          const tooltip = `${player} · ${b.buffName} · ${fmtClock(b.start)}→${fmtClock(b.end)} (${fmtDur(b.end - b.start)})${applier}${b.inferredOpen ? ' · was active at fight start' : ''}${b.inferredClose ? ' · still active at fight end' : ''}`;
          const fadeStart = b.inferredOpen;
          const fadeEnd   = b.inferredClose;
          const mask = fadeStart && fadeEnd
            ? 'linear-gradient(90deg, transparent 0%, black 12%, black 88%, transparent 100%)'
            : fadeStart
              ? 'linear-gradient(90deg, transparent 0%, black 12%, black 100%)'
              : fadeEnd
                ? 'linear-gradient(90deg, black 0%, black 88%, transparent 100%)'
                : undefined;
          const iconTop = top + BAND_H / 2 - ICON_SIZE / 2;
          return (
            <div key={`${player}-${i}`} className="pointer-events-auto">
              <div
                className={`absolute rounded-sm border ${pal.fill} ${pal.border}`}
                style={{
                  left: xStart,
                  top,
                  width,
                  height: BAND_H,
                  WebkitMaskImage: mask,
                  maskImage: mask,
                }}
                data-tooltip={tooltip}
              />
              {!fadeStart && (
                <div
                  className="absolute"
                  style={{
                    left: xStart - ICON_SIZE / 2,
                    top: iconTop,
                    width: ICON_SIZE,
                    height: ICON_SIZE,
                  }}
                  data-tooltip={tooltip}
                >
                  <BuffIcon id={b.buffId} size={ICON_SIZE} />
                </div>
              )}
              {!fadeEnd && (
                <div
                  className="absolute opacity-40"
                  style={{
                    left: xEnd - ICON_SIZE / 2,
                    top: iconTop,
                    width: ICON_SIZE,
                    height: ICON_SIZE,
                  }}
                  data-tooltip={tooltip}
                >
                  <BuffIcon id={b.buffId} size={ICON_SIZE} />
                </div>
              )}
            </div>
          );
        });
      })}
    </div>
  );
}
