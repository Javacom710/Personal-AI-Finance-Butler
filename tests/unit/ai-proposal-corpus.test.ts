import { describe, expect, it } from 'vitest';
import { TransactionProposal } from '@/server/ai/proposals/schemas';
import { reviewedTransactionSchema } from '@/lib/schemas/ai-entry';
import { resolveTransactionProposal, proposalFieldErrors, resolveHint } from '@/server/services/_ai-proposal-resolution';
import { interpretTransaction } from '@/server/ai/proposals/transaction-entry';
import { fakeTransactionInterpreter, syntheticTransaction } from '../helpers/fake-transaction-interpreter';
const bank = { id: '11111111-1111-4111-8111-111111111111', name: 'Bank', currency: 'INR', openingDate: '2020-01-01', isActive: true };
const cash = { ...bank, id: '22222222-2222-4222-8222-222222222222', name: 'Cash' };
const dining = { id: '33333333-3333-4333-8333-333333333333', name: 'Dining', path: 'Food > Dining', kind: 'expense' as const, isArchived: false };
const salary = { ...dining, id: '44444444-4444-4444-8444-444444444444', name: 'Salary', path: 'Salary', kind: 'income' as const };
const base = () => syntheticTransaction();
type Case = { name: string; changes: Record<string, unknown>; field?: string; accounts?: typeof bank[]; categories?: (typeof dining | typeof salary)[] };
const corpus: Case[] = [
  { name: 'expense', changes: {} },
  { name: 'income', changes: { kind: 'income', categoryHint: 'Salary' } },
  { name: 'transfer', changes: { kind: 'transfer', toAccountHint: 'Cash', categoryHint: null } },
  { name: 'duplicate account', changes: {}, accounts: [bank, { ...bank, id: cash.id }], field: 'accountId' },
  { name: 'missing account', changes: { accountHint: null }, field: 'accountId' },
  { name: 'missing category', changes: { categoryHint: null }, field: 'categoryId' },
  { name: 'missing amount', changes: { amount: null }, field: 'amount' },
  { name: 'number amount', changes: { amount: 1250 }, field: 'amount' },
  { name: 'negative amount', changes: { amount: '-1' }, field: 'amount' },
  { name: 'zero amount', changes: { amount: '0' }, field: 'amount' },
  { name: 'overprecision', changes: { amount: '1.23456' }, field: 'amount' },
  { name: 'overflow', changes: { amount: '999999999999999999999999' }, field: 'amount' },
  { name: 'invalid date', changes: { bookedOn: '2026-02-30' }, field: 'bookedOn' },
  { name: 'before opening', changes: { bookedOn: '2010-01-01' }, field: 'bookedOn' },
  { name: 'wrong account currency', changes: { currency: 'USD' }, field: 'currency' },
  { name: 'currency symbol', changes: { currency: '₹' }, field: 'currency' },
  { name: 'same transfer account', changes: { kind: 'transfer', toAccountHint: 'Bank', categoryHint: null }, field: 'toAccountId' },
  { name: 'missing destination', changes: { kind: 'transfer', categoryHint: null }, field: 'toAccountId' },
  { name: 'cross-currency missing credited amount', changes: { kind: 'transfer', toAccountHint: 'Cash', categoryHint: null }, accounts: [bank, { ...cash, currency: 'USD' }], field: 'toAmount' },
  { name: 'wrong category kind', changes: { categoryHint: 'Salary' }, field: 'categoryId' },
  { name: 'closed account', changes: {}, accounts: [{ ...bank, isActive: false }, cash], field: 'accountId' },
  { name: 'archived category', changes: {}, categories: [{ ...dining, isArchived: true }, salary], field: 'categoryId' },
  { name: 'destination on expense', changes: { toAccountHint: 'Cash' }, field: 'toAccountId' },
  { name: 'low confidence', changes: { confidence: 'low' }, field: 'reviewAcknowledged' },
  { name: 'ambiguity', changes: { ambiguities: ['Date uncertain'] }, field: 'reviewAcknowledged' },
  { name: 'extra mutation field', changes: { applied: true }, field: '_' },
  { name: 'wrong kind', changes: { kind: 'delete' }, field: 'kind' },
  { name: 'exponential amount', changes: { amount: '1e3' }, field: 'amount' },
  { name: 'plus sign', changes: { amount: '+1' }, field: 'amount' },
  { name: 'grouping', changes: { amount: '1,250' }, field: 'amount' },
  { name: 'exact small fractional amount', changes: { amount: '0.0001' } },
  { name: 'missing tags', changes: { tags: undefined }, field: 'tags' },
  { name: 'number tag', changes: { tags: [1] }, field: 'tags.0' },
  { name: 'null description', changes: { description: null }, field: 'description' },
  { name: 'empty description', changes: { description: '' }, field: 'description' },
  { name: 'whitespace description', changes: { description: '   ' }, field: 'description' },
  { name: 'nonfinite amount', changes: { amount: Infinity }, field: 'amount' },
  { name: 'case-insensitive exact hints', changes: { accountHint: 'bank', categoryHint: 'dining' } },
  { name: 'category path', changes: { categoryHint: 'Food > Dining' } },
  { name: 'unknown account', changes: { accountHint: 'Someone else' }, field: 'accountId' },
];
describe('40-case transaction proposal corpus', () => {
  it('contains forty explicit cases', () => expect(corpus).toHaveLength(40));
  it.each(corpus)('$name', c => {
    const parsed = TransactionProposal.safeParse({ ...base(), ...c.changes });
    const errors = parsed.success ? resolveTransactionProposal(parsed.data, c.accounts ?? [bank, cash], c.categories ?? [dining, salary]).errors : proposalFieldErrors(parsed.error);
    if (c.field) expect(errors[c.field]).toBeDefined(); else expect(errors).toEqual({});
  });
  it('matches a unique near-name but refuses fuzzy ties and prioritizes exact matches', () => {
    const a = [{ id: 'a', name: 'Bank Account' }];
    expect(resolveHint('Bank Accoun', a, v => [v.name])).toBe('a');
    expect(resolveHint('Daily Card', [{ id: 'a', name: 'Daily Card1' }, { id: 'b', name: 'Daily Card2' }], v => [v.name])).toBeNull();
    expect(resolveHint('Bank', [bank, { ...cash, name: 'Banks' }], v => [v.name])).toBe(bank.id);
  });
  it('rejects numeric amounts again at the reviewed-value boundary', () => {
    const resolved = resolveTransactionProposal(TransactionProposal.parse(base()), [bank, cash], [dining]);
    expect(reviewedTransactionSchema.safeParse({ ...resolved.draft, amount: 1250 }).success).toBe(false);
    expect(reviewedTransactionSchema.safeParse({ ...resolved.draft, amount: '1,250' }).success).toBe(false);
    expect(reviewedTransactionSchema.safeParse({ ...resolved.draft, amount: '1250.5000' }).success).toBe(true);
  });
  it('uses the unchanged gated orchestrator, no tools, and at most one schema repair', async () => {
    const fake = fakeTransactionInterpreter(['{}', JSON.stringify(base())]);
    const result = await interpretTransaction(fake.orchestrator, { today: '2026-08-10', baseCurrency: 'INR' }, 'Dinner');
    expect(result.ok).toBe(true); expect(fake.requests).toHaveLength(2);
    expect(fake.requests.every(r => !r.tools?.length && r.responseFormat?.type === 'json_schema')).toBe(true);
    const invalid = fakeTransactionInterpreter(['{}']);
    const rejected = await interpretTransaction(invalid.orchestrator, { today: '2026-08-10', baseCurrency: 'INR' }, 'Dinner');
    expect(invalid.requests).toHaveLength(2); expect(rejected.ok && rejected.value.proposal).toBeNull();
  });
  it('rejects returned tool calls without dispatching them or repairing into a write', async () => {
    const fake = fakeTransactionInterpreter([JSON.stringify(base())], new Date('2026-08-10T12:00:00Z'), true, [{ id: 'injected', name: 'delete_transaction', argumentsJson: '{}' }]);
    const result = await interpretTransaction(fake.orchestrator, { today: '2026-08-10', baseCurrency: 'INR' }, 'Dinner');
    expect(fake.requests).toHaveLength(1);
    expect(result.ok && result.value.proposal).toBeNull();
    expect(result.ok && result.value.errors['_']).toEqual(['Unexpected tool call: transaction drafting has no tools.']);
  });

});
