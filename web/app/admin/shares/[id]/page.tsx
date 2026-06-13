
import { createClient } from '@/lib/supabase/server';
import { createClient as adminClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import NavBar from '@/components/NavBar';
import AdminShareActions, { type ActionRow } from '@/components/AdminShareActions';

export default async function AdminShareDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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
  if (!(profile as { is_admin?: boolean } | null)?.is_admin) redirect('/my/encounters');

  const objectPath = `${id}.json.gz`;
  const { data: share } = await admin
    .from('share_uploads')
    .select('id, object_path, created_at, user_id, ip, zone_name, duration_seconds, flagged_at, flagged_reason, blob_deleted')
    .eq('object_path', objectPath)
    .maybeSingle();

  if (!share) {
    return (
      <div className="min-h-screen text-white">
        <NavBar isAdmin username={(profile as { username?: string | null } | null)?.username ?? null} avatarUrl={(profile as { avatar_url?: string | null } | null)?.avatar_url ?? null} />
        <main className="max-w-6xl mx-auto px-4 py-8">
          <Link href="/admin/shares" className="text-accent hover:text-accent-hover text-sm">&larr; Back to shares</Link>
          <p className="mt-6 text-gray-400">Share not found.</p>
        </main>
      </div>
    );
  }

  const shareRow = share as {
    id: string;
    object_path: string;
    created_at: string;
    user_id: string | null;
    ip: string | null;
    zone_name: string | null;
    duration_seconds: number | null;
    flagged_at: string | null;
    flagged_reason: string | null;
    blob_deleted: boolean;
  };

  let uploaderUsername: string | null = null;
  if (shareRow.user_id) {
    const { data: u } = await admin.from('profiles').select('username').eq('id', shareRow.user_id).maybeSingle();
    uploaderUsername = (u as { username?: string | null } | null)?.username ?? null;
  }

  const { data: rowsRaw } = await admin
    .from('analytics_actions')
    .select('id, ts_elapsed, target_mob, actor_main_job, actor_sub_job, actor_main_lvl, actor_sub_lvl, category, ability_name, damage, result, quality')
    .eq('share_id', shareRow.id)
    .order('ts_elapsed', { ascending: true })
    .order('id', { ascending: true });
  const rows = (rowsRaw ?? []) as ActionRow[];

  const totals = rows.reduce((acc, r) => {
    acc.total += 1;
    if (r.quality === 'flagged_implausible') acc.implausible += 1;
    if (r.quality === 'flagged_manual')      acc.flaggedManual += 1;
    return acc;
  }, { total: 0, implausible: 0, flaggedManual: 0 });

  const username = (profile as { username?: string | null } | null)?.username ?? null;
  const avatarUrl = (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null;

  return (
    <div className="min-h-screen text-white">
      <NavBar isAdmin username={username} avatarUrl={avatarUrl} />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <Link href="/admin/shares" className="text-accent hover:text-accent-hover text-sm">&larr; Back to shares</Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{shareRow.zone_name ?? <span className="text-gray-400">unknown zone</span>}</h1>
            <p className="text-gray-400 text-sm mt-1 font-mono">{id}</p>
            <p className="text-xs text-gray-400 mt-1">
              uploaded by <span className="text-gray-300">{uploaderUsername ?? shareRow.ip ?? 'anon'}</span>
              {' · '}
              <span>{new Date(shareRow.created_at).toLocaleString()}</span>
            </p>
            <div className="mt-2 flex gap-1.5">
              {shareRow.flagged_at && (
                <span title={shareRow.flagged_reason ?? 'Flagged'} className="text-[10px] font-semibold bg-rose-500/15 border border-rose-500/40 text-rose-300 rounded px-1.5 py-0.5">FLAGGED</span>
              )}
              {totals.implausible > 0 && (
                <span className="text-[10px] font-semibold bg-amber-500/15 border border-amber-500/40 text-amber-300 rounded px-1.5 py-0.5">{totals.implausible} IMPLAUSIBLE</span>
              )}
              {shareRow.blob_deleted && (
                <span className="text-[10px] font-semibold bg-gray-500/15 border border-gray-500/40 text-gray-400 rounded px-1.5 py-0.5">BLOB DELETED</span>
              )}
            </div>
            {shareRow.flagged_reason && (
              <p className="text-xs text-rose-300/80 mt-2 italic">Flag reason: {shareRow.flagged_reason}</p>
            )}
          </div>
          <Link
            href={`/r/${id}`}
            target="_blank"
            className="shrink-0 text-sm px-3.5 py-2 rounded-lg border border-accent/40 bg-accent/15 text-accent hover:bg-accent/25 transition-colors font-semibold"
          >
            Open report ↗
          </Link>
        </div>

        <div className="mt-6">
          <AdminShareActions rows={rows} totals={totals} />
        </div>
      </main>
    </div>
  );
}
