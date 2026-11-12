import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { DEEPINFRA_MEASUREMENT_MODELS, resolveModelConfig } from '@/server/ai/config/models';

it('runs bounded legacy and Tier 1 diagnostic plans without output retention or measurement writes, and enforces guards', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'deepinfra-diagnostic-test-'));
  const repository = fileURLToPath(new URL('../..', import.meta.url));
  try {
    execFileSync('git', ['init', '-q', root]);
    for (const name of ['scripts', 'src', 'node_modules', 'tsconfig.json', 'package.json']) symlinkSync(path.join(repository, name), path.join(root, name));
    const directory = path.join(root, 'eval/reports/deepinfra-2026-11-07');
    mkdirSync(path.join(directory, 'serial-start'), { recursive: true });
    const endpoint = 'https://api.deepinfra.com/v1/openai';
    const selected = resolveModelConfig().candidates(1);
    const models = [DEEPINFRA_MEASUREMENT_MODELS[2][0], DEEPINFRA_MEASUREMENT_MODELS[4][0], ...selected];
    writeFileSync(path.join(directory, 'catalogue.json'), JSON.stringify({ providerIdentity: endpoint, data: models.map(id => ({ id, metadata: { pricing: { input_tokens: 0.15, output_tokens: 0.6 } } })) }));
    const baseline = JSON.stringify({ providerIdentity: endpoint, events: [{ accountedUsd: 0.01 }] });
    for (const f of ['usage.json', 'serial-start/usage.json']) writeFileSync(path.join(directory, f), baseline);
    const hook = path.join(root, 'fetch.mjs');
    writeFileSync(hook, `globalThis.fetch = async (url, init) => {
      if (url !== '${endpoint}/chat/completions') throw new Error('Unexpected endpoint');
      const body=JSON.parse(init.body);
      if (!${JSON.stringify(models)}.includes(body.model)) throw new Error('Unexpected model');
      const expectedBudget = body.model === ${JSON.stringify(models[0])} ? 4096 :
        ${JSON.stringify(selected)}.includes(body.model) && body.response_format ? 1024 : 2048;
      if (body.max_tokens !== expectedBudget) throw new Error('Changed request budget');
      return new Response(JSON.stringify({model:body.model, choices:[{message:{content:'PRIVATE_MODEL_CONTENT',reasoning_content:'PRIVATE_REASONING'},finish_reason:'stop'}],
        ...(${JSON.stringify(selected)}.includes(body.model) ? {usage:{prompt_tokens:1,completion_tokens:1}} : {})}),{status:200});
    };`);
    const loader = fileURLToPath(import.meta.resolve('tsx'));
    const run = (argv: string[], overrides = {}) => spawnSync(process.execPath, ['--conditions=react-server', '--import', hook, '--import', loader, path.join(repository, 'scripts/ai-diagnose-deepinfra.ts'), ...argv], {
      cwd: root, encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, AI_BASE_URL: endpoint, AI_API_KEY: 'offline-key', AI_REQUEST_PROFILES: '', AI_TIER1_MODELS: 'unselected/environment-override', ...overrides },
    });
    expect(run(['--plan']).status).toBe(0);
    const analysisPlan = run(['--plan', '--analysis-only']);
    expect(analysisPlan.status, analysisPlan.stderr).toBe(0);
    expect(JSON.parse(analysisPlan.stdout).cases).toHaveLength(3);
    expect(JSON.parse(analysisPlan.stdout).cases.every((c: { suite: string }) => c.suite === 'analysis')).toBe(true);
    expect(run(['--plan', '--analysis-only', '--analysis-only']).status).toBe(1);
    const tier1Plan = run(['--plan', '--tier1-failures']);
    expect(tier1Plan.status, tier1Plan.stderr).toBe(0);
    const tier1Cases = JSON.parse(tier1Plan.stdout).cases;
    expect(tier1Cases).toHaveLength(15);
    expect(tier1Cases.every((c: { tier: number; model: string }) => c.tier === 1 && selected.includes(c.model))).toBe(true);
    expect(run(['--plan', '--tier1-failures', '--analysis-only']).status).toBe(1);
    expect(run(['--plan', '--tier1-failures', '--tier1-failures']).status).toBe(1);
    expect(readdirSync(directory)).not.toContain('diagnostics');
    const first = run(['--run', '--no-record']);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).not.toContain('PRIVATE');
    const diagnosticDir = path.join(directory, 'diagnostics');
    const reports = () => readdirSync(diagnosticDir).filter(f => f !== 'usage.json');
    const reportText = readFileSync(path.join(diagnosticDir, reports()[0]!), 'utf8');
    const report = JSON.parse(reportText);
    expect(report).toMatchObject({ diagnosticOnly: true, completeMeasurement: false, recorded: false, productionEligible: false, providerIdentity: endpoint });
    expect(report.rows).toHaveLength(6);
    expect(report.rows.every((r: { diagnostics: { reasons: string[] } }) => r.diagnostics.reasons.length)).toBe(true);
    expect(reportText).not.toContain('PRIVATE');
    const ledgerFile = path.join(diagnosticDir, 'usage.json');
    const ledger = JSON.parse(readFileSync(ledgerFile, 'utf8'));
    expect(ledger.events).toHaveLength(6);
    const lockPath = path.join(path.dirname(directory), '.deepinfra-account.lock');
    writeFileSync(lockPath, 'another-process\n');
    expect(run(['--run', '--no-record']).status).toBe(1);
    expect(readFileSync(lockPath, 'utf8')).toBe('another-process\n');
    rmSync(lockPath);
    expect(ledger.events.every((e: { reservedUsd: number; accountedUsd: number }) => e.accountedUsd === e.reservedUsd && e.accountedUsd > 0)).toBe(true);
    const analysisOnly = run(['--run', '--no-record', '--analysis-only']);
    expect(analysisOnly.status, analysisOnly.stderr).toBe(0);
    expect(JSON.parse(readFileSync(ledgerFile, 'utf8')).events).toHaveLength(9);
    const tier1 = run(['--run', '--no-record', '--tier1-failures']);
    expect(tier1.status, tier1.stderr).toBe(0);
    expect(tier1.stdout).not.toContain('PRIVATE');
    const tier1Report = reports().map(f => JSON.parse(readFileSync(path.join(diagnosticDir, f), 'utf8')))
      .find(r => r.rows.length === 15);
    expect(tier1Report).toMatchObject({ diagnosticOnly: true, completeMeasurement: false, recorded: false, productionEligible: false });
    expect(tier1Report.rows.every((r: { diagnostics: { passed: boolean; counts: object }; result: { passed: boolean } }) =>
      r.result.passed === r.diagnostics.passed &&
      (r.result.passed || Object.values(r.diagnostics.counts).some(n => n > 0)))).toBe(true);
    expect(JSON.stringify(tier1Report)).not.toContain('PRIVATE');
    expect(JSON.parse(readFileSync(ledgerFile, 'utf8')).events).toHaveLength(24);
    expect(JSON.parse(readFileSync(ledgerFile, 'utf8')).events.slice(9)
      .every((e: { accountedUsd: number; reservedUsd: number }) => e.accountedUsd < e.reservedUsd)).toBe(true);
    expect(run(['--run', '--record']).status).toBe(1);
    expect(run(['--run', '--no-record'], { AI_BASE_URL: 'https://openrouter.ai/api/v1' }).status).toBe(1);
    writeFileSync(hook, 'globalThis.fetch = async () => new Response("{}", {status:429});');
    const quota = run(['--run', '--no-record']);
    expect(quota.status).toBe(1);
    expect(quota.stderr).toContain('Provider HTTP 429');
    expect(JSON.parse(readFileSync(ledgerFile, 'utf8')).events).toHaveLength(25);
    const exhausted = { ...ledger, events: [{ ...ledger.events[0], accountedUsd: 0.25 }] };
    writeFileSync(ledgerFile, JSON.stringify(exhausted));
    const cap = run(['--run', '--no-record']);
    expect(cap.status).toBe(1);
    expect(cap.stderr).toContain('spend cap reached before request');
    expect(JSON.parse(readFileSync(ledgerFile, 'utf8')).events).toHaveLength(1);
    writeFileSync(ledgerFile, JSON.stringify({ ...exhausted, providerIdentity: 'https://api.groq.com/openai/v1' }));
    expect(run(['--run', '--no-record']).status).toBe(1);
    for (const f of ['usage.json', 'serial-start/usage.json']) expect(readFileSync(path.join(directory, f), 'utf8')).toBe(baseline);
    expect(readdirSync(directory)).not.toContain('.measurement.lock');
    expect(readdirSync(path.dirname(directory))).not.toContain('.deepinfra-account.lock');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 60_000);
