import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

export const MAX_BYTES = 16 * 1024 * 1024;
export const MAX_DECOMPRESSED_BYTES = 100 * 1024 * 1024;

const TOKEN_LIMIT_PER_HOUR = 20;
const TOKEN_LIMIT_PER_DAY  = 100;
const IP_LIMIT_PER_HOUR    = 5;
const IP_LIMIT_PER_DAY     = 20;

export function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export function shareDisabled(): boolean {
  const v = process.env.SHARE_DISABLED;
  return v === '1' || v === 'true';
}

export async function resolveUploader(req: NextRequest): Promise<{ userId: string | null; ip: string }> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const { data } = await adminClient()
      .from('profiles')
      .select('id')
      .eq('api_token', token)
      .single();
    if (data?.id) return { userId: data.id, ip };
  }
  return { userId: null, ip };
}

async function countRecentUploads(
  admin: SupabaseClient,
  windowMs: number,
  by: { userId: string | null; ip: string },
): Promise<number | null> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const q = admin
    .from('share_uploads')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since);
  const { count, error } = by.userId
    ? await q.eq('user_id', by.userId)
    : await q.is('user_id', null).eq('ip', by.ip);
  if (error) {
    console.error('[share] rate count failed:', error.message);
    return null;
  }
  return count ?? 0;
}

export async function rateLimitGuard(
  admin: SupabaseClient,
  by: { userId: string | null; ip: string },
): Promise<NextResponse | null> {
  const hourCount = await countRecentUploads(admin, 60 * 60 * 1000, by);
  const dayCount  = await countRecentUploads(admin, 24 * 60 * 60 * 1000, by);
  if (hourCount == null || dayCount == null) {
    return NextResponse.json(
      { error: 'Share rate counter unavailable; try again shortly.' },
      { status: 503, headers: { ...CORS_HEADERS, 'Retry-After': '60' } },
    );
  }
  const hourCap = by.userId ? TOKEN_LIMIT_PER_HOUR : IP_LIMIT_PER_HOUR;
  const dayCap  = by.userId ? TOKEN_LIMIT_PER_DAY  : IP_LIMIT_PER_DAY;
  if (hourCount >= hourCap) {
    return NextResponse.json(
      { error: `Share rate limit reached (${hourCap}/hour). Try again later.` },
      { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': '600' } },
    );
  }
  if (dayCount >= dayCap) {
    return NextResponse.json(
      { error: `Daily share limit reached (${dayCap}/day). Try again tomorrow.` },
      { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': '21600' } },
    );
  }
  return null;
}

export type ShareMeta = {
  content_kind: string;
  zone_name: string | null;
  party: { name: string; job: string }[] | null;
  duration_seconds: number | null;
  drops: { name: string; count: number }[] | null;
  enemy_names: string[] | null;
};

const MAX_DROPS_STORED = 50;
const MAX_ENEMY_NAMES_STORED = 100;

export async function validatePayload(buf: ArrayBuffer): Promise<{ ok: boolean; reason?: string; meta?: ShareMeta; parsed?: Record<string, unknown> }> {
  if (buf.byteLength === 0) return { ok: false, reason: 'empty payload' };
  if (buf.byteLength > MAX_BYTES) return { ok: false, reason: `payload too large (${buf.byteLength} > ${MAX_BYTES})` };
  const bytes = new Uint8Array(buf);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    return { ok: false, reason: 'not a gzip stream' };
  }
  let json: string;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    json = await new Response(stream).text();
  } catch {
    return { ok: false, reason: 'gzip decompress failed' };
  }
  if (json.length > MAX_DECOMPRESSED_BYTES) return { ok: false, reason: 'decompressed payload too large' };
  let payload: unknown;
  try { payload = JSON.parse(json); } catch { return { ok: false, reason: 'not valid JSON' }; }
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'payload is not an object' };
  const p = payload as Record<string, unknown>;
  if (typeof p.v !== 'number') return { ok: false, reason: 'missing v' };
  const content = p.content as Record<string, unknown> | undefined;
  if (!content || typeof content !== 'object') return { ok: false, reason: 'missing content' };
  if (typeof content.kind !== 'string') return { ok: false, reason: 'missing content.kind' };
  const KINDS = new Set(['encounter', 'sortie']);
  if (!KINDS.has(content.kind)) return { ok: false, reason: `unknown content.kind: ${content.kind}` };

  const meta = extractMeta(content);
  return { ok: true, meta, parsed: p };
}

