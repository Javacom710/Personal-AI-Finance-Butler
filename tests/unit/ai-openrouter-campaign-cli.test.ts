import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
function invoke(args: string[], removeAppSettings = true, dirty = false) {
  const dir = mkdtempSync(path.join(tmpdir(), 'openrouter-cli-'));
  const marker = path.join(dir, 'http-called'); const preload = path.join(dir, 'offline.mjs');
  const git = dirty ? `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const original=cp.execFileSync;cp.execFileSync=(file,args,...rest)=>file==='git'&&args[0]==='status'?Buffer.from(${JSON.stringify(' M src/server/ai/eval/harness.ts\n')}):original(file,args,...rest);syncBuiltinESMExports();` : '';
  writeFileSync(preload, `import {writeFileSync} from 'node:fs';${git}process.loadEnvFile=()=>{};globalThis.fetch=async()=>{writeFileSync(${JSON.stringify(marker)},'called');throw Error('HTTP forbidden in test');};`);
  const environment = { ...process.env, AI_BASE_URL: 'https://openrouter.ai/api/v1', AI_REQUEST_PROFILES: '', AI_REQUEST_TIMEOUT_MS: '60000' } as NodeJS.ProcessEnv;
  delete environment.AI_API_KEY; delete environment.NVIDIA_API_KEY;
  if (dirty) environment.AI_API_KEY = 'fake-campaign-test-key';
  if (removeAppSettings) for (const key of ['DATABASE_URL', 'DATABASE_MIGRATION_URL', 'APP_ENCRYPTION_KEY', 'SESSION_COOKIE_SECRET']) delete environment[key];
  const root = path.resolve('eval/reports/openrouter'); const before = existsSync(root) ? readdirSync(root).sort() : null;
  try {
    let output = ''; let errorText = ''; let status = 0;
    try { output = execFileSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--import', pathToFileURL(preload).href, 'scripts/ai-measure-openrouter.ts', ...args], { env: environment, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { const e = error as { status: number; stdout: string; stderr: string }; status = e.status; output = e.stdout; errorText = e.stderr; }
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(root) ? readdirSync(root).sort() : null).toEqual(before);
    return { status, output, errorText };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
it('default status needs no vision ID, key, database settings or network', () => {
  const result = invoke([]); expect(result.status).toBe(0); expect(result.output).toContain('Offline status');
});
it('selected-campaign status builds the real finite plan without keys, database settings, writes or HTTP', () => {
  const result = invoke(['--status', '--vision-model', 'qwen/fake-catalogue-vision']); expect(result.status).toBe(0);
  const progress = JSON.parse(result.output); expect(progress.expectedCases).toBeGreaterThan(100); expect(progress.reservedCalls).toBe(0);
  expect(progress.recordsCapabilities).toBe(false); expect(progress.changesRouting).toBe(false);
});
it.each([['--run'], ['--finalize'], ['--record'], ['--retry'], ['--run', '--status'], ['--vision-model', 'other/fake-vision']])('rejects invalid or unready workflow %j without any HTTP', (...args) => {
  expect(invoke(args).status).toBe(1);
});
it('requires an explicit ready OpenRouter key for run and recovery, never borrowing a legacy key', () => {
  for (const args of [['--run'], ['--recover-case', '["case"]']]) {
    const result = invoke([...args, '--vision-model', 'qwen/fake-catalogue-vision'], false);
    expect(result.status).toBe(1); expect(result.errorText).toContain('OpenRouter key/endpoint readiness is missing');
  }
});
it('offline finalize does not create reports or call a model when its checkpoint is absent', () => {
  const result = invoke(['--finalize', '--vision-model', 'qwen/fake-catalogue-vision']); expect(result.status).toBe(1); expect(result.errorText).toContain('No checkpoint exists');
});

it('refuses live inference from dirty measurement sources before HTTP or output writes', () => {
  const result = invoke(['--run', '--vision-model', 'qwen/fake-catalogue-vision'], false, true);
  expect(result.status).toBe(1); expect(result.errorText).toContain('Commit measurement-input changes');
});
