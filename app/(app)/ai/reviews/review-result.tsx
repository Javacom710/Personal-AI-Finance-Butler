import { reviewSourceUnavailable, type FinancialReview } from '@/server/ai/reviews/review';
import { reviewEvidence } from '@/server/ai/reviews/evidence';
import { SourceValue } from '../answer';
const label = (text: string) => text.replace(/^(data|meta)\./, '').replaceAll('.', ' → ').replaceAll(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');

export function FinancialReviewResult({ review }: { review: FinancialReview }) {
  return <article className="space-y-5" aria-label={review.title}>
    <h2 className="font-semibold">{review.title}</h2>
    {review.sources.some(reviewSourceUnavailable) && <p role="status">Some financial sources are unavailable. This review is incomplete.</p>}
    {(['fact', 'calculation'] as const).map(category => <section key={category} className="space-y-3">
      <h3 className="font-semibold">{category === 'fact' ? 'Facts' : 'Deterministic calculations'}</h3>
      {category === 'fact' && <dl>{Object.entries(review.scope).map(([key, value]) => <div key={key}><dt className="font-medium">{label(key)}</dt><dd>{value}</dd></div>)}</dl>}
      {review.sources.map(source => <details key={source.callId} className="rounded-md border border-border p-3">
        <summary>{label(source.callId).replace(/^get /, '')}{reviewSourceUnavailable(source) ? ' — unavailable' : ''}</summary>
        <dl className="space-y-2">{reviewEvidence(source.result).filter(item => item.category === category).map(item => <div key={item.path}>
          <dt className="text-sm font-medium">{item.path === 'ok' ? 'Source status' : label(item.path)}</dt><dd>{item.path === 'ok' ? item.value ? 'Available' : 'Unavailable' : item.path === 'meta.truncated' ? item.value ? 'Some source rows were omitted.' : 'All source rows are included.' : <SourceValue value={item.value} />}</dd>
        </div>)}</dl>
      </details>)}
    </section>)}
    <section><h3 className="font-semibold">Interpretation</h3><p className="whitespace-pre-wrap">{review.interpretation}</p></section>
    <section><h3 className="font-semibold">Recommendation</h3><p className="whitespace-pre-wrap">{review.recommendation}</p></section>
    <p className="text-sm text-ink-muted">Interpretations and recommendations are model opinions. Figures above come from read-only financial sources. This review changes no financial records.</p>
  </article>;
}
