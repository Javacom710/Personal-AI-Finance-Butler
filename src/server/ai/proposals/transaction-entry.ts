import 'server-only';
import { ok, type Result } from '../../../lib/result';
import type { AiFailure } from '../errors';
import type { Orchestrator } from '../orchestrator';
import { parseTransactionMessages, type ParseContext } from '../prompts/parse-transaction';
import { repairPromptFor, toJsonSchema, validateAgainst } from '../structured/validate';
import { TransactionProposal } from './schemas';

export interface TransactionInterpretation {
  readonly raw: string;
  readonly proposal: TransactionProposal | null;
  readonly errors: Record<string, string[]>;
}
/** Pure AI interpretation: no writes, IDs, tools, or provider-specific model names. */
export async function interpretTransaction(orchestrator: Pick<Orchestrator, 'run'>, context: ParseContext, text: string): Promise<Result<TransactionInterpretation, AiFailure>> {
  const messages = parseTransactionMessages(context, text);
  const schema = { name: 'transaction_proposal', schema: toJsonSchema(TransactionProposal, 'transaction_proposal') };
  const first = await orchestrator.run({ capability: 'parseTransaction', messages, schema });
  if (!first.ok) return first;
  let raw = first.value.response.content ?? '';
  let validation = validateAgainst(TransactionProposal, raw);
  if (first.value.response.toolCalls.length) return ok({ raw, proposal: null, errors: { _: ['Unexpected tool call: transaction drafting has no tools.'] } });
  if (validation.status === 'invalid') {
    const repaired = await orchestrator.run({ capability: 'parseTransaction', schema, messages: [...messages, { role: 'assistant', content: raw }, { role: 'user', content: repairPromptFor(validation.errors).instruction }] });
    if (!repaired.ok) return repaired;
    raw = repaired.value.response.content ?? '';
    validation = validateAgainst(TransactionProposal, raw);
    if (repaired.value.response.toolCalls.length) return ok({ raw, proposal: null, errors: { _: ['Unexpected tool call: transaction drafting has no tools.'] } });
  }
  return ok(validation.status === 'valid' ? { raw, proposal: validation.value, errors: {} } : { raw, proposal: null, errors: validation.errors });
}
