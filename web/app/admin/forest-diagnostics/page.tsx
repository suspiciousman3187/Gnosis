import { createClient } from '@/lib/supabase/server';
import { createClient as adminClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import NavBar from '@/components/NavBar';

export const dynamic = 'force-dynamic';

const BUCKET = 'forest-diagnostics';

type Row = {
  id: string;
  object_path: string;
  label: string | null;
  forest_version: string | null;
  ip: string | null;
  size_bytes: number | null;
  created_at: string;
};

function fmtBytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default async function ForestDiagnosticsAdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = adminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: profile } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (!(profile as { is_admin?: boolean } | null)?.is_admin) {
    redirect('/my/encounters');
  }

  const { data: rowsRaw } = await admin
    .from('forest_diagnostics_uploads')
    .select('id, object_path, label, forest_version, ip, size_bytes, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  const rows = (rowsRaw ?? []) as Row[];

  const paths = rows.map(r => r.object_path);
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signedArr } = await admin.storage
      .from(BUCKET)
      .createSignedUrls(paths, 60 * 60 * 24);
    for (const s of signedArr ?? []) {
      if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Forest Diagnostics Uploads</h1>
        <p className="text-sm text-zinc-400 mb-4">
          Most recent {rows.length} uploads. Download links are signed and valid for 24 hours.
        </p>
        {rows.length === 0 ? (
          <div className="text-zinc-500 text-sm">No uploads yet.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/50 text-zinc-400 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">When (UTC)</th>
                  <th className="px-3 py-2 font-medium">Label</th>
                  <th className="px-3 py-2 font-medium">Version</th>
                  <th className="px-3 py-2 font-medium">Size</th>
                  <th className="px-3 py-2 font-medium">IP</th>
                  <th className="px-3 py-2 font-medium">File</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-zinc-900/30">
                    <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">
                      {new Date(r.created_at).toISOString().replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="px-3 py-2 font-medium text-zinc-100">{r.label ?? '—'}</td>
                    <td className="px-3 py-2 text-zinc-400">{r.forest_version ?? '—'}</td>
                    <td className="px-3 py-2 text-zinc-400 tabular-nums">{fmtBytes(r.size_bytes)}</td>
                    <td className="px-3 py-2 text-zinc-500 font-mono text-xs">{r.ip ?? '—'}</td>
                    <td className="px-3 py-2">
                      {signed.has(r.object_path) ? (
                        <a
                          href={signed.get(r.object_path)!}
                          className="text-emerald-400 hover:text-emerald-300 underline"
                          download
                        >
                          download
                        </a>
                      ) : (
                        <span className="text-zinc-500 text-xs font-mono">{r.object_path}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
