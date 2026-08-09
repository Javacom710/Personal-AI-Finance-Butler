import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/server/db/client';
import { auditLog } from '@/server/db/schema';
import { expectPermissionDenied } from './expect-pg';
import { closeHarness, truncateAll } from './harness';

beforeEach(truncateAll);
afterAll(closeHarness);

/**
 * These run as the **application** role, because that is what the running
 * server holds. They assert the two privilege properties SECURITY.md §2 and §10
 * claim, rather than trusting that the grant script ran.
 */
describe('application role privileges', () => {
  it('can append to the audit log', async () => {
    await db().insert(auditLog).values({
      actor: 'user',
      action: 'test.append',
      entityType: 'probe',
    });

    expect(await db().select().from(auditLog)).toHaveLength(1);
  });

  it('cannot update the audit log — it is append-only at the grant level', async () => {
    await db().insert(auditLog).values({ actor: 'user', action: 'test.a', entityType: 'probe' });

    await expectPermissionDenied(
      () => db().execute(sql`update audit_log set action = 'tampered'`),
      'UPDATE on audit_log',
    );
  });

  it('cannot delete from the audit log', async () => {
    await db().insert(auditLog).values({ actor: 'user', action: 'test.b', entityType: 'probe' });

    await expectPermissionDenied(() => db().execute(sql`delete from audit_log`), 'DELETE on audit_log');
  });

  it('cannot truncate the audit log', async () => {
    await expectPermissionDenied(
      () => db().execute(sql`truncate table audit_log`),
      'TRUNCATE on audit_log',
    );
  });

  it('cannot create a table', async () => {
    await expectPermissionDenied(
      () => db().execute(sql`create table should_not_exist (x int)`),
      'CREATE TABLE',
    );
  });

  it('cannot drop or alter a table', async () => {
    await expectPermissionDenied(() => db().execute(sql`drop table sessions`), 'DROP TABLE');
    await expectPermissionDenied(
      () => db().execute(sql`alter table users add column injected int`),
      'ALTER TABLE',
    );
  });

  it('can read reference data but not change it', async () => {
    const rows = await db().execute(sql`select code from currencies limit 1`);
    expect(rows.rows).toHaveLength(1);

    await expectPermissionDenied(
      () => db().execute(sql`insert into currencies values ('ZZZ', 2, 'Z', 'Zed')`),
      'INSERT on currencies',
    );
    await expectPermissionDenied(
      () => db().execute(sql`update currencies set symbol = 'X'`),
      'UPDATE on currencies',
    );
    await expectPermissionDenied(
      () => db().execute(sql`delete from currencies`),
      'DELETE on currencies',
    );
  });

  it('has full DML on ordinary data tables', async () => {
    await db().execute(sql`insert into jobs (kind) values ('test.job')`);
    await db().execute(sql`update jobs set attempts = 1 where kind = 'test.job'`);
    await db().execute(sql`delete from jobs where kind = 'test.job'`);

    const remaining = await db().execute<{ n: number }>(sql`select count(*)::int as n from jobs`);
    expect(remaining.rows[0]?.n).toBe(0);
  });
});
