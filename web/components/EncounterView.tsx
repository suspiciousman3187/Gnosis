'use client';

import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import { reconcileSelfName, type Encounter, type EncounterEnemy, type CurrencySnapshot } from '@/lib/encounter';
import type { BossReport } from '@/lib/types';
import { JOB_ICONS, mainJobKey } from '@/components/JobIcon';
import { BossReportSection, buildJobMap } from '@/lib/reportShared';
import Collapse from '@/components/Collapse';
import { isPetName, buildPetNameSet } from '@/lib/petDetect';
import ActionTimelineTab, { BuffsPanel } from '@/components/ActionTimelineTab';
import CombatStatsTab from '@/components/CombatStatsTab';
import { EnemyTermContext } from '@/components/EnemyTerm';
import ItemIcon from '@/components/ItemIcon';
import GearSets from '@/components/GearSets';
import EncounterMapTab from '@/components/EncounterMapTab';
import DeathReport from '@/components/DeathReport';
import DisablingDebuffsPanel from '@/components/DisablingDebuffsPanel';
import BattleMessagesPanel from '@/components/BattleMessagesPanel';
import JobExtendedPanel from '@/components/JobExtendedPanel';
import EffectLogPanel from '@/components/EffectLogPanel';
import GainsPanel from '@/components/GainsPanel';
import FightsPanel from '@/components/FightsPanel';
import { makeGearIndex } from '@/lib/gearLookup';
import { statsForEnemy, playerMetricsForEncounter, combatStatsFromActionLog } from '@/lib/combatStats';
import { buildIdNameMap } from '@/lib/idNameResolver';
import { imgSrc } from '@/lib/img';

