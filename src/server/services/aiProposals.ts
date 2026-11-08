import 'server-only';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { err, ok, conflict, notFound, insufficientData, validationFailed, type DomainError, type Result } from '../../lib/result';
import { reviewedTransactionSchema, type ProposalErrors } from '../../lib/schemas/ai-entry';
import { Money, currency } from '../../lib/decimal/money';
import { aiProposals } from '../db/schema';
import type { Orchestrator } from '../ai/orchestrator';
import { interpretFinancialDocument } from '../ai/proposals/document-extraction';
import type { DocumentExtractionProposal } from '../ai/proposals/schemas';
import { validateDocumentImages } from './_document-images';
import { interpretTransaction } from '../ai/proposals/transaction-entry';
import { withWriteCtxResult, type ReadCtx, type RequestCtx } from './_ctx';
import { listAccounts } from './accounts';
import { listCategories } from './categories';
import { createTransaction, type TransactionView } from './transactions';
import { createTransfer } from './transfers';
import { proposalFieldErrors, resolveTransactionProposal } from './_ai-proposal-resolution';

const idSchema = z.uuid();
const confirmationSchema = z.object({ proposalId: idSchema, confirmed: z.literal(true), reviewAcknowledged: z.boolean(), values: reviewedTransactionSchema }).strict();
export type ProposalView = typeof aiProposals.$inferSelect;
const editable = ['pending', 'invalid'] as const;

/** Called only by the application composition root; production generation remains disabled. */
export async function draftTransactionProposal(ctx: RequestCtx, text: unknown, orchestrator: Pick<Orchestrator, 'run'>): Promise<Result<ProposalView, DomainError>> {
  const input = z.string().trim().min(1).max(4000).safeParse(text);
  if (!input.success) return err(validationFailed({ text: ['Describe one transaction in at most 4,000 characters.'] }));
  const interpreted = await interpretTransaction(orchestrator, { today: ctx.today, baseCurrency: ctx.base }, input.data);
  if (!interpreted.ok) return err(insufficientData('ai_unavailable', 'A transaction draft could not be generated. No financial record was changed.'));
  const staged = await stageTransactionInterpretations(ctx, [interpreted.value]);
  return staged.ok ? ok(staged.value[0]!) : staged;
}
/** Images become unconfirmed transaction proposals, never ledger records. */
export async function draftDocumentTransactionProposals(ctx: RequestCtx, images: unknown, orchestrator: Orchestrator): Promise<Result<ProposalView[], DomainError>> {
  const input = validateDocumentImages(images);
  if (!input.ok) return err(validationFailed(input.error));
  const interpreted = await interpretFinancialDocument(orchestrator, { today: ctx.today, baseCurrency: ctx.base }, input.value);
  if (!interpreted.ok) return err(insufficientData('ai_unavailable', 'Document drafts could not be generated. No financial record was changed.'));
  if (!interpreted.value.proposal) return err(validationFailed(interpreted.value.errors));
  return stageTransactionInterpretations(ctx, interpreted.value.proposal.transactions.map(proposal => ({ raw: JSON.stringify(proposal), proposal, errors: {} })));
}
interface StageInterpretation { readonly raw: string; readonly proposal: DocumentExtractionProposal['transactions'][number] | null; readonly errors: ProposalErrors }
/** Shared atomic staging for text and document drafts. No model runs in this transaction. */
async function stageTransactionInterpretations(ctx: RequestCtx, interpretations: readonly StageInterpretation[]): Promise<Result<ProposalView[], DomainError>> {
  const [accounts, categories] = await Promise.all([listAccounts(ctx), listCategories(ctx)]);
  const staged = interpretations.map(interpreted => {
    const resolution = interpreted.proposal ? resolveTransactionProposal(interpreted.proposal, accounts, categories) : null;
    return { rawPayload: interpreted.raw, normalized: resolution?.draft ?? null, validationErrors: resolution?.errors ?? interpreted.errors, status: resolution ? 'pending' as const : 'invalid' as const };
  });
  return withWriteCtxResult(ctx, async w => {
    const rows = await w.tx.insert(aiProposals).values(staged.map(row => ({ ...row, userId: w.userId, createdAt: w.now, expiresAt: new Date(w.now.getTime() + 86_400_000) }))).returning();
    if (rows.length !== interpretations.length) throw new Error('Proposal insertion returned an unexpected row count.');
    return ok(rows);
  });
}

function editableTransactionProposals(ctx: ReadCtx) {
  return ctx.db.select().from(aiProposals).where(and(eq(aiProposals.userId, ctx.userId), inArray(aiProposals.status, [...editable]))).orderBy(desc(aiProposals.createdAt), desc(aiProposals.id));
}
export async function listTransactionProposals(ctx: ReadCtx): Promise<ProposalView[]> {
  return editableTransactionProposals(ctx).limit(50);
}
const proposalPageSchema = z.union([z.number(), z.string().regex(/^[1-9]\d*$/).transform(Number)]).pipe(z.number().int().min(1).max(Math.floor(Number.MAX_SAFE_INTEGER / 50)));
export async function listTransactionProposalPage(ctx: ReadCtx, page: unknown = 1): Promise<Result<{ items: ProposalView[]; page: number; hasMore: boolean }, DomainError>> {
  const parsed = proposalPageSchema.safeParse(page);
  if (!parsed.success) return err(validationFailed({ page: ['Choose a positive whole-number draft page.'] }));
  const rows = await editableTransactionProposals(ctx).limit(51).offset((parsed.data - 1) * 50);
  return ok({ items: rows.slice(0, 50), page: parsed.data, hasMore: rows.length > 50 });
}
export async function getTransactionProposal(ctx: ReadCtx, id: string): Promise<Result<ProposalView, DomainError>> {
  if (!idSchema.safeParse(id).success) return err(validationFailed({ proposalId: ['Invalid proposal identifier.'] }));
  const [row] = await ctx.db.select().from(aiProposals).where(and(eq(aiProposals.id, id), eq(aiProposals.userId, ctx.userId))).limit(1);
  if (!row) return err(notFound('proposal'));
  return ok(row);
}

