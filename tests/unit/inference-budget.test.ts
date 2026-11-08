import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CAP_MESSAGE, assertWithinProjectCap, effectiveCapUsd, isFreeHost, loadInferenceBudget,
  projectSpend, reserveInActiveLedger, reserveUnledgeredSpend, takeReserveFlag, withProjectBudgetLock,
} from '../../scripts/lib/inference-budget';

const roots: string[] = [];
const root = () => { const r = mkdtempSync(path.join(tmpdir(), 'inference-budget-')); roots.push(r); return r; };
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
const ledger = (r: string, dir: string, usd: number[]) => {
  mkdirSync(path.join(r, 'eval/reports', dir), { recursive: true });
  writeFileSync(path.join(r, 'eval/reports', dir, 'usage.json'), JSON.stringify({ providerIdentity: 'x', events: usd.map(accountedUsd => ({ accountedUsd })) }));
};
const config = (r: string, value: unknown) => {
  mkdirSync(path.join(r, 'config'), { recursive: true });
  writeFileSync(path.join(r, 'config/inference-budget.json'), JSON.stringify(value));
};
const base = { capUsd: 10, freeHosts: ['api.groq.com'], extensions: [], externalSpend: [] };
const vetted = { requestedOn: '2026-11-20', necessity: 'Tier 4 document suite cannot finish inside the cap.', alternativesConsidered: 'Fewer cases, a cheaper vision model, free tiers without training.', decidedBy: 'owner', decidedOn: '2026-11-21' };

