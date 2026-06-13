import type { Encounter, EncounterDrop, EncounterEnemy } from '@/lib/encounter';
import type { LootEncounterSummary } from '@/lib/dropAggregator';
import { playerMetricsForEncounter, type EncounterMetrics } from '@/lib/combatStats';
import { classify, mobNamesFromLootSummary, itemNamesFromLootSummary } from '@/lib/contentRegistry';
import { deriveSortieEnemies } from '@/lib/sortieEnemies';
import type { RunRecord } from '@/lib/types';
import type { EncSummary } from './App';

export interface ParseRequest {
  id: number;
  path: string;
  buf: ArrayBuffer;
  wantMetrics: boolean;
  ts: number;
}

export interface ParseOk {
  id: number;
  ok: true;
  summary: EncSummary;
  loot: LootEncounterSummary;
  summaryJson: string;
  lootJson: string;
}

export interface ParseErr {
  id: number;
  ok: false;
}

export type ParseReply = ParseOk | ParseErr;

export interface ParsedEncounterResult {
  summary: EncSummary;
  loot: LootEncounterSummary;
  summaryJson?: string;
  lootJson?: string;
}

const EMPTY_METRICS: EncounterMetrics = { players: [], totalDamage: 0 };

function isSortiePath(path: string): boolean {
  const b = path.replace(/^.*[\\/]/, '');
  return b.startsWith('sortie_');
}

function zoneFromPath(path: string): string | null {
  const parts = path.split(/[\\/]/);
  const i = parts.lastIndexOf('data');
  if (i < 0 || i >= parts.length - 2) return null;
  const seg = parts[i + 1];
  if (!seg || seg.startsWith('_') || seg === 'Unknown') return null;
  return seg;
}

function extractSortieInfo(data: unknown): EncSummary['sortie'] {
  const d = data as { defeatedBosses?: unknown; aminon?: { mode?: string; killed?: boolean } | null };
  const defeated = Array.isArray(d?.defeatedBosses) ? d.defeatedBosses.length : 0;
  const am = d?.aminon;
  const mode = am?.mode;
  const aminon: { mode: 'normal' | 'hardmode'; killed: boolean } | null =
    am && (mode === 'hardmode' || mode === 'normal')
      ? { mode, killed: !!am.killed }
      : null;
  return { defeated, aminon };
}

/** Collapse a pool→direct pair that the addon emits ~10 s apart for the
 *  same item; we keep the pool entry and drop the duplicate direct. */
function dedupePoolText(dropLog: EncounterDrop[]): EncounterDrop[] {
  if (dropLog.length === 0) return dropLog;
  const recentPool = new Map<string, number>();
  return dropLog.filter(d => {
    if (d.type === 'pool' && d.name) {
      recentPool.set(d.name, d.elapsed);
      return true;
    }
    if (d.type === 'direct' && d.name) {
      const last = recentPool.get(d.name);
      if (last != null && (d.elapsed - last) <= 10) return false;
    }
    return true;
  });
}

/** Single source of truth for "JSON text → {summary, loot}". The worker
 *  entry point and the main-thread fallback both go through this; the only
 *  thing the worker adds is the postMessage envelope. */
export function parseJsonWithTrailingRecovery(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const m = msg.match(/position (\d+)/);
    if (!m) throw err;
    const pos = parseInt(m[1], 10);
    if (!Number.isFinite(pos) || pos <= 0 || pos > text.length) throw err;
    return JSON.parse(text.slice(0, pos));
  }
}

export function parseEncounterText(
  path: string,
  text: string,
  wantMetrics: boolean,
  ts: number,
): ParsedEncounterResult | null {
  try {
    const e = parseJsonWithTrailingRecovery(text) as Encounter;
    const fallbackZone = zoneFromPath(path);
    const headlineZone = e.zoneName?.trim() || fallbackZone;
    const zoneList = ((): string[] => {
      const log = e.zoneLog ?? null;
      if (Array.isArray(log) && log.length > 0) {
        const out: string[] = [];
        const seen = new Set<string>();
        for (const z of log) {
          const n = z.zoneName?.trim();
          if (!n || seen.has(n)) continue;
          seen.add(n); out.push(n);
        }
        if (out.length > 0) return out;
      }
      return headlineZone ? [headlineZone] : [];
    })();
    const enemiesArr: EncounterEnemy[] = (() => {
      if (Array.isArray(e.enemies) && e.enemies.length > 0) return e.enemies;
      if (isSortiePath(path)) {
        const r = e as unknown as RunRecord;
        return deriveSortieEnemies(r.action_log ?? null, r.kill_log ?? null, r.party ?? null);
      }
      return [];
    })();
    const loot: LootEncounterSummary = {
      path,
      ts: e.startTime || ts,
      zone: headlineZone || null,
      zoneId: e.zoneId ?? null,
      durationSeconds: e.durationSeconds,
      killLog: Array.isArray(e.killLog) ? e.killLog : [],
      dropLog: dedupePoolText(Array.isArray(e.dropLog) ? e.dropLog : []),
      enemies: enemiesArr,
    };
    const fileKind: 'encounter' | 'sortie' = isSortiePath(path) ? 'sortie' : 'encounter';
    const contentDef = classify({
      kind: fileKind,
      zoneId: loot.zoneId,
      zoneName: loot.zone,
      mobNames: mobNamesFromLootSummary(loot),
      itemNames: itemNamesFromLootSummary(loot),
    });
    const summary: EncSummary = {
      zone: headlineZone || null,
      zones: zoneList,
      dur: e.durationSeconds,
      enemies: enemiesArr.length,
      enemyNames: enemiesArr.map(en => en.name),
      playerNames: (e.party ?? []).map(pl => pl.name),
      jobs: (e.party ?? []).map(pl => pl.mainJob || '').filter(Boolean),
      source: e.source ?? null,
      contentDefId: contentDef?.id ?? null,
      ts,
      metrics: wantMetrics ? playerMetricsForEncounter(e) : EMPTY_METRICS,
      sortie: isSortiePath(path) ? extractSortieInfo(e) : undefined,
    };
    return { summary, loot };
  } catch {
    return null;
  }
}
