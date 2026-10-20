import { useEffect, useRef, useState } from 'react';
import type { LootEncounterSummary } from '@/lib/dropAggregator';
import { dbLootSlicesForPaths, dbKnownPathsSet, requestLoots, forceReparseLoots, getActiveDir, getFailedPaths } from './summaryStore';
import { kindFromName, fileTs, representativeLootSummaries } from './content';
import { LOOT_SCHEMA_VERSION } from '@/lib/dropAggregator';
import { recordsFingerprint } from '@/lib/recordsRollup';

export type AggPhase = 'idle' | 'ingesting' | 'parsing' | 'ready';

export interface AggregationState {
  entries: LootEncounterSummary[];
  loading: boolean;
  phase: AggPhase;
  progress: { loaded: number; total: number };
  /** true when stale sortie slices are still reparsing in the background, so
   *  entries are usable but not yet final (kill times / aminon mode pending). */
  pending: boolean;
}

const EMPTY: AggregationState = {
  entries: [],
  loading: false,
  phase: 'idle',
  progress: { loaded: 0, total: 0 },
  pending: false,
};

interface UseAggOpts {
  paths?: string[];
  enabled: boolean;
  scope: '30d' | '90d' | 'all';
  // Loot/drops tabs are encounter-only. Records wants sortie bosses too
  // (Aminon, Aita, Gartell...), so it opts sortie files in.
  includeSortie?: boolean;
  // Bump to force a fresh DB re-read (e.g. after a background reparse settles).
  nonce?: number;
}

export function useLootAggregation({ paths, enabled, scope, includeSortie = false, nonce = 0 }: UseAggOpts): AggregationState {
  const [state, setState] = useState<AggregationState>(EMPTY);
  // Raw (pre-dedup) slices from the last FULL read, keyed by path. A refine pass
  // (nonce bump) re-reads only the reparsed-stale slices and splices them in here,
  // instead of re-reading + re-parsing the whole library from the DB every cycle.
  const rawRef = useRef<Map<string, LootEncounterSummary>>(new Map());
  const staleRef = useRef<string[]>([]);
  const setKeyRef = useRef<string>('');

  useEffect(() => {
    if (!enabled) { setState(EMPTY); return; }
    if (!paths || paths.length === 0) { setState(EMPTY); return; }
    if (!getActiveDir()) { setState(EMPTY); return; }

    let cancelled = false;
    let pollTimer: number | null = null;

    const cutoffSecs = scope === 'all' ? null : Math.floor(Date.now() / 1000) - (scope === '30d' ? 30 : 90) * 24 * 60 * 60;
    const scopedPaths = paths.filter(p => {
      const kind = kindFromName(p);
      if (kind !== 'encounter' && !(includeSortie && kind === 'sortie')) return false;
      if (cutoffSecs != null && fileTs(p) < cutoffSecs) return false;
      return true;
    });

    if (scopedPaths.length === 0) {
      setState({ entries: [], loading: false, phase: 'ready', progress: { loaded: 0, total: 0 }, pending: false });
      return;
    }

    // Emit the current rawRef, deduped, recomputing which sortie slices are still
    // stale (so the caller keeps refining until they upgrade or it gives up).
    const finalizeFromRaw = () => {
      if (cancelled) return;
      const all = [...rawRef.current.values()];
      const stale = includeSortie
        ? all.filter(e => kindFromName(e.path) === 'sortie' && (e.sv ?? 0) < LOOT_SCHEMA_VERSION).map(e => e.path)
        : [];
      staleRef.current = stale;
      const reps = representativeLootSummaries(all);
      setState({ entries: reps, loading: false, phase: 'ready', progress: { loaded: all.length, total: all.length }, pending: stale.length > 0 });
    };

    const setKey = `${scope}|${includeSortie}|${recordsFingerprint(scopedPaths)}`;
    const isRefine = nonce > 0 && setKeyRef.current === setKey && rawRef.current.size > 0;

    // ── Refine pass: re-read ONLY the still-stale slices, splice, re-emit. ──────
    if (isRefine) {
      void (async () => {
        const stale = staleRef.current;
        if (stale.length === 0) { finalizeFromRaw(); return; }
        const fresh = await dbLootSlicesForPaths(stale);
        if (cancelled) return;
        for (const e of fresh) rawRef.current.set(e.path, e);
        finalizeFromRaw();
      })();
      return () => { cancelled = true; };
    }

    // ── Full pass: ingest missing, read+parse the whole scoped set once. ───────
    setKeyRef.current = setKey;
    rawRef.current = new Map();
    const total = scopedPaths.length;
    setState({ entries: [], loading: true, phase: 'ingesting', progress: { loaded: 0, total }, pending: false });

    const onProg = (parsed: number, t: number) => {
      if (cancelled) return;
      setState(s => (s.progress.loaded === parsed ? s : { ...s, phase: 'parsing', progress: { loaded: parsed, total: t } }));
    };
    const parseFromDb = async () => {
      if (cancelled) return;
      setState(s => ({ ...s, phase: 'parsing', progress: { loaded: 0, total } }));
      const entries = await dbLootSlicesForPaths(scopedPaths, onProg);
      if (cancelled) return;
      rawRef.current = new Map(entries.map(e => [e.path, e]));

      // Old sortie slices were cached before the enemies[]/aminon derivation
      // (sv < current). Kick a NON-BLOCKING background reparse - kills/drops
      // already work from the current slices, so the view renders immediately and
      // a refine pass (nonce) re-reads just these once reparse lands.
      if (includeSortie) {
        const stale = entries
          .filter(e => kindFromName(e.path) === 'sortie' && (e.sv ?? 0) < LOOT_SCHEMA_VERSION)
          .map(e => e.path);
        if (stale.length > 0) forceReparseLoots(stale);
      }

      finalizeFromRaw();
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

      // Give up on files that never become "known" (corrupt/unparseable captures
      // silently fail to parse, so they'd never leave `stillMissing`). We proceed
      // the moment parsing stops making progress for a while, using whatever did
      // load - otherwise a single bad file makes Records spin forever at ~100%
      // (only reproduced on larger 90-day / all-time sets). Progress resets the
      // stall counter, so a big library that's still parsing keeps going.
      let lastMissing = Infinity;
      let stalls = 0;
      const MAX_STALLS = 10; // ~8s with zero newly-parsed files -> the rest are stuck
      const tick = async () => {
        if (cancelled) return;
        const knownNow = await dbKnownPathsSet();
        if (cancelled) return;
        // A file that failed to parse will never become "known" - count it as
        // resolved so the poll completes deterministically instead of spinning.
        const failed = getFailedPaths();
        const stillMissing = scopedPaths.filter(p => !knownNow.has(p) && !failed.has(p));
        const loaded = total - stillMissing.length;
        setState(s => (s.progress.loaded === loaded ? s : { ...s, phase: 'ingesting', progress: { loaded, total } }));
        if (stillMissing.length < lastMissing) stalls = 0; else stalls += 1;
        lastMissing = stillMissing.length;
        if (stillMissing.length === 0 || stalls >= MAX_STALLS) {
          if (stillMissing.length > 0) console.warn(`[records] proceeding without ${stillMissing.length} file(s) that failed to load`);
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
  }, [enabled, paths, scope, includeSortie, nonce]);

  return state;
}