function fmtDur(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
function mmss(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
function killTimeColor(t: number | null, avg: number | null): string {
  if (t == null || avg == null || avg <= 0) return 'text-gray-300';
  const r = t / avg;
  if (r <= 0.5)  return 'text-emerald-400';
  if (r <= 0.8)  return 'text-emerald-300';
  if (r <= 1.25) return 'text-gray-200';
  if (r <= 2.0)  return 'text-rose-300';
  return 'text-rose-400';
}
function hhmmss(s: number, withHours = true) {
  const total = Math.max(0, Math.floor(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return withHours ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
}
function humanDur(s: number) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return sec ? `${h}h ${m}m ${sec}s` : (m ? `${h}h ${m}m` : `${h}h`);
  return sec ? `${m}m ${sec}s` : `${m}m`;
}
function fmtEncDate(unixSec: number) {
  return new Date(unixSec * 1000).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}
const nf = (n: number) => n.toLocaleString();
const nfCompact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const nfC = (n: number) => nfCompact.format(n);

const JOB_BY_ID: Record<number, string> = {
  0: 'NON', 1: 'WAR', 2: 'MNK', 3: 'WHM', 4: 'BLM', 5: 'RDM', 6: 'THF', 7: 'PLD',
  8: 'DRK', 9: 'BST', 10: 'BRD', 11: 'RNG', 12: 'SAM', 13: 'NIN', 14: 'DRG',
  15: 'SMN', 16: 'BLU', 17: 'COR', 18: 'PUP', 19: 'DNC', 20: 'SCH', 21: 'GEO', 22: 'RUN',
};
const jobName = (id?: number) => (id != null && JOB_BY_ID[id]) ? JOB_BY_ID[id] : null;
const ratePerHour = (total: number, durationSec: number) =>
  durationSec > 0 ? Math.round((total / durationSec) * 3600) : 0;

function EnemyGroup({ name, items, total, killed, onSelect }: {
  name: string;
  items: { e: EncounterEnemy; ka: number | null }[];
  total: number;
  killed: number;
  onSelect?: (name: string, id?: number, spawnSeq?: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const linkClass = onSelect ? 'cursor-pointer hover:bg-accent/[0.08] hover:text-accent transition-colors' : '';
  if (items.length === 1) {
    const { e, ka } = items[0];
    return (
      <div
        onClick={onSelect ? () => onSelect(name, e.id, e.spawnSeq) : undefined}
        className={`flex items-center gap-2 text-sm py-1 border-b border-white/[0.05] last:border-0 ${linkClass}`}
      >
        <span className="text-gray-200 truncate">{e.name}</span>
        {ka != null ? (
          <span className="text-[10px] font-mono text-emerald-300/70 shrink-0">{mmss(ka)}</span>
        ) : (
          <span className="text-[10px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10 shrink-0">survived</span>
        )}
        <span className="ml-auto font-mono text-rose-300/80 shrink-0">{nf(e.damageTaken)}</span>
      </div>
    );
  }
  return (
    <div className="border-b border-white/[0.05] last:border-0">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 text-sm py-1 hover:bg-white/[0.03] rounded transition-colors">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}><path d="M9 6l6 6-6 6" /></svg>
        <span className="text-gray-200 truncate">{name}</span>
        <span className="text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded bg-white/10 text-gray-300 border border-white/10 shrink-0">×{items.length}</span>
        <span className="text-[10px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">{killed}/{items.length} killed</span>
        <span className="ml-auto font-mono text-rose-300/80 shrink-0">{nf(total)}</span>
      </button>
      {open && (
        <div className="pl-5 pb-1">
          {items.map(({ e, ka }, i) => (
            <div
              key={`${e.id ?? ''}-${e.firstSeen}-${i}`}
              onClick={onSelect ? () => onSelect(name, e.id, e.spawnSeq) : undefined}
              className={`flex items-center gap-2 text-xs py-0.5 ${linkClass}`}
            >
              <span className="text-gray-400 shrink-0">#{i + 1}</span>
              {ka != null ? (
                <span className="text-emerald-300/80 shrink-0">killed {mmss(ka)}</span>
              ) : (
                <span className="text-gray-400 shrink-0">survived</span>
              )}
              <span className="ml-auto font-mono text-rose-300/70 shrink-0">{nf(e.damageTaken)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import {
  classify as classifyContent,
  itemNamesFromLootSummary,
  mobNamesFromLootSummary,
  resolveContentColor,
  resolveContentLabel,
} from '@/lib/contentRegistry';
import type { LootEncounterSummary } from '@/lib/dropAggregator';
import { useDisplayLanguageEager } from '@/lib/displayLanguage';
import { effectiveLanguage, translateByIdSync } from '@/lib/translate';

const JOB_BAR: Record<string, string> = {
  war: 'bg-red-700/50', mnk: 'bg-orange-600/50', whm: 'bg-pink-600/50', blm: 'bg-indigo-600/50',
  rdm: 'bg-red-500/50', thf: 'bg-emerald-700/50', pld: 'bg-sky-700/50', drk: 'bg-violet-800/50',
  bst: 'bg-lime-700/50', brd: 'bg-gray-500/50', rng: 'bg-green-700/50', sam: 'bg-red-600/50',
  nin: 'bg-slate-500/50', drg: 'bg-blue-700/50', smn: 'bg-cyan-700/50', blu: 'bg-sky-500/50',
  cor: 'bg-amber-700/50', pup: 'bg-orange-700/50', dnc: 'bg-rose-500/50', sch: 'bg-indigo-500/50',
  geo: 'bg-yellow-700/50', run: 'bg-teal-700/50', trust: 'bg-purple-800/50',
};

type Tab = 'overview' | 'combat' | 'stats' | 'status' | 'deaths' | 'gear' | 'actions' | 'map';

function TabBtn({ id, label, active, setActive, scrollRef }: { id: Tab; label: string; active: Tab; setActive: (t: Tab) => void; scrollRef?: React.Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={scrollRef}
      onClick={() => setActive(id)}
      className={`shrink-0 md:flex-1 text-center px-3 sm:px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
        active === id
          ? 'bg-surface-raised text-accent border border-accent/40 shadow-sm'
          : 'text-gray-300 border border-transparent hover:text-white hover:bg-white/[0.06]'
      }`}
    >
      {label}
    </button>
  );
}

function JobIcon({ job, size = 28 }: { job: string | null | undefined; size?: number }) {
  const key = mainJobKey(job ?? undefined);
  if (!key || !JOB_ICONS[key]) {
    return <span className="inline-block rounded bg-white/5" style={{ width: size, height: size }} />;
  }
  return <img src={imgSrc(JOB_ICONS[key])} alt={key.toUpperCase()} width={size} height={size} className="object-contain shrink-0" />;
}

function KpiSegment({ label, value, tone = 'text-gray-100', sub }: { label: string; value: string | number; tone?: string; sub?: string }) {
  return (
    <div className="p-4">
      <p className="text-[11px] text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 font-mono mt-0.5">{sub}</p>}
    </div>
  );
}

export default function EncounterView({ enc: encInput, headerAction, enemyHistory }: { enc: Encounter; headerAction?: ReactNode; enemyHistory?: Map<string, import('@/components/FightsPanel').EnemyHistoryStats> }) {
  const enc = useMemo(() => reconcileSelfName(encInput), [encInput]);
  const party = useMemo(() => {
    const raw = enc.party ?? [];
    const seen = new Set<string>();
    const out: typeof raw = [];
    for (const p of raw) {
      const key = p.id != null
        ? `id:${p.id}`
        : `name:${p.name}|${p.mainJob}${p.mainLevel}/${p.subJob}${p.subLevel}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  }, [enc.party]);
  const partyNames = useMemo(() => new Set(party.map(p => p.name)), [party]);
  const taggedPetNames = useMemo(() => buildPetNameSet(enc.actionLog), [enc.actionLog]);
  const enemies = useMemo(
    () => (Array.isArray(enc.enemies) ? enc.enemies : []).filter(e => !isPetName(e.name, partyNames, taggedPetNames)),
    [enc.enemies, partyNames, taggedPetNames],
  );
  const jobMap = buildJobMap(party);
  const gearIndex = useMemo(() => makeGearIndex(enc.gearLog, enc.gearByPlayer), [enc.gearLog, enc.gearByPlayer]);
  const dur = enc.durationSeconds;
  const metrics = useMemo(() => playerMetricsForEncounter(enc), [enc]);

  const [active, setActive] = useState<Tab>('overview');
  const [focusEnemy, setFocusEnemy] = useState<{ name: string; id?: number; spawnSeq?: number; token: number } | null>(null);
  const jumpToFight = (name: string, id?: number, spawnSeq?: number) => {
    setActive('combat');
    setFocusEnemy({ name, id, spawnSeq, token: (focusEnemy?.token ?? 0) + 1 });
  };
  const activeTabRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [active]);

  const deaths = enc.deathLog?.length ?? 0;
  const hasDisablingBuffs = useMemo(() => {
    if (!Array.isArray(enc.buffLog)) return false;
    const ids = new Set([2, 19, 7, 6, 10, 14, 4, 15, 21, 28, 16]);
    return enc.buffLog.some(b => b.buffId && ids.has(b.buffId) && b.kind === 'gain');
  }, [enc.buffLog]);
  const hasBattleMessages = Array.isArray(enc.battleMsgRaw) && enc.battleMsgRaw.length > 0;
  const idNameMap = useMemo(() => buildIdNameMap({
    playerIds:   enc.playerIds,
    party:       enc.party,
    actionLog:   enc.actionLog,
    killLog:     enc.killLog,
    partyHpLog:  enc.partyHpLog,
    buffLog:     enc.buffLog,
    petLog:      enc.petLog,
  }), [enc.playerIds, enc.party, enc.actionLog, enc.killLog, enc.partyHpLog, enc.buffLog, enc.petLog]);
  const hasJobExtended = Array.isArray(enc.jobExtendedLog) && enc.jobExtendedLog.length > 0;
  const hasEffects = Array.isArray(enc.effectLog) && enc.effectLog.length > 0;
  const hasGear = !!((enc.gearLog && enc.gearLog.length > 0) || (enc.stateSets && Object.keys(enc.stateSets).length > 0) || (enc.gearByPlayer && Object.keys(enc.gearByPlayer).length > 0));
  const hasActions = !!(enc.actionLog && enc.actionLog.length > 0);
  const topDamage = metrics.players[0]?.totalDamage ?? 0;


  const enemyNameSet = useMemo(() => new Set(enemies.map(e => e.name)), [enemies]);
  const combatStats = useMemo(() => {
    if (enc.combatStats && Object.keys(enc.combatStats).length > 0) return enc.combatStats;
    return combatStatsFromActionLog(enc.actionLog, party, enc.skillchainLog, enemyNameSet);
  }, [enc.combatStats, enc.actionLog, party, enc.skillchainLog, enemyNameSet]);
  const hasStats = Object.keys(combatStats).length > 0;
  const hasSelfBuffs = !!enc.gearByPlayer && Object.values(enc.gearByPlayer).some(g => g?.buffLog && g.buffLog.length > 0);
  const hasBuffs = !!(enc.buffLog && enc.buffLog.length > 0) || hasSelfBuffs;
  const hasMap = false;

  const contentDef = useMemo(() => {
    const loot: LootEncounterSummary = {
      path: enc.id ?? '',
      ts: enc.startTime || 0,
      zone: enc.zoneName ?? null,
      zoneId: enc.zoneId ?? null,
      durationSeconds: enc.durationSeconds,
      killLog: enc.killLog ?? [],
      dropLog: enc.dropLog ?? [],
      enemies: Array.isArray(enc.enemies) ? enc.enemies : [],
    };
    return classifyContent({
      kind: 'encounter',
      zoneId: enc.zoneId ?? null,
      zoneName: enc.zoneName ?? null,
      mobNames: mobNamesFromLootSummary(loot),
      itemNames: itemNamesFromLootSummary(loot),
    });
  }, [enc.id, enc.startTime, enc.zoneName, enc.zoneId, enc.durationSeconds, enc.killLog, enc.dropLog, enc.enemies]);
  const contentColor = resolveContentColor(contentDef, enc.source);
  const contentLabel = resolveContentLabel(contentDef, enc.source);

  const displayLang = useDisplayLanguageEager();
  const targetLang = effectiveLanguage(displayLang, enc.language);
  const localizedZoneName = useMemo(
    () => enc.zoneId != null ? translateByIdSync('zones', enc.zoneId, enc.zoneName ?? 'Unknown Zone', targetLang) : (enc.zoneName ?? 'Unknown Zone'),
    [enc.zoneId, enc.zoneName, targetLang]
  );

  const sortedEnemies = useMemo(
    () => enemies.slice().sort((a, b) => b.damageTaken - a.damageTaken),
    [enemies],
  );

  const enemyGroups = useMemo(() => {
    const hp = enc.bossHpLog ?? [];
    const byNameAll = new Map<string, EncounterEnemy[]>();
    for (const e of enemies) { const a = byNameAll.get(e.name) ?? []; a.push(e); byNameAll.set(e.name, a); }
    for (const a of byNameAll.values()) a.sort((x, y) => x.firstSeen - y.firstSeen);
    const killedAt = (e: EncounterEnemy): number | null => {
      if (e.killedAt != null) return e.killedAt;
      let best: number | null = null;
      if (e.id != null) for (const s of hp) if (s.id === e.id && s.hpp <= 0) best = best == null ? s.elapsed : Math.min(best, s.elapsed);
      if (best == null) {
        const group = byNameAll.get(e.name)!;
        const i = group.indexOf(e);
        const start = e.firstSeen;
        const end = group[i + 1]?.firstSeen ?? Infinity;
        for (const s of hp) {
          if (s.id != null) continue;
          if (s.name === e.name && s.hpp <= 0 && s.elapsed >= start && s.elapsed < end) {
            best = best == null ? s.elapsed : Math.min(best, s.elapsed);
          }
        }
      }
      return best;
    };
    const m = new Map<string, { e: EncounterEnemy; ka: number | null }[]>();
    for (const e of sortedEnemies) {
      const arr = m.get(e.name) ?? [];
      arr.push({ e, ka: killedAt(e) });
      m.set(e.name, arr);
    }
    const groups = [...m.entries()].map(([name, items]) => ({
      name,
      items,
      total: items.reduce((s, x) => s + x.e.damageTaken, 0),
      killed: items.filter(x => x.ka != null).length,
    }));
    groups.sort((a, b) => b.total - a.total);
    return groups;
  }, [sortedEnemies, enemies, enc.bossHpLog]);

  const bossReports = useMemo(() => {
    const out: Record<string, BossReport> = {};
    for (const g of enemyGroups) {
      const stats = statsForEnemy(enc.actionLog, g.name, 0, enc.durationSeconds);
      out[g.name] = { damageReport: [], fightStartElapsed: 0, fightDurationSeconds: enc.durationSeconds, ...stats };
    }
    return out;
  }, [enemyGroups, enc.actionLog, enc.durationSeconds]);

  return (
    <EnemyTermContext.Provider value="Enemy">
      <div className="space-y-4">
        <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
          <div className="px-4 pt-3 pb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {contentLabel && (
                  <span className={`text-[10px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded border ${contentColor?.chip ?? 'bg-white/[0.06] text-gray-300 border-white/15'}`}>
                    {contentLabel}
                  </span>
                )}
                <span className="text-[11px] text-gray-400 uppercase tracking-wide leading-none">
                  Encounter
                </span>
              </div>
              <h2 className="text-2xl font-bold text-accent leading-none truncate">{localizedZoneName}</h2>
              {enc.startTime > 0 && (
                <div className="mt-1.5 text-[11px] text-gray-400">
                  <span className="uppercase tracking-wide text-gray-400 mr-1">Date</span>{fmtEncDate(enc.startTime)}
                </div>
              )}
            </div>
            {headerAction && <div className="shrink-0">{headerAction}</div>}
          </div>
          <div className="relative border-t border-white/[0.06]">
            <div className="flex items-center gap-1 px-1.5 pb-1.5 pt-1.5 overflow-x-auto md:overflow-visible scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabBtn id="overview" label="Overview" active={active} setActive={setActive} scrollRef={active === 'overview' ? activeTabRef : undefined} />
              {enemies.length > 0 && <TabBtn id="combat" label="Fights" active={active} setActive={setActive} scrollRef={active === 'combat' ? activeTabRef : undefined} />}
              {hasStats && <TabBtn id="stats" label="Stats" active={active} setActive={setActive} scrollRef={active === 'stats' ? activeTabRef : undefined} />}
              {hasBuffs && <TabBtn id="status" label="Status" active={active} setActive={setActive} scrollRef={active === 'status' ? activeTabRef : undefined} />}
              {(deaths > 0 || hasDisablingBuffs || hasBattleMessages || hasJobExtended || hasEffects) && <TabBtn id="deaths" label={deaths > 0 ? 'Deaths' : 'Status'} active={active} setActive={setActive} scrollRef={active === 'deaths' ? activeTabRef : undefined} />}
              {hasActions && <TabBtn id="actions" label="Actions" active={active} setActive={setActive} scrollRef={active === 'actions' ? activeTabRef : undefined} />}
              {hasMap && <TabBtn id="map" label="Map" active={active} setActive={setActive} scrollRef={active === 'map' ? activeTabRef : undefined} />}
              {hasGear && <TabBtn id="gear" label="Gear" active={active} setActive={setActive} scrollRef={active === 'gear' ? activeTabRef : undefined} />}
            </div>
            {/* Edge fades (mobile only). */}
            <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent md:hidden" />
            <div className="pointer-events-none absolute inset-y-0 left-0 w-4 bg-gradient-to-r from-surface to-transparent md:hidden" />
          </div>
        </div>

        <div key={active} className="ff-tab">
        {active === 'overview' && (
          <div className="space-y-4">
            <div className="bg-surface border border-white/10 rounded-xl grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-white/10 overflow-hidden">
              <KpiSegment label="Duration" value={fmtDur(dur)} />
              <KpiSegment label="Total Damage" value={nf(metrics.totalDamage)} tone="text-amber-400" />
              <KpiSegment label="Party DPS" value={nf(Math.floor(metrics.totalDamage / Math.max(1, dur)))} tone="text-amber-400" />
              <KpiSegment label="Deaths" value={deaths} tone={deaths > 0 ? 'text-rose-400' : 'text-gray-100'} />
            </div>

            {/* Damage by player */}
            <div className="bg-row-even border border-white/10 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Damage by Player</h3>
              {metrics.players.length === 0 ? (
                <p className="text-gray-400 text-sm">No combat damage recorded for this encounter.</p>
              ) : (
                <div className="space-y-1.5">
                  {metrics.players.map(p => {
                    const key = mainJobKey(p.job ?? undefined);
                    const bar = (key && JOB_BAR[key]) || 'bg-accent/30';
                    const w = topDamage > 0 ? (p.totalDamage / topDamage) * 100 : 0;
                    return (
                      <div key={p.player} className="flex items-center gap-2 sm:gap-2.5">
                        <JobIcon job={p.job} size={26} />
                        <span className="w-16 sm:w-32 truncate text-sm text-gray-200 shrink-0">{p.player}</span>
                        <div className="relative flex-1 min-w-0 h-7 rounded-md bg-white/[0.04] overflow-hidden">
                          <div className={`absolute inset-y-0 left-0 ${bar} rounded-md`} style={{ width: `${w}%` }} />
                          {/* DPS headline (bright left) + secondary cluster
                              (dim right). On mobile the pct% drops and the
                              DMG total uses compact notation (1.2M) so the
                              bar's inner text doesn't blow past the edges. */}
                          <div className="absolute inset-0 flex items-center justify-between px-2 sm:px-2.5 text-[11px] sm:text-xs gap-2">
                            <span className="font-mono text-gray-100 truncate">{nf(p.dps)} <span className="text-gray-400">DPS</span></span>
                            <span className="font-mono text-gray-400 truncate hidden sm:inline">{p.damagePct}% · {nf(p.totalDamage)} DMG</span>
                            <span className="font-mono text-gray-400 truncate sm:hidden">{nfC(p.totalDamage)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Party + Enemies */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Party roster (everyone, including 0-damage support) */}
              <div className="bg-row-even border border-white/10 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Party <span className="text-gray-400 font-mono">{party.length}</span>
                </h3>
                {party.length === 0 ? (
                  <p className="text-gray-400 text-sm">No party data captured.</p>
                ) : (
                  <div>
                    {party.map(p => (
                      <div key={p.name} className="flex items-center gap-3 py-2 border-b border-white/[0.06] last:border-0">
                        <JobIcon job={p.mainJob} size={44} />
                        <span className="text-white font-semibold text-base truncate">{p.name}</span>
                        <span className="text-xs text-gray-400 font-mono ml-auto shrink-0">{jobMap[p.name] ?? p.mainJob}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Enemies fought */}
              <div className="bg-row-even border border-white/10 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Enemies <span className="text-gray-400 font-mono">{enemies.length}</span>
                </h3>
                {enemies.length === 0 ? (
                  <p className="text-gray-400 text-sm">No enemies recorded.</p>
                ) : (
                  <div>
                    {enemyGroups.map(g => (
                      <EnemyGroup key={g.name} name={g.name} items={g.items} total={g.total} killed={g.killed} onSelect={jumpToFight} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <GainsPanel
              points={enc.points ?? null}
              durationSeconds={dur}
              localCharacter={enc.localCharacter ?? null}
              progressionLog={enc.progressionLog ?? null}
              progressionStart={enc.progressionStart ?? null}
              progressionEnd={enc.progressionEnd ?? null}
              currencyStart={enc.currencyStart ?? null}
              currencyEnd={enc.currencyEnd ?? null}
              gearByPlayer={enc.gearByPlayer ?? null}
              dropLog={enc.dropLog ?? null}
              keyItemLog={enc.keyItemLog ?? null}
            />
          </div>
        )}

        {active === 'combat' && (
          <FightsPanel
            enemies={enemies}
            actionLog={enc.actionLog}
            killLog={enc.killLog}
            party={party}
            jobMap={jobMap}
            durationSeconds={dur}
            encounterId={enc.id}
            bossHpLog={enc.bossHpLog}
            partyHpLog={enc.partyHpLog}
            partyMpLog={enc.partyMpLog}
            partyTpLog={enc.partyTpLog}
            skillchainLog={enc.skillchainLog}
            buffLog={enc.buffLog}
            gearByPlayer={enc.gearByPlayer ?? null}
            itemUseLog={enc.itemUseLog}
            gearIndex={gearIndex}
            enemyHistory={enemyHistory}
            focusEnemy={focusEnemy}
          />
        )}

        {active === 'stats' && hasStats && (
          <CombatStatsTab combatStats={combatStats} party={party} durationSeconds={enc.durationSeconds} actionLog={enc.actionLog} partyHpLog={enc.partyHpLog} partyMaxHp={enc.partyMaxHp ?? null} contentDef={contentDef} />
        )}

        {active === 'status' && hasBuffs && (
          <BuffsPanel
            buffLog={enc.buffLog ?? []}
            bossSet={enemyNameSet}
            party={party}
            actionLog={enc.actionLog ?? []}
            zoneLog={null}
            durationSeconds={enc.durationSeconds}
            gearByPlayer={enc.gearByPlayer}
          />
        )}

        {active === 'deaths' && (deaths > 0 || (enc.buffLog && enc.buffLog.length > 0) || (enc.battleMsgRaw && enc.battleMsgRaw.length > 0) || (enc.jobExtendedLog && enc.jobExtendedLog.length > 0) || (enc.effectLog && enc.effectLog.length > 0)) && (
          <div className="space-y-6">
            {deaths > 0 && (
              <DeathReport deathLog={enc.deathLog} actionLog={enc.actionLog} partyHpLog={enc.partyHpLog} />
            )}
            <DisablingDebuffsPanel buffLog={enc.buffLog} durationSeconds={enc.durationSeconds} />
            <BattleMessagesPanel raw={enc.battleMsgRaw} nameMap={idNameMap} />
            <JobExtendedPanel entries={enc.jobExtendedLog} />
            <EffectLogPanel entries={enc.effectLog} />
          </div>
        )}

        {active === 'map' && hasMap && (
          <EncounterMapTab
            zoneId={enc.zoneId}
            zoneName={enc.zoneName}
            positionLog={enc.positionLog}
            durationSeconds={enc.durationSeconds}
          />
        )}

        {active === 'gear' && hasGear && (
          <GearSets gearLog={enc.gearLog} stateSets={enc.stateSets} gearByPlayer={enc.gearByPlayer} actionLog={enc.actionLog} partyTpLog={enc.partyTpLog} />
        )}

        {active === 'actions' && hasActions && (
          <ActionTimelineTab
            actionLog={enc.actionLog!}
            bossReports={bossReports}
            aminon={null}
            party={party}
            itemUseLog={enc.itemUseLog}
            buffLog={enc.buffLog}
            skillchainLog={enc.skillchainLog}
            zoneLog={null}
            gearIndex={gearIndex}
            combatStats={combatStats}
            durationSeconds={enc.durationSeconds}
            showStatus={false}
            showSkillchains
            captureLanguage={enc.language ?? null}
          />
        )}
        </div>
      </div>
    </EnemyTermContext.Provider>
  );
}
