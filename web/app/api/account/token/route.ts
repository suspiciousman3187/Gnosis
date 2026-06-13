import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { randomBytes } from 'crypto';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET /api/account/token - fetch current token
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await adminClient()
    .from('profiles')
    .select('api_token')
    .eq('id', user.id)
    .single();

  return NextResponse.json({ token: data?.api_token ?? null });
}

// POST /api/account/token - generate a new token
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const newToken = randomBytes(32).toString('hex');

  const { error } = await adminClient()
    .from('profiles')
    .upsert({ id: user.id, api_token: newToken }, { onConflict: 'id' });

  if (error) return NextResponse.json({ error: 'Failed to update token' }, { status: 500 });
  return NextResponse.json({ token: newToken });
}
