import { describe, expect, it } from 'vitest';

import { constantTimeEqual, decryptSecret, encryptSecret } from '@/server/auth/crypto';

describe('TOTP secret encryption', () => {
  it('round-trips a secret', () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('produces a different ciphertext each time, so equal secrets are not linkable', () => {
    const a = encryptSecret('same-secret-value');
    const b = encryptSecret('same-secret-value');
    expect(a.equals(b)).toBe(false);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it('lays out the payload as iv || tag || ciphertext', () => {
    const payload = encryptSecret('x');
    // 12-byte IV + 16-byte GCM tag + 1 byte of ciphertext.
    expect(payload.length).toBe(12 + 16 + 1);
  });

  it('refuses a tampered ciphertext rather than returning garbage', () => {
    const tampered = Buffer.from(encryptSecret('JBSWY3DPEHPK3PXP'));
    const last = tampered.length - 1;
    tampered.writeUInt8(tampered.readUInt8(last) ^ 0xff, last);
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('refuses a tampered authentication tag', () => {
    const tampered = Buffer.from(encryptSecret('JBSWY3DPEHPK3PXP'));
    // Byte 13 is inside the 16-byte tag, which starts at offset 12.
    tampered.writeUInt8(tampered.readUInt8(13) ^ 0xff, 13);
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('refuses a truncated payload instead of reading past the end', () => {
    expect(() => decryptSecret(Buffer.alloc(8))).toThrow();
    expect(() => decryptSecret(Buffer.alloc(28))).toThrow();
  });

  it('handles a multi-byte secret', () => {
    const secret = 'sécret-with-ünicode-字';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });
});

describe('constantTimeEqual', () => {
  it('compares equal buffers as equal', () => {
    expect(constantTimeEqual(Buffer.from('abc'), Buffer.from('abc'))).toBe(true);
  });

  it('returns false rather than throwing on a length mismatch', () => {
    expect(constantTimeEqual(Buffer.from('abc'), Buffer.from('abcd'))).toBe(false);
  });

  it('detects a single-bit difference', () => {
    const a = Buffer.from([0x00, 0x01]);
    const b = Buffer.from([0x00, 0x00]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });
});
