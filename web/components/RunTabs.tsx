'use client';

import { useState, useEffect, useMemo, type ReactNode } from 'react';
import GearSets from '@/components/GearSets';
import DeathReport from '@/components/DeathReport';
import FightsPanel from '@/components/FightsPanel';
import type { EncounterEnemy } from '@/lib/encounter';
import { deriveEnemiesFromActionLog } from '@/lib/sortieEnemies';
import { makeGearIndex } from '@/lib/gearLookup';
import type { RunRecord, PartyMember, ActionLogEntry } from '@/lib/types';
import { SORTIE_DURATION } from './sortie/SortieHelpers';
import CombatStatsTab from '@/components/CombatStatsTab';
import { contentById } from '@/lib/contentRegistry';
import { combatStatsFromActionLog } from '@/lib/combatStats';
import { recordToEncounter } from '@/lib/recordToEncounter';
import ActionTimelineTab, { BuffsPanel } from '@/components/ActionTimelineTab';
import JourneyTab from '@/components/JourneyTab';
import DisablingDebuffsPanel from '@/components/DisablingDebuffsPanel';
import BattleMessagesPanel from '@/components/BattleMessagesPanel';
import JobExtendedPanel from '@/components/JobExtendedPanel';
import EffectLogPanel from '@/components/EffectLogPanel';
import { buildIdNameMap } from '@/lib/idNameResolver';

import { JOB_ICONS, mainJobKey } from '@/components/JobIcon';
export { JOB_ICONS, mainJobKey };

import SortieOverview from './sortie/SortieOverview';
import SortieTimeline from './sortie/SortieTimeline';
import SortieSectors from './sortie/SortieSectors';
import SortieAminon from './sortie/SortieAminon';

export function buildJobMap(party: PartyMember[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of party) {
    // Trusts carry a uniform 'TRUST' tag - show it plainly, no level/subjob.
    if (p.mainJob === 'TRUST') { map[p.name] = 'TRUST'; continue; }
    // Drop the subjob suffix when there isn't a meaningful one (Trusts have
    // sub='', '?', or '0'); otherwise display as "MAINxx/SUByy" Sortie-style.
    const hasSub = p.subJob && p.subJob !== '' && p.subJob !== '0' && p.subJob !== '?';
    map[p.name] = hasSub
      ? `${p.mainJob}${p.mainLevel}/${p.subJob}${p.subLevel}`
      : `${p.mainJob}${p.mainLevel || ''}`;
  }
  return map;
}

type Tab = 'overview' | 'timeline' | 'ground' | 'basement' | 'aminon' | 'combat' | 'fights' | 'actions' | 'status' | 'map' | 'gear' | 'deaths';

function TabBtn({ id, label, active, setActive }: { id: Tab; label: string; active: Tab; setActive: (t: Tab) => void }) {
  return (
    <button
      onClick={() => setActive(id)}
      className={`flex-1 px-4 py-1.5 text-sm font-medium text-center rounded-lg transition-colors ${
        active === id
          ? 'bg-surface-raised text-accent border border-accent/40 shadow-sm'
          : 'text-gray-300 border border-transparent hover:text-white hover:bg-white/[0.06]'
      }`}
    >
      {label}
    </button>
  );
}

function SortieTabBtn({ id, label, active, setActive }: { id: Tab; label: string; active: Tab; setActive: (t: Tab) => void }) {
  return (
    <button
      onClick={() => setActive(id)}
      className={`flex-1 px-4 py-1.5 text-sm font-medium text-center rounded-md transition-colors border ${
        active === id
          ? 'bg-violet-500/30 text-violet-100 border-violet-400/60 shadow-sm'
          : 'text-gray-300 border-transparent hover:bg-violet-500/15 hover:text-violet-100'
      }`}
    >
      {label}
    </button>
  );
}

