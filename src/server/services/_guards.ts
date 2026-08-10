import 'server-only';

/**
 * Authorization (SECURITY.md §0, ARCHITECTURE.md §2).
 *
 * **Authentication ≠ authorization.** `requireSession` in the presentation layer
 * proves *who you are*; these guards decide *what you may do, to which entity*.
 * They live in one layer so that "where is this checked?" has exactly one
 * answer — which matters more than usual here, because Phase 7's AI tools enter
 * through these same services and cannot bypass a check that sits on the only
 * path in.
 *
 * A row belonging to another user is reported as `not_found`, never as
 * `forbidden`: telling an attacker that an id exists but is not theirs is an
 * enumeration oracle.
 */

import { compareDates, type IsoDate } from '../../lib/date';
import { conflict, err, notFound, ok, validationFailed, type DomainError, type Result } from '../../lib/result';

export interface OwnedRow {
  readonly userId: string;
}

/** Assert a fetched row exists and belongs to the caller. */
export function requireOwnership<T extends OwnedRow>(
  row: T | undefined | null,
  userId: string,
  entity: string,
  id: string,
): Result<T, DomainError> {
  if (!row || row.userId !== userId) return err(notFound(entity, id));
  return ok(row);
}

export interface ActivatableAccount {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly openingDate: string;
}

/**
 * A closed account accepts no new movements.
 *
 * Historical records against it remain, and remain in historical totals
 * (FINANCIAL-DOMAIN.md §3) — closing an account does not zero it, and this
 * guard deliberately does not apply to reads or to edits of existing rows.
 */
export function requireActiveAccount(
  account: ActivatableAccount,
  field = 'accountId',
): Result<ActivatableAccount, DomainError> {
  if (!account.isActive) {
    return err(
      validationFailed({
        [field]: [`${account.name} is closed. Reopen it before recording anything new against it.`],
      }),
    );
  }
  return ok(account);
}

/**
 * A transaction cannot predate the account it moves money in or out of
 * (FINANCIAL-DOMAIN.md §12, case 2).
 *
 * The opening balance is the declared position on the opening date; a movement
 * before it would be counted on top of a figure that already included it.
 */
export function requireOnOrAfterOpening(
  account: ActivatableAccount,
  bookedOn: IsoDate,
  field = 'bookedOn',
): Result<void, DomainError> {
  if (compareDates(bookedOn, account.openingDate as IsoDate) < 0) {
    return err(
      validationFailed({
        [field]: [
          `${account.name} opened on ${account.openingDate}. Its opening balance already accounts for everything before that date.`,
        ],
      }),
    );
  }
  return ok(undefined);
}

/** A guard for delete paths where the database would otherwise raise a bare FK error. */
export function requireUnreferenced(
  count: number,
  entity: string,
  suggestion: string,
): Result<void, DomainError> {
  if (count > 0) {
    return err(
      conflict(
        `This ${entity} is used by ${count} record${count === 1 ? '' : 's'} and cannot be deleted. ${suggestion}`,
      ),
    );
  }
  return ok(undefined);
}
