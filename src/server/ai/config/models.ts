import 'server-only';

/**
 * Tier → ordered candidate models, and the identifier normalisation between
 * `CLAUDE.md`'s candidate pool and NVIDIA Build's actual catalogue
 * ([ADR-17](../../../../docs/DECISIONS.md#adr-17--model-identifiers-are-configuration-not-code)).
 *
 * **No model identifier appears outside this directory.** The rest of the
 * application asks for a *capability*; the router turns that into a tier, and
 * the tier into an ordered list of ids from here. A source scan enforces it, so
 * "swap a model = one configuration line" stays true rather than becoming an
 * aspiration (`AI-SYSTEM.md` §17).
 *
 * **The environment cannot be read here.** `src/server/ai/**` may not import
 * `@/lib/env` (ADR-38), so the tier lists arrive as an argument from
 * `src/server/ai-runtime.ts`. That constraint is the reason
 * {@link resolveModelConfig} takes overrides rather than reading them.
 *
 * ## Nothing here is a quality claim
 *
 * The order below is **not** a ranking. It is the smallest set that covers each
 * tier with a fallback, drawn only from identifiers a Phase 0 read found in the
 * catalogue. `CLAUDE.md` requires evaluation against real workloads before
 * routing is finalised, that evaluation needs a credential, and it has not run —
 * so no model in this file is asserted to be better than any other. The measured
 * matrix in `capabilities.ts` is what actually gates routing, and until it is
 * populated the gate is what stops a guess reaching production.
 */

/** Capability tiers. A tier is a class of task, never a size of model. */
export type Tier = 1 | 2 | 3 | 4 | 5;

/**
 * Candidate identifiers, and how `CLAUDE.md`'s list maps onto the catalogue.
 *
 * Five of thirteen candidates in `CLAUDE.md` do not exist under the identifier
 * given there. Recording that here — rather than silently substituting — is what
 * stops a routing table being written against names that 404 at runtime.
 */
export interface CandidateId {
  /** The identifier as `CLAUDE.md` names it. */
  readonly declared: string;
  /** The identifier the catalogue actually uses, or `null` when absent from it. */
  readonly catalogue: string | null;
  readonly note?: string;
}

export const CANDIDATE_POOL: readonly CandidateId[] = [
  // Confirmed present in the Phase 0 catalogue read.
  { declared: 'nvidia/nemotron-3-super-120b-a12b', catalogue: 'nvidia/nemotron-3-super-120b-a12b' },
  { declared: 'nvidia/nemotron-3-ultra-550b-a55b', catalogue: 'nvidia/nemotron-3-ultra-550b-a55b' },
  { declared: 'nvidia/nemotron-3-nano-30b-a3b', catalogue: 'nvidia/nemotron-3-nano-30b-a3b' },
  { declared: 'google/gemma-4-31b-it', catalogue: 'google/gemma-4-31b-it' },
  { declared: 'openai/gpt-oss-20b', catalogue: 'openai/gpt-oss-20b' },
  {
    declared: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    catalogue: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  },
  { declared: 'nvidia/nemotron-3-embed-1b', catalogue: 'nvidia/nemotron-3-embed-1b' },

  // Present, under a different identifier. Routing must use the catalogue one.
  {
    declared: 'deepseek-ai/deepseek-v4-flash',
    catalogue: 'deepseek-ai/deepseek-v4-flash-0731',
    note: 'CLAUDE.md omits the -0731 suffix the catalogue carries. Confirmed by the authenticated read.',
  },

  // Absent from the AUTHENTICATED catalogue (`npm run ai:catalogue`, 83 models).
  // These cannot be routed to, and saying so here is what stops a routing table
  // being written against a name that fails at runtime.
  {
    declared: 'zai-org/glm-5.2',
    catalogue: null,
    note:
      'No GLM model of any publisher prefix exists in the catalogue. AI-SYSTEM.md §2.3 recorded ' +
      '`z-ai/glm-5.2` as the real identifier from an UNAUTHENTICATED read; the authenticated read ' +
      'disproves it. Neither spelling is routable.',
  },
  {
    declared: 'nvidia/nemotron-nano-12b-v2-vl',
    catalogue: null,
    note:
      'Absent. AI-SYSTEM.md §2.3 listed it as present from the unauthenticated read; the ' +
      'authenticated read disproves that. The only Tier 4 candidate from CLAUDE.md that exists is ' +
      'the omni model.',
  },
  {
    declared: 'deepseek-ai/deepseek-v4-pro',
    catalogue: null,
    note: 'Absent from the authenticated catalogue.',
  },
  {
    declared: 'mistralai/mistral-medium-3.5-128b',
    catalogue: null,
    note: 'Absent from the authenticated catalogue.',
  },
  {
    declared: 'qwen/qwen3-next-80b-a3b-instruct',
    catalogue: null,
    note: 'Absent from the authenticated catalogue; no Qwen models are listed at all.',
  },
];

