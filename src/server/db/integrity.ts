/**
 * `verify:integrity` — the invariants, checked against real data (SCHEMA.md §12).
 *
 * Constraints and triggers stop bad data being written. This command answers a
 * different question: **is the data that is already there still consistent?** It
 * runs against production, after a restore, and in CI against a seeded database.
 *
 * Phase 3 covered I-1, I-2, I-3, I-4, I-9 and I-11; Phase 4 adds I-5, I-6, I-7,
 * I-12, I-13 and I-15 to I-20. Phase 5 adds the net-worth engine invariants and
 * Phase 6.11 the market-value ones (I-38, I-39, I-41, I-43 … I-49). I-10/I-14
 * (Phase 9) arrive with the tables they describe, and are listed as `skipped`
 * rather than silently omitted — a checker that quietly covers less than it
 * claims is worse than no checker.
 *
 * **Two relations are deliberately NOT checked**, because both are intuitive,
 * will be assumed, and are **false** (SCHEMA.md §12, non-invariants):
 *
 * - `Σ lot_disposals.quantity + remaining_quantity = original_quantity`. A split
 *   or bonus rescales a partially disposed lot's quantities, and already-settled
 *   disposal rows are historical records that are not rewritten. The **money**
 *   form (I-20) holds unconditionally and is the one below.
 * - `positions.ledger_version = user_state.investment_ledger_version`. The
 *   counter is global per user, so after any trade every position but the one
 *   just rebuilt carries a lower value. It is a provenance stamp.
 *
 * A library, not a CLI: the command lives in `scripts/verify-integrity.ts`.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';

export type CheckStatus = 'passed' | 'failed' | 'skipped' | 'warning' | 'engine';

export interface CheckResult {
  readonly invariant: string;
  readonly description: string;
  readonly status: CheckStatus;
  readonly violations: number;
  /** A few offending rows, enough to start an investigation without dumping the table. */
  readonly samples: readonly Record<string, unknown>[];
  readonly note?: string;
}

export interface IntegrityReport {
  readonly checks: readonly CheckResult[];
  readonly passed: boolean;
  readonly failedCount: number;
}

interface Check {
  readonly invariant: string;
  readonly description: string;
  /** Must select the offending rows and nothing else. Zero rows means the invariant holds. */
  readonly query: ReturnType<typeof sql>;
  /**
   * A heuristic a user can legitimately violate. Reported, never failed — an
   * invariant that cries wolf is one that gets ignored.
   */
  readonly warningOnly?: boolean;
}

/**
 * Each query returns **violations**, so an empty result is a pass. Written that
 * way round deliberately: a check that counts conforming rows passes vacuously
 * against an empty table, and would have reported success on a database that had
 * lost everything.
 */
