/**
 * The shape passed between the Settings server actions and their forms.
 * Kept out of `actions.ts`, which as a `'use server'` module may export only
 * async functions (see `app/(auth)/login/form-state.ts`).
 */
export interface DeletionFormState {
  readonly error: string | null;
}

export const EMPTY_DELETION_STATE: DeletionFormState = { error: null };
