import { TOTP, Secret } from 'otpauth';
import { describe, expect, it } from 'vitest';

import {
  RECOVERY_CODE_COUNT,
  TOTP_PERIOD_SECONDS,
  consumeRecoveryCode,
  currentStep,
  generateRecoveryCodes,
  generateTotpSecret,
  normaliseRecoveryCode,
  verifyTotp,
} from '@/server/auth/totp';

const LABEL = 'user@example.com';

function codeAt(secretBase32: string, at: Date): string {
  return new TOTP({
    issuer: 'Finance OS',
    label: LABEL,
    algorithm: 'SHA1',
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  }).generate({ timestamp: at.getTime() });
}

describe('TOTP enrolment', () => {
  it('produces a 160-bit base32 secret and a provisioning URI', () => {
    const enrolment = generateTotpSecret(LABEL);
    // 20 bytes → 32 base32 characters.
    expect(enrolment.secretBase32).toMatch(/^[A-Z2-7]{32}$/);
    expect(enrolment.uri).toContain('otpauth://totp/');
    expect(enrolment.uri).toContain('digits=6');
    expect(enrolment.uri).toContain('period=30');
    expect(enrolment.uri).toContain('algorithm=SHA1');
  });

  it('produces a different secret every time', () => {
    const a = generateTotpSecret(LABEL).secretBase32;
    const b = generateTotpSecret(LABEL).secretBase32;
    expect(a).not.toBe(b);
  });
});

describe('TOTP verification', () => {
  const now = new Date('2026-08-09T12:00:00.000Z');

  it('accepts the current code and reports the step it belongs to', () => {
    const { secretBase32 } = generateTotpSecret(LABEL);
    const result = verifyTotp(secretBase32, LABEL, codeAt(secretBase32, now), null, now);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.step).toBe(currentStep(now));
  });

  it('accepts one step of drift in each direction', () => {
    const { secretBase32 } = generateTotpSecret(LABEL);
    const previous = new Date(now.getTime() - TOTP_PERIOD_SECONDS * 1000);
    const next = new Date(now.getTime() + TOTP_PERIOD_SECONDS * 1000);

    expect(verifyTotp(secretBase32, LABEL, codeAt(secretBase32, previous), null, now).ok).toBe(true);
    expect(verifyTotp(secretBase32, LABEL, codeAt(secretBase32, next), null, now).ok).toBe(true);
  });

  it('rejects two steps of drift', () => {
    const { secretBase32 } = generateTotpSecret(LABEL);
    const farPast = new Date(now.getTime() - 2 * TOTP_PERIOD_SECONDS * 1000);
    const result = verifyTotp(secretBase32, LABEL, codeAt(secretBase32, farPast), null, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });

  it('rejects a malformed code without consulting the secret', () => {
    const { secretBase32 } = generateTotpSecret(LABEL);
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56 78']) {
      const result = verifyTotp(secretBase32, LABEL, bad, null, now);
      expect(result.ok, bad).toBe(false);
    }
  });

  it('accepts a code typed with spaces', () => {
    const { secretBase32 } = generateTotpSecret(LABEL);
    const code = codeAt(secretBase32, now);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp(secretBase32, LABEL, spaced, null, now).ok).toBe(true);
  });

  it('rejects a code belonging to a step already consumed', () => {
    const { secretBase32 } = generateTotpSecret(LABEL);
    const first = verifyTotp(secretBase32, LABEL, codeAt(secretBase32, now), null, now);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const replay = verifyTotp(secretBase32, LABEL, codeAt(secretBase32, now), first.step, now);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toBe('replayed');
  });

  /**
   * The case a "reject the current step" guard would miss: a code from the
   * previous step is still inside the drift window, so replaying it one step
   * later would otherwise succeed.
   */
  it('rejects a previous-step code replayed after the clock advances', () => {
    const { secretBase32 } = generateTotpSecret(LABEL);
    const earlier = new Date(now.getTime() - TOTP_PERIOD_SECONDS * 1000);
    const code = codeAt(secretBase32, earlier);

    const first = verifyTotp(secretBase32, LABEL, code, null, earlier);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // One step later the same code is still within the drift window.
    const replay = verifyTotp(secretBase32, LABEL, code, first.step, now);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toBe('replayed');
  });

  it('still accepts the next code after one was consumed', () => {
    const { secretBase32 } = generateTotpSecret(LABEL);
    const consumed = currentStep(now);
    const later = new Date(now.getTime() + TOTP_PERIOD_SECONDS * 1000);
    const result = verifyTotp(secretBase32, LABEL, codeAt(secretBase32, later), consumed, later);
    expect(result.ok).toBe(true);
  });

  it('rejects a code generated from a different secret', () => {
    const a = generateTotpSecret(LABEL).secretBase32;
    const b = generateTotpSecret(LABEL).secretBase32;
    expect(verifyTotp(a, LABEL, codeAt(b, now), null, now).ok).toBe(false);
  });
});

