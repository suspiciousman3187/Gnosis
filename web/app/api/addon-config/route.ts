import { NextResponse } from 'next/server';
import { CHEST_IDS } from '@/lib/chestIds';
import { WARP_CONFIG } from '@/lib/warpIds';

export async function GET() {
  return NextResponse.json(
    {
      version: '1.0',
      chestIds: CHEST_IDS,
      ...WARP_CONFIG,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    }
  );
}
