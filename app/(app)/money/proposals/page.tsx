import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../_components/page-shell';
import { listAccounts, listCategories, listTransactionProposals } from '@/server/services';
import { currency, Money } from '@/lib/decimal/money';
import { loadMoneyContext } from '../_page-data';
import { ProposalReview } from './_review';

export const metadata: Metadata = { title: 'Transaction drafts' };
export default async function TransactionProposalsPage() {
  const { ctx, format } = await loadMoneyContext('/money/proposals');
  const [proposals, accounts, categories] = await Promise.all([listTransactionProposals(ctx), listAccounts(ctx), listCategories(ctx)]);
  const choices = accounts.filter(a => a.isActive).map(a => ({ id: a.id, name: a.name, currency: a.currency }));
  return <>
    <PageHeader title="Transaction drafts" description="Review, edit and confirm before any transaction is recorded." actions={<Link href="/money">← Manual entry</Link>} />
    <section className="space-y-2 rounded-lg border border-border p-4">
      <h2 className="font-semibold">Describe a transaction</h2>
      <p className="text-sm text-ink-muted">Natural-language drafts are awaiting setup approval. Manual entry remains available.</p>
      <label className="block">Description<textarea disabled placeholder="Spent ₹1,250 on dinner yesterday from my card" className="w-full rounded-md border border-border bg-surface p-3" /></label>
      <button disabled className="rounded-md bg-accent px-3 py-2 text-accent-ink opacity-50">Create draft</button>
    </section>
    {!proposals.length && <p className="py-6 text-ink-muted">No transaction drafts to review.</p>}
    <div className="space-y-4">{proposals.map(p => {
      const d = p.normalized;
      const amount = d?.amount && d.currency ? Money.parseUserInput(d.amount, currency(d.currency)) : null;
      const source = choices.find(a => a.id === d?.accountId)?.name;
      const preview = `${d?.kind ?? 'Transaction'} draft${amount?.ok ? ` · ${format.money(amount.value)}` : ''}${source ? ` · ${source}` : ''}`;
      return <ProposalReview key={p.id} id={p.id} draft={d} errors={p.validationErrors ?? {}} expiresAt={new Intl.DateTimeFormat(ctx.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: ctx.timezone }).format(p.expiresAt)} expiresAtIso={p.expiresAt.toISOString()} expired={p.expiresAt.getTime() <= ctx.now.getTime()} preview={preview} accounts={choices} categories={categories.map(c => ({ id: c.id, path: c.path, kind: c.kind }))} />;
    })}</div>
  </>;
}
