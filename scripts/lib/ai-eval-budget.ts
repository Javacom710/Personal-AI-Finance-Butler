import type { EvalCase } from '../../src/server/ai/eval/harness';

/** Groq's human-readable bucket-reset duration, bounded to one minute. */
export function resetMs(raw: string | null): number {
  if (!raw) return 60_000;
  const parts = [...raw.matchAll(/([\d.]+)(ms|h|m|s)/g)];
  return parts.length ? Math.min(60_000, parts.reduce((sum, m) => sum + Number(m[1]) * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2]!] ?? 0), 0)) : 60_000;
}

/** Conservative request reservation: UTF-8 text bytes + image tokens + output. */
export function requestReserve(testCase: EvalCase, maxTokens: number): number {
  const compact = JSON.stringify({ ...testCase, messages: testCase.messages.map(m => ({ ...m, images: m.images?.map(image => ({ ...image, data: '[image]' })) })) });
  const images = testCase.messages.reduce((n, m) => n + (m.images?.length ?? 0), 0);
  // Account for the adapter's tool/function envelopes and request metadata.
  return Buffer.byteLength(compact) + images * 2048 + maxTokens + 2048 + (testCase.tools?.length ?? 0) * 128;
}
