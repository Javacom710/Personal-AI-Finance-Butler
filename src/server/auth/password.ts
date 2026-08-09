import 'server-only';

/**
 * Password hashing (SECURITY.md §1).
 *
 * Argon2id via `@node-rs/argon2`. Nothing here is hand-rolled cryptography —
 * this module chooses parameters and enforces policy; the primitive is the
 * library's.
 */

import { hash, verify } from '@node-rs/argon2';

import { COMMON_PASSWORDS } from './common-passwords';

/**
 * Argon2id parameters, chosen by measurement rather than by copying a default.
 *
 * SECURITY.md §1 requires a hash to take ≥250 ms on the production host.
 * Measured on the development machine (Node 26, Windows x64, 5 runs, median):
 *
 *   |  memory | passes | median |
 *   |---------|--------|--------|
 *   |  64 MiB |      3 | 158 ms |   ← below target
 *   |  64 MiB |      4 | 219 ms |   ← below target
 *   |  96 MiB |      3 | 250 ms |   ← on the line, no margin
 *   | 128 MiB |      3 | 336 ms |   ← chosen
 *   | 128 MiB |      4 | 441 ms |
 *
 * 128 MiB / 3 passes clears the target with margin. Memory was raised rather
 * than passes because memory hardness is what degrades GPU and ASIC attacks;
 * more passes costs the defender the same and the attacker less.
 *
 * `npm run auth:create-user` prints the measured figure on whatever host it
 * runs on, so this table can be re-checked on the production machine rather
 * than assumed to carry over.
 *
 * `algorithm` is deliberately not set. `@node-rs/argon2` declares its
 * `Algorithm` enum as an ambient `const enum`, which cannot be read under
 * `isolatedModules`, and hard-coding its numeric value would silently break if
 * the library reordered it. Argon2id is that library's documented default, and
 * `tests/unit/auth-password.test.ts` asserts the produced hash actually starts
 * with `$argon2id$` and carries `m=131072,t=3,p=4` — a stronger guarantee than
 * a configuration constant, because it checks the output rather than the input.
 */
export const ARGON2_OPTIONS = {
  memoryCost: 131072, // KiB → 128 MiB
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
} as const;

/** Length beats character classes: a 12-character minimum, and no composition rules. */
export const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 1024; // A bounded input; argon2 cost is otherwise attacker-controlled.

export type PasswordPolicyFailure =
  | { readonly code: 'too_short'; readonly message: string }
  | { readonly code: 'too_long'; readonly message: string }
  | { readonly code: 'compromised'; readonly message: string }
  | { readonly code: 'contains_identifier'; readonly message: string }
  | { readonly code: 'low_variety'; readonly message: string };

/**
 * Policy checked at set time only — never at login, where the stored hash is
 * the only thing that matters and re-running policy would leak which rule a
 * guess violated.
 */
export function checkPasswordPolicy(password: string, email?: string): PasswordPolicyFailure | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      code: 'too_short',
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { code: 'too_long', message: `Password must be at most ${MAX_PASSWORD_LENGTH} characters.` };
  }

  const normalised = password.normalize('NFKC').toLowerCase();

  if (COMMON_PASSWORDS.has(normalised)) {
    return {
      code: 'compromised',
      message: 'That password appears in published breach lists. Choose another.',
    };
  }

  if (email) {
    const localPart = email.split('@')[0]?.toLowerCase() ?? '';
    if (localPart.length >= 4 && normalised.includes(localPart)) {
      return {
        code: 'contains_identifier',
        message: 'Password must not contain your email address.',
      };
    }
  }

  // A 12-character password of one repeated character, or a straight run of the
  // alphabet or keyboard, satisfies the length rule while having almost no
  // entropy. Rejecting those is not a composition rule — it removes a
  // degenerate case rather than demanding a symbol.
  if (new Set(normalised).size <= 3) {
    return { code: 'low_variety', message: 'Password repeats too few distinct characters.' };
  }
  if (isSequential(normalised)) {
    return { code: 'low_variety', message: 'Password is a simple sequence.' };
  }

  return null;
}

function isSequential(value: string): boolean {
  if (value.length < 6) return false;
  let ascending = true;
  let descending = true;
  for (let i = 1; i < value.length; i += 1) {
    const delta = value.charCodeAt(i) - value.charCodeAt(i - 1);
    if (delta !== 1) ascending = false;
    if (delta !== -1) descending = false;
    if (!ascending && !descending) return false;
  }
  return ascending || descending;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Verify a password against a stored hash.
 *
 * Deliberately passes **no** cost options. An encoded Argon2 hash carries the
 * parameters it was produced with, so verification must read them from the hash
 * — otherwise raising `memoryCost` would invalidate every password already
 * stored at the old setting.
 *
 * Never throws on a malformed hash either: a corrupt row must read as "wrong
 * password", not as a 500 that tells an attacker the account exists.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

/**
 * A hash computed against a fixed dummy value when the email does not exist.
 *
 * Without this, a login for an unknown address returns in microseconds while a
 * known address takes ~310 ms, and the difference enumerates accounts
 * (SECURITY.md §1). The password is still hashed — timing must match the real
 * path, so the work must actually be done.
 */
const DUMMY_PASSWORD = 'finance-os-dummy-password-for-timing-equalisation';
let dummyHash: string | null = null;

export async function performDummyVerify(password: string): Promise<false> {
  dummyHash ??= await hashPassword(DUMMY_PASSWORD);
  await verifyPassword(dummyHash, password);
  return false;
}
