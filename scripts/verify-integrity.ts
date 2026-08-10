/**
 * Check the financial invariants against real data (SCHEMA.md §12).
 *
 *   npm run verify:integrity
 *   npm run verify:integrity -- --database-url=postgres://…
 *
 * Exits non-zero on any violation, so it can gate a deploy or a restore.
 */

import { loadDotEnv } from '../src/lib/env';
import { verifyIntegrity } from '../src/server/db/integrity';

async function main(): Promise<void> {
  loadDotEnv();

  const override = process.argv
    .find((a) => a.startsWith('--database-url='))
    ?.slice('--database-url='.length);

  // The read-only application role is enough: this command inspects, never repairs.
  const url = override ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set — see .env.example');

  const report = await verifyIntegrity(url);

  for (const check of report.checks) {
    const mark = check.status === 'passed' ? 'ok  ' : check.status === 'skipped' ? 'skip' : 'FAIL';
    const suffix =
      check.status === 'failed'
        ? ` — ${check.violations} violation${check.violations === 1 ? '' : 's'}`
        : check.note
          ? ` — ${check.note}`
          : '';
    console.log(`${mark}  ${check.invariant.padEnd(5)} ${check.description}${suffix}`);

    for (const sample of check.samples) {
      console.log(`        ${JSON.stringify(sample)}`);
    }
  }

  const skipped = report.checks.filter((c) => c.status === 'skipped').length;
  console.log(
    `\n${report.checks.length - skipped - report.failedCount} passed, ${report.failedCount} failed, ${skipped} not yet applicable.`,
  );

  if (!report.passed) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
