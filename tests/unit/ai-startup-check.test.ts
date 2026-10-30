import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resetEnvCache } from '@/lib/env';
import { assertAiConfiguration, resetAiRuntime } from '@/server/ai-runtime';
import { assertEveryConfiguredModelKnown, createCapabilityMatrix } from '@/server/ai/config/capabilities';
import { resolveModelConfig } from '@/server/ai/config/models';

/**
 * B-3b — ROADMAP Phase 7: *"A model with no capability entry cannot be routed
 * to; startup fails loudly"*.
 */
describe('B-3b — startup fails loudly on a model with no capability entry', () => {
  const saved = process.env['AI_TIER2_MODELS'];
  afterEach(() => {
    if (saved === undefined) delete process.env['AI_TIER2_MODELS'];
    else process.env['AI_TIER2_MODELS'] = saved;
    resetEnvCache();
    resetAiRuntime();
  });

  it('accepts the built-in default tier lists — every default has an entry', () => {
    const config = resolveModelConfig();
    expect(() => assertEveryConfiguredModelKnown(config.allConfigured(), createCapabilityMatrix())).not.toThrow();
  });

  it('names every unknown model, not just the first', () => {
    const config = resolveModelConfig({ tier1: 'made-up/one', tier2: 'made-up/two' });
    expect(() => assertEveryConfiguredModelKnown(config.allConfigured(), createCapabilityMatrix())).toThrow(
      /'made-up\/one', 'made-up\/two' have no entry in src\/server\/ai\/config\/capabilities\.ts/,
    );
  });

  it('throws from the environment the server actually starts with', () => {
    process.env['AI_TIER2_MODELS'] = 'nvidia/does-not-exist';
    resetEnvCache();
    resetAiRuntime();
    expect(() => assertAiConfiguration()).toThrow(/'nvidia\/does-not-exist' has no entry/);
  });

  it('is wired into server startup', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'instrumentation.ts'), 'utf8');
    expect(source).toContain('export async function register');
    expect(source).toContain('assertAiConfiguration()');
  });
});
