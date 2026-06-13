import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/share-server';
import { r2Delete, r2List } from '@/lib/r2';

export const dynamic = 'force-dynamic';

const RETENTION_DAYS = 90;

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = req.headers.get('authorization');
  return got === `Bearer ${expected}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = adminClient();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: expired, error: fetchErr } = await admin
    .from('share_uploads')
    .select('id, object_path')
    .lt('created_at', cutoff)
    .eq('blob_deleted', false)
    .limit(5000);
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  let blobsDeleted = 0;
  let blobErrors = 0;
  for (const v of expired ?? []) {
    try {
      await r2Delete(v.object_path);
      blobsDeleted += 1;
    } catch (e) {
      blobErrors += 1;
      console.error('[retention] delete failed for', v.object_path, e instanceof Error ? e.message : String(e));
    }
    await admin.from('share_uploads').update({ blob_deleted: true }).eq('id', v.id);
  }

  let orphansDeleted = 0;
  try {
    const allKeys = await r2List('');
    if (allKeys.length > 0) {
      const ids = allKeys.map(k => k);
      for (let i = 0; i < ids.length; i += 1000) {
        const batch = ids.slice(i, i + 1000);
        const { data: rows } = await admin
          .from('share_uploads')
          .select('object_path')
          .in('object_path', batch);
        const tracked = new Set((rows ?? []).map(r => r.object_path));
        const untracked = batch.filter(k => !tracked.has(k));
        for (const k of untracked) {
          try {
            await r2Delete(k);
            orphansDeleted += 1;
          } catch (e) {
            console.error('[retention] orphan delete failed for', k, e instanceof Error ? e.message : String(e));
          }
        }
      }
    }
  } catch (e) {
    console.error('[retention] orphan sweep failed:', e instanceof Error ? e.message : String(e));
  }

  return NextResponse.json({
    ok: true,
    retentionDays: RETENTION_DAYS,
    blobsDeleted,
    blobErrors,
    orphansDeleted,
  });
}
