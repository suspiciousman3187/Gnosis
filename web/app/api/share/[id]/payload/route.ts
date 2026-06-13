import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { adminClient, CORS_HEADERS } from '@/lib/share-server';
import { r2GetBuffer } from '@/lib/r2';

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[a-f0-9]{8,64}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400, headers: CORS_HEADERS });
  }

  const objectPath = `${id}.json.gz`;
  const admin = adminClient();

  const { data: row } = await admin
    .from('share_uploads')
    .select('id, user_id, is_private, blob_deleted')
    .eq('object_path', objectPath)
    .maybeSingle();

  if (row?.blob_deleted) {
    return NextResponse.json({ error: 'expired' }, { status: 410, headers: CORS_HEADERS });
  }

  if (row?.is_private) {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    let isAdmin = false;
    if (user) {
      const { data: profile } = await admin
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .maybeSingle();
      isAdmin = (profile as { is_admin?: boolean } | null)?.is_admin === true;
    }

    if (!user || (user.id !== row.user_id && !isAdmin)) {
      return NextResponse.json({ error: 'private' }, { status: 403, headers: CORS_HEADERS });
    }
  }

  let buf: ArrayBuffer;
  try {
    buf = await r2GetBuffer(objectPath);
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404, headers: CORS_HEADERS });
  }

  return new NextResponse(buf, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/gzip',
      'Cache-Control': row?.is_private ? 'private, max-age=60' : 'public, max-age=31536000, immutable',
    },
  });
}
