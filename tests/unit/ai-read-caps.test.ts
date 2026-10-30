import { describe, expect, it } from 'vitest';

import {
  clampRows,
  DEFAULT_ROW_CAP,
  jsonBytes,
  MAX_RESULT_BYTES,
  MAX_ROW_CAP,
  MAX_TOOL_RESULT_BYTES,
  withinByteBudget,
  withinRowCap,
} from '@/server/ai-read/projections';

/**
 * ROADMAP Phase 7: *"Row caps, `truncated` flags, and the byte budget are
 * enforced and tested"* — entry-gate audit finding **B-3c**, which found all
 * three implemented and none tested, and the budget counting UTF-16 code units
 * rather than bytes.
 *
 * The integration half — that each paged tool actually applies these and says
 * so in `meta` — is in `tests/integration/ai-infrastructure.test.ts`.
 */

describe('B-3c — the row cap', () => {
  it('defaults when no limit is asked for', () => {
    expect(clampRows(undefined)).toBe(DEFAULT_ROW_CAP);
  });

  it('defaults on a limit that is not a positive number, rather than returning nothing or everything', () => {
    for (const bad of [0, -1, -500, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(clampRows(bad), String(bad)).toBe(DEFAULT_ROW_CAP);
    }
  });

  it('never exceeds the maximum, however large the request', () => {
    for (const big of [MAX_ROW_CAP + 1, 10_000, Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY]) {
      expect(clampRows(big), String(big)).toBe(big === Number.POSITIVE_INFINITY ? DEFAULT_ROW_CAP : MAX_ROW_CAP);
    }
  });

  it('honours a limit inside the range and drops a fraction', () => {
    expect(clampRows(1)).toBe(1);
    expect(clampRows(MAX_ROW_CAP)).toBe(MAX_ROW_CAP);
    expect(clampRows(17.9)).toBe(17);
  });

  it('caps a list that takes no limit argument, and says so', () => {
    const rows = Array.from({ length: MAX_ROW_CAP + 5 }, (_, i) => i);
    const capped = withinRowCap(rows);
    expect(capped.rows).toHaveLength(MAX_ROW_CAP);
    expect(capped.rows[0]).toBe(0);
    expect(capped.truncated).toBe(true);

    const short = withinRowCap(rows.slice(0, 3));
    expect(short.rows).toEqual([0, 1, 2]);
    expect(short.truncated).toBe(false);
  });
});

describe('B-3c — the byte budget', () => {
  it('measures UTF-8 bytes, not string length', () => {
    expect(jsonBytes('₹')).toBe(5); // two quotes + three bytes
    expect(JSON.stringify('₹').length).toBe(3); // what the old count saw
    expect(jsonBytes({ d: 'नमस्ते' })).toBe(Buffer.byteLength('{"d":"नमस्ते"}', 'utf8'));
  });

  it('passes a small list through whole', () => {
    const rows = [{ a: 1 }, { a: 2 }];
    expect(withinByteBudget(rows)).toEqual({ rows, truncated: false });
  });

  it('keeps an empty list empty and untruncated', () => {
    expect(withinByteBudget([])).toEqual({ rows: [], truncated: false });
  });

  it('clips from the end once the budget is crossed, and flags it', () => {
    const row = { d: 'x'.repeat(1000) };
    const rows = Array.from({ length: 400 }, () => row);
    const result = withinByteBudget(rows);
    expect(result.truncated).toBe(true);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.length).toBeLessThan(rows.length);
    // What is kept, serialised as the array it becomes, fits.
    expect(jsonBytes(result.rows)).toBeLessThanOrEqual(MAX_RESULT_BYTES + 2);
    // And one more row would not have.
    expect(jsonBytes([...result.rows, row])).toBeGreaterThan(MAX_RESULT_BYTES);
  });

  it('counts multi-byte text at its real weight — the case the old count let through', () => {
    // 60 000 UTF-16 units of rupee signs is 180 000 bytes: under the budget by
    // string length, over it on the wire.
    const row = { d: '₹'.repeat(1000) };
    const rows = Array.from({ length: 60 }, () => row);
    expect(rows.reduce((n, r) => n + JSON.stringify(r).length, 0)).toBeLessThan(MAX_RESULT_BYTES);
    const result = withinByteBudget(rows);
    expect(result.truncated).toBe(true);
    expect(jsonBytes(result.rows)).toBeLessThanOrEqual(MAX_RESULT_BYTES + 2);
  });

  it('refuses a single row larger than the whole budget rather than sending it', () => {
    const result = withinByteBudget([{ d: 'x'.repeat(MAX_RESULT_BYTES + 1) }]);
    expect(result).toEqual({ rows: [], truncated: true });
  });

  it('leaves room in the whole-result ceiling for the envelope around a full page', () => {
    expect(MAX_TOOL_RESULT_BYTES).toBeGreaterThan(MAX_RESULT_BYTES);
    expect(MAX_TOOL_RESULT_BYTES - MAX_RESULT_BYTES).toBeGreaterThanOrEqual(4 * 1024);
  });
});
