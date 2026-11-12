import { requireSession } from '@/server/auth/guards';
import { createReadCtx, exportAllData } from '@/server/services';

const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } as const;

/**
 * Settings → Data → Export (SECURITY.md §9).
 *
 * **POST, and same-origin only.** An export uses one of five daily allowances
 * and writes an audit row, so it must not be triggerable by a link or an image
 * on another site. The session cookie is `SameSite=Lax`, which already keeps it
 * off a cross-site POST; the origin check is the second, explicit guard.
 *
 * Generated per request and returned as a download. It is not stored, emailed or
 * logged.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: 'Export must be requested from this site.' }, { status: 403, headers: HEADERS });
  }

  const session = await requireSession('/settings');
  const ctx = await createReadCtx(session.userId);
  if (!ctx.ok) return Response.json({ error: 'Settings unavailable.' }, { status: 503, headers: HEADERS });

  const result = await exportAllData(ctx.value);
  if (!result.ok) {
    return result.error.code === 'conflict'
      ? Response.json({ error: result.error.message }, { status: 429, headers: { ...HEADERS, 'Retry-After': '86400' } })
      : Response.json({ error: 'Export unavailable.' }, { status: 500, headers: HEADERS });
  }

  const day = result.value.exportedAt.slice(0, 10);
  return new Response(JSON.stringify(result.value), {
    status: 200,
    headers: {
      ...HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="finance-os-export-${day}.json"`,
    },
  });
}

function sameOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin';
  const origin = request.headers.get('origin');
  return origin !== null && origin === new URL(request.url).origin;
}
