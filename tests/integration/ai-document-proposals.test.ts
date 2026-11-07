import { afterAll, beforeEach, expect, it } from 'vitest';
import { aiProposals } from '@/server/db/schema';
import { verifyIntegrity } from '@/server/db/integrity';
import { applyTransactionProposal, draftDocumentTransactionProposals, getTransactionProposal, listTransactionProposalPage, type ProposalView } from '@/server/services/aiProposals';
import { fakeDocumentProvider, DOCUMENT_PNG } from '../helpers/fake-document-provider';
import { syntheticTransaction } from '../helpers/fake-transaction-interpreter';
import { closeHarness, database, truncateAll } from './harness';
import { closeMoneyHarness, makeAccount, must, rawSql, setupMoneyFixture, type MoneyFixture } from './money-harness';
let f: MoneyFixture;
beforeEach(async () => { await truncateAll(); f = await setupMoneyFixture(); await makeAccount(f.ctx, { name: 'Bank' }); await makeAccount(f.ctx, { name: 'Cash', kind: 'cash' }); });
afterAll(async () => { await closeMoneyHarness(); await closeHarness(); });
async function counts() { return (await rawSql("select (select count(*)::int from ai_proposals) as proposals, (select count(*)::int from transactions) as transactions, (select count(*)::int from transaction_entries) as entries, (select count(*)::int from audit_log where actor = 'ai_confirmed') as audits")).rows[0] as { proposals: number; transactions: number; entries: number; audits: number }; }
async function stage(lines = [syntheticTransaction({ amount: '12.3400' })]) { return must(await draftDocumentTransactionProposals(f.ctx, [DOCUMENT_PNG], fakeDocumentProvider({ transactions: lines }).orchestrator)); }
const confirm = (p: ProposalView, values = {}, acknowledged = true, ctx = f.ctx) => applyTransactionProposal(ctx, { proposalId: p.id, confirmed: true, reviewAcknowledged: acknowledged, values: { ...p.normalized, ...values } });
it('stages a whole document batch with exact decimal strings and 24-hour expiry, retaining no image or reasoning', async () => {
  const rows = await stage([syntheticTransaction({ amount: '12.3400', description: 'First receipt' }), syntheticTransaction({ amount: '0.0001', description: 'Second receipt' })]);
  expect(rows).toHaveLength(2); expect(rows.map(p => p.normalized?.amount)).toEqual(expect.arrayContaining(['12.3400', '0.0001']));
  for (const p of rows) { expect(p.expiresAt.getTime() - p.createdAt.getTime()).toBe(86400000); expect(p.rawPayload).not.toContain(DOCUMENT_PNG.data); expect(p.rawPayload).not.toContain('Private test reasoning'); }
  expect(await counts()).toEqual({ proposals: 2, transactions: 0, entries: 0, audits: 0 });
});
it('uses the existing confirmation/manual service path with atomic I-10 linkage and rejects replay', async () => {
  const [p] = await stage(); const applied = must(await confirm(p!));
  expect(applied.source).toBe('ai'); expect(applied.amount.minor).toBe(123400n);
  const current = must(await getTransactionProposal(f.ctx, p!.id)); expect(current.appliedEntityId).toBe(applied.id); expect(current.status).toBe('applied');
  expect(await counts()).toEqual({ proposals: 1, transactions: 1, entries: 1, audits: 2 });
  expect((await confirm(p!)).ok).toBe(false);
  const report = await verifyIntegrity(process.env.TEST_DATABASE_URL!); expect(report.checks.find(c => c.invariant === 'I-10')?.status).toBe('passed');
});
it('keeps missing date and amount blank with field errors until the owner supplies values and acknowledges the review', async () => {
  const [p] = await stage([syntheticTransaction({ bookedOn: null, amount: null, confidence: 'low', ambiguities: ['Printed fields are unreadable.'] })]);
  expect(p?.normalized).toMatchObject({ bookedOn: null, amount: null }); expect(p?.validationErrors).toHaveProperty('bookedOn'); expect(p?.validationErrors).toHaveProperty('amount');
  expect((await confirm(p!)).ok).toBe(false);
  expect((await confirm(p!, { bookedOn: '2026-08-10', amount: '12.3400' }, false)).ok).toBe(false);
  expect((await confirm(p!, { bookedOn: '2026-08-10', amount: '12.3400' })).ok).toBe(true);
});
it('isolates drafts and confirmation by owner and refuses expired proposals', async () => {
  const [p] = await stage(); const other = await setupMoneyFixture();
  expect((await getTransactionProposal(other.ctx, p!.id)).ok).toBe(false); expect((await confirm(p!, {}, true, other.ctx)).ok).toBe(false);
  const expired = { ...f.ctx, now: new Date(f.ctx.now.getTime() + 86400000) };
  expect((await confirm(p!, {}, true, expired)).ok).toBe(false); expect((await counts()).transactions).toBe(0);
});
it('routes a document transfer through the same confirmed transfer service without making income or expense entries', async () => {
  const [p] = await stage([syntheticTransaction({ kind: 'transfer', amount: '99.9900', toAccountHint: 'Cash', categoryHint: null })]);
  const applied = must(await confirm(p!)); expect(applied.kind).toBe('transfer'); expect((await counts()).entries).toBe(2);
  const report = await verifyIntegrity(process.env.TEST_DATABASE_URL!); expect(report.checks.find(c => c.invariant === 'I-10')?.status).toBe('passed');
});
it.each([{ amount: 12.34 }, { kind: 'buy' }])('rejects malformed or unsupported investment output before creating any proposal or financial record: %s', async patch => {
  const result = await draftDocumentTransactionProposals(f.ctx, [DOCUMENT_PNG], fakeDocumentProvider({ transactions: [syntheticTransaction(patch)] }).orchestrator);
  expect(result.ok).toBe(false); if (!result.ok) expect(result.error.code).toBe('validation_failed');
  expect(await counts()).toEqual({ proposals: 0, transactions: 0, entries: 0, audits: 0 });
});
it('rolls back the entire staged batch if a later proposal insert fails', async () => {
  await rawSql("CREATE FUNCTION test_document_stage_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.normalized->>'description' = 'Fail staged' THEN RAISE EXCEPTION 'forced staging failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_document_stage_failure BEFORE INSERT ON ai_proposals FOR EACH ROW EXECUTE FUNCTION test_document_stage_failure()");
  try { await expect(stage([syntheticTransaction({ description: 'First staged' }), syntheticTransaction({ description: 'Fail staged' })])).rejects.toThrow(); }
  finally { await rawSql('DROP TRIGGER test_document_stage_failure ON ai_proposals; DROP FUNCTION test_document_stage_failure()'); }
  expect(await counts()).toEqual({ proposals: 0, transactions: 0, entries: 0, audits: 0 });
});
it('keeps every batch draft reachable beyond fifty, with equal-timestamp ordering and owner isolation', async () => {
  const rows: ProposalView[] = [];
  for (const length of [20, 20, 15]) rows.push(...await stage(Array.from({ length }, (_, i) => syntheticTransaction({ description: `Receipt item ${i}` }))));
  const other = await setupMoneyFixture(); await makeAccount(other.ctx, { name: 'Bank' });
  const otherRows = must(await draftDocumentTransactionProposals(other.ctx, [DOCUMENT_PNG], fakeDocumentProvider().orchestrator));
  const first = must(await listTransactionProposalPage(f.ctx)); const second = must(await listTransactionProposalPage(f.ctx, '2'));
  expect(first.items).toHaveLength(50); expect(first.hasMore).toBe(true); expect(second.items).toHaveLength(5); expect(second.hasMore).toBe(false);
  expect([...first.items, ...second.items].map(p => p.id)).toEqual(rows.map(p => p.id).sort().reverse());
  expect([...first.items, ...second.items].some(p => p.id === otherRows[0]?.id)).toBe(false);
  expect(must(await listTransactionProposalPage(f.ctx, 3)).items).toEqual([]);
});
it('rejects malformed page parameters before any database access', async () => {
  const noDatabase = { ...f.ctx, db: undefined } as unknown as typeof f.ctx;
  for (const value of [0, -1, 1.5, '1e2', '01', ['1', '2'], Number.MAX_SAFE_INTEGER]) expect((await listTransactionProposalPage(noDatabase, value)).ok).toBe(false);
  expect(await database().select().from(aiProposals)).toHaveLength(0);
});