/** `CLAUDE.md`'s name → the catalogue's name. Returns the input when unknown. */
export function normaliseModelId(declared: string): string {
  const found = CANDIDATE_POOL.find((c) => c.declared === declared);
  return found?.catalogue ?? declared;
}

/** Candidates `CLAUDE.md` names that the catalogue does not carry. */
export function unavailableCandidates(): readonly CandidateId[] {
  return CANDIDATE_POOL.filter((c) => c.catalogue === null);
}

/**
 * The default order per tier, from confirmed identifiers only.
 *
 * Overridden entirely by `AI_TIER{n}_MODELS` when set. Tier 5 is empty because
 * embeddings are not built ([ADR-19](../../../../docs/DECISIONS.md#adr-19--embeddings-deferred-full-text-search-first-pgvector-if-ever));
 * an empty tier is not a gap, it is the decision.
 */
const DEFAULT_ORDER: Readonly<Record<Tier, readonly string[]>> = {
  1: ['nvidia/nemotron-3-nano-30b-a3b', 'openai/gpt-oss-20b', 'google/gemma-4-31b-it'],
  // GLM was here until the authenticated catalogue read showed no GLM model
  // exists. Two candidates remain, so Tier 2 still has a fallback.
  2: ['nvidia/nemotron-3-super-120b-a12b', 'deepseek-ai/deepseek-v4-flash-0731'],
  // No fallback by design: a Tier 3 request that cannot be served should fail,
  // not quietly become a Tier 2 answer the user believes is a Tier 3 one.
  3: ['nvidia/nemotron-3-ultra-550b-a55b'],
  // **One candidate, and therefore no fallback.** `nemotron-nano-12b-v2-vl` was
  // the intended primary and does not exist. Vision cannot fall back to a text
  // model, so the honest configuration is a single model whose failure fails the
  // request — not a second entry that would quietly answer a document question
  // without having seen the document. The catalogue does carry other vision
  // models (`meta/llama-3.2-*-vision-instruct`, `microsoft/phi-3-vision-*`), but
  // they are outside `CLAUDE.md`'s approved candidate pool, so adding one is a
  // scope decision rather than a routing fix.
  4: ['nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'],
  5: [],
};

/** Env-supplied overrides, comma-separated, passed in from the composition root. */
export interface TierOverrides {
  readonly tier1?: string;
  readonly tier2?: string;
  readonly tier3?: string;
  readonly tier4?: string;
}

export interface ModelConfig {
  /** Ordered candidate ids for a tier. Already normalised to catalogue names. */
  candidates(tier: Tier): readonly string[];
  /** Every id this configuration could route to, across all tiers. */
  allConfigured(): readonly string[];
}

function parseList(raw: string | undefined): readonly string[] | null {
  if (raw === undefined) return null;
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts.map(normaliseModelId) : null;
}

/**
 * Build the routing configuration.
 *
 * An override replaces a tier's order outright rather than merging with it.
 * Merging would make the effective order depend on both the default and the
 * override, which is exactly the kind of thing nobody can reason about at 2am.
 */
export function resolveModelConfig(overrides: TierOverrides = {}): ModelConfig {
  const resolved: Record<Tier, readonly string[]> = {
    1: parseList(overrides.tier1) ?? DEFAULT_ORDER[1],
    2: parseList(overrides.tier2) ?? DEFAULT_ORDER[2],
    3: parseList(overrides.tier3) ?? DEFAULT_ORDER[3],
    4: parseList(overrides.tier4) ?? DEFAULT_ORDER[4],
    5: DEFAULT_ORDER[5],
  };

  return {
    candidates: (tier) => resolved[tier],
    allConfigured: () => [...new Set(Object.values(resolved).flat())],
  };
}
