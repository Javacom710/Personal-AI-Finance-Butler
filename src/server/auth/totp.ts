import 'server-only';

/**
 * Second factor (SECURITY.md §1).
 *
 * TOTP per RFC 6238 — SHA-1, 6 digits, 30-second step, ±1 step of drift — via
 * `otpauth`, which implements RFC 4226/6238 and has no dependencies of its own.
 * Justification for the dependency (ARCHITECTURE.md §3): TOTP is
 * counter-derivation plus dynamic truncation, both easy to get subtly wrong,
 * and "no hand-rolled cryptography" applies here as much as to hashing.
 *
 * TOTP is **mandatory**. There is no path through this module that produces a
 * session without a second factor.
 */

import { randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';

import { hashPassword, verifyPassword } from './password';

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** ±1 step, so a code stays valid across the boundary for a user typing slowly. */
export const TOTP_WINDOW = 1;

const ISSUER = 'Finance OS';

export interface TotpEnrolment {
  /** Base32, shown once so the user can enter it by hand if they cannot scan. */
  readonly secretBase32: string;
  /** The `otpauth://` provisioning URI an authenticator app consumes. */
  readonly uri: string;
}

function totpFor(secretBase32: string, label: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  });
}

/** A fresh 160-bit secret — the size RFC 4226 recommends for SHA-1. */
export function generateTotpSecret(label: string): TotpEnrolment {
  // Copied through `Uint8Array.from` rather than passing `randomBytes(20).buffer`
  // directly: Node allocates small Buffers from a shared pool, so that property
  // is an 8 KiB arena containing unrelated bytes, not the 20 bytes generated.
  const secret = new Secret({ buffer: Uint8Array.from(randomBytes(20)).buffer });
  return {
    secretBase32: secret.base32,
    uri: totpFor(secret.base32, label).toString(),
  };
}

/** The time-step a given instant falls in. Recorded on success as the replay guard's key. */
export function currentStep(now: Date = new Date()): bigint {
  return BigInt(Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS));
}

export type TotpResult =
  | { readonly ok: true; readonly step: bigint }
  | { readonly ok: false; readonly reason: 'invalid' | 'replayed' };

/**
 * Verify a code and, on success, return the step it belongs to.
 *
 * `lastUsedStep` is the step consumed by the previous successful verification.
 * Because a code from the previous step is still accepted under the drift
 * window, rejecting only "the current step again" would leave a real replay
 * window open; comparing against the step the code actually belongs to closes
 * it. The caller persists the returned step (`users.last_totp_step`).
 */
export function verifyTotp(
  secretBase32: string,
  label: string,
  code: string,
  lastUsedStep: bigint | null,
  now: Date = new Date(),
): TotpResult {
  const trimmed = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(trimmed)) return { ok: false, reason: 'invalid' };

  // `delta` is how many steps away from now the matching code was: 0 for the
  // current step, -1 for the previous one, +1 for the next.
  const delta = totpFor(secretBase32, label).validate({
    token: trimmed,
    window: TOTP_WINDOW,
    timestamp: now.getTime(),
  });

  if (delta === null) return { ok: false, reason: 'invalid' };

  const step = currentStep(now) + BigInt(delta);
  if (lastUsedStep !== null && step <= lastUsedStep) {
    return { ok: false, reason: 'replayed' };
  }
  return { ok: true, step };
}

// ------------------------------------------------------------ recovery codes

export const RECOVERY_CODE_COUNT = 10;

/** Crockford-style alphabet: no 0/O or 1/I/L, so a transcribed code is unambiguous. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

function randomCode(): string {
  // 10 characters from a 30-symbol alphabet ≈ 49 bits, formatted in two groups.
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export interface RecoveryCodes {
  /** Shown once, never stored in this form. */
  readonly plaintext: string[];
  /** Argon2id hashes, stored in `users.totp_recovery_hashes`. */
  readonly hashes: string[];
}

export async function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): Promise<RecoveryCodes> {
  const plaintext = Array.from({ length: count }, randomCode);
  const hashes = await Promise.all(plaintext.map((c) => hashPassword(normaliseRecoveryCode(c))));
  return { plaintext, hashes };
}

export function normaliseRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface RecoveryConsumption {
  readonly matched: boolean;
  /** The remaining hashes, with the consumed one removed. Single-use is enforced by removal. */
  readonly remainingHashes: string[];
}

/**
 * Check a recovery code against the stored hashes and consume it on a match.
 *
 * Every hash is checked even after a match so that verification time does not
 * depend on which code was supplied.
 */
export async function consumeRecoveryCode(
  storedHashes: readonly string[],
  code: string,
): Promise<RecoveryConsumption> {
  const candidate = normaliseRecoveryCode(code);
  if (candidate.length === 0) {
    return { matched: false, remainingHashes: [...storedHashes] };
  }

  let matchedIndex = -1;
  for (let i = 0; i < storedHashes.length; i += 1) {
    const isMatch = await verifyPassword(storedHashes[i]!, candidate);
    if (isMatch && matchedIndex === -1) matchedIndex = i;
  }

  if (matchedIndex === -1) {
    return { matched: false, remainingHashes: [...storedHashes] };
  }
  return {
    matched: true,
    remainingHashes: storedHashes.filter((_, i) => i !== matchedIndex),
  };
}
