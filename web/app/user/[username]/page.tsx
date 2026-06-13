import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient as adminClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import NavBar from '@/components/NavBar';
import { classify, CONTENT_COLOR_PALETTE } from '@/lib/contentRegistry';

type PartyEntry = { name: string; job: string };
type DropEntry = { name: string; count: number };
type ShareRow = {
  object_path: string;
  created_at: string;
  content_kind: string | null;
  zone_name: string | null;
  party: PartyEntry[] | null;
  duration_seconds: number | null;
  drops: DropEntry[] | null;
  enemy_names: string[] | null;
};

function admin() {
  return adminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function loadProfile(username: string) {
  const { data } = await admin()
    .from('profiles')
    .select('id, username, avatar_url')
    .eq('username', username.toLowerCase())
    .maybeSingle() as { data: { id: string; username: string | null; avatar_url: string | null } | null };
  return data;
}

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  const profile = await loadProfile(username);
  if (!profile) return { title: 'GNOSIS - Player not found' };
  const display = profile.username ?? username;
  return {
    title: `GNOSIS - ${display}`,
    description: 'Encounter tracking and analytics for Final Fantasy XI.',
  };
}

function shareIdFrom(objectPath: string): string {
  return objectPath.replace(/\.json\.gz$/, '');
}

function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDuration(s: number | null): string {
  if (s == null || s <= 0) return '-';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function zoneLabel(r: ShareRow): string {
  if (r.zone_name) return r.zone_name;
  if (r.content_kind === 'sortie') return "Outer Ra'Kaznar";
  return '-';
}

export default async function UserProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const profile = await loadProfile(username);
  if (!profile) notFound();

  const a = admin();

  const { count: publicCount } = await a
    .from('share_uploads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile.id)
    .eq('is_private', false);

  const { data: recentRaw } = await a
    .from('share_uploads')
    .select('object_path, created_at, content_kind, zone_name, party, duration_seconds, drops, enemy_names')
    .eq('user_id', profile.id)
    .eq('is_private', false)
    .order('created_at', { ascending: false })
    .limit(20);

  const recent = (recentRaw ?? []) as ShareRow[];
  const display = profile.username ?? username;

  const supabase = await createServerClient();
  const { data: { user: viewer } } = await supabase.auth.getUser();
  let viewerIsAdmin = false;
  let viewerUsername: string | null = null;
  let viewerAvatarUrl: string | null = null;
  if (viewer) {
    const { data: viewerProfile } = await a
      .from('profiles')
      .select('is_admin, username, avatar_url')
      .eq('id', viewer.id)
      .maybeSingle();
    viewerIsAdmin = (viewerProfile as { is_admin?: boolean } | null)?.is_admin ?? false;
    viewerUsername = (viewerProfile as { username?: string | null } | null)?.username ?? null;
    viewerAvatarUrl = (viewerProfile as { avatar_url?: string | null } | null)?.avatar_url ?? null;
  }

  return (
    <div className="min-h-screen text-white">
      <NavBar
        loggedIn={!!viewer}
        isAdmin={viewerIsAdmin}
        username={viewerUsername}
        avatarUrl={viewerAvatarUrl}
      />
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <section className="bg-surface border border-white/10 rounded-xl p-6">
          <div className="flex items-center gap-5">
            <div className="w-24 h-24 rounded-full bg-surface-raised border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
              {profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatar_url} alt={display} className="w-full h-full object-cover" />
              ) : (
                <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-500">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
                </svg>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-3xl font-bold text-white truncate">{display}</h1>
              <p className="text-sm text-gray-400 mt-1">
                <span className="text-accent font-semibold">{(publicCount ?? 0).toLocaleString()}</span>{' '}
                public encounter{publicCount === 1 ? '' : 's'} shared
              </p>
            </div>
          </div>
        </section>

        <section className="bg-surface border border-white/10 rounded-xl overflow-hidden">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 px-5 pt-4 pb-2">Recent Encounters</h2>

          {recent.length === 0 ? (
            <div className="px-5 pb-6 text-sm text-gray-400">No public encounters shared yet.</div>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {recent.map((r) => {
                const id = shareIdFrom(r.object_path);
                const jobs = (r.party ?? []).map(p => (p.job || '?').toUpperCase()).join(' / ');
                const topDrops = (r.drops ?? []).slice(0, 3);
                const restCount = Math.max(0, (r.drops?.length ?? 0) - topDrops.length);
                const itemNames = new Set<string>();
                for (const d of r.drops ?? []) if (d?.name) itemNames.add(d.name);
                const mobNames = new Set<string>();
                for (const n of r.enemy_names ?? []) if (typeof n === 'string') mobNames.add(n);
                const def = classify({
                  kind: r.content_kind === 'sortie' ? 'sortie' : 'encounter',
                  zoneId: null,
                  zoneName: r.zone_name ?? null,
                  mobNames,
                  itemNames,
                });
                return (
                  <li key={r.object_path} className="hover:bg-white/[0.04] transition-colors">
                    <Link href={`/r/${id}`} className="block px-5 py-3">
                      <div className="flex items-baseline justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          {def && (
                            <span className={`inline-flex items-center justify-center text-[9px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap min-w-[3.5rem] ${CONTENT_COLOR_PALETTE[def.color].chip}`}>
                              {def.name}
                            </span>
                          )}
                          <span className="text-base font-semibold text-gray-100">{zoneLabel(r)}</span>
                        </div>
                        <span className="text-[11px] text-gray-400">{timeAgo(r.created_at)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-gray-400">
                        {jobs && (
                          <span className="font-mono">
                            {jobs}
                            <span className="ml-1 text-gray-500">({r.party?.length ?? 0})</span>
                          </span>
                        )}
                        <span className="font-mono">{formatDuration(r.duration_seconds)}</span>
                        {topDrops.length > 0 && (
                          <span className="text-gray-300">
                            {topDrops.map((d, i) => (
                              <span key={d.name}>
                                {i > 0 && <span className="text-gray-500">, </span>}
                                {d.name}
                                {d.count > 1 && <span className="text-gray-500"> x{d.count}</span>}
                              </span>
                            ))}
                            {restCount > 0 && <span className="text-gray-500 ml-1">+{restCount} more</span>}
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
