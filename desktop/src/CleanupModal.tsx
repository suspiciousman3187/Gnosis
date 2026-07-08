import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { kindFromName, fileTs, type PathGroup } from './content';
import type { EncSummary } from './App';

function fmtDur(s: number): string {
  if (!s || s <= 0) return '0s';
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return m > 0 ? `${m}m ${ss}s` : `${ss}s`;
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function isProtectedContent(rep: string, s: EncSummary | undefined): boolean {
  if (kindFromName(rep) !== 'encounter') return true;
  if (s?.contentDefId) return true;
  if (s?.source && s.source !== 'generic') return true;
  return false;
}

type Filters = {
  useDuration: boolean; durMax: number;
  useDamage: boolean; dmgMax: number;
  useMobs: boolean; mobsMax: number;
  useZone: boolean; zone: string;
  protectContent: boolean;
};

export default function CleanupModal({
  groups,
  encSummaries,
  onDelete,
  onClose,
}: {
  groups: PathGroup[];
  encSummaries: Record<string, EncSummary>;
  onDelete: (members: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [f, setF] = useState<Filters>({
    useDuration: true, durMax: 30,
    useDamage: false, dmgMax: 1000,
    useMobs: false, mobsMax: 2,
    useZone: false, zone: '',
    protectContent: true,
  });
  const [step, setStep] = useState<'filter' | 'confirm' | 'working' | 'error'>('filter');
  const [error, setError] = useState<string | null>(null);

  const zones = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      const s = encSummaries[g.rep];
      const z = s?.zones?.length ? s.zones : (s?.zone ? [s.zone] : []);
      for (const zn of z) if (zn) set.add(zn);
    }
    return [...set].sort();
  }, [groups, encSummaries]);

  const anyFilter = f.useDuration || f.useDamage || f.useMobs || f.useZone;

  const matches = useMemo(() => {
    if (!anyFilter) return [];
    return groups.filter(g => {
      if (g.view?.segIndex != null) return false;
      const s = encSummaries[g.rep];
      if (f.protectContent && isProtectedContent(g.rep, s)) return false;
      if (f.useDuration && !((s?.dur ?? 0) < f.durMax)) return false;
      if (f.useDamage && !((s?.metrics?.totalDamage ?? 0) < f.dmgMax)) return false;
      if (f.useMobs && !((s?.enemies ?? 0) < f.mobsMax)) return false;
      if (f.useZone) {
        const z = s?.zones?.length ? s.zones : (s?.zone ? [s.zone] : []);
        if (!z.includes(f.zone)) return false;
      }
      return true;
    });
  }, [groups, encSummaries, f, anyFilter]);

  const fileCount = useMemo(() => matches.reduce((n, g) => n + g.members.length, 0), [matches]);

  const runDelete = async () => {
    setStep('working');
    setError(null);
    try {
      const members = matches.flatMap(g => g.members);
      await onDelete(members);
      onClose();
    } catch (e) {
      setStep('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const numInput = (val: number, set: (n: number) => void, enable: () => void) => (
    <input
      type="number"
      value={val}
      onClick={e => { e.stopPropagation(); enable(); }}
      onChange={e => { enable(); set(Math.max(0, Number(e.target.value) || 0)); }}
      className="mx-1.5 w-16 px-1 py-0.5 text-[11px] bg-black/40 border border-white/15 rounded font-mono text-gray-100"
    />
  );

  return createPortal((
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/60" onClick={onClose}>
      <div className="bg-surface border border-white/15 rounded-xl shadow-2xl max-w-lg w-full p-5 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-accent uppercase tracking-wide mb-1">Clean Up Encounters</h3>
        <p className="text-xs text-gray-400 mb-4">
          Sweep away incidental combat left behind by running Gnosis full-time. Matched encounters are archived to <code className="text-[10px] bg-black/40 px-1 rounded">data/_deleted/</code> first and can be recovered from Restore.
        </p>

        {(step === 'filter' || step === 'confirm') && (
          <>
            <div className="space-y-2 mb-3">
              <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                <input type="checkbox" checked={f.useDuration} onChange={e => setF(v => ({ ...v, useDuration: e.target.checked }))} className="accent-accent" />
                <span>Shorter than {numInput(f.durMax, n => setF(v => ({ ...v, durMax: n })), () => setF(v => ({ ...v, useDuration: true })))} seconds</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                <input type="checkbox" checked={f.useDamage} onChange={e => setF(v => ({ ...v, useDamage: e.target.checked }))} className="accent-accent" />
                <span>Total damage under {numInput(f.dmgMax, n => setF(v => ({ ...v, dmgMax: n })), () => setF(v => ({ ...v, useDamage: true })))}</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                <input type="checkbox" checked={f.useMobs} onChange={e => setF(v => ({ ...v, useMobs: e.target.checked }))} className="accent-accent" />
                <span>Fewer than {numInput(f.mobsMax, n => setF(v => ({ ...v, mobsMax: n })), () => setF(v => ({ ...v, useMobs: true })))} enemies</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                <input type="checkbox" checked={f.useZone} onChange={e => setF(v => ({ ...v, useZone: e.target.checked }))} className="accent-accent" />
                <span>In zone</span>
                <select
                  value={f.zone}
                  onClick={e => e.stopPropagation()}
                  onChange={e => setF(v => ({ ...v, useZone: true, zone: e.target.value }))}
                  className="flex-1 min-w-0 px-1.5 py-0.5 text-[11px] bg-black/40 border border-white/15 rounded text-gray-100"
                >
                  <option value="">Select zone…</option>
                  {zones.map(z => <option key={z} value={z}>{z}</option>)}
                </select>
              </label>
            </div>

            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer mb-3 pt-2 border-t border-white/[0.06]">
              <input type="checkbox" checked={f.protectContent} onChange={e => setF(v => ({ ...v, protectContent: e.target.checked }))} className="accent-accent" />
              <span>Protect recognized content (Sortie, Limbus, Odyssey, …) from the sweep</span>
            </label>

            <div className="text-[11px] text-gray-400 mb-2">
              {!anyFilter ? 'Enable a filter above to preview matches.'
                : <><span className="text-accent font-semibold">{matches.length}</span> of {groups.filter(g => g.view?.segIndex == null).length} encounters match ({fileCount} file{fileCount === 1 ? '' : 's'})</>}
            </div>

            {anyFilter && matches.length > 0 && (
              <div className="flex-1 overflow-y-auto border border-white/[0.06] rounded mb-3 min-h-[80px]">
                <table className="w-full text-[11px]">
                  <tbody>
                    {matches.slice(0, 200).map(g => {
                      const s = encSummaries[g.rep];
                      const z = s?.zones?.length ? s.zones.join(' + ') : (s?.zone ?? '…');
                      return (
                        <tr key={g.id} className="border-b border-white/[0.04] last:border-0">
                          <td className="px-2 py-1 text-gray-200 truncate max-w-[180px]">{z}</td>
                          <td className="px-2 py-1 text-right text-gray-400 font-mono whitespace-nowrap">{fmtDur(s?.dur ?? 0)}</td>
                          <td className="px-2 py-1 text-right text-gray-500 font-mono whitespace-nowrap">{(s?.enemies ?? 0)} mob{(s?.enemies ?? 0) === 1 ? '' : 's'}</td>
                          <td className="px-2 py-1 text-right text-gray-500 font-mono whitespace-nowrap">{fmtDate(fileTs(g.rep))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {matches.length > 200 && (
                  <div className="px-2 py-1.5 text-[10px] text-gray-500 italic text-center">+{matches.length - 200} more not shown (all will be deleted)</div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-auto">
              <button onClick={onClose} className="le-tap px-3 py-1.5 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/5">Cancel</button>
              {step === 'filter' ? (
                <button
                  onClick={() => setStep('confirm')}
                  disabled={matches.length === 0}
                  className="le-tap px-3 py-1.5 text-xs rounded bg-rose-600 text-white font-semibold hover:bg-rose-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed"
                >
                  Delete {matches.length || ''} encounter{matches.length === 1 ? '' : 's'}
                </button>
              ) : (
                <button onClick={runDelete} className="le-tap px-3 py-1.5 text-xs rounded bg-rose-600 text-white font-semibold hover:bg-rose-500">
                  Confirm delete {fileCount} file{fileCount === 1 ? '' : 's'}
                </button>
              )}
            </div>
          </>
        )}

        {step === 'working' && (
          <div className="py-8 text-center text-xs text-gray-400 italic">Archiving and deleting {fileCount} files…</div>
        )}

        {step === 'error' && (
          <>
            <p className="text-xs text-rose-300 mb-3 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1.5 break-words">{error ?? 'Unknown error.'}</p>
            <div className="flex justify-end">
              <button onClick={onClose} className="le-tap px-3 py-1.5 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/5">Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  ), document.body);
}
