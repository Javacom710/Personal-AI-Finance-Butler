import 'server-only';

/** OpenRouter owns host selection. These are privacy/price preferences, never an application router. */
export const OPENROUTER_PREFERENCES = Object.freeze({
  zdr: true,
  data_collection: 'deny',
  order: Object.freeze(['deepinfra']),
  sort: 'price',
  allow_fallbacks: true,
});
export const OPENROUTER_POLICY_FINGERPRINT = JSON.stringify({ version: 1, provider: OPENROUTER_PREFERENCES });

/** Recognize the configured API, including invalid OpenRouter URLs that must fail before egress. */
export function isOpenRouterEndpoint(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname === 'openrouter.ai' || hostname.endsWith('.openrouter.ai');
  } catch { return false; }
}
export function openRouterPolicy(baseUrl: string) {
  if (!isOpenRouterEndpoint(baseUrl)) return undefined;
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'openrouter.ai' || url.port || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/+$/, '') !== '/api/v1') {
    throw new Error('OpenRouter requires the canonical HTTPS API endpoint without URL credentials, query or fragment.');
  }
  return Object.freeze({ providerIdentity: 'https://openrouter.ai/api/v1', requestPolicyFingerprint: OPENROUTER_POLICY_FINGERPRINT, servingHostRequired: true as const });
}
/** Keep the exact returned label. Never substitute the preferred host for a missing response host. */
export function validServingHost(value: unknown): value is string {
  return typeof value === 'string' && /^[\p{L}\p{N}][\p{L}\p{N} ._\/()-]{0,127}$/u.test(value) && value === value.trim();
}
