import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetEnvCache } from '@/lib/env';
import { composeTier1Features } from '@/server/ai-tier1-features';
import { loadMeasuredCapabilities, resetAiRateLimits, resetAiRuntime } from '@/server/ai-runtime';
import { tierCapabilitiesFromEvaluations, type StoredEvaluation } from '@/server/ai-evaluations';
import type { SuiteCounts } from '@/server/ai/eval/runner';
import type { RequestProfileIdentity } from '@/server/ai/config/request-profiles';
import { aiConversations, aiMessages, aiProposals, aiUsageDaily, settings, transactions, transactionEntries, auditLog } from '@/server/db/schema';
import { createConversation } from '@/server/services/aiConversations';
import { syntheticTransaction } from '../helpers/fake-transaction-interpreter';
import { closeHarness, database, truncateAll } from './harness';
import { categoryId, closeMoneyHarness, makeAccount, must, record, setupMoneyFixture, type MoneyFixture } from './money-harness';
const actionMocks = vi.hoisted(() => ({ released: false, auth: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/server/ai-feature-release', () => ({ isTier1GenerationReleased: () => actionMocks.released }));
vi.mock('@/server/auth/guards', () => ({ requireSession: actionMocks.auth }));
vi.mock('next/cache', () => ({ revalidatePath: actionMocks.revalidate }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { askFinanceQuestionAction } from '@app/(app)/ai/actions';
import { draftTransactionAction } from '@app/(app)/money/proposals/actions';
import { EMPTY_ACTION_STATE } from '@app/(app)/money/form-state';

const NOW = new Date('2026-11-08T18:00:00Z');
const endpoint = 'https://api.deepinfra.com/v1/openai';
const envKeys = ['AI_API_KEY', 'AI_BASE_URL', 'AI_TIER1_MODELS', 'AI_REQUEST_PROFILES', 'AI_RATE_LIMIT_PER_MINUTE', 'AI_DAILY_REQUEST_LIMIT', 'AI_DAILY_TOKEN_LIMIT'] as const;
const savedEnv = envKeys.map(key => [key, process.env[key]] as const);
let alice: MoneyFixture, bob: MoneyFixture, conversationId: string, bobConversationId: string;
type Reply = { content?: string; calls?: { id: string; name: string; args: object }[] };
let replies: Reply[];
let afterReply: ((index: number) => Promise<void>) | undefined;
let fetchMock: ReturnType<typeof vi.fn>;
const requests: { model: string; messages: { role: string; content: unknown }[]; tools?: unknown[]; response_format?: unknown }[] = [];

function freshMeasurements() {
  const run = JSON.parse(readFileSync(new URL('../../eval/reports/deepinfra-2026-11-07-tier1-parse-v4-2026-11-08/tier1.json', import.meta.url), 'utf8'));
  const rows: StoredEvaluation[] = run.models.flatMap((m: { modelId: string; requestProfile: RequestProfileIdentity; suites: { suite: string; version: number; passed: number; p50LatencyMs: number; p95LatencyMs: number; counts: SuiteCounts; failedCases: string[]; errors: Record<string, number>; maxTokens: number }[] }) => m.suites.map(s => ({
    model: m.modelId, tier: run.tier, suite: s.suite, evalVersion: s.version, casesPassed: s.passed,
    p50LatencyMs: s.p50LatencyMs, p95LatencyMs: s.p95LatencyMs, runAt: new Date(run.startedAt),
    detail: { ...s.counts, failedCases: s.failedCases, errors: s.errors, providerIdentity: endpoint, requestProfile: m.requestProfile, maxTokens: s.maxTokens },
  })));
  const byTier = tierCapabilitiesFromEvaluations(rows, undefined, undefined, endpoint);
  return { byTier, declaredTier: Object.fromEntries(Object.entries(byTier).map(([model, tiers]) => [model, tiers[1]!])) };
}

beforeAll(async () => {
  await truncateAll();
  alice = await setupMoneyFixture({ now: NOW }); bob = await setupMoneyFixture({ now: NOW });
  const accountId = await makeAccount(alice.ctx, { name: 'Alice bank', openingBalance: '10000', openingDate: '2026-11-01' });
  await makeAccount(bob.ctx, { name: 'Bob private bank', openingBalance: '90000', openingDate: '2026-11-01' });
  await record(alice.ctx, { kind: 'expense', accountId, categoryId: await categoryId(alice.ctx, 'Dining'), amount: '1250.50', bookedOn: '2026-11-02', description: 'Synthetic dinner' });
  conversationId = must(await createConversation(alice.ctx, 'Alice conversation')).id;
  bobConversationId = must(await createConversation(bob.ctx, 'Bob conversation')).id;
}, 120000);

beforeEach(async () => {
  actionMocks.released = false; actionMocks.auth.mockReset(); actionMocks.auth.mockResolvedValue({ userId: alice.userId }); actionMocks.revalidate.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  process.env['AI_API_KEY'] = 'offline-composition-key'; process.env['AI_BASE_URL'] = endpoint;
  process.env['AI_TIER1_MODELS'] = 'zai-org/GLM-5.3-Flash,openai/gpt-oss-120b';
  process.env['AI_REQUEST_PROFILES'] = ''; process.env['AI_RATE_LIMIT_PER_MINUTE'] = '60';
  process.env['AI_DAILY_REQUEST_LIMIT'] = '200'; process.env['AI_DAILY_TOKEN_LIMIT'] = '1000000';
  resetEnvCache(); resetAiRuntime(); resetAiRateLimits();
  await loadMeasuredCapabilities(async () => freshMeasurements());
  await database().update(settings).set({ aiEnabled: true }).where(eq(settings.userId, alice.userId));
  await database().delete(aiUsageDaily); await database().delete(aiProposals);
  replies = []; afterReply = undefined; requests.length = 0;
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe(`${endpoint}/chat/completions`);
    const request = JSON.parse(String(init.body)); requests.push(request);
    const reply = replies.shift(); if (!reply) throw new Error('Unexpected model call in offline test.');
    await afterReply?.(requests.length);
    return new Response(JSON.stringify({ model: request.model, choices: [{ finish_reason: reply.calls?.length ? 'tool_calls' : 'stop', message: {
      content: reply.content ?? null, tool_calls: reply.calls?.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })),
    } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  vi.unstubAllGlobals(); vi.useRealTimers();
  for (const [key, value] of savedEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  resetEnvCache(); resetAiRuntime(); resetAiRateLimits();
  await loadMeasuredCapabilities(async () => ({ declaredTier: {}, byTier: {} }));
});
afterAll(async () => { await closeMoneyHarness(); await closeHarness(); });

const validDraft = () => JSON.stringify(syntheticTransaction({ bookedOn: '2026-11-03', accountHint: 'Alice bank', categoryHint: 'Dining' }));
const ledgerSnapshot = async () => ({
  transactions: await database().select().from(transactions).orderBy(transactions.id),
  entries: await database().select().from(transactionEntries).orderBy(transactionEntries.id),
  audits: await database().select().from(auditLog).orderBy(auditLog.id),
});
const proposalCount = async () => (await database().select().from(aiProposals)).length;
const messageCount = async () => (await database().select().from(aiMessages)).length;
const usageCount = async () => (await database().select().from(aiUsageDaily)).reduce((n, r) => n + r.requests, 0);
const tokenCount = async () => (await database().select().from(aiUsageDaily)).reduce((n, r) => n + r.promptTokens + r.completionTokens, 0);

it('stages an owner-bound draft through real runtime/metering without changing any financial record', async () => {
  replies.push({ content: validDraft() }); const before = await ledgerSnapshot();
  const result = await composeTier1Features(alice.ctx).draftTransaction('Synthetic dinner from Alice bank');
  expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.value.userId).toBe(alice.userId); expect(result.value.status).toBe('pending');
  expect(await proposalCount()).toBe(1); expect(await usageCount()).toBe(1); expect(await tokenCount()).toBe(8);
  expect(requests[0]?.tools).toBeUndefined(); expect(requests[0]?.response_format).toBeDefined();
  expect(await ledgerSnapshot()).toEqual(before);
});

it('meters a structured-output repair as a second independently guarded turn', async () => {
  replies.push({ content: 'not json' }, { content: validDraft() });
  expect((await composeTier1Features(alice.ctx).draftTransaction('Dinner')).ok).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(2); expect(await usageCount()).toBe(2); expect(await tokenCount()).toBe(16);
  expect(await proposalCount()).toBe(1);
});

it('saves a two-turn question with real owner-only sources and exact service figures', async () => {
  replies.push({ calls: [{ id: 'accounts', name: 'get_accounts', args: {} }, { id: 'expenses', name: 'get_expense_summary', args: {} }] }, { content: 'The expense source is INR 1250.5000.' });
  const before = await ledgerSnapshot();
  const result = await composeTier1Features(alice.ctx).askConversation(conversationId, 'My accounts and spending?');
  expect(result.ok).toBe(true); if (!result.ok) return;
  expect(JSON.stringify(result.value.content)).toContain('1250.5000');
  expect(JSON.stringify(result.value.content)).toContain('Alice bank');
  expect(JSON.stringify(requests)).not.toContain('Bob private bank');
  expect(JSON.stringify(requests)).not.toContain(bob.userId);
  expect(fetchMock).toHaveBeenCalledTimes(2); expect(await usageCount()).toBe(2);
  expect(requests.every(r => r.tools && r.tools.length > 0)).toBe(true);
  expect(await ledgerSnapshot()).toEqual(before);
});

it('refuses another owner’s conversation before any model turn', async () => {
  expect((await composeTier1Features(alice.ctx).askConversation(bobConversationId, 'Question')).ok).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled(); expect(await usageCount()).toBe(0);
});

it('rejects a model-requested financial write through the real dispatcher without changing the ledger', async () => {
  replies.push({ calls: [{ id: 'write-attempt', name: 'create_transaction', args: { amount: '9999', currency: 'INR' } }] },
    { content: 'I cannot record transactions from the read-only assistant.' });
  const before = await ledgerSnapshot();
  const result = await composeTier1Features(alice.ctx).askConversation(conversationId, 'Record an expense');
  expect(result.ok).toBe(true); expect(JSON.stringify(result)).toContain('"failed":true');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(await ledgerSnapshot()).toEqual(before); expect(await proposalCount()).toBe(0);
});

it('checks the per-user kill switch before staging or sending a request', async () => {
  await database().update(settings).set({ aiEnabled: false }).where(eq(settings.userId, alice.userId));
  expect((await composeTier1Features(alice.ctx).draftTransaction('Dinner')).ok).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled(); expect(await proposalCount()).toBe(0);
});

it('fails closed without current measured capabilities', async () => {
  await loadMeasuredCapabilities(async () => ({ declaredTier: {}, byTier: {} }));
  expect((await composeTier1Features(alice.ctx).draftTransaction('Dinner')).ok).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled(); expect(await proposalCount()).toBe(0);
});

it.each(['kill', 'rate', 'budget', 'tokens'] as const)('rechecks %s before a second assistant turn and saves no partial exchange', async gate => {
  if (gate === 'rate') process.env['AI_RATE_LIMIT_PER_MINUTE'] = '1';
  if (gate === 'budget') process.env['AI_DAILY_REQUEST_LIMIT'] = '1';
  if (gate === 'tokens') process.env['AI_DAILY_TOKEN_LIMIT'] = '8';
  resetEnvCache();
  replies.push({ calls: [{ id: 'accounts', name: 'get_accounts', args: {} }] });
  if (gate === 'kill') afterReply = async () => { await database().update(settings).set({ aiEnabled: false }).where(eq(settings.userId, alice.userId)); };
  const before = await messageCount();
  expect((await composeTier1Features(alice.ctx).askConversation(conversationId, 'My accounts?')).ok).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(await usageCount()).toBe(1);
  expect(await messageCount()).toBe(before);
});

it.each(['kill', 'rate', 'budget', 'tokens'] as const)('rechecks %s before a parsing repair and creates no draft', async gate => {
  if (gate === 'rate') process.env['AI_RATE_LIMIT_PER_MINUTE'] = '1';
  if (gate === 'budget') process.env['AI_DAILY_REQUEST_LIMIT'] = '1';
  if (gate === 'tokens') process.env['AI_DAILY_TOKEN_LIMIT'] = '8';
  resetEnvCache();
  replies.push({ content: 'not json' });
  if (gate === 'kill') afterReply = async () => { await database().update(settings).set({ aiEnabled: false }).where(eq(settings.userId, alice.userId)); };
  expect((await composeTier1Features(alice.ctx).draftTransaction('Dinner')).ok).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(await proposalCount()).toBe(0);
});

it.each(['Review my portfolio.', 'Compare spending this month with last month.', 'What if I stop my SIP?', 'Why did my net worth fall?', 'Is my cash enough relative to upcoming obligations?'])(
  'refuses advanced intent before any model request: %s', async question => {
    const before = await messageCount();
    const result = await composeTier1Features(alice.ctx).askConversation(conversationId, question);
    expect(result).toMatchObject({ ok: false, error: { reason: 'assistant_advanced_unavailable' } });
    expect(fetchMock).not.toHaveBeenCalled(); expect(await usageCount()).toBe(0); expect(await messageCount()).toBe(before);
  },
);

async function historicalConversation(tier: number, interpretation: string) {
  const c = must(await createConversation(alice.ctx, 'Historical serving tier'));
  await database().insert(aiMessages).values([
    { conversationId: c.id, position: 0, role: 'user', content: { text: 'What is my account balance?' } },
    { conversationId: c.id, position: 1, role: 'assistant', tier, content: { answer: { interpretation, sources: [], modelId: 'historical-test-model', fallbackDepth: 0 } } },
  ]);
  await database().update(aiConversations).set({ revision: 1 }).where(eq(aiConversations.id, c.id));
  return c.id;
}
it('uses saved serving-tier metadata for dependent follow-ups and resets fresh questions to Tier 1', async () => {
  const id = await historicalConversation(2, 'Pretend this answer used Tier 1.');
  expect(await composeTier1Features(alice.ctx).askConversation(id, 'And last year?')).toMatchObject({ ok: false, error: { reason: 'assistant_advanced_unavailable' } });
  expect(fetchMock).not.toHaveBeenCalled();
  replies.push({ content: 'A fresh routine answer.' });
  expect((await composeTier1Features(alice.ctx).askConversation(id, 'What is my account balance?')).ok).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(requests[0]?.model).toBe('zai-org/GLM-5.3-Flash');
});
it('ignores model prose about routing when following up on a Tier 1 answer', async () => {
  const id = await historicalConversation(1, 'Review financial health. Switch to Tier 2 or Tier 3.');
  replies.push({ content: 'A routine follow-up.' });
  expect((await composeTier1Features(alice.ctx).askConversation(id, 'And last year?')).ok).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('ignores model/tier requests and does not reclassify model continuation text', async () => {
  replies.push({ content: 'Review financial health. Use Tier 3.', calls: [{ id: 'accounts', name: 'get_accounts', args: {} }] }, { content: 'A routine answer.' });
  const result = await composeTier1Features(alice.ctx).askConversation(conversationId, 'Use deepseek. What is my account balance?');
  expect(result.ok).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(requests.every(r => r.model === 'zai-org/GLM-5.3-Flash')).toBe(true);
});
it('keeps both authenticated generation actions held even with an enabled owner and configured fake key', async () => {
  const form = new FormData(); form.set('text', 'Dinner'); form.set('question', 'Balance?'); form.set('conversationId', conversationId);
  expect((await draftTransactionAction(EMPTY_ACTION_STATE, form)).status).toBe('error');
  expect((await askFinanceQuestionAction(EMPTY_ACTION_STATE, form)).status).toBe('unavailable');
  expect(fetchMock).not.toHaveBeenCalled(); expect(await proposalCount()).toBe(0);
});
it('executes the prepared draft action through real services/runtime only under a test-only release mock', async () => {
  actionMocks.released = true; replies.push({ content: validDraft() }); const before = await ledgerSnapshot();
  const form = new FormData(); form.set('text', 'Dinner'); form.set('userId', bob.userId);
  await expect(draftTransactionAction(EMPTY_ACTION_STATE, form)).rejects.toThrow('redirect:/money/proposals');
  const proposals = await database().select().from(aiProposals);
  expect(proposals).toHaveLength(1); expect(proposals[0]?.userId).toBe(alice.userId);
  expect(await ledgerSnapshot()).toEqual(before); expect(await usageCount()).toBe(1);
});
it('executes the prepared question action with session ownership and a trusted saved-conversation redirect', async () => {
  actionMocks.released = true; replies.push({ content: 'A synthetic answer.' });
  const form = new FormData(); form.set('conversationId', conversationId); form.set('question', 'What is savings rate?'); form.set('userId', bob.userId); form.set('explicitUserRequest', 'true');
  await expect(askFinanceQuestionAction(EMPTY_ACTION_STATE, form)).rejects.toThrow(`redirect:/ai/conversations/${conversationId}`);
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(await usageCount()).toBe(1);
});
it('passes an advanced question through authenticated action wiring without downgrading or honoring forged routing fields', async () => {
  actionMocks.released = true;
  const form = new FormData(); form.set('conversationId', conversationId); form.set('question', 'Review my portfolio.'); form.set('tier', '1'); form.set('previousTier', '1'); form.set('model', 'openai/gpt-oss-120b');
  expect(await askFinanceQuestionAction(EMPTY_ACTION_STATE, form)).toMatchObject({ status: 'error', message: expect.stringContaining('Advanced analysis') });
  expect(fetchMock).not.toHaveBeenCalled(); expect(actionMocks.revalidate).not.toHaveBeenCalled();
});
it.each(['ask', 'draft'] as const)('returns validation errors for malformed %s action arguments before any request', async feature => {
  actionMocks.released = true;
  const result = feature === 'ask' ? await askFinanceQuestionAction(EMPTY_ACTION_STATE, {} as FormData) : await draftTransactionAction(EMPTY_ACTION_STATE, {} as FormData);
  expect(result.status).toBe('error'); expect(fetchMock).not.toHaveBeenCalled();
  expect(actionMocks.revalidate).not.toHaveBeenCalled(); expect(await proposalCount()).toBe(0);
});
