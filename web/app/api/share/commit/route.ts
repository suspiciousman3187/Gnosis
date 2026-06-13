import { NextRequest, NextResponse } from 'next/server';
import {
  CORS_HEADERS,
  adminClient,
  resolveUploader,
  rateLimitGuard,
  validatePayload,
  extractAnalytics,
  shareDisabled,
} from '@/lib/share-server';
import { r2Head, r2GetBuffer, r2Delete } from '@/lib/r2';

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  if (shareDisabled()) {
    return NextResponse.json(
      { error: 'Sharing is temporarily disabled.' },
      { status: 503, headers: { ...CORS_HEADERS, 'Retry-After': '3600' } },
    );
  }

  const id = req.nextUrl.searchParams.get('id');
  if (!id || !/^[a-f0-9]{8,64}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid or missing id' }, { status: 400, headers: CORS_HEADERS });
  }
  const wantsPrivate = req.nextUrl.searchParams.get('private') === '1';

  const admin = adminClient();
  const who = await resolveUploader(req);
  if (wantsPrivate && !who.userId) {
    return NextResponse.json(
      { error: 'Private shares require a connected account.' },
      { status: 401, headers: CORS_HEADERS },
    );
  }
  const limited = await rateLimitGuard(admin, who);
  if (limited) return limited;

  const objectPath = `${id}.json.gz`;

  const { data: existingRow } = await admin
    .from('share_uploads')
    .select('id, is_private, blob_deleted')
    .eq('object_path', objectPath)
    .maybeSingle();
  if (existingRow && !existingRow.blob_deleted) {
    return NextResponse.json(
      { id, alreadyUploaded: true, isPrivate: existingRow.is_private },
      { headers: CORS_HEADERS },
    );
  }

  const head = await r2Head(objectPath);
  if (!head) {
    return NextResponse.json(
      { error: 'no uploaded blob found for this id - call /api/share/init then PUT to the upload URL before committing' },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  let buf: ArrayBuffer;
  try {
    buf = await r2GetBuffer(objectPath);
  } catch (e) {
    console.error('[share/commit] r2GetBuffer failed:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: 'failed to read uploaded blob' }, { status: 500, headers: CORS_HEADERS });
  }

  const v = await validatePayload(buf);
  if (!v.ok) {
    try { await r2Delete(objectPath); } catch { /* best effort */ }
    return NextResponse.json({ error: `payload rejected: ${v.reason}` }, { status: 400, headers: CORS_HEADERS });
  }

  const payloadV = typeof v.parsed?.v === 'number' ? v.parsed.v : null;
  const { data: trackRow, error: trackErr } = await admin
    .from('share_uploads')
    .insert({
      object_path: objectPath,
      user_id: who.userId,
      ip: who.userId ? null : who.ip,
      is_private:       wantsPrivate,
      content_kind:     v.meta?.content_kind ?? null,
      zone_name:        v.meta?.zone_name ?? null,
      party:            v.meta?.party ?? null,
      duration_seconds: v.meta?.duration_seconds ?? null,
      drops:            v.meta?.drops ?? null,
      enemy_names:      v.meta?.enemy_names ?? null,
      payload_v:        payloadV,
    })
    .select('id')
    .single();
  if (trackErr) console.error('[share/commit] tracking insert failed:', trackErr.message);

  if (trackRow?.id && v.parsed) {
    try {
      const { count: existingActions } = await admin
        .from('analytics_actions')
        .select('id', { count: 'exact', head: true })
        .eq('encounter_id', id);

      if (existingActions && existingActions > 0) {
        await admin.from('share_uploads').update({ analytics_processed: true }).eq('id', trackRow.id);
      } else {
        const rows = extractAnalytics(v.parsed, v.meta?.zone_name ?? null);
        if (rows.length > 0) {
          const enriched = rows.map(r => ({
            ...r,
            share_id: trackRow.id,
            encounter_id: id,
            uploaded_by: who.userId,
            payload_v: payloadV ?? 1,
          }));
          const { error: aErr } = await admin.from('analytics_actions').insert(enriched);
          if (aErr) {
            console.error('[share/commit] analytics insert failed:', aErr.message);
          } else {
            await admin.from('share_uploads').update({ analytics_processed: true }).eq('id', trackRow.id);
          }
        } else {
          await admin.from('share_uploads').update({ analytics_processed: true }).eq('id', trackRow.id);
        }
      }
    } catch (e) {
      console.error('[share/commit] analytics ETL threw:', e instanceof Error ? e.message : String(e));
    }
  }

  return NextResponse.json(
    { id, alreadyUploaded: false, isPrivate: wantsPrivate },
    { headers: CORS_HEADERS },
  );
}