describe('project inference cap (ADR-56)', () => {
  it('defaults to the US$10 cap with no extensions when the file is missing', async () => {
    const r = root();
    expect(effectiveCapUsd(await loadInferenceBudget(r))).toBe(10);
  });

  it('pins the cap: raising capUsd directly is rejected', async () => {
    const r = root(); config(r, { ...base, capUsd: 50 });
    await expect(loadInferenceBudget(r)).rejects.toThrow(/invalid/);
  });

  it('adds only extensions the owner decided to spend, and requires the vetting fields', async () => {
    const r = root();
    config(r, { ...base, extensions: [{ ...vetted, amountUsd: 5, decision: 'spend' }, { ...vetted, amountUsd: 20, decision: 'not_spend' }] });
    expect(effectiveCapUsd(await loadInferenceBudget(r))).toBe(15);
    config(r, { ...base, extensions: [{ amountUsd: 5, decision: 'spend', decidedBy: 'owner' }] });
    await expect(loadInferenceBudget(r)).rejects.toThrow(/invalid/);
    config(r, { ...base, extensions: [{ ...vetted, amountUsd: 5, decision: 'spend', decidedBy: 'agent' }] });
    await expect(loadInferenceBudget(r)).rejects.toThrow(/invalid/);
  });

  it('sums every provider ledger and owner-reported external spend, excluding the active ledger', async () => {
    const r = root();
    ledger(r, 'deepinfra-a', [1, 0.5]); ledger(r, 'openrouter/x', [0.25]); ledger(r, 'unledgered', [0.05]);
    config(r, { ...base, externalSpend: [{ provider: 'DeepInfra', usd: 2, recordedOn: '2026-11-08', note: 'dashboard reconciliation' }] });
    expect((await projectSpend(r)).spentUsd).toBeCloseTo(3.8);
    expect((await projectSpend(r, path.join(r, 'eval/reports/deepinfra-a/usage.json'))).spentUsd).toBeCloseTo(2.3);
  });

  it('fails closed on an unreadable ledger', async () => {
    const r = root(); mkdirSync(path.join(r, 'eval/reports/bad'), { recursive: true });
    writeFileSync(path.join(r, 'eval/reports/bad/usage.json'), JSON.stringify({ events: [{ accountedUsd: -1 }] }));
    await expect(projectSpend(r)).rejects.toThrow(/Unreadable spend ledger/);
  });

  it('refuses a request that would cross the cap and allows one that fits', () => {
    expect(() => assertWithinProjectCap({ spentUsd: 9.9, capUsd: 10, remainingUsd: 0.1 }, 0.1)).not.toThrow();
    expect(() => assertWithinProjectCap({ spentUsd: 9.9, capUsd: 10, remainingUsd: 0.1 }, 0.2)).toThrow(CAP_MESSAGE);
    expect(() => assertWithinProjectCap({ spentUsd: 0, capUsd: 10, remainingUsd: 10 }, Number.NaN)).toThrow(/Invalid/);
  });

  it('reserves unledgered spend as accounted spend, and refuses past the cap without writing', async () => {
    const r = root(); ledger(r, 'deepinfra-a', [9.9]);
    await reserveUnledgeredSpend(r, { script: 'ai:smoke', providerIdentity: 'https://api.deepinfra.com', reservedUsd: 0.05, note: 't' });
    expect((await projectSpend(r)).spentUsd).toBeCloseTo(9.95);
    await expect(reserveUnledgeredSpend(r, { script: 'ai:eval', providerIdentity: 'https://api.deepinfra.com', reservedUsd: 0.1, note: 't' })).rejects.toThrow(CAP_MESSAGE);
    expect(JSON.parse(readFileSync(path.join(r, 'eval/reports/unledgered/usage.json'), 'utf8')).events).toHaveLength(1);
  });

  it('treats only configured hosts as free and parses --reserve-usd', async () => {
    const c = await loadInferenceBudget(root());
    expect(isFreeHost('https://api.groq.com/openai/v1', c)).toBe(true);
    expect(isFreeHost('https://api.deepinfra.com/v1/openai', c)).toBe(false);
    expect(takeReserveFlag(['--tier', '1', '--reserve-usd', '0.5'])).toEqual({ argv: ['--tier', '1'], reserveUsd: 0.5 });
    expect(() => takeReserveFlag(['--reserve-usd', '0'])).toThrow();
  });

  it('serializes concurrent reservations so parallel runners cannot overshoot the cap', async () => {
    const r = root(); ledger(r, 'deepinfra-a', [9]);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () =>
      reserveUnledgeredSpend(r, { script: 'ai:eval', providerIdentity: 'https://x.test', reservedUsd: 0.3, note: 'race' })));
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(3);
    expect(JSON.parse(readFileSync(path.join(r, 'eval/reports/unledgered/usage.json'), 'utf8')).events).toHaveLength(3);
    expect((await projectSpend(r)).spentUsd).toBeLessThanOrEqual(10);
    expect(existsSync(path.join(r, 'eval/reports/.inference-budget.lock'))).toBe(false);
  });

  it('refreshes the total for runners with their own ledger, seeing reservations made meanwhile', async () => {
    const r = root(); ledger(r, 'deepinfra-a', [9]);
    const active = path.join(r, 'eval/reports/deepinfra-b/usage.json');
    await reserveUnledgeredSpend(r, { script: 'ai:eval', providerIdentity: 'https://x.test', reservedUsd: 0.8, note: 'other runner' });
    let persisted = false;
    await expect(reserveInActiveLedger(r, active, () => 0, 0.3, async () => { persisted = true; })).rejects.toThrow(CAP_MESSAGE);
    expect(persisted).toBe(false);
    await reserveInActiveLedger(r, active, () => 0, 0.2, async () => { persisted = true; });
    expect(persisted).toBe(true);
  });

  it('clears a lock left by a dead process and waits for a live one', async () => {
    const r = root(); mkdirSync(path.join(r, 'eval/reports'), { recursive: true });
    writeFileSync(path.join(r, 'eval/reports/.inference-budget.lock'), '2147483646\n');
    await expect(withProjectBudgetLock(r, async () => 'ran')).resolves.toBe('ran');
    writeFileSync(path.join(r, 'eval/reports/.inference-budget.lock'), `${process.ppid}\n`);
    await expect(withProjectBudgetLock(r, async () => 'ran', 200)).rejects.toThrow(/held by another runner/);
  });

  it('lets exactly one contender recover a stale lock, and never deletes a replacement lock', async () => {
    const r = root(); mkdirSync(path.join(r, 'eval/reports'), { recursive: true });
    const lock = path.join(r, 'eval/reports/.inference-budget.lock');
    writeFileSync(lock, '2147483646\n');
    let inside = 0, overlap = false;
    await Promise.all(Array.from({ length: 8 }, () => withProjectBudgetLock(r, async () => {
      inside += 1; if (inside > 1) overlap = true;
      await new Promise(resolve => setTimeout(resolve, 20));
      inside -= 1;
    })));
    expect(overlap).toBe(false);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(`${lock}.recover`)).toBe(false);
  });
});
