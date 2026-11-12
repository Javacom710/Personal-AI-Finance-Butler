import 'server-only';

import { INFERENCE_HOST_URLS, type InferenceHostId } from '@/lib/inference-hosts';

/**
 * How each inference host spells the application's model identifiers (OD-24).
 *
 * The application keeps one **canonical** identifier per model — the spelling
 * in `models.ts` and `capabilities.ts` — so tier orders, capability entries and
 * stored evaluations never change when the host does. The provider adapter
 * translates at the wire, and only there.
 *
 * An alias is listed only once it was read from that host's own catalogue.
 * A canonical id with no alias is sent unchanged: correct for DeepInfra (whose
 * spelling is canonical) and for a gateway, whose own configuration maps names.
 * A host that does not serve a model fails that request with the host's own
 * error, and the orchestrator's fallback takes over; nothing is substituted.
 */
export interface InferenceHost {
  readonly id: InferenceHostId;
  readonly kind: 'direct' | 'aggregator' | 'gateway';
  /** `null` for a gateway: its URL comes from `AI_BASE_URL`. */
  readonly baseUrl: string | null;
  /** Canonical model id → this host's id. */
  readonly modelAliases: Readonly<Record<string, string>>;
  /** Canonical ids confirmed absent from this host's catalogue. */
  readonly unavailable: readonly string[];
  readonly catalogueCheckedOn: string | null;
}

export const INFERENCE_HOSTS: Readonly<Record<InferenceHostId, InferenceHost>> = {
  deepinfra: {
    id: 'deepinfra',
    kind: 'direct',
    baseUrl: INFERENCE_HOST_URLS.deepinfra,
    modelAliases: {},
    unavailable: [],
    catalogueCheckedOn: '2026-11-12',
  },
  openrouter: {
    id: 'openrouter',
    kind: 'aggregator',
    baseUrl: INFERENCE_HOST_URLS.openrouter,
    modelAliases: {
      'zai-org/GLM-5.3-Flash': 'z-ai/glm-5.3-flash',
      'Qwen/Qwen3-235B-A22B-Instruct-2507': 'qwen/qwen3-235b-a22b-2507',
      'Qwen/Qwen3-VL-30B-A3B-Instruct': 'qwen/qwen3-vl-30b-a3b-instruct',
      'Qwen/Qwen3-VL-235B-A22B-Instruct': 'qwen/qwen3-vl-235b-a22b-instruct',
    },
    unavailable: [],
    catalogueCheckedOn: '2026-11-12',
  },
  groq: {
    id: 'groq',
    kind: 'direct',
    baseUrl: INFERENCE_HOST_URLS.groq,
    modelAliases: {},
    unavailable: ['zai-org/GLM-5.3-Flash'],
    catalogueCheckedOn: '2026-11-12',
  },
  gateway: {
    id: 'gateway',
    kind: 'gateway',
    baseUrl: null,
    modelAliases: {},
    unavailable: [],
    catalogueCheckedOn: null,
  },
};

function normalise(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** The named host whose URL this is; `null` for any other endpoint (a gateway, a mock). */
export function hostForBaseUrl(baseUrl: string): InferenceHost | null {
  const target = normalise(baseUrl);
  if (target === null) return null;
  return Object.values(INFERENCE_HOSTS).find((h) => h.baseUrl !== null && normalise(h.baseUrl) === target) ?? null;
}

/** The identifier to send on the wire for a canonical model id at this endpoint. */
export function wireModelId(baseUrl: string, canonical: string): string {
  return hostForBaseUrl(baseUrl)?.modelAliases[canonical] ?? canonical;
}
