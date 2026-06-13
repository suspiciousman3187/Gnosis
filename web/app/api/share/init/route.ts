import { NextRequest, NextResponse } from 'next/server';
import {
  CORS_HEADERS,
  adminClient,
  resolveUploader,
  rateLimitGuard,
  shareDisabled,
  MAX_BYTES,
} from '@/lib/share-server';
import { r2Head, r2PresignPut } from '@/lib/r2';

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
    .select('id, is_private, user_id, blob_deleted')
    .eq('object_path', objectPath)
    .maybeSingle();
  if (existingRow && !existingRow.blob_deleted) {
    return NextResponse.json(
      { id, alreadyUploaded: true, isPrivate: existingRow.is_private },
      { headers: CORS_HEADERS },
    );
  }

  const blob = await r2Head(objectPath);
  if (blob && existingRow && existingRow.blob_deleted) {
    return NextResponse.json(
      { error: 'this report id has been retention-pruned and cannot be re-uploaded' },
      { status: 409, headers: CORS_HEADERS },
    );
  }

  const uploadUrl = await r2PresignPut(objectPath, {
    ttlSeconds: 300,
    contentType: 'application/gzip',
    maxBytes: MAX_BYTES,
  });

  return NextResponse.json(
    {
      id,
      alreadyUploaded: false,
      uploadUrl,
      expiresIn: 300,
      maxBytes: MAX_BYTES,
    },
    { headers: CORS_HEADERS },
  );
}
