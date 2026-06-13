
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { createClient as adminClient } from '@supabase/supabase-js';
import NavBar from '@/components/NavBar';
import SharedReportView from '@/components/SharedReportView';

function fmtDateLong(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const admin = adminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { data: row } = await admin
      .from('share_uploads')
      .select('zone_name, content_kind, created_at, duration_seconds')
      .eq('object_path', `${id}.json.gz`)
      .maybeSingle() as { data: { zone_name: string | null; content_kind: string | null; created_at: string | null; duration_seconds: number | null } | null };
    if (!row) return { title: 'GNOSIS - Shared Encounter' };
    const kind = (row.content_kind ?? 'encounter').replace(/^./, c => c.toUpperCase());
    const zone = row.zone_name ?? (row.content_kind === 'sortie' ? "Outer Ra'Kaznar" : 'Unknown Zone');
    const date = fmtDateLong(row.created_at);
    const title = `GNOSIS - ${kind}: ${zone}${date ? ` on ${date}` : ''}`;
    const description = 'Encounter tracking and analytics for Final Fantasy XI.';
    return { title, description, openGraph: { title, description }, twitter: { title, description, card: 'summary' } };
  } catch {
    return { title: 'GNOSIS - Shared Encounter' };
  }
}

export default async function ShareViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let isAdmin = false;
  let username: string | null = null;
  let avatarUrl: string | null = null;
  let isOwner = false;
  let initialPrivate: boolean | null = null;
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

    const { data: shareRow } = await admin
      .from('share_uploads')
      .select('user_id, is_private')
      .eq('object_path', `${id}.json.gz`)
      .maybeSingle() as { data: { user_id: string | null; is_private: boolean } | null };
    if (shareRow) {
      isOwner = shareRow.user_id === user.id;
      initialPrivate = shareRow.is_private;
    }
  }

  return (
    <div className="min-h-screen text-white">
      <NavBar
        loggedIn={!!user}
        isAdmin={isAdmin}
        username={username}
        avatarUrl={avatarUrl}
      />
      <SharedReportView
        id={id}
        loggedIn={!!user}
        isOwner={isOwner}
        initialPrivate={initialPrivate}
      />
    </div>
  );
}
