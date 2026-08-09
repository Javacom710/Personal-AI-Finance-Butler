import { describe, expect, it } from 'vitest';

import { newCorrelationId, redact } from '@/server/log';

/**
 * SECURITY.md §7 lists what must never be logged. `redact` is what makes
 * obeying that the default rather than something every call site remembers, so
 * these tests are the enforcement.
 */
describe('redact', () => {
  it('removes credentials by field name', () => {
    const out = redact({
      password: 'hunter2',
      apiKey: 'nvapi-secret',
      api_key: 'nvapi-secret',
      sessionToken: 'abc',
      authorization: 'Bearer x',
      cookie: 'fos_session=x',
      totpSecret: 'JBSWY3DP',
      recoveryCodes: ['A', 'B'],
      passwordHash: '$argon2id$...',
    }) as Record<string, unknown>;

    for (const key of Object.keys(out)) {
      expect(out[key], key).toBe('[redacted]');
    }
  });

  it('removes financial figures by field name', () => {
    const out = redact({
      balance: '150000.0000',
      amount: '-1250.0000',
      baseAmount: '1',
      opening_balance: '0',
      net_worth: '9999999',
      quantity: '100',
      price: '1234.5',
      costBasis: '1',
      realizedPnl: '1',
      holdings: [],
    }) as Record<string, unknown>;

    for (const key of Object.keys(out)) {
      expect(out[key], key).toBe('[redacted]');
    }
  });

  it('redacts every bigint, because a bigint here is money or a quantity', () => {
    expect(redact({ someTotal: 12345n })).toEqual({ someTotal: '[redacted]' });
  });

  it('redacts buffers, which is where session hashes and ciphertext live', () => {
    expect(redact({ tokenHash: Buffer.from('x') })).toEqual({ tokenHash: '[redacted]' });
    expect(redact({ blob: Buffer.from('x') })).toEqual({ blob: '[redacted]' });
  });

  it('keeps the operational fields that make a log useful', () => {
    const out = redact({
      userId: 'abc-123',
      route: '/money/transactions',
      status: 200,
      durationMs: 42,
      model: 'qwen3-next-80b',
      ok: true,
    });

    expect(out).toEqual({
      userId: 'abc-123',
      route: '/money/transactions',
      status: 200,
      durationMs: 42,
      model: 'qwen3-next-80b',
      ok: true,
    });
  });

  it('reaches into nested objects and arrays', () => {
    const out = redact({
      request: { headers: { cookie: 'x' }, path: '/x' },
      rows: [{ amount: '1', description: 'Dinner' }],
    }) as { request: { headers: { cookie: string }; path: string }; rows: { amount: string; description: string }[] };

    expect(out.request.headers.cookie).toBe('[redacted]');
    expect(out.request.path).toBe('/x');
    expect(out.rows[0]!.amount).toBe('[redacted]');
    expect(out.rows[0]!.description).toBe('Dinner');
  });

  it('matches field names case-insensitively and as substrings', () => {
    const out = redact({ ACCOUNT_BALANCE: '1', totalAmountPaid: '2', X_Api_Key: '3' }) as Record<
      string,
      unknown
    >;
    expect(Object.values(out)).toEqual(['[redacted]', '[redacted]', '[redacted]']);
  });

  it('truncates a long string instead of writing an unbounded line', () => {
    const long = 'x'.repeat(2000);
    const out = redact({ note: long }) as { note: string };
    expect(out.note.length).toBeLessThan(600);
    expect(out.note.endsWith('[truncated]')).toBe(true);
  });

  it('caps array length so one field cannot flood the log', () => {
    const out = redact({ items: Array.from({ length: 500 }, (_, i) => i) }) as { items: number[] };
    expect(out.items).toHaveLength(50);
  });

  it('summarises an Error without its stack', () => {
    const out = redact({ error: new TypeError('bad thing') }) as {
      error: { name: string; message: string; stack?: string };
    };
    expect(out.error).toEqual({ name: 'TypeError', message: 'bad thing' });
    expect(out.error.stack).toBeUndefined();
  });

  it('terminates on a cyclic structure rather than recursing forever', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic['self'] = cyclic;
    expect(() => redact(cyclic)).not.toThrow();
  });

  it('passes null and undefined through unchanged', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });
});

describe('newCorrelationId', () => {
  it('is short, opaque, and unique enough to identify one request', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newCorrelationId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{12}$/);
  });
});
