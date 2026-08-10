/**
 * The shape a money form action returns.
 *
 * Deliberately **not** exported from `actions.ts`: a `'use server'` module may
 * export only async functions, because every export becomes a callable
 * endpoint. Exporting a constant there returned HTTP 500 on the first POST once
 * already, which is why `tests/unit/server-actions.test.ts` exists.
 */

import type { DomainError } from '@/lib/result';

export interface ActionState {
  readonly status: 'idle' | 'ok' | 'error';
  readonly message: string | null;
  /** Keyed by field name; `_` holds errors about the form as a whole. */
  readonly fieldErrors: Record<string, string[]>;
}

export const EMPTY_ACTION_STATE: ActionState = { status: 'idle', message: null, fieldErrors: {} };

export function success(message: string): ActionState {
  return { status: 'ok', message, fieldErrors: {} };
}

export function failure(error: DomainError): ActionState {
  if (error.code === 'validation_failed') {
    return {
      status: 'error',
      message: error.fieldErrors['_']?.[0] ?? 'Check the highlighted fields.',
      fieldErrors: error.fieldErrors,
    };
  }
  return { status: 'error', message: error.message, fieldErrors: {} };
}