export type AnalyticsRow = {
  ts_elapsed: number | null;
  zone_name: string | null;
  target_mob: string | null;
  actor_main_job: string | null;
  actor_sub_job: string | null;
  actor_main_lvl: number | null;
  actor_sub_lvl: number | null;
  category: string | null;
  ability_name: string | null;
  damage: number | null;
  result: string | null;
  weapon_main: string | null;
  active_buffs: number[] | null;
  quality: 'ok' | 'flagged_implausible';
};

const KNOWN_JOBS = new Set([
  'WAR','MNK','WHM','BLM','RDM','THF','PLD','DRK','BST','BRD','RNG','SAM',
  'NIN','DRG','SMN','BLU','COR','PUP','DNC','SCH','GEO','RUN',
  '?','',
]);
const KNOWN_CATEGORIES = new Set(['ws','ja','spell','mb','melee','ranged','enfeeb','mob_ability']);
const KNOWN_RESULTS = new Set(['hit','miss','crit','resist','land','burst']);
const MAX_SANE_DAMAGE = 999_999;
const MAX_ACTIONS_PER_ENCOUNTER = 100_000;

function asString(v: unknown): string | null { return typeof v === 'string' ? v : null; }
function asNumber(v: unknown): number | null { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

type GearEntry = { elapsed: number; player: string; name: string; gear?: { main?: { name?: string } | null } | null; precast?: { main?: { name?: string } | null } | null };
type BuffEvent = { elapsed: number; target: string; buffId: number; kind: 'gain' | 'wear' };

function buildGearLookup(root: Record<string, unknown>): (player: string, name: string, elapsed: number) => string | null {
  const flat: GearEntry[] = [];
  const gearLog = Array.isArray(root.gearLog) ? root.gearLog : Array.isArray(root.gear_log) ? root.gear_log : null;
  if (Array.isArray(gearLog)) {
    for (const g of gearLog) {
      if (g && typeof g === 'object') flat.push(g as GearEntry);
    }
  }
  const gearByPlayer = root.gearByPlayer ?? root.gear_by_player;
  if (gearByPlayer && typeof gearByPlayer === 'object') {
    for (const [, ch] of Object.entries(gearByPlayer as Record<string, unknown>)) {
      const chLog = (ch as { gearLog?: unknown })?.gearLog;
      if (Array.isArray(chLog)) {
        for (const g of chLog) if (g && typeof g === 'object') flat.push(g as GearEntry);
      }
    }
  }
  if (flat.length === 0) return () => null;

  const byPK = new Map<string, GearEntry[]>();
  for (const g of flat) {
    if (!g.player || !g.name) continue;
    const k = `${g.player}|${g.name}`;
    let arr = byPK.get(k);
    if (!arr) { arr = []; byPK.set(k, arr); }
    arr.push(g);
  }
  for (const arr of byPK.values()) arr.sort((a, b) => a.elapsed - b.elapsed);

  return (player, name, elapsed) => {
    const arr = byPK.get(`${player}|${name}`);
    if (!arr) return null;
    let best: GearEntry | null = null;
    let bestD = Infinity;
    for (const g of arr) {
      const d = Math.abs(g.elapsed - elapsed);
      if (d < bestD) { best = g; bestD = d; }
    }
    if (!best) return null;
    return best.gear?.main?.name ?? best.precast?.main?.name ?? null;
  };
}

function buildBuffReplay(root: Record<string, unknown>): (target: string, elapsed: number) => number[] | null {
  const buffLog = Array.isArray(root.buffLog) ? root.buffLog : Array.isArray(root.buff_log) ? root.buff_log : null;
  if (!Array.isArray(buffLog) || buffLog.length === 0) return () => null;

  const byTarget = new Map<string, BuffEvent[]>();
  for (const raw of buffLog) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const t = asString(e.target);
    const k = asString(e.kind);
    const id = asNumber(e.buffId) ?? asNumber(e.buff_id);
    const ts = asNumber(e.elapsed);
    if (!t || !id || ts == null || (k !== 'gain' && k !== 'wear')) continue;
    let arr = byTarget.get(t);
    if (!arr) { arr = []; byTarget.set(t, arr); }
    arr.push({ elapsed: ts, target: t, buffId: id, kind: k });
  }
  for (const arr of byTarget.values()) arr.sort((a, b) => a.elapsed - b.elapsed);

  return (target, elapsed) => {
    const arr = byTarget.get(target);
    if (!arr) return null;
    const active = new Set<number>();
    for (const ev of arr) {
      if (ev.elapsed > elapsed) break;
      if (ev.kind === 'gain') active.add(ev.buffId);
      else active.delete(ev.buffId);
    }
    return active.size > 0 ? [...active].sort((a, b) => a - b) : [];
  };
}

