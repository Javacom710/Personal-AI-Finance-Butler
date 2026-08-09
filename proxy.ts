import { NextResponse, type NextRequest } from 'next/server';

/**
 * Security headers and a per-request CSP nonce (SECURITY.md §4).
 *
 * This is Next 16's `proxy` convention — the same request interceptor that was
 * previously called `middleware`, renamed upstream. It runs before every
 * request the matcher selects.
 *
 * The nonce is generated here, passed down to the document through a request
 * header so Next can attach it to its own script tags, and named in the CSP on
 * the response. Both halves are required: without the request header Next does
 * not know the nonce, and without the response header the browser does not
 * enforce it.
 *
 * `connect-src 'self'` is load-bearing rather than decorative. The browser never
 * talks to NVIDIA Build or a market-data provider — those calls are server-side
 * and hold credentials. If a future change ever tries to reach a provider from
 * the client, the CSP breaks first, which is the failure order we want.
 */

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function buildCsp(nonce: string, isDevelopment: boolean): string {
  const scriptSrc = isDevelopment
    ? // `next dev` evaluates compiled modules on the client; React Fast Refresh
      // requires eval. Production never gets it.
      `'self' 'nonce-${nonce}' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    // Next injects its stylesheet as a <link>, but React inserts inline <style>
    // elements for style precedence, and those carry the nonce.
    `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src 'self'${isDevelopment ? ' ws: wss:' : ''}`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'none'`,
    `object-src 'none'`,
    ...(isDevelopment ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

export function proxy(request: NextRequest): NextResponse {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const csp = buildCsp(nonce, isDevelopment);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Next reads the CSP from the *request* headers to decide which of its own
  // inline scripts need a nonce attribute.
  requestHeaders.set('content-security-policy', csp);
  // A layout cannot see the path it is rendering. The authenticated shell needs
  // it so an unauthenticated visitor is sent back where they were going after
  // signing in, rather than to the overview.
  requestHeaders.set('x-pathname', `${request.nextUrl.pathname}${request.nextUrl.search}`);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set('content-security-policy', csp);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }

  // HSTS is only meaningful over https, and asserting it on a plain-http
  // development origin would pin localhost to https in the browser for two
  // years. Caddy sets it in production (DEPLOYMENT.md); this covers a
  // direct-to-Node deployment too.
  if (!isDevelopment) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    );
  }

  return response;
}

export const config = {
  // Everything except Next's own immutable static output, which needs no
  // per-request nonce.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
