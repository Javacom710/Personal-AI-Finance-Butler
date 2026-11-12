/**
 * Named inference hosts: the base URL each one is reached at (OD-24).
 *
 * `AI_HOST` picks one of these; `AI_BASE_URL`, when set, still wins, so a
 * self-hosted gateway (LiteLLM, OmniRoute) or any other OpenAI-compatible
 * endpoint needs no code change. This file holds URLs only. Model-id
 * translation per host lives in `src/server/ai/config/hosts.ts`, because model
 * identifiers may not appear outside that directory (ADR-17).
 *
 * Switching host never carries measured evidence across: capability scores are
 * bound to the endpoint they were measured on, so every route stays closed on a
 * new host until it is measured there.
 */
export const INFERENCE_HOST_URLS = {
  /** Direct host. Serves both selected Tier 1 models. */
  deepinfra: 'https://api.deepinfra.com/v1/openai',
  /** Aggregator: one key, many upstream hosts; the serving host is recorded per request. */
  openrouter: 'https://openrouter.ai/api/v1',
  /** Direct host with a free tier. Serves GPT-OSS-120B, not GLM-5.3-Flash. */
  groq: 'https://api.groq.com/openai/v1',
  /** A self-hosted gateway. Its URL is the owner's: set `AI_BASE_URL`. */
  gateway: null,
} as const satisfies Readonly<Record<string, string | null>>;

export type InferenceHostId = keyof typeof INFERENCE_HOST_URLS;

export const INFERENCE_HOST_IDS = Object.keys(INFERENCE_HOST_URLS) as [InferenceHostId, ...InferenceHostId[]];
