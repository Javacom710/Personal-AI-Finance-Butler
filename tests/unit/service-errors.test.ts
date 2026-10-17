/**
 * `toDomainError` — the translation of a database refusal into a typed result.
 *
 * Asserted on the error shape node-postgres produces (`code`, `constraint`),
 * without a database: the integration suite proves the constraints fire, and
 * this file proves what the user is told when they do. The RESTRICT cases
 * exist because PostgreSQL 18 (the local development service, D-23) raises
 * `23001` where PostgreSQL 17 (CI and production) raises `23503`; an unmapped
 * code becomes an unhandled fault instead of a `conflict`.
 */

import { describe, expect, it } from 'vitest';

import { toDomainError } from '@/server/services/_errors';

describe('toDomainError', () => {
  it.each([
    ['23503', 'PostgreSQL 17 and earlier, and NO ACTION keys on any version'],
    ['23001', 'PostgreSQL 18 and later, RESTRICT keys'],
  ])('maps a delete refused by a foreign key (%s, %s) to a conflict', (code) => {
    expect(
      toDomainError({ code, constraint: 'investment_transactions_account_id_accounts_id_fk' }),
    ).toEqual({
      code: 'conflict',
      message: 'Something else still refers to this record, so it cannot be changed or removed.',
    });
  });

  it('keeps the named message for a known unique constraint', () => {
    expect(toDomainError({ code: '23505', constraint: 'accounts_user_name_uniq' })).toEqual({
      code: 'conflict',
      message: 'An account with that name already exists.',
    });
  });

  it('leaves an unrecognised database error to the fault path', () => {
    expect(toDomainError({ code: '40001' })).toBeNull();
    expect(toDomainError(new Error('not a database error'))).toBeNull();
  });
});
