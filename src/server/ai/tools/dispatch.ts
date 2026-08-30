import 'server-only';

/**
 * Executing a model's tool call â€” the point where untrusted output becomes a
 * function call ([AI-SYSTEM.md Â§8](../../../../docs/AI-SYSTEM.md), `SECURITY.md` Â§8).
 *
 * Four things happen before a handler runs, in this order, and none of them
 * consults the model:
 *
 * 1. **The name is looked up in a frozen registry.** An unknown tool is an
 *    error returned to the model, never a dynamic dispatch on a string.
 * 2. **The arguments are parsed as JSON.** Model output is not trusted to be
 *    JSON at all.
 * 3. **They are validated against that tool's Zod schema**, `.strict()`, so an
 *    invented argument is rejected rather than passed through.
 * 4. **The handler is invoked with the caller's own capability** â€” never with
 *    anything the model supplied. There is no parameter through which a model
 *    could name a different user.
 *
 * A tool failure is **returned to the model as data**, not thrown. A model that
 * receives `{ ok: false, error: â€¦ }` can correct its call; an exception would
 * end the turn and tell the user nothing useful. That is also why the failure
 * text is fixed and generic â€” an error message is a channel, and a raw
 * `DomainError` carries an entity id that for a settings error *is* the user id.
 */

import type { z } from 'zod';

import type { AiReadCtx } from '../../ai-read';
import type { ToolCall } from '../provider/types';
import { findTool } from './registry';

export interface ToolOutcome {
  readonly name: string;
  readonly callId: string;
  /** Always JSON-serialisable, always already projected. */
  readonly result: unknown;
  readonly failed: boolean;
}

const unknownTool = (name: string) => ({
  ok: false as const,
  error: {
    code: 'invalid_input' as const,
    message: `There is no tool named "${name}". Use one of the tools you were given.`,
  },
});

const badArguments = (detail: string) => ({
  ok: false as const,
  error: {
    code: 'invalid_input' as const,
    message: `The arguments were not valid: ${detail}`,
  },
});

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'input'} ${issue.message}`)
    .join('; ');
}

/**
 * Run one tool call.
 *
 * Never throws: a handler that throws is caught and reported as a failed tool,
 * because an unhandled exception inside a read would otherwise abort a turn the
 * model could have recovered from.
 */
export async function dispatchToolCall(ai: AiReadCtx, call: ToolCall): Promise<ToolOutcome> {
  const tool = findTool(call.name);
  if (!tool) {
    return { name: call.name, callId: call.id, result: unknownTool(call.name), failed: true };
  }

  let raw: unknown;
  try {
    raw = call.argumentsJson.trim() === '' ? {} : JSON.parse(call.argumentsJson);
  } catch (error) {
    return {
      name: call.name,
      callId: call.id,
      result: badArguments(error instanceof Error ? error.message : 'not JSON'),
      failed: true,
    };
  }

  const parsed = (tool.input as z.ZodType).safeParse(raw);
  if (!parsed.success) {
    return {
      name: call.name,
      callId: call.id,
      result: badArguments(describeIssues(parsed.error)),
      failed: true,
    };
  }

  try {
    // The capability is the caller's, always. Nothing from `call` reaches it.
    const result = await tool.handler(ai, parsed.data as never);
    return { name: call.name, callId: call.id, result, failed: false };
  } catch {
    return {
      name: call.name,
      callId: call.id,
      result: { ok: false, error: { code: 'unavailable', message: 'That information is unavailable.' } },
      failed: true,
    };
  }
}

/** Run several calls. Order is preserved so results pair with their calls. */
export async function dispatchToolCalls(
  ai: AiReadCtx,
  calls: readonly ToolCall[],
): Promise<readonly ToolOutcome[]> {
  const outcomes: ToolOutcome[] = [];
  for (const call of calls) {
    outcomes.push(await dispatchToolCall(ai, call));
  }
  return outcomes;
}

