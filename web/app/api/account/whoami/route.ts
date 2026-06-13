
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing Bearer token' }, { status: 401, headers: CORS_HEADERS });
  }
  const token = auth.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: 'Empty token' }, { status: 401, headers: CORS_HEADERS });
  }

  const admin = adminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('id, username, is_admin')
    .eq('api_token', token)
    .maybeSingle() as { data: { id: string; username: string | null; is_admin: boolean | null } | null };

  if (!profile) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401, headers: CORS_HEADERS });
  }

  let email: string | null = null;
  try {
    const { data: u } = await admin.auth.admin.getUserById(profile.id);
    email = u?.user?.email ?? null;
  } catch { /* email is optional */ }

  return NextResponse.json({
    id: profile.id,
    username: profile.username ?? null,
    email,
    isAdmin: profile.is_admin === true,
  }, { headers: CORS_HEADERS });
}
