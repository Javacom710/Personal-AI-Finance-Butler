import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ run: vi.fn(), draft: vi.fn(), ask: vi.fn() }));
vi.mock('@/server/ai-runtime', () => ({ runAiCapability: mocks.run }));
vi.mock('@/server/services/aiProposals', () => ({ draftTransactionProposal: mocks.draft }));
vi.mock('@/server/services/aiConversations', () => ({ askConversation: mocks.ask }));
import { composeTier1Features } from '@/server/ai-tier1-features';
import type { RequestCtx } from '@/server/services/_ctx';
import type { Orchestrator } from '@/server/ai/orchestrator';
import { ok } from '@/lib/result';

const alice = { userId: 'alice' } as RequestCtx;
const bob = { userId: 'bob' } as RequestCtx;
const messages = [{ role: 'user' as const, content: 'Synthetic question' }];
beforeEach(() => { vi.clearAllMocks(); mocks.draft.mockResolvedValue(ok({})); mocks.ask.mockResolvedValue(ok({})); });

it('composes lazily without creating a runtime, querying a service or exposing a confirmation command', () => {
  const features = composeTier1Features(alice);
  expect(Object.keys(features)).toEqual(['draftTransaction', 'askConversation']);
  expect(Object.isFrozen(features)).toBe(true);
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.draft).not.toHaveBeenCalled();
  expect(mocks.ask).not.toHaveBeenCalled();
});

it('binds each feature to its authenticated context without accepting an owner argument', async () => {
  await composeTier1Features(alice).draftTransaction('One expense');
  await composeTier1Features(bob).draftTransaction('Another expense');
  expect(mocks.draft.mock.calls[0]?.slice(0, 2)).toEqual([alice, 'One expense']);
  expect(mocks.draft.mock.calls[1]?.slice(0, 2)).toEqual([bob, 'Another expense']);
  await composeTier1Features(alice).askConversation('conversation-id', 'My spending?');
  expect(mocks.ask.mock.calls[0]?.slice(0, 3)).toEqual([alice, 'conversation-id', 'My spending?']);
});

it('runs both initial parsing and repair through the guarded runtime with no tools', async () => {
  await composeTier1Features(alice).draftTransaction('Expense');
  const runner = mocks.draft.mock.calls[0]![2] as Pick<Orchestrator, 'run'>;
  const schema = { name: 'proposal', schema: {} };
  await runner.run({ capability: 'parseTransaction', messages, schema, tools: [{ name: 'untrusted', description: '', parameters: {} }] });
  await runner.run({ capability: 'parseTransaction', messages: [...messages, { role: 'user', content: 'Repair' }], schema });
  expect(mocks.run).toHaveBeenCalledTimes(2);
  for (const [options] of mocks.run.mock.calls) {
    expect(options.read).toBe(alice);
    expect(options.input).toMatchObject({ capability: 'parseTransaction', schema, withTools: false });
    expect(options.input.tools).toBeUndefined();
  }
});

it('routes every assistant turn through runtime with the trusted registry selected there', async () => {
  await composeTier1Features(alice).askConversation('id', 'Question');
  const runner = mocks.ask.mock.calls[0]![3] as Pick<Orchestrator, 'run'>;
  await runner.run({ capability: 'answerFinanceQuestion', messages, tools: [{ name: 'untrusted', description: '', parameters: {} }] });
  await runner.run({ capability: 'answerFinanceQuestion', messages });
  expect(mocks.run).toHaveBeenCalledTimes(2);
  for (const [options] of mocks.run.mock.calls) {
    expect(options.read).toBe(alice);
    expect(options.input).toEqual({ capability: 'answerFinanceQuestion', messages, withTools: true });
  }
});

it('refuses use of a feature runner for a different capability before reaching runtime', async () => {
  await composeTier1Features(alice).draftTransaction('Expense');
  const runner = mocks.draft.mock.calls[0]![2] as Pick<Orchestrator, 'run'>;
  const result = await runner.run({ capability: 'analyzePortfolio', messages });
  expect(result).toMatchObject({ ok: false, error: { kind: 'refused', reason: 'unsupported_capability' } });
  expect(mocks.run).not.toHaveBeenCalled();
});
