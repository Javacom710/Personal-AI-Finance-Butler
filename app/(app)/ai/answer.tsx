import type { QuestionAnswer } from '@/server/ai/assistant/question';

/** React renders model and source text as text, never as HTML or executable Markdown. */
export function AssistantAnswer({ answer }: { answer: QuestionAnswer }) {
  return <article className="space-y-4" aria-label="Financial answer">
    <section className="rounded-lg border border-border p-4">
      <h2 className="font-semibold">Interpretation</h2>
      <p className="text-sm text-ink-muted">Model explanation. Check the financial source results below; missing information is unavailable.</p>
      <p className="mt-2 whitespace-pre-wrap">{answer.interpretation}</p>
    </section>
    <section aria-label="Financial source results" className="space-y-3">
      <h2 className="font-semibold">Facts and deterministic calculations</h2>
      {!answer.sources.length && <p>No financial data was read for this answer.</p>}
      {answer.sources.map((source, index) => {
        const partial = !source.failed && hasPartialRows(source.result);
        return <details key={source.callId} className="rounded-lg border border-border p-3">
          <summary>Source {index + 1}: {source.name.replaceAll('_', ' ')}{source.failed ? ' — unavailable' : partial ? ' — partial results' : ''}</summary>
          {partial && <p className="mt-2 text-sm text-ink-muted">Some rows were omitted. Comparisons or rankings based on these rows may be incomplete. Authoritative totals, where supplied, still apply.</p>}
          <SourceValue value={source.result} />
        </details>;
      })}
    </section>
    <p className="text-sm text-ink-muted">This assistant only reads. Record changes through manual entry or a separately confirmed transaction draft. Scenario projections are unavailable.</p>
    <p className="text-xs text-ink-muted">Serving model: {answer.modelId}{answer.fallbackDepth ? ' · Fallback used' : ''}</p>
  </article>;
}

function hasPartialRows(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || !('meta' in value)) return false;
  const meta = value.meta;
  return meta !== null && typeof meta === 'object' && 'truncated' in meta && meta.truncated === true;
}

/** Only projected tool payloads reach here. No metric arithmetic or null-to-zero coercion. */
export function SourceValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>Unavailable</span>;
  if (typeof value !== 'object') return <span className="whitespace-pre-wrap">{String(value)}</span>;
  if (Array.isArray(value)) return value.length ? <ul className="ml-4 list-disc">{value.map((item, index) => <li key={index}><SourceValue value={item} /></li>)}</ul> : <span>No rows</span>;
  const object = value as Record<string, unknown>;
  if ('value' in object && object.value === null && 'unavailableReason' in object) return <span>Unavailable: {typeof object.unavailableReason === 'string' ? object.unavailableReason.replaceAll('_', ' ') : 'no data'}</span>;
  if (object.kind === 'money' && typeof object.amount === 'string' && typeof object.currency === 'string') return <span>{object.currency} {object.amount}</span>;
  if ((object.kind === 'rate' || object.kind === 'quantity' || object.kind === 'price') && typeof (object.value ?? object.units ?? object.amount) === 'string') return <span>{String(object.value ?? object.units ?? object.amount)} ({object.kind})</span>;
  return <dl className="ml-3 space-y-1">{Object.entries(object).map(([key, child]) => <div key={key}>
    <dt className="inline font-medium">{key.replaceAll(/([A-Z])/g, ' $1').replaceAll('_', ' ')}: </dt>
    <dd className="inline"><SourceValue value={child} /></dd>
  </div>)}</dl>;
}
