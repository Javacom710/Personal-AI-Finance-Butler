# Financial Domain Model

Everything in this document is deterministic application code. No model output participates in any calculation described here.

## 0. Entities owned by this domain

Table definitions live in [SCHEMA.md](SCHEMA.md); the **rules** live here. Every table below is owned by the money domain — if a rule about it is not in this document, it is not written down anywhere.

| Entity | Table(s) | Stored or derived | Lifecycle | Rules |
|---|---|---|---|---|
| Currency | `currencies` | stored (seed) | seeded, not user-editable | [§1](#1-money-and-exact-arithmetic) |
| FX rate | `fx_rates` | stored (fetched) | insert-only per `(pair, as_of)`; never updated in place | [§2](#2-fx) |
| Account | `accounts` | stored | create → active → inactive; never deleted while referenced | [§3](#3-accounts) |
| **Balance** | — | **derived** | computed on every read; no column exists | [§3](#3-accounts) |
| Category | `categories` | stored | create → archive; delete blocked while in use | [§5](#5-categories-and-tags) |
| Tag | `tags`, `transaction_tags` | stored | created on first use → rename / merge / delete freely | [§5](#5-categories-and-tags) |
| Transaction | `transactions` | **stored — source of truth** | create → edit → hard delete, all audited | [§4](#4-transactions) |
| Transaction entry | `transaction_entries` | **stored — source of truth** | owned by its header; cascades with it | [§4](#4-transactions) |
| Budget | `budgets` | stored | create → deactivate; one active per (category, period) | [§6](#6-budgets) |
| Recurring rule | `recurring_rules` | stored | create → active → inactive | [§7](#7-recurring-transactions) |
| Recurring occurrence | `recurring_occurrences` | stored (idempotency key) | `pending` → `posted` \| `skipped` | [§7](#7-recurring-transactions) |
| Manual asset | `manual_assets` | stored | create → revalue → dispose | [§9.4](#94-asset-and-liability-lifecycle) |
| Asset valuation | `asset_valuations` | stored, append-only series | insert only; never updated | [§9.4](#94-asset-and-liability-lifecycle) |
| Liability | `liabilities` | stored | create → repay → close | [§9.4](#94-asset-and-liability-lifecycle) |
| Liability balance | `liability_balances` | stored, append-only series | insert only; never updated | [§9.4](#94-asset-and-liability-lifecycle) |
| Net-worth snapshot | `net_worth_snapshots` | **derived cache** | nightly job; deletable and rebuildable | [§9](#9-net-worth) |
| Ledger version | `user_state` | stored counters | bumped inside every ledger mutation | [§4](#4-transactions) |
| Settings | `settings` | stored | user-editable | — |
| Audit entry | `audit_log` | stored, append-only | insert only; no update/delete grant | — |

**Owned elsewhere** — do not add rules for these here: `users` / `sessions` / `auth_events` → [SECURITY.md](SECURITY.md); `instruments`, `investment_transactions`, `tax_lots`, `lot_disposals`, `positions`, `instrument_prices`, `instrument_quotes` → [INVESTMENT-DOMAIN.md](INVESTMENT-DOMAIN.md); `ai_*` → [AI-SYSTEM.md](AI-SYSTEM.md); `jobs` → [ARCHITECTURE.md](ARCHITECTURE.md).

**One money figure per event.** `transactions` — the header — carries **no amount column at all**. Every rupee lives in `transaction_entries.amount`. A header and its entries therefore cannot disagree, because the header holds no number to disagree with.

The one stored derivation is `transaction_entries.base_amount` (= `amount × fx_rate_to_base`, [ADR-12](DECISIONS.md#adr-12--base-currency-with-dated-fx-stored-alongside-native-amounts)). It is guarded by a database `CHECK` and by invariant I-11 — without that guard it would be a second money figure free to drift from the first.

**Three entities are stored source-of-truth: `transactions`, `transaction_entries`, and the append-only valuation series.** Everything else that carries a money figure is either declared once at creation (`accounts.opening_balance`, `budgets.amount`) or derived. This is the concrete form of *ledger transactions are source, balances are derived*.

## 1. Money and exact arithmetic

`src/lib/decimal/` — no external dependency ([ADR-04](DECISIONS.md#adr-04--money-is-an-exact-scaled-integer-never-a-float)).

```ts
const MONEY_SCALE = 4;     // 4 decimal places, all currencies
const QTY_SCALE   = 8;
const RATE_SCALE  = 10;

type CurrencyCode = string & { readonly __brand: 'CurrencyCode' };

interface Money    { readonly minor: bigint; readonly currency: CurrencyCode }  // scale 4
interface Quantity { readonly units: bigint }                                    // scale 8
interface Rate     { readonly value: bigint }                                    // scale 10
```

### API surface

```ts
// construction — the only ways to make a Money
Money.fromDbString(s: string, c: CurrencyCode): Money   // "1234.5000" from NUMERIC(20,4)
Money.fromMinor(minor: bigint, c: CurrencyCode): Money
Money.parseUserInput(s: string, c: CurrencyCode): Result<Money, ParseError>
Money.zero(c: CurrencyCode): Money

// arithmetic — same-currency only; mixing currencies throws
add(a, b), sub(a, b), neg(a), abs(a)
sum(items: Money[], c: CurrencyCode): Money            // empty array → zero(c), never throws
mulQty(m: Money, q: Quantity, rounding: Rounding): Money
mulRate(m: Money, r: Rate, rounding: Rounding): Money
divInt(m: Money, n: number, rounding: Rounding): Money
allocate(m: Money, weights: bigint[]): Money[]         // exact split, remainder distributed

// comparison
cmp(a, b): -1 | 0 | 1;  isZero(m); isNegative(m); eq(a, b)

// output
toDbString(m): string        // "1234.5000"
toMinorNumber(m): number     // ONLY for solver input; throws above Number.MAX_SAFE_INTEGER
```

### Rules

- **MUST NOT** use `number` for any monetary value outside a numeric solver.
- Every operation that can lose precision (`mulQty`, `mulRate`, `divInt`) takes an explicit `Rounding` argument. There is no default. `Rounding` is `'half_up' | 'half_even' | 'floor' | 'ceil'`; the domain default written at each call site is `'half_up'` unless stated otherwise.
- Adding two `Money` of different currencies **throws** (a programming error, not a domain error). Cross-currency work goes through the FX module explicitly.
- `allocate` distributes a remainder deterministically (largest-remainder, then by index) so splitting ₹100 three ways gives 33.3334 / 33.3333 / 33.3333 and sums back exactly.
- `sum([])` returns zero rather than throwing — empty periods are normal.

### Formatting

`src/lib/format/` reads `currencies.minor_units` and `settings.locale` and is display-only. It never round-trips: a formatted string is never parsed back into a `Money`.

## 2. FX

```ts
interface FxLookup {
  rate(base: CurrencyCode, quote: CurrencyCode, on: Date): Result<Rate, 'no_rate'>;
  convert(m: Money, to: CurrencyCode, on: Date): Result<Money, 'no_rate'>;
}
```

- Lookup: exact `as_of` match → else the most recent earlier date → else `no_rate`. **Never** interpolate or use a later rate for an earlier date; that would make historical figures change as new rates arrive.
- Identity: `rate(X, X, _) = 1` without a table lookup.
- Inverse: if `(base, quote)` is missing but `(quote, base)` exists, use `1 / rate` computed at `RATE_SCALE` with `half_even`. This is recorded in the result so audit can see it was derived.
- Every stored transaction captures the rate it used ([ADR-12](DECISIONS.md#adr-12--base-currency-with-dated-fx-stored-alongside-native-amounts)). Recomputing history uses the stored rate, not a fresh lookup, unless the user explicitly triggers an FX re-derivation.

## 3. Accounts

### Balance — the ledger is the source, the balance is derived

> **Ledger transactions are source. Balances are derived.**
>
> Always computed, never stored, never edited.

There is no `accounts.current_balance` column, and there never will be. A stored balance is a second source of truth that silently diverges from the ledger the first time a write is retried, a transaction is edited, or two paths update it in a different order. Every reconciliation bug in this class of software traces back to a cached balance somebody trusted.

```
balance(account, asOf?) =
    opening_balance                     -- the ONLY stored money figure on an account
  + Σ transaction_entries.amount         where account_id = account AND booked_on   <= asOf
  + Σ investment_transactions.net_amount where account_id = account AND trade_date <= asOf
```

`opening_balance` is not an exception to the rule: it is the declared position *before* the ledger begins, not a running total. Nothing updates it after creation.

Consequences that follow, and are relied on elsewhere:

- **Correcting history is a normal operation.** Edit a transaction dated last March and every balance from March onward is correct on the next read. No backfill job, no repair script.
- **`asOf` is free.** A historical balance is the same query with a different bound — which is what makes point-in-time net worth ([§9](#9-net-worth)) and the change bridge possible at all.
- **Auditability holds.** Any balance can be explained by listing the rows that produced it.
- **The same rule governs investments.** `positions` is a *cache* of a ledger replay, not a record ([ADR-06](DECISIONS.md#adr-06--holdings-are-derived-cached-and-rebuildable)). It is deletable and rebuildable at any moment; deleting a stored balance would be data loss.

One pure function, `deriveBalance()`, in `src/server/domain/ledger/balance.ts`, fed by a repository query. Nothing else computes a balance — the UI, the AI tools, the export, and `verify:integrity` all call it, which is why they cannot disagree. Both sums are in the **account's** currency; base-currency conversion happens in the application service above it.

**Where caching would be permitted, and is not yet.** If the summed-entry query becomes slow at scale, the fix is a materialised roll-up keyed by `money_ledger_version` — derived, invalidatable, and rebuildable, exactly like `positions`. Not a mutable column. Measure first ([ARCHITECTURE.md §9](ARCHITECTURE.md#9-performance-targets)).

### Account kinds and net-worth sign

| Kind | Normal sign | Net worth |
|---|---|---|
| `bank`, `cash`, `wallet`, `brokerage` | positive | asset at balance |
| `credit_card`, `loan` | negative | liability at `abs(balance)` |
| `other` | either | asset if ≥ 0, liability if < 0 |

Credit available on a card is `credit_limit - abs(balance)` and is **not** an asset. It is shown on the account row and excluded from every total.

### Closing an account

`is_active = false`. Historical records remain and remain in historical totals. An inactive account with a non-zero balance is flagged on the accounts page — closing an account does not zero it.

## 4. Transactions

### Shape

A `transactions` header plus 1–2 `transaction_entries`. The invariants in [SCHEMA.md §4.1](SCHEMA.md#41-transactions-and-entries-adr-05) are enforced by `assertEntryInvariants()` in `src/server/domain/ledger/` **before** the write, so the user sees a field-level error rather than a constraint violation.

### Creating

`services/transactions.ts` — the application service owns every step except 4 and 5, which are the pure engine ([ADR-21](DECISIONS.md#adr-21--application-services-are-a-distinct-layer-from-the-financial-engine)).

```
createTransaction(ctx, input) →
  1. VALIDATE   Zod parse
  2. AUTHORIZE  resolve account(s) + category; requireOwnership; require active
  3. RESOLVE    FX rate for booked_on for each entry currency → base
  4. ENGINE     buildEntries() — signs derived from `kind`; caller never supplies a sign
  5. ENGINE     assertEntryInvariants()
  6. BEGIN
       INSERT transactions
       INSERT transaction_entries
       INSERT audit_log
       UPDATE user_state SET money_ledger_version = money_ledger_version + 1
     COMMIT
  7. Invalidate: net_worth_snapshots on/after booked_on
```

The caller supplies a positive amount and a `kind`; the engine's `buildEntries()` decides the sign. This removes the single largest class of data-entry bug.

### Transfers

`kind='transfer'`, two entries, no category. Constructed by `createTransfer({ fromAccountId, toAccountId, amount, fromAmount?, toAmount?, bookedOn, description })`.

- **Same currency:** `fromAmount = -amount`, `toAmount = +amount`.
- **Cross currency:** both `fromAmount` and `toAmount` are supplied by the user (the actual debited and credited amounts). The implied rate is stored on each entry. The base-currency residual `toBase + fromBase` is the realised FX gain/loss for that transfer, reported in cash-flow analysis under `fxEffect` and **never** classified as income or expense.
- **Same account on both sides:** rejected.

Transfers are excluded from income, expense, savings, budgets, and category reporting by construction — those queries filter `transactions.kind IN ('income','expense')`.

### Editing and deleting

Edits are in-place with a full `before`/`after` audit entry. Deletes are hard deletes with the full row captured in the audit log — a soft-delete flag would have to be remembered by every aggregate query, which is exactly the failure mode [ADR-05](DECISIONS.md#adr-05--entry-based-ledger-for-cash-movements) exists to avoid. Both bump `money_ledger_version`.

## 5. Categories and tags

Categories and tags are both classification, and they are deliberately different: **a category answers "what kind of money movement is this", exactly one per transaction, and it drives budgets and reporting. A tag answers "what was this for", zero or many per transaction, and it drives nothing but filtering.**

### Categories

- Two levels maximum: parent and child. Deeper nesting is rejected.
- A child's `kind` must match its parent's.
- Category rollup: a parent's total includes its children's. Reporting queries use a recursive CTE over `categories` limited to depth 2.
- A category in use cannot be deleted (`ON DELETE RESTRICT`); it can be archived, which hides it from pickers but keeps it in historical reports.
- Required on `income` and `expense`; **forbidden on `transfer`** ([§4](#4-transactions)).
- Default seed set (editable): Income — Salary, Business, Interest, Dividend, Rental, Other Income. Expense — **Food** (→ Groceries, Dining), Housing (→ Rent, Maintenance), Transport (→ Fuel, Public transport, Cabs), Utilities, Health, Insurance, Education, Shopping, Entertainment, Travel, Personal, Business, Fees & Charges, Taxes, Gifts & Donations, Other.

The parents matter, not just the leaves. `CLAUDE.md`'s own worked example is *"how much did I spend on food in July?"* — if `Groceries` and `Dining` were top-level siblings with no `Food` parent, that question would have no category to resolve to, and answering it would require summing two rows. Summing rows is the model's job only when the engine has failed to provide the total ([AI-SYSTEM.md](AI-SYSTEM.md#the-arithmetic-boundary--every-summary-returns-its-own-total)).

### Tags

Tags attach to the **transaction header**, never to an entry — a transfer's two entries share one tag set, because the tag describes the event, not the leg.

| Rule | Behaviour |
|---|---|
| Cardinality | 0–8 per transaction. The AI proposal schema caps at 5 deliberately — a model inventing eight tags from one sentence is noise, not signal. |
| Creation | Implicit on first use. There is no "manage tags" step before you can use one. |
| Normalisation | Trimmed, internal whitespace collapsed, stored as the user typed it, **matched case-insensitively**. `Travel` and `travel` are one tag. |
| Rename | Free. No referential consequence — `transaction_tags` points at the id. |
| Merge | Renaming onto an existing name is a **merge**, not an error: `transaction_tags` rows are reassigned, duplicates collapsed, the empty tag deleted. One transaction can never hold the same tag twice. |
| Delete | Allowed at any time. Cascades to `transaction_tags` only; transactions are untouched. Unlike categories, which are `RESTRICT`. |
| Hierarchy | None, ever. Tags do not roll up. If you need a hierarchy, you need a category. |
| **Allowed on transfers** | **Yes** — this is the one classification that transfers carry. |

**The consequence of that last row, stated because it is a live footgun.** Categories are structurally absent from transfers, so category reporting cannot leak transfer amounts. Tags are not. Therefore **every tag-grouped aggregate MUST filter `transactions.kind` explicitly.** `get_expense_summary(groupBy: 'tag')` filters `kind='expense'`; a tag report that omitted that filter would silently count transfer legs as spending — precisely the error the entry-based ledger exists to prevent ([ADR-05](DECISIONS.md#adr-05--entry-based-ledger-for-cash-movements)). This is covered by edge case 21 in [§12](#12-edge-cases-that-must-be-covered-by-tests).

**Tags affect nothing else.** They are a reporting dimension only: never income/expense classification, never budgets, never balances, never net worth, never allocation. A tag cannot change a number — only which rows you are looking at.

## 6. Budgets

```
budgetStatus(budget, period) = {
  budgeted:  Money,
  actual:    Money,          // Σ |expense entries| in category subtree ∩ period
  remaining: budgeted - actual,
  utilization: actual / budgeted,      // Rate, 4dp; null when budgeted is zero
  daysElapsed, daysTotal,
  pace: (actual / budgeted) - (daysElapsed / daysTotal)   // >0 = ahead of pace
}
```

- Period boundaries come from `src/lib/date/periods.ts` using `settings.timezone` and `settings.fiscal_year_start_month`. A "monthly" budget runs calendar months; "yearly" runs the fiscal year.
- Only `kind='expense'` transactions count. Transfers and income never do.
- Multi-currency: actuals are summed in `base_amount` and compared against the budget converted to base at the period start rate. The conversion is shown in the UI.
- Over-budget is a state, not an error. Nothing is blocked.

Deliberately not built: envelope budgeting, rollover, zero-based budgeting, goal-linked budgets ([CLAUDE.md §7](../CLAUDE.md) — "avoid complex budgeting methodologies unless explicitly requested").

## 7. Recurring transactions

### Recurrence expansion

`src/lib/date/rrule.ts` implements a deliberately small RFC 5545 subset: `FREQ` ∈ `DAILY|WEEKLY|MONTHLY|YEARLY`, plus `INTERVAL`, `BYMONTHDAY`, `BYDAY`, `COUNT`, `UNTIL`. It is a pure function `expand(rrule, from, to): Date[]`.

Month-end rule: `BYMONTHDAY=31` on a 30-day month falls on the **last day of that month**, not the 1st of the next. `BYMONTHDAY=-1` means last day. This is the behaviour people expect for salary and rent, and it is tested explicitly.

### Posting

A daily `recurring.post` job:

```
for each active rule:
  for each due_on in expand(rule.rrule, last_checked, today + horizon):
    BEGIN
      INSERT INTO recurring_occurrences (rule_id, due_on, status)
        VALUES (..., due_on, 'pending')
        ON CONFLICT (rule_id, due_on) DO NOTHING
      -- if no row was inserted, this occurrence already exists: skip
      if rule.auto_post and due_on <= today:
        create the transaction / investment transaction from rule.template
        UPDATE recurring_occurrences SET status='posted', transaction_id=..., posted_at=now()
    COMMIT
```

The `UNIQUE (rule_id, due_on)` constraint is the correctness mechanism ([ADR-15](DECISIONS.md#adr-15--idempotency-for-recurring-postings-via-a-materialised-occurrence-row)). A retried job, a duplicate cron fire, or a clock adjustment cannot double-post.

`auto_post = false` (the default) creates the occurrence in `pending` and surfaces it on the Money → Recurring page for one-click posting. Amounts that vary (a utility bill) should use `auto_post = false`.

Upcoming commitments on the Overview are `recurring_occurrences` in `pending` status with `due_on` within 14 days, plus a projected cash position after each.

## 8. Cash-flow calculations

All defined over a period `[from, to]` in base currency, from `transaction_entries.base_amount`.

```
income   = Σ base_amount  where kind='income'    (positive)
expenses = Σ -base_amount where kind='expense'   (positive, reported as a magnitude)
netCashFlow = income - expenses
savings     = netCashFlow                        -- identical by definition; one term in the UI
savingsRate = income > 0 ? savings / income : null
fxEffect    = Σ base_amount over transfer entries (non-zero only for cross-currency transfers)
```

Notes:
- `expenses` is reported as a positive magnitude everywhere in the UI. The sign lives in the database, not on the screen.
- `savingsRate` is `null`, not `0`, when income is zero. `null` renders as `—`, never as `0%`.
- **Investment income is not money-domain income by default.** `income` sums `transactions` of kind `income`; a dividend recorded against a tracked instrument lives in `investment_transactions` and is therefore absent from this figure — deliberately, so a ₹500 dividend does not inflate the savings rate as though it were salary. It still raises the brokerage account **balance**, and it is counted in portfolio income and total return.
  Reports that want the combined view take it as an explicit read-time union — `income(period, { includeInvestmentIncome: true })` — never by writing a second row. The net-worth bridge already relies on this: its `Savings` component excludes investment income precisely because `Investment income` is a separate line ([§9](#9-net-worth)).
- Investment purchases are **not** expenses. Money moving from a bank account into a brokerage account is a transfer; buying an instrument inside the brokerage account converts cash into an asset. Neither reduces net worth, and neither appears in `expenses`. Investment **fees** and **taxes** do reduce net worth and are reported separately in portfolio metrics, not in `expenses`, so the two views never double-count.
- Period comparison (`compare_periods`) returns both periods' figures plus absolute and percentage deltas, with `null` percentages when the base period is zero.

## 9. Net worth

### 9.1 The single-counting rule

`CLAUDE.md <net_worth>` names double counting as the hazard, using the exact example that matters: *"an investment held inside an investment account must not accidentally be counted as both an account balance and an investment asset."*

The structural answer is a rule the calculator enforces rather than a convention it hopes for:

> **Every unit of value has exactly one owning source. A source contributes to net worth; a view of that source never does.**

| Value | Owning source | Never also counted as |
|---|---|---|
| Cash in a bank / cash / wallet account | `accounts.balance` | anything |
| **Cash sitting in a brokerage account** | `accounts.balance` for that account | a "cash" holding, an instrument, or an allocation slice of type cash |
| **An instrument held in a brokerage account** | `positions.marketValue` | the brokerage account's balance — buying converts cash to position and the ledger moves both sides |
| Credit-card debt | the card's negative `accounts.balance` | a `liabilities` row (guarded by `linked_account_id`) |
| Loan with transactions flowing through it | the loan account's negative balance | a `liabilities` row |
| Loan tracked only as a schedule | `liability_balances.outstanding` | any account |
| Physical gold | `asset_valuations` | an instrument of class `gold` |
| **Gold ETF / sovereign gold bond** | `positions.marketValue` | a `manual_assets` row |
| Property, vehicle, receivable | `asset_valuations` | anything |

The two rows in bold are where real systems go wrong. A brokerage account holds *both* cash and positions; counting the account balance and the positions is correct **only because a purchase debits the cash balance in the same ledger entry that creates the position**. That coupling is what makes the sum non-overlapping, and it is asserted by invariant I-4.

### 9.2 Enforcement

Three mechanisms, because a rule stated in prose is not a rule:

1. **Structural.** `liabilities.linked_account_id` is `UNIQUE` and nullable. Set → the balance comes from the account and `liability_balances` is ignored entirely. Null → the schedule is authoritative and no account may represent it. Two liabilities cannot claim one account.
2. **Assertion.** `computeNetWorth()` builds an explicit `contributions: Map<SourceKey, Money>` where `SourceKey` is `('account', id) | ('position', accountId, instrumentId) | ('asset', id) | ('liability', id)`. Inserting a duplicate key throws. The final sum is over the map, never over concatenated arrays — so a source counted twice is a crash in development, not a wrong number in production.
3. **Reconciliation.** `verify:integrity` recomputes net worth by an independent path (sum the contribution map vs. sum the category subtotals) and asserts equality, and separately asserts that no `manual_assets` row of kind `gold_physical` shares a name with an active instrument of class `gold` — a heuristic warning for the one overlap the schema cannot prevent.

### 9.3 Calculation

```
assets = Σ balance(a) for active accounts where balance > 0 and kind ∉ {credit_card, loan}
       + Σ marketValue(position) over all positions            -- priced holdings only
       + Σ valuationInForce(asset, asOf) over active manual assets

liabilities = Σ |balance(a)| for accounts of kind credit_card/loan with balance < 0
            + Σ outstanding(liability, asOf) for liabilities with no linked account

netWorth = assets - liabilities
```

All terms converted to base currency using rates in force on `asOf`. The result carries `priceCoverage` — the fraction of position market value that had a usable price. A coverage below 1.0 is displayed; it is never silently rounded away ([ADR-11](DECISIONS.md#adr-11--market-data-behind-a-provider-abstraction-with-an-always-available-manual-provider)).

`valuationInForce(asset, asOf)` = the `asset_valuations` row with the greatest `as_of <= asOf`. If none exists, the asset contributes zero and is listed as unvalued.

### Change attribution

For `[t0, t1]`, the bridge from `netWorth(t0)` to `netWorth(t1)`:

| Component | Definition |
|---|---|
| Savings | `income − expenses` over the period, excluding investment income already counted below |
| Investment gains/losses | `Σ (marketValue(t1) − marketValue(t0) − netContributions)` per position, i.e. price and FX movement on held assets |
| Realised P&L | `Σ lot_disposals.base_realized_pnl` with `closed_on` in the period |
| Investment income | dividends + interest received in the period |
| Investment costs | fees + taxes paid in the period (negative) |
| Asset revaluation | `Σ (valuationInForce(t1) − valuationInForce(t0))` over manual assets held throughout |
| Asset additions/disposals | acquisitions and disposals of manual assets in the period |
| Liability change | `−(liabilities(t1) − liabilities(t0))`, split into principal repaid and new borrowing where an amortisation schedule exists |
| FX effect | revaluation of foreign-currency balances at period-end rates |
| Unexplained | `netWorth(t1) − netWorth(t0) − Σ(above)` |

**`Unexplained` is always computed and always displayed when non-zero beyond a ₹1 tolerance.** A bridge that silently balances is a bridge that is hiding an error. This figure is also asserted to be zero in the golden-scenario tests ([TESTING.md](TESTING.md)).

### 9.4 Asset and liability lifecycle

`manual_assets` and `liabilities` are the two entities that appear only in net worth — they have no ledger of their own. Their rules were previously implied by the calculation; they are stated here.

**Manual assets.** Anything of value that is not an account balance and not an instrument: property, a vehicle, physical gold, a collectible, a receivable.

```
create      manual_assets row + a first asset_valuations row (both required; an asset with
            no valuation contributes zero and is listed as unvalued)
revalue     INSERT a new asset_valuations row. Never UPDATE an existing one — that would
            retroactively rewrite historical net worth.
dispose     is_active = false, plus the sale recorded as ordinary income into an account.
            The asset stops contributing from the disposal date; history is unchanged.
delete      permitted only when the asset has no valuations outside its creation date;
            otherwise archive. Deleting valuation history destroys past net-worth figures.
```

`valuationInForce(asset, asOf)` is the row with the greatest `as_of <= asOf`. **Valuations are a time series, not a field.** This is the same rule as balances: the record is the source, the current value is derived from it by date.

**Liabilities.** Two mutually exclusive shapes, discriminated by `linked_account_id` ([§9.2](#92-enforcement)):

| Shape | `linked_account_id` | Outstanding comes from | Use for |
|---|---|---|---|
| Transacted | set (`UNIQUE`) | the account's negative balance | credit cards, loans whose EMIs flow through an account |
| Scheduled | `NULL` | latest `liability_balances` row `<= asOf` | loans tracked only as a statement figure |

```
create      liabilities row; scheduled shape also needs a first liability_balances row
repay       transacted: an ordinary transfer or expense against the linked account
            scheduled:  INSERT a new liability_balances row. Never UPDATE.
close       is_active = false once outstanding reaches zero. A liability with a non-zero
            outstanding cannot be closed — it is flagged, exactly like an account.
```

`interest_rate`, `emi_amount`, `started_on`, and `ends_on` are **descriptive only at launch**. Nothing computes an amortisation schedule from them; the change bridge splits principal from interest only where the user has recorded both. Deriving a schedule is deferred, and until it exists the fields must not be presented as though the app is tracking the loan for you.

**Neither entity is ever created by the AI without confirmation**, and neither has a delete proposal kind ([AI-SYSTEM.md §9](AI-SYSTEM.md#9-the-mutation-boundary)).

## 10. Calculation engine contract

Every function in `src/server/domain/calc/` and every derivation in the lot engine obeys the same contract. This is what "deterministic financial engine" means concretely.

### 10.1 Purity and determinism

- **Pure where possible.** A calculation takes data and returns a result. `replay()` (lot engine), `xirr()`, `twr()`, `allocation()`, `cashflow()`, `budgetStatus()`, and `netWorthBridge()` take arrays and return values — no database handle, no clock, no I/O.
- **Time is injected.** Functions that need "now" take it as a parameter (`ctx.now`). No `new Date()` inside a calculation. This makes every time-dependent result testable without mocking the global clock.
- **Ordering is total.** Any replay over records uses a total order (`date, created_at, id`), never a partial one. Two records on the same date must sort identically on every run, on every machine.
- **Same inputs → identical bytes out.** Asserted as a property test. This is what makes the derived-and-cached design of [ADR-06](DECISIONS.md#adr-06--holdings-are-derived-cached-and-rebuildable) safe.

### 10.2 Rounding

- Rounding happens **at the boundary of a calculation, never inside an accumulation**. Sum first at full precision, round once.
- Every lossy operation names its scale and mode explicitly; there is no default ([ADR-04](DECISIONS.md#adr-04--money-is-an-exact-scaled-integer-never-a-float)).
- Per-unit values are carried at scale 8, monetary totals at scale 4, rates at scale 10.
- A split of one amount into parts uses `allocate`, which distributes the remainder deterministically so the parts sum back **exactly**. Never `amount / n` applied n times.

### 10.3 Missing data propagates as `null`, never as zero

A metric that cannot be computed returns `null` **with a machine-readable reason**, and the reason travels all the way to the UI and to the AI tool result:

```ts
type Metric<T> = { value: T } | { value: null; reason: MetricUnavailable };

type MetricUnavailable =
  | 'no_data'                      // no records in the period
  | 'divide_by_zero'               // e.g. savings rate with zero income
  | 'no_sign_change'               // XIRR with all-same-sign cash flows
  | 'did_not_converge'             // XIRR solver
  | 'insufficient_price_history'   // TWR
  | 'no_fx_rate'
  | 'no_price';
```

Zero and "unknown" are different financial statements. A portfolio return of 0% means the value did not change; `null` means we cannot say. Rendering `null` as `0` is a correctness defect, and rendering it as `—` with the reason on hover is the required behaviour. Every `null` path has a test that asserts **the reason**, not merely the `null` — a test asserting only `null` would pass against a function that always failed.

### 10.4 Partial results are labelled, not hidden

Where a total is computed over a set with gaps — unpriced holdings, unvalued assets, missing FX — the result carries a coverage figure and the identity of what was excluded:

```ts
interface Covered<T> { value: T; coverage: Rate; excluded: EntityRef[] }
```

The UI shows coverage below 1.0. The AI tool result includes it, and the system prompt requires the model to surface it. A portfolio value that silently omits two holdings is a worse answer than one that says so.

### 10.5 Single implementation per concept

There is exactly one function for each of: account balance, period income, period expense, savings, savings rate, budget actual, position quantity, cost basis, market value, realised P&L, unrealised P&L, allocation weight, net worth. The UI, the AI tools, the export, and the integrity checker all call the same one.

This is why an AI answer can never disagree with the screen: there is no second implementation to disagree with.

## 11. Module map — services versus engine

The split follows [ADR-21](DECISIONS.md#adr-21--application-services-are-a-distinct-layer-from-the-financial-engine). The test on which side a function belongs: **if removing the database would break it, it is a service; if it would not, it is engine.**

```
src/server/services/            APPLICATION SERVICES — impure, transactional
  accounts.ts       create, update, close, listWithBalances
  transactions.ts   create, update, delete, list
  transfers.ts      createTransfer (incl. fx residual handling)
  categories.ts     CRUD, archive
  budgets.ts        listStatuses
  recurring.ts      rules CRUD, post (job handler)
  assets.ts         manual assets, valuations
  liabilities.ts    CRUD, balances
  networth.ts       compute, snapshot, history, attribution
  _guards.ts        requireOwnership, requireActiveAccount, requireCategoryKind
  _ctx.ts           ReadCtx  = { userId, now, fx }                  <- queries take this
                    WriteCtx = ReadCtx & { tx, audit }              <- commands take this

src/server/domain/              FINANCIAL ENGINE — pure, total, no I/O
  ledger/     buildEntries, assertEntryInvariants, deriveBalance
  calc/       cashflow.ts, periods.ts, budget.ts, recurrence.ts
  networth/   contributions map, bridge/attribution arithmetic
```

Every service function takes a context as its first argument, and **the context type is the write boundary**:

```ts
interface ReadCtx  { userId: UserId; now: Date; fx: FxLookup }
interface WriteCtx extends ReadCtx { tx: DbTransaction; audit: AuditWriter }

listTransactions(ctx: ReadCtx,  q: Query): Promise<TransactionView[]>
createTransaction(ctx: WriteCtx, input: NewTransaction): Promise<Result<…>>
```

A caller that can only construct a `ReadCtx` — no `tx`, no `audit` — **cannot call a command at all**: it is a type error, caught by `tsc`, not a lint rule or a review comment. The AI tool layer is exactly such a caller ([AI-SYSTEM.md §8](AI-SYSTEM.md#8-tool-architecture)). `now` and `tx` are injected, so time-dependent and transactional behaviour is testable without mocking a global clock or a connection pool.

Every engine function takes plain data and returns plain data. `deriveBalance(openingBalance, entries, investmentEntries)` receives rows the service already fetched — it does not fetch them. That is the whole distinction, and it is what makes the edge-case suites in §12 cheap to write.

## 12. Edge cases that must be covered by tests

Listed here because they are where financial software actually breaks. Each maps to a test in [TESTING.md](TESTING.md).

1. Zero-amount transaction — rejected (`amount <> 0` at both layers).
2. Transaction dated before the account's `opening_date` — rejected.
3. Transfer between accounts of different currencies with a real spread — residual reported, not absorbed.
4. Transfer to and from the same account — rejected.
5. Expense against an income category (and vice versa) — rejected.
6. Category deleted while transactions reference it — blocked; archive path offered.
7. Account closed while it has a non-zero balance — allowed, flagged, still counted historically.
8. Budget period spanning a fiscal-year boundary.
9. Budget with zero amount — rejected at creation; `utilization` null-safe regardless.
10. Recurring monthly rule on the 31st, across February in a leap and a non-leap year.
11. Recurring job run twice on the same day — exactly one posting.
12. Recurring rule whose `ends_on` falls mid-expansion.
13. Savings rate with zero income — `null`, not division by zero.
14. Net worth on a date before any transaction — zero, with full coverage.
15. Net worth with a manual asset that has no valuation at all.
16. Credit-card account also referenced by a `liabilities` row — double-count guard fires.
17. FX rate missing for a transaction date — falls back to most recent earlier; if none, creation is rejected with `no_rate` rather than defaulting to 1.
18. Amounts at the `NUMERIC(20,4)` boundary — no overflow, no silent truncation.
19. `allocate` of an amount that does not divide evenly — parts sum back exactly.
20. Negative-amount income (a salary clawback) — rejected as income; must be recorded as an expense or a correcting entry.
21. **A tag applied to a transfer** — appears in tag filters, and is excluded from every tag-grouped income/expense aggregate. A tag report that counted the transfer legs would be a silent double count ([§5](#5-categories-and-tags)).
22. Two tags differing only in case (`Travel` / `travel`) — resolve to one tag, not two.
23. Renaming a tag onto an existing tag's name — merges, collapses duplicates, and leaves no transaction holding the same tag twice.
24. A manual asset revalued twice on the same date — the second insert conflicts; valuations are unique per `(asset, as_of)`.
25. A liability with both `linked_account_id` set and `liability_balances` rows — the account wins and the rows are ignored; asserted, not silently preferred.
26. An entry whose `base_amount` does not equal `round(amount × fx_rate_to_base, 4)` — rejected by the database, not merely by the service (invariant I-11).
27. A same-currency transfer whose two `base_amount` values do not sum to exactly zero — rejected by the shape trigger (invariant I-3).
28. Summing `base_amount` across **all** entries with no `kind` filter — same-currency transfers contribute exactly zero, so the total still equals net cash flow. This is the safety net behind the `kind` filter, and it is asserted rather than assumed.
