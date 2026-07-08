import { useEffect, useState } from 'react';
import Modal from '@/components/Modal';
import { scanArchives, restoreArchive, peekArchiveZone, type ArchiveEntry, type RestoreResult } from './restoreArchive';

type Status = { kind: 'idle' } | { kind: 'restoring' } | { kind: 'done'; result: RestoreResult } | { kind: 'error'; message: string };

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

export default function RestoreArchiveModal({
  dataDir,
  onClose,
  onRestored,
}: {
  dataDir: string;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [statusByDir, setStatusByDir] = useState<Record<string, Status>>({});
  const [zoneByDir, setZoneByDir] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
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

  return (
    <Modal
      onClose={onClose}
      panelClass="bg-surface border border-white/15 rounded-xl shadow-2xl max-w-2xl w-full p-5 max-h-[80vh] flex flex-col"
    >
      {(close) => (
        <>
          <h3 className="text-sm font-bold text-accent uppercase tracking-wide mb-3">Restore Archived Encounters</h3>
          <p className="text-xs text-gray-400 mb-4">
            When you merge, split, or bulk-delete encounters, the originals get copied to <code className="text-[10px] bg-black/40 px-1 rounded">data/_merged/</code> or <code className="text-[10px] bg-black/40 px-1 rounded">data/_deleted/</code> first.
            You can restore those originals back to their zone folder here.
          </p>

          {loading && (
            <div className="text-xs text-gray-400 italic py-8 text-center">Scanning archives...</div>
          )}

          {!loading && archives.length === 0 && (
            <div className="text-xs text-gray-400 italic py-8 text-center">No archived merges found.</div>
          )}

          {!loading && archives.length > 0 && (
            <div className="space-y-2 overflow-y-auto flex-1 -mx-1 px-1">
              {archives.map(archive => {
                const status = statusByDir[archive.archiveDir] ?? { kind: 'idle' as const };
                const chars = summarizeChars(archive);
                return (
                  <div key={archive.archiveDir} className="border border-white/10 rounded-lg px-3 py-2.5 bg-white/[0.02]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${archive.kind === 'deleted' ? 'bg-rose-500/15 text-rose-300 border-rose-500/40' : archive.kind === 'split' ? 'bg-sky-500/15 text-sky-300 border-sky-500/40' : 'bg-violet-500/15 text-violet-300 border-violet-500/40'}`}>
                            {archive.kind === 'deleted' ? 'Deleted' : archive.kind === 'split' ? 'Split' : 'Merged'}
                          </span>
                          <span className="text-xs text-gray-200 font-mono">{fmtTime(archive.mergedStart)}</span>
                        </div>
                        <div className="text-[11px] text-gray-400 mt-1">
                          <span className="text-gray-300">{archive.members.length} files</span>
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
                          <span className="text-[11px] text-gray-400 italic">Restoring...</span>
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
          )}

          <div className="flex justify-end mt-4 pt-3 border-t border-white/10">
            <button onClick={close} className="le-tap px-3 py-1.5 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/5">Close</button>
          </div>
        </>
      )}
    </Modal>
  );
}
