import 'server-only';

/**
 * Capability → what a model must be able to do to serve it
 * ([AI-SYSTEM.md §6.1](../../../../docs/AI-SYSTEM.md)).
 *
 * The rest of the application asks for a **capability** — `answerFinanceQuestion`,
 * `analyzePortfolio` — and never for a model. This table is the only place a
 * capability becomes a tier and a set of hard requirements, which is what makes
 * "the caller does not care which model runs" true rather than merely intended.
 *
 * **Every field here is a hard gate, not a preference.** `select.ts` filters on
 * them before ordering, so an incapable model is never reachable — a vision task
 * cannot fall back to a text model, and a schema task cannot fall back to one
 * that cannot emit a schema. Availability is not a licence to downgrade
 * (`CLAUDE.md <model_fallbacks>`).
 *
 * **Requirements are computed from the capability alone.** Never from user text,
 * never from a tool result, never from anything a model produced. That is what
 * stops a prompt injection escalating a request to a more permissive path
 * (`SECURITY.md` §8) — the routing decision is made before any content is read.
 */

import type { Tier } from '../config/models';
import type { StructuredOutputSupport } from '../config/capabilities';

/**
 * The capabilities this infrastructure can route.
 *
 * Two of the twelve in `AI-SYSTEM.md` §6.1 are deliberately absent:
 *
 * - `runFinancialScenario` — the deterministic scenario engine does not exist
 *   (**OD-18**). Routing to it would be an AI capability standing in for missing
 *   financial-engine functionality, which is exactly what OD-18 forbids.
 * - `retrieveRelevantContext` — embeddings are not built
 *   ([ADR-19](../../../../docs/DECISIONS.md#adr-19--embeddings-deferred-full-text-search-first-pgvector-if-ever)).
 *
 * Leaving them out is the documented boundary. Adding a route to a capability
 * with no deterministic backing would make the registry lie about what the
 * system can do.
 */
export type AiCapability =
  | 'parseTransaction'
  | 'classifyTransaction'
  | 'answerFinanceQuestion'
  | 'summarizeFinancialData'
  | 'analyzePortfolio'
  | 'analyzeFinancialHealth'
  | 'analyzeFinancialPeriod'
  | 'deepInvestigation'
  | 'extractReceiptData'
  | 'analyzeDocument';

export interface CapabilityRequirement {
  readonly capability: AiCapability;
  readonly tier: Tier;
  /** The model must support native tool calling. */
  readonly needsTools: boolean;
  /** The weakest structured-output mode that will do. `'none'` means prose. */
  readonly needsStructuredOutput: StructuredOutputSupport;
  readonly needsVision: boolean;
  /**
   * Minimum measured `schemaAdherence`. A requirement above zero also demands
   * `source: 'measured'` — a declared entry can never satisfy a score.
   */
  readonly minSchemaAdherence: number;
  /** Minimum measured `toolCallCorrectness`, same rule. */
  readonly minToolCallCorrectness: number;
  /**
   * Whether the deterministic classifier may raise this to the next tier.
   * Tier 3 is never reached this way — it requires an explicit user action.
   */
  readonly allowTierEscalation: boolean;
  /** Requires an explicit, per-request user action (Tier 3 access rule). */
  readonly requiresExplicitUserRequest: boolean;
  readonly maxTokens: number;
}

/**
 * Thresholds from `AI-SYSTEM.md` §5: `schemaAdherence ≥ 0.95` for a Tier 1
 * parsing route, `toolCallCorrectness ≥ 0.90` for any tool-using route.
 */
const SCHEMA_THRESHOLD = 0.95;
const TOOL_THRESHOLD = 0.9;

