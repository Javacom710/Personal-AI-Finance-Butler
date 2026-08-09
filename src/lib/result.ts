/**
 * Typed results, not exceptions (ARCHITECTURE.md §7).
 *
 * A domain error is an expected outcome — "there is no FX rate for that date"
 * is information, not a crash. Callers must handle it, which the type system
 * makes unavoidable.
 *
 * Exceptions remain for programming errors: adding two different currencies,
 * a bigint overflow, a violated precondition. Those are bugs, and a bug should
 * be loud.
 */

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return !r.ok;
}

/** Unwrap, throwing on error. For tests and for call sites that have already checked. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`unwrap() on an error result: ${JSON.stringify(r.error)}`);
}

export function mapOk<T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r;
}

/**
 * The domain error union (ARCHITECTURE.md §7). Extended by later phases only
 * by adding a member — never by widening `code` to `string`, which would
 * defeat exhaustiveness checking at every call site.
 */
export type DomainError =
  | { readonly code: 'not_found'; readonly entity: string; readonly id?: string; readonly message: string }
  | { readonly code: 'conflict'; readonly message: string }
  | { readonly code: 'invariant_violation'; readonly invariant: string; readonly message: string }
  | { readonly code: 'insufficient_data'; readonly reason: string; readonly message: string }
  | { readonly code: 'forbidden'; readonly message: string }
  | { readonly code: 'validation_failed'; readonly fieldErrors: Record<string, string[]>; readonly message: string };

export const notFound = (entity: string, id?: string): DomainError => ({
  code: 'not_found',
  entity,
  ...(id === undefined ? {} : { id }),
  message: `${entity} not found`,
});

export const conflict = (message: string): DomainError => ({ code: 'conflict', message });

export const invariantViolation = (invariant: string, message: string): DomainError => ({
  code: 'invariant_violation',
  invariant,
  message,
});

export const insufficientData = (reason: string, message?: string): DomainError => ({
  code: 'insufficient_data',
  reason,
  message: message ?? `insufficient data: ${reason}`,
});

export const forbidden = (message = 'forbidden'): DomainError => ({ code: 'forbidden', message });

export const validationFailed = (fieldErrors: Record<string, string[]>): DomainError => ({
  code: 'validation_failed',
  fieldErrors,
  message: 'validation failed',
});
