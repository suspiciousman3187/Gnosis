import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'forest-diagnostics';
const MAX_BYTES = 25 * 1024 * 1024;
const IP_HOURLY_LIMIT = 12;
const IP_DAILY_LIMIT = 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Forest-Version, X-Forest-Label, X-Forest-Timestamp, X-Forest-Signature',
  'Access-Control-Max-Age': '86400',
};

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function sanitizeLabel(raw: string): string {
  let s = (raw || '').trim();
  if (!s) s = 'unnamed';
  s = s.replace(/[^A-Za-z0-9._\- ]/g, '').replace(/\s+/g, '-');
  if (s.length > 60) s = s.slice(0, 60);
  if (!s) s = 'unnamed';
  return s;
}

function getIp(req: NextRequest): string {
  return (req.headers.get('x-forwarded-for')?.split(',')[0].trim()
       || req.headers.get('x-real-ip')
       || 'unknown');
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const secret = process.env.FOREST_DIAG_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'server not configured' }, { status: 503, headers: CORS });
  }

  const label = sanitizeLabel(req.headers.get('X-Forest-Label') || '');
  const ts = (req.headers.get('X-Forest-Timestamp') || '').trim();
  const version = (req.headers.get('X-Forest-Version') || '').trim().slice(0, 32);
  const sig = (req.headers.get('X-Forest-Signature') || '').trim().toLowerCase();

  if (!ts || !version || !sig || !/^[a-f0-9]{64}$/.test(sig)) {
    return NextResponse.json({ ok: false, error: 'missing headers' }, { status: 400, headers: CORS });
  }

  const tsMatch = /^(\d{8})-(\d{6})$/.exec(ts);
  if (!tsMatch) {
    return NextResponse.json({ ok: false, error: 'bad timestamp' }, { status: 400, headers: CORS });
  }
  const tsDate = Date.UTC(
    Number(tsMatch[1].slice(0, 4)), Number(tsMatch[1].slice(4, 6)) - 1, Number(tsMatch[1].slice(6, 8)),
    Number(tsMatch[2].slice(0, 2)), Number(tsMatch[2].slice(2, 4)), Number(tsMatch[2].slice(4, 6)),
  );
  const skew = Math.abs(Date.now() - tsDate);
  if (skew > 1000 * 60 * 60 * 24) {
    return NextResponse.json({ ok: false, error: 'timestamp skew' }, { status: 400, headers: CORS });
  }

  const ctype = (req.headers.get('content-type') || '').toLowerCase();
  if (!ctype.startsWith('application/zip')) {
    return NextResponse.json({ ok: false, error: 'expected application/zip' }, { status: 400, headers: CORS });
  }

  const body = Buffer.from(await req.arrayBuffer());
  if (body.length === 0) {
    return NextResponse.json({ ok: false, error: 'empty body' }, { status: 400, headers: CORS });
  }
  if (body.length > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: `too large (${body.length} > ${MAX_BYTES})` }, { status: 413, headers: CORS });
  }

  const header = Buffer.from(`${label}|${ts}|${version}|`, 'utf8');
  const expected = createHmac('sha256', secret).update(header).update(body).digest();
  const provided = Buffer.from(sig, 'hex');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return NextResponse.json({ ok: false, error: 'bad signature' }, { status: 401, headers: CORS });
  }

  const ip = getIp(req);
  const db = admin();

  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const dayAgo  = new Date(Date.now() - 86_400_000).toISOString();
  const [{ count: hourCount }, { count: dayCount }] = await Promise.all([
    db.from('forest_diagnostics_uploads').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', hourAgo),
    db.from('forest_diagnostics_uploads').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', dayAgo),
  ]);
  if ((hourCount ?? 0) >= IP_HOURLY_LIMIT || (dayCount ?? 0) >= IP_DAILY_LIMIT) {
    return NextResponse.json({ ok: false, error: 'rate limit exceeded' }, { status: 429, headers: CORS });
  }

  const stamp = ts;
  const rnd = randomBytes(4).toString('hex');
  const objectPath = `${label}__${stamp}__${rnd}.zip`;

  const up = await db.storage.from(BUCKET).upload(objectPath, body, {
    contentType: 'application/zip',
    upsert: false,
  });
  if (up.error) {
    console.error('[forest-diag] storage upload failed:', up.error.message);
    return NextResponse.json({ ok: false, error: 'storage upload failed' }, { status: 500, headers: CORS });
  }

  const ins = await db.from('forest_diagnostics_uploads').insert({
    object_path: objectPath,
    label,
    forest_version: version,
    ip,
    size_bytes: body.length,
  }).select('id').single();
  if (ins.error) {
    console.error('[forest-diag] row insert failed:', ins.error.message);
    try { await db.storage.from(BUCKET).remove([objectPath]); } catch {}
    return NextResponse.json({ ok: false, error: 'row insert failed' }, { status: 500, headers: CORS });
  }

  return NextResponse.json({
    ok: true,
    id: objectPath,
    label,
    size: body.length,
  }, { headers: CORS });
}
