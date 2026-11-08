/**
 * The live NVIDIA Build smoke test — step 7.7.
 *
 * Mirrors `scripts/smoke-market-data.ts`: opt-in, network-using, **never in CI**,
 * and it degrades honestly when the credential is absent rather than failing the
 * build. `npm test` proves the infrastructure; this proves the wire.
 *
 * ```
 * npm run ai:smoke        # connectivity, catalogue, generation, structured output
 * npm run ai:catalogue    # just the authenticated catalogue read
 * npm run ai:reachability # can each configured model actually be called?
 * ```
 *
 * `ai:reachability` exists because the catalogue is not the truth: on
 * 2026-11-02, 31 of the 50 chat models it listed returned HTTP 404 when called,
 * including two routed primaries. It sends one tiny fixed request to every
 * model the tiers route to and every evaluation candidate. It exits non-zero
 * when a routed model fails, so it can run monthly or before a deployment.
 *
 * **No financial data is sent.** The prompts below are fixed, trivial and
 * non-personal — a connectivity check has no business carrying a ledger.
 */

import { z } from 'zod';

import { aiProviderSettings, loadDotEnv, env } from '../src/lib/env';
import { isFreeHost, loadInferenceBudget, reserveUnledgeredSpend } from './lib/inference-budget';
import { createNvidiaProvider } from '../src/server/ai/provider/nvidia-build';
import {
  resolveModelConfig,
  unavailableCandidates,
  CANDIDATE_POOL,
  EVALUATION_CANDIDATES,
} from '../src/server/ai/config/models';
import { validateAgainst, toJsonSchema } from '../src/server/ai/structured/validate';

const CATALOGUE_ONLY = process.argv.includes('--catalogue');
const REACHABILITY = process.argv.includes('--reachability');

function heading(text: string): void {
  console.log(`\n${text}\n${'-'.repeat(text.length)}`);
}

/** Never print a credential, not even a prefix that could identify the account. */
const redactKey = (key: string | undefined): string =>
  key ? `configured (${key.length} chars)` : 'NOT CONFIGURED';

