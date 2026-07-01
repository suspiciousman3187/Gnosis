import { createClient } from '@/lib/supabase/server';
import { createClient as adminClient } from '@supabase/supabase-js';
import Link from 'next/link';
import NavBar from '@/components/NavBar';

export default async function RootPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let username: string | null = null;
  let avatarUrl: string | null = null;
  let isAdmin = false;

  if (user) {
    const { data: profile } = await adminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    ).from('profiles').select('username, avatar_url, is_admin').eq('id', user.id).maybeSingle();
    username = (profile as { username?: string | null } | null)?.username ?? null;
    avatarUrl = (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null;
    isAdmin = (profile as { is_admin?: boolean } | null)?.is_admin ?? false;
  }

  return (
    <div className="min-h-screen text-white flex flex-col">
      {/* Homepage gets a dedicated wallpaper. SSR'd inline <style> overrides
          the global :root default from themes.css, so there's no client-side
          flicker - the apex paints the home image from the first byte. */}
      <style>{`:root { --bg-wallpaper: url('/bg-home.webp?v=1'); }`}</style>
      <NavBar isAdmin={isAdmin} username={username} avatarUrl={avatarUrl} loggedIn={!!user} />
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="max-w-lg text-center space-y-6">
          <h1 className="text-5xl font-bold tracking-tight text-accent" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.85), 0 0 24px rgba(0,0,0,0.55)' }}>GNOSIS</h1>
          <p className="text-gray-100 text-lg leading-relaxed" style={{ textShadow: '0 1px 6px rgba(0,0,0,0.85), 0 0 14px rgba(0,0,0,0.6)' }}>
            Encounter tracking and analytics for Final Fantasy XI.
          </p>
          {!user && (
            <div className="flex items-center justify-center gap-4 pt-2">
              <Link
                href="/login"
                className="le-tap bg-accent hover:bg-accent-hover text-gray-900 font-semibold px-6 py-2.5 rounded-lg transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/register"
                className="le-tap bg-white/[0.08] hover:bg-white/[0.14] backdrop-blur-sm border border-white/25 hover:border-white/45 text-gray-100 font-semibold px-6 py-2.5 rounded-lg transition-colors"
              >
                Create Account
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
