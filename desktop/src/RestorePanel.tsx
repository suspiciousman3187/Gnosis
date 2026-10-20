import { useEffect, useMemo, useState } from 'react';
import { scanArchives, restoreArchive, peekArchiveZone, type ArchiveEntry, type RestoreResult } from './restoreArchive';

type TypeFilter = 'all' | 'deleted' | 'merged' | 'split';

type Status = { kind: 'idle' } | { kind: 'restoring' } | { kind: 'done'; result: RestoreResult } | { kind: 'error'; message: string };

function basename(p: string): string { return p.replace(/^.*[\\/]/, ''); }

function fmtTime(unixSeconds: number): string {
  if (!unixSeconds) return '?';
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function summarizeChars(archive: ArchiveEntry): string {
  const chars = new Set<string>();
  for (const m of archive.members) if (m.char) chars.add(m.char);
  if (chars.size === 0) return '?';
  const list = [...chars];
  if (list.length > 4) return `${list.slice(0, 4).join(', ')} +${list.length - 4}`;
  return list.join(', ');
}

export default function RestorePanel({
  dataDir,
  onRestored,
}: {
  dataDir: string;
  onRestored: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [statusByDir, setStatusByDir] = useState<Record<string, Status>>({});
  const [zoneByDir, setZoneByDir] = useState<Record<string, string>>({});
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const list = await scanArchives(dataDir);
        if (alive) { setArchives(list); setLoading(false); }
      } catch (e) {
        if (alive) { setArchives([]); setLoading(false); console.error('scanArchives failed', e); }
      }
    })();
    return () => { alive = false; };
  }, [dataDir]);

  useEffect(() => {
    if (archives.length === 0) return;
    let alive = true;
    (async () => {
      for (const a of archives) {
        if (!alive) return;
        const zone = await peekArchiveZone(a);
        if (!alive) return;
        if (zone) setZoneByDir(prev => (prev[a.archiveDir] ? prev : { ...prev, [a.archiveDir]: zone }));
      }
    })();
    return () => { alive = false; };
  }, [archives]);

  const runRestore = async (archive: ArchiveEntry) => {
    setStatusByDir(prev => ({ ...prev, [archive.archiveDir]: { kind: 'restoring' } }));
    try {
      const result = await restoreArchive(dataDir, archive);
      setStatusByDir(prev => ({ ...prev, [archive.archiveDir]: { kind: 'done', result } }));
      onRestored();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStatusByDir(prev => ({ ...prev, [archive.archiveDir]: { kind: 'error', message } }));
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { deleted: 0, merged: 0, split: 0 };
    for (const a of archives) c[a.kind] = (c[a.kind] ?? 0) + 1;
    return c;
  }, [archives]);

  const shown = typeFilter === 'all' ? archives : archives.filter(a => a.kind === typeFilter);

  const chipCls = (key: TypeFilter, active: string) =>
    `le-tap px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${typeFilter === key ? active : 'text-gray-500 hover:text-gray-200'}`;

  return (
    <div className="rounded-xl border border-white/10 bg-row-even flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.06]">
        <div className="text-xs text-gray-300 shrink-0">
          {loading ? (
            <span className="text-gray-500 italic">Scanning archives…</span>
          ) : (
            <><span className="text-accent font-semibold text-sm">{shown.length}</span> archived batch{shown.length === 1 ? '' : 'es'}</>
          )}
        </div>
        {!loading && archives.length > 0 && (
          <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-black/25 border border-white/10">
            <button onClick={() => setTypeFilter('all')} className={chipCls('all', 'bg-white/12 text-white')}>All <span className="tabular-nums opacity-70">{archives.length}</span></button>
            <button onClick={() => setTypeFilter('deleted')} className={chipCls('deleted', 'bg-rose-500/20 text-rose-200')}>Deleted <span className="tabular-nums opacity-70">{counts.deleted}</span></button>
            <button onClick={() => setTypeFilter('merged')} className={chipCls('merged', 'bg-violet-500/20 text-violet-200')}>Merged <span className="tabular-nums opacity-70">{counts.merged}</span></button>
            <button onClick={() => setTypeFilter('split')} className={chipCls('split', 'bg-sky-500/20 text-sky-200')}>Split <span className="tabular-nums opacity-70">{counts.split}</span></button>
          </div>
        )}
      </div>

      <div className="overflow-y-auto p-3 space-y-2" style={{ maxHeight: '64vh' }}>
        {!loading && archives.length === 0 && (
          <div className="text-xs text-gray-500 italic py-12 text-center">Nothing archived yet. Merges, splits, and cleanups will show up here for one-click restore.</div>
        )}

        {!loading && archives.length > 0 && shown.length === 0 && (
          <div className="text-xs text-gray-500 italic py-12 text-center">No {typeFilter} archives.</div>
        )}

        {!loading && shown.map(archive => {
          const status = statusByDir[archive.archiveDir] ?? { kind: 'idle' as const };
          const chars = summarizeChars(archive);
          const isOpen = expanded.has(archive.archiveDir);
          return (
            <div key={archive.archiveDir} className="border border-white/10 rounded-lg px-3 py-2.5 bg-black/20">
              <div className="flex items-start gap-2">
                <button
                  onClick={() => toggleExpand(archive.archiveDir)}
                  className="le-tap mt-0.5 text-gray-500 hover:text-white shrink-0"
                  title={isOpen ? 'Hide files' : 'Show files'}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${archive.kind === 'deleted' ? 'bg-rose-500/15 text-rose-300 border-rose-500/40' : archive.kind === 'split' ? 'bg-sky-500/15 text-sky-300 border-sky-500/40' : 'bg-violet-500/15 text-violet-300 border-violet-500/40'}`}>
                      {archive.kind === 'deleted' ? 'Deleted' : archive.kind === 'split' ? 'Split' : 'Merged'}
                    </span>
                    <span className="text-xs text-gray-200 font-mono">{fmtTime(archive.mergedStart)}</span>
                  </div>
                  <div className="text-[11px] text-gray-400 mt-1">
                    <span className="text-gray-300">{archive.members.length} file{archive.members.length === 1 ? '' : 's'}</span>
                    {zoneByDir[archive.archiveDir] && (
                      <>
                        <span className="mx-1.5 text-gray-600">·</span>
                        <span className="text-amber-200/80">{zoneByDir[archive.archiveDir]}</span>
                      </>
                    )}
                    <span className="mx-1.5 text-gray-600">·</span>
                    <span>{chars}</span>
                  </div>
                </div>
                <div className="shrink-0">
                  {status.kind === 'idle' && (
                    <button
                      onClick={() => runRestore(archive)}
                      className="le-tap px-2.5 py-1 text-[11px] rounded bg-accent text-black font-semibold hover:bg-accent/90"
                    >
                      Restore
                    </button>
                  )}
                  {status.kind === 'restoring' && (
                    <span className="text-[11px] text-gray-400 italic">Restoring…</span>
                  )}
                  {status.kind === 'done' && (
                    <span className="text-[11px] text-emerald-400 font-semibold">
                      Restored {status.result.restored.length}
                      {status.result.failed.length > 0 && ` (${status.result.failed.length} failed)`}
                    </span>
                  )}
                  {status.kind === 'error' && (
                    <span className="text-[11px] text-rose-400">Failed</span>
                  )}
                </div>
              </div>
              {isOpen && (
                <div className="mt-2.5 ml-[21px] pt-2.5 border-t border-white/[0.06]">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">
                    {archive.members.length} archived file{archive.members.length === 1 ? '' : 's'}
                  </div>
                  <div className="grid gap-0.5 max-h-40 overflow-y-auto pr-1">
                    {archive.members.map((m, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 text-[11px] font-mono">
                        <span className="truncate text-gray-400">{basename(m.path)}</span>
                        {m.char && <span className="gn-pii shrink-0 text-gray-500">{m.char}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {status.kind === 'done' && status.result.failed.length > 0 && (
                <div className="mt-2 text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1">
                  {status.result.failed.map((f, i) => (
                    <div key={i} className="break-words">{f.path.replace(/^.*[\\/]/, '')}: {f.reason}</div>
                  ))}
                </div>
              )}
              {status.kind === 'error' && (
                <div className="mt-2 text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1 break-words">
                  {status.message}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
