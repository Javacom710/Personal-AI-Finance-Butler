import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EXCLUDED_TABLES, EXPORTED_TABLES, EXPORT_LIMIT_PER_DAY, exportAllData } from '@/server/services';
import { closeHarness, truncateAll } from './harness';
import { makeInstrument, recordBuy, storeClose, truncateInvestments } from './investment-harness';
import {
  categoryId,
  closeMoneyHarness,
  makeAccount,
  must,
  rawSql,
  record,
  setupMoneyFixture,
  truncateMoney,
  type MoneyFixture,
} from './money-harness';

/**
 * Settings → Data → Export (SECURITY.md §9).
 *
 * What matters about an export is what it would be wrong for it to contain or
 * miss: every table the user owns, no credentials, nobody else's rows, and
 * amounts exactly as stored.
 */

let fixture: MoneyFixture;
let other: MoneyFixture;

beforeAll(async () => {
  await truncateAll();
  fixture = await setupMoneyFixture();
  other = await setupMoneyFixture();
});

beforeEach(async () => {
  await truncateInvestments();
  await truncateMoney();
  await rawSql(`delete from audit_log where action = 'data.export'`);
});

afterAll(async () => {
  await closeMoneyHarness();
  await closeHarness();
});

describe('exportAllData', () => {
  it('covers every table in the schema: each is exported or excluded with a reason', async () => {
    const { rows } = (await rawSql(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
    )) as { rows: { table_name: string }[] };
    const live = rows.map((r) => r.table_name);
    const listed = new Set([...EXPORTED_TABLES.map((t) => t.name), ...Object.keys(EXCLUDED_TABLES)]);

    expect(live.filter((t) => !listed.has(t))).toEqual([]);
    // And nothing listed as exported is missing from the schema.
    expect(EXPORTED_TABLES.map((t) => t.name).filter((t) => !live.includes(t))).toEqual([]);
  });

  it('exports the user’s records with exact amounts, dates and every table present', async () => {
    const bank = await makeAccount(fixture.ctx, { name: 'Bank', openingBalance: '100000.5' });
    const food = await categoryId(fixture.ctx, 'Food');
    await record(fixture.ctx, { kind: 'expense', accountId: bank, categoryId: food, amount: '1250.5', bookedOn: '2026-08-10', description: 'Dinner' });
    const demat = await makeAccount(fixture.ctx, { name: 'Demat', kind: 'brokerage' });
    const stock = await makeInstrument(fixture.ctx, { symbol: 'EXPA' });
    must(await recordBuy(fixture.ctx, { accountId: demat, instrumentId: stock, on: '2026-01-05', qty: '10.5', price: '100.25' }));
    await storeClose(fixture.ctx, { instrumentId: stock, on: '2026-08-07', close: '123.4567' });

    const data = must(await exportAllData(fixture.ctx));

    expect(data.format).toBe('finance-os-export');
    expect(Object.keys(data.tables).sort()).toEqual(EXPORTED_TABLES.map((t) => t.name).sort());
    expect(data.account.id).toBe(fixture.userId);

    const account = data.tables['accounts']!.find((a) => a['name'] === 'Bank')!;
    // The stored digits as a string — never 100000.5 the number.
    expect(account['opening_balance']).toBe('100000.5000');

    const txn = data.tables['transactions']!.find((t) => t['description'] === 'Dinner')!;
    expect(txn['booked_on']).toBe('2026-08-10');
    const entries = data.tables['transaction_entries']!.filter((e) => e['transaction_id'] === txn['id']);
    expect(entries.map((e) => e['amount'])).toEqual(['-1250.5000']);

    const buy = data.tables['investment_transactions']![0]!;
    expect(buy['quantity']).toBe('10.50000000');
    expect(String(data.tables['instrument_prices']![0]!['close'])).toMatch(/^123\.4567/);
    expect(data.tables['positions']).toHaveLength(1);

    // No value anywhere in the document is a JSON number at row level.
    for (const rows of Object.values(data.tables)) {
      for (const row of rows) {
        for (const value of Object.values(row)) expect(typeof value).not.toBe('number');
      }
    }
    expect(data.rowCounts['transactions']).toBe(data.tables['transactions']!.length);
  });

  it('contains no credential of any kind', async () => {
    const serialised = JSON.stringify(must(await exportAllData(fixture.ctx)));
    for (const field of ['password_hash', 'totp_secret', 'totp_recovery', 'token_hash', 'passwordHash']) {
      expect(serialised).not.toContain(field);
    }
    expect(Object.keys(must(await exportAllData(fixture.ctx)).tables)).not.toContain('sessions');
  });

  it('contains nobody else’s rows, including rows owned through a parent', async () => {
    const theirs = await makeAccount(other.ctx, { name: 'Their Bank', openingBalance: '999' });
    const theirFood = await categoryId(other.ctx, 'Food');
    await record(other.ctx, { kind: 'expense', accountId: theirs, categoryId: theirFood, amount: '77', bookedOn: '2026-08-01', description: 'Not mine' });

    const data = must(await exportAllData(fixture.ctx));
    const serialised = JSON.stringify(data);
    expect(serialised).not.toContain('Their Bank');
    expect(serialised).not.toContain('Not mine');
    expect(serialised).not.toContain(other.userId);
    expect(data.tables['transaction_entries']!.some((e) => e['amount'] === '-77.0000')).toBe(false);
  });

  it(`allows ${EXPORT_LIMIT_PER_DAY} exports a day, records each, and records nothing for a refused one`, async () => {
    for (let i = 0; i < EXPORT_LIMIT_PER_DAY; i += 1) must(await exportAllData(fixture.ctx));

    const refused = await exportAllData(fixture.ctx);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('conflict');

    const { rows } = (await rawSql(
      `select count(*)::int as n from audit_log where user_id = $1 and action = 'data.export'`,
      [fixture.userId],
    )) as { rows: { n: number }[] };
    expect(rows[0]!.n).toBe(EXPORT_LIMIT_PER_DAY);

    // Another user's allowance is untouched.
    must(await exportAllData(other.ctx));
  });
});
