'use client';
import { useActionState, useEffect, useState } from 'react';
import type { TransactionDraft, ProposalErrors } from '@/lib/schemas/ai-entry';
import { EMPTY_ACTION_STATE } from '../form-state';
import type { ProposalReviewState } from './review-state';
import { confirmTransactionProposalAction, rejectTransactionProposalAction } from './actions';

export interface ReviewProps {
  id: string; draft: TransactionDraft | null; errors: ProposalErrors; expiresAt: string; expiresAtIso: string; expired: boolean; preview: string;
  accounts: { id: string; name: string; currency: string }[];
  categories: { id: string; path: string; kind: 'income' | 'expense' }[];
}
const INPUT = 'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm';
export function ProposalReview(p: ReviewProps) {
  const [state, confirm, confirming] = useActionState<ProposalReviewState, FormData>(confirmTransactionProposalAction, EMPTY_ACTION_STATE);
  const [rejected, reject, rejecting] = useActionState(rejectTransactionProposalAction, EMPTY_ACTION_STATE);
  const [kind, setKind] = useState(p.draft?.kind ?? '');
  const [lifetimePassed, setLifetimePassed] = useState(false);
  const expired = p.expired || lifetimePassed;
  useEffect(() => {
    if (p.expired) return;
    const remaining = new Date(p.expiresAtIso).getTime() - Date.now();
    const timer = setTimeout(() => setLifetimePassed(true), Number.isFinite(remaining) ? Math.max(0, remaining) : 0);
    return () => clearTimeout(timer);
  }, [p.expired, p.expiresAtIso]);
  const edits = state.edits;
  const errors = { ...p.errors, ...state.fieldErrors };
  const field = (name: string) => <>{errors[name]?.map((e, i) => <p key={i} className="text-sm text-danger" role="alert">{e}</p>)}</>;
  const accountId = p.accounts.some(a => a.id === (edits?.accountId ?? p.draft?.accountId)) ? (edits?.accountId ?? p.draft?.accountId) ?? '' : '';
  const toAccountId = p.accounts.some(a => a.id === (edits?.toAccountId ?? p.draft?.toAccountId)) ? (edits?.toAccountId ?? p.draft?.toAccountId) ?? '' : '';
  const cats = p.categories.filter(c => c.kind === kind);
  const categoryId = cats.some(c => c.id === (edits?.categoryId ?? p.draft?.categoryId)) ? (edits?.categoryId ?? p.draft?.categoryId) ?? '' : '';
  if (state.status === 'ok' || rejected.status === 'ok') return <p role="status" className="rounded-lg border border-border p-4">{state.message ?? rejected.message}</p>;
  return <section className="space-y-4 rounded-lg border border-border p-4">
    <h2 className="font-semibold">{p.preview}</h2>
    <p className="text-sm text-ink-muted">{expired ? 'Expired. This draft cannot be confirmed.' : `Expires ${p.expiresAt}. Review every field before recording.`}</p>
    {state.message && <p role="alert">{state.message}</p>}{rejected.message && <p role="alert">{rejected.message}</p>}
    {Object.keys(errors).length > 0 && <ul aria-label="Draft issues" className="text-sm text-danger">{Object.entries(errors).map(([key, messages]) => <li key={key}><strong>{key === '_' ? 'Draft' : key}: </strong>{messages.join(' ')}</li>)}</ul>}
    {/* A new form restores submitted edits after React resets a failed action. */}
    <form key={state.revision ?? 0} action={confirm} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="proposalId" value={p.id} />
      <label>Kind<select name="kind" className={INPUT} value={kind} onChange={e => setKind(e.target.value)} required><option value="">Choose a kind</option><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option></select>{field('kind')}</label>
      <label>Date<input type="date" name="bookedOn" defaultValue={edits?.bookedOn ?? p.draft?.bookedOn ?? ''} required className={INPUT} />{field('bookedOn')}</label>
      <label>Amount<input name="amount" inputMode="decimal" defaultValue={edits?.amount ?? p.draft?.amount ?? ''} required className={INPUT} />{field('amount')}</label>
      <label>Currency<input name="currency" defaultValue={edits?.currency ?? p.draft?.currency ?? ''} maxLength={3} required className={INPUT} />{field('currency')}</label>
      <label>{kind === 'transfer' ? 'From account' : 'Account'}<select name="accountId" defaultValue={accountId} required className={INPUT}><option value="">Choose an account</option>{p.accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select>{field('accountId')}</label>
      {kind === 'transfer' ? <>
        <label>To account<select name="toAccountId" defaultValue={toAccountId} required className={INPUT}><option value="">Choose a destination</option>{p.accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select>{field('toAccountId')}</label>
        <label>Credited amount (for different currencies)<input name="toAmount" inputMode="decimal" defaultValue={edits?.toAmount ?? p.draft?.toAmount ?? ''} className={INPUT} />{field('toAmount')}</label>
      </> : <label>Category<select key={kind} name="categoryId" defaultValue={categoryId} required className={INPUT}><option value="">Choose a category</option>{cats.map(c => <option key={c.id} value={c.id}>{c.path}</option>)}</select>{field('categoryId')}</label>}
      <label className="sm:col-span-2">Description<input name="description" defaultValue={edits?.description ?? p.draft?.description ?? ''} maxLength={400} required className={INPUT} />{field('description')}</label>
      <label>Tags (comma separated)<input name="tags" defaultValue={edits?.tags ?? p.draft?.tags?.join(', ') ?? ''} className={INPUT} />{field('tags')}</label>
      <label>Notes<input name="notes" defaultValue={edits?.notes ?? p.draft?.notes ?? ''} maxLength={2000} className={INPUT} />{field('notes')}</label>
      <label className="sm:col-span-2"><input type="checkbox" name="reviewAcknowledged" value="true" required={Object.keys(p.errors).length > 0} /> I reviewed the draft and resolved the highlighted issues.{field('reviewAcknowledged')}</label>
      <label className="sm:col-span-2"><input type="checkbox" name="confirmed" value="true" required /> I confirm this exact transaction should be recorded.</label>
      <button disabled={expired || confirming || rejecting} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-50">{confirming ? 'Recording…' : 'Confirm transaction'}</button>
    </form>
    <form action={reject}><input type="hidden" name="proposalId" value={p.id} /><button disabled={confirming || rejecting} className="text-sm underline">Reject draft</button></form>
  </section>;
}
