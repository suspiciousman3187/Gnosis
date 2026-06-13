'use client';

import type { RunRecord, AreaTimes } from '@/lib/types';
import { SECTORS, CHEST_INFO, CASKET_INFO, COFFER_INFO } from '@/lib/sortieData';
import { BossReportSection } from '@/lib/reportShared';
import type { GearIndex } from '@/lib/gearLookup';
import {
  SectorSummaryPanel,
  ChestBadge,
  SectorMobTable,
  NaakualSectorCard,
  buildSectorMobKills,
  filterItemUseToSector,
} from './SortieHelpers';

export type GroundSectorId = 'A' | 'B' | 'C' | 'D';
export type BasementSectorId = 'E' | 'F' | 'G' | 'H';

export default function SortieSectors({
  r, floor, activeId, setActiveId, jobMap, gearIndex,
}: {
  r: RunRecord;
  floor: 'ground' | 'basement';
  activeId: string;
  setActiveId: (id: string) => void;
  jobMap: Record<string, string>;
  gearIndex: GearIndex;
}) {
  const isGround = floor === 'ground';
  const ids = isGround ? ['A','B','C','D'] : ['E','F','G','H'];
  const setId = setActiveId;

  return (
    <div className="bg-row-even border border-white/10 rounded-xl overflow-hidden">
      <div className="flex border-b border-white/10">
        {ids.map((id) => {
          const sector = SECTORS.find(s => s.id === id);
          const opened = !!r.boss_reports?.[sector!.boss];
          const on = id === activeId;
          return (
            <button
              key={id}
              onClick={() => setId(id)}
              data-tooltip={`${sector?.theme} - ${sector?.boss}`}
              className={`relative flex-1 min-w-0 flex items-center justify-center px-3 py-2.5 text-sm font-medium transition-colors ${
                on ? 'text-accent' : opened ? 'text-gray-300 hover:text-white' : 'text-gray-400 hover:text-gray-400'
              }`}
            >
              <span className="truncate">Sector {id}</span>
              {on && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>

      {SECTORS.filter(s => s.id === activeId).map((sector) => {
        const bossReport = r.boss_reports?.[sector.boss];
        const at = r.area_times;
        const sectorSeconds = at
          ? (sector.floor === 'Basement'
              ? (at[`sector${sector.id}` as keyof AreaTimes] ?? 0) + (at[`boss${sector.id}` as keyof AreaTimes] ?? 0)
              : (at[`boss${sector.id}` as keyof AreaTimes] ?? 0))
          : 0;
        return (
          <div key={sector.id} className="p-5 space-y-4">
            <div className="flex items-center gap-3 border-b border-white/10 pb-3 -mx-1">
              <h3 className="text-base font-bold text-white">Sector {sector.id}</h3>
              <span className="text-gray-400 text-sm">{sector.theme}</span>
              <span className="text-xs text-gray-400/70 bg-white/[0.03] border border-white/10 px-2 py-0.5 rounded-md">{sector.floor}</span>
              {bossReport && bossReport.killed === false && (
                <span className="text-xs text-red-400 font-semibold border border-red-700/40 rounded px-2 py-0.5 bg-red-950/40">Wipe</span>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <SectorSummaryPanel sector={sector} run={r} sectorSeconds={sectorSeconds} />

              <div className="border border-white/10 rounded-xl p-4 flex flex-col">
                <h4 className="font-semibold text-xs text-gray-400 uppercase tracking-wide mb-2">Treasure Chests</h4>
                {!r.treasure_chests && (
                  <p className="text-xs text-gray-400 italic mb-2">No chest data recorded for this run.</p>
                )}
                <div className="flex-1 flex flex-col justify-around gap-3">
                  <div className="flex items-center gap-3 border-b border-white/[0.06] pb-3">
                    <span className="text-xs text-gray-400 uppercase tracking-wide w-16 shrink-0">Chests</span>
                    <div className="flex flex-wrap gap-1.5">
                      {sector.chests.map((name) => (
                        <ChestBadge key={name} name={name}
                          opened={r.treasure_chests?.chests.includes(name) ?? false}
                          color="red" objective={CHEST_INFO[name]?.objective} reward={CHEST_INFO[name]?.reward}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 border-b border-white/[0.06] pb-3">
                    <span className="text-xs text-gray-400 uppercase tracking-wide w-16 shrink-0">Caskets</span>
                    <div className="flex flex-wrap gap-1.5">
                      {sector.caskets.map((name) => (
                        <ChestBadge key={name} name={name}
                          opened={r.treasure_chests?.caskets.includes(name) ?? false}
                          color="blue" objective={CASKET_INFO[name]?.objective}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 uppercase tracking-wide w-16 shrink-0">Coffer</span>
                    <div className="flex flex-wrap gap-1.5">
                      <ChestBadge name={sector.coffer}
                        opened={r.treasure_chests?.coffers.includes(sector.coffer) ?? false}
                        color="purple" objective={COFFER_INFO[sector.coffer]?.objective}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {bossReport && (
              <BossReportSection
                name={sector.boss}
                report={bossReport}
                jobMap={jobMap}
                embedded
                itemUseLog={filterItemUseToSector(sector, r.item_use_log ?? null)}
                actionLog={r.action_log}
                party={r.party ?? []}
                bossReports={r.boss_reports}
                aminon={r.aminon}
                bossHpLog={r.boss_hp_log ?? null}
                partyHpLog={r.party_hp_log ?? null}
                partyMpLog={r.party_mp_log ?? null}
                partyTpLog={r.party_tp_log ?? null}
                skillchainLog={r.skillchain_log ?? null}
                buffLog={r.buff_log ?? null}
                gearByPlayer={r.gearByPlayer ?? null}
                gearIndex={gearIndex}
              />
            )}

            {((r.action_log && r.action_log.length > 0) || (r.kill_log && r.kill_log.length > 0)) && (
              <SectorMobTable
                rows={buildSectorMobKills(r.action_log ?? [], r.kill_log ?? null, sector.theme)}
                hasKillLog={!!(r.kill_log && r.kill_log.length > 0)}
              />
            )}

            {!isGround && r.naakual_kills?.[sector.id as BasementSectorId] && (
              <NaakualSectorCard data={r.naakual_kills[sector.id as BasementSectorId]!} actionLog={r.action_log ?? []} killLog={r.kill_log ?? null} />
            )}
          </div>
        );
      })}
    </div>
  );
}
