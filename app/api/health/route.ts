import { NextResponse } from 'next/server';

import { checkDatabase } from '@/server/health';

/**
 * Liveness and readiness for the reverse proxy and uptime monitoring
 * (DEPLOYMENT.md).
 *
 * Unauthenticated on purpose — a monitor cannot hold a session — so it returns
 * nothing an anonymous caller should not see: no version, no hostname, no
 * schema detail, no error text. Just whether the database answered.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const status = await checkDatabase();

  return NextResponse.json(
    { status },
    { status: status === 'ok' ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
