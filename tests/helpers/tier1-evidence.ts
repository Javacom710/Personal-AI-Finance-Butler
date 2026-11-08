import { readFileSync } from 'node:fs';
import { TIER1_EVIDENCE_DIRECTORY, tier1EvidenceFiles } from '../../scripts/lib/tier1-evidence';

export function retainedTier1Evidence(): Record<string, string> {
  return Object.fromEntries(tier1EvidenceFiles().map(name => [name, readFileSync(new URL(`../../${TIER1_EVIDENCE_DIRECTORY}/${name}`, import.meta.url), 'utf8')]));
}
