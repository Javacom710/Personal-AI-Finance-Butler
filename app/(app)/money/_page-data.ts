import 'server-only';

/**
 * Shared page loading for the money area.
 *
 * Every page needs the same three things — a read context, a formatter, and the
 * account list — so they are built once here rather than repeated with slightly
 * different options per page.
 */

import { createFormatter, createReadCtx, type Formatter, type ReadCtx } from '@/server/services';
import { requireSession } from '@/server/auth/guards';

export interface MoneyPageContext {
  readonly ctx: ReadCtx;
  readonly format: Formatter;
}

export async function loadMoneyContext(path: string): Promise<MoneyPageContext> {
  const session = await requireSession(path);
  const read = await createReadCtx(session.userId);

  if (!read.ok) {
    // Settings are created with the account and cannot be missing for a session
    // that authenticated. If they are, the account is half-provisioned and every
    // figure below would be computed against a guessed base currency.
    throw new Error(
      'This account has no settings row, so no base currency is known. Re-provision it with npm run auth:create-user.',
    );
  }

  return { ctx: read.value, format: await createFormatter(read.value) };
}

/** The sign-coloured class for an amount. A minus sign carries the meaning; colour reinforces it. */
export function amountTone(minor: bigint): string {
  if (minor > 0n) return 'text-positive';
  if (minor < 0n) return 'text-negative';
  return 'text-ink-muted';
}
