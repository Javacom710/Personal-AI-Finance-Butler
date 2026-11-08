'use client';
import { useActionState, useId, useState } from 'react';
import { EMPTY_ACTION_STATE } from '../money/form-state';
import { askFinanceQuestionAction } from './actions';

export function QuestionForm({ conversationId, released, blockedReason }: { conversationId: string; released: boolean; blockedReason?: string }) {
  const [state, submit, pending] = useActionState(askFinanceQuestionAction, EMPTY_ACTION_STATE);
  const [question, setQuestion] = useState('');
  const id = useId();
  const errors = 'fieldErrors' in state ? state.fieldErrors : {};
  const disabled = !released || !!blockedReason || pending;
  return <section className="space-y-3 rounded-lg border border-border p-4" aria-label="Ask in this conversation">
    <h2 className="font-semibold">Your next question</h2>
    <p id={`${id}-help`} className="text-sm text-ink-muted">{!released ? 'Questions remain unavailable until setup approval.' : 'Ask a routine financial question. Advanced analysis and scenario projections are unavailable.'}</p>
    {blockedReason && <p className="text-sm text-ink-muted">{blockedReason}</p>}
    {state.message && <p role="alert">{state.message}</p>}
    {Object.entries(errors).map(([name, messages]) => <p key={name} id={name === 'question' ? `${id}-error` : undefined} role="alert" className="text-sm text-danger">{messages.join(' ')}</p>)}
    <form action={submit} className="space-y-3" aria-busy={pending}>
      <input type="hidden" name="conversationId" value={conversationId} />
      <label className="block" htmlFor={id}>Your question</label>
      <textarea id={id} name="question" value={question} onChange={e => setQuestion(e.target.value)} required maxLength={4000} disabled={disabled} aria-invalid={!!errors.question?.length} aria-describedby={`${id}-help${errors.question?.length ? ` ${id}-error` : ''}`} placeholder="What is my account balance?" className="w-full rounded-md border border-border bg-surface p-3" />
      <button disabled={disabled} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-50">{pending ? 'Answering…' : 'Ask about my finances'}</button>
    </form>
    <p className="text-sm text-ink-muted">The assistant only reads. Review source facts and deterministic calculations separately from its interpretation. Missing data stays unavailable.</p>
  </section>;
}
