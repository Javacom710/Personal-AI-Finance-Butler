import { describe, expect, it } from 'vitest';

import { aiProviderSettings, type Env } from '@/lib/env';
import { INFERENCE_HOST_URLS } from '@/lib/inference-hosts';
import { DECLARED_CAPABILITIES } from '@/server/ai/config/capabilities';
import { INFERENCE_HOSTS, hostForBaseUrl, wireModelId } from '@/server/ai/config/hosts';
import { createNvidiaProvider, type FetchLike } from '@/server/ai/provider/nvidia-build';

/** OD-24: the host is configuration, and the application keeps canonical model ids. */

const settings = (over: Partial<Env>) =>
  aiProviderSettings({ NVIDIA_BASE_URL: 'https://integrate.api.nvidia.com/v1', AI_HOST: '', ...over } as Env);

describe('AI_HOST selects the endpoint', () => {
  it('leaves the earlier behaviour unchanged when unset', () => {
    expect(settings({ AI_API_KEY: 'k', AI_BASE_URL: 'https://api.deepinfra.com/v1/openai' }).baseUrl)
      .toBe('https://api.deepinfra.com/v1/openai');
    expect(settings({ AI_API_KEY: 'k' }).baseUrl).toBe('https://integrate.api.nvidia.com/v1');
  });

  it('supplies the named host URL', () => {
    expect(settings({ AI_API_KEY: 'k', AI_HOST: 'groq' }).baseUrl).toBe(INFERENCE_HOST_URLS.groq);
    expect(settings({ AI_API_KEY: 'k', AI_HOST: 'openrouter' }).baseUrl).toBe(INFERENCE_HOST_URLS.openrouter);
  });

  it('lets an explicit AI_BASE_URL win, which is how a gateway is reached', () => {
    expect(settings({ AI_API_KEY: 'k', AI_HOST: 'gateway', AI_BASE_URL: 'https://llm.example.internal/v1' }).baseUrl)
      .toBe('https://llm.example.internal/v1');
  });

  it('refuses a gateway with no URL rather than guessing one', () => {
    expect(() => settings({ AI_API_KEY: 'k', AI_HOST: 'gateway' })).toThrow('AI_BASE_URL');
  });

  it('never sends the legacy NVIDIA key to a named host', () => {
    expect(settings({ NVIDIA_API_KEY: 'legacy', AI_HOST: 'groq' })).toEqual({
      apiKey: 'legacy',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    });
  });
});

describe('model ids are translated only at the wire', () => {
  it('maps a canonical id to the host spelling it was confirmed under', () => {
    expect(wireModelId(INFERENCE_HOST_URLS.openrouter, 'zai-org/GLM-5.3-Flash')).toBe('z-ai/glm-5.3-flash');
    expect(wireModelId(`${INFERENCE_HOST_URLS.openrouter}/`, 'zai-org/GLM-5.3-Flash')).toBe('z-ai/glm-5.3-flash');
  });

  it('sends the canonical id where the host has no alias, and to an unknown endpoint', () => {
    expect(wireModelId(INFERENCE_HOST_URLS.deepinfra, 'zai-org/GLM-5.3-Flash')).toBe('zai-org/GLM-5.3-Flash');
    expect(wireModelId('https://llm.example.internal/v1', 'zai-org/GLM-5.3-Flash')).toBe('zai-org/GLM-5.3-Flash');
    expect(hostForBaseUrl('https://llm.example.internal/v1')).toBeNull();
    expect(hostForBaseUrl('not a url')).toBeNull();
  });

  it('aliases only canonical ids the application declares', () => {
    for (const host of Object.values(INFERENCE_HOSTS)) {
      for (const canonical of [...Object.keys(host.modelAliases), ...host.unavailable]) {
        expect(DECLARED_CAPABILITIES[canonical], `${host.id}: ${canonical}`).toBeDefined();
      }
    }
  });

  it('puts the host spelling in the request body and nowhere else', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        model: 'z-ai/glm-5.3-flash',
        provider: 'DeepInfra',
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const provider = createNvidiaProvider({
      apiKey: 'k', baseUrl: INFERENCE_HOST_URLS.openrouter, fetch: fetchImpl, defaultTimeoutMs: 5_000,
    });
    const result = await provider.chat({
      model: 'zai-org/GLM-5.3-Flash', messages: [{ role: 'user', content: 'hi' }], maxTokens: 8, timeoutMs: 5_000,
    });
    expect(result.ok).toBe(true);
    expect(bodies[0]?.['model']).toBe('z-ai/glm-5.3-flash');
  });
});
