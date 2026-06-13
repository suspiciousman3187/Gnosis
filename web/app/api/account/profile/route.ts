import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import type { CharacterEntry } from '@/lib/types';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function resolveUser(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const { data } = await adminClient()
      .from('profiles')
      .select('id')
      .eq('api_token', token)
      .single();
    return data?.id ?? null;
  }
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// GET /api/account/profile - return current user's profile
export async function GET(req: NextRequest) {
  const userId = await resolveUser(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await adminClient()
    .from('profiles')
    .select('id, username, bio, avatar_url, characters, is_admin, anonymous, theme, verification_character, verification_server, verification_price, verification_item, verification_expires_at')
    .eq('id', userId)
    .single();

  if (error) return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });

  return NextResponse.json(data);
}

// PATCH /api/account/profile - update username, bio, characters
export async function PATCH(req: NextRequest) {
  const userId = await resolveUser(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  const { data: profileRow } = await adminClient().from('profiles').select('characters').eq('id', userId).single();

  if ('username' in body) {
    const username = body.username;
    if (username !== null) {
      if (typeof username !== 'string' || !/^[a-z0-9_]{3,30}$/.test(username)) {
        return NextResponse.json(
          { error: 'Username must be 3–30 lowercase letters, digits, or underscores' },
          { status: 400 }
        );
      }
      // Check uniqueness
      const { data: existing } = await adminClient()
        .from('profiles')
        .select('id')
        .eq('username', username)
        .neq('id', userId)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
      }
    }
    updates.username = username;
  }

  if ('bio' in body) {
    const bio = body.bio;
    if (bio !== null && typeof bio !== 'string') {
      return NextResponse.json({ error: 'Invalid bio' }, { status: 400 });
    }
    updates.bio = bio ? bio.slice(0, 500) : null;
  }

  if ('characters' in body) {
    const chars = body.characters;
    if (!Array.isArray(chars)) {
      return NextResponse.json({ error: 'characters must be an array' }, { status: 400 });
    }
    // Use already-fetched profile to preserve verified status (client cannot set verified=true)
    const currentChars: CharacterEntry[] = Array.isArray(profileRow?.characters) ? profileRow.characters as CharacterEntry[] : [];
    const verifiedKeys = new Set(
      currentChars
        .filter((c) => c.verified)
        .map((c) => `${c.name.toLowerCase()}|${c.server.toLowerCase()}`)
    );
    const cleaned: CharacterEntry[] = [];
    for (const c of chars) {
      if (typeof c?.name !== 'string' || typeof c?.server !== 'string') continue;
      const name = c.name.trim().slice(0, 32);
      const server = c.server.trim().slice(0, 32);
      const entry: CharacterEntry = { name, server };
      if (verifiedKeys.has(`${name.toLowerCase()}|${server.toLowerCase()}`)) {
        entry.verified = true;
      }
      cleaned.push(entry);
    }
    updates.characters = cleaned;
  }

  if ('theme' in body) {
    const validThemes = ['default', 'dusk', 'teal', 'crimson'];
    if (!validThemes.includes(body.theme)) {
      return NextResponse.json({ error: 'Invalid theme' }, { status: 400 });
    }
    updates.theme = body.theme;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { error } = await adminClient()
    .from('profiles')
    .update(updates)
    .eq('id', userId);

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
