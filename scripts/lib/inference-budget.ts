/**
 * The project-wide inference spending cap (ADR-56).
 *
 * The owner capped net API inference spending for the whole build, development
 * and testing period at US$10. Every script that sends a paid inference request
 * checks this cap *before* the request, against everything already accounted:
 *
 * - every `usage.json` ledger under `eval/reports/` (any provider), and
 * - owner-reported spend outside those ledgers (`externalSpend`).
 *
 * Spending above the cap is possible only through an `extensions` entry the
 * owner approved after vetting necessity and alternatives. Agents never add,
 * edit or approve an extension, and never edit `capUsd` (the schema pins it).
 */
import { readFile, readdir, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const PROJECT_CAP_USD = 10;
const usd = z.number().finite().nonnegative();
const day = z.iso.date();

const extensionSchema = z.object({
  amountUsd: z.number().finite().positive(),
  requestedOn: day,
  necessity: z.string().min(20),
  alternativesConsidered: z.string().min(20),
  decision: z.enum(['spend', 'not_spend']),
  decidedBy: z.literal('owner'),
  decidedOn: day,
}).strict();

const configSchema = z.object({
  capUsd: z.literal(PROJECT_CAP_USD),
  freeHosts: z.array(z.string().min(1)),
  extensions: z.array(extensionSchema),
  externalSpend: z.array(z.object({ provider: z.string().min(1), usd, recordedOn: day, note: z.string().min(1) }).strict()),
}).strict();

export type InferenceBudgetConfig = z.infer<typeof configSchema>;

const DEFAULT_CONFIG: InferenceBudgetConfig = { capUsd: PROJECT_CAP_USD, freeHosts: ['api.groq.com'], extensions: [], externalSpend: [] };

/** A missing file means the default: the US$10 cap and no approved extensions. */
export async function loadInferenceBudget(root = process.cwd()): Promise<InferenceBudgetConfig> {
  let raw: string;
  try { raw = await readFile(path.join(root, 'config/inference-budget.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_CONFIG; throw error; }
  const parsed = configSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`config/inference-budget.json is invalid; no paid request was sent. ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return parsed.data;
}

/** The cap plus every extension the owner decided to spend. */
export function effectiveCapUsd(config: InferenceBudgetConfig): number {
  return config.capUsd + config.extensions.filter(e => e.decision === 'spend').reduce((n, e) => n + e.amountUsd, 0);
}

export function isFreeHost(baseUrl: string, config: InferenceBudgetConfig): boolean {
  return config.freeHosts.includes(new URL(baseUrl).hostname);
}

const ledgerSchema = z.object({ events: z.array(z.object({ accountedUsd: usd }).loose()) }).loose();

/** Sum every `usage.json` under the report root, except the active ledger. */
export async function ledgerSpendUsd(reportRoot: string, excludeLedger?: string): Promise<number> {
  const excluded = excludeLedger ? path.resolve(excludeLedger) : undefined;
  const walk = async (directory: string): Promise<number> => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
    let total = 0;
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) total += await walk(file);
      else if (entry.isFile() && entry.name === 'usage.json' && path.resolve(file) !== excluded) {
        const parsed = ledgerSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
        if (!parsed.success) throw new Error(`Unreadable spend ledger ${path.relative(process.cwd(), file)}; no paid request was sent.`);
        total += parsed.data.events.reduce((n, event) => n + event.accountedUsd, 0);
      }
    }
    return total;
  };
  return walk(path.resolve(reportRoot));
}

export interface ProjectSpend { readonly spentUsd: number; readonly capUsd: number; readonly remainingUsd: number }

/** Everything accounted so far, excluding the caller's active ledger. */
export async function projectSpend(root = process.cwd(), excludeLedger?: string): Promise<ProjectSpend> {
  const config = await loadInferenceBudget(root);
  const spentUsd = await ledgerSpendUsd(path.join(root, 'eval/reports'), excludeLedger)
    + config.externalSpend.reduce((n, e) => n + e.usd, 0);
  const capUsd = effectiveCapUsd(config);
  return { spentUsd, capUsd, remainingUsd: Math.max(0, capUsd - spentUsd) };
}

export const CAP_MESSAGE = 'Project inference cap reached';

/** Throw before a request that could take accounted spend past the cap. */
export function assertWithinProjectCap(spend: ProjectSpend, additionalUsd: number): void {
  if (!Number.isFinite(additionalUsd) || additionalUsd < 0) throw new Error('Invalid spend reservation; no paid request was sent.');
  if (spend.spentUsd + additionalUsd > spend.capUsd + 1e-9) {
    throw new Error(
      `${CAP_MESSAGE}: $${spend.spentUsd.toFixed(4)} accounted + $${additionalUsd.toFixed(4)} for this request > $${spend.capUsd.toFixed(2)} cap. ` +
      'No paid request was sent. Spending above the cap needs a vetted extension (necessity and alternatives) that the owner decides; ' +
      'see docs/DECISIONS.md ADR-56. Agents must not edit config/inference-budget.json to proceed.',
    );
  }
}

/** Remove `--reserve-usd <n>` from argv; the value is an operator-stated upper bound. */
export function takeReserveFlag(argv: readonly string[]): { argv: string[]; reserveUsd?: number } {
  const at = argv.indexOf('--reserve-usd');
  if (at < 0) return { argv: [...argv] };
  const value = Number(argv[at + 1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error('--reserve-usd needs a positive US-dollar amount.');
  return { argv: [...argv.slice(0, at), ...argv.slice(at + 2)], reserveUsd: value };
}

/**
 * Scripts without per-request token accounting reserve an upper bound up front
 * and keep it as accounted spend: conservative, never under-counted.
 */
export async function reserveUnledgeredSpend(
  root: string,
  entry: { script: string; providerIdentity: string; reservedUsd: number; note: string },
): Promise<void> {
  const spend = await projectSpend(root);
  assertWithinProjectCap(spend, entry.reservedUsd);
  const directory = path.join(root, 'eval/reports/unledgered');
  const file = path.join(directory, 'usage.json');
  await mkdir(directory, { recursive: true });
  let ledger: { events: object[] } = { events: [] };
  try { ledger = ledgerSchema.parse(JSON.parse(await readFile(file, 'utf8'))) as { events: object[] }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  ledger.events.push({ at: new Date().toISOString(), ...entry, accountedUsd: entry.reservedUsd });
  await writeFile(`${file}.tmp`, JSON.stringify(ledger, null, 2) + '\n');
  await rename(`${file}.tmp`, file);
}
