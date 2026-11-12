/** Offline preview by default is explicit; recording is a separate owner-approved operator action. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prepareTier1Evidence, TIER1_EVIDENCE_DIRECTORY, tier1EvidenceFiles } from './lib/tier1-evidence';

async function main() {
  const args = process.argv.slice(2);
  const preview = args.length === 1 && args[0] === '--preview';
  const record = args.length === 3 && args[0] === '--record' && args[1] === '--expect-sha256' && /^[a-f0-9]{64}$/.test(args[2]!);
  if (!preview && !record) throw new Error('Use --preview, or after owner approval --record --expect-sha256 <reviewed digest>.');
  const files = Object.fromEntries(await Promise.all(tier1EvidenceFiles().map(async name => [name, await readFile(path.join(TIER1_EVIDENCE_DIRECTORY, name), 'utf8')] as const)));
  const prepared = prepareTier1Evidence(files);
  if (preview) {
    process.stdout.write(JSON.stringify(prepared.preview, null, 2) + '\n');
    return;
  }
  // Check the pin before loading deployment configuration or importing the writer.
  if (args[2] !== prepared.preview.digest) throw new Error('The reviewed evidence digest differs.');
  const { loadDotEnv } = await import('../src/lib/env');
  loadDotEnv();
  const { recordTier1Evidence } = await import('./lib/record-tier1-evidence');
  const { closeDb } = await import('../src/server/db/client');
  try { process.stdout.write(JSON.stringify(await recordTier1Evidence(files, args[2]!)) + '\n'); }
  finally { await closeDb(); }
}
main().catch(() => {
  // File/schema errors can contain arbitrary edited metadata. Never echo it.
  process.stderr.write('Tier 1 evidence operation failed. Use --preview, or after owner approval --record --expect-sha256 <reviewed digest>; check campaign and deployment provenance.\n');
  process.exitCode = 1;
});
