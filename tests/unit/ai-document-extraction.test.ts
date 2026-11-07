import { expect, it } from 'vitest';
import { interpretFinancialDocument } from '@/server/ai/proposals/document-extraction';
import { validateDocumentImages, DOCUMENT_IMAGE_LIMITS } from '@/server/services/_document-images';
import { analyzeDocumentSystemPrompt } from '@/server/ai/prompts/analyze-document';
import { DocumentExtractionProposal } from '@/server/ai/proposals/schemas';
import { toJsonSchema } from '@/server/ai/structured/validate';
import { fakeDocumentProvider, DOCUMENT_PNG } from '../helpers/fake-document-provider';
import { syntheticTransaction } from '../helpers/fake-transaction-interpreter';
const context = { today: '2026-08-10', baseCurrency: 'INR' };
it('uses the frozen document schema/prompt and existing vision route, preserving missing dates without tools or repair', async () => {
  const fake = fakeDocumentProvider({ transactions: [syntheticTransaction({ bookedOn: null, amount: '12.3400' })] });
  const result = await interpretFinancialDocument(fake.orchestrator, context, [DOCUMENT_PNG]);
  expect(result.ok && result.value.proposal?.transactions[0]).toMatchObject({ bookedOn: null, amount: '12.3400' });
  expect(fake.requests).toHaveLength(1); expect(fake.requests[0]?.maxTokens).toBe(4096); expect(fake.requests[0]?.tools).toBeUndefined();
  expect(fake.requests[0]?.messages[0]?.content).toBe(analyzeDocumentSystemPrompt(context));
  expect(fake.requests[0]?.responseFormat).toEqual({ type: 'json_schema', name: 'document_extraction', schema: toJsonSchema(DocumentExtractionProposal, 'document_extraction') });
  expect(fake.requests[0]?.messages[1]?.images).toEqual([DOCUMENT_PNG]);
});
it.each([{ vision: false }, { measured: false }])('refuses an ineligible vision/schema route before provider egress: %s', async options => {
  const fake = fakeDocumentProvider(undefined, {}, options);
  expect((await interpretFinancialDocument(fake.orchestrator, context, [DOCUMENT_PNG])).ok).toBe(false); expect(fake.requests).toHaveLength(0);
});
it('never falls back from a failed vision call to a text-only model', async () => {
  const fake = fakeDocumentProvider(undefined, {}, { fail: true, textFallback: true });
  expect((await interpretFinancialDocument(fake.orchestrator, context, [DOCUMENT_PNG])).ok).toBe(false);
  expect(fake.requests.map(r => r.model)).toEqual([fake.model]); expect(fake.requests.some(r => r.model === fake.text)).toBe(false);
});
it.each([{ amount: 12.34 }, { amount: '1e3' }, { kind: 'buy' }, { bookedOn: 'not a date' }, { extra: 'unexpected' }])('rejects malformed line output with field-level errors and no repair: %s', async patch => {
  const fake = fakeDocumentProvider({ transactions: [syntheticTransaction(patch)] });
  const result = await interpretFinancialDocument(fake.orchestrator, context, [DOCUMENT_PNG]);
  expect(result.ok && result.value.proposal).toBeNull(); expect(result.ok && Object.keys(result.value.errors).length).toBeGreaterThan(0); expect(fake.requests).toHaveLength(1);
});
it.each([{ finishReason: 'length' as const }, { finishReason: 'content_filter' as const }, { toolCalls: [{ id: 'write', name: 'create_transaction', argumentsJson: '{}' }] }, { content: 'x'.repeat(65537) }])('refuses incomplete, filtered, tool-requesting or oversized output', async response => {
  const fake = fakeDocumentProvider(undefined, response); const result = await interpretFinancialDocument(fake.orchestrator, context, [DOCUMENT_PNG]);
  expect(result.ok && result.value.proposal).toBeNull(); expect(fake.requests).toHaveLength(1);
});
it('accepts canonical image envelopes without retaining the caller object', () => {
  const input = [{ ...DOCUMENT_PNG }]; const result = validateDocumentImages(input);
  expect(result.ok && result.value).toEqual(input); if (result.ok) expect(result.value[0]).not.toBe(input[0]);
});
it.each([null, [], Array.from({ length: 6 }, () => DOCUMENT_PNG), [{ ...DOCUMENT_PNG, url: 'https://private.example' }], [{ ...DOCUMENT_PNG, mimeType: 'application/pdf' }], [{ ...DOCUMENT_PNG, mimeType: ['image/png'] }], [{ ...DOCUMENT_PNG, data: 123 }], [{ ...DOCUMENT_PNG, data: 'https://private.example/photo' }], [{ ...DOCUMENT_PNG, data: 'bad base64' }], [{ ...DOCUMENT_PNG, mimeType: 'image/jpeg' }]])('rejects malformed or unsupported image inputs before any model construction', input => {
  expect(validateDocumentImages(input).ok).toBe(false);
});
it('enforces per-image and combined decoded-byte limits', () => {
  const oversized = Buffer.alloc(DOCUMENT_IMAGE_LIMITS.eachBytes + 1); Buffer.from(DOCUMENT_PNG.data, 'base64').copy(oversized);
  expect(validateDocumentImages([{ mimeType: 'image/png', data: oversized.toString('base64') }]).ok).toBe(false);
  const atLimit = oversized.subarray(0, DOCUMENT_IMAGE_LIMITS.eachBytes).toString('base64');
  expect(validateDocumentImages(Array.from({ length: 5 }, () => ({ mimeType: 'image/png', data: atLimit }))).ok).toBe(false);
});
