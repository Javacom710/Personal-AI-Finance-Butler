import { describe, expect, it } from 'vitest';

import { isWithinDailyBudget } from '@/server/ai-runtime';

/** B-3a — the budget decision, without a database. */
describe('B-3a — the daily budget decision', () => {
  const limits = { requests: 200, tokens: 1_000_000 };

  it('has room below both limits', () => {
    expect(isWithinDailyBudget({ requests: 0, tokens: 0 }, limits)).toBe(true);
    expect(isWithinDailyBudget({ requests: 199, tokens: 999_999 }, limits)).toBe(true);
  });

  it('closes at the request limit', () => {
    expect(isWithinDailyBudget({ requests: 200, tokens: 0 }, limits)).toBe(false);
  });

  it('closes at the token limit, whichever comes first', () => {
    expect(isWithinDailyBudget({ requests: 1, tokens: 1_000_000 }, limits)).toBe(false);
  });
});
