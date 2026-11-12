import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../_components/page-shell';
import { listAccounts, listCategories, listTransactionProposalPage } from '@/server/services';
import { currency, Money } from '@/lib/decimal/money';
import { loadMoneyContext } from '../_page-data';
import { ProposalReview } from './_review';
import { TransactionDraftForm } from './_draft';
import { isTier1GenerationReleased } from '@/server/ai-feature-release';

export const metadata: Metadata = { title: 'Transaction drafts' };
export default async function TransactionProposalsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const { ctx, format } = await loadMoneyContext('/money/proposals');
  const params = await searchParams ?? {};
  const [result, accounts, categories] = await Promise.all([listTransactionProposalPage(ctx, params.page ?? 1), listAccounts(ctx), listCategories(ctx)]);
  const proposals = result.ok ? result.value.items : [];
  const choices = accounts.filter(a => a.isActive).map(a => ({ id: a.id, name: a.name, currency: a.currency }));
  return <>
    <PageHeader title="Transaction drafts" description="Review unconfirmed interpretations, edit and confirm before any transaction is recorded." actions={<nav className="flex gap-4"><Link href="/ai/documents" className="underline">Receipt and statement drafts</Link><Link href="/money">← Manual entry</Link></nav>} />
    <TransactionDraftForm released={isTier1GenerationReleased()} />
    {!result.ok && <p role="alert">Choose a positive whole-number draft page. <Link href="/money/proposals" className="underline">Open the first page</Link></p>}
    {result.ok && !proposals.length && <p className="py-6 text-ink-muted">No transaction drafts to review.</p>}
    <div className="space-y-4">{proposals.map(p => {
      const d = p.normalized;
      const amount = d?.amount && d.currency ? Money.parseUserInput(d.amount, currency(d.currency)) : null;
      const source = choices.find(a => a.id === d?.accountId)?.name;
      const preview = `${d?.kind ?? 'Transaction'} draft${amount?.ok ? ` · ${format.money(amount.value)}` : ''}${source ? ` · ${source}` : ''}`;
      return <ProposalReview key={p.id} id={p.id} draft={d} errors={p.validationErrors ?? {}} expiresAt={new Intl.DateTimeFormat(ctx.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: ctx.timezone }).format(p.expiresAt)} expiresAtIso={p.expiresAt.toISOString()} expired={p.expiresAt.getTime() <= ctx.now.getTime()} preview={preview} accounts={choices} categories={categories.map(c => ({ id: c.id, path: c.path, kind: c.kind }))} />;
    })}</div>
    {result.ok && <nav aria-label="Transaction draft pages" className="flex flex-wrap gap-4 text-sm">
      {result.value.page > 1 && <Link href={`/money/proposals?page=${result.value.page - 1}`} className="underline">Newer drafts</Link>}
      <span>Page {result.value.page}</span>
      {result.value.hasMore && <Link href={`/money/proposals?page=${result.value.page + 1}`} className="underline">Older drafts</Link>}
    </nav>}
  </>;
}
