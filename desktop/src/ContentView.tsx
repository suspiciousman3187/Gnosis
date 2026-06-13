
import RunTabs from '@/components/RunTabs';
import type { RunRecord } from '@/lib/types';
import type { LoadedContent } from './content';
import { CONTENT_COLOR_PALETTE, contentById } from '@/lib/contentRegistry';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function SortieView({ r, action, enemyHistory }: { r: RunRecord; action?: React.ReactNode; enemyHistory?: Map<string, import('@/components/FightsPanel').EnemyHistoryStats> }) {
  const sortieChip = CONTENT_COLOR_PALETTE[contentById('sortie')?.color ?? 'slate'].chip;
  const header = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-[10px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded border ${sortieChip}`}>Sortie</span>
          <span className="text-[11px] text-gray-400 uppercase tracking-wide leading-none">Encounter</span>
        </div>
        <h2 className="text-2xl font-bold text-accent leading-none truncate">Outer Ra&apos;Kaznar</h2>
        <div className="mt-1.5 text-[11px] text-gray-400">
          <span className="uppercase tracking-wide text-gray-500 mr-1">Date</span>{fmtDate(r.run_date)}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
  return <RunTabs run={r} isAdmin header={header} enemyHistory={enemyHistory} />;
}

export default function ContentView({ content, headerAction, enemyHistory }: { content: LoadedContent; headerAction?: React.ReactNode; enemyHistory?: Map<string, import('@/components/FightsPanel').EnemyHistoryStats> }) {
  if (content.kind === 'sortie') {
    return <SortieView r={content.record} action={headerAction} enemyHistory={enemyHistory} />;
  }
  return null;
}
