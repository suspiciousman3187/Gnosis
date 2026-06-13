import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { r2GetBuffer } from '@/lib/r2';
import { validatePayload } from '@/lib/share-server';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function requireAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { admin: null as null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const { data } = await adminClient()
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (!(data as { is_admin?: boolean } | null)?.is_admin) {
    return { admin: null as null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { admin: adminClient(), error: null };
}

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const admin = gate.admin;

  const batchSize = Math.min(Number(req.nextUrl.searchParams.get('batch') ?? '25'), 50);

  const { data: rows, error: selErr } = await admin
    .from('share_uploads')
    .select('id, object_path, blob_deleted')
    .is('enemy_names', null)
    .eq('blob_deleted', false)
    .order('created_at', { ascending: false })
    .limit(batchSize);

  if (selErr) {
    return NextResponse.json({ error: 'select failed', detail: selErr.message }, { status: 500 });
  }

  const result = { scanned: rows?.length ?? 0, updated: 0, missing: 0, errored: 0, exhausted: false };
  if (!rows || rows.length === 0) {
    result.exhausted = true;
    return NextResponse.json(result);
  }

  for (const row of rows) {
    try {
      const buf = await r2GetBuffer(row.object_path);
      const v = await validatePayload(buf);
      const names = v.meta?.enemy_names ?? null;
      const { error: upErr } = await admin
        .from('share_uploads')
        .update({ enemy_names: names ?? [] })
        .eq('id', row.id);
      if (upErr) {
        result.errored++;
      } else {
        result.updated++;
      }
    } catch {
      result.missing++;
      await admin
        .from('share_uploads')
        .update({ enemy_names: [] })
        .eq('id', row.id);
    }
  }

  result.exhausted = rows.length < batchSize;
  return NextResponse.json(result);
}
