import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { AiReadCtx } from '@/server/ai-read';
import { MAX_TOOL_RESULT_BYTES } from '@/server/ai-read/projections';

/**
 * B-3c — the dispatcher's backstop. Paged tools clip themselves; this holds
 * every tool, including the ones whose lists take no limit, to one ceiling, so
 * no result over the budget reaches a model whatever the tool forgot.
 */

const size = { bytes: 0 };

vi.mock('@/server/ai/tools/registry', () => ({
  findTool: (name: string) =>
    name === 'fake'
      ? {
          name: 'fake',
          description: 'A tool whose result is as large as the test says.',
          input: z.object({}).strict(),
          authorization: 'session',
          handler: async () => ({ ok: true, data: { blob: 'x'.repeat(size.bytes) }, meta: {} }),
        }
      : undefined,
}));

const { dispatchToolCall } = await import('@/server/ai/tools/dispatch');
const ai = {} as AiReadCtx;
const call = { id: 'c', name: 'fake', argumentsJson: '{}' };

describe('B-3c — no tool result over the ceiling reaches the model', () => {
  it('passes a result under the ceiling through untouched', async () => {
    size.bytes = 1024;
    const outcome = await dispatchToolCall(ai, call);
    expect(outcome.failed).toBe(false);
    expect(JSON.stringify(outcome.result)).toContain('x'.repeat(1024));
  });

  it('refuses a result over the ceiling whole, with an instruction the model can act on', async () => {
    size.bytes = MAX_TOOL_RESULT_BYTES + 1;
    const outcome = await dispatchToolCall(ai, call);
    expect(outcome.failed).toBe(true);
    const result = outcome.result as { ok: boolean; error: { code: string; message: string } };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('unavailable');
    expect(result.error.message).toMatch(/narrower|smaller/);
    expect(JSON.stringify(outcome.result)).not.toContain('xxxx');
  });
});