describe('recovery codes', () => {
  it('generates ten codes and stores only hashes', async () => {
    const codes = await generateRecoveryCodes();
    expect(codes.plaintext).toHaveLength(RECOVERY_CODE_COUNT);
    expect(codes.hashes).toHaveLength(RECOVERY_CODE_COUNT);
    for (const hash of codes.hashes) expect(hash.startsWith('$argon2id$')).toBe(true);
    for (const code of codes.plaintext) expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  });

  it('uses an alphabet without ambiguous characters', () => {
    // No 0/O, 1/I/L — a code is transcribed by hand from paper.
    const alphabet = /^[ABCDEFGHJKMNPQRSTVWXYZ23456789-]+$/;
    return generateRecoveryCodes(4).then((codes) => {
      for (const code of codes.plaintext) expect(code).toMatch(alphabet);
    });
  });

  it('consumes a matching code and removes exactly that one', async () => {
    const codes = await generateRecoveryCodes(3);
    const result = await consumeRecoveryCode(codes.hashes, codes.plaintext[1]!);
    expect(result.matched).toBe(true);
    expect(result.remainingHashes).toHaveLength(2);
    expect(result.remainingHashes).toEqual([codes.hashes[0], codes.hashes[2]]);
  });

  it('accepts a code typed without the separator or in lower case', async () => {
    const codes = await generateRecoveryCodes(2);
    const raw = codes.plaintext[0]!;
    for (const variant of [raw.replace('-', ''), raw.toLowerCase(), ` ${raw} `]) {
      const result = await consumeRecoveryCode(codes.hashes, variant);
      expect(result.matched, variant).toBe(true);
    }
  });

  it('rejects a code that was never issued and consumes nothing', async () => {
    const codes = await generateRecoveryCodes(3);
    const result = await consumeRecoveryCode(codes.hashes, 'ZZZZZ-ZZZZZ');
    expect(result.matched).toBe(false);
    expect(result.remainingHashes).toHaveLength(3);
  });

  it('rejects an empty code without checking any hash', async () => {
    const codes = await generateRecoveryCodes(2);
    const result = await consumeRecoveryCode(codes.hashes, '   ');
    expect(result.matched).toBe(false);
    expect(result.remainingHashes).toHaveLength(2);
  });

  it('cannot be used twice — the second attempt sees the shortened list', async () => {
    const codes = await generateRecoveryCodes(2);
    const first = await consumeRecoveryCode(codes.hashes, codes.plaintext[0]!);
    expect(first.matched).toBe(true);

    const second = await consumeRecoveryCode(first.remainingHashes, codes.plaintext[0]!);
    expect(second.matched).toBe(false);
  });

  it('normalises consistently', () => {
    expect(normaliseRecoveryCode(' abcde-fghjk ')).toBe('ABCDEFGHJK');
    expect(normaliseRecoveryCode('ABCDE FGHJK')).toBe('ABCDEFGHJK');
  });
});