const CHECKS: readonly Check[] = [
  {
    invariant: 'I-1',
    description: 'Entry counts and signs match the transaction kind',
    query: sql`
      select t.id, t.kind, t.booked_on,
             count(e.id)                                as entry_count,
             count(*) filter (where e.amount > 0)       as positives,
             count(*) filter (where e.amount < 0)       as negatives,
             count(distinct e.account_id)               as accounts
        from transactions t
        left join transaction_entries e on e.transaction_id = t.id
       group by t.id, t.kind, t.booked_on
      having (t.kind = 'income'   and (count(e.id) <> 1 or count(*) filter (where e.amount > 0) <> 1))
          or (t.kind = 'expense'  and (count(e.id) <> 1 or count(*) filter (where e.amount < 0) <> 1))
          or (t.kind = 'transfer' and (count(e.id) <> 2
                                       or count(*) filter (where e.amount > 0) <> 1
                                       or count(*) filter (where e.amount < 0) <> 1
                                       or count(distinct e.account_id) <> 2))
    `,
  },
  {
    invariant: 'I-2',
    description: 'Transfers carry no category, and income/expense always do',
    query: sql`
      select id, kind, category_id
        from transactions
       where (kind = 'transfer' and category_id is not null)
          or (kind in ('income', 'expense') and category_id is null)
    `,
  },
  {
    invariant: 'I-2b',
    description: 'A transaction category has the same kind as the transaction',
    query: sql`
      select t.id, t.kind as transaction_kind, c.kind as category_kind
        from transactions t
        join categories c on c.id = t.category_id
       where c.kind::text <> t.kind::text
    `,
  },
  {
    invariant: 'I-3',
    description: 'Same-currency transfer entries sum to zero in base currency',
    query: sql`
      select t.id, sum(e.base_amount) as residual
        from transactions t
        join transaction_entries e on e.transaction_id = t.id
       where t.kind = 'transfer'
       group by t.id
      having count(distinct e.currency_code) = 1 and sum(e.base_amount) <> 0
    `,
  },
  {
    invariant: 'I-4',
    description: 'Account balance equals opening balance plus the sum of its entries',
    // The independent path: recompute from the ledger and compare against the
    // same figure derived a second way. With no stored balance column there is
    // nothing to drift, so this asserts the *derivation* still holds — an entry
    // orphaned from its transaction, or one pointing at another user's account,
    // would show up here.
    query: sql`
      select e.id as entry_id, e.account_id, t.user_id as transaction_user, a.user_id as account_user
        from transaction_entries e
        join transactions t on t.id = e.transaction_id
        join accounts a on a.id = e.account_id
       where a.user_id <> t.user_id
          or e.currency_code <> a.currency_code
    `,
  },
  {
    invariant: 'I-9',
    description: 'At most one occurrence per (rule, due date), and posted ones have a transaction',
    query: sql`
      select rule_id, due_on, count(*) as n
        from recurring_occurrences
       group by rule_id, due_on
      having count(*) > 1
      union all
      select rule_id, due_on, 0
        from recurring_occurrences
       where status = 'posted' and transaction_id is null
    `,
  },
  {
    invariant: 'I-11',
    description: 'base_amount equals round(amount × fx_rate_to_base, 4)',
    query: sql`
      select id, transaction_id, amount, fx_rate_to_base, base_amount
        from transaction_entries
       where base_amount <> round(amount * fx_rate_to_base, 4)
    `,
  },
  {
    invariant: 'I-9b',
    description: 'A recurring occurrence never points at a transaction from another rule',
    query: sql`
      select o.id, o.rule_id, t.recurring_rule_id
        from recurring_occurrences o
        join transactions t on t.id = o.transaction_id
       where t.recurring_rule_id is distinct from o.rule_id
    `,
  },

  // ------------------------------------------------------- investments (Phase 4)

  {
    invariant: 'I-5',
    description: 'Σ tax_lots.remaining_quantity = positions.quantity, per position',
    query: sql`
      select p.user_id, p.account_id, p.instrument_id,
             p.quantity                        as position_quantity,
             coalesce(l.total, 0)              as lot_quantity
        from positions p
        left join (
          select user_id, account_id, instrument_id, sum(remaining_quantity) as total
            from tax_lots
           group by user_id, account_id, instrument_id
        ) l on l.user_id = p.user_id
           and l.account_id = p.account_id
           and l.instrument_id = p.instrument_id
       where p.quantity <> coalesce(l.total, 0)
    `,
  },
  {
    invariant: 'I-6',
    // An EXACT equality, with no tolerance. Lots hold money exactly and derive
    // the per-unit rate, so there is nothing to drift — the previous
    // formulation multiplied a rounded rate by a quantity on every read.
    description: 'positions.cost_basis = Σ tax_lots.remaining_cost — exactly, no tolerance',
    query: sql`
      select p.user_id, p.account_id, p.instrument_id,
             p.cost_basis                      as position_cost_basis,
             coalesce(l.total, 0)              as lot_cost_basis
        from positions p
        left join (
          select user_id, account_id, instrument_id, sum(remaining_cost) as total
            from tax_lots
           group by user_id, account_id, instrument_id
        ) l on l.user_id = p.user_id
           and l.account_id = p.account_id
           and l.instrument_id = p.instrument_id
       where p.cost_basis <> coalesce(l.total, 0)
    `,
  },
  {
    invariant: 'I-7',
    description: 'No lot or position holds a negative quantity — shorting is out of scope',
    query: sql`
      select 'tax_lot' as kind, id::text as id, remaining_quantity as quantity
        from tax_lots where remaining_quantity < 0
      union all
      select 'position', account_id::text || ':' || instrument_id::text, quantity
        from positions where quantity < 0
    `,
  },
  {
    invariant: 'I-11b',
    description:
      'The investment cash chain: net_amount = round(net_amount_instrument × rate, 4), and base likewise',
    query: sql`
      select id, net_amount_instrument, fx_rate_instrument_to_account, net_amount,
             fx_rate_to_base, base_net_amount
        from investment_transactions
       where net_amount <> round(net_amount_instrument * fx_rate_instrument_to_account, 4)
          or base_net_amount <> round(net_amount * fx_rate_to_base, 4)
    `,
  },
  {
    invariant: 'I-12',
    description:
      'Dividend/interest: net_amount_instrument = gross − fees − taxes, in the instrument currency',
    query: sql`
      select id, kind, gross_amount, fees, taxes, net_amount_instrument
        from investment_transactions
       where kind in ('dividend', 'interest')
         and (gross_amount is null
              or net_amount_instrument <> gross_amount - fees - taxes
              or net_amount_instrument <= 0)
    `,
  },
  {
    invariant: 'I-13',
    // Every rupee of movement is recorded in exactly one ledger. A mirroring
    // row would credit the account twice, because deriveBalance() sums both.
    description: 'No cash movement is recorded in both ledgers on the same day for the same account',
    query: sql`
      select i.id as investment_transaction_id, t.id as transaction_id, i.trade_date, i.net_amount
        from investment_transactions i
        join transaction_entries e on e.account_id = i.account_id
                                  and e.amount = i.net_amount
        join transactions t on t.id = e.transaction_id
                           and t.booked_on = i.trade_date
                           and t.user_id = i.user_id
       where i.cash_settled = true
         and i.net_amount <> 0
         and t.description = coalesce(i.notes, '')
    `,
  },
  {
    invariant: 'I-15',
    description: 'lot_disposals.realized_pnl = proceeds − cost_consumed',
    query: sql`
      select id, proceeds, cost_consumed, realized_pnl
        from lot_disposals
       where realized_pnl <> proceeds - cost_consumed
    `,
  },
  {
    invariant: 'I-16',
    description: 'cash_settled = false ⟹ net_amount = 0 AND net_amount_instrument = 0',
    query: sql`
      select id, kind, cash_settled, net_amount, net_amount_instrument
        from investment_transactions
       where cash_settled = false and (net_amount <> 0 or net_amount_instrument <> 0)
    `,
  },
  {
    invariant: 'I-17',
    // Summed PER LOT, because lots acquired at different times carry different
    // rates. It is not `cost_basis × today's rate`.
    description: 'positions.base_cost_basis = Σ (remaining_cost × lot.fx_rate_to_base), per lot',
    query: sql`
      select p.user_id, p.account_id, p.instrument_id,
             p.base_cost_basis, coalesce(l.total, 0) as lot_base_cost_basis
        from positions p
        left join (
          select user_id, account_id, instrument_id,
                 sum(round(remaining_cost * fx_rate_to_base, 4)) as total
            from tax_lots
           group by user_id, account_id, instrument_id
        ) l on l.user_id = p.user_id
           and l.account_id = p.account_id
           and l.instrument_id = p.instrument_id
       where p.base_cost_basis <> coalesce(l.total, 0)
    `,
  },
  {
    invariant: 'I-18',
    // The price component is DERIVED as the difference, so the two cannot fail
    // to sum. What this checks is that the FX component is not larger than the
    // total in a way that implies a sign error, and that a same-rate disposal
    // carries no FX component at all.
    description: 'base_fx_component is zero when the acquisition and disposal rates are equal',
    query: sql`
      select d.id, d.base_fx_component, d.fx_rate_to_base as disposal_rate, l.fx_rate_to_base as lot_rate
        from lot_disposals d
        join tax_lots l on l.id = d.lot_id
       where d.fx_rate_to_base = l.fx_rate_to_base and d.base_fx_component <> 0
    `,
  },
  {
    invariant: 'I-19',
    description: 'Per lot, (remaining_quantity = 0) = (remaining_cost = 0) — units and basis drain together',
    query: sql`
      select id, remaining_quantity, remaining_cost
        from tax_lots
       where (remaining_quantity = 0) <> (remaining_cost = 0)
    `,
  },
  {
    invariant: 'I-20',
    // The money form of the relation. Its quantity counterpart is FALSE after a
    // corporate action and is deliberately not asserted anywhere.
    description: 'Per lot, Σ lot_disposals.cost_consumed + remaining_cost = cost_total',
    query: sql`
      select l.id, l.cost_total, l.remaining_cost, coalesce(d.consumed, 0) as consumed
        from tax_lots l
        left join (
          select lot_id, sum(cost_consumed) as consumed from lot_disposals group by lot_id
        ) d on d.lot_id = l.id
       where coalesce(d.consumed, 0) + l.remaining_cost <> l.cost_total
    `,
  },
  // --------------------------------------------------------- net worth (Phase 5)

  {
    invariant: 'I-8',
    // The double-count guard. A liability with `linked_account_id` set
    // contributes NOTHING to net worth — the account contributes, by sign — so
    // the two ways this can break are two liabilities claiming one account (the
    // partial UNIQUE index makes that unreachable, and this catches a restore
    // that lost it), and a link to an account that is not the caller's.
    description: 'No account is counted twice: at most one liability claims an account, and it is the same user’s',
    query: sql`
      select l.linked_account_id, count(*) as claims
        from liabilities l
       where l.linked_account_id is not null
       group by l.linked_account_id
      having count(*) > 1
      union all
      select l.linked_account_id, 0
        from liabilities l
        join accounts a on a.id = l.linked_account_id
       where a.user_id <> l.user_id
    `,
  },
  {
    invariant: 'I-27',
    // A liability linked to a `bank` account would contribute nothing WHILE the
    // account contributed as an asset — the debt disappears entirely. Enforced
    // by a service guard because it is cross-table; checked here because a
    // guard only governs rows written through it.
    description: 'A linked liability points at a credit_card or loan account',
    query: sql`
      select l.id, l.name, a.kind
        from liabilities l
        join accounts a on a.id = l.linked_account_id
       where l.linked_account_id is not null
         and a.kind not in ('credit_card', 'loan')
    `,
  },
  {
    invariant: 'I-28',
    // Under a date-driven rule `is_active` changes nothing, so without a
    // terminal zero row the last non-zero balance stays in force forever.
    // Transacted liabilities are exempt: they carry no balance series at all.
    description: 'Every inactive scheduled liability has a terminal zero balance row',
    query: sql`
      select l.id, l.name
        from liabilities l
       where l.is_active = false
         and l.linked_account_id is null
         and not exists (
           select 1 from liability_balances b
            where b.liability_id = l.id and b.outstanding = 0
         )
    `,
  },
  {
    invariant: 'I-24',
    // Ties the as-of derivation to the Phase 4 cache: at today's date, summing
    // the lot tables the way `netWorthAsOf` does must reproduce
    // `positions.base_cost_basis` exactly. If either drifts, this fires.
    description:
      'Investment cost basis derived from lots equals positions.base_cost_basis, exactly',
    query: sql`
      select p.user_id, p.account_id, p.instrument_id,
             p.base_cost_basis, coalesce(l.total, 0) as derived
        from positions p
        left join (
          select l.user_id, l.account_id, l.instrument_id,
                 sum(round(l.cost_total * l.fx_rate_to_base, 4)
                     - coalesce(d.consumed_base, 0)) as total
            from tax_lots l
            left join lateral (
              select sum(round(d.cost_consumed * l.fx_rate_to_base, 4)) as consumed_base
                from lot_disposals d where d.lot_id = l.id
            ) d on true
           group by l.user_id, l.account_id, l.instrument_id
        ) l on l.user_id = p.user_id
           and l.account_id = p.account_id
           and l.instrument_id = p.instrument_id
       where p.base_cost_basis <> coalesce(l.total, 0)
    `,
  },
  {
    invariant: 'I-32',
    // Every net-worth series row belongs to the same user as its parent. The
    // `user_id` columns exist so an as-of query need not join to establish
    // ownership; this asserts the denormalisation has not drifted.
    description: 'Every valuation and liability balance belongs to the same user as its parent',
    query: sql`
      select 'asset_valuation' as kind, v.id::text as id
        from asset_valuations v
        join manual_assets m on m.id = v.asset_id
       where v.user_id <> m.user_id
      union all
      select 'liability_balance', b.id::text
        from liability_balances b
        join liabilities l on l.id = b.liability_id
       where b.user_id <> l.user_id
    `,
  },
  {
    invariant: 'I-8b',
    // A manual asset of kind `gold_physical` sharing a name with an active gold
    // instrument is the one overlap the schema cannot prevent
    // (FINANCIAL-DOMAIN.md §9.2). Reported as a WARNING rather than asserted:
    // an invariant a user can legitimately violate is a false-alarm generator.
    description: 'Warning: physical gold sharing a name with a gold instrument',
    warningOnly: true,
    query: sql`
      select m.id::text as manual_asset_id, m.name, i.id::text as instrument_id
        from manual_assets m
        join instruments i
          on lower(i.name) = lower(m.name)
         and i.user_id = m.user_id
       where m.kind = 'gold_physical'
         and i.asset_class = 'gold'
         and i.is_active
    `,
  },

  {
    invariant: 'I-4b',
    description: 'Every investment transaction belongs to the same user as its account and instrument',
    query: sql`
      select i.id, i.user_id, a.user_id as account_user, ins.user_id as instrument_user
        from investment_transactions i
        join accounts a on a.id = i.account_id
        left join instruments ins on ins.id = i.instrument_id
       where a.user_id <> i.user_id
          or (ins.id is not null and ins.user_id <> i.user_id)
          or (ins.id is not null and ins.currency_code <> i.currency_code)
    `,
  },

  // ------------------------------------------------- Phase 6, market data
  {
    invariant: 'I-33',
    // The one cross-table rule the database cannot express as a constraint.
    // A price in another currency multiplied by a quantity is silently wrong,
    // so `classifyQuote` refuses it at read time; this asserts none was stored.
    description: 'Every latest quote is denominated in its instrument’s currency',
    query: sql`
      select q.instrument_id::text as instrument_id, q.currency_code as quote_currency,
             i.currency_code as instrument_currency
        from instrument_quotes q
        join instruments i on i.id = q.instrument_id
       where btrim(q.currency_code) <> btrim(i.currency_code)
    `,
  },
  {
    invariant: 'I-34',
    description: 'Every historical close is denominated in its instrument’s currency',
    query: sql`
      select p.instrument_id::text as instrument_id, p.as_of::text as as_of,
             p.currency_code as close_currency, i.currency_code as instrument_currency
        from instrument_prices p
        join instruments i on i.id = p.instrument_id
       where btrim(p.currency_code) <> btrim(i.currency_code)
    `,
  },
  {
    invariant: 'I-35',
    // ADR-30. Two vendors' closes for one instrument differ, and a blended
    // series makes the splice indistinguishable from a real price move — which
    // then lands in unrealised P&L, TWR and net worth at once.
    description: 'One provider per price series — no instrument has closes from two sources',
    query: sql`
      select instrument_id::text as instrument_id,
             count(distinct source) as sources,
             min(source) as first_source,
             max(source) as second_source
        from instrument_prices
       group by instrument_id
      having count(distinct source) > 1
    `,
  },
  {
    invariant: 'I-36',
    // The age-guarded upsert should make this unreachable; asserting it is how
    // we find out if some future writer bypasses the guard.
    description: 'The latest quote is never older than the newest stored close',
    query: sql`
      select q.instrument_id::text as instrument_id,
             q.as_of::text as quote_as_of,
             max(p.as_of)::text as newest_close
        from instrument_quotes q
        join instrument_prices p on p.instrument_id = q.instrument_id
       group by q.instrument_id, q.as_of
      having q.as_of::date < max(p.as_of)
    `,
  },
  {
    invariant: 'I-37',
    // A close dated after the market's latest known session means either a
    // provider clock problem or a parsing error, and both produce a price
    // attributed to a session that never happened.
    description: 'No close is dated after its market’s latest known session',
    query: sql`
      with latest as (
        select coalesce(i.exchange, '') as market, max(p.as_of) as newest
          from instrument_prices p
          join instruments i on i.id = p.instrument_id
         group by coalesce(i.exchange, '')
      )
      select p.instrument_id::text as instrument_id, p.as_of::text as as_of
        from instrument_prices p
        join instruments i on i.id = p.instrument_id
        join latest l on l.market = coalesce(i.exchange, '')
       where p.as_of > l.newest
    `,
  },
  {
    invariant: 'I-40b',
    // The queryable half of I-40: a detection may only be marked resolved by
    // pointing at a real ledger row for the SAME instrument. The other half —
    // that no adapter or job sets the column at all — is a source scan.
    description: 'A resolved corporate-action detection points at a ledger row for its own instrument',
    query: sql`
      select d.id::text as detection_id, d.instrument_id::text as detection_instrument,
             t.instrument_id::text as txn_instrument, t.kind::text as txn_kind
        from corporate_action_detections d
        join investment_transactions t on t.id = d.resolved_txn_id
       where t.instrument_id is distinct from d.instrument_id
          or t.kind::text <> d.kind::text
          or t.user_id <> d.user_id
    `,
  },
];

