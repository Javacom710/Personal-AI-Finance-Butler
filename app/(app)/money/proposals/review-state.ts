import type { ActionState } from '../form-state';

/** Raw user edits, returned only to the authenticated submitter after an error. */
export type ReviewEdits = Record<'kind' | 'bookedOn' | 'description' | 'amount' | 'currency' | 'accountId' | 'toAccountId' | 'categoryId' | 'toAmount' | 'notes' | 'tags', string>;
export interface ProposalReviewState extends ActionState {
  readonly edits?: ReviewEdits;
  readonly revision?: number;
}
