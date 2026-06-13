
import { JOB_FULL_NAMES } from './anonymize';

type AnyObj = Record<string, unknown>;
const arr = (v: unknown): AnyObj[] => (Array.isArray(v) ? (v as AnyObj[]) : []);

const RESERVED_COMBAT_KEYS = new Set(['total_damage', 'melee', 'ranged', 'category', 'other', 'defense', 'multi']);
const JOB_LABELS = new Set<string>([...Object.values(JOB_FULL_NAMES), ...Object.keys(JOB_FULL_NAMES)]);
const MIN_SUBSTRING_LEN = 3;

function isAnonLabel(s: string): boolean {
  if (/^Player( \d+)?$/.test(s)) return true;
  if (JOB_LABELS.has(s)) return true;
  const m = s.match(/^(.+) \d+$/);
  return !!(m && JOB_LABELS.has(m[1]));
}

function eachCombatPlayer(data: AnyObj, fn: (name: string) => void) {
  const cs = (data.combatStats ?? data.combat_stats) as AnyObj | undefined;
  if (!cs || typeof cs !== 'object' || Array.isArray(cs)) return;
  for (const players of Object.values(cs)) {
    if (!players || typeof players !== 'object' || Array.isArray(players)) continue;
    for (const k of Object.keys(players as AnyObj)) {
      if (RESERVED_COMBAT_KEYS.has(k)) continue;
      const sc = k.match(/^SC-(.+)$/);
      fn(sc ? sc[1] : k);
    }
  }
}

export function findPlayerLeaks(data: unknown): string[] {
  const d = data as AnyObj;
  if (!d || typeof d !== 'object') return [];

  // Trusts pass through (their names are public NPC identities).
  const trusts = new Set<string>();
  for (const p of arr(d.party)) if ((p.mainJob as string) === 'TRUST' && typeof p.name === 'string') trusts.add(p.name);
  const pj = (d.party_jobs ?? d.partyJobs) as Record<string, { main?: string }> | undefined;
  if (pj && typeof pj === 'object' && !Array.isArray(pj)) {
    for (const [name, info] of Object.entries(pj)) if (info?.main === 'TRUST') trusts.add(name);
  }

  const realNames = new Set<string>();
  const seed = (n: unknown) => {
    if (typeof n !== 'string' || !n) return;
    if (trusts.has(n)) return;
    if (isAnonLabel(n)) return;
    realNames.add(n);
  };
  for (const p of arr(d.party)) seed((p as AnyObj).name);
  for (const h of arr(d.partyHpLog ?? d.party_hp_log)) seed(h.player);
  for (const m of arr(d.partyMpLog ?? d.party_mp_log)) seed(m.player);
  for (const t of arr(d.partyTpLog ?? d.party_tp_log)) seed(t.player);
  eachCombatPlayer(d, seed);
  const harvest = (rep: AnyObj | null | undefined) => {
    if (!rep) return;
    for (const key of ['damageReport', 'wsAverages', 'wsAccuracy', 'accuracy', 'critRate', 'meleeAverage', 'meleeCritAverage']) {
      for (const e of arr(rep[key])) {
        const nm = (e as AnyObj).name as string | undefined;
        if (typeof nm !== 'string') continue;
        const sc = nm.match(/^SC-(.+)$/);
        seed(sc ? sc[1] : nm);
      }
    }
  };
  const reports = (d.bossReports ?? d.boss_reports ?? d.enemyReports ?? d.enemy_reports) as Record<string, AnyObj> | undefined;
  for (const v of Object.values(reports ?? {})) harvest(v);
  harvest(d.aminon as AnyObj | undefined);
  seed(d.localCharacter);
  const gbp = d.gearByPlayer as Record<string, AnyObj> | undefined;
  if (gbp && typeof gbp === 'object' && !Array.isArray(gbp)) {
    for (const k of Object.keys(gbp)) seed(k);
    for (const ch of Object.values(gbp)) {
      if (!ch || typeof ch !== 'object') continue;
      for (const g of arr(ch.gearLog)) seed((g as AnyObj).player);
    }
  }
  for (const g of arr(d.gearLog)) seed((g as AnyObj).player);
  for (const p of arr(d.partyPositionLog ?? d.party_position_log)) seed((p as AnyObj).player);
  for (const dr of arr(d.dropLog ?? d.drop_log)) seed((dr as AnyObj).by);
  for (const e of arr(d.deathLog ?? d.death_log)) seed((e as AnyObj).player);
  for (const e of arr(d.itemUseLog ?? d.item_use_log)) seed((e as AnyObj).player);
  for (const e of arr(d.petLog ?? d.pet_log)) seed((e as AnyObj).owner);

  if (realNames.size === 0) return [];

  const namesArr = [...realNames].filter(n => n.length >= MIN_SUBSTRING_LEN);
  if (namesArr.length === 0) return [];
  namesArr.sort((a, b) => b.length - a.length);
  const re = new RegExp(`\\b(${namesArr.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`);

  const leaks = new Set<string>();
  const visit = (v: unknown) => {
    if (typeof v === 'string') {
      const m = v.match(re);
      if (m) leaks.add(m[1]);
      return;
    }
    if (Array.isArray(v)) { for (const x of v) visit(x); return; }
    if (v && typeof v === 'object') {
      for (const [k, vv] of Object.entries(v)) {
        if (k === 'rawText' || k === 'raw_text') continue;
        const mk = k.match(re);
        if (mk) leaks.add(mk[1]);
        visit(vv);
      }
    }
  };
  visit(d);
  return [...leaks];
}
