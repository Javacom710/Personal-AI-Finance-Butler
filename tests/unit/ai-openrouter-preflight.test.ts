import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('the real CLI refuses OpenRouter recording before any HTTP request', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'openrouter-preflight-'));
  const marker = path.join(dir, 'fetch-was-called');
  const preload = path.join(dir, 'deny-fetch.mjs');
  writeFileSync(preload, `import {writeFileSync} from 'node:fs';globalThis.fetch=async()=>{writeFileSync(${JSON.stringify(marker)},'called');throw new Error('HTTP is forbidden in this test');};`);
  try {
    let failure: { status?: number; stderr?: Buffer } | undefined;
    try {
      execFileSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--import', preload, 'scripts/ai-eval.ts', '--tier', '1'], {
        cwd: process.cwd(), env: { ...process.env, AI_API_KEY: 'fake-key-not-a-credential', AI_BASE_URL: 'https://openrouter.ai/api/v1' }, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) { failure = error as typeof failure; }
    expect(failure?.status).toBe(1);
    expect(failure?.stderr?.toString()).toMatch(/review-only.*--no-record/);
    expect(existsSync(marker)).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
