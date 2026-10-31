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
 * ```
 *
 * **No financial data is sent.** The prompts below are fixed, trivial and
 * non-personal — a connectivity check has no business carrying a ledger.
 */

import { z } from 'zod';

import { loadDotEnv, env } from '../src/lib/env';
import { createNvidiaProvider } from '../src/server/ai/provider/nvidia-build';
import {
  resolveModelConfig,
  unavailableCandidates,
  CANDIDATE_POOL,
  EVALUATION_CANDIDATES,
} from '../src/server/ai/config/models';
import { validateAgainst, toJsonSchema } from '../src/server/ai/structured/validate';

const CATALOGUE_ONLY = process.argv.includes('--catalogue');

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
  console.log(`NVIDIA_API_KEY : ${redactKey(e.NVIDIA_API_KEY)}`);
  console.log(`NVIDIA_BASE_URL: ${e.NVIDIA_BASE_URL}`);

  if (!e.NVIDIA_API_KEY) {
    console.log(
      [
        '',
        'No credential, so the live checks are skipped. This is not a failure:',
        'the application runs, every financial figure is computed, and the whole',
        'deterministic suite passes without a key.',
        '',
        'To run the live checks, add to .env (which is git-ignored):',
        '',
        '    NVIDIA_API_KEY=nvapi-...        # from https://build.nvidia.com',
        '',
        'then re-run: npm run ai:smoke',
      ].join('\n'),
    );
    process.exitCode = 0;
    return;
  }

  const provider = createNvidiaProvider({
    apiKey: e.NVIDIA_API_KEY,
    baseUrl: e.NVIDIA_BASE_URL,
    fetch: globalThis.fetch as never,
    defaultTimeoutMs: e.AI_REQUEST_TIMEOUT_MS,
  });

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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
