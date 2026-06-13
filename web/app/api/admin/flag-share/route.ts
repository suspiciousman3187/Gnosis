
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

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

function parseId(req: NextRequest): { id: string; objectPath: string } | NextResponse {
  const id = req.nextUrl.searchParams.get('id');
  if (!id || !/^[a-f0-9]{8,64}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid or missing id' }, { status: 400 });
  }
  return { id, objectPath: `${id}.json.gz` };
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const admin = gate.admin;

  const idOrErr = parseId(req);
  if (idOrErr instanceof NextResponse) return idOrErr;
  const { id, objectPath } = idOrErr;

  let reason: string | null = null;
  try {
    const body = await req.json() as { reason?: unknown };
    if (typeof body?.reason === 'string') reason = body.reason.slice(0, 500);
  } catch { /* no body, that's fine */ }

  // Update the parent share row + cascade-update analytics children.
  const { data: row, error: rowErr } = await admin
    .from('share_uploads')
    .update({ flagged_at: new Date().toISOString(), flagged_reason: reason })
    .eq('object_path', objectPath)
    .select('id')
    .single();
  if (rowErr || !row) {
    return NextResponse.json({ error: 'share not found' }, { status: 404 });
  }

  const { error: aErr } = await admin
    .from('analytics_actions')
    .update({ quality: 'flagged_manual' })
    .eq('share_id', row.id);
  if (aErr) console.error('[admin/flag-share] analytics quality update failed:', aErr.message);

  return NextResponse.json({ ok: true, id, action: 'flagged', reason });
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const admin = gate.admin;

  const idOrErr = parseId(req);
  if (idOrErr instanceof NextResponse) return idOrErr;
  const { id, objectPath } = idOrErr;

  const { data: row, error: rowErr } = await admin
    .from('share_uploads')
    .update({ flagged_at: null, flagged_reason: null })
    .eq('object_path', objectPath)
    .select('id')
    .single();
  if (rowErr || !row) {
    return NextResponse.json({ error: 'share not found' }, { status: 404 });
  }

  const { error: aErr } = await admin
    .from('analytics_actions')
    .update({ quality: 'ok' })
    .eq('share_id', row.id)
    // Only revert manual flags; leave 'flagged_implausible' as-is since
    // those are signal from the validation gate, not human judgement.
    .eq('quality', 'flagged_manual');
  if (aErr) console.error('[admin/flag-share] analytics quality revert failed:', aErr.message);

  return NextResponse.json({ ok: true, id, action: 'unflagged' });
}