async function main(): Promise<void> {
  loadDotEnv();
  const e = env();

  heading('Configuration');
  const ai = aiProviderSettings(e);
  console.log(`AI_API_KEY : ${redactKey(ai.apiKey)}`);
  console.log(`AI_BASE_URL: ${ai.baseUrl}`);

  if (!ai.apiKey) {
    console.log(
      [
        '',
        'No credential, so the live checks are skipped. This is not a failure:',
        'the application runs, every financial figure is computed, and the whole',
        'deterministic suite passes without a key.',
        '',
        'To run the live checks, add to .env (which is git-ignored):',
        '',
        '    AI_API_KEY=...                   # e.g. from https://console.groq.com/keys',
        '    AI_BASE_URL=https://api.groq.com/openai/v1',
        '',
        'then re-run: npm run ai:smoke',
      ].join('\n'),
    );
    process.exitCode = 0;
    return;
  }

  // ADR-56: chat requests on a paid host reserve an upper bound against the
  // project cap first. Listing the catalogue alone is free.
  if (!CATALOGUE_ONLY && !isFreeHost(ai.baseUrl, await loadInferenceBudget())) {
    await reserveUnledgeredSpend(process.cwd(), {
      script: REACHABILITY ? 'ai:reachability' : 'ai:smoke',
      providerIdentity: new URL(ai.baseUrl).origin,
      reservedUsd: REACHABILITY ? 0.05 : 0.02,
      note: 'Upper bound reserved before a handful of tiny requests; actual cost is lower.',
    });
  }

  const routing = resolveModelConfig({
    tier1: e.AI_TIER1_MODELS,
    tier2: e.AI_TIER2_MODELS,
    tier3: e.AI_TIER3_MODELS,
    tier4: e.AI_TIER4_MODELS,
    requestProfiles: e.AI_REQUEST_PROFILES,
  });
  const provider = createNvidiaProvider({
    requestProfiles: routing.requestProfiles,
    apiKey: ai.apiKey,
    baseUrl: ai.baseUrl,
    fetch: globalThis.fetch as never,
    defaultTimeoutMs: e.AI_REQUEST_TIMEOUT_MS,
  });

  if (REACHABILITY) {
    await reachability(provider, routing, e.AI_REQUEST_TIMEOUT_MS);
    return;
  }

  // 1 — catalogue, and the identifier reconciliation CLAUDE.md's list needs.
  heading('1. Catalogue');
  const catalogue = await provider.listModels();
  if (!catalogue.ok) {
    console.error(`FAILED: ${catalogue.error.kind} — ${catalogue.error.message}`);
    process.exitCode = 1;
    return;
  }
  const ids = new Set(catalogue.value.map((m) => m.id));
  console.log(`${catalogue.value.length} models returned.`);
  for (const candidate of CANDIDATE_POOL) {
    const id = candidate.catalogue;
    const mark = id === null ? 'absent  ' : ids.has(id) ? 'PRESENT ' : 'MISSING ';
    console.log(`  ${mark} ${candidate.declared}${id && id !== candidate.declared ? `  → ${id}` : ''}`);
  }
  const unroutable = unavailableCandidates();
  if (unroutable.length > 0) {
    console.log(`\n${unroutable.length} candidate(s) have no catalogue identifier and cannot be routed to.`);
  }
  console.log('\nEvaluation candidates (measured only, never routed until accepted):');
  for (const candidate of EVALUATION_CANDIDATES) {
    console.log(`  ${ids.has(candidate.id) ? 'PRESENT ' : 'MISSING '} ${candidate.id}  (Tier ${candidate.tier})`);
  }
  if (CATALOGUE_ONLY) return;

  const config = resolveModelConfig({
    tier1: e.AI_TIER1_MODELS,
    tier2: e.AI_TIER2_MODELS,
  });
  const model = config.candidates(1).find((id) => ids.has(id)) ?? config.candidates(1)[0];
  if (!model) {
    console.error('FAILED: no Tier 1 candidate is configured.');
    process.exitCode = 1;
    return;
  }

  // 2 — text generation. A fixed, non-personal prompt.
  heading(`2. Text generation (${model})`);
  const text = await provider.chat({
    model,
    messages: [
      { role: 'system', content: 'Answer in one short sentence.' },
      { role: 'user', content: 'Name the capital city of France.' },
    ],
    maxTokens: 64,
    timeoutMs: e.AI_REQUEST_TIMEOUT_MS,
  });
  if (!text.ok) {
    console.error(`FAILED: ${text.error.kind} — ${text.error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`ok  ${text.value.latencyMs} ms, ${text.value.usage.completionTokens} completion tokens`);
  console.log(`    served by: ${text.value.model}`);
  if (text.value.provenance) console.log(`    host: ${text.value.provenance.servingHost}; policy: ${text.value.provenance.requestPolicyFingerprint}`);

  // 3 — structured output, validated by the same Zod boundary the tools use.
  heading('3. Structured output');
  const schema = z.object({ city: z.string(), country: z.string() }).strict();
  const structured = await provider.chat({
    model,
    messages: [{ role: 'user', content: 'Return the capital of France as JSON with keys city and country.' }],
    responseFormat: { type: 'json_schema', name: 'capital', schema: toJsonSchema(schema, 'capital') },
    maxTokens: 128,
    timeoutMs: e.AI_REQUEST_TIMEOUT_MS,
  });
  if (!structured.ok) {
    console.log(`  structured output unsupported or failed: ${structured.error.kind}`);
    console.log('  (a measured capability entry would record this; it is not a smoke-test failure)');
  } else {
    const outcome = validateAgainst(schema, structured.value.content ?? '');
    console.log(`  validation: ${outcome.status}`);
    if (structured.value.provenance) console.log(`  host: ${structured.value.provenance.servingHost}; policy: ${structured.value.provenance.requestPolicyFingerprint}`);
    if (outcome.status === 'invalid') console.log(`  errors: ${Object.keys(outcome.errors).join(', ')}`);
  }

  // 4 — an unknown model must fail cleanly rather than hang or throw.
  heading('4. Failure handling');
  const bad = await provider.chat({
    model: 'nvidia/definitely-not-a-real-model',
    messages: [{ role: 'user', content: 'hi' }],
    maxTokens: 16,
    timeoutMs: e.AI_REQUEST_TIMEOUT_MS,
  });
  console.log(`  unknown model → ${bad.ok ? 'unexpectedly succeeded' : bad.error.kind}`);

  heading('Result');
  console.log('Provider reachable, generation works, failures are classified.');
  console.log('No financial data was sent. No credential was printed.');
}

/**
 * One tiny, fixed, non-personal request per model. A routed model that fails is
 * an outage waiting to happen and sets the exit code; a failing evaluation
 * candidate is only reported.
 */
async function reachability(
  provider: ReturnType<typeof createNvidiaProvider>,
  routing: ReturnType<typeof resolveModelConfig>,
  timeoutMs: number,
): Promise<void> {
  const routed = new Map<string, number[]>();
  for (const tier of [1, 2, 3, 4] as const) {
    for (const id of routing.candidates(tier)) routed.set(id, [...(routed.get(id) ?? []), tier]);
  }
  const candidates = EVALUATION_CANDIDATES.filter((c) => !routed.has(c.id));

  heading('Reachability (one tiny request per model)');
  let failedRouted = 0;
  const probe = async (id: string): Promise<string> => {
    const result = await provider.chat({
      model: id,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      maxTokens: 16,
      timeoutMs,
    });
    return result.ok ? `ok ${String(result.value.latencyMs).padStart(6)} ms${result.value.provenance ? `; host=${result.value.provenance.servingHost}; model=${result.value.model}; policy=${result.value.provenance.requestPolicyFingerprint}` : ''}` : `FAIL ${result.error.kind}`;
  };
  for (const [id, tiers] of routed) {
    const outcome = await probe(id);
    if (outcome.startsWith('FAIL')) failedRouted += 1;
    console.log(`  ${outcome.padEnd(24)} ${id}  (routed: Tier ${tiers.join(', ')})`);
  }
  for (const c of candidates) {
    console.log(`  ${(await probe(c.id)).padEnd(24)} ${c.id}  (candidate: Tier ${c.tier})`);
  }

  heading('Result');
  if (failedRouted > 0) {
    console.log(`${failedRouted} routed model(s) did not answer. Requests routed to them will fall back or fail.`);
    process.exitCode = 1;
  } else {
    console.log('Every routed model answered. No financial data was sent.');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
