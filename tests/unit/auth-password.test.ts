import { describe, expect, it } from 'vitest';

import {
  ARGON2_OPTIONS,
  MIN_PASSWORD_LENGTH,
  checkPasswordPolicy,
  hashPassword,
  verifyPassword,
} from '@/server/auth/password';

const GOOD = 'a-perfectly-reasonable-passphrase-47';

describe('password hashing', () => {
  /**
   * `ARGON2_OPTIONS` deliberately omits `algorithm` (its enum is not readable
   * under isolatedModules). This asserts the *output* rather than the input,
   * which is the stronger check: the stored hash really is Argon2id at the
   * configured cost.
   */
  it('produces an Argon2id hash at the configured cost', async () => {
    const hash = await hashPassword(GOOD);
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).toContain(`m=${ARGON2_OPTIONS.memoryCost}`);
    expect(hash).toContain(`t=${ARGON2_OPTIONS.timeCost}`);
    expect(hash).toContain(`p=${ARGON2_OPTIONS.parallelism}`);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword(GOOD), hashPassword(GOOD)]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, GOOD)).toBe(true);
    expect(await verifyPassword(b, GOOD)).toBe(true);
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword(GOOD);
    expect(await verifyPassword(hash, GOOD)).toBe(true);
    expect(await verifyPassword(hash, `${GOOD}x`)).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  /**
   * Verification must read the cost from the encoded hash, not from the current
   * configuration — otherwise raising `memoryCost` would lock out every
   * existing password.
   */
  it('verifies a hash produced at different parameters', async () => {
    const { hash } = await import('@node-rs/argon2');
    const legacy = await hash(GOOD, { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });
    expect(await verifyPassword(legacy, GOOD)).toBe(true);
    expect(await verifyPassword(legacy, 'wrong')).toBe(false);
  });

  it('returns false rather than throwing on a corrupt stored hash', async () => {
    for (const corrupt of ['', 'not-a-hash', '$argon2id$garbage']) {
      expect(await verifyPassword(corrupt, GOOD)).toBe(false);
    }
  });

  it('meets the cost floor SECURITY.md §1 sets', () => {
    // 128 MiB. Below ~64 MiB the ≥250 ms target is unreachable on this class of
    // hardware — see the measurement table in password.ts.
    expect(ARGON2_OPTIONS.memoryCost).toBeGreaterThanOrEqual(65536);
    expect(ARGON2_OPTIONS.timeCost).toBeGreaterThanOrEqual(2);
  });
});

describe('password policy', () => {
  it('accepts a long, varied passphrase', () => {
    expect(checkPasswordPolicy(GOOD, 'user@example.com')).toBeNull();
  });

  it('requires at least 12 characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(checkPasswordPolicy('short1234!A')?.code).toBe('too_short');
    expect(checkPasswordPolicy('exactly12chr')).toBeNull();
  });

  it('bounds the length, so argon2 cost is not attacker-controlled', () => {
    expect(checkPasswordPolicy('a1B'.repeat(400))?.code).toBe('too_long');
  });

  it('rejects a password from the breach list', () => {
    expect(checkPasswordPolicy('correcthorsebatterystaple')?.code).toBe('compromised');
    expect(checkPasswordPolicy('PASSWORD123456')?.code).toBe('compromised');
  });

  it('rejects a password containing the email local part', () => {
    expect(checkPasswordPolicy('mitrafinance2026', 'mitra@example.com')?.code).toBe(
      'contains_identifier',
    );
  });

  it('ignores a very short local part, which would reject almost everything', () => {
    expect(checkPasswordPolicy('a-long-and-fine-passphrase', 'ab@example.com')).toBeNull();
  });

  it('rejects a long password with almost no entropy', () => {
    expect(checkPasswordPolicy('aaaaaaaaaaaaaaaa')?.code).toBe('low_variety');
    expect(checkPasswordPolicy('ababababababab')?.code).toBe('low_variety');
  });

  it('rejects a straight character sequence', () => {
    expect(checkPasswordPolicy('abcdefghijklmn')?.code).toBe('low_variety');
    expect(checkPasswordPolicy('nmlkjihgfedcba')?.code).toBe('low_variety');
  });

  it('imposes no composition rules — length is the requirement', () => {
    // No symbol, no digit, no capital, and that is fine.
    expect(checkPasswordPolicy('quiet harbour morning tide')).toBeNull();
  });
});
