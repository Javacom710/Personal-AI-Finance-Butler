import 'server-only';

/**
 * Structured output: parse, validate, **one** repair attempt, then reject
 * ([AI-SYSTEM.md §9](../../../../docs/AI-SYSTEM.md),
 * [ADR-16](../../../../docs/DECISIONS.md#adr-16--zod-as-the-single-validation-boundary-including-for-ai-schemas)).
 *
 * ```
 * MODEL RESPONSE → VALIDATOR → ACCEPT / REJECT → APPLICATION
 * ```
 *
 * and never
 *
 * ```
 * MODEL RESPONSE → DATABASE
 * ```
 *
 * Zod is the single validation boundary, the same one every form and every
 * service input already crosses — so an AI-supplied value is checked by exactly
 * the machinery a user-supplied one is, and there is no second, weaker path.
 *
 * ## What "repair" is, and what it is not
 *
 * Exactly one re-prompt, carrying the **validation errors** back to the model so
 * it can correct its own output. It is not this module editing the payload:
 * nothing here coerces a type, fills a default, or rounds a number. A model that
 * cannot produce a valid object twice is a model that does not know the answer,
 * and guessing on its behalf is the silent repair `<ai_structured_outputs>`
 * forbids outright.
 *
 * The `strict` schema shape matters as much as the validation. Extra keys are
 * **rejected**, not stripped: a model inventing a field is evidence it has
 * misunderstood the task, and quietly dropping the evidence loses the signal.
 */

import { z } from 'zod';

import { err, ok, type Result } from '../../../lib/result';
import { invalidOutput, type AiFailure } from '../errors';

export type ValidationOutcome<T> =
  | { readonly status: 'valid'; readonly value: T; readonly repaired: boolean }
  | { readonly status: 'invalid'; readonly errors: Record<string, string[]>; readonly raw: string };

export interface RepairPrompt {
  /** Field-level errors, phrased for a model rather than a user. */
  readonly errors: Record<string, string[]>;
  readonly instruction: string;
}

/** Parse JSON without throwing. Model output is not trusted to be JSON at all. */
export function parseJsonSafely(raw: string): Result<unknown, AiFailure> {
  const trimmed = stripCodeFence(raw.trim());
  if (trimmed.length === 0) return err(invalidOutput('the model returned an empty body'));
  try {
    return ok(JSON.parse(trimmed) as unknown);
  } catch (error) {
    return err(invalidOutput(`not valid JSON: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/**
 * Some models wrap JSON in a markdown fence even when asked not to.
 *
 * Unwrapping a fence is *transport*, not repair: the bytes inside are exactly
 * what the model produced, and no field is altered. Anything beyond this — a
 * trailing comma, a single quote — is left to fail, because "nearly JSON" from a
 * model asked for JSON is a schema-adherence signal worth recording.
 */
function stripCodeFence(text: string): string {
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(text);
  return fenced?.[1]?.trim() ?? text;
}

function flatten(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/**
 * Validate one model payload against a schema.
 *
 * Returns an *outcome*, not a `Result`: an invalid payload is a normal,
 * expected event that the caller may answer with a repair attempt, and modelling
 * it as an error would push that decision into exception handling.
 */
export function validateAgainst<T>(schema: z.ZodType<T>, raw: string): ValidationOutcome<T> {
  const parsed = parseJsonSafely(raw);
  if (!parsed.ok) {
    return { status: 'invalid', errors: { _: [parsed.error.message] }, raw };
  }

  const result = schema.safeParse(parsed.value);
  if (result.success) {
    return { status: 'valid', value: result.data, repaired: false };
  }
  return { status: 'invalid', errors: flatten(result.error), raw };
}

/** The message sent back on the single repair attempt. */
export function repairPromptFor(errors: Record<string, string[]>): RepairPrompt {
  const lines = Object.entries(errors)
    .map(([field, messages]) => `- ${field}: ${messages.join('; ')}`)
    .join('\n');
  return {
    errors,
    instruction:
      'Your previous response did not satisfy the required schema. Correct exactly these problems ' +
      'and reply with the corrected JSON object only — no prose, no code fence.\n' +
      lines,
  };
}

/**
 * Run validation with at most one repair round.
 *
 * `reattempt` is supplied by the orchestrator, which owns the provider call.
 * Keeping it a parameter means this module has no provider dependency and is
 * testable with a plain function, which is why every validation case in the
 * suite runs without a network.
 */
export async function validateWithOneRepair<T>(
  schema: z.ZodType<T>,
  first: string,
  reattempt: (prompt: RepairPrompt) => Promise<Result<string, AiFailure>>,
): Promise<Result<T, AiFailure>> {
  const initial = validateAgainst(schema, first);
  if (initial.status === 'valid') return ok(initial.value);

  const retry = await reattempt(repairPromptFor(initial.errors));
  if (!retry.ok) return retry;

  const second = validateAgainst(schema, retry.value);
  if (second.status === 'valid') return ok(second.value);

  // Twice invalid. Reject — the alternative is inventing the missing field.
  return err(
    invalidOutput(
      `schema validation failed after one repair attempt: ${Object.keys(second.errors).join(', ')}`,
    ),
  );
}

/**
 * Zod → JSON Schema for a tool or a response format.
 *
 * `additionalProperties: false` and a complete `required` array are asserted by
 * test rather than hoped for: a schema that permits extra keys is a schema a
 * model can satisfy while inventing fields.
 */
export function toJsonSchema(schema: z.ZodType, name: string): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
  }) as Record<string, unknown>;
  return { ...withRequiredArrays(generated), title: name };
}

/**
 * Give every object node an explicit `required` array (B-3d).
 *
 * Zod omits `required` when no field is required, which a strict JSON Schema
 * consumer reads as "unspecified" rather than "none". Seventeen of the eighteen
 * tools had no `required` key at all. The array Zod does emit is kept as is —
 * it is already exactly the non-optional fields — so this adds `[]` where the
 * key was missing and changes nothing else.
 */
function withRequiredArrays(node: unknown): Record<string, unknown> {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out[key] = Array.isArray(value)
      ? value.map((v) => withRequiredArrays(v))
      : typeof value === 'object' && value !== null
        ? withRequiredArrays(value)
        : value;
  }
  if (out['type'] === 'object' && out['properties'] !== undefined && !Array.isArray(out['required'])) {
    out['required'] = [];
  }
  return out;
}
