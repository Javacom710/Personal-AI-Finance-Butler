import 'server-only';

/**
 * Encryption at rest for the one secret that cannot be a one-way hash
 * (SECURITY.md §1, §3).
 *
 * A TOTP secret has to be recoverable to verify a code, so it is encrypted
 * rather than hashed. AES-256-GCM with a key that lives only in
 * `APP_ENCRYPTION_KEY` — never in the database, and therefore never in a
 * database backup. A leaked dump alone does not yield second factors.
 *
 * Standard primitives only: `node:crypto`, a random 96-bit IV per encryption,
 * and GCM's own authentication tag. No custom construction.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

import { env } from '../../lib/env';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const TAG_BYTES = 16;

function key(): Buffer {
  const decoded = Buffer.from(env().APP_ENCRYPTION_KEY, 'base64');
  if (decoded.length !== 32) {
    throw new Error('APP_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  }
  return decoded;
}

/**
 * Encrypt to a single buffer laid out as `iv || tag || ciphertext`.
 *
 * One column, one value: splitting the IV into its own column invites a row
 * being reassembled from mismatched parts after a partial restore.
 */
export function encryptSecret(plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

/**
 * Decrypt a buffer produced by `encryptSecret`.
 *
 * Throws if the tag does not authenticate — which is the correct outcome for a
 * tampered row or a rotated key, and must never be swallowed into "no second
 * factor configured".
 */
export function decryptSecret(payload: Buffer): string {
  if (payload.length <= IV_BYTES + TAG_BYTES) {
    throw new Error('Encrypted payload is too short to be well-formed.');
  }
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Constant-time comparison for values that are compared as bytes, such as token hashes. */
export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
