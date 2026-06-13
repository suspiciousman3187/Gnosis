
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const UPLOAD_RATE_LIMIT_PER_HOUR = 30;

export type RunTable = 'runs';

export const START_TIME_COLUMN: Record<RunTable, string> = {
  runs: 'sortie_start_time',
};

export async function rateLimitGuard(
  admin: SupabaseClient,
  userId: string,
  table: RunTable,
): Promise<NextResponse | null> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', oneHourAgo);

  if (error) {
    // Fail OPEN on rate-limit lookup errors - better to let an upload through
    // than to block a legitimate user because of a transient DB hiccup.
    console.error(`[uploadGuards] rate limit query failed (${table}):`, error.message);
    return null;
  }
  if ((count ?? 0) >= UPLOAD_RATE_LIMIT_PER_HOUR) {
    return NextResponse.json(
      { error: `Upload rate limit reached (${UPLOAD_RATE_LIMIT_PER_HOUR}/hour). Try again later.` },
      { status: 429, headers: { 'Retry-After': '900' } },
    );
  }
  return null;
}

export async function findDuplicateRun(
  admin: SupabaseClient,
  userId: string,
  table: RunTable,
  runStartTimeIso: string | null,
): Promise<string | null> {
  if (!runStartTimeIso) return null;
  const col = START_TIME_COLUMN[table];
  const { data, error } = await admin
    .from(table)
    .select('id')
    .eq('user_id', userId)
    .eq(col, runStartTimeIso)
    .maybeSingle();
  if (error) {
    // Fail open on lookup errors - the DB's partial unique index will still
    // catch a true duplicate on insert and we'll handle that below.
    console.error(`[uploadGuards] dedupe lookup failed (${table}):`, error.message);
    return null;
  }
  return data?.id ?? null;
}

export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  return code === '23505';
}
