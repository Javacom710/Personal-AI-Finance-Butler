'use client';
import { useActionState } from 'react';
import { EMPTY_ACTION_STATE } from '../money/form-state';
import { manageConversationAction } from './actions';
const INPUT = 'rounded-md border border-border bg-surface px-3 py-2 text-sm';
export function ConversationManagement({ id, title, archived }: { id?: string; title?: string; archived?: boolean }) {
  const [state, action, pending] = useActionState(manageConversationAction, EMPTY_ACTION_STATE);
  if (id && state.status === 'ok' && state.message === 'Conversation and messages deleted.') return <p role="status">{state.message}</p>;
  return <section className="space-y-3" aria-label="Conversation management">
    {state.message && <p role={state.status === 'error' ? 'alert' : 'status'}>{state.message}</p>}
    <form action={action} className="flex flex-wrap items-end gap-2">
      {id && <input type="hidden" name="conversationId" value={id} />}
      <input type="hidden" name="operation" value={id ? 'rename' : 'create'} />
      <label>Conversation title<input name="title" defaultValue={title ?? ''} required maxLength={120} className={`ml-2 ${INPUT}`} /></label>
      <button disabled={pending} className={INPUT}>{id ? 'Rename' : 'New conversation'}</button>
    </form>
    {id && <>
      <form action={action}><input type="hidden" name="conversationId" value={id} /><input type="hidden" name="operation" value={archived ? 'restore' : 'archive'} /><button disabled={pending} className="underline">{archived ? 'Restore conversation' : 'Archive conversation'}</button></form>
      <details><summary>Delete conversation</summary><p className="my-2 text-sm">This permanently deletes this conversation and all its saved messages. Financial records are unchanged.</p>
        <form action={action} className="space-y-2"><input type="hidden" name="conversationId" value={id} /><input type="hidden" name="operation" value="delete" />
          <label className="block"><input type="checkbox" name="confirmed" value="true" required /> Delete this conversation and all its messages.</label>
          <button disabled={pending} className="text-danger underline">Permanently delete</button>
        </form>
      </details>
    </>}
  </section>;
}
