import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { allTools, findTool, toolDefinitions } from '@/server/ai/tools/registry';
import { dispatchToolCall } from '@/server/ai/tools/dispatch';
import {
  parseJsonSafely,
  repairPromptFor,
  toJsonSchema,
  validateAgainst,
  validateWithOneRepair,
} from '@/server/ai/structured/validate';
import { ok } from '@/lib/result';
import type { AiReadCtx } from '@/server/ai-read';

/**
 * Invariant **I-57** — *the tool surface is closed, validated, and read-only*
 * ([AI-SYSTEM.md §8](../../docs/AI-SYSTEM.md), [ADR-35](../../docs/DECISIONS.md#adr-35--ai-infrastructure-is-strictly-read-only-a-mutation-needs-a-separate-approved-proposal-workflow)).
 *
 * These are the assertions that make the tool layer's security claims checkable
 * rather than intended: no tool accepts a user identifier, every schema rejects
 * invented arguments, an unknown tool is an error rather than a dynamic
 * dispatch, and a handler that throws cannot end a turn.
 */

/** A capability that was never minted — enough for the dispatch-layer tests,
 *  which must reject before any handler runs. */
const FORGED = {
  userId: 'u1',
  now: new Date('2026-08-30T12:00:00Z'),
  today: '2026-08-30',
  base: 'INR',
  locale: 'en-IN',
  timezone: 'Asia/Kolkata',
  fiscalYearStartMonth: 4,
} as unknown as AiReadCtx;