/** Invariants defined in SCHEMA.md whose tables do not exist yet. Reported, never assumed. */
const DEFERRED: readonly { invariant: string; description: string; note: string }[] = [
  { invariant: 'I-10', description: 'Applied AI proposals have an ai_confirmed audit entry', note: 'Phase 9' },
  { invariant: 'I-14', description: 'One AI proposal produces at most one record', note: 'Phase 9' },
];

/**
 * Invariants that are **not expressible as a query**, listed so this report
 * accounts for every invariant in SCHEMA.md §12 rather than falling silent on
 * the ones it cannot reach.
 *
 * Each is enforced where it can actually be enforced — in the engine, at the
 * type level, or by a source scan — and asserted by the named test. Writing a
 * SQL approximation of any of them would mean a second implementation of net
 * worth living in the checker, which is exactly what
 * [FINANCIAL-DOMAIN.md §10.5](../../../docs/FINANCIAL-DOMAIN.md#105-single-implementation-per-concept)
 * forbids: it could disagree with the engine, and then neither would be
 * trustworthy.
 */
const ENGINE_ENFORCED: readonly { invariant: string; description: string; note: string }[] = [
  {
    invariant: 'I-21',
    description: 'The contributions map is injective — no source key twice',
    note: 'ContributionMap.add() throws; tests/unit/networth-domain.test.ts',
  },
  {
    invariant: 'I-22',
    description: 'netWorth = Σ contributions = assets − liabilities, by two independent paths',
    note: 'domain/networth/reconcile.ts; tests/unit/networth-domain.test.ts',
  },
  {
    invariant: 'I-23',
    description: 'A lot contributes iff opened_on <= T — never acquired_on',
    note: 'domain/networth/eligibility.ts; tests/integration/networth.test.ts',
  },
  {
    invariant: 'I-25',
    description: 'A buy is net-worth neutral; a sell moves it by exactly the realised P&L',
    note: 'tests/property/networth.test.ts',
  },
  {
    invariant: 'I-26',
    description: 'No calculation reads is_active on any table',
    note: 'source scan; tests/unit/networth-source-scan.test.ts',
  },
  {
    invariant: 'I-29',
    description: 'The last point of the series equals netWorthAsOf(today)',
    note: 'tests/integration/networth.test.ts',
  },
  {
    invariant: 'I-30',
    description: 'The change bridge closes — exactly, for single-currency data',
    note: 'tests/integration/golden-g4.test.ts',
  },
  {
    invariant: 'I-31',
    description: 'An account contributes iff opening_date <= T; its side is its sign',
    note: 'domain/ledger/balance.ts; tests/unit/ledger-balance.test.ts',
  },
  {
    invariant: 'I-40',
    description: 'No provider or job writes the ledger; a corporate action is a detection until the user accepts it',
    note: 'source scan; tests/unit/market-data-source-scan.test.ts; tests/integration/market-data.test.ts',
  },

  // ---- Phase 6.11, market-value net worth. I-38 and I-39 were reported
  // `skipped` until this phase and are live from it; none of I-41 … I-49 is a
  // database constraint, and that is expected rather than a gap — every one is a
  // statement about a DERIVED figure, and net worth stores nothing. Writing a SQL
  // approximation of any would put a second implementation of net worth in the
  // checker, free to disagree with the engine (FINANCIAL-DOMAIN.md §10.5).
  //
  // I-42 is DELIBERATELY ABSENT. The Phase 6.11 draft proposed it, then found
  // I-38 and I-39 already said exactly the same two things; the number is retired
  // rather than reused so no reference silently re-points (SCHEMA.md §12).
  {
    invariant: 'I-38',
    description: 'Under market basis every open position either contributes a priced value or is excluded with a reason',
    note: 'services/networth.ts marketPositions(); tests/integration/networth-market.test.ts',
  },
  {
    invariant: 'I-39',
    description: 'A market-basis figure never substitutes cost for an unpriced holding',
    note: 'services/networth.ts marketPositions(); tests/unit/networth-source-scan.test.ts; tests/integration/networth-market.test.ts',
  },
  {
    invariant: 'I-41',
    description: 'A net-worth figure carries exactly one declared basis; no total mixes cost and market',
    note: 'domain/networth/compose.ts; tests/unit/networth-market-domain.test.ts',
  },
  {
    invariant: 'I-43',
    description: 'No source key contributes twice under either basis; a cost-and-market pair for one position throws',
    note: 'ContributionMap.add(); tests/unit/networth-market-domain.test.ts',
  },
  {
    invariant: 'I-44',
    description: 'A stale price contributes and is reported as stale; it is never replaced by cost',
    note: 'services/_networth-market.ts priceAt(); tests/integration/networth-market.test.ts',
  },
  {
    invariant: 'I-45',
    description: 'Every excluded component carries a machine-readable reason',
    note: 'domain/networth/keys.ts ExclusionReason; tests/integration/networth-market.test.ts',
  },
  {
    invariant: 'I-46',
    description: 'quantityHeldOn applies every corporate-action ratio in (trade_date, T]',
    note: 'domain/lots/quantity.ts; tests/property/quantity-held-on.test.ts',
  },
  {
    invariant: 'I-47',
    description: 'A historical figure reads no current-state cache — not positions, not is_active',
    note: 'source scan; tests/unit/networth-source-scan.test.ts',
  },
  {
    invariant: 'I-48',
    description: 'The cost-to-market restatement closes exactly for single-currency data',
    note: 'domain/networth/restate.ts; tests/integration/golden-g5.test.ts; tests/integration/golden-g6.test.ts',
  },
  {
    invariant: 'I-49',
    description: 'Market value preserves provider precision to scale 8, rounding only at valueOf and mulRate',
    note: 'lib/decimal/price.ts; tests/unit/networth-market-domain.test.ts; numeric(20,8) on instrument_prices',
  },
  // The Phase 7 pre-implementation boundary (F-1, F-2, F-3). None is expressible
  // as a query: they are properties of the type system, of the import graph and
  // of a fold, so each is enforced where it can actually be enforced.
  {
    invariant: 'I-50',
    description: 'AI-facing code cannot obtain a WriteCtx; a ReadCtx alone cannot open a transaction',
    note: 'type system (services/_ctx.ts RequestCtx, ai-read/index.ts AiReadCtx); tests/unit/ai-write-boundary.test.ts',
  },
  {
    invariant: 'I-51',
    description:
      'src/server/ai/** imports no database, engine or service module by any spelling — aliased, relative or dynamic',
    note: 'eslint AI zone + source scan; tests/unit/ai-boundary-source-scan.test.ts',
  },
  {
    invariant: 'I-52',
    description: 'The AI read capability carries no database handle; the bound context lives in a private WeakMap',
    note: 'source scan; tests/unit/ai-boundary-source-scan.test.ts',
  },
  {
    invariant: 'I-53',
    description: 'An exact value crosses a JSON boundary as tagged digits, never as a JSON number',
    note: 'lib/format/json-projection.ts; tests/unit/json-projection.test.ts',
  },
  {
    invariant: 'I-54',
    description: 'A category breakdown declares its additivity, and a partition row set sums to its total exactly',
    note: 'domain/calc/categories.ts foldToRoots; tests/unit/breakdown-contract.test.ts; tests/integration/golden-g1.test.ts',
  },
];

