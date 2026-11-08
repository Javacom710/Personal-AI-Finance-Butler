import 'server-only';

import { err } from '../lib/result';
import { refused } from './ai/errors';
import type { Orchestrator } from './ai/orchestrator';
import { runAiCapability } from './ai-runtime';
import type { RequestCtx } from './services/_ctx';
import { draftTransactionProposal } from './services/aiProposals';
import { askConversation } from './services/aiConversations';

/**
 * Application-side composition for an authenticated owner's Tier 1 features.
 * Every model turn, including a structured-output repair, enters the guarded
 * runtime. No provider, model choice or application service context reaches AI helpers.
 *
 * Preparing this adapter does not activate generation: server actions retain
 * their independent hard release hold and do not import or invoke it yet.
 */
export function composeTier1Features(ctx: RequestCtx) {
  const runner = (capability: 'parseTransaction' | 'answerFinanceQuestion'): Pick<Orchestrator, 'run'> => ({
    async run(input) {
      if (input.capability !== capability) {
        return err(refused('unsupported_capability', 'This feature cannot invoke another AI capability.'));
      }
      // Runtime supplies the trusted registry for the assistant. Drafting has
      // no tools; neither path forwards a caller-supplied tool definition.
      const { tools, ...request } = input;
      void tools;
      return runAiCapability({ read: ctx, input: { ...request, withTools: capability === 'answerFinanceQuestion' } });
    },
  });
  const parsing = runner('parseTransaction');
  const questions = runner('answerFinanceQuestion');
  return Object.freeze({
    draftTransaction: (text: unknown) => draftTransactionProposal(ctx, text, parsing),
    askConversation: (id: unknown, question: unknown) => askConversation(ctx, id, question, questions),
  });
}