const REQUIREMENTS: Readonly<Record<AiCapability, CapabilityRequirement>> = {
  // Tier 1 — structured, no tools. Nothing is read while drafting a write.
  parseTransaction: {
    capability: 'parseTransaction',
    tier: 1,
    needsTools: false,
    needsStructuredOutput: 'json_schema',
    needsVision: false,
    minSchemaAdherence: SCHEMA_THRESHOLD,
    minToolCallCorrectness: 0,
    allowTierEscalation: false,
    requiresExplicitUserRequest: false,
    maxTokens: 1_024,
  },
  classifyTransaction: {
    capability: 'classifyTransaction',
    tier: 1,
    needsTools: false,
    needsStructuredOutput: 'json_schema',
    needsVision: false,
    minSchemaAdherence: SCHEMA_THRESHOLD,
    minToolCallCorrectness: 0,
    allowTierEscalation: false,
    requiresExplicitUserRequest: false,
    maxTokens: 512,
  },

  // Tier 1 — the read loop. Prose out, tools in.
  answerFinanceQuestion: {
    capability: 'answerFinanceQuestion',
    tier: 1,
    needsTools: true,
    needsStructuredOutput: 'none',
    needsVision: false,
    minSchemaAdherence: 0,
    minToolCallCorrectness: TOOL_THRESHOLD,
    allowTierEscalation: true,
    requiresExplicitUserRequest: false,
    maxTokens: 2_048,
  },
  summarizeFinancialData: {
    capability: 'summarizeFinancialData',
    tier: 1,
    needsTools: true,
    needsStructuredOutput: 'none',
    needsVision: false,
    minSchemaAdherence: 0,
    minToolCallCorrectness: TOOL_THRESHOLD,
    allowTierEscalation: true,
    requiresExplicitUserRequest: false,
    maxTokens: 2_048,
  },

  // Tier 2 — several tool results weighed against each other.
  analyzePortfolio: {
    capability: 'analyzePortfolio',
    tier: 2,
    needsTools: true,
    needsStructuredOutput: 'none',
    needsVision: false,
    minSchemaAdherence: 0,
    minToolCallCorrectness: TOOL_THRESHOLD,
    allowTierEscalation: false,
    requiresExplicitUserRequest: false,
    maxTokens: 4_096,
  },
  analyzeFinancialHealth: {
    capability: 'analyzeFinancialHealth',
    tier: 2,
    needsTools: true,
    needsStructuredOutput: 'none',
    needsVision: false,
    minSchemaAdherence: 0,
    minToolCallCorrectness: TOOL_THRESHOLD,
    allowTierEscalation: false,
    requiresExplicitUserRequest: false,
    maxTokens: 4_096,
  },
  analyzeFinancialPeriod: {
    capability: 'analyzeFinancialPeriod',
    tier: 2,
    needsTools: true,
    needsStructuredOutput: 'none',
    needsVision: false,
    minSchemaAdherence: 0,
    minToolCallCorrectness: TOOL_THRESHOLD,
    allowTierEscalation: false,
    requiresExplicitUserRequest: false,
    maxTokens: 4_096,
  },

  // Tier 3 — never reached by escalation. Cost control is this flag.
  deepInvestigation: {
    capability: 'deepInvestigation',
    tier: 3,
    needsTools: true,
    needsStructuredOutput: 'none',
    needsVision: false,
    minSchemaAdherence: 0,
    minToolCallCorrectness: TOOL_THRESHOLD,
    allowTierEscalation: false,
    requiresExplicitUserRequest: true,
    maxTokens: 8_192,
  },

  // Tier 4 — vision. Cannot fall back to a text model, ever.
  extractReceiptData: {
    capability: 'extractReceiptData',
    tier: 4,
    needsTools: false,
    needsStructuredOutput: 'json_schema',
    needsVision: true,
    minSchemaAdherence: SCHEMA_THRESHOLD,
    minToolCallCorrectness: 0,
    allowTierEscalation: false,
    requiresExplicitUserRequest: false,
    maxTokens: 2_048,
  },
  analyzeDocument: {
    capability: 'analyzeDocument',
    tier: 4,
    needsTools: false,
    needsStructuredOutput: 'json_schema',
    needsVision: true,
    minSchemaAdherence: SCHEMA_THRESHOLD,
    minToolCallCorrectness: 0,
    allowTierEscalation: false,
    requiresExplicitUserRequest: false,
    maxTokens: 4_096,
  },
};

export function requirementFor(capability: AiCapability): CapabilityRequirement {
  return REQUIREMENTS[capability];
}

export function allCapabilities(): readonly AiCapability[] {
  return Object.keys(REQUIREMENTS) as AiCapability[];
}

/**
 * The requirement for a capability raised one tier.
 *
 * Used only where `allowTierEscalation` is set, and only when the deterministic
 * classifier in application code asked for it. **Escalation never reaches Tier
 * 3** — that needs an explicit user action, so the ceiling here is Tier 2.
 * Returns `null` when escalation is not permitted, which callers must treat as
 * "stay where you are" rather than "escalate anyway".
 */
export function escalated(requirement: CapabilityRequirement): CapabilityRequirement | null {
  if (!requirement.allowTierEscalation) return null;
  if (requirement.tier >= 2) return null;
  return { ...requirement, tier: 2, allowTierEscalation: false };
}
