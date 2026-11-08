'use client';
import { useActionState, useId, useState } from 'react';
import { EMPTY_ACTION_STATE } from '../form-state';
import { draftTransactionAction } from './actions';

export function TransactionDraftForm({ released }: { released: boolean }) {
  const [state, submit, pending] = useActionState(draftTransactionAction, EMPTY_ACTION_STATE);
  const [text, setText] = useState('');
  const id = useId();
  const disabled = !released || pending;
  return <section className="space-y-3 rounded-lg border border-border p-4" aria-label="Describe a transaction">
    <h2 className="font-semibold">Describe a transaction</h2>
    <p id={`${id}-help`} className="text-sm text-ink-muted">{released ? 'Describe one transaction. Review and confirm the draft before anything is recorded.' : 'Natural-language drafts are awaiting setup approval. Manual entry remains available.'}</p>
    {state.message && <p role="alert">{state.message}</p>}
    {Object.entries(state.fieldErrors).map(([name, messages]) => <p key={name} id={name === 'text' ? `${id}-error` : undefined} role="alert" className="text-sm text-danger">{messages.join(' ')}</p>)}
    <form action={submit} className="space-y-3" aria-busy={pending}>
      <label className="block" htmlFor={id}>Description</label>
      <textarea id={id} name="text" value={text} onChange={e => setText(e.target.value)} required maxLength={4000} disabled={disabled} aria-invalid={!!state.fieldErrors.text?.length} aria-describedby={`${id}-help${state.fieldErrors.text?.length ? ` ${id}-error` : ''}`} placeholder="Spent ₹1,250 on dinner yesterday from my card" className="w-full rounded-md border border-border bg-surface p-3" />
      <button disabled={disabled} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-50">{pending ? 'Creating draft…' : 'Create draft'}</button>
    </form>
  </section>;
}
