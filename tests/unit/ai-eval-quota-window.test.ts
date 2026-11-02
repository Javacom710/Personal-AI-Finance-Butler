import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { nativeUsage, prepareLedger, recentUsage, type QuotaLedger } from '../../scripts/lib/ai-eval-quota-window';
const ledger = (day: string, tokens: number, at: string): QuotaLedger => ({ day, requests: 1, reservedTokens: tokens, events: [{ at, reservedTokens: tokens }] });
const empty = (day: string): QuotaLedger => ({ day, requests: 0, reservedTokens: 0, events: [], nativeBaseline: { at: `${day}T00:00:00Z`, requests: 0, tokens: 0 } });

describe('rolling quota preflight', () => {
  it('carries late requests across midnight and releases them only after 24 hours', () => {
    const yesterday = ledger('2026-11-02', 180_000, '2026-11-02T23:50:00Z');
    expect(prepareLedger(empty('2026-11-03'), [yesterday], new Date('2026-11-03T00:10:00Z')).reservedTokens).toBe(180_000);
    expect(recentUsage([yesterday], new Date('2026-11-03T23:50:00Z')).tokens).toBe(0);
  });
  it('never reimports carry as new usage, or erases current-day calls when refreshing', () => {
    const first = ledger('2026-11-01', 100_000, '2026-11-01T23:50:00Z');
    const second = { ...prepareLedger(empty('2026-11-02'), [first], new Date('2026-11-02T00:10:00Z')), requests: 2, reservedTokens: 120_000, events: [{ at: '2026-11-02T23:00:00Z', reservedTokens: 20_000 }] };
    const third = prepareLedger(empty('2026-11-03'), [first, second], new Date('2026-11-03T00:10:00Z'));
    expect(third.reservedTokens).toBe(20_000);
    const current = { ...third, requests: 2, reservedTokens: 25_000, events: [{ at: '2026-11-03T00:11:00Z', reservedTokens: 5000 }] };
    const refreshed = prepareLedger(current, [first, second], new Date('2026-11-03T23:01:00Z'));
    expect(refreshed.reservedTokens).toBe(5000);
    expect(refreshed.requests).toBe(1);
  });
  it('retains unknown legacy and crash reservations conservatively', () => {
    const legacy: QuotaLedger = { day: '2026-11-02', requests: 3, reservedTokens: 40_000, events: [{ at: '2026-11-02T12:00:00Z', reservedTokens: 10_000 }] };
    expect(recentUsage([legacy], new Date('2026-11-03T13:00:00Z'))).toEqual({ requests: 2, tokens: 30_000 });
    expect(recentUsage([legacy], new Date('2026-11-04T00:00:00Z'))).toEqual({ requests: 0, tokens: 0 });
  });
  it('seals an existing unknown baseline once instead of extending it on every check', () => {
    const current: QuotaLedger = { day: '2026-11-02', requests: 65, reservedTokens: 148382, events: [] };
    const sealed = prepareLedger(current, [], new Date('2026-11-02T15:40:00Z'));
    expect(sealed.nativeBaseline).toEqual({ at: '2026-11-02T15:40:00.000Z', requests: 65, tokens: 148382 });
    const again = prepareLedger(sealed, [], new Date('2026-11-02T17:00:00Z'));
    expect(again.nativeBaseline).toEqual(sealed.nativeBaseline);
    expect(recentUsage([again], new Date('2026-11-03T15:40:00Z')).tokens).toBe(0);
  });
  it('rejects negative, duplicated or inconsistent ledgers', () => {
    const good = ledger('2026-11-02', 100, '2026-11-02T12:00:00Z');
    expect(() => nativeUsage({ ...good, reservedTokens: -1 })).toThrow();
    expect(() => nativeUsage({ ...good, requests: 0 })).toThrow();
    expect(() => recentUsage([good, good], new Date('2026-11-03'))).toThrow(/Duplicate/);
    expect(() => prepareLedger(empty('2026-11-03'), [good], new Date('2026-11-02'))).toThrow();
  });
});


describe('quota preflight CLI', () => {
  it('imports preceding-day usage offline and is idempotent on a second check', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'groq-quota-test-'));
    try {
      const dir = path.join(root, 'eval/reports');
      mkdirSync(dir, { recursive: true });
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const boundary = Date.parse(`${today}T00:00:00Z`);
      const previousAt = new Date(boundary - 1).toISOString();
      const previousDay = previousAt.slice(0, 10);
      writeFileSync(path.join(dir, `groq-budget-${previousDay}.json`), JSON.stringify(ledger(previousDay, 49_000, previousAt)));
      const currentFile = path.join(dir, `groq-budget-${today}.json`);
      writeFileSync(currentFile, JSON.stringify(ledger(today, 10_000, now.toISOString())));
      const denyFetch = path.join(root, 'deny-fetch.mjs');
      writeFileSync(denyFetch, 'globalThis.fetch = () => { throw new Error("Unexpected network call"); };');
      const script = fileURLToPath(new URL('../../scripts/ai-eval-budgeted-run.ts', import.meta.url));
      const loader = fileURLToPath(import.meta.resolve('tsx'));
      const run = () => spawnSync(process.execPath, ['--import', denyFetch, '--import', loader, script, '--check-only'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
      const first = run();
      expect(first.status, first.stderr).toBe(0);
      const saved = readFileSync(currentFile, 'utf8');
      expect(JSON.parse(saved)).toMatchObject({ requests: 2, reservedTokens: 59_000, carry: { requests: 1, tokens: 49_000 } });
      const second = run();
      expect(second.status, second.stderr).toBe(0);
      expect(readFileSync(currentFile, 'utf8')).toBe(saved);
      expect(() => readFileSync(path.join(dir, '.groq-measurement.lock'))).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
