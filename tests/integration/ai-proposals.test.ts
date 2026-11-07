import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db/client';
import { deleteTransaction, setAccountActive, withWriteCtxResult, type RequestCtx } from '@/server/services';
import { applyTransactionProposal, draftTransactionProposal, getTransactionProposal, rejectTransactionProposal } from '@/server/services/aiProposals';
import { verifyIntegrity } from '@/server/db/integrity';
import { aiProposals } from '@/server/db/schema';
import { fakeTransactionInterpreter, syntheticTransaction } from '../helpers/fake-transaction-interpreter';
import { closeHarness, truncateAll } from './harness';
import { addFxRate, refreshCtx, categoryId, closeMoneyHarness, makeAccount, must, rawSql, setupMoneyFixture, type MoneyFixture } from './money-harness';

let f: MoneyFixture; let bank: string; let dining: string;
beforeEach(async () => { await truncateAll(); f = await setupMoneyFixture(); bank = await makeAccount(f.ctx, { name: 'Bank' }); dining = await categoryId(f.ctx, 'Dining'); });
afterAll(async () => { await closeMoneyHarness(); await closeHarness(); });
const values = () => ({ kind: 'expense', bookedOn: '2026-08-10', description: 'Dinner', amount: '1250.50', currency: 'INR', accountId: bank, toAccountId: null, categoryId: dining, toAmount: null, notes: null, tags: [] });
async function draft(over: Record<string, unknown> = {}) {
  const fake = fakeTransactionInterpreter([JSON.stringify(syntheticTransaction(over))]);
  return must(await draftTransactionProposal(f.ctx, 'Dinner from Bank', fake.orchestrator));
}
const confirm = (id: string, over: Record<string, unknown> = {}, ctx: RequestCtx = f.ctx) => applyTransactionProposal(ctx, { proposalId: id, confirmed: true, reviewAcknowledged: true, values: { ...values(), ...over } });
async function counts(): Promise<{ transactions: number; entries: number; audits: number }> { return (await rawSql('select (select count(*)::int from transactions) as transactions, (select count(*)::int from transaction_entries) as entries, (select count(*)::int from audit_log where actor = \'ai_confirmed\') as audits')).rows[0] as { transactions: number; entries: number; audits: number }; }

