import 'server-only';

/**
 * The capability matrix — what each model can actually do, and how well
 * ([ADR-18](../../../../docs/DECISIONS.md#adr-18--a-measured-capability-matrix-gates-routing-and-fallback),
 * [AI-SYSTEM.md §5](../../../../docs/AI-SYSTEM.md)).
 *
 * Support varies by model in an open-weight pool, so the router does not assume;
 * it consults this. A model with **no entry is unusable** — the router refuses
 * rather than routing blind.
 *
 * ## Declared versus measured, and why the distinction is load-bearing
 *
 * `AI-SYSTEM.md` §5 describes this file as *"written by the eval harness"*, with
 * measured scores gating production routes. The eval cannot run without a
 * credential (**OD-1**), so at the time of writing **nothing is measured**. That
 * left two honest options and one dishonest one:
 *
 * - ship an empty matrix, making every model unusable and the provider
 *   untestable even with a key — the gate working correctly, and nothing else;
 * - invent scores — forbidden outright, and the reason `CLAUDE.md` mandates
 *   evaluation in the first place;
 * - **separate what a model *claims* from what it has been *shown* to do.**
 *
 * The third is what this file does. Every entry carries `source`:
 *
 * | `source` | Means | May serve |
 * |---|---|---|
 * | `'declared'` | from the provider's documentation. **Not evidence.** | routes with no score threshold |
 * | `'measured'` | produced by `npm run ai:eval` against real workloads | any route it meets the threshold for |
 *
 * A route with a **score threshold** — structured-output tasks, tool-using
 * tasks — requires `source: 'measured'`. So a declared entry is enough to make a
 * connectivity smoke test possible, and never enough to let an unmeasured model
 * parse a transaction. The gate `AI-SYSTEM.md` §5 asks for is intact; what is
 * relaxed is only the claim that a declared capability is a measured one, and
 * that relaxation is visible in the type.
 *
 * **No score in this file is a benchmark result.** There are none, because none
 * have been measured.
 */

import type { Tier } from './models';

export type ToolCallingSupport = 'native' | 'none';
export type StructuredOutputSupport = 'json_schema' | 'json_object' | 'prompted' | 'none';

export interface CapabilityScores {
  /** Fraction of structured outputs valid on the first attempt. */
  readonly schemaAdherence: number;
  readonly toolCallCorrectness: number;
  readonly retrievalGrounding: number;
  readonly injectionResistance: number;
  readonly p50LatencyMs: number;
  readonly p95LatencyMs: number;
}

export interface ModelCapabilities {
  readonly tier: Tier;
  readonly toolCalling: ToolCallingSupport;
  readonly structuredOutput: StructuredOutputSupport;
  readonly vision: boolean;
  readonly embedding: boolean;
  readonly contextTokens: number;
  readonly maxOutputTokens: number;
  readonly streaming: boolean;
  /**
   * Where this entry came from. `'declared'` entries carry no `scores` and
   * cannot serve a score-gated route.
   */
  readonly source: 'declared' | 'measured';
  readonly scores?: CapabilityScores;
  readonly verifiedAt?: string;
  readonly verifiedAgainstEvalVersion?: number;
}

/**
 * Declared capabilities for the confirmed catalogue identifiers.
 *
 * Every entry is `source: 'declared'`. Populated from the provider's published
 * model descriptions, which is enough to know a text-only model has no vision
 * and not enough to know how reliably it emits a schema. `npm run ai:eval`
 * replaces these with measured entries.
 */
