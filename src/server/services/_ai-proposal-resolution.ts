import type { z } from 'zod';
import { reviewedTransactionSchema, type ProposalErrors, type TransactionDraft } from '../../lib/schemas/ai-entry';
import type { TransactionProposal } from '../ai/proposals/schemas';

export interface ProposalAccount { id: string; name: string; currency: string; openingDate: string; isActive: boolean; }
export interface ProposalCategory { id: string; name: string; path: string; kind: 'income' | 'expense'; isArchived: boolean; }
const canonical = (s: string) => s.normalize('NFKC').trim().toLowerCase();
/** Unique exact match first, then unique fuzzy >= .8. Never resolve a tie. */
export function resolveHint<T extends { id: string }>(hint: string | null, values: readonly T[], names: (v: T) => string[]): string | null {
  if (!hint) return null;
  const needle = canonical(hint);
  const exact = values.filter(v => names(v).some(n => canonical(n) === needle));
  if (exact.length) return exact.length === 1 ? exact[0]!.id : null;
  const similar = values.filter(v => names(v).some(n => similarity(needle, canonical(n)) >= 0.8));
  return similar.length === 1 ? similar[0]!.id : null;
}
function similarity(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = next;
  }
  return 1 - previous[b.length]! / Math.max(a.length, b.length, 1);
}
export function proposalFieldErrors(error: z.ZodError): ProposalErrors {
  const errors: ProposalErrors = {};
  for (const issue of error.issues) (errors[issue.path.join('.') || '_'] ??= []).push(issue.message);
  return errors;
}
export function resolveTransactionProposal(p: TransactionProposal, accounts: readonly ProposalAccount[], categories: readonly ProposalCategory[]): { draft: TransactionDraft; errors: ProposalErrors } {
  const active = accounts.filter(a => a.isActive);
  const draft: TransactionDraft = {
    kind: p.kind, bookedOn: p.bookedOn, description: p.description, amount: p.amount, currency: p.currency,
    accountId: resolveHint(p.accountHint, active, a => [a.name]),
    toAccountId: p.kind === 'transfer' ? resolveHint(p.toAccountHint, active, a => [a.name]) : null,
    categoryId: p.kind === 'transfer' ? null : resolveHint(p.categoryHint, categories.filter(c => !c.isArchived && c.kind === p.kind), c => [c.path, c.name]),
    toAmount: null, notes: p.notes, tags: p.tags,
  };
  const parsed = reviewedTransactionSchema.safeParse(draft);
  const errors = parsed.success ? {} : proposalFieldErrors(parsed.error);
  if (p.amount === null) errors['amount'] = ['Enter the missing amount before confirming.'];
  if (!draft.accountId) errors['accountId'] = ['Choose an account; the hint could not be resolved uniquely.'];
  if (p.kind !== 'transfer' && !draft.categoryId) errors['categoryId'] = ['Choose the transaction category.'];
  if (p.kind === 'transfer' && p.categoryHint) errors['categoryId'] = ['Transfers do not have an income or expense category.'];
  const account = active.find(a => a.id === draft.accountId);
  const destination = active.find(a => a.id === draft.toAccountId);
  if (account && account.currency !== p.currency) errors['currency'] = ['The stated currency differs from the account currency. Review the amount and account.'];
  if (account && p.bookedOn < account.openingDate) errors['bookedOn'] = ['The date precedes the account opening date.'];
  if (destination && p.bookedOn < destination.openingDate) errors['bookedOn'] = ['The date precedes the destination opening date.'];
  if (destination && account && destination.currency !== account.currency) errors['toAmount'] = ['Enter the credited amount for this cross-currency transfer.'];
  if (p.kind !== 'transfer' && p.toAccountHint) errors['toAccountId'] = ['Only a transfer can have a destination.'];
  if (p.confidence === 'low') errors['reviewAcknowledged'] = ['Review the low-confidence interpretation.'];
  if (p.ambiguities.length) errors['reviewAcknowledged'] = [...(errors['reviewAcknowledged'] ?? []), ...p.ambiguities];
  return { draft, errors };
}
