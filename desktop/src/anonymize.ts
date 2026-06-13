import { JOB_FULL_NAMES } from '@/lib/anonymize';

type AnyObj = Record<string, unknown>;
const arr = (v: unknown): AnyObj[] => (Array.isArray(v) ? (v as AnyObj[]) : []);

const RESERVED_COMBAT_KEYS = new Set(['total_damage', 'melee', 'ranged', 'category', 'other', 'defense', 'multi']);

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

function roster(data: AnyObj): { name: string; id?: number; job: string; trust: boolean }[] {
  const out: { name: string; id?: number; job: string; trust: boolean }[] = [];
  for (const p of arr(data.party)) {
    const name = p.name as string | undefined;
    const id = typeof p.id === 'number' ? p.id : undefined;
    const job = (p.mainJob as string) || '';
    if (name) out.push({ name, id, job, trust: job === 'TRUST' });
  }
  const pj = (data.party_jobs ?? data.partyJobs) as Record<string, { main?: string }> | undefined;
  if (pj && typeof pj === 'object' && !Array.isArray(pj)) {
    for (const [name, info] of Object.entries(pj)) {
      const job = info?.main || '';
      out.push({ name, job, trust: job === 'TRUST' });
    }
  }
  return out;
}

function jobLabel(job: string): string {
  if (JOB_FULL_NAMES[job]) return JOB_FULL_NAMES[job];
  if (!job || job === '0' || !/^[A-Z]+$/.test(job)) return 'Player';
  return job;
}