describe('I-57 — the registry is closed and well-formed', () => {
  it('exposes only tools that have a deterministic backing', () => {
    const names = allTools().map((t) => t.name);
    expect(names.length).toBeGreaterThanOrEqual(15);
    // OD-18: no tool stands in for a financial capability that does not exist.
    expect(names).not.toContain('run_financial_scenario');
    expect(names).not.toContain('calculate_financial_metrics');
    expect(names).not.toContain('get_portfolio_performance');
  });

  it('has unique names', () => {
    const names = allTools().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('accepts no user identifier on any tool — the isolation assertion', () => {
    // The single most important schema property. Identity comes from the
    // capability; a model has no argument with which to name another user.
    for (const definition of toolDefinitions()) {
      const properties = (definition.parameters as { properties?: Record<string, unknown> }).properties ?? {};
      for (const field of Object.keys(properties)) {
        expect(field.toLowerCase(), `${definition.name}.${field}`).not.toMatch(/^user|userid|user_id$/);
      }
      expect(JSON.stringify(definition.parameters)).not.toMatch(/"userId"|"user_id"/);
    }
  });

  it('rejects unexpected arguments on every tool', () => {
    // `additionalProperties: false` everywhere: an invented argument is evidence
    // the model misunderstood, and dropping it silently loses the evidence.
    for (const definition of toolDefinitions()) {
      expect(definition.parameters['additionalProperties'], definition.name).toBe(false);
    }
  });

  it('describes every tool for the model', () => {
    for (const tool of allTools()) {
      expect(tool.description.length, tool.name).toBeGreaterThan(20);
      expect(tool.authorization, tool.name).toBe('session');
    }
  });
});

describe('I-57 — dispatch validates before it executes', () => {
  it('rejects an unknown tool as data, not a dynamic dispatch', async () => {
    const outcome = await dispatchToolCall(FORGED, { id: 'c', name: 'drop_tables', argumentsJson: '{}' });
    expect(outcome.failed).toBe(true);
    expect(JSON.stringify(outcome.result)).toContain('no tool named');
  });

  it('rejects arguments that are not JSON', async () => {
    const outcome = await dispatchToolCall(FORGED, {
      id: 'c',
      name: 'get_accounts',
      argumentsJson: '{not json',
    });
    expect(outcome.failed).toBe(true);
    expect(JSON.stringify(outcome.result)).toContain('not valid');
  });

  it('rejects an invented argument rather than ignoring it', async () => {
    const outcome = await dispatchToolCall(FORGED, {
      id: 'c',
      name: 'get_accounts',
      argumentsJson: '{"userId":"someone-else"}',
    });
    expect(outcome.failed).toBe(true);
    // The attempt to name another user is refused at the schema, before any
    // handler runs and before the capability is consulted.
    expect(JSON.stringify(outcome.result)).toContain('invalid_input');
  });

  it('rejects a malformed date rather than passing it to a service', async () => {
    const outcome = await dispatchToolCall(FORGED, {
      id: 'c',
      name: 'get_accounts',
      argumentsJson: '{"asOf":"last Tuesday"}',
    });
    expect(outcome.failed).toBe(true);
  });

  it('never throws, even when the handler does', async () => {
    // FORGED was never minted, so `withFinanceReads` throws inside the handler.
    // A turn must survive that as a tool failure the model can read.
    const outcome = await dispatchToolCall(FORGED, { id: 'c', name: 'get_accounts', argumentsJson: '{}' });
    expect(outcome.failed).toBe(true);
    expect(JSON.stringify(outcome.result)).toContain('unavailable');
    // And the failure text says nothing about why — no stack, no bound context.
    expect(JSON.stringify(outcome.result)).not.toContain('WeakMap');
    expect(JSON.stringify(outcome.result)).not.toContain('createAiReadCtx');
  });

  it('finds a tool by name', () => {
    expect(findTool('get_net_worth')).toBeDefined();
    expect(findTool('nope')).toBeUndefined();
  });
});

describe('I-57 — structured output: validate, one repair, then reject', () => {
  const schema = z
    .object({
      type: z.enum(['income', 'expense']),
      amount: z.string().regex(/^\d+(\.\d+)?$/),
      currency: z.string().length(3),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .strict();

  const valid = '{"type":"expense","amount":"1250.50","currency":"INR","date":"2026-08-30"}';

  it('accepts a valid payload', () => {
    const outcome = validateAgainst(schema, valid);
    expect(outcome.status).toBe('valid');
  });

  it('unwraps a markdown fence, which is transport and not repair', () => {
    const fenced = '```json\n' + valid + '\n```';
    expect(validateAgainst(schema, fenced).status).toBe('valid');
  });

  it('rejects malformed JSON', () => {
    expect(validateAgainst(schema, '{oops').status).toBe('invalid');
    expect(parseJsonSafely('  ').ok).toBe(false);
  });

  it.each([
    ['missing field', '{"type":"expense","currency":"INR","date":"2026-08-30"}', 'amount'],
    ['wrong type', '{"type":"expense","amount":1250.5,"currency":"INR","date":"2026-08-30"}', 'amount'],
    ['invalid enum', '{"type":"refund","amount":"1","currency":"INR","date":"2026-08-30"}', 'type'],
    ['invalid currency', '{"type":"expense","amount":"1","currency":"RUPEES","date":"2026-08-30"}', 'currency'],
    ['invalid date', '{"type":"expense","amount":"1","currency":"INR","date":"30/08/2026"}', 'date'],
    ['invalid amount', '{"type":"expense","amount":"abc","currency":"INR","date":"2026-08-30"}', 'amount'],
  ])('rejects %s', (_label, payload, field) => {
    const outcome = validateAgainst(schema, payload);
    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') expect(Object.keys(outcome.errors)).toContain(field);
  });

  it('rejects extra data rather than stripping it', () => {
    const outcome = validateAgainst(
      schema,
      '{"type":"expense","amount":"1","currency":"INR","date":"2026-08-30","transferTo":"x"}',
    );
    expect(outcome.status).toBe('invalid');
  });

  it('repairs exactly once, then rejects', async () => {
    let attempts = 0;
    const result = await validateWithOneRepair(schema, '{"type":"nope"}', async () => {
      attempts += 1;
      return ok('{"type":"still-wrong"}');
    });
    expect(attempts).toBe(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid_output');
  });

  it('accepts a corrected payload on the single repair', async () => {
    const result = await validateWithOneRepair(schema, '{"type":"nope"}', async () => ok(valid));
    expect(result.ok).toBe(true);
  });

  it('carries the field errors back to the model', () => {
    const prompt = repairPromptFor({ amount: ['Required'] });
    expect(prompt.instruction).toContain('amount');
    expect(prompt.instruction).toContain('JSON object only');
  });

  it('produces a strict JSON Schema', () => {
    const generated = toJsonSchema(schema, 'transaction');
    expect(generated['additionalProperties']).toBe(false);
    expect(generated['required']).toEqual(expect.arrayContaining(['type', 'amount', 'currency', 'date']));
    expect(generated['title']).toBe('transaction');
  });
});
