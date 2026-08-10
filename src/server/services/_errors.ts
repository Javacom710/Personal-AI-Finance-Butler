import 'server-only';

/**
 * Database errors, translated at the transaction boundary.
 *
 * A `UNIQUE` violation inside a Postgres transaction **aborts the whole
 * transaction**: every statement after it fails until rollback. So a service
 * cannot catch a constraint error mid-transaction and carry on — the catch has
 * to happen outside, after the rollback, which is what `runCommand` does.
 *
 * Services still pre-check the cases they can name properly ("an account called
 * X already exists"). This module is the backstop for the ones they cannot: a
 * race, a shape the deferred trigger rejects at COMMIT, or a foreign key that
 * only fails on delete. Without it those surface as `error: duplicate key value
 * violates unique constraint "accounts_user_name_uniq"`, which is a message for
 * the developer and not for the user.
 */

import { conflict, invariantViolation, type DomainError } from '../../lib/result';
import { log, newCorrelationId } from '../log';

interface PgError {
  readonly code?: string;
  readonly constraint?: string;
  readonly message?: string;
  readonly detail?: string;
}

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
const RAISE_EXCEPTION = 'P0001';

function asPgError(error: unknown): PgError | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as PgError;
  return typeof candidate.code === 'string' ? candidate : null;
}

/** Messages for the constraints a user can actually trip. */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  accounts_user_name_uniq: 'An account with that name already exists.',
  categories_user_parent_name_uniq: 'A category with that name already exists in the same place.',
  tags_user_name_ci_uniq: 'That tag already exists.',
  budgets_active_uniq: 'There is already an active budget for that category and period.',
  recurring_occurrences_rule_due_uniq: 'That occurrence has already been recorded.',
  budgets_amount_positive: 'A budget amount must be greater than zero.',
  tx_entry_amount_non_zero: 'A transaction amount cannot be zero.',
  tx_entry_base_amount_consistent:
    'The base-currency amount does not match the amount and the rate used. This is invariant I-11.',
  accounts_card_has_limit: 'A credit card needs a credit limit.',
  transactions_transfer_has_no_category: 'A transfer carries no category.',
};

export function toDomainError(error: unknown): DomainError | null {
  const pg = asPgError(error);
  if (!pg) return null;

  const named = pg.constraint ? CONSTRAINT_MESSAGES[pg.constraint] : undefined;

  switch (pg.code) {
    case UNIQUE_VIOLATION:
      return conflict(named ?? 'That value is already in use.');
    case FOREIGN_KEY_VIOLATION:
      return conflict(
        named ?? 'Something else still refers to this record, so it cannot be changed or removed.',
      );
    case CHECK_VIOLATION:
      return invariantViolation(pg.constraint ?? 'check', named ?? 'That value is not allowed here.');
    case RAISE_EXCEPTION:
      // The shape triggers raise with an explicit invariant number in the text.
      return invariantViolation('check_transaction_shape', pg.message ?? 'Invalid transaction shape.');
    default:
      return null;
  }
}

/**
 * Run a command and translate a database failure into a typed result.
 *
 * Anything that is not a recognised constraint failure is a genuine fault: it is
 * logged with a correlation id and rethrown, so the error boundary shows the id
 * and the stack never reaches the browser (ARCHITECTURE.md §7).
 */
export async function runCommand<T>(fn: () => Promise<T>): Promise<T | { ok: false; error: DomainError }> {
  try {
    return await fn();
  } catch (error) {
    const domain = toDomainError(error);
    if (domain) {
      log.warn('command rejected by a database constraint', {
        code: (error as PgError).code,
        constraint: (error as PgError).constraint,
      });
      return { ok: false, error: domain };
    }

    const correlationId = newCorrelationId();
    log.error('command failed', { correlationId, error });
    throw error;
  }
}