export function extractAnalytics(parsed: Record<string, unknown>, fallbackZone: string | null): AnalyticsRow[] {
  const content = parsed.content as Record<string, unknown> | undefined;
  if (!content) return [];
  const root = (content.encounter ?? content.record ?? content) as Record<string, unknown>;

  const partyArr = Array.isArray(root.party) ? root.party as Record<string, unknown>[] : [];
  const party = new Map<string, { main: string | null; sub: string | null; mainLvl: number | null; subLvl: number | null }>();
  for (const p of partyArr) {
    const name = asString(p.name);
    if (!name) continue;
    party.set(name, {
      main:    asString(p.mainJob) ?? asString(p.main_job) ?? asString(p.main),
      sub:     asString(p.subJob)  ?? asString(p.sub_job)  ?? asString(p.sub),
      mainLvl: asNumber(p.mainLevel) ?? asNumber(p.main_level),
      subLvl:  asNumber(p.subLevel)  ?? asNumber(p.sub_level),
    });
  }

  const zone = (asString(root.zoneName) ?? asString(root.zone_name) ?? fallbackZone) || null;
  const actionLog = (Array.isArray(root.actionLog) ? root.actionLog
                   : Array.isArray(root.action_log) ? root.action_log
                   : []) as Record<string, unknown>[];
  const lookupWeapon = buildGearLookup(root);
  const replayBuffs = buildBuffReplay(root);

  function gradeRow(r: Omit<AnalyticsRow, 'quality'>): AnalyticsRow['quality'] {
    if (r.actor_main_job && !KNOWN_JOBS.has(r.actor_main_job.toUpperCase())) return 'flagged_implausible';
    if (r.actor_sub_job  && !KNOWN_JOBS.has(r.actor_sub_job.toUpperCase()))  return 'flagged_implausible';
    if (r.actor_main_lvl != null && (r.actor_main_lvl < 1 || r.actor_main_lvl > 99)) return 'flagged_implausible';
    if (r.actor_sub_lvl  != null && (r.actor_sub_lvl  < 1 || r.actor_sub_lvl  > 99)) return 'flagged_implausible';
    if (r.category && !KNOWN_CATEGORIES.has(r.category)) return 'flagged_implausible';
    if (r.result   && !KNOWN_RESULTS.has(r.result))      return 'flagged_implausible';
    if (r.damage != null && (r.damage < 0 || r.damage > MAX_SANE_DAMAGE)) return 'flagged_implausible';
    if (r.ts_elapsed != null && r.ts_elapsed < 0) return 'flagged_implausible';
    return 'ok';
  }

  const rows: AnalyticsRow[] = [];
  for (const a of actionLog) {
    if (rows.length >= MAX_ACTIONS_PER_ENCOUNTER) break;

    const actorName = asString(a.player) ?? asString(a.actor) ?? asString(a.name);
    const fromMe = asString(a.from);
    if (fromMe && fromMe !== 'player') continue;
    if (!actorName) continue;
    const job = party.get(actorName);
    if (!job) continue;

    const category = asString(a.category) ?? asString(a.type);
    const abilityName = asString(a.name) ?? asString(a.ability);
    if (!category || !abilityName) continue;

    const ts = asNumber(a.elapsed) ?? asNumber(a.ts);

    const weaponMain = ts != null ? lookupWeapon(actorName, abilityName, ts) : null;
    const activeBuffs = ts != null ? replayBuffs(actorName, ts) : null;

    const base = {
      ts_elapsed: ts,
      zone_name: zone,
      actor_main_job: job.main,
      actor_sub_job:  job.sub,
      actor_main_lvl: job.mainLvl,
      actor_sub_lvl:  job.subLvl,
      category,
      ability_name: abilityName,
      weapon_main: weaponMain,
      active_buffs: activeBuffs,
    };

    const targets = Array.isArray(a.targets) ? a.targets as Record<string, unknown>[] : null;
    if (targets && targets.length) {
      for (const t of targets) {
        if (rows.length >= MAX_ACTIONS_PER_ENCOUNTER) break;
        const row = {
          ...base,
          target_mob: asString(t.mob),
          damage: asNumber(t.damage),
          result: asString(t.result),
        };
        rows.push({ ...row, quality: gradeRow(row) });
      }
    } else {
      const row = {
        ...base,
        target_mob: asString(a.mob),
        damage: asNumber(a.damage),
        result: asString(a.result),
      };
      rows.push({ ...row, quality: gradeRow(row) });
    }
  }

  return rows;
}

