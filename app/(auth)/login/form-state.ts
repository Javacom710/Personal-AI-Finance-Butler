/**
 * The shape passed between the login server actions and the forms.
 *
 * Deliberately **not** in `actions.ts`: a `'use server'` module may only export
 * async functions, because every export becomes a callable server endpoint.
 * Exporting a constant from one fails at request time rather than at build time,
 * so the split is load-bearing.
 */

export interface FormState {
  readonly error: string | null;
}

export const EMPTY_STATE: FormState = { error: null };
