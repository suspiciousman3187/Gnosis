import { createClient } from '@/lib/supabase/server';
import { createClient as adminClient } from '@supabase/supabase-js';
import NavBar from '@/components/NavBar';
import EncountersTable, { type ShareUpload } from '@/components/EncountersTable';

export default async function MyEncountersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const admin = adminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: profile } = await admin
    .from('profiles')
    .select('is_admin, username, avatar_url')
    .eq('id', user!.id)
    .maybeSingle();

  const isAdmin = (profile as { is_admin?: boolean } | null)?.is_admin ?? false;
  const username = (profile as { username?: string | null } | null)?.username ?? null;
  const avatarUrl = (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null;

  const { data: shares } = await admin
    .from('share_uploads')
    .select('object_path, created_at, content_kind, zone_name, party, duration_seconds, drops, enemy_names, is_private')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(200);

  const rows = (shares ?? []) as ShareUpload[];

  return (
    <div className="min-h-screen text-white">
      <NavBar isAdmin={isAdmin} username={username} avatarUrl={avatarUrl} />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="bg-surface border border-white/10 rounded-xl px-6 py-5 mb-5">
          <h1 className="text-2xl font-bold text-gray-100">My Encounters</h1>
          <p className="text-sm text-gray-400 mt-1">{username ?? user!.email}</p>
        </div>
        <EncountersTable rows={rows} />
      </main>
    </div>
  );
}
