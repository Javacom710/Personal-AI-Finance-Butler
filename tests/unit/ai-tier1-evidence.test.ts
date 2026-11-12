import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { checkpointName, prepareTier1Evidence } from '../../scripts/lib/tier1-evidence';
import { retainedTier1Evidence } from '../helpers/tier1-evidence';

const model = 'zai-org/GLM-5.3-Flash';
const parseFile = checkpointName(model, 'parse');
const files = retainedTier1Evidence();
function changed(file: string, keys: string[], value: unknown) {
  const copy = { ...files };
  const data: Record<string, unknown> = JSON.parse(copy[file]!);
  let target = data;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[keys.at(-1)!] = value; copy[file] = JSON.stringify(data); return copy;
}
it('reconstructs the twelve exact recording rows and both production Tier 1 selections without rescoring', () => {
  const result = prepareTier1Evidence(files);
  expect(JSON.parse(JSON.stringify(result.preview))).toEqual(JSON.parse(readFileSync(new URL('../../docs/audits/2026-11-08-tier1-parse-v4-evidence-preview.json', import.meta.url), 'utf8')));
  expect(result.rows).toHaveLength(12); expect(result.preview).toMatchObject({ recorded: false, ownerApprovalRequired: true, proposedOrder: [model, 'openai/gpt-oss-120b'] });
  expect(result.rows.reduce((n, row) => n + row.detail.answered, 0)).toBe(380);
  expect(result.rows.find(r => r.model === model && r.suite === 'parse')).toMatchObject({ casesPassed: 38, casesTotal: 40, score: '0.9500', runAt: new Date('2026-11-08T15:09:10.342Z'), detail: { failedCases: ['parse-003', 'parse-010'], maxTokens: 1024 } });
  expect(result.rows.find(r => r.model === 'openai/gpt-oss-120b' && r.suite === 'injection')).toMatchObject({ casesPassed: 21 });
  expect(JSON.stringify(result.preview)).not.toMatch(/"(?:raw|prompt|output|response|apiKey)"/);
  expect(prepareTier1Evidence(files).preview.digest).toBe(result.preview.digest);
});
it.each([
  ['foreign endpoint', 'tier1.json', ['providerIdentity'], 'https://api.groq.com/openai/v1'],
  ['unreviewed source', 'tier1.json', ['sourceFingerprint'], '0'.repeat(64)],
  ['unreviewed plan', 'progress.json', ['plan'], 'qwen-candidates'],
  ['incomplete campaign', 'progress.json', ['coverageComplete'], false],
  ['already relabeled record', 'tier1.json', ['recorded'], true],
  ['partial report', 'tier1.json', ['limit'], 1],
  ['stale suite version', 'tier1.json', ['suiteVersions', 'parse'], 3],
  ['wrong model', 'tier1.json', ['models', '0', 'modelId'], 'openai/gpt-oss-20b'],
  ['profile mismatch', 'tier1.json', ['models', '0', 'requestProfile', 'fingerprint'], 'other'],
  ['wrong output budget', 'tier1.json', ['models', '0', 'suites', '0', 'maxTokens'], 2048],
  ['forged count', 'tier1.json', ['models', '0', 'suites', '0', 'passed'], 40],
  ['forged failure id', 'tier1.json', ['models', '0', 'suites', '0', 'failedCases', '0'], 'parse-001'],
  ['forged latency', 'tier1.json', ['models', '0', 'suites', '0', 'p50LatencyMs'], 0],
  ['forged histogram', 'tier1.json', ['models', '0', 'suites', '0', 'finishReasons', 'stop'], 39],
  ['forged model score', 'tier1.json', ['models', '0', 'retrievalGrounding'], 1],
  ['forged timestamp', 'tier1.json', ['startedAt'], '2026-11-09T00:00:00.000Z'],
  ['wrong checkpoint identity', parseFile, ['identity'], '0'.repeat(64)],
  ['other case id', parseFile, ['cases', '0', 'caseId'], 'not-in-corpus'],
  ['unanswered case', parseFile, ['cases', '0', 'errorClass'], 'timeout'],
  ['raw response in a case', parseFile, ['cases', '0', 'output'], 'private output'],
] as const)('rejects %s before evidence can be recorded', (_label, file, keys, value) => {
  expect(() => prepareTier1Evidence(changed(file, [...keys], value))).toThrow();
});
it.each(['missing checkpoint', 'extra checkpoint', 'duplicate suite', 'duplicate case', 'malformed JSON'])('rejects %s', kind => {
  const copy = { ...files };
  if (kind === 'missing checkpoint') delete copy[parseFile];
  if (kind === 'extra checkpoint') copy['other.json'] = '{}';
  if (kind === 'malformed JSON') copy[parseFile] = '{';
  if (kind === 'duplicate suite') { const r = JSON.parse(copy['tier1.json']!); r.models[0].suites[1] = r.models[0].suites[0]; copy['tier1.json'] = JSON.stringify(r); }
  if (kind === 'duplicate case') { const c = JSON.parse(copy[parseFile]!); c.cases[1] = c.cases[0]; copy[parseFile] = JSON.stringify(c); }
  expect(() => prepareTier1Evidence(copy)).toThrow();
});
it('refuses the actual earlier v3 campaign and leaves its pinned preview archived', () => {
  const earlier = retainedTier1Evidence('eval/reports/deepinfra-2026-11-07-tier1-parse-v3-2026-11-08');
  expect(() => prepareTier1Evidence(earlier)).toThrow();
  const preview = JSON.parse(readFileSync(new URL('../../docs/audits/2026-11-08-tier1-evidence-preview.json', import.meta.url), 'utf8'));
  expect(preview.digest).toBe('dc12fa595707112f1711fdabddd4fc93361e87da929ddf7593768c9d04983583');
});
it('binds the review digest to exact artifact bytes, including output-free diagnostics', () => {
  const original = prepareTier1Evidence(files).preview;
  const reformatted = { ...files, [parseFile]: files[parseFile]! + '\n' };
  const prepared = prepareTier1Evidence(reformatted);
  expect(prepared.rows).toEqual(prepareTier1Evidence(files).rows); expect(prepared.preview.digest).not.toBe(original.digest);
  expect(original.artifacts.find(f => f.name === parseFile)?.sha256).toBe(createHash('sha256').update(files[parseFile]!).digest('hex'));
});
it('previews with unusable database/secret configuration and denied network, without changing retained evidence', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url)); const temporary = mkdtempSync(path.join(tmpdir(), 'tier1-evidence-'));
  try {
    const hook = path.join(temporary, 'deny-network.mjs');
    writeFileSync(hook, `import net from 'node:net'; globalThis.fetch = () => { throw new Error('Network forbidden'); }; net.Socket.prototype.connect = function() { throw new Error('Sockets forbidden'); };`);
    const env = { ...process.env, DATABASE_URL: 'invalid', DATABASE_MIGRATION_URL: 'invalid', APP_ENCRYPTION_KEY: 'invalid', SESSION_COOKIE_SECRET: 'invalid' };
    const args = ['--conditions=react-server', '--import', hook, '--import', 'tsx', 'scripts/ai-tier1-evidence.ts'];
    const result = execFileSync(process.execPath, [...args, '--preview'], { cwd: root, env, encoding: 'utf8' });
    expect(JSON.parse(result)).toEqual(JSON.parse(JSON.stringify(prepareTier1Evidence(files).preview)));
    for (const invalid of [[], ['--record'], ['--record', '--expect-sha256', '0'.repeat(64)], ['--preview', '--record']]) {
      const refused = spawnSync(process.execPath, [...args, ...invalid], { cwd: root, env, encoding: 'utf8' });
      expect(refused.status).toBe(1); expect(refused.stdout).toBe(''); expect(refused.stderr).toContain('operation failed');
    }
    expect(retainedTier1Evidence()).toEqual(files);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}, 15000);
