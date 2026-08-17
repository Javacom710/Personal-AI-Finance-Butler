/**
 * Development sign-in helper — **never a production bypass**.
 *
 *   npm run dev:login            # provision (once) and show the OTP
 *   npm run dev:login -- --otp   # just show the current OTP
 *
 * ## What this is, and what it deliberately is not
 *
 * The second factor in this application is **TOTP** (RFC 6238), not an SMS or
 * email code — so no message provider is involved and none is needed. A TOTP
 * code is *computed* from a shared secret, exactly as an authenticator app
 * computes it. This script is therefore an authenticator app for one
 * development account, and nothing more.
 *
 * **It adds no code path to the application.** `src/server/auth/**` is
 * untouched: there is no dev flag in the login flow, no skipped factor, no
 * back door. Signing in with these credentials exercises the real
 * password → TOTP → session flow, with the real Argon2id verification, the real
 * replay guard and the real opaque session cookie. That is the point: a
 * development mode that skipped any of it would verify a flow nobody ships.
 *
 * ## Why it cannot run in production
 *
 * `assertNotProduction()` below refuses on `NODE_ENV=production` before it
 * touches the database or the filesystem. It is a `scripts/` entry point, so it
 * is never bundled, never imported by the application, and never reachable over
 * HTTP — the guard is the second line, not the first.
 *
 * ## Where the secrets live
 *
 * `.dev-credentials.json`, which is git-ignored. Nothing is printed to stdout
 * except the six-digit code, which expires in under thirty seconds.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Secret, TOTP } from 'otpauth';

import { loadDotEnv } from '../src/lib/env';
import { createAccount } from '../src/server/auth/account';
import { closeDb } from '../src/server/db/client';
import { TOTP_DIGITS, TOTP_PERIOD_SECONDS } from '../src/server/auth/totp';

/** Non-personal, unmistakably local. `.local` is reserved and cannot be a real domain. */
const DEV_EMAIL = 'dev@example.local';
const CREDENTIALS_FILE = join(process.cwd(), '.dev-credentials.json');

interface DevCredentials {
  readonly email: string;
  readonly password: string;
  readonly totpSecretBase32: string;
  readonly totpUri: string;
  readonly recoveryCodes: readonly string[];
  readonly createdAt: string;
  readonly warning: string;
}

/**
 * The production guard.
 *
 * Checked against `process.env` directly rather than through the validated env
 * module, so it fires even if configuration is incomplete — a script that
 * crashed on a missing variable before reaching this check would be a guard that
 * depends on the thing it is guarding.
 */
function assertNotProduction(): void {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'dev:login refuses to run with NODE_ENV=production.\n' +
        'This provisions a known-credential account and prints one-time codes for it. ' +
        'It exists for local development only, and there is no flag to override this.',
    );
  }
}

/** 32 random bytes, base64url — comfortably past the 12-character policy floor. */
function generatePassword(): string {
  return randomBytes(24).toString('base64url');
}

function currentCode(secretBase32: string): { code: string; secondsRemaining: number } {
  const totp = new TOTP({
    issuer: 'Finance OS',
    label: DEV_EMAIL,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  });
  const elapsed = Math.floor(Date.now() / 1000) % TOTP_PERIOD_SECONDS;
  return { code: totp.generate(), secondsRemaining: TOTP_PERIOD_SECONDS - elapsed };
}

function readCredentials(): DevCredentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')) as DevCredentials;
}

async function provision(): Promise<DevCredentials> {
  const password = generatePassword();
  const result = await createAccount(DEV_EMAIL, password, {
    baseCurrency: 'INR',
    // The application is single-user by design and refuses a second account
    // without this. Here it is deliberate: the development account sits beside
    // the real one rather than replacing it, and the real one is never touched.
    allowAdditional: true,
  });

  switch (result.status) {
    case 'weak_password':
      throw new Error(`Generated password rejected by the policy: ${result.failure.message}`);
    case 'email_taken':
      throw new Error(
        `${DEV_EMAIL} already exists but ${CREDENTIALS_FILE} is missing, so its password is ` +
          'unrecoverable — that is the point of storing only a hash.\n' +
          'Delete the account and re-run:\n' +
          `  psql -c "delete from users where email = '${DEV_EMAIL}'"`,
      );
    case 'already_provisioned':
      throw new Error('createAccount refused despite allowAdditional — this should be unreachable.');
    case 'created':
      break;
  }

  const credentials: DevCredentials = {
    email: result.account.email,
    password,
    totpSecretBase32: result.account.totpSecretBase32,
    totpUri: result.account.totpUri,
    recoveryCodes: result.account.recoveryCodes,
    createdAt: new Date().toISOString(),
    warning:
      'DEVELOPMENT ONLY. Git-ignored. This account exists to exercise the real login flow ' +
      'locally; it has no production counterpart and must never be created on a deployed host.',
  };

  writeFileSync(CREDENTIALS_FILE, `${JSON.stringify(credentials, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });

  return credentials;
}

async function main(): Promise<void> {
  assertNotProduction();
  loadDotEnv();
  // `loadDotEnv` may set NODE_ENV from the file; re-check so a `.env` cannot
  // move the process into production after the first guard has passed.
  assertNotProduction();

  const otpOnly = process.argv.includes('--otp');
  let credentials = readCredentials();

  if (credentials === null) {
    if (otpOnly) {
      throw new Error(`No ${CREDENTIALS_FILE}. Run: npm run dev:login`);
    }
    console.log('Provisioning the development account…');
    credentials = await provision();
    console.log('');
    console.log('Development account created. Credentials written to:');
    console.log(`  ${CREDENTIALS_FILE}`);
    console.log('  (git-ignored, mode 0600 — open it to read the password)');
  }

  const { code, secondsRemaining } = currentCode(credentials.totpSecretBase32);

  console.log('');
  console.log(`  email  ${credentials.email}`);
  console.log(`  code   ${code}      (valid ${secondsRemaining}s)`);
  console.log('');
  console.log(`  password: see "password" in ${CREDENTIALS_FILE}`);
  console.log('  sign in at http://localhost:3000/login');
  console.log('');
  console.log('Re-run `npm run dev:login -- --otp` for a fresh code.');
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
