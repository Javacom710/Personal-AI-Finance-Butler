import 'server-only';
import { ok, type Result } from '../../../lib/result';
import type { AiFailure } from '../errors';
import type { Orchestrator } from '../orchestrator';
import type { ChatImage } from '../provider/types';
import { analyzeDocumentMessages, type DocumentContext } from '../prompts/analyze-document';
import { toJsonSchema, validateAgainst } from '../structured/validate';
import { DocumentExtractionProposal } from './schemas';
export interface DocumentInterpretation { readonly proposal: DocumentExtractionProposal | null; readonly errors: Record<string, string[]> }
/** Existing vision/schema gate and frozen document prompt/schema; never writes. */
export async function interpretFinancialDocument(orchestrator: Orchestrator, context: DocumentContext, images: readonly ChatImage[]): Promise<Result<DocumentInterpretation, AiFailure>> {
  const schema = { name: 'document_extraction', schema: toJsonSchema(DocumentExtractionProposal, 'document_extraction') };
  const messages = analyzeDocumentMessages(context, 'Draft only actual monetary income, expense and transfer lines from these images. Do not convert investment trades or holdings into cash transactions. Preserve missing dates/amounts as null and flag ambiguity for review.', images);
  const response = await orchestrator.run({ capability: 'analyzeDocument', messages, schema });
  if (!response.ok) return response;
  if (response.value.response.finishReason !== 'stop' || response.value.response.toolCalls.length) return ok({ proposal: null, errors: { _: ['Incomplete, filtered or tool-requesting document output cannot be staged.'] } });
  if ((response.value.response.content?.length ?? 0) > 65536) return ok({ proposal: null, errors: { _: ['Document output exceeds the response limit.'] } });
  const parsed = validateAgainst(DocumentExtractionProposal, response.value.response.content ?? '');
  return ok(parsed.status === 'valid' ? { proposal: parsed.value, errors: {} } : { proposal: null, errors: parsed.errors });
}
