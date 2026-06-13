import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { adminClient, CORS_HEADERS, resolveUploader } from '@/lib/share-server';

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

async function resolveCaller(req: NextRequest): Promise<string | null> {
  if (req.headers.get('Authorization')?.startsWith('Bearer ')) {
    const who = await resolveUploader(req);
    if (who.userId) return who.userId;
  }
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[a-f0-9]{8,64}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400, headers: CORS_HEADERS });
  }

  let body: { private?: unknown } | null = null;
  try {
    body = await req.json() as { private?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400, headers: CORS_HEADERS });
  }
  if (typeof body.private !== 'boolean') {
    return NextResponse.json({ error: 'body.private must be boolean' }, { status: 400, headers: CORS_HEADERS });
  }
  const wantsPrivate = body.private;

  const callerId = await resolveCaller(req);
  if (!callerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });
  }

  const admin = adminClient();

  const { data: callerProfile } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', callerId)
    .maybeSingle();
  const isAdmin = (callerProfile as { is_admin?: boolean } | null)?.is_admin === true;

  const objectPath = `${id}.json.gz`;
  const { data: row } = await admin
    .from('share_uploads')
    .select('id, user_id')
    .eq('object_path', objectPath)
    .maybeSingle();

  if (!row || (!isAdmin && row.user_id !== callerId)) {
    return NextResponse.json({ error: 'not found' }, { status: 404, headers: CORS_HEADERS });
  }

  const { error: updateErr } = await admin
    .from('share_uploads')
    .update({ is_private: wantsPrivate })
    .eq('id', row.id);

  if (updateErr) {
    console.error('[share] privacy update failed:', updateErr.message);
    return NextResponse.json({ error: 'update failed' }, { status: 500, headers: CORS_HEADERS });
  }

  return NextResponse.json({ ok: true, isPrivate: wantsPrivate }, { headers: CORS_HEADERS });
}
