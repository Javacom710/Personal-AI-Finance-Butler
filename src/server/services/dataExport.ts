import 'server-only';

/**
 * Settings → Data → Export ([SECURITY.md §9](../../../docs/SECURITY.md#9-data-export-backup-and-deletion)).
 *
 * Every row the user owns, as one JSON document, read inside **one
 * transaction** so the export is a consistent snapshot: a transaction recorded
 * while the export runs is either wholly in it or wholly absent, never present
 * as a transaction without its entries.
 *
 * ## Exactness
 *
 * Each row is rendered **by Postgres**, `to_jsonb(row)`, and every JSON number
 * at the top level of a row is turned into the string Postgres would print for
 * it. A `NUMERIC(20,4)` amount therefore arrives as `"1250.5000"` — the stored
 * digits, no float in between — and a `date` arrives as `"2026-08-10"`, not as
 * a JavaScript `Date` that a time zone can move by a day. Integer columns
 * become strings by the same rule; one rule is simpler to rely on than two.
 * Nested `jsonb` (a recurring template, audit before/after) is passed through
 * as stored.
 *
 * ## Coverage
 *
 * The tables are listed explicitly, in {@link EXPORTED_TABLES}, and every table
 * that is *not* exported is listed with its reason in {@link EXCLUDED_TABLES}.
 * A test reads the live schema and fails if a table appears in neither, so a
 * table added later cannot silently fall out of the export.
 *
 * Credentials are never exported: no password hash, no TOTP secret or recovery
 * hashes, no session token hashes. An export is a copy of the user's financial
 * records, and a copy that could sign in as them would be a worse thing to lose
 * than the original.
 */

import { sql, type SQL } from 'drizzle-orm';

import { err, ok, type DomainError, type Result } from '../../lib/result';
import type { RequestCtx } from './_ctx';
import { withWriteCtx } from './_ctx';

export const EXPORT_FORMAT = 'finance-os-export';
export const EXPORT_VERSION = 1;

/** SECURITY.md §6. */
export const EXPORT_LIMIT_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const AUDIT_ACTION = 'data.export';

/** How a table's rows are tied to the user. */
type Ownership =
  /** The table has its own `user_id`. */
  | { readonly kind: 'user' }
  /** Owned through a parent row: `child.fk = parent.id and parent.user_id = $user`. */
  | { readonly kind: 'parent'; readonly fk: string; readonly parent: string };

interface ExportedTable {
  readonly name: string;
  readonly owner: Ownership;
  /** Columns never exported. Credentials only. */
  readonly omit?: readonly string[];
  /** A stable order, so two exports of the same data are byte-identical. */
  readonly orderBy: string;
}

const user: Ownership = { kind: 'user' };

export const EXPORTED_TABLES: readonly ExportedTable[] = [
  { name: 'settings', owner: user, orderBy: 'user_id' },
  { name: 'user_state', owner: user, orderBy: 'user_id' },
  { name: 'accounts', owner: user, orderBy: 'created_at, id' },
  { name: 'categories', owner: user, orderBy: 'created_at, id' },
  { name: 'tags', owner: user, orderBy: 'created_at, id' },
  { name: 'transactions', owner: user, orderBy: 'booked_on, created_at, id' },
  { name: 'transaction_entries', owner: { kind: 'parent', fk: 'transaction_id', parent: 'transactions' }, orderBy: 'transaction_id, id' },
  { name: 'transaction_tags', owner: { kind: 'parent', fk: 'transaction_id', parent: 'transactions' }, orderBy: 'transaction_id, tag_id' },
  { name: 'budgets', owner: user, orderBy: 'created_at, id' },
  { name: 'recurring_rules', owner: user, orderBy: 'created_at, id' },
  { name: 'recurring_occurrences', owner: { kind: 'parent', fk: 'rule_id', parent: 'recurring_rules' }, orderBy: 'rule_id, due_on, id' },
  { name: 'instruments', owner: user, orderBy: 'created_at, id' },
  { name: 'instrument_prices', owner: { kind: 'parent', fk: 'instrument_id', parent: 'instruments' }, orderBy: 'instrument_id, as_of' },
  { name: 'instrument_quotes', owner: { kind: 'parent', fk: 'instrument_id', parent: 'instruments' }, orderBy: 'instrument_id' },
  { name: 'investment_transactions', owner: user, orderBy: 'trade_date, created_at, id' },
  { name: 'tax_lots', owner: user, orderBy: 'opened_on, id' },
  { name: 'lot_disposals', owner: user, orderBy: 'closed_on, id' },
  { name: 'positions', owner: user, orderBy: 'account_id, instrument_id' },
  { name: 'corporate_action_detections', owner: user, orderBy: 'id' },
  { name: 'manual_assets', owner: user, orderBy: 'created_at, id' },
  { name: 'asset_valuations', owner: user, orderBy: 'id' },
  { name: 'liabilities', owner: user, orderBy: 'created_at, id' },
  { name: 'liability_balances', owner: user, orderBy: 'id' },
  { name: 'ai_conversations', owner: user, orderBy: 'created_at, id' },
  { name: 'ai_messages', owner: { kind: 'parent', fk: 'conversation_id', parent: 'ai_conversations' }, orderBy: 'conversation_id, created_at, id' },
  { name: 'ai_proposals', owner: user, orderBy: 'created_at, id' },
  { name: 'ai_usage_daily', owner: user, orderBy: 'day' },
  { name: 'auth_events', owner: user, orderBy: 'created_at, id' },
  { name: 'audit_log', owner: user, orderBy: 'at, id' },
];