export function extractMeta(content: Record<string, unknown>): ShareMeta {
  const kind = content.kind as string;
  const root = (content.encounter ?? content.record ?? content) as Record<string, unknown>;
  let zone_name = (root.zoneName ?? root.zone_name ?? null) as string | null;
  if (!zone_name && kind === 'sortie') zone_name = "Outer Ra'Kaznar";

  const rawParty = Array.isArray(root.party) ? root.party as Record<string, unknown>[] : [];
  const party = rawParty
    .map(p => {
      const name = typeof p?.name === 'string' ? p.name : null;
      const job = (typeof p?.mainJob === 'string' ? p.mainJob :
                   typeof p?.main_job === 'string' ? p.main_job :
                   typeof p?.job === 'string' ? p.job : '') as string;
      return name ? { name, job } : null;
    })
    .filter((x): x is { name: string; job: string } => x !== null);

  let duration_seconds: number | null = null;
  if (typeof root.durationSeconds === 'number') duration_seconds = root.durationSeconds;
  else if (typeof root.total_seconds === 'number') duration_seconds = root.total_seconds;
  else if (root.area_times && typeof root.area_times === 'object') {
    duration_seconds = Object.values(root.area_times as Record<string, unknown>)
      .reduce<number>((s, v) => s + (typeof v === 'number' ? v : 0), 0);
  }

  const rawDrops = Array.isArray(root.dropLog) ? root.dropLog as Record<string, unknown>[]
                 : Array.isArray(root.drop_log) ? root.drop_log as Record<string, unknown>[]
                 : null;
  let drops: { name: string; count: number }[] | null = null;
  if (rawDrops?.length) {
    const tally = new Map<string, number>();
    for (const d of rawDrops) {
      const name = typeof d?.name === 'string' ? d.name.trim() : '';
      if (!name) continue;
      const c = typeof d?.count === 'number' && d.count > 0 ? d.count : 1;
      tally.set(name, (tally.get(name) ?? 0) + c);
    }
    drops = [...tally.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, MAX_DROPS_STORED);
  }

  const enemies = new Set<string>();
  const addName = (n: unknown) => {
    if (typeof n !== 'string') return;
    const t = n.trim();
    if (t.length > 0 && t.length <= 64) enemies.add(t);
  };
  for (const e of Array.isArray(root.enemies) ? root.enemies as Record<string, unknown>[] : []) addName(e?.name);
  for (const k of Array.isArray(root.killLog) ? root.killLog as Record<string, unknown>[]
                 : Array.isArray(root.kill_log) ? root.kill_log as Record<string, unknown>[] : []) addName(k?.name);
  for (const b of Array.isArray(root.bossHpLog) ? root.bossHpLog as Record<string, unknown>[]
                 : Array.isArray(root.boss_hp_log) ? root.boss_hp_log as Record<string, unknown>[] : []) addName(b?.name);
  for (const n of Array.isArray(root.defeated_bosses) ? root.defeated_bosses as unknown[] : []) addName(n);
  const reports = (root.boss_reports ?? root.bossReports) as Record<string, unknown> | undefined;
  if (reports && typeof reports === 'object' && !Array.isArray(reports)) {
    for (const k of Object.keys(reports)) addName(k);
  }
  for (const m of Array.isArray(root.mini_nm_log) ? root.mini_nm_log as Record<string, unknown>[]
                 : Array.isArray(root.miniNmLog) ? root.miniNmLog as Record<string, unknown>[] : []) addName(m?.name);
  if (root.aminon && typeof root.aminon === 'object' && !Array.isArray(root.aminon)) addName('Aminon');
  const enemy_names = enemies.size
    ? [...enemies].sort((a, b) => a.localeCompare(b)).slice(0, MAX_ENEMY_NAMES_STORED)
    : null;

  return {
    content_kind: kind,
    zone_name,
    party: party.length ? party : null,
    duration_seconds,
    drops: drops?.length ? drops : null,
    enemy_names,
  };
}