export const DECLARED_CAPABILITIES: Readonly<Record<string, ModelCapabilities>> = {
  'nvidia/nemotron-3-nano-30b-a3b': {
    tier: 1,
    toolCalling: 'native',
    structuredOutput: 'json_schema',
    vision: false,
    embedding: false,
    contextTokens: 131_072,
    maxOutputTokens: 8_192,
    streaming: true,
    source: 'declared',
  },
  'openai/gpt-oss-20b': {
    tier: 1,
    toolCalling: 'native',
    structuredOutput: 'json_object',
    vision: false,
    embedding: false,
    contextTokens: 131_072,
    maxOutputTokens: 8_192,
    streaming: true,
    source: 'declared',
  },
  'google/gemma-4-31b-it': {
    tier: 1,
    toolCalling: 'none',
    structuredOutput: 'prompted',
    vision: false,
    embedding: false,
    contextTokens: 131_072,
    maxOutputTokens: 8_192,
    streaming: true,
    source: 'declared',
  },
  'nvidia/nemotron-3-super-120b-a12b': {
    tier: 2,
    toolCalling: 'native',
    structuredOutput: 'json_schema',
    vision: false,
    embedding: false,
    contextTokens: 131_072,
    maxOutputTokens: 16_384,
    streaming: true,
    source: 'declared',
  },

  'deepseek-ai/deepseek-v4-flash-0731': {
    tier: 2,
    toolCalling: 'native',
    structuredOutput: 'json_object',
    vision: false,
    embedding: false,
    contextTokens: 131_072,
    maxOutputTokens: 16_384,
    streaming: true,
    source: 'declared',
  },
  'nvidia/nemotron-3-ultra-550b-a55b': {
    tier: 3,
    toolCalling: 'native',
    structuredOutput: 'json_schema',
    vision: false,
    embedding: false,
    contextTokens: 131_072,
    maxOutputTokens: 32_768,
    streaming: true,
    source: 'declared',
  },

  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning': {
    tier: 4,
    toolCalling: 'none',
    structuredOutput: 'json_object',
    vision: true,
    embedding: false,
    contextTokens: 128_000,
    maxOutputTokens: 8_192,
    streaming: true,
    source: 'declared',
  },
};

/** How old a measured entry may be before it is flagged stale. */
export const STALE_AFTER_DAYS = 30;

export interface CapabilityMatrix {
  /** `undefined` means no entry, which means unusable. */
  get(modelId: string): ModelCapabilities | undefined;
  has(modelId: string): boolean;
  /** Measured entries older than {@link STALE_AFTER_DAYS}. */
  staleEntries(now: Date): readonly string[];
  /** Models with no entry at all — a startup-time configuration error. */
  unknownModels(configured: readonly string[]): readonly string[];
}

/**
 * Build the matrix.
 *
 * `measured` is layered over the declared defaults so that running the eval for
 * one tier does not invalidate the rest of the table.
 */
export function createCapabilityMatrix(
  measured: Readonly<Record<string, ModelCapabilities>> = {},
): CapabilityMatrix {
  const entries: Record<string, ModelCapabilities> = { ...DECLARED_CAPABILITIES, ...measured };

  return {
    get: (modelId) => entries[modelId],
    has: (modelId) => modelId in entries,

    staleEntries: (now) => {
      const cutoff = now.getTime() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
      return Object.entries(entries)
        .filter(([, c]) => {
          if (c.source !== 'measured' || !c.verifiedAt) return false;
          const at = Date.parse(c.verifiedAt);
          return Number.isFinite(at) && at < cutoff;
        })
        .map(([id]) => id);
    },

    unknownModels: (configured) => configured.filter((id) => !(id in entries)),
  };
}

/**
 * The startup check (B-3b, ROADMAP Phase 7: *"A model with no capability entry
 * cannot be routed to; startup fails loudly"*).
 *
 * The router already refuses an unknown model per request
 * (`no_capability_entry`). That is correct and too late: a typo in an
 * `AI_TIER<n>_MODELS` list would surface as a silently shorter fallback chain,
 * one request at a time. This throws instead, naming every unknown model, so the
 * server refuses to start with a tier list it could not route.
 *
 * Decided 2026-10-26: the matrix stays `capabilities.ts`, not a JSON file.
 */
export function assertEveryConfiguredModelKnown(
  configured: readonly string[],
  matrix: CapabilityMatrix,
): void {
  const unknown = matrix.unknownModels(configured);
  if (unknown.length === 0) return;
  throw new Error(
    `AI configuration error: ${unknown.map((m) => `'${m}'`).join(', ')} ` +
      `${unknown.length === 1 ? 'has' : 'have'} no entry in src/server/ai/config/capabilities.ts, ` +
      'so the router could never use it. Add an entry, or remove it from the AI_TIER<n>_MODELS setting (ADR-18).',
  );
}