/** Every table not exported, and why. Read by the coverage test. */
export const EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  users: 'exported separately as `account`, without credentials',
  sessions: 'credentials: each row holds a session token hash',
  currencies: 'shared reference data, not the user’s',
  fx_rates: 'shared reference data, not the user’s',
  jobs: 'the operational job queue',
  ai_model_evaluations: 'operational model measurements, not the user’s',
  __drizzle_migrations: 'migration bookkeeping',
};

export type ExportRow = Readonly<Record<string, unknown>>;

export interface DataExport {
  readonly format: typeof EXPORT_FORMAT;
  readonly version: typeof EXPORT_VERSION;
  readonly exportedAt: string;
  readonly account: { readonly id: string; readonly email: string; readonly totpEnabled: boolean; readonly createdAt: string };
  readonly notes: readonly string[];
  readonly excluded: Readonly<Record<string, string>>;
  readonly rowCounts: Readonly<Record<string, number>>;
  readonly tables: Readonly<Record<string, readonly ExportRow[]>>;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ORDER = /^[a-z_][a-z0-9_]*(, [a-z_][a-z0-9_]*)*$/;

/** Table and column names come from the constants above, never from input; checked anyway. */
function ident(name: string): SQL {
  if (!IDENT.test(name)) throw new Error(`dataExport: not an identifier: ${name}`);
  return sql.raw(`"${name}"`);
}

/**
 * One row as JSON, with every top-level number turned into its exact text.
 * `#>> '{}'` renders a jsonb scalar as Postgres prints it: `1250.5000`, not
 * `1250.5`.
 */
function rowJson(alias: string, omit: readonly string[]): SQL {
  let row = sql`to_jsonb(${sql.raw(alias)})`;
  for (const column of omit) {
    if (!IDENT.test(column)) throw new Error(`dataExport: not an identifier: ${column}`);
    row = sql`(${row} - ${column})`;
  }
  return sql`(select coalesce(jsonb_object_agg(e.key,
                case jsonb_typeof(e.value) when 'number' then to_jsonb(e.value #>> '{}') else e.value end), '{}'::jsonb)
             from jsonb_each(${row}) e)`;
}

function tableQuery(table: ExportedTable, userId: string): SQL {
  if (!ORDER.test(table.orderBy)) throw new Error(`dataExport: bad order for ${table.name}`);
  const order = sql.raw(table.orderBy.split(', ').map((c) => `t."${c}"`).join(', '));
  const json = rowJson('t', table.omit ?? []);
  if (table.owner.kind === 'user') {
    return sql`select ${json} as row from ${ident(table.name)} t where t.user_id = ${userId} order by ${order}`;
  }
  return sql`select ${json} as row
               from ${ident(table.name)} t
               join ${ident(table.owner.parent)} p on p.id = t.${ident(table.owner.fk)}
              where p.user_id = ${userId}
              order by ${order}`;
}

/**
 * Build the export, record it in the audit log, and count it against the daily
 * limit — all in one transaction, so a refused or failed export leaves no audit
 * row and does not use up an allowance.
 */
export async function exportAllData(ctx: RequestCtx): Promise<Result<DataExport, DomainError>> {
  return withWriteCtx(ctx, async (w) => {
    // REPEATABLE READ: every table below is read from the same snapshot.
    await w.tx.execute(sql`set transaction isolation level repeatable read`);

    const since = new Date(ctx.now.getTime() - DAY_MS);
    const { rows: used } = await w.tx.execute<{ n: string }>(sql`
      select count(*)::text as n from audit_log
       where user_id = ${ctx.userId} and action = ${AUDIT_ACTION} and at > ${since.toISOString()}
    `);
    if (Number(used[0]?.n ?? '0') >= EXPORT_LIMIT_PER_DAY) {
      return err({
        code: 'conflict',
        message: `At most ${EXPORT_LIMIT_PER_DAY} exports a day. Try again tomorrow.`,
      } as const);
    }

    const { rows: accounts } = await w.tx.execute<{ id: string; email: string; totp_enabled: boolean; created_at: string }>(sql`
      select id::text as id, email::text as email, totp_enabled, to_jsonb(created_at) #>> '{}' as created_at
        from users where id = ${ctx.userId}
    `);
    const account = accounts[0];
    if (!account) return err({ code: 'not_found', entity: 'user', message: 'user not found' } as const);

    const tables: Record<string, readonly ExportRow[]> = {};
    const rowCounts: Record<string, number> = {};
    for (const table of EXPORTED_TABLES) {
      const { rows } = await w.tx.execute<{ row: ExportRow }>(tableQuery(table, ctx.userId));
      tables[table.name] = rows.map((r) => r.row);
      rowCounts[table.name] = rows.length;
    }

    await w.audit.record({
      actor: 'user',
      action: AUDIT_ACTION,
      entityType: 'user',
      entityId: ctx.userId,
      // Counts only. The audit row records that an export happened, not a
      // second copy of what it contained.
      after: { version: EXPORT_VERSION, rowCounts },
    });

    return ok({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: ctx.now.toISOString(),
      account: {
        id: account.id,
        email: account.email,
        totpEnabled: account.totp_enabled,
        createdAt: account.created_at,
      },
      notes: [
        'Every number is a string holding the exact stored value. Amounts are never JSON numbers.',
        'Dates are YYYY-MM-DD; timestamps are ISO 8601 with an offset.',
        'Positions, tax lots and lot disposals are derived from investment_transactions and can be rebuilt from it.',
        'This export contains no password, TOTP secret, recovery code or session token.',
      ],
      excluded: EXCLUDED_TABLES,
      rowCounts,
      tables,
    });
  });
}
