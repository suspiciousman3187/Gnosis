import { useEffect, useState } from 'react';
import type { LootEncounterSummary } from '@/lib/dropAggregator';
import { dbLootSlicesForPaths, dbKnownPathsSet, requestLoots, getActiveDir } from './summaryStore';
import { kindFromName, fileTs, representativeLootSummaries } from './content';

export type AggPhase = 'idle' | 'ingesting' | 'parsing' | 'ready';

export interface AggregationState {
  entries: LootEncounterSummary[];
  loading: boolean;
  phase: AggPhase;
  progress: { loaded: number; total: number };
}

const EMPTY: AggregationState = {
  entries: [],
  loading: false,
  phase: 'idle',
  progress: { loaded: 0, total: 0 },
};

interface UseAggOpts {
  paths?: string[];
  enabled: boolean;
  scope: '30d' | '90d' | 'all';
}

export function useLootAggregation({ paths, enabled, scope }: UseAggOpts): AggregationState {
  const [state, setState] = useState<AggregationState>(EMPTY);

  useEffect(() => {
    if (!enabled) { setState(EMPTY); return; }
    if (!paths || paths.length === 0) { setState(EMPTY); return; }
    if (!getActiveDir()) { setState(EMPTY); return; }

    let cancelled = false;
    let pollTimer: number | null = null;

    const cutoffSecs = scope === 'all' ? null : Math.floor(Date.now() / 1000) - (scope === '30d' ? 30 : 90) * 24 * 60 * 60;
    const scopedPaths = paths.filter(p => {
      if (kindFromName(p) !== 'encounter') return false;
      if (cutoffSecs != null && fileTs(p) < cutoffSecs) return false;
      return true;
    });

    if (scopedPaths.length === 0) {
      setState({ entries: [], loading: false, phase: 'ready', progress: { loaded: 0, total: 0 } });
      return;
    }

    const total = scopedPaths.length;
    setState({ entries: [], loading: true, phase: 'ingesting', progress: { loaded: 0, total } });

    const parseFromDb = async () => {
      if (cancelled) return;
      setState(s => ({ ...s, phase: 'parsing', progress: { loaded: 0, total } }));
      const entries = await dbLootSlicesForPaths(scopedPaths, (parsed, t) => {
        if (cancelled) return;
        setState(s => (s.progress.loaded === parsed ? s : { ...s, phase: 'parsing', progress: { loaded: parsed, total: t } }));
      });
      if (cancelled) return;
      const reps = representativeLootSummaries(entries);
      setState({ entries: reps, loading: false, phase: 'ready', progress: { loaded: total, total } });
    };

    void (async () => {
      const known = await dbKnownPathsSet();
      if (cancelled) return;

      const missing = scopedPaths.filter(p => !known.has(p));
      const initialLoaded = total - missing.length;
      setState(s => ({ ...s, phase: missing.length === 0 ? 'parsing' : 'ingesting', progress: { loaded: initialLoaded, total } }));

      if (missing.length === 0) {
        await parseFromDb();
        return;
      }

      requestLoots(missing);

      const tick = async () => {
        if (cancelled) return;
        const knownNow = await dbKnownPathsSet();
        if (cancelled) return;
        const stillMissing = scopedPaths.filter(p => !knownNow.has(p));
        const loaded = total - stillMissing.length;
        setState(s => (s.progress.loaded === loaded ? s : { ...s, phase: 'ingesting', progress: { loaded, total } }));
        if (stillMissing.length === 0) {
          await parseFromDb();
        } else {
          pollTimer = window.setTimeout(tick, 800);
        }
      };
      pollTimer = window.setTimeout(tick, 800);
    })();

    return () => {
      cancelled = true;
      if (pollTimer != null) window.clearTimeout(pollTimer);
    };
  }, [enabled, paths, scope]);

  return state;
}