export default function RunTabs({ run: r, isAdmin = false, header, preTabContent, enemyHistory }: {
  run: RunRecord;
  isAdmin?: boolean;
  header?: ReactNode;
  preTabContent?: ReactNode;
  enemyHistory?: Map<string, import('@/components/FightsPanel').EnemyHistoryStats>;
}) {
  // Prefer Parse's combat_stats when present; otherwise synthesize the same
  // scorecard from the action log so Sortie's Combat tab works without Parse.
  const derivedCombatStats = useMemo(
    () => (r.combat_stats && Object.keys(r.combat_stats).length > 0)
      ? r.combat_stats
      : combatStatsFromActionLog(r.action_log ?? null, r.party ?? [], r.skillchain_log ?? null, Object.keys(r.boss_reports ?? {})),
    [r.combat_stats, r.action_log, r.party, r.skillchain_log, r.boss_reports],
  );
  const hasCombat = Object.keys(derivedCombatStats).length > 0;
  const hasActionLog = Array.isArray(r.action_log) && r.action_log.length > 0;
  const hasJourney = Array.isArray(r.position_log) && r.position_log.length > 0;
  const hasGear = !!((r.gearLog && r.gearLog.length > 0) || (r.stateSets && Object.keys(r.stateSets).length > 0) || (r.gearByPlayer && Object.keys(r.gearByPlayer).length > 0));
  // Self-buff uptime per character - was previously rendered next to Gear,
  // moved into the new Status tab to match generic encounter chrome.
  const hasSelfBuffs = !!r.gearByPlayer && Object.values(r.gearByPlayer).some(g => g?.buffLog && g.buffLog.length > 0);
  const hasPartyBuffs = Array.isArray(r.buff_log) && r.buff_log.length > 0;
  const hasBattleMessages = Array.isArray(r.battle_msg_raw) && r.battle_msg_raw.length > 0;
  const hasJobExtended = Array.isArray(r.job_extended_log) && r.job_extended_log.length > 0;
  const hasEffects = Array.isArray(r.effect_log) && r.effect_log.length > 0;
  const hasStatus = hasPartyBuffs || hasSelfBuffs || hasBattleMessages || hasJobExtended || hasEffects;
  const gearIndex = useMemo(() => makeGearIndex(r.gearLog, r.gearByPlayer), [r.gearLog, r.gearByPlayer]);

  const hasDeaths = Array.isArray(r.death_log) && r.death_log.length > 0;

  const sortieEnemies = useMemo<EncounterEnemy[]>(
    () => deriveEnemiesFromActionLog(r.action_log ?? null, r.kill_log ?? null, r.party ?? null, r.battle_msg_raw ?? null),
    [r.action_log, r.kill_log, r.party, r.battle_msg_raw],
  );
  const hasFights = sortieEnemies.length > 0;

  const availableTabs = new Set<Tab>([
    'overview', 'ground', 'basement', 'aminon', 'timeline',
    ...(hasFights ? ['fights'] as Tab[] : []),
    ...(hasCombat ? ['combat'] as Tab[] : []),
    ...(hasActionLog ? ['actions'] as Tab[] : []),
    ...(hasStatus ? ['status'] as Tab[] : []),
    ...(hasJourney ? ['map'] as Tab[] : []),
    ...(hasGear ? ['gear'] as Tab[] : []),
    ...(hasDeaths ? ['deaths'] as Tab[] : []),
  ]);
  const [active, setActive] = useState<Tab>('overview');
  useEffect(() => {
    const raw = (new URLSearchParams(window.location.search).get('section') || '').toLowerCase();
    // Back-compat: the Map tab used to be ?section=journey.
    const sec = (raw === 'journey' ? 'map' : raw) as Tab;
    if (availableTabs.has(sec)) setActive(sec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch tab + reflect it in the URL (?section=) without a full navigation,
  // so the page state is preserved and the link is shareable.
  const selectTab = (t: Tab) => {
    setActive(t);
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (t === 'overview') params.delete('section');
    else params.set('section', t);
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  };

  const [groundSector, setGroundSector] = useState<'A'|'B'|'C'|'D'>('A');
  const [basementSector, setBasementSector] = useState<'E'|'F'|'G'|'H'>('E');
  const [focusEnemy, setFocusEnemy] = useState<{ name: string; id?: number; spawnSeq?: number; token: number } | null>(null);
  const enemyByName = useMemo(() => {
    const m = new Map<string, { id?: number; spawnSeq?: number }>();
    for (const e of sortieEnemies) {
      if (m.has(e.name)) continue;
      m.set(e.name, { id: e.id, spawnSeq: e.spawnSeq });
    }
    return m;
  }, [sortieEnemies]);
  const jumpToFight = (name: string) => {
    const hit = enemyByName.get(name);
    selectTab('fights');
    setFocusEnemy({ name, id: hit?.id, spawnSeq: hit?.spawnSeq, token: (focusEnemy?.token ?? 0) + 1 });
  };

  const runDurationSeconds = useMemo(() => {
    const at = r.area_times;
    if (!at) return SORTIE_DURATION;
    const s = (at.groundFloor ?? 0) + (at.sectorE ?? 0) + (at.sectorF ?? 0) + (at.sectorG ?? 0) + (at.sectorH ?? 0)
            + (at.bossA ?? 0) + (at.bossB ?? 0) + (at.bossC ?? 0) + (at.bossD ?? 0)
            + (at.bossE ?? 0) + (at.bossF ?? 0) + (at.bossG ?? 0) + (at.bossH ?? 0)
            + (at.aminon ?? 0);
    return s > 0 ? s : SORTIE_DURATION;
  }, [r.area_times]);

  const jobMap = buildJobMap(r.party ?? []);
  const enc = useMemo(
    () => recordToEncounter(r, { enemies: sortieEnemies, durationSeconds: runDurationSeconds, zoneName: 'Outer Ra\'Kaznar' }),
    [r, sortieEnemies, runDurationSeconds],
  );
  const idNameMap = useMemo(() => buildIdNameMap({
    playerIds:   enc.playerIds,
    party:       enc.party,
    actionLog:   enc.actionLog,
    killLog:     enc.killLog,
    partyHpLog:  enc.partyHpLog,
    buffLog:     enc.buffLog,
    petLog:      enc.petLog,
  }), [enc.playerIds, enc.party, enc.actionLog, enc.killLog, enc.partyHpLog, enc.buffLog, enc.petLog]);
  return (
    <div className="space-y-6">
      {/* Header + tabs unified panel - mirrors EncounterView's chrome so
          generic encounters and Sortie runs share the same visual anchor.
          Caller-supplied `header` (label / title / Share button) is rendered
          inside the same rounded panel as the tab bar, with a hairline
          divider between. Without a header the panel collapses to just the
          tab bar (legacy callers / web routes that supply their own header
          elsewhere). */}
      <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
        {header && (
          <div className="px-4 pt-3 pb-3 border-b border-white/[0.06]">
            {header}
          </div>
        )}
        <div className="p-1.5 flex items-center gap-1 flex-wrap">
          <TabBtn id="overview"  label="Overview"  active={active} setActive={selectTab} />
          {hasFights && <TabBtn id="fights" label="Fights" active={active} setActive={selectTab} />}
          {hasCombat && <TabBtn id="combat" label="Stats" active={active} setActive={selectTab} />}
          {hasStatus && <TabBtn id="status" label="Status" active={active} setActive={selectTab} />}
          {hasDeaths && <TabBtn id="deaths" label="Deaths" active={active} setActive={selectTab} />}
          {hasActionLog && <TabBtn id="actions" label="Actions" active={active} setActive={selectTab} />}
          {hasJourney && <TabBtn id="map" label="Map" active={active} setActive={selectTab} />}
          {hasGear && <TabBtn id="gear" label="Gear" active={active} setActive={selectTab} />}
        </div>
        <div className="border-y border-violet-500/50 bg-violet-950/30">
          <div className="bg-gradient-to-r from-violet-500/30 via-violet-500/20 to-violet-500/30 border-b border-violet-500/40 px-3 py-1 flex items-center justify-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-violet-100 select-none">Sortie</span>
          </div>
          <div className="px-1.5 pb-1.5 pt-1.5 flex items-center gap-1 flex-wrap">
            <SortieTabBtn id="timeline" label="Timeline" active={active} setActive={selectTab} />
            <SortieTabBtn id="ground"   label="Ground"   active={active} setActive={selectTab} />
            <SortieTabBtn id="basement" label="Basement" active={active} setActive={selectTab} />
            <SortieTabBtn id="aminon"   label="Aminon"   active={active} setActive={selectTab} />
          </div>
        </div>
      </div>

      {/* Run-level summary slot - Sortie passes Gallimaufry / Bosses /
          Party KPIs here so they persist across tab switches (same
          long-standing UX). Generic encounters fold their KPIs into
          the overview tab instead and leave this slot empty. */}
      {preTabContent}

      <div key={active} className="ff-tab">
      {active === 'overview' && (
        <SortieOverview
          r={r}
          runDurationSeconds={runDurationSeconds}
          onJumpToFight={hasFights ? jumpToFight : undefined}
          fightableNames={hasFights ? new Set(enemyByName.keys()) : undefined}
        />
      )}


      {active === 'deaths' && (
        <div className="space-y-4">
          <DeathReport deathLog={enc.deathLog} actionLog={enc.actionLog} partyHpLog={enc.partyHpLog} />
          <DisablingDebuffsPanel buffLog={enc.buffLog} durationSeconds={enc.durationSeconds} />
        </div>
      )}

      {active === 'aminon' && <SortieAminon r={r} jobMap={jobMap} gearIndex={gearIndex} />}

      {active === 'timeline' && <SortieTimeline r={r} isAdmin={isAdmin} />}

      {/* Actions tab */}
      {active === 'actions' && hasActionLog && (
        <ActionTimelineTab
          actionLog={enc.actionLog!}
          bossReports={r.boss_reports}
          aminon={r.aminon}
          party={enc.party}
          itemUseLog={enc.itemUseLog}
          buffLog={enc.buffLog}
          skillchainLog={enc.skillchainLog}
          zoneLog={r.zone_log ?? null}
          gearIndex={gearIndex}
          combatStats={derivedCombatStats}
          durationSeconds={enc.durationSeconds}
          showSkillchains
          showStatus={false}
          countdown
          captureLanguage={enc.language ?? null}
        />
      )}

      {/* Status tab - party-wide buff/debuff uptime above, per-character
          self-buffs below. Mirrors EncounterView's Status tab exactly. The
          self-buffs (SelfBuffsByCharacter) used to live next to Gear, but
          they never read as a gear concept and crowded that tab. Promoting
          Status to a top-level tab also moves it out from under the
          Actions subtab (showStatus={false} on ActionTimelineTab above)
          so the user discovers it without having to drill into Actions. */}
      {active === 'status' && hasStatus && (() => {
        const partyNames = new Set(enc.party.map(p => p.name));
        const bossSet = new Set<string>([
          ...Object.keys(r.boss_reports ?? {}),
          ...(r.aminon ? ['Aminon'] : []),
        ]);
        for (const n of partyNames) bossSet.delete(n);
        return (
          <div className="space-y-6">
            {(hasPartyBuffs || hasSelfBuffs) && (
              <BuffsPanel
                buffLog={enc.buffLog ?? []}
                bossSet={bossSet}
                party={enc.party}
                actionLog={enc.actionLog ?? []}
                zoneLog={r.zone_log ?? null}
                countdown
                durationSeconds={enc.durationSeconds}
                gearByPlayer={enc.gearByPlayer}
              />
            )}
            <BattleMessagesPanel raw={enc.battleMsgRaw} nameMap={idNameMap} />
            <JobExtendedPanel entries={enc.jobExtendedLog} />
            <EffectLogPanel entries={enc.effectLog} />
          </div>
        );
      })()}

      {/* Journey tab - renders the player's traversal as a colored trail on the Sortie map */}
      {active === 'map' && hasJourney && (
        <JourneyTab
          positionLog={r.position_log}
          killLog={r.kill_log}
          chestLog={r.chest_log}
          deathLog={r.death_log}
          bossReports={r.boss_reports}
        />
      )}

      {/* Gear tab - captured precast/midcast + state sets. Self-buff
          uptime (SelfBuffsByCharacter) used to render here as a sibling
          panel; it's now in the new Status tab next to BuffsPanel, where
          it reads as the "buff" concept it is. */}
      {active === 'gear' && hasGear && (
        <div className="space-y-4">
          <GearSets gearLog={enc.gearLog} stateSets={enc.stateSets} gearByPlayer={enc.gearByPlayer} actionLog={enc.actionLog} partyTpLog={enc.partyTpLog} countdown />
        </div>
      )}

      {/* Combat tab - no outer wrapper; CombatStatsTab provides its own
          panel chrome so the visual weight matches every other tab. Outer
          bg-row-even + inner bg-panel previously double-stacked translucent
          layers, which read as opaque on the Gnosis backdrop. */}
      {active === 'fights' && hasFights && (
        <FightsPanel
          enemies={enc.enemies}
          actionLog={enc.actionLog}
          killLog={enc.killLog}
          party={enc.party}
          jobMap={jobMap}
          durationSeconds={enc.durationSeconds}
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

      {active === 'combat' && hasCombat && (
        <div className="space-y-4">
          <CombatStatsTab
            combatStats={derivedCombatStats}
            party={enc.party}
            durationSeconds={enc.durationSeconds}
            actionLog={enc.actionLog}
            partyHpLog={enc.partyHpLog}
            partyMaxHp={enc.partyMaxHp ?? null}
            contentDef={contentById('sortie')}
          />
        </div>
      )}

      {(active === 'ground' || active === 'basement') && (
        <SortieSectors
          r={r}
          floor={active === 'ground' ? 'ground' : 'basement'}
          activeId={active === 'ground' ? groundSector : basementSector}
          setActiveId={(id) => active === 'ground' ? setGroundSector(id as 'A'|'B'|'C'|'D') : setBasementSector(id as 'E'|'F'|'G'|'H')}
          jobMap={jobMap}
          gearIndex={gearIndex}
        />
      )}
      </div>
    </div>
  );
}
