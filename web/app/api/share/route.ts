import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import {
  CORS_HEADERS,
  adminClient,
  resolveUploader,
  shareDisabled,
  MAX_BYTES,
  MAX_DECOMPRESSED_BYTES,
} from '@/lib/share-server';
import { r2Delete } from '@/lib/r2';

async function resolveCaller(req: NextRequest): Promise<string | null> {
  if (req.headers.get('Authorization')?.startsWith('Bearer ')) {
    const who = await resolveUploader(req);
    if (who.userId) return who.userId;
  }
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  return NextResponse.json(
    {
      enabled: !shareDisabled(),
      retentionDays: 90,
      maxBytes: MAX_BYTES,
      maxDecompressedBytes: MAX_DECOMPRESSED_BYTES,
    },
    { headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=60' } },
  );
}

export async function DELETE(req: NextRequest) {
  const callerId = await resolveCaller(req);
  if (!callerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });
  }

  const id = req.nextUrl.searchParams.get('id');
  if (!id || !/^[a-f0-9]{8,64}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid or missing id' }, { status: 400, headers: CORS_HEADERS });
  }
  const objectPath = `${id}.json.gz`;

  const admin = adminClient();

  const { data: callerProfile } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', callerId)
    .maybeSingle();
  const isAdmin = (callerProfile as { is_admin?: boolean } | null)?.is_admin === true;

  const { data: row } = await admin
    .from('share_uploads')
    .select('id, user_id, object_path')
    .eq('object_path', objectPath)
    .maybeSingle();

  if (!row || (!isAdmin && row.user_id !== callerId)) {
    return NextResponse.json({ error: 'not found' }, { status: 404, headers: CORS_HEADERS });
  }

  try {
    await r2Delete(objectPath);
  } catch (e) {
    console.error('[share] R2 delete failed:', e instanceof Error ? e.message : String(e));
  }

  const { error: rowErr } = await admin.from('share_uploads').delete().eq('id', row.id);
  if (rowErr) {
    console.error('[share] row delete failed:', rowErr.message);
    return NextResponse.json({ error: 'delete failed' }, { status: 500, headers: CORS_HEADERS });
  }

  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}
