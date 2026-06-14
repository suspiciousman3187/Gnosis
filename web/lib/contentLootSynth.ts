
import type { LootEncounterSummary } from './dropAggregator';
import type { EncounterDrop } from './encounter';
import type { ActionLogEntry, KillLogEntry, DropLogEntry, PartyMember, RawBattleMessage } from './types';
import { deriveEnemiesFromActionLog } from './sortieEnemies';

const SORTIE_ZONE = { id: 290, name: "Outer Ra'Kaznar [U2]/[U3]" } as const;

function stripChatCodes(s: string): string {
  return s.replace(/\x1e\x01|\x1e\x02|\x1f\x7f|\x1f.|[\x00-\x1f]/g, '').trim();
}

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
  return 0;
}

export function enemiesFromKills(
  killLog: KillLogEntry[],
  bossReports: Record<string, { fightDurationSeconds?: number; fightStartElapsed?: number }> | null | undefined,
): LootEncounterSummary['enemies'] {
  const sorted = [...killLog].sort((a, b) => a.elapsed - b.elapsed);
  return sorted.map((k, i): { name: string; id: number; firstSeen: number; killedAt: number; damageTaken: number } => {
    const report = bossReports?.[k.name];
    let firstSeen: number;
    if (report?.fightStartElapsed != null && report.fightStartElapsed >= 0 && report.fightStartElapsed < k.elapsed) {
      firstSeen = report.fightStartElapsed;
    } else if (report?.fightDurationSeconds != null && report.fightDurationSeconds > 0 && report.fightDurationSeconds <= k.elapsed) {
      firstSeen = k.elapsed - report.fightDurationSeconds;
    } else {
      firstSeen = i === 0 ? Math.max(0, k.elapsed - 1) : sorted[i - 1].elapsed;
    }
    return {
      name: k.name,
      id: k.id,
      firstSeen,
      killedAt: k.elapsed,
      damageTaken: 0,
    };
  });
}

function sumAreaTimes(at: unknown): number {
  if (!at || typeof at !== 'object') return 0;
  let total = 0;
  for (const v of Object.values(at as Record<string, unknown>)) total += num(v);
  return total;
}

function synthSortie(path: string, ts: number, data: any): LootEncounterSummary {
  const dropLog: EncounterDrop[] = Array.isArray(data.dropLog)
    ? (data.dropLog as DropLogEntry[]).map((d): EncounterDrop => {
        const rawType = d.type as DropLogEntry['type'];
        const type: EncounterDrop['type'] = rawType === 'temp' ? 'temporary'
          : rawType === 'temporary' ? 'temporary'
          : rawType === 'pool' ? 'pool'
          : rawType === 'direct' ? 'direct'
          : undefined;
        const source = typeof d.source === 'string' && d.source.length > 0
          ? d.source
          : (typeof d.area === 'string' && d.area.length > 0 ? `Sortie ${d.area}` : undefined);
        return {
          name: typeof d.name === 'string' ? stripChatCodes(d.name) : String(d.name ?? ''),
          elapsed: num(d.elapsed),
          itemId: typeof d.itemId === 'number' ? d.itemId : undefined,
          count: typeof d.count === 'number' ? d.count : 1,
          source,
          by: typeof d.by === 'string' ? d.by : undefined,
          type,
        };
      })
    : [];

  const killLog: KillLogEntry[] = Array.isArray(data.killLog) ? data.killLog as KillLogEntry[] : [];
  const actionLog: ActionLogEntry[] | null = Array.isArray(data.actionLog) ? data.actionLog as ActionLogEntry[] : null;
  const party: PartyMember[] | null = Array.isArray(data.party) ? data.party as PartyMember[] : null;
  const battleMsgRaw: RawBattleMessage[] | null = Array.isArray(data.battleMsgRaw) ? data.battleMsgRaw as RawBattleMessage[] : null;

  const derived = deriveEnemiesFromActionLog(actionLog, killLog, party, battleMsgRaw);
  const enemies: LootEncounterSummary['enemies'] = derived.length > 0
    ? derived.filter((e): e is typeof e & { id: number } => e.id != null).map(e => ({
        name: e.name,
        id: e.id,
        firstSeen: e.firstSeen ?? 0,
        killedAt: e.killedAt ?? 0,
        damageTaken: e.damageTaken ?? 0,
      }))
    : enemiesFromKills(killLog, (data && typeof data === 'object' ? data.bossReports : null) as Record<string, { fightDurationSeconds?: number; fightStartElapsed?: number }> | null);

  return {
    path,
    ts,
    zone: SORTIE_ZONE.name,
    zoneId: SORTIE_ZONE.id,
    durationSeconds: sumAreaTimes(data.areaTimes),
    killLog,
    dropLog,
    enemies,
  };
}

export function synthContentLoot(
  path: string,
  kind: 'sortie',
  rawText: string,
  ts: number,
): LootEncounterSummary | null {
  let data: any;
  try { data = JSON.parse(rawText); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  if (kind === 'sortie') return synthSortie(path, ts, data);
  return null;
}
