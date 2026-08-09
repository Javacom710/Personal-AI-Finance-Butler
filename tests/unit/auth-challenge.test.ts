import { describe, expect, it } from 'vitest';

import { CHALLENGE_TTL_MS, decodeChallenge, encodeChallenge } from '@/server/auth/challenge-token';

const USER = '95189b5c-a117-4e29-9c4e-08cf69225395';
const NOW = new Date('2026-08-09T12:00:00.000Z');

describe('TOTP challenge token', () => {
  it('round-trips the user it was issued for', () => {
    const decoded = decodeChallenge(encodeChallenge(USER, NOW), NOW);
    expect(decoded?.userId).toBe(USER);
  });

  it('expires after the TTL', () => {
    const token = encodeChallenge(USER, NOW);
    const justBefore = new Date(NOW.getTime() + CHALLENGE_TTL_MS - 1000);
    const justAfter = new Date(NOW.getTime() + CHALLENGE_TTL_MS + 1000);

    expect(decodeChallenge(token, justBefore)).not.toBeNull();
    expect(decodeChallenge(token, justAfter)).toBeNull();
  });

  /**
   * The property that matters: without this, anyone could mint a token naming
   * any user and walk straight past the password step.
   */
  it('rejects a forged payload with no valid signature', () => {
    const forged = Buffer.from(
      JSON.stringify({ userId: 'attacker', expiresAt: Date.now() + 60_000 }),
      'utf8',
    ).toString('base64url');

    expect(decodeChallenge(`${forged}.notasignature`, NOW)).toBeNull();
    expect(decodeChallenge(forged, NOW)).toBeNull();
  });

  it('rejects a token whose payload was swapped for another user', () => {
    const legitimate = encodeChallenge(USER, NOW);
    const signature = legitimate.slice(legitimate.lastIndexOf('.') + 1);

    const swapped = Buffer.from(
      JSON.stringify({ userId: 'someone-else', expiresAt: NOW.getTime() + 60_000 }),
      'utf8',
    ).toString('base64url');

    expect(decodeChallenge(`${swapped}.${signature}`, NOW)).toBeNull();
  });

  it('rejects a token whose expiry was extended', () => {
    const legitimate = encodeChallenge(USER, NOW);
    const signature = legitimate.slice(legitimate.lastIndexOf('.') + 1);

    const extended = Buffer.from(
      JSON.stringify({ userId: USER, expiresAt: NOW.getTime() + 10 * 365 * 24 * 3600 * 1000 }),
      'utf8',
    ).toString('base64url');

    expect(decodeChallenge(`${extended}.${signature}`, NOW)).toBeNull();
  });

  it('rejects a single flipped character in the signature', () => {
    const token = encodeChallenge(USER, NOW);
    const flipped = `${token.slice(0, -1)}${token.at(-1) === 'A' ? 'B' : 'A'}`;
    expect(decodeChallenge(flipped, NOW)).toBeNull();
  });

  it('rejects malformed and absent input without throwing', () => {
    for (const bad of [undefined, '', '.', 'nodot', 'a.b.c', '....', '!!!.???']) {
      expect(decodeChallenge(bad, NOW)).toBeNull();
    }
  });

  it('rejects a validly signed payload that is not the expected shape', () => {
    // Signed with the real key, but the payload is a bare array.
    const token = encodeChallenge(USER, NOW);
    const signature = token.slice(token.lastIndexOf('.') + 1);
    const wrongShape = Buffer.from(JSON.stringify([1, 2, 3]), 'utf8').toString('base64url');
    expect(decodeChallenge(`${wrongShape}.${signature}`, NOW)).toBeNull();
  });
});
