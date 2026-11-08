import { expect, it } from 'vitest';
import { isTier1GenerationReleased } from '@/server/ai-feature-release';

it('keeps the code-only release hold even when settings-like environment flags and a key are present', () => {
  const names = ['AI_ENABLED', 'AI_TIER1_GENERATION_RELEASED', 'AI_API_KEY'] as const;
  const previous = names.map(name => [name, process.env[name]] as const);
  try {
    process.env.AI_ENABLED = 'true'; process.env.AI_TIER1_GENERATION_RELEASED = 'true'; process.env.AI_API_KEY = 'offline-key';
    expect(isTier1GenerationReleased()).toBe(false);
  } finally {
    for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