/** Claim + ordinary manual command + linkage + audit commit or roll back together. */
export async function applyTransactionProposal(ctx: RequestCtx, raw: unknown): Promise<Result<TransactionView, DomainError>> {
  const parsed = confirmationSchema.safeParse(raw);
  if (!parsed.success) return err(validationFailed(Object.fromEntries(Object.entries(proposalFieldErrors(parsed.error)).map(([key, errors]) => [key.replace(/^values\./, ''), errors]))));
  const input = parsed.data;
  return withWriteCtxResult(ctx, async w => {
    // No-op CAS locks the eligible row. A concurrent confirmation rechecks this
    // predicate after the winner commits and cannot create a second transaction.
    const [proposal] = await w.tx.update(aiProposals).set({ status: sql`${aiProposals.status}` }).where(and(eq(aiProposals.id, input.proposalId), eq(aiProposals.userId, w.userId), inArray(aiProposals.status, [...editable]), gt(aiProposals.expiresAt, w.now))).returning();
    if (!proposal) return err(conflict('This proposal is expired, rejected, already applied, or unavailable.'));
    if ((proposal.status === 'invalid' || Object.keys(proposal.validationErrors ?? {}).length) && !input.reviewAcknowledged) return err(validationFailed({ reviewAcknowledged: ['Review and acknowledge all highlighted issues before confirming.'] }));
    const v = input.values;
    const accounts = await listAccounts(w);
    const account = accounts.find(a => a.id === v.accountId);
    const destination = accounts.find(a => a.id === v.toAccountId);
    if (!account || !account.isActive) return err(validationFailed({ accountId: ['Choose an active account you own.'] }));
    if (account.currency !== v.currency) return err(validationFailed({ currency: ['The amount currency must match the selected account.'] }));
    let created: Result<TransactionView, DomainError>;
    const options = { source: 'ai' as const, aiProposalId: proposal.id };
    if (v.kind === 'transfer') {
      if (!destination || !destination.isActive) return err(validationFailed({ toAccountId: ['Choose an active destination you own.'] }));
      if (account.currency !== destination.currency && !v.toAmount) return err(validationFailed({ toAmount: ['Enter the credited amount; no exchange amount is inferred.'] }));
      if (account.currency === destination.currency && v.toAmount) {
        const from = Money.parseUserInput(v.amount, currency(v.currency)); const to = Money.parseUserInput(v.toAmount, currency(v.currency));
        if (!from.ok || !to.ok || from.value.minor !== to.value.minor) return err(validationFailed({ toAmount: ['Same-currency transfer amounts must match.'] }));
      }
      const transfer = await createTransfer(w, { fromAccountId: v.accountId, toAccountId: v.toAccountId, ...(account.currency === destination.currency ? { amount: v.amount } : { fromAmount: v.amount, toAmount: v.toAmount }), bookedOn: v.bookedOn, description: v.description, notes: v.notes ?? undefined, tags: v.tags }, options);
      created = transfer.ok ? ok(transfer.value.transaction) : transfer;
    } else {
      const categories = await listCategories(w);
      if (!categories.some(c => c.id === v.categoryId && c.kind === v.kind)) return err(validationFailed({ categoryId: ['Choose a current category of the matching kind.'] }));
      created = await createTransaction(w, { kind: v.kind, accountId: v.accountId, categoryId: v.categoryId, amount: v.amount, bookedOn: v.bookedOn, description: v.description, notes: v.notes ?? undefined, tags: v.tags }, options);
    }
    if (!created.ok) return created;
    const [applied] = await w.tx.update(aiProposals).set({ status: 'applied', normalized: v, validationErrors: {}, appliedAt: w.now, appliedEntityId: created.value.id }).where(and(eq(aiProposals.id, proposal.id), inArray(aiProposals.status, [...editable]))).returning({ id: aiProposals.id });
    if (!applied) return err(conflict('Proposal confirmation lost its claim.'));
    await w.audit.record({ actor: 'ai_confirmed', action: 'ai_proposal.apply', entityType: 'ai_proposal', entityId: proposal.id, after: { transactionId: created.value.id } });
    return created;
  });
}
export async function rejectTransactionProposal(ctx: RequestCtx, id: unknown): Promise<Result<void, DomainError>> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return err(validationFailed({ proposalId: ['Invalid proposal identifier.'] }));
  return withWriteCtxResult(ctx, async w => {
    const [row] = await w.tx.update(aiProposals).set({ status: 'rejected' }).where(and(eq(aiProposals.id, parsed.data), eq(aiProposals.userId, w.userId), inArray(aiProposals.status, [...editable]))).returning({ id: aiProposals.id });
    if (!row) return err(conflict('Proposal is unavailable or already resolved.'));
    return ok(undefined);
  });
}
