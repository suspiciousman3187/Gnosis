'use client';

import type { RunRecord, SortieDrops } from '@/lib/types';
import { imgSrc, type ImageImport } from '@/lib/img';
import { JOB_ICONS } from '@/components/JobIcon';
import { SECTORS } from '@/lib/sortieData';
import GainsPanel from '@/components/GainsPanel';
import { StatusIcon, findKillElapsed, TimeBreakdown, SpawnedChests } from './SortieHelpers';

function humanDur(s: number): string {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

import sapphireIcon     from "@/assets/items/Ra'Kaz._Sapphire_icon.png";
import starstoneIcon    from "@/assets/items/Ra'Kaz._Starstone_icon.png";
import eikondriteIcon   from '@/assets/items/Eikondrite_icon.png';
import hexahedriteIcon  from '@/assets/items/Hexahedrite_icon.png';
import mesosideriteIcon from '@/assets/items/Mesosiderite_icon.png';
import octahedriteIcon  from '@/assets/items/Octahedrite_icon.png';
import oldCaseIcon      from '@/assets/items/Old_Case_icon.png';
import oldCasePlus1Icon from "@/assets/items/Old_Case_+1_icon.png";

const ITEM_ICONS: Record<string, ImageImport> = {
  sapphire:    sapphireIcon,
  starstone:   starstoneIcon,
  eikondrite:  eikondriteIcon,
  hexahedrite: hexahedriteIcon,
  mesosiderite: mesosideriteIcon,
  octahedrite: octahedriteIcon,
  oldCase:      oldCaseIcon,
  oldCasePlus1: oldCasePlus1Icon,
};

const BOSS_GROUPS: { label: string; bosses: string[] }[] = [
  { label: 'Ground Floor', bosses: ['Ghatjot', 'Leshonn', 'Skomora', 'Degei'] },
  { label: 'Basement',     bosses: ['Dhartok', 'Gartell', 'Triboulex', 'Aita'] },
  { label: 'Aminon',       bosses: ['Aminon'] },
];

export default function SortieOverview({ r, runDurationSeconds, onJumpToFight, fightableNames }: {
  r: RunRecord;
  runDurationSeconds: number;
  onJumpToFight?: (name: string) => void;
  fightableNames?: Set<string>;
}) {
  const partyDeduped = (() => {
    const seen = new Set<string>();
    const out: typeof r.party = [];
    for (const p of r.party ?? []) {
      const key = p.id != null
        ? `id:${p.id}`
        : `name:${p.name}|${p.mainJob}${p.mainLevel}/${p.subJob}${p.subLevel}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  })();
  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-6">
        {partyDeduped.length > 0 ? (
          <section className="bg-row-even border border-white/10 rounded-xl p-5">
            <h2 className="font-semibold text-sm text-gray-400 uppercase tracking-wide mb-3">Party Composition</h2>
            <table className="w-full">
              <tbody>
                {partyDeduped.map((p) => {
                  const jobKey = p.mainJob.toLowerCase();
                  return (
                    <tr key={p.name} className="border-b border-white/[0.06] last:border-0">
                      <td className="py-2 pr-3 w-16">
                        {JOB_ICONS[jobKey] && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imgSrc(JOB_ICONS[jobKey])} width={56} height={56} alt={p.mainJob} className="object-contain" />
                        )}
                      </td>
                      <td className="py-2 text-white font-semibold text-base">{p.name}</td>
                      <td className="py-2 text-right text-gray-400 text-sm font-mono">
                        {p.mainJob === 'TRUST' ? 'TRUST' : `${p.mainJob}${p.mainLevel}/${p.subJob}${p.subLevel}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ) : <div />}

        {(() => {
          const maxZoneGalli = Array.isArray(r.zone_log) ? Math.max(0, ...r.zone_log.map((z) => z.galli ?? 0)) : 0;
          const displayGalli = r.gallimaufry && r.gallimaufry > 0 && r.gallimaufry < 200000 ? r.gallimaufry : maxZoneGalli;
          const DROP_LABELS: { key: keyof SortieDrops; label: string }[] = [
            { key: 'oldCasePlus1', label: 'Old Case +1' },
            { key: 'oldCase',      label: 'Old Case' },
            { key: 'sapphire',     label: "Ra'Kaznar Sapphire" },
            { key: 'starstone',    label: "Ra'Kaznar Starstone" },
            { key: 'eikondrite',   label: 'Eikondrite' },
            { key: 'octahedrite',  label: 'Octahedrite' },
            { key: 'hexahedrite',  label: 'Hexahedrite' },
            { key: 'mesosiderite', label: 'Mesosiderite' },
          ];
          const found = r.drops ? DROP_LABELS.filter(({ key }) => (r.drops![key] ?? 0) > 0) : [];
          if (displayGalli <= 0 && found.length === 0) return <div />;
          return (
            <section className="bg-row-even border border-white/10 rounded-xl p-5">
              <h2 className="font-semibold text-sm text-gray-400 uppercase tracking-wide mb-3">Currency and Loot</h2>
              {displayGalli > 0 && (
                <div className={found.length > 0 ? 'mb-4 pb-4 border-b border-white/[0.06]' : ''}>
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Total Gallimaufry</div>
                  <div className="font-bold text-2xl text-amber-400 font-mono leading-none">
                    {displayGalli.toLocaleString()}
                  </div>
                </div>
              )}
              {found.length > 0 && (
                <table className="w-full">
                  <tbody>
                    {found.map(({ key, label }) => (
                      <tr key={key} className="border-b border-white/[0.06] last:border-0">
                        <td className="py-2 pr-3 w-12">
                          {ITEM_ICONS[key] && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={imgSrc(ITEM_ICONS[key])} width={36} height={36} alt={label} className="object-contain" />
                          )}
                        </td>
                        <td className="py-2 text-gray-100 text-sm">{label}</td>
                        <td className="py-2 text-right text-amber-400 font-bold font-mono text-lg">{r.drops![key]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          );
        })()}
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        <section className="bg-row-even border border-white/10 rounded-xl p-5 flex flex-col">
          <h2 className="font-semibold text-sm text-gray-400 uppercase tracking-wide mb-3">Bosses</h2>
          <div className="flex-1 flex flex-col justify-between gap-3">
            {BOSS_GROUPS.map((group) => {
              const killed = group.bosses.filter(b => r.defeated_bosses.includes(b)).length;
              return (
                <div key={group.label}>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{group.label}</span>
                    <span className="text-[10px] font-mono text-gray-400">{killed}/{group.bosses.length}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    {group.bosses.map((boss) => {
                      const defeated = r.defeated_bosses.includes(boss);
                      const fightSecs = defeated
                        ? (boss === 'Aminon'
                            ? (r.aminon?.fightDurationSeconds ?? null)
                            : (r.boss_reports?.[boss]?.fightDurationSeconds ?? null))
                        : null;
                      const canJump = !!(onJumpToFight && defeated && fightableNames?.has(boss));
                      return (
                        <div
                          key={boss}
                          onClick={canJump ? () => onJumpToFight!(boss) : undefined}
                          className={`flex items-center gap-2 text-sm rounded px-1 -mx-1 ${
                            canJump ? 'cursor-pointer hover:bg-accent/[0.08] hover:text-accent transition-colors' : ''
                          }`}
                        >
                          <StatusIcon done={defeated} />
                          <span className={defeated ? 'text-white' : 'text-gray-400'}>{boss}</span>
                          {fightSecs != null && fightSecs > 0 && (
                            <span className="ml-auto text-[10px] font-mono text-amber-400 shrink-0">{humanDur(fightSecs)}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-row-even border border-white/10 rounded-xl p-5 flex flex-col">
          <h2 className="font-semibold text-sm text-gray-400 uppercase tracking-wide mb-3">Bonus Objectives</h2>
          {(() => {
            const nmKilled = (name: string) =>
              findKillElapsed(name, r.kill_log ?? null, r.mini_nm_log ?? null) != null;
            const groups: { label: string; nms: string[] }[] = [
              { label: 'Ground Floor', nms: SECTORS.filter(s => s.floor === 'Ground').map(s => s.nm) },
              { label: 'Basement',     nms: SECTORS.filter(s => s.floor === 'Basement').map(s => s.nm) },
            ];
            const naakualSectors = (['E', 'F', 'G', 'H'] as const).map(s => ({
              label: `Sector ${s}`,
              got: r.naakual_kills?.[s]?.completed === true,
            }));
            const naakualCount = naakualSectors.filter(n => n.got).length;
            return (
              <div className="flex-1 flex flex-col justify-between gap-3">
                {groups.map((group) => {
                  const killed = group.nms.filter(nmKilled).length;
                  return (
                    <div key={group.label}>
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{group.label}</span>
                        <span className="text-[10px] font-mono text-gray-400">{killed}/{group.nms.length}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                        {group.nms.map((nm) => {
                          const done = nmKilled(nm);
                          return (
                            <div key={nm} className="flex items-center gap-2 text-sm">
                              <StatusIcon done={done} />
                              <span className={done ? 'text-white' : 'text-gray-400'}>{nm}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                <div>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Naakuals</span>
                    <span className="text-[10px] font-mono text-gray-400">{naakualCount}/4</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    {naakualSectors.map(({ label, got }) => (
                      <div key={label} className="flex items-center gap-2 text-sm">
                        <StatusIcon done={got} />
                        <span className={got ? 'text-white' : 'text-gray-400'}>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
        </section>
      </div>

      {(r.area_times || r.chest_log) && (
        <div className="grid sm:grid-cols-2 gap-6">
          {r.area_times ? <TimeBreakdown areaTimes={r.area_times} /> : <div />}
          {r.chest_log && r.chest_log.length > 0 ? <SpawnedChests chestLog={r.chest_log} /> : <div />}
        </div>
      )}

      {r.notes && r.notes !== 'Nothing to add' && (
        <section className="bg-row-even border border-white/10 rounded-xl p-5">
          <h2 className="font-semibold text-sm text-gray-400 uppercase tracking-wide mb-2">Notes</h2>
          <p className="text-sm text-gray-100 whitespace-pre-wrap">{r.notes}</p>
        </section>
      )}

      <GainsPanel
        points={r.points ?? null}
        durationSeconds={runDurationSeconds}
        localCharacter={r.localCharacter ?? null}
        progressionLog={r.progressionLog ?? null}
        progressionStart={r.progressionStart ?? null}
        progressionEnd={r.progressionEnd ?? null}
        currencyStart={r.currencyStart ?? null}
        currencyEnd={r.currencyEnd ?? null}
        gearByPlayer={r.gearByPlayer ?? null}
        dropLog={r.drop_log ?? null}
      />
    </div>
  );
}