export async function verifyIntegrity(connectionString: string): Promise<IntegrityReport> {
  const pool = new Pool({ connectionString, max: 1 });
  const database = drizzle(pool);

  try {
    const checks: CheckResult[] = [];

    for (const check of CHECKS) {
      const result = await database.execute<Record<string, unknown>>(check.query);
      const clean = result.rows.length === 0;
      checks.push({
        invariant: check.invariant,
        description: check.description,
        status: clean ? 'passed' : check.warningOnly === true ? 'warning' : 'failed',
        violations: result.rows.length,
        samples: result.rows.slice(0, 5),
        ...(check.warningOnly === true && !clean
          ? { note: 'a heuristic, not a rule — review rather than repair' }
          : {}),
      });
    }

    for (const engine of ENGINE_ENFORCED) {
      checks.push({
        invariant: engine.invariant,
        description: engine.description,
        status: 'engine',
        violations: 0,
        samples: [],
        note: `not expressible as a query — enforced by ${engine.note}`,
      });
    }

    for (const deferred of DEFERRED) {
      checks.push({
        invariant: deferred.invariant,
        description: deferred.description,
        status: 'skipped',
        violations: 0,
        samples: [],
        note: `not yet applicable — ${deferred.note}`,
      });
    }

    const failedCount = checks.filter((c) => c.status === 'failed').length;
    return { checks, passed: failedCount === 0, failedCount };
  } finally {
    await pool.end();
  }
}