describe('transaction proposal lifecycle', () => {
  it('drafts through a fake provider without changing the ledger and expires exactly after 24 hours', async () => {
    const p = await draft();
    expect(p.status).toBe('pending'); expect(p.normalized?.accountId).toBe(bank); expect(p.normalized?.categoryId).toBe(dining);
    expect(p.expiresAt.getTime() - p.createdAt.getTime()).toBe(86_400_000);
    expect(await counts()).toEqual({ transactions: 0, entries: 0, audits: 0 });
  });
  it('uses the ordinary transaction service and atomically records linkage and both confirmation audits', async () => {
    const p = await draft(); const txn = must(await confirm(p.id));
    expect(txn.source).toBe('ai'); expect(txn.amount.minor).toBe(12_505_000n);
    const applied = must(await getTransactionProposal(f.ctx, p.id)); expect(applied.status).toBe('applied'); expect(applied.appliedEntityId).toBe(txn.id);
    expect(await counts()).toEqual({ transactions: 1, entries: 1, audits: 2 });
    const linked = await rawSql('select ai_proposal_id from transactions'); expect((linked.rows[0] as { ai_proposal_id: string }).ai_proposal_id).toBe(p.id);
    const report = await verifyIntegrity(process.env['TEST_DATABASE_URL']!); expect(report.checks.find(c => c.invariant === 'I-10')?.status).toBe('passed'); expect(report.passed).toBe(true);
  });
  it('serializes simultaneous confirmations and repeated requests to exactly one financial record', async () => {
    const p = await draft(); const results = await Promise.all([confirm(p.id), confirm(p.id)]);
    expect(results.filter(r => r.ok)).toHaveLength(1); expect((await confirm(p.id)).ok).toBe(false);
    expect(await counts()).toEqual({ transactions: 1, entries: 1, audits: 2 });
  });
  it.each([86_400_000, 86_400_001])('refuses expired confirmation at elapsed %d ms', async ms => {
    const p = await draft(); const expired = { ...f.ctx, now: new Date(f.ctx.now.getTime() + ms) };
    expect((await confirm(p.id, {}, expired)).ok).toBe(false); expect((await counts()).transactions).toBe(0);
  });
  it('allows an unexpired confirmation just before expiry', async () => {
    const p = await draft(); expect((await confirm(p.id, {}, { ...f.ctx, now: new Date(f.ctx.now.getTime() + 86_399_999) })).ok).toBe(true);
  });
  it('rejects a draft without ledger writes and never applies it later', async () => {
    const p = await draft(); must(await rejectTransactionProposal(f.ctx, p.id)); expect((await confirm(p.id)).ok).toBe(false); expect((await counts()).transactions).toBe(0);
  });
  it('isolates reads, rejection and confirmation by owner', async () => {
    const p = await draft(); const other = await setupMoneyFixture();
    expect((await getTransactionProposal(other.ctx, p.id)).ok).toBe(false); expect((await rejectTransactionProposal(other.ctx, p.id)).ok).toBe(false);
    expect((await confirm(p.id, {}, other.ctx)).ok).toBe(false); expect((await counts()).transactions).toBe(0);
  });
  it('refuses an account closed after drafting, leaving the proposal and ledger unchanged', async () => {
    const p = await draft(); must(await withWriteCtxResult(f.ctx, w => setAccountActive(w, bank, false)));
    expect((await confirm(p.id)).ok).toBe(false); expect(must(await getTransactionProposal(f.ctx, p.id)).status).toBe('pending'); expect((await counts()).transactions).toBe(0);
  });
  it('rechecks account ownership instead of trusting edited identifiers', async () => {
    const p = await draft(); const other = await setupMoneyFixture(); const foreign = await makeAccount(other.ctx, { name: 'Foreign' });
    expect((await confirm(p.id, { accountId: foreign })).ok).toBe(false); expect((await counts()).transactions).toBe(0);
  });
  it('refuses incompatible account currency, category kind, dates and JSON-number amounts', async () => {
    const p = await draft(); const salary = await categoryId(f.ctx, 'Salary');
    for (const over of [{ currency: 'USD' }, { categoryId: salary }, { bookedOn: '2010-01-01' }, { amount: 123 }, { amount: null }, { amount: '0' }]) expect((await confirm(p.id, over)).ok).toBe(false);
    expect((await counts()).transactions).toBe(0);
  });
  it('requires explicit confirmation and acknowledgement of ambiguous/missing fields', async () => {
    const p = await draft({ amount: null, confidence: 'low', ambiguities: ['Amount missing'] });
    expect(p.validationErrors?.amount).toBeDefined();
    expect((await applyTransactionProposal(f.ctx, { proposalId: p.id, confirmed: false, reviewAcknowledged: true, values: values() })).ok).toBe(false);
    expect((await applyTransactionProposal(f.ctx, { proposalId: p.id, confirmed: true, reviewAcknowledged: false, values: values() })).ok).toBe(false);
    expect((await confirm(p.id)).ok).toBe(true);
  });
  it('persists twice-malformed output as invalid with field errors and permits explicit correction', async () => {
    const fake = fakeTransactionInterpreter(['not-json', JSON.stringify(syntheticTransaction({ amount: 123 }))]);
    const p = must(await draftTransactionProposal(f.ctx, 'Dinner', fake.orchestrator));
    expect(fake.requests).toHaveLength(2); expect(p.status).toBe('invalid'); expect(p.validationErrors?.amount).toBeDefined(); expect(p.normalized).toBeNull();
    expect((await confirm(p.id)).ok).toBe(true);
  });
  it('keeps capability gates intact and calls no provider when declared-only', async () => {
    const fake = fakeTransactionInterpreter([JSON.stringify(syntheticTransaction())], f.ctx.now, false);
    expect((await draftTransactionProposal(f.ctx, 'Dinner', fake.orchestrator)).ok).toBe(false); expect(fake.requests).toHaveLength(0);
    expect((await db().select().from(aiProposals))).toHaveLength(0);
  });
  it('uses the same transfer service without counting transfers as income or expense', async () => {
    const cash = await makeAccount(f.ctx, { name: 'Cash', kind: 'cash' });
    const p = await draft({ kind: 'transfer', toAccountHint: 'Cash', categoryHint: null });
    const txn = must(await confirm(p.id, { kind: 'transfer', toAccountId: cash, categoryId: null }));
    expect(txn.kind).toBe('transfer'); expect(txn.entries).toHaveLength(2); expect(txn.categoryId).toBeNull(); expect((await counts()).audits).toBe(2);
  });
  it('rolls back an FX failure without applying the proposal or creating partial ledger/audits', async () => {
    const usd = await makeAccount(f.ctx, { name: 'USD', currencyCode: 'USD' });
    const p = await draft();
    expect((await confirm(p.id, { currency: 'USD', accountId: usd })).ok).toBe(false);
    expect(must(await getTransactionProposal(f.ctx, p.id)).status).toBe('pending'); expect((await counts()).transactions).toBe(0);
  });
  it('rejects applying a proposal directly without its confirmation audit at database commit', async () => {
    const p = await draft();
    await expect(rawSql(`update ai_proposals set status='applied', applied_at=created_at, applied_entity_id='11111111-1111-4111-8111-111111111111' where id='${p.id}'`)).rejects.toThrow(/audit/);
  });
  it('retains I-10 proof if the user later deletes the confirmed transaction', async () => {
    const p = await draft(); const txn = must(await confirm(p.id));
    must(await withWriteCtxResult(f.ctx, w => deleteTransaction(w, txn.id)));
    expect((await verifyIntegrity(process.env['TEST_DATABASE_URL']!)).passed).toBe(true);
  });
  it('returns field-level amount errors with keys the review form can highlight', async () => {
    const p = await draft(); const result = await confirm(p.id, { amount: 1.25 });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === 'validation_failed') expect(result.error.fieldErrors.amount).toBeDefined();
  });
  it('requires the actual credited amount for cross-currency transfers', async () => {
    const usd = await makeAccount(f.ctx, { name: 'USD', currencyCode: 'USD' });
    await addFxRate('USD', 'INR', '2026-08-10', '80'); f = { ...f, ctx: await refreshCtx(f) };
    const p = await draft({ kind: 'transfer', toAccountHint: 'USD', categoryHint: null });
    expect((await confirm(p.id, { kind: 'transfer', toAccountId: usd, categoryId: null })).ok).toBe(false);
    const result = must(await confirm(p.id, { kind: 'transfer', amount: '800', toAmount: '10', toAccountId: usd, categoryId: null }));
    expect(result.entries.map(e => e.amount.minor)).toEqual(expect.arrayContaining([-8_000_000n, 100_000n]));
  });
  it('refuses to change the amount of a same-currency transfer through a credited amount', async () => {
    const cash = await makeAccount(f.ctx, { name: 'Cash' }); const p = await draft({ kind: 'transfer', toAccountHint: 'Cash', categoryHint: null });
    expect((await confirm(p.id, { kind: 'transfer', toAccountId: cash, categoryId: null, toAmount: '999' })).ok).toBe(false);
    expect((await counts()).transactions).toBe(0);
  });
  it('rolls back all financial writes, tags, audits and version bumps when final audit insertion fails', async () => {
    const p = await draft();
    const before = await rawSql('select money_ledger_version from user_state where user_id=$1', [f.ctx.userId]);
    await rawSql(`create function fail_phase9_audit() returns trigger language plpgsql as $$ begin if NEW.action = 'ai_proposal.apply' then raise exception 'synthetic audit failure'; end if; return NEW; end $$`);
    await rawSql('create trigger phase9_audit_failure before insert on audit_log for each row execute function fail_phase9_audit()');
    try { await expect(confirm(p.id, { tags: ['must roll back'] })).rejects.toMatchObject({ cause: expect.objectContaining({ message: 'synthetic audit failure' }) }); }
    finally { await rawSql('drop trigger phase9_audit_failure on audit_log'); await rawSql('drop function fail_phase9_audit()'); }
    expect(await counts()).toEqual({ transactions: 0, entries: 0, audits: 0 });
    expect((await rawSql('select money_ledger_version from user_state where user_id=$1', [f.ctx.userId])).rows).toEqual(before.rows);
    expect(must(await getTransactionProposal(f.ctx, p.id)).status).toBe('pending');
    expect((await rawSql('select id from tags where user_id=$1', [f.ctx.userId])).rows).toHaveLength(0);
  });
  it('enforces the partial unique proposal index independently of service CAS', async () => {
    const p = await draft(); must(await confirm(p.id));
    await expect(rawSql(`insert into transactions (user_id,kind,booked_on,description,category_id,source,ai_proposal_id)
      select user_id,kind,booked_on,description,category_id,source,ai_proposal_id from transactions where ai_proposal_id=$1`, [p.id])).rejects.toThrow(/unique|duplicate/);
  });

});
