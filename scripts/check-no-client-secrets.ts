/**
 * Assert that no secret reached a client bundle (SECURITY.md Â§3).
 *
 * Two checks, both over the built output rather than the source, because the
 * source is not what ships:
 *
 * 1. No literal value of a secret environment variable appears in any file
 *    served to the browser. This is the check that actually matters â€” it would
 *    catch a leak arriving through a path nobody predicted.
 * 2. No `NEXT_PUBLIC_` variable is named like a credential.
 *
 * Run after `npm run build`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadDotEnv } from '../src/lib/env';

/** Values that must never appear in anything the browser downloads. */
const SECRET_VARS = [
  'DATABASE_URL',
  'DATABASE_MIGRATION_URL',
  'TEST_DATABASE_URL',
  'APP_ENCRYPTION_KEY',
  'SESSION_COOKIE_SECRET',
  'NVIDIA_API_KEY',
  // Phase 6. Optional, so the scan simply has nothing to look for when it is
  // unset — which is why the count in the summary line is the honest number.
  'TWELVE_DATA_API_KEY',
  'FOS_PASSWORD',
] as const;

const CLIENT_DIRS = ['.next/static'] as const;
const SUSPICIOUS_PUBLIC = /NEXT_PUBLIC_[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|DSN)/;

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function main(): Promise<void> {
  loadDotEnv();

  const needles: { name: string; value: string }[] = [];
  for (const name of SECRET_VARS) {
    const value = process.env[name];
    // A short value would produce false positives against minified output.
    if (typeof value === 'string' && value.length >= 8) needles.push({ name, value });
  }

  const findings: string[] = [];
  let scanned = 0;

  for (const dir of CLIENT_DIRS) {
    for await (const file of walk(dir)) {
      if (!/\.(js|mjs|cjs|css|map|json|txt|html)$/.test(file)) continue;
      scanned += 1;
      const content = await fs.readFile(file, 'utf8');

      for (const secret of needles) {
        if (content.includes(secret.value)) {
          findings.push(`${secret.name} value found in ${file}`);
        }
      }
      const suspicious = SUSPICIOUS_PUBLIC.exec(content);
      if (suspicious) {
        findings.push(`credential-shaped public variable ${suspicious[0]} found in ${file}`);
      }
    }
  }

  if (scanned === 0) {
    throw new Error('No client bundle found. Run `npm run build` before this check.');
  }

  if (findings.length > 0) {
    console.error('SECRET LEAK â€” the following must never reach the browser:');
    for (const f of findings) console.error(`  ${f}`);
    process.exit(1);
  }

  console.log(
    `No secret found in ${scanned} client files (checked ${needles.length} secret values across ${CLIENT_DIRS.join(', ')}).`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
