/** Account spending may be combined; model measurements never are. */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const ledger = z.object({
  providerIdentity: z.literal('https://api.deepinfra.com/v1/openai'),
  events: z.array(z.object({ accountedUsd: z.number().finite().nonnegative() })),
});

/** Include diagnostic, serial-start and crash reservations; skip the active ledger. */
export async function otherDeepinfraSpend(reportRoot: string, activeLedger: string): Promise<number> {
  const excluded = path.resolve(activeLedger);
  const walk = async (directory: string): Promise<number> => {
    let total = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) total += await walk(file);
      else if (entry.isFile() && entry.name === 'usage.json' && path.resolve(file) !== excluded) {
        const parsed = ledger.parse(JSON.parse(await readFile(file, 'utf8')));
        total += parsed.events.reduce((n, event) => n + event.accountedUsd, 0);
      }
    }
    return total;
  };
  let total = 0;
  for (const entry of await readdir(reportRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('deepinfra-')) total += await walk(path.join(reportRoot, entry.name));
  }
  return total;
}
