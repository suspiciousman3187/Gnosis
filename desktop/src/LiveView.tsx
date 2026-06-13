import { useEffect, useState } from 'react';
import CombatStatsTab from '@/components/CombatStatsTab';
import { useLiveGroups, useBoxes, addCombatSubscriber } from './multibox';
import IdleQuote from './IdleQuote';

export default function LiveView({ dir }: { dir: string }) {
  useEffect(() => addCombatSubscriber(dir), [dir]);

  const groups = useLiveGroups();
  const boxes = useBoxes();
  const [selectedZone, setSelectedZone] = useState<number | null>(null);

  // Active tab = the selected zone (if still live) or the most-active group.
  const active = (selectedZone != null ? groups.find(g => g.key === selectedZone) : undefined) ?? groups[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${groups.length ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`} />
        <h2 className="text-2xl font-bold text-accent">Live Combat</h2>
      </div>

      {groups.length === 0 ? (
        /* Empty state - rotating idle quote with a concise status caption.
           Same component the Home / History idle screens use. The "no
           characters connected" note still surfaces underneath so the user
           can tell the difference between "waiting for combat" and "addon
           not on". */
        <div className="relative h-[60vh] min-h-[320px]">
          <IdleQuote caption="Waiting for combat…" />
          {boxes.length === 0 && (
            <p className="absolute inset-x-0 bottom-4 text-center text-[11px] text-gray-600">
              No characters connected yet.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Master zone tab bar - one tab per simultaneous encounter. */}
          {groups.length > 1 && (
            <div className="flex items-center gap-1 border-b border-white/10 overflow-x-auto">
              {groups.map(g => {
                const on = g.key === active?.key;
                return (
                  <button
                    key={g.key}
                    onClick={() => setSelectedZone(g.key)}
                    className={`shrink-0 flex items-center gap-2 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                      on ? 'border-accent text-accent' : 'border-transparent text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${on ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`} />
                    <span className="font-medium">{g.zoneName}</span>
                    <span className="text-[10px] text-gray-500">{g.boxCount} {g.boxCount === 1 ? 'character' : 'characters'}</span>
                  </button>
                );
              })}
            </div>
          )}

          {active && (
            <div>
              <div className="text-[11px] text-gray-500 mb-2 flex items-center gap-2">
                {groups.length === 1 && <span className="font-medium text-gray-300">{active.zoneName}</span>}
                <span>
                  {active.party.length} {active.party.length === 1 ? 'player' : 'players'} · streaming in real time
                </span>
              </div>
              <CombatStatsTab combatStats={active.combatStats} party={active.party} durationSeconds={active.durationSeconds} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
