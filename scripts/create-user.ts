/**
 * Provision the single user (SECURITY.md §1).
 *
 *   npm run auth:create-user -- --email you@example.com
 *
 * The password is read from the `FOS_PASSWORD` environment variable rather than
 * an argument, because arguments appear in the process list and in shell
 * history. The TOTP secret and the ten recovery codes are printed **once** and
 * never stored in a form that can be read back.
 *
 * There is no web signup route, by design — see src/server/auth/account.ts.
 */

import { loadDotEnv } from '../src/lib/env';
import { createAccount } from '../src/server/auth/account';
import { hashPassword } from '../src/server/auth/password';
import { closeDb } from '../src/server/db/client';

function arg(name: string): string | undefined {
  const prefixed = `--${name}=`;
  const inline = process.argv.find((a) => a.startsWith(prefixed));
  if (inline) return inline.slice(prefixed.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * SECURITY.md §1 requires the Argon2 parameters to be tuned so a hash takes
 * ≥250 ms *on the production host*. Printing the measured figure here is what
 * makes that checkable rather than assumed.
 */
async function reportHashCost(): Promise<void> {
  const started = performance.now();
  await hashPassword('measurement-only-not-a-real-password');
  const elapsed = Math.round(performance.now() - started);
  const verdict = elapsed >= 250 ? 'meets the ≥250 ms target' : 'BELOW the 250 ms target — increase memoryCost';
  console.log(`Argon2id cost on this host: ${elapsed} ms (${verdict}).`);
}

async function main(): Promise<void> {
  loadDotEnv();

  const email = arg('email');
  const password = process.env['FOS_PASSWORD'];
  const baseCurrency = arg('currency') ?? 'INR';
  const allowAdditional = process.argv.includes('--allow-additional');

  if (!email) {
    throw new Error('Usage: npm run auth:create-user -- --email you@example.com   (password in FOS_PASSWORD)');
  }
  if (!password) {
    throw new Error(
      'Set the password in the FOS_PASSWORD environment variable.\n' +
        '  PowerShell:  $env:FOS_PASSWORD = "…"\n' +
        '  bash:        export FOS_PASSWORD="…"',
    );
  }

  await reportHashCost();

  const result = await createAccount(email, password, { baseCurrency, allowAdditional });

  switch (result.status) {
    case 'weak_password':
      throw new Error(`Password rejected: ${result.failure.message}`);
    case 'email_taken':
      throw new Error('That email already has an account.');
    case 'already_provisioned':
      throw new Error(
        'An account already exists. This application is single-user; pass --allow-additional only if you are sure.',
      );
    case 'created':
      break;
  }

  const { account } = result;

  console.log('');
  console.log('Account created.');
  console.log(`  email    ${account.email}`);
  console.log(`  user id  ${account.userId}`);
  console.log(`  currency ${baseCurrency}`);
  console.log('');
  console.log('Second factor — add this to your authenticator app now. It is shown only once.');
  console.log(`  secret   ${account.totpSecretBase32}`);
  console.log(`  uri      ${account.totpUri}`);
  console.log('');
  console.log('Recovery codes — store these somewhere safe. Each works once, shown only once.');
  for (const code of account.recoveryCodes) console.log(`  ${code}`);
  console.log('');
  console.log('Log in at /login. There is no signup page and no way to skip the second factor.');
}

// Closing the pool rather than calling process.exit(): an abrupt exit discards
// whatever is still buffered on stdout, and this script's output includes a
// secret shown exactly once.
main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
