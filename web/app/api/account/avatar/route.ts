import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function resolveUser(req: NextRequest): Promise<string | null> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// POST /api/account/avatar - upload avatar image, store in Supabase Storage
export async function POST(req: NextRequest) {
  const userId = await resolveUser(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  const f = file as File;

  // Validate type and size
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(f.type)) {
    return NextResponse.json({ error: 'Only JPEG, PNG, GIF, or WebP images allowed' }, { status: 400 });
  }
  if (f.size > 2 * 1024 * 1024) {
    return NextResponse.json({ error: 'Image must be under 2 MB' }, { status: 400 });
  }

  const ext = f.type.split('/')[1].replace('jpeg', 'jpg');
  const path = `${userId}/avatar.${ext}`;

  const admin = adminClient();

  // Remove old avatars for this user (any extension)
  const { data: existing } = await admin.storage.from('avatars').list(userId);
  if (existing && existing.length > 0) {
    await admin.storage.from('avatars').remove(existing.map((o) => `${userId}/${o.name}`));
  }

  const bytes = await f.arrayBuffer();
  const { error: uploadError } = await admin.storage
    .from('avatars')
    .upload(path, bytes, { contentType: f.type, upsert: true });

  if (uploadError) {
    console.error('Avatar upload error:', uploadError);
    const msg = uploadError.message || 'unknown error';
    const isMissingBucket = /bucket.*not.*found|not found/i.test(msg);
    return NextResponse.json(
      { error: isMissingBucket
          ? 'Avatars storage bucket missing - create the "avatars" bucket in Supabase Storage (see schema.sql v6.0 block).'
          : `Storage upload failed: ${msg}` },
      { status: 500 },
    );
  }

  const { data: urlData } = admin.storage.from('avatars').getPublicUrl(path);
  const avatarUrl = urlData.publicUrl;

  const { data: updated, error: dbError } = await admin
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('id', userId)
    .select('id');

  if (dbError) {
    console.error('Avatar DB update error:', dbError);
    return NextResponse.json({ error: `Failed to save avatar URL: ${dbError.message}` }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    const { error: upsertError } = await admin
      .from('profiles')
      .upsert({ id: userId, avatar_url: avatarUrl }, { onConflict: 'id' });
    if (upsertError) {
      console.error('Avatar profile upsert error:', upsertError);
      return NextResponse.json({ error: `Failed to save avatar URL: ${upsertError.message}` }, { status: 500 });
    }
  }

  return NextResponse.json({ avatar_url: avatarUrl });
}

// DELETE /api/account/avatar - remove avatar
export async function DELETE(req: NextRequest) {
  const userId = await resolveUser(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = adminClient();

  const { data: existing } = await admin.storage.from('avatars').list(userId);
  if (existing && existing.length > 0) {
    await admin.storage.from('avatars').remove(existing.map((o) => `${userId}/${o.name}`));
  }

  await admin.from('profiles').update({ avatar_url: null }).eq('id', userId);

  return new NextResponse(null, { status: 204 });
}