function buildMap(data: AnyObj): Record<string, string> {
  const map: Record<string, string> = {};
  const skip = new Set<string>();          // trusts - never anonymized
  const r = roster(data);

  const jobCount: Record<string, number> = {};
  for (const { job, trust } of r) if (!trust) { const l = jobLabel(job); jobCount[l] = (jobCount[l] ?? 0) + 1; }
  const jobIdx: Record<string, number> = {};
  const idToLabel: Record<number, string> = {};
  for (const { name, id, job, trust } of r) {
    if (!name) continue;
    if (trust) { skip.add(name); continue; }
    if (map[name]) continue;
    const label = jobLabel(job);
    const finalLabel = jobCount[label] > 1
      ? `${label} ${(jobIdx[label] = (jobIdx[label] ?? 0) + 1)}`
      : label;
    map[name] = finalLabel;
    if (id != null) idToLabel[id] = finalLabel;
  }

  const pidMap = (data.playerIds ?? data.player_ids) as Record<string, unknown> | undefined;
  if (pidMap && typeof pidMap === 'object' && !Array.isArray(pidMap)) {
    for (const [pname, pid] of Object.entries(pidMap)) {
      if (typeof pid !== 'number') continue;
      if (map[pname] != null || skip.has(pname)) continue;
      const lbl = idToLabel[pid];
      if (lbl != null) map[pname] = lbl;
    }
  }

  const bridgeEntry = (entry: AnyObj | undefined, nameKey: string) => {
    if (!entry) return;
    const pid = (entry as AnyObj).playerId;
    const nm = (entry as AnyObj)[nameKey];
    if (typeof pid === 'number' && typeof nm === 'string'
        && nm.length > 0 && map[nm] == null && !skip.has(nm)) {
      const lbl = idToLabel[pid];
      if (lbl != null) map[nm] = lbl;
    }
  };
  for (const h of arr(data.partyHpLog ?? data.party_hp_log)) bridgeEntry(h, 'player');
  for (const m of arr(data.partyMpLog ?? data.party_mp_log)) bridgeEntry(m, 'player');
  for (const t of arr(data.partyTpLog ?? data.party_tp_log)) bridgeEntry(t, 'player');
  for (const a of arr(data.actionLog ?? data.action_log)) bridgeEntry(a, 'player');

  const extra = new Set<string>();
  const add = (n: unknown) => { if (typeof n === 'string' && n && !map[n] && !skip.has(n)) extra.add(n); };
  for (const h of arr(data.partyHpLog ?? data.party_hp_log)) add(h.player);
  for (const m of arr(data.partyMpLog ?? data.party_mp_log)) add(m.player);
  for (const t of arr(data.partyTpLog ?? data.party_tp_log)) add(t.player);
  eachCombatPlayer(data, add);
  const harvest = (rep: AnyObj | null | undefined) => {
    if (!rep) return;
    for (const key of ['damageReport', 'wsAverages', 'wsAccuracy', 'accuracy', 'critRate', 'meleeAverage', 'meleeCritAverage']) {
      for (const e of arr(rep[key])) {
        const nm = e.name as string | undefined;
        const sc = typeof nm === 'string' ? nm.match(/^SC-(.+)$/) : null;
        add(sc ? sc[1] : nm);
      }
    }
  };
  const reports = (data.bossReports ?? data.boss_reports ?? data.enemyReports ?? data.enemy_reports) as Record<string, AnyObj> | undefined;
  for (const v of Object.values(reports ?? {})) harvest(v);
  harvest(data.aminon as AnyObj | undefined);
  add(data.localCharacter);
  const gbp = data.gearByPlayer as Record<string, unknown> | undefined;
  if (gbp && typeof gbp === 'object' && !Array.isArray(gbp)) {
    for (const k of Object.keys(gbp)) add(k);
  }
  for (const g of arr(data.gearLog)) add((g as AnyObj).player);
  // Encounter-shape positions (no-op on RunRecord shapes that lack these).
  for (const p of arr(data.partyPositionLog ?? data.party_position_log)) add((p as AnyObj).player);
  for (const d of arr(data.dropLog ?? data.drop_log)) add((d as AnyObj).by);
  for (const e of arr(data.deathLog ?? data.death_log)) add((e as AnyObj).player);
  for (const e of arr(data.itemUseLog ?? data.item_use_log)) add((e as AnyObj).player);
  for (const e of arr(data.petLog ?? data.pet_log)) add((e as AnyObj).owner);

  const seenInCombat = new Set<string>();
  eachCombatPlayer(data, (n) => seenInCombat.add(n));
  for (const a of arr(data.actionLog ?? data.action_log)) {
    const nm = (a as AnyObj).player;
    if (typeof nm === 'string') seenInCombat.add(nm);
  }
  const silentRoster = r.filter(x => !x.trust && !seenInCombat.has(x.name) && map[x.name] != null);
  const extrasInCombat = [...extra].filter(n => seenInCombat.has(n));
  if (silentRoster.length > 0 && silentRoster.length === extrasInCombat.length) {
    const exSorted = [...extrasInCombat].sort();
    for (let i = 0; i < silentRoster.length; i++) {
      const ex = exSorted[i];
      const ros = silentRoster[i];
      map[ex] = map[ros.name];
      extra.delete(ex);
    }
  }

  let n = jobIdx['Player'] ?? 0;
  for (const name of [...extra].sort()) { n += 1; map[name] = `Player ${n}`; }

  const ownerToPetNames: Record<string, Set<string>> = {};
  const addPetByOwner = (petName: unknown, ownerName: unknown) => {
    if (typeof petName !== 'string' || !petName) return;
    if (typeof ownerName !== 'string' || !ownerName) return;
    (ownerToPetNames[ownerName] ??= new Set()).add(petName);
  };
  for (const a of arr(data.actionLog ?? data.action_log)) {
    addPetByOwner((a as AnyObj).player, (a as AnyObj).actorPetOf);
    for (const t of arr((a as AnyObj).targets)) addPetByOwner((t as AnyObj).mob, (t as AnyObj).petOf);
  }
  for (const e of arr(data.petLog ?? data.pet_log)) addPetByOwner((e as AnyObj).pet, (e as AnyObj).owner);
  const petCountPerOwner: Record<string, number> = {};
  for (const [owner, pets] of Object.entries(ownerToPetNames)) {
    const ownerLabel = map[owner] ?? owner;
    for (const pet of pets) {
      if (map[pet] != null) continue;
      const idx = (petCountPerOwner[ownerLabel] = (petCountPerOwner[ownerLabel] ?? 0) + 1);
      map[pet] = pets.size > 1 ? `${ownerLabel}'s Pet ${idx}` : `${ownerLabel}'s Pet`;
    }
  }

  return map;
}

const MIN_SUBSTRING_LEN = 3;

