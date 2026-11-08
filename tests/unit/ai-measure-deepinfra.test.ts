import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { DEEPINFRA_MEASUREMENT_MODELS, resolveModelConfig } from '../../src/server/ai/config/models';

it('runs the full DeepInfra queue without storage, resumes offline, and rejects foreign checkpoints and recording', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'deepinfra-eval-test-'));
  const repository = fileURLToPath(new URL('../..', import.meta.url));
  try {
    execFileSync('git', ['init', '-q', root]);
    for (const name of ['scripts', 'src', 'node_modules', 'tsconfig.json', 'package.json']) symlinkSync(path.join(repository, name), path.join(root, name));
    const directory = path.join(root, 'eval/reports/deepinfra-2026-11-07');
    mkdirSync(directory, { recursive: true });
    const endpoint = 'https://api.deepinfra.com/v1/openai';
    const selectedModels = resolveModelConfig().candidates(1);
    const models = [...new Set([...Object.values(DEEPINFRA_MEASUREMENT_MODELS).flat(), ...selectedModels])];
    writeFileSync(path.join(directory, 'catalogue.json'), JSON.stringify({ providerIdentity: endpoint, data: models.map(id => ({ id, metadata: { pricing: { input_tokens: 0.15, output_tokens: 0.6 } } })) }));
    const hook = path.join(root, 'fetch.mjs');
    writeFileSync(hook, `globalThis.fetch = async (url, init) => {
      if (url !== '${endpoint}/chat/completions') throw new Error('Unexpected endpoint');
      const body = JSON.parse(init.body);
      if (${JSON.stringify(models)}.includes(body.model) === false) throw new Error('Unexpected model');
      return new Response(JSON.stringify({model:body.model,choices:[{message:{content:'PRIVATE_MODEL_CONTENT',reasoning_content:'PRIVATE_REASONING'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}}),{status:200});
    };`);
    const loader = fileURLToPath(import.meta.resolve('tsx'));
    const run = (...argv: string[]) => spawnSync(process.execPath, ['--conditions=react-server', '--import', hook, '--import', loader, path.join(repository, 'scripts/ai-measure-deepinfra.ts'), ...argv], {
      cwd: root, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, AI_BASE_URL: endpoint, AI_API_KEY: 'offline-test-key', AI_REQUEST_PROFILES: '' },
    });
    const live = run('--run', '--no-record');
    expect(live.status, live.stderr).toBe(0);
    const progress = () => JSON.parse(readFileSync(path.join(directory, 'progress.json'), 'utf8'));
    expect(progress()).toMatchObject({ provider: 'DeepInfra', providerIdentity: endpoint, coverageComplete: true, ownerApprovalRequired: true, recorded: false });
    expect(progress().rows).toHaveLength(17);
    expect(progress().candidates.every((c: { missingSuites: string[] }) => !c.missingSuites.length)).toBe(true);
    const ledger = readFileSync(path.join(directory, 'usage.json'), 'utf8');
    expect(JSON.parse(ledger).events).toHaveLength(420);
    expect(progress().accountedUsd).toBeLessThan(0.01);
    const diagnosticCounts: number[] = [];
    const retainedCheckpoints = new Map<string, string>();
    for (const name of readdirSync(directory).filter(f => f.startsWith('checkpoint-'))) {
      const text = readFileSync(path.join(directory, name), 'utf8');
      retainedCheckpoints.set(name, text);
      expect(text).not.toContain('PRIVATE');
      const cp = JSON.parse(text);
      if (['analysis', 'document', 'parse', 'injection'].includes(cp.suite)) {
        expect(Object.keys(cp.diagnostics)).toHaveLength(cp.cases.length);
        diagnosticCounts.push(Object.keys(cp.diagnostics).length);
      } else expect(cp.diagnostics).toBeUndefined();
    }
    expect(diagnosticCounts.sort((a, b) => a - b)).toEqual([15, 15, 20, 25, 25, 25, 40]);
    const tier2 = JSON.parse(readFileSync(path.join(directory, 'tier2.json'), 'utf8'));
    expect(tier2.models[0].suites.find((s: { suite: string }) => s.suite === 'analysis').diagnostics)
      .toMatchObject({ captured: 15, passed: 0, failed: 15, failedWithPassingLayoutComparison: 0 });
    expect(live.stdout).not.toContain('PRIVATE');
    const successfulFetch = readFileSync(hook, 'utf8');
    // A resume must use retained scores; any unexpected fetch now fails.
    writeFileSync(hook, 'globalThis.fetch = () => { throw new Error("Unexpected network call"); };');
    const resume = run('--run', '--no-record');
    expect(resume.status, resume.stderr).toBe(0);
    expect(readFileSync(path.join(directory, 'usage.json'), 'utf8')).toBe(ledger);
    for (const [name, original] of retainedCheckpoints) expect(readFileSync(path.join(directory, name), 'utf8')).toBe(original);
    expect(run('--status').status).toBe(0);
    const originalProgress = readFileSync(path.join(directory, 'progress.json'), 'utf8');
    writeFileSync(path.join(directory, 'progress.json'), JSON.stringify({ ...JSON.parse(originalProgress), sourceFingerprint: 'old-candidate-plan' }));
    const foreignCampaign = run('--status');
    expect(foreignCampaign.status).toBe(1);
    expect(foreignCampaign.stderr).toContain('Campaign source differs');
    expect(readFileSync(path.join(directory, 'usage.json'), 'utf8')).toBe(ledger);
    writeFileSync(path.join(directory, 'progress.json'), originalProgress);
    const diagnosticName = [...retainedCheckpoints.keys()].find(name => name.includes('-analysis-'))!;
    const originalDiagnostic = retainedCheckpoints.get(diagnosticName)!;
    const invalidDiagnostic = JSON.parse(originalDiagnostic);
    invalidDiagnostic.diagnostics['analysis-001'].counts.PRIVATE_OUTPUT_KEY = 1;
    writeFileSync(path.join(directory, diagnosticName), JSON.stringify(invalidDiagnostic));
    const unsafeMetadata = run('--status');
    expect(unsafeMetadata.status).toBe(1);
    expect(unsafeMetadata.stderr).toContain('Invalid checkpoint structure or diagnostic metadata');
    expect(unsafeMetadata.stderr).not.toContain('PRIVATE');
    expect(readFileSync(path.join(directory, 'usage.json'), 'utf8')).toBe(ledger);
    writeFileSync(path.join(directory, diagnosticName), originalDiagnostic);
    writeFileSync(hook, successfulFetch);
    const campaign = run('--run', '--no-record', '--campaign', 'format-v3');
    expect(campaign.status, campaign.stderr).toBe(0);
    const fresh = path.join(root, 'eval/reports/deepinfra-2026-11-07-format-v3');
    expect(JSON.parse(readFileSync(path.join(fresh, 'progress.json'), 'utf8'))).toMatchObject({ campaign: 'format-v3', coverageComplete: true, accountCapUsd: 4.50 });
    expect(JSON.parse(readFileSync(path.join(fresh, 'usage.json'), 'utf8')).events).toHaveLength(420);
    expect(readFileSync(path.join(directory, 'usage.json'), 'utf8')).toBe(ledger);
    // ADR-55's selected pair is a separate complete Tier 1 campaign, not an
    // implicit replacement of the historical Qwen plan or a live activation.
    const selected = run('--run', '--no-record', '--selected-tier1', '--campaign', 'selected-tier1');
    expect(selected.status, selected.stderr).toBe(0);
    const selectedDirectory = path.join(root, 'eval/reports/deepinfra-2026-11-07-selected-tier1');
    const selectedProgress = JSON.parse(readFileSync(path.join(selectedDirectory, 'progress.json'), 'utf8'));
    expect(selectedProgress).toMatchObject({ plan: 'selected-tier1', coverageComplete: true, ownerApprovalRequired: true, recorded: false });
    expect(selectedProgress.rows).toHaveLength(12);
    expect(selectedProgress.rows.every((row: { tier: number }) => row.tier === 1)).toBe(true);
    const selectedReport = JSON.parse(readFileSync(path.join(selectedDirectory, 'tier1.json'), 'utf8'));
    expect(selectedReport.models.map((model: { modelId: string }) => model.modelId)).toEqual(selectedModels);
    expect(selectedReport.suiteVersions).toEqual({ parse: 3, classify: 2, 'tool-select': 3, grounding: 5, robustness: 5, injection: 4 });
    for (const model of selectedReport.models) {
      expect(model.suites.find((s: { suite: string }) => s.suite === 'parse').diagnostics).toMatchObject({ captured: 40 });
      expect(model.suites.find((s: { suite: string }) => s.suite === 'injection').diagnostics).toMatchObject({ captured: 25 });
    }
    expect(readdirSync(selectedDirectory)).not.toContain('tier2.json');
    const selectedLedger = readFileSync(path.join(selectedDirectory, 'usage.json'), 'utf8');
    expect(JSON.parse(selectedLedger).events).toHaveLength(380);
    expect(readFileSync(path.join(directory, 'usage.json'), 'utf8')).toBe(ledger);
    writeFileSync(hook, 'globalThis.fetch = () => { throw new Error("Unexpected network call"); };');
    expect(run('--run', '--no-record', '--selected-tier1', '--campaign', 'selected-tier1').status).toBe(0);
    const changedPlan = run('--status', '--campaign', 'selected-tier1');
    expect(changedPlan.status).toBe(1);
    expect(changedPlan.stderr).toContain('Campaign source differs');
    expect(readFileSync(path.join(selectedDirectory, 'usage.json'), 'utf8')).toBe(selectedLedger);
    expect(run('--status', '--selected-tier1').status).toBe(1);
    expect(run('--status', '--selected-tier1', '--selected-tier1', '--campaign', 'duplicate').status).toBe(1);
    expect(run('--status', '--campaign', '../escape').status).toBe(1);
    expect(run('--status', '--campaign', 'one', '--campaign', 'two').status).toBe(1);
    expect(run('--run', '--record').status).toBe(1);
    const file = path.join(directory, readdirSync(directory).find(f => f.startsWith('checkpoint-'))!);
    const checkpoint = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...checkpoint, providerIdentity: 'https://api.groq.com/openai/v1' }));
    const foreign = run('--run', '--no-record');
    expect(foreign.status).toBe(1);
    expect(foreign.stderr).toContain('provenance');
    expect(readFileSync(path.join(directory, 'usage.json'), 'utf8')).toBe(ledger);
    // Leave one missing case, exhaust the cap, and ensure it cannot be sent.
    writeFileSync(file, JSON.stringify({ ...checkpoint, cases: checkpoint.cases.slice(1) }));
    const exhausted = JSON.parse(ledger);
    exhausted.events.forEach((event: { accountedUsd: number }, index: number) => { event.accountedUsd = index === 0 ? 4.75 : 0; });
    writeFileSync(path.join(directory, 'usage.json'), JSON.stringify(exhausted));
    const cap = run('--run', '--no-record');
    expect(cap.status).toBe(1);
    expect(cap.stderr).toContain('Spend cap reached before request');
    expect(JSON.parse(readFileSync(path.join(directory, 'usage.json'), 'utf8')).events).toHaveLength(420);
    const blockedCampaign = run('--run', '--no-record', '--campaign', 'blocked-by-account-cap');
    expect(blockedCampaign.status).toBe(1);
    expect(blockedCampaign.stderr).toContain('Spend cap reached before request');
    expect(() => readFileSync(path.join(root, 'eval/reports/deepinfra-2026-11-07-blocked-by-account-cap/usage.json'))).toThrow();
    // A provider failure is retained once and stops the queue without retry.
    writeFileSync(path.join(directory, 'usage.json'), ledger);
    writeFileSync(hook, 'globalThis.fetch = async () => new Response("{}", {status:429});');
    const quota = run('--run', '--no-record');
    expect(quota.status).toBe(1);
    expect(quota.stderr).toContain('Provider HTTP 429; no retry');
    expect(JSON.parse(readFileSync(path.join(directory, 'usage.json'), 'utf8')).events).toHaveLength(421);
    expect(JSON.parse(readFileSync(file, 'utf8')).cases.at(-1).errorClass).toBe('rate_limited');
    expect(readdirSync(directory)).not.toContain('.measurement.lock');
    expect(readdirSync(path.dirname(directory))).not.toContain('.deepinfra-account.lock');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 60_000);
