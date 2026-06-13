import { createClient } from '@/lib/supabase/server';
import { createClient as adminClient } from '@supabase/supabase-js';
import NavBar from '@/components/NavBar';
import SettingsForm from '@/components/SettingsForm';

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let isAdmin = false;
  let username: string | null = null;
  let avatarUrl: string | null = null;
  if (user) {
    const admin = adminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: profile } = await admin
      .from('profiles')
      .select('is_admin, username, avatar_url')
      .eq('id', user.id)
      .maybeSingle();
    isAdmin = (profile as { is_admin?: boolean } | null)?.is_admin ?? false;
    username = (profile as { username?: string | null } | null)?.username ?? null;
    avatarUrl = (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null;
  }

  return (
    <div className="min-h-screen text-white">
      <NavBar
        loggedIn={!!user}
        isAdmin={isAdmin}
        username={username}
        avatarUrl={avatarUrl}
      />
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <h1 className="text-2xl font-bold">Account Settings</h1>
        <SettingsForm initialUsername={username} initialAvatarUrl={avatarUrl} />
      </main>
    </div>
  );
}
