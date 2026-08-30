import 'server-only';

/**
 * The AI layer's failure taxonomy.
 *
 * Every failure the orchestrator can encounter reduces to one of these, and the
 * *class* — not the message — decides what happens next
 * ([AI-SYSTEM.md §7](../../../docs/AI-SYSTEM.md)). That is the whole reason this
 * is a discriminated union rather than an `Error` subclass hierarchy: fallback
 * is a `switch` over a closed set, so a new failure mode is a compile error at
 * every decision point rather than a silent default.
 *
 * The three retry dispositions are a property of the class, stated once here
 * instead of re-derived at each call site:
 *
 * | Disposition | Meaning |
 * |---|---|
 * | `next_candidate` | this model failed; another model of equal capability may succeed |
 * | `fail_closed` | no model will succeed; stop and surface it |
 * | `retry_after` | the provider told us when to come back |
 *
 * **`fail_closed` is the default for anything unrecognised.** A failure we
 * cannot classify must not become a reason to try more models — that is how a
 * misconfiguration turns into a burst of billed requests.
 */

/** What the orchestrator should do about a failure, decided by its class alone. */
export type Disposition = 'next_candidate' | 'fail_closed' | 'retry_after';

export type AiFailure =
  /**
   * No credential. The application runs; the feature reports itself
   * unconfigured. Never a reason to try another model — they share the key.
   */
  | { readonly kind: 'not_configured'; readonly message: string }
  /** The provider rejected the credential. A configuration problem, not a transient one. */
  | { readonly kind: 'unauthorized'; readonly message: string; readonly status: number }
  /** Rate limited. `retryAfterMs` is the provider's own figure when it gave one. */
  | { readonly kind: 'rate_limited'; readonly message: string; readonly retryAfterMs: number | null }
  /** 5xx, socket error, DNS. Another candidate may well work. */
  | { readonly kind: 'transport'; readonly message: string; readonly status: number | null }
  /** The call exceeded its deadline. */
  | { readonly kind: 'timeout'; readonly message: string; readonly timeoutMs: number }
  /**
   * The model answered, but not in the shape the task requires — invalid JSON,
   * a schema violation that survived the repair attempt, a malformed tool call.
   * A **capability** failure: the next candidate must be equally capable, never
   * a weaker one (AI-SYSTEM.md §7).
   */
  | { readonly kind: 'invalid_output'; readonly message: string; readonly detail: string }
  /**
   * No candidate satisfied the requirement, or every candidate was exhausted.
   * Distinct from `transport` because retrying cannot help.
   */
  | { readonly kind: 'no_capable_model'; readonly message: string; readonly capability: string }
  /** The user, or the daily budget, or the rate limiter said no. */
  | { readonly kind: 'refused'; readonly message: string; readonly reason: RefusalReason }
  /** The provider replied with something this adapter does not understand. */
  | { readonly kind: 'malformed_response'; readonly message: string };

export type RefusalReason = 'ai_disabled' | 'rate_limited' | 'daily_budget' | 'unsupported_capability';

const DISPOSITIONS: Record<AiFailure['kind'], Disposition> = {
  not_configured: 'fail_closed',
  unauthorized: 'fail_closed',
  rate_limited: 'retry_after',
  transport: 'next_candidate',
  timeout: 'next_candidate',
  invalid_output: 'next_candidate',
  no_capable_model: 'fail_closed',
  refused: 'fail_closed',
  malformed_response: 'next_candidate',
};

export function dispositionOf(failure: AiFailure): Disposition {
  return DISPOSITIONS[failure.kind] ?? 'fail_closed';
}

/**
 * Whether a failure means "try the next model of equal capability".
 *
 * `rate_limited` counts, because moving to another model is exactly the right
 * response to one model's quota — the wait is a last resort, not a first one.
 */
export function shouldTryNextCandidate(failure: AiFailure): boolean {
  const disposition = dispositionOf(failure);
  return disposition === 'next_candidate' || disposition === 'retry_after';
}

export const notConfigured = (): AiFailure => ({
  kind: 'not_configured',
  message: 'NVIDIA_API_KEY is not set. AI features are unavailable; every other feature is unaffected.',
});

export const unauthorized = (status: number, message = 'The provider rejected the credential.'): AiFailure => ({
  kind: 'unauthorized',
  message,
  status,
});

export const rateLimited = (retryAfterMs: number | null): AiFailure => ({
  kind: 'rate_limited',
  message: 'The provider rate-limited this request.',
  retryAfterMs,
});

export const transport = (message: string, status: number | null = null): AiFailure => ({
  kind: 'transport',
  message,
  status,
});

export const timeout = (timeoutMs: number): AiFailure => ({
  kind: 'timeout',
  message: `The provider did not respond within ${timeoutMs} ms.`,
  timeoutMs,
});

export const invalidOutput = (detail: string): AiFailure => ({
  kind: 'invalid_output',
  message: 'The model produced output that failed validation.',
  detail,
});

export const noCapableModel = (capability: string, message?: string): AiFailure => ({
  kind: 'no_capable_model',
  capability,
  message:
    message ??
    `No configured model satisfies the requirements of ${capability}. Availability is not a licence to downgrade.`,
});

export const refused = (reason: RefusalReason, message: string): AiFailure => ({
  kind: 'refused',
  reason,
  message,
});

export const malformedResponse = (message: string): AiFailure => ({
  kind: 'malformed_response',
  message,
});

/**
 * A failure rendered for a log line or a Settings surface.
 *
 * Deliberately not the raw object: `detail` on `invalid_output` can carry a
 * fragment of model output, and model output can carry whatever was in a tool
 * result. The class and a fixed message are enough to operate the system, and
 * they are all that leaves this module.
 */
export function describeFailure(failure: AiFailure): { kind: string; message: string } {
  return { kind: failure.kind, message: failure.message };
}
