import { describe, expect, it } from 'vitest';

import {
  BASE_LOCK_MS,
  FAILURES_PER_LOCK,
  MAX_LOCK_MS,
  evaluateLock,
  lockDurationMs,
} from '@/server/auth/lockout';

describe('lock duration', () => {
  it('does not lock before the threshold', () => {
    for (let n = 0; n < FAILURES_PER_LOCK; n += 1) {
      expect(lockDurationMs(n)).toBe(0);
    }
  });

  it('doubles at each further group of five, as SECURITY.md §1 specifies', () => {
    expect(lockDurationMs(5)).toBe(BASE_LOCK_MS); // 15 min
    expect(lockDurationMs(10)).toBe(BASE_LOCK_MS * 2); // 30 min
    expect(lockDurationMs(15)).toBe(BASE_LOCK_MS * 4); // 60 min
    expect(lockDurationMs(20)).toBe(BASE_LOCK_MS * 8); // 120 min
    expect(lockDurationMs(25)).toBe(BASE_LOCK_MS * 16); // 240 min = the cap
  });

  it('caps at four hours however many failures accumulate', () => {
    expect(lockDurationMs(25)).toBe(MAX_LOCK_MS);
    expect(lockDurationMs(500)).toBe(MAX_LOCK_MS);
    expect(lockDurationMs(100_000)).toBe(MAX_LOCK_MS);
  });

  it('holds the previous duration between thresholds', () => {
    expect(lockDurationMs(6)).toBe(BASE_LOCK_MS);
    expect(lockDurationMs(9)).toBe(BASE_LOCK_MS);
    expect(lockDurationMs(11)).toBe(BASE_LOCK_MS * 2);
  });
});

describe('evaluateLock', () => {
  const now = new Date('2026-08-09T12:00:00.000Z');

  it('reports no lock when there is none', () => {
    expect(evaluateLock(null, now)).toEqual({ locked: false, until: null, retryAfterSeconds: 0 });
  });

  it('reports a lock that is still in force, with the wait remaining', () => {
    const until = new Date(now.getTime() + 90_000);
    const state = evaluateLock(until, now);
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBe(90);
  });

  it('releases a lock the moment it expires', () => {
    expect(evaluateLock(new Date(now.getTime()), now).locked).toBe(false);
    expect(evaluateLock(new Date(now.getTime() - 1), now).locked).toBe(false);
  });

  it('rounds the remaining wait up, never down to zero', () => {
    const state = evaluateLock(new Date(now.getTime() + 1), now);
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBe(1);
  });
});
