import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { otherDeepinfraSpend } from '../../scripts/lib/deepinfra-accounting';

const endpoint = 'https://api.deepinfra.com/v1/openai';
async function put(root: string, file: string, accountedUsd: number, providerIdentity = endpoint) {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify({ providerIdentity, events: [{ accountedUsd }] }));
  return target;
}

it('counts every DeepInfra campaign, diagnostics and retained reservation once, excluding the active ledger and other accounts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'deepinfra-accounting-'));
  try {
    await put(root, 'deepinfra-old/usage.json', 0.1);
    await put(root, 'deepinfra-old/serial-start/usage.json', 0.2);
    await put(root, 'deepinfra-old/diagnostics/usage.json', 0.3);
    await put(root, 'groq-old/usage.json', 999, 'https://api.groq.com/openai/v1');
    const active = await put(root, 'deepinfra-new/usage.json', 4);
    expect(await otherDeepinfraSpend(root, active)).toBeCloseTo(0.6);
    expect(await otherDeepinfraSpend(root, path.join(root, 'not-yet-created.json'))).toBeCloseTo(4.6);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it.each([
  { usd: -1, provider: endpoint },
  { usd: 1, provider: 'https://api.groq.com/openai/v1' },
])('rejects an invalid or foreign ledger before allowing more spending: %o', async ({ usd, provider }) => {
  const root = await mkdtemp(path.join(tmpdir(), 'deepinfra-accounting-invalid-'));
  try {
    await put(root, 'deepinfra-old/usage.json', usd, provider);
    await expect(otherDeepinfraSpend(root, path.join(root, 'deepinfra-new/usage.json'))).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
