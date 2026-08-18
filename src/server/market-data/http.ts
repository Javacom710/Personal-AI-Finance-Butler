import 'server-only';

/**
 * The one HTTP path every adapter uses, and where a transport problem becomes a
 * `ProviderFailure` instead of an exception.
 *
 * `ROADMAP.md` Phase 6 requires all seven failure modes — normal, empty,
 * malformed, 500, 429, timeout, unknown symbol — to produce a result rather than
 * a throw. Four of those seven are decided here; the adapter decides the other
 * three from the body.
 *
 * **`fetch` is injected.** Tests replay captured fixtures through it, so no test
 * touches the network and no adapter reads a global. It also means the "a read
 * makes no network call" assertion can be written as a fetch that throws.
 *
 * No credential is read in this file. The two adapters shipping in this phase
 * need none; a future one reads its own inside `providers/`, never here and
 * never above (SECURITY.md).
 */

import { err, ok, type Result } from '../../lib/result';
import { failure, type ProviderFailure } from './types';

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>;

export interface HttpOptions {
  readonly fetch: FetchLike;
  readonly timeoutMs?: number;
  readonly headers?: Record<string, string>;
  /** Guards against a provider streaming something enormous into memory. */
  readonly maxBytes?: number;
}

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Fetch a URL and return its body as text.
 *
 * Text, not JSON, deliberately: AMFI publishes a delimited text file, and a JSON
 * adapter that wants numbers as strings has to see the raw body anyway
 * ([MARKET-DATA-DESIGN.md §9](../../../docs/MARKET-DATA-DESIGN.md#9-price-precision)).
 */
export async function getText(url: string, options: HttpOptions): Promise<Result<string, ProviderFailure>> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await options.fetch(url, {
      signal: controller.signal,
      ...(options.headers ? { headers: options.headers } : {}),
    });

    if (response.status === 429) {
      return err(failure.rateLimited(retryAfterSeconds(response)));
    }
    if (response.status === 404) {
      // Distinguished from a 500 because it is permanent: retrying a 404 burns
      // quota forever and never succeeds.
      return err(failure.notFound());
    }
    if (!response.ok) {
      return err(failure.transport(`HTTP ${response.status}`));
    }

    const body = await response.text();
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    if (body.length > maxBytes) {
      return err(failure.malformed(`response exceeded ${maxBytes} bytes`));
    }
    return ok(body);
  } catch (error) {
    if (isAbort(error)) {
      return err(failure.transport(`timed out after ${timeoutMs}ms`));
    }
    return err(failure.transport(error instanceof Error ? error.message : String(error)));
  } finally {
    clearTimeout(timer);
  }
}

/** As `getText`, then `JSON.parse`. A parse failure is `malformed`, never a throw. */
export async function getJson<T = unknown>(
  url: string,
  options: HttpOptions,
): Promise<Result<T, ProviderFailure>> {
  const text = await getText(url, options);
  if (!text.ok) return text;
  try {
    return ok(JSON.parse(text.value) as T);
  } catch (error) {
    return err(failure.malformed(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
  }
}

function retryAfterSeconds(response: Response): number | null {
  const header = response.headers?.get?.('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}
