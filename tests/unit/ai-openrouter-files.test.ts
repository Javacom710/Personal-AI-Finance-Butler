import { mkdtemp, readFile, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ok } from '@/lib/result';
import type { AiProvider } from '@/server/ai/provider/types';
import { openRouterPolicy } from '@/server/ai/provider/openrouter-policy';
import { DEFAULT_REQUEST_PROFILE } from '@/server/ai/config/request-profiles';
import { buildCampaignPlan, campaignProgress, emptyCampaign, measureCampaign, validateCampaignCheckpoint } from '../../scripts/lib/ai-openrouter-campaign';
import { campaignFiles } from '../../scripts/lib/ai-openrouter-files';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function directory() { const dir = await mkdtemp(path.join(tmpdir(), 'openrouter-campaign-')); dirs.push(dir); return dir; }
function fixture() {
  const score = vi.fn(() => true);
  const plan = buildCampaignPlan([{ tier: 4, model: 'qwen/fake-vision', suite: 'document', version: 1, profile: DEFAULT_REQUEST_PROFILE, cases: [{ id: 'fixture', suite: 'document', messages: [{ role: 'user', content: 'Synthetic document only' }], score }] }], 'source', 0);
  const policy = openRouterPolicy('https://openrouter.ai/api/v1')!; const calls = vi.fn();
  const provider: AiProvider = { key: 'fake', measurementPolicy: policy, requestProfileFor: () => DEFAULT_REQUEST_PROFILE, isConfigured: () => true, listModels: async () => ok([]), chat: async r => { calls(); return ok({ model: r.model, content: 'synthetic answer', toolCalls: [], reasoning: null, finishReason: 'stop', latencyMs: 1, usage: { promptTokens: 1, completionTokens: 1 }, provenance: { providerIdentity: policy.providerIdentity, requestPolicyFingerprint: policy.requestPolicyFingerprint, servingHost: 'DeepInfra' } }); } };
  return { plan, score, provider, calls };
}
it('persists checkpoints atomically and finalizes identical reports without HTTP, rescoring or altering checkpoints', async () => {
  const dir = await directory(); const files = campaignFiles(dir); const f = fixture();
  expect(await files.load()).toBeUndefined();
  await files.locked(async store => { const done = await measureCampaign(f.plan, emptyCampaign(f.plan, new Date()), f.provider, store); await files.reports(f.plan, done.checkpoint, done.stop); });
  const bytes = await readFile(files.checkpointPath, 'utf8'); const cp = validateCampaignCheckpoint(f.plan, await files.load());
  f.score.mockClear(); f.calls.mockClear();
  const before = await readFile(path.join(dir, 'tier-4.json'), 'utf8');
  await files.locked(async () => { await files.reports(f.plan, cp, 'offline report recovery'); });
  expect(await readFile(path.join(dir, 'tier-4.json'), 'utf8')).toBe(before); expect(await readFile(files.checkpointPath, 'utf8')).toBe(bytes);
  expect(f.score).not.toHaveBeenCalled(); expect(f.calls).not.toHaveBeenCalled();
  if (process.platform !== 'win32') expect((await stat(files.checkpointPath)).mode & 0o777).toBe(0o600);
  expect((await readdir(dir)).some(name => name.endsWith('.tmp') || name === '.measurement.lock')).toBe(false);
  expect(bytes).not.toContain('synthetic answer'); expect(bytes).not.toContain('Synthetic document only');
});
it('excludes concurrent writers and releases the lock after exceptions', async () => {
  const dir = await directory(); const files = campaignFiles(dir); let release!: () => void; let entered!: () => void;
  const ready = new Promise<void>(r => { entered = r; }); const held = new Promise<void>(r => { release = r; });
  const first = files.locked(async () => { entered(); await held; throw Error('test interruption'); });
  await ready; await expect(files.locked(async () => {})).rejects.toThrow(/lock exists/); release(); await expect(first).rejects.toThrow('test interruption');
  await expect(files.locked(async () => 'released')).resolves.toBe('released');
});
it('never silently deletes a stale lock or replays an unconfirmed reservation', async () => {
  const dir = await directory(); const files = campaignFiles(dir); const stale = JSON.stringify({ pid: 99999999, createdAt: '2026-01-01T00:00:00Z' });
  await writeFile(path.join(dir, '.measurement.lock'), stale, { mode: 0o600 });
  await expect(files.locked(async () => {})).rejects.toThrow(/Inspect its PID/); expect(await readFile(path.join(dir, '.measurement.lock'), 'utf8')).toBe(stale);
  const f = fixture(); expect(campaignProgress(f.plan, emptyCampaign(f.plan, new Date())).reservedCalls).toBe(0); expect(f.calls).not.toHaveBeenCalled();
});
it('preserves a valid reserved checkpoint on an interrupted writer', async () => {
  const dir = await directory(); const files = campaignFiles(dir); const f = fixture(); const cp = emptyCampaign(f.plan, new Date());
  await expect(files.locked(async store => { await store.save(cp); throw Error('stop before HTTP'); })).rejects.toThrow('stop before HTTP');
  expect(validateCampaignCheckpoint(f.plan, await files.load())).toEqual(cp); expect(f.calls).not.toHaveBeenCalled();
});
