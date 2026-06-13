
import { createClient } from '@/lib/supabase/server';
import { createClient as adminClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import NavBar from '@/components/NavBar';
import AdminSharesTable, { type AdminShareRow } from '@/components/AdminSharesTable';

type PartyEntry = { name: string; job: string };
type DropEntry = { name: string; count: number };

export default async function AdminSharesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = adminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: profile } = await admin
    .from('profiles')
    .select('is_admin, username, avatar_url')
    .eq('id', user.id)
    .single();

  if (!(profile as { is_admin?: boolean } | null)?.is_admin) {
    redirect('/my/encounters');
  }

  const { data: sharesRaw } = await admin
    .from('share_uploads')
    .select('id, object_path, created_at, user_id, ip, zone_name, party, duration_seconds, drops, flagged_at, flagged_reason, blob_deleted, analytics_processed')
    .order('created_at', { ascending: false })
    .limit(500);
  const shares = (sharesRaw ?? []) as Array<{
    id: string;
    object_path: string;
    created_at: string;
    user_id: string | null;
    ip: string | null;
    zone_name: string | null;
    party: PartyEntry[] | null;
    duration_seconds: number | null;
    drops: DropEntry[] | null;
    flagged_at: string | null;
    flagged_reason: string | null;
    blob_deleted: boolean;
    analytics_processed: boolean;
  }>;

  // Lookup uploader usernames in one round-trip.
  const userIds = [...new Set(shares.map(s => s.user_id).filter((x): x is string => !!x))];
  const usernameById = new Map<string, string | null>();
  if (userIds.length > 0) {
    const { data: profs } = await admin.from('profiles').select('id, username').in('id', userIds);
    for (const p of (profs ?? []) as Array<{ id: string; username: string | null }>) {
      usernameById.set(p.id, p.username);
    }
  }

  // Find share_ids that have at least one implausible analytics row.
  const { data: implausibleRows } = await admin
    .from('analytics_actions')
    .select('share_id')
    .eq('quality', 'flagged_implausible');
  const implausibleSet = new Set<string>(
    ((implausibleRows ?? []) as Array<{ share_id: string | null }>).map(r => r.share_id).filter((x): x is string => !!x)
  );

  const rows: AdminShareRow[] = shares.map(s => ({
    id: s.id,
    contentId: s.object_path.replace(/\.json\.gz$/, ''),
    created_at: s.created_at,
    uploaderUsername: s.user_id ? (usernameById.get(s.user_id) ?? null) : null,
    uploaderIp: s.user_id ? null : s.ip,
    zone_name: s.zone_name,
    party: s.party,
    duration_seconds: s.duration_seconds,
    drops: s.drops,
    flagged_at: s.flagged_at,
    flagged_reason: s.flagged_reason,
    has_implausible: implausibleSet.has(s.id),
    blob_deleted: s.blob_deleted,
  }));

  const username = (profile as { username?: string | null } | null)?.username ?? null;
  const avatarUrl = (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null;

  return (
    <div className="min-h-screen text-white">
      <NavBar isAdmin username={username} avatarUrl={avatarUrl} />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-5">
          <h1 className="text-2xl font-bold">Admin · Shared Encounters</h1>
          <p className="text-gray-400 text-sm mt-0.5">Moderation queue - flag suspicious data, delete clear abuse.</p>
        </div>
        <AdminSharesTable rows={rows} />
      </main>
    </div>
  );
}