function buildSubstringRegex(map: Record<string, string>): RegExp | null {
  const names = Object.keys(map)
    .filter(n => n.length >= MIN_SUBSTRING_LEN)
    .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (names.length === 0) return null;
  // Sort by length desc so "Aragorn" beats "Ara" when both are player names -
  // longer prefix replaced first under a single-pass regex.
  names.sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(${names.join('|')})\\b`, 'g');
}

function rewriteString(s: string, map: Record<string, string>, re: RegExp | null): string {
  // Rule 1: exact match
  if (map[s] != null) return map[s];
  // Rule 2: SC-<player> exact prefix
  if (s.startsWith('SC-')) {
    const inner = s.slice(3);
    if (map[inner] != null) return `SC-${map[inner]}`;
  }
  // Rule 3: substring (word-boundary)
  if (re) return s.replace(re, m => map[m] ?? m);
  return s;
}

function deepAnon(value: unknown, map: Record<string, string>, re: RegExp | null): unknown {
  if (typeof value === 'string') return rewriteString(value, map, re);
  if (Array.isArray(value)) return value.map(v => deepAnon(v, map, re));
  if (value && typeof value === 'object') {
    const out: AnyObj = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'rawText' || k === 'raw_text') { out[k] = ''; continue; }
      const nk = rewriteString(k, map, re);
      out[nk] = deepAnon(v, map, re);
    }
    return out;
  }
  return value;
}

export function anonymize<T>(data: T): T {
  const map = buildMap(data as AnyObj);
  if (Object.keys(map).length === 0) return data;
  const re = buildSubstringRegex(map);
  return deepAnon(data, map, re) as T;
}

const JOB_LABELS = new Set<string>([...Object.values(JOB_FULL_NAMES), ...Object.keys(JOB_FULL_NAMES)]);
function isOwnerAnonLabel(s: string): boolean {
  if (/^Player( \d+)?$/.test(s)) return true;
  if (JOB_LABELS.has(s)) return true;
  const m = s.match(/^(.+) \d+$/);
  return !!(m && JOB_LABELS.has(m[1]));
}
function isAnonLabel(s: string): boolean {
  if (isOwnerAnonLabel(s)) return true;
  const pet = s.match(/^(.+?)'s Pet(?: \d+)?$/);
  return !!(pet && isOwnerAnonLabel(pet[1]));
}

export function findPlayerLeaks(data: unknown): string[] {
  const d = data as AnyObj;

  // 1. Trusts pass through (they're NPCs with public names). Pre-compute
  //    the set so the deep walker can skip them in substring checks too.
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
  const harvestRep = (rep: AnyObj | null | undefined) => {
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
  for (const v of Object.values(reports ?? {})) harvestRep(v);
  harvestRep(d.aminon as AnyObj | undefined);
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
  // Additional UNAMBIGUOUS-player positions (mirror of buildMap above).
  for (const e of arr(d.deathLog ?? d.death_log)) seed((e as AnyObj).player);
  for (const e of arr(d.itemUseLog ?? d.item_use_log)) seed((e as AnyObj).player);
  for (const e of arr(d.petLog ?? d.pet_log)) { seed((e as AnyObj).owner); seed((e as AnyObj).pet); }
  for (const a of arr(d.actionLog ?? d.action_log)) {
    if ((a as AnyObj).actorPetOf || (a as AnyObj).actorRole === 'pet') seed((a as AnyObj).player);
    for (const t of arr((a as AnyObj).targets)) {
      if ((t as AnyObj).petOf || (t as AnyObj).tgtRole === 'pet') seed((t as AnyObj).mob);
    }
  }

  if (realNames.size === 0) return [];

  const namesArr = [...realNames].filter(n => n.length >= MIN_SUBSTRING_LEN);
  if (namesArr.length === 0) {
    // All player names are short - fall back to exact-only check.
    return findExactLeaks(d, realNames);
  }
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

// Fallback used only when all player names are too short for safe substring
// matching. Reduces to the original positional check.
function findExactLeaks(d: AnyObj, realNames: Set<string>): string[] {
  const leaks = new Set<string>();
  const check = (n: unknown) => {
    if (typeof n === 'string' && realNames.has(n)) leaks.add(n);
  };
  for (const p of arr(d.party)) check((p as AnyObj).name);
  for (const h of arr(d.partyHpLog ?? d.party_hp_log)) check(h.player);
  for (const m of arr(d.partyMpLog ?? d.party_mp_log)) check(m.player);
  for (const t of arr(d.partyTpLog ?? d.party_tp_log)) check(t.player);
  eachCombatPlayer(d, check);
  return [...leaks];
}
