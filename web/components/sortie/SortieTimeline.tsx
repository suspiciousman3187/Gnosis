'use client';

import type { RunRecord } from '@/lib/types';
import RunJourney from '@/components/RunJourney';

export default function SortieTimeline({ r, isAdmin = false }: { r: RunRecord; isAdmin?: boolean }) {
  const hasTimeline = Array.isArray(r.zone_log) && r.zone_log.length > 0;
  if (!hasTimeline) {
    return (
      <div className="bg-row-even border border-white/10 rounded-xl p-12 text-center text-gray-400 text-sm">
        No timeline data for this run.
      </div>
    );
  }
  const bossHp: Record<string, { minHpPct?: number }> = {};
  if (r.boss_reports) {
    for (const [name, report] of Object.entries(r.boss_reports)) {
      bossHp[name] = { minHpPct: report.minHpPct };
    }
  }
  if (r.aminon) bossHp['Aminon'] = { minHpPct: r.aminon.minHpPct };
  return (
    <RunJourney
      zoneLog={r.zone_log!}
      areaTimes={r.area_times}
      deathLog={r.death_log ?? null}
      chestLog={r.chest_log ?? null}
      miniNmLog={r.mini_nm_log ?? null}
      dropLog={r.drop_log ?? null}
      finalGalli={r.gallimaufry}
      bossHp={bossHp}
      isAdmin={isAdmin}
    />
  );
}
