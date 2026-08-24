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
| **Net worth** | — | **derived on demand** | computed per request; nothing is stored ([ADR-24](DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6)) | [§9](#9-net-worth) |
| Net-worth snapshot | `net_worth_snapshots` | **derived cache — Phase 6** | not built at launch; deferred with four rules attached | [§9](#9-net-worth), [ADR-24](DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6) |
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
const PRICE_SCALE = 8;
const RATE_SCALE  = 10;

type CurrencyCode = string & { readonly __brand: 'CurrencyCode' };

interface Money     { readonly minor: bigint; readonly currency: CurrencyCode }  // scale 4
interface Quantity  { readonly units: bigint }                                    // scale 8
interface UnitPrice { readonly units: bigint }                                    // scale 8
interface Rate      { readonly value: bigint }                                    // scale 10
```

**`UnitPrice` is a separate type from `Money`, not a convenience alias.** Every per-unit figure in the schema is `numeric(20,8)` — `investment_transactions.price`, `instrument_prices.close`, `instrument_quotes.price`, and the derived `cost_per_unit`. Reading a NAV of `123.45678900` into a scale-4 `Money` **truncates it to `123.4568`** at the read boundary. It is distinct from `Quantity` for the same reason `Quantity` is distinct from `Money`: multiplying two prices, or adding a price to a quantity, is meaningless and should not compile.

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

// per-unit — src/lib/decimal/price.ts
valueOf(q: Quantity, p: UnitPrice, c: CurrencyCode, rounding: Rounding): Money   // qty × price
perUnit(m: Money, q: Quantity, rounding: Rounding): UnitPrice                    // money ÷ qty
mulQtyRatio(m: Money, num: Quantity, den: Quantity, rounding: Rounding): Money   // exact share

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
- **Resolution order, tried in this sequence and stopping at the first hit.** Each step is recorded in `FxSelection.source` so an audit can see how a rate was arrived at:

  | Order | `source` | Rule |
  |---|---|---|
  | 1 | `identity` | `X → X` is `1`, with no table lookup |
  | 2 | `direct` | A `(base, quote)` row. **A direct rate always wins, even when an inverse or triangulated route has a more recent date** — the stored direction is the one that was actually quoted |
  | 3 | `inverse` | `(quote, base)` exists: `1 / rate` at `RATE_SCALE`, `half_even` |
  | 4 | `triangulated` | Neither direct nor inverse exists, but both legs of `from → P → to` do, through a pivot currency `P` |
  | — | `no_rate` | No route. The component is **excluded and named**, never silently dropped and never valued at zero |

### 2.1 Triangulation

Reference FX feeds quote everything against one reference currency. A feed that publishes `EUR→INR` and `EUR→USD` and nothing else leaves a USD holding in an INR-base portfolio with **no direct and no inverse route** — and under a direct-or-inverse-only rule the entire foreign block silently disappears from net worth. Disappearing is worse than a wrong number, because nothing is displayed to notice.

```
rate(from, to, on) = rate(from, P, on) × rate(P, to, on)
```

Four rules keep it from becoming a source of invented figures:

1. **It is the last resort.** A direct or inverse route always wins, at any date.
2. **Both legs obey the same date rule** — exact, else most recent earlier, never later. A leg that would need a future rate makes the whole route unavailable.
3. **The result is dated by its *stalest* leg**: `asOf = min(legA.asOf, legB.asOf)`. A rate is no fresher than the oldest observation it was built from, and dating it by the newer leg would present a month-old cross as current.
4. **One pivot, never two.** Chaining through two pivots compounds two roundings against a rate that no source ever published. If a single-pivot route does not exist, the answer is `no_rate`.

The pivot set is the currencies for which rates are actually loaded, so the common case — a feed's own reference currency — works without configuration.

**Adapters still normalise on the way in.** An FX adapter requests the pairs the application needs quoted against the base currency where the provider can compute the cross server-side, so triangulation is a safety net rather than the everyday path. Both mechanisms exist because either alone leaves a gap: adapter normalisation cannot help a pair nobody thought to request, and triangulation alone would put an avoidable rounding in the common case.

### 2.2 Rate age

An FX rate has an age, and until Phase 6 nothing looked at it. `selectRate` returns the most recent earlier row with no bound, so a feed that stopped a month ago still produces a confident base-currency figure.

**A rate carries its `asOf`, and a conversion that used a rate older than the freshness bound is marked** — the same way a stale price is marked, on every surface that shows a converted figure. The classification is the one in [ADR-28](DECISIONS.md#adr-28--staleness-is-measured-in-trading-sessions-not-wall-clock-hours), applied to a rate rather than a price. A stale rate is **used**, never discarded: refusing it would blank net worth every weekend, for the same reason refusing a stale price would blank the portfolio.

- Every stored transaction captures the rate it used ([ADR-12](DECISIONS.md#adr-12--base-currency-with-dated-fx-stored-alongside-native-amounts)). Recomputing history uses the stored rate, not a fresh lookup, unless the user explicitly triggers an FX re-derivation.

## 3. Accounts

### Balance — the ledger is the source, the balance is derived

> **Ledger transactions are source. Balances are derived.**
>
> Always computed, never stored, never edited.

There is no `accounts.current_balance` column, and there never will be. A stored balance is a second source of truth that silently diverges from the ledger the first time a write is retried, a transaction is edited, or two paths update it in a different order. Every reconciliation bug in this class of software traces back to a cached balance somebody trusted.

```
balance(account, asOf?) =
    (opening_date <= asOf ? opening_balance : 0)   -- the ONLY stored money figure on an account
  + Σ transaction_entries.amount         where account_id = account AND booked_on   <= asOf
  + Σ investment_transactions.net_amount where account_id = account AND trade_date <= asOf
```

`opening_balance` is not an exception to the rule: it is the declared position *before* the ledger begins, not a running total. Nothing updates it after creation.

**The opening balance is gated by `opening_date`, and this is load-bearing** ([ADR-26](DECISIONS.md#adr-26--an-as-of-financial-figure-is-computed-from-dated-facts-only-no-current-state-flag-participates)). An account opened in 2026 with an opening balance of ₹50,000 must contribute **nothing** to a balance — and therefore to a net worth — as of 2020. Without the gate the date bound covers only the *movements*, and an opening position is not a movement: the ₹50,000 would appear in every historical figure predating the account's existence. The two sums are already empty in that case, because a transaction dated before `opening_date` is rejected ([§12 case 2](#12-edge-cases-that-must-be-covered-by-tests)), so the gate is the only term that matters.

When `asOf` is omitted the bound is "today", and the gate is a no-op for any account whose `opening_date` is not in the future.

**Balances are trade-dated** ([ADR-22](DECISIONS.md#adr-22--financial-recognition-is-trade-dated-settlement_date-is-informational-metadata), resolving OD-6). The investment term above is bounded by `trade_date`, never by `settlement_date`: `trade_date` is the financial recognition date and the cash date, and `settlement_date` is a recorded fact that controls nothing. The same applies to `replay()`, to every rebuild, and to every historical or `asOf` calculation.

In a T+1 market this means a displayed balance can differ from the broker's cleared cash for up to one settlement cycle. That is a deliberate simplification — the divergence affects no realised figure, no cost basis and no P&L — and **the UI should make clear that displayed balances are trade-dated rather than settlement-dated** wherever a balance derived from the investment ledger is shown. No settlement-date-based cash movement exists, and settlement-aware accounting logic is out of scope for the current architecture.

**Every term is in the account's own currency.** That sum is unconditional — it has no currency argument and no filter — so three things follow, and each is enforced rather than assumed:

- `investment_transactions.net_amount` is denominated in the **account's** currency, not the instrument's (decision **OD-5**, [SCHEMA.md §6](SCHEMA.md#6-investment-ledger)). A USD ETF bought from an INR brokerage account records its cash effect in rupees; the instrument-currency figures live in `price` / `gross_amount` / `fees` / `taxes` alongside it. Were it otherwise, this sum would add dollars to rupees and produce a number that is money in no currency at all — silently, with no constraint able to detect it.
- The instrument→account conversion, where the two differ, is **explicit and dated** through [§2](#2-fx): exact `as_of`, else the most recent earlier rate, else reject with `no_rate`. Never a default of 1.
- An `investment_transactions` row with `cash_settled = false` carries `net_amount = 0` (invariant I-16). The sum does not filter on `cash_settled`, so an unsettled row with a non-zero amount would move a balance that no cash ever moved.

**An account's `currency_code` is immutable once it carries ledger rows.** Changing it would silently reinterpret every historical amount above. There is no supported operation to do so.

Consequences that follow, and are relied on elsewhere:

- **Correcting history is a normal operation.** Edit a transaction dated last March and every balance from March onward is correct on the next read. No backfill job, no repair script.
- **`asOf` is free.** A historical balance is the same query with a different bound — which is what makes point-in-time net worth ([§9](#9-net-worth)) and the change bridge possible at all.
- **Auditability holds.** Any balance can be explained by listing the rows that produced it.
- **The same rule governs investments.** `positions` is a *cache* of a ledger replay, not a record ([ADR-06](DECISIONS.md#adr-06--holdings-are-derived-cached-and-rebuildable)). It is deletable and rebuildable at any moment; deleting a stored balance would be data loss.

One pure function, `deriveBalance()`, in `src/server/domain/ledger/balance.ts`, fed by a repository query. Nothing else computes a balance — the UI, the AI tools, the export, and `verify:integrity` all call it, which is why they cannot disagree. Both sums are in the **account's** currency; base-currency conversion happens in the application service above it.

**Where caching would be permitted, and is not yet.** If the summed-entry query becomes slow at scale, the fix is a materialised roll-up keyed by `money_ledger_version` — derived, invalidatable, and rebuildable, exactly like `positions`. Not a mutable column. Measure first ([ARCHITECTURE.md §9](ARCHITECTURE.md#9-performance-targets)).

### Account kinds and net-worth sign

**Classification is by the economic sign of the balance, never by kind** ([ADR-25](DECISIONS.md#adr-25--net-worth-classification-is-by-the-economic-sign-of-the-balance-not-by-account-kind)):

| `balance(a, asOf)` | Net-worth contribution |
|---|---|
| `> 0` | **asset** of `balance` |
| `< 0` | **liability** of `abs(balance)` |
| `= 0` | **neither subtotal.** The account still occupies its key in the contributions map ([§9.2](#92-enforcement)) |

`kind` decides two things, and neither is the side of the balance sheet:

| Kind | Display group | Expected sign — the opposite is **flagged**, never reclassified |
|---|---|---|
| `bank`, `cash`, `wallet` | Cash | positive |
| `brokerage` | Brokerage cash | positive |
| `credit_card`, `loan` | Debt | negative |
| `other` | Other | either |

The rule this replaces classified by kind, and lost money in two directions at once. A **credit card carrying an overpayment** — `balance = +₹5,000`, real money the issuer owes back — was excluded from the asset term by its kind and from the liability term by its sign, so it appeared in **neither**; while `accountRole()` classified it as a liability by kind, so a total built on that plus `abs()` reported it as a ₹5,000 **debt**. An overdrawn `bank` account was symmetrically wrong as a negative asset. The required behaviour is stated as an edge case ([§12 case 29](#12-edge-cases-that-must-be-covered-by-tests)) and an invariant (**I-31**).

What sign-based classification buys, beyond correctness on those rows:

```
Σ over ALL accounts of contribution(a, asOf) = Σ over ALL accounts of balance(a, asOf)
```

The account block of net worth is a plain sum of balances. Nothing can be dropped or duplicated by a kind test, because there is no kind test.

Credit available on a card is `credit_limit - abs(balance)` and is **not** an asset. It is shown on the account row and excluded from every total.

### Account lifecycle — and what an `asOf` calculation may read

`is_active = false` closes an account. Historical records remain and remain in historical totals. An inactive account with a non-zero balance is flagged on the accounts page — closing an account does not zero it.

**`is_active` is a UI state. No calculation reads it** ([ADR-26](DECISIONS.md#adr-26--an-as-of-financial-figure-is-computed-from-dated-facts-only-no-current-state-flag-participates), invariant **I-26**). The lifecycle a calculation sees is entirely date-driven:

| Question | Answer | Determined by |
|---|---|---|
| Does the account exist at `asOf`? | `opening_date <= asOf` | `opening_date` |
| What did it hold at `asOf`? | the ledger bounded by `asOf` | `booked_on`, `trade_date` |
| Was it closed? | irrelevant to any figure | — |

An account excluded because `opening_date > asOf` is **absent** from the net-worth breakdown, not present at zero — so it cannot be confused with an account that genuinely held nothing.

**A base-currency conversion of an `asOf` balance uses the rate in force on `asOf`, never today's** ([§2](#2-fx)). Converting a historical native balance at the current rate prices 2021's rupees at 2026's dollar — the native figure honours the date and the base figure silently does not.

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
- Default seed set (editable): Income — Salary, Business, Interest, Dividend, Rental, **Other Income** (→ **Asset sale proceeds**, added in Phase 5). Expense — **Food** (→ Groceries, Dining), Housing (→ Rent, Maintenance), Transport (→ Fuel, Public transport, Cabs), Utilities, Health, Insurance, Education, Shopping, Entertainment, Travel, Personal, Business, Fees & Charges, Taxes, Gifts & Donations, Other.

  *Asset sale proceeds* exists so the receipt from disposing of a manual asset is identifiable in a savings-rate reading ([§9.4](#94-asset-and-liability-lifecycle)). It is an ordinary income category and changes no calculation.

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
- **Proceeds from disposing of a manual asset inflate `income` and therefore `savingsRate`** for that period, because the receipt is an ordinary income transaction while the asset it replaced was never income. Net worth is unaffected — the bridge nets the proceeds against the asset's last valuation ([§9.3](#93-calculation)). The default `Other Income → Asset sale proceeds` category exists so the receipt is identifiable; excluding it from a savings-rate reading is a filter, not a calculation change.
- Period comparison (`compare_periods`) returns both periods' figures plus absolute and percentage deltas, with `null` percentages when the base period is zero.

## 9. Net worth

**Net worth carries a declared valuation basis, and the basis is part of the answer** ([ADR-23](DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost)):

| Basis | Investment contribution | Available |
|---|---|---|
| **`cost`** | the exact cost basis — `Σ tax_lots.remaining_cost × lot.fx_rate_to_base`, summed per lot | **Phase 5** |
| `market` | `Σ marketValue(position)`; unpriced holdings **excluded** and named, with a coverage ratio | Phase 6 |

**Phase 5 computes `cost` only, and the figure is called "Net Worth at Cost"** wherever the unqualified term could imply a current market valuation. **A single figure never mixes the two bases** — part market value and part acquisition cost is a number in no basis at all. Market-value net worth is a distinct Phase 6 calculation.

Everything in §9 below is basis-independent unless it says otherwise.

### 9.1 The single-counting rule

`CLAUDE.md <net_worth>` names double counting as the hazard, using the exact example that matters: *"an investment held inside an investment account must not accidentally be counted as both an account balance and an investment asset."*

The structural answer is a rule the calculator enforces rather than a convention it hopes for:

> **Every unit of value has exactly one owning source. A source contributes to net worth; a view of that source never does.**

| Value | Owning source | Never also counted as |
|---|---|---|
| Cash in a bank / cash / wallet account | the account's balance | anything |
| **Cash sitting in a brokerage account** | the account's balance | a "cash" holding, an instrument, or an allocation slice of type cash |
| **An instrument held in a brokerage account** | its **cost basis** (`cost`) or `marketValue` (`market`) | the brokerage account's balance — buying converts cash to position and the ledger moves both sides |
| Credit-card debt | the card's negative balance | a `liabilities` row (guarded by `linked_account_id`) |
| Loan with transactions flowing through it | the loan account's negative balance | a `liabilities` row |
| Loan tracked only as a schedule | `liability_balances.outstanding` | any account |
| Physical gold | `asset_valuations` | an instrument of class `gold` |
| **Gold ETF / sovereign gold bond** | the instrument's contribution | a `manual_assets` row |
| Property, vehicle, receivable | `asset_valuations` | anything |

The two rows in bold are where real systems go wrong. A brokerage account holds *both* cash and positions; counting the account balance and the positions is correct **only because a purchase debits the cash balance in the same ledger row that creates the lot**. That coupling is what makes the sum non-overlapping.

**The proof, not the promise.** For an account `a` whose instruments share its currency, and any `asOf`:

```
balance(a, asOf) + Σ_{lots ℓ in a} remainingCost(ℓ, asOf)
   = openingContribution(a, asOf)
   + Σ money-ledger entries (booked_on ≤ asOf)
   + Σ investment cash effects that are NOT trades (trade_date ≤ asOf)
```

Buys and sells cancel out of the right-hand side entirely: one row carries `net_amount = −(gross + fees + taxes)` and opens a lot with `cost_total = gross + fees + taxes`. The cash falls by exactly what the lot gains, because they are the two halves of one row.

Three corollaries follow, and each is directly testable (invariant **I-25**):

| Event | Change in net worth |
|---|---|
| Buy | **exactly zero** — cash becomes basis |
| Sell | **exactly the realised P&L** — `proceeds − cost_consumed` |
| Dividend | **exactly the net received** — `gross − fees − taxes` |
| Standalone fee or tax | `−` the amount |
| Split or bonus | **exactly zero** — no money moves at any denomination |

This is what the brief's worked example is stating:

```
brokerage cash ₹100,000, positions ₹0            → contribution ₹100,000
buy ₹60,000 of securities
brokerage cash  ₹40,000, positions ₹60,000       → contribution ₹100,000   (not ₹160,000)
```

### 9.2 Enforcement

Three mechanisms, because a rule stated in prose is not a rule:

1. **Structural.** `liabilities.linked_account_id` is `UNIQUE` and nullable. Set → the liability contributes **nothing**; the account contributes, by sign, and `liability_balances` is ignored entirely. Null → the schedule is authoritative and no account may represent it. Two liabilities cannot claim one account. The linked account must be of kind `credit_card` or `loan` (**I-27**) — a link to a `bank` account would leave the liability contributing nothing *and* the account contributing as an **asset**, so the debt would disappear.
2. **Assertion.** `computeNetWorth()` builds an explicit `contributions: Map<SourceKey, Money>` where `SourceKey` is `('account', id) | ('position', accountId, instrumentId) | ('asset', id) | ('liability', id)`. Inserting a duplicate key throws (**I-21**). The final sum is over the map, never over concatenated arrays — so a source counted twice is a crash in development, not a wrong number in production.
   Positions are aggregated to `(account, instrument)` **before** insertion. The at-cost figure is derived per lot; several lots of one instrument in one account collapse into one key, which is what keeps the key stable when Phase 6 replaces the cost figure with a market figure computed per position.
3. **Reconciliation.** `verify:integrity` recomputes net worth by an independent path — the contributions map against the group subtotals — and asserts equality exactly (**I-22**), and separately asserts that no `manual_assets` row of kind `gold_physical` shares a name with an active instrument of class `gold`.

**Two overlaps have no structural guard, and are reported as warnings rather than asserted:** physical gold that duplicates a gold ETF or sovereign gold bond, and a manual asset that duplicates an account ("Cash at home" recorded as both). Neither can be prevented by the schema. An invariant that a user can legitimately violate is a false-alarm generator, and a false-alarm generator is eventually ignored.

### 9.3 Calculation

```
assets(asOf, basis)      = Σ contributions where side = 'asset'
liabilities(asOf)        = Σ |contributions| where side = 'liability'
netWorth(asOf, basis)    = assets − liabilities
```

There is no third category, and no contribution is classified by anything but its own sign ([§9.1](#91-the-single-counting-rule), [ADR-25](DECISIONS.md#adr-25--net-worth-classification-is-by-the-economic-sign-of-the-balance-not-by-account-kind)). The contributions are:

```
account a        →  balance(a, asOf)                            for EVERY account
lot ℓ            →  remainingCost(ℓ, asOf) × ℓ.fx_rate_to_base  basis 'cost'   (Phase 5)
position p       →  marketValue(p, asOf)                        basis 'market' (Phase 6.11)
manual asset m   →  valuationInForce(m, asOf)
liability L      →  −outstanding(L, asOf)                       scheduled liabilities only
```

**`basis` defaults to `'cost'`** ([ADR-32](DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view)). `'market'` is a fully supported alternate view, requested explicitly. **Neither replaces the other**: they answer different questions — *what did I put in* versus *what is it worth now* — and a single figure never mixes them ([ADR-23](DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost)).

**Only the investment term differs between the two bases.** Accounts, manual assets and liabilities are identical under both: none of them is a security, and none has a market price ([§9.6](#96-what-market-basis-does-not-change)).

### `marketValue(p, asOf)` — normative

```
marketValue(p, asOf) = quantityHeldOn(p, asOf)
                     × priceOn(p.instrument, asOf)
                     × fxRateOn(p.instrument.currency → base, asOf)
```

Each factor has exactly one definition, and each is stated because the plausible alternative is wrong:

| Factor | Rule | Never |
|---|---|---|
| `quantityHeldOn` | `Σ_{txn ≤ asOf} txn.quantity × Π{ ratio of every corporate action in (txn.trade_date, asOf] }` | **never** `Σ quantity` — a `split`/`bonus` carries `quantity IS NULL` and a ratio, so a running sum reports the pre-split quantity for ever ([INVESTMENT-DOMAIN.md §8.1](INVESTMENT-DOMAIN.md#81-portfolio-growth-over-time)) |
| `priceOn` | the `instrument_prices` row with the greatest `as_of <= asOf`, **within the carry-back bound** | never interpolated; never a later price for an earlier date; never carried past the bound ([INVESTMENT-DOMAIN.md §8.1](INVESTMENT-DOMAIN.md#81-portfolio-growth-over-time)) |
| `fxRateOn` | [§2](#2-fx)'s resolution order, at `asOf` | never the acquisition rate — that is the `cost` term |

**A position that cannot be priced is `excluded` and named — never valued at its cost.** Substituting cost inside a market total produces a figure in no basis at all, which is exactly what ADR-23 forbids. The exclusion reasons are the `MissingPriceReason` members ([INVESTMENT-DOMAIN.md §5](INVESTMENT-DOMAIN.md#5-valuation)), each of which tells the user something different.

**A stale price is used and marked, never silently treated as current** ([ADR-28](DECISIONS.md#adr-28--staleness-is-measured-in-trading-sessions-not-wall-clock-hours)); refusing it would blank the figure every long weekend. **An unreconciled corporate action suppresses the position's value entirely** ([ADR-29](DECISIONS.md#adr-29--provider-corporate-actions-are-detections-never-ledger-writes)), because post-split price × pre-split quantity is a large, internally consistent, wrong number.

**`positions` cannot serve a market figure at a past date** for the same reason it cannot serve a cost one: it is today's cache with no date bound. The temptation is stronger here, because `positions.quantity` looks exactly like what `quantityHeldOn` returns.

### The eligibility table

**Every filter is a date comparison against a recorded fact. Not one is a current-state flag** ([ADR-26](DECISIONS.md#adr-26--an-as-of-financial-figure-is-computed-from-dated-facts-only-no-current-state-flag-participates)). This table is normative; where any other document implies a different filter, this one governs.

| Component | Eligible at `asOf` when | Value at `asOf` | Explicitly **not** filtered by |
|---|---|---|---|
| Account | `opening_date <= asOf` | `balance(a, asOf)` per [§3](#3-accounts) — opening balance included only under the same test | `accounts.is_active` |
| Investment lot | `opened_on <= asOf` | `cost_total − Σ lot_disposals.cost_consumed where closed_on <= asOf` | `instruments.is_active`, `positions.quantity`, **`acquired_on`** |
| Manual asset | `startOf(m) <= asOf` **and** (`disposed_on IS NULL` or `disposed_on > asOf`) | `valuationInForce(m, asOf)` | `manual_assets.is_active` |
| Liability — scheduled | a `liability_balances` row exists with `as_of <= asOf` | that row's `outstanding` | `liabilities.is_active` |
| Liability — transacted | **never eligible in its own right** — the linked account contributes | — | — |
| FX rate | a `fx_rates` row exists with `as_of <= asOf` | that row's rate ([§2](#2-fx)) | `fetched_at` |
| Price *(basis `market`, Phase 6)* | an `instrument_prices` row exists with `as_of <= asOf` | that row's `close` | — |

where `startOf(m) = acquired_on ?? the earliest asset_valuations.as_of`, and
`valuationInForce(m, asOf)` = the `asset_valuations` row with the greatest `as_of <= asOf`.

Four consequences worth stating, because the plausible alternative is wrong in each:

- **An account whose `opening_date > asOf` is absent from the breakdown, not present at zero** — so it cannot be confused with an account that genuinely held nothing.
- **A lot is eligible by `opened_on`, never by `acquired_on`.** A `transfer_in` carries the original acquisition date forward so a demat transfer does not reset a long-term holding to short-term, and `acquired_on` can precede `opened_on` by years. Using it would place the destination lot in the destination account from the original purchase date — while the source account's lot is *also* still open until its `transfer_out` — counting the same value **twice** for the whole intervening period. This is the one place in the design where a plausible column choice produces a silent double count, and it has its own invariant (**I-23**).
- **An eligible manual asset with no valuation in force is `excluded` and named, never zero.** A ₹80 lakh flat contributing ₹0 to a headline figure is a materially wrong number presented as a right one ([§10.3](#103-missing-data-propagates-as-null-never-as-zero), [§10.4](#104-partial-results-are-labelled-not-hidden)). An asset that is simply *not yet held* at `asOf` is a different case: it is ineligible, and is not reported as an exclusion.
- **`positions` cannot answer an as-of question.** It is today's cache, carries no date bound, and must never be given one ([ADR-06](DECISIONS.md#adr-06--holdings-are-derived-cached-and-rebuildable)). The lot-level derivation above is exact rather than approximate for three reasons: a `split` or `bonus` touches **no money**, so cost is invariant under corporate actions; FIFO's total order gives replay a prefix property, so the disposals dated `≤ asOf` in a full replay are exactly those a replay bounded at `asOf` would produce; and invariant **I-20** makes `cost_total − Σ consumed` residue-free. At `asOf = today` it must reproduce `Σ positions.base_cost_basis` exactly (**I-24**).

### Currency

Each component is converted **once**, at `round(native × rate, 4)` with `half_up` — the mode the database `CHECK`s use — and the already-rounded base figures are what the map holds and what the subtotals sum. Each conversion is its own boundary because each uses a different rate, so this does not violate [§10.2](#102-rounding); summing unrounded products would mean the displayed components did not add up to the displayed total. Because the subtotals sum the same rounded values the map holds, `assets − liabilities = Σ map` **exactly**, with no tolerance (**I-22**).

**The investment block is carried at acquisition rates while every other block converts at the `asOf` rate**, and this asymmetry is deliberate ([INVESTMENT-DOMAIN.md §6.4](INVESTMENT-DOMAIN.md#64-foreign-currency-positions)): `tax_lots.fx_rate_to_base` is never revalued, because re-rating it would make last year's cost basis move every morning. Two consequences follow:

1. At `basis: 'cost'` a foreign-currency holding contributes **no unrealised FX**. Currency movement surfaces only on disposal, as `base_fx_component` (I-18).
2. Under `basis: 'market'` the investment term converts at the **`asOf` rate** instead. A market figure therefore differs from a cost figure **for FX reasons alone**, independently of any price. Because the default remains `cost` ([ADR-32](DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view)), this is a difference the user opts into seeing rather than a movement in their headline figure — but it must still be stated wherever the two are compared ([§9.5](#95-the-cost-to-market-restatement)).

**A missing rate excludes one component; it never zeroes it and never nulls the whole figure.** The result carries **separate asset and liability coverage** — deliberately, because an excluded asset makes net worth look *lower* and an excluded liability makes it look *higher*, and one blended ratio would hide which direction the figure is wrong in. A component whose native value is zero needs no rate and is never excluded ([ADR-11](DECISIONS.md#adr-11--market-data-behind-a-provider-abstraction-with-an-always-available-manual-provider), [§10.4](#104-partial-results-are-labelled-not-hidden)).

**Coverage is measured over value where a value is expressible, and over component count where it is not.** The distinction is forced, not stylistic (**D-29**):

| Exclusion cause | Coverage measure | Why |
|---|---|---|
| No FX rate | **component count** | A component with no rate has **no expressible base value** to weight by. Its native amount and currency are carried on the exclusion so the magnitude is still visible |
| Unvalued manual asset | **component count** | Same: there is no figure to weight |
| **No usable price** (`basis: 'market'`) | **value, weighted by base cost basis** | An unpriced holding's cost **is** known in base — it is exactly what the `cost` basis would have used |

So under `basis: 'market'` the result additionally carries `investmentCoverage` — the fraction of position **cost basis** that had a usable price. Under `basis: 'cost'` it is `1.0`: acquisition cost is always known.

**A partial figure is reported and labelled, never suppressed and never completed with cost.** The valuation status is `complete` (nothing excluded), `partial` (something excluded and named, figure still reported with the excluded magnitude beside it), or `unavailable` (no position could be priced although positions exist — the headline is withheld and the `cost` figure offered by name).

### Change attribution

For `[t0, t1]`, the bridge from `netWorth(t0)` to `netWorth(t1)`. **Both endpoints are on the same basis**, and the decomposition is derived from the composition above rather than invented alongside it — every line corresponds to a term in the eligibility table.

| Component | Definition |
|---|---|
| Savings | `income − expenses` over the period, base currency |
| Investment income | gross dividends + interest received in the period |
| Investment costs | −(fees + taxes paid in the period), including the withholding inside income rows |
| Realised P&L | `Σ lot_disposals.base_realized_pnl` with `closed_on` in the period |
| Unrealised investment gain | `basis 'cost'`: **zero by construction.** `basis 'market'`: `Σ (marketValue(t1) − marketValue(t0) − netContributions)` per position |
| Investment transfers in/out | an **unmatched** `transfer_in` / `transfer_out` — basis that entered or left with no cash movement, at the lot's rate |
| Asset revaluation | `Σ (valuationInForce(t1) − valuationInForce(t0))` over manual assets held throughout |
| Asset additions/disposals | acquisitions and disposals of manual assets in the period |
| Liability change | `−(liabilities(t1) − liabilities(t0))`, split into principal repaid and new borrowing **only where the user recorded both** |
| FX effect | `Σ_a opening(a)·[r_a(t1) − r_a(t0)]` **plus** `Σ_flows amount·[r(t1) − r(booking)]`, over every non-base denomination |
| Unexplained | `netWorth(t1) − netWorth(t0) − Σ(above)` |

Five notes, each a place the obvious version is wrong:

- **`Savings` cannot double-count investment income**, because it sums `transactions` and investment income lives in `investment_transactions`. This is the consumer that [§8](#8-cash-flow-calculations)'s separation was written for.
- **Buys and sells need no line.** A buy is `−cash + basis = 0`; a sell is `+proceeds − basis =` realised P&L, which its own line already carries. A "purchases" line would double-count.
- **`Unrealised investment gain` is zero *by construction* at `basis: 'cost'`** — arithmetically, because `Δcost = purchases − consumed` exactly, not because it was skipped. It must render as *"not measured — holdings valued at cost"*, never as `₹0`, which would read as *"the portfolio did not move."*
- **An unmatched `transfer_in` genuinely raises net worth** — shares gifted in, or an existing holding recorded when the user started using the app — with no cash moving. Without its own line the bridge cannot close. A *matched* pair nets to zero and needs no line: the source lot's basis drains at `proceeds = cost_consumed`, realised P&L zero by construction, and the destination lot opens with the same basis at the same rate.
- **`FX effect` is computed, not plugged.** Defining it as the residual would make `Unexplained` trivially zero and destroy the only assertion in the suite that catches most engine regressions.

**`Unexplained` is always computed and always displayed when non-zero.** For **single-currency data every term is identically zero and it must be exactly `0`** — the one-base-unit tolerance applies to multi-currency data only (**I-30**). A bridge that silently balances is a bridge that is hiding an error. This figure is also asserted in the golden-scenario tests ([TESTING.md](TESTING.md)).

### 9.4 Asset and liability lifecycle

`manual_assets` and `liabilities` are the two entities that appear only in net worth — they have no ledger of their own. Their rules were previously implied by the calculation; they are stated here.

**Manual assets.** Anything of value that is not an account balance and not an instrument: property, a vehicle, physical gold, a collectible, a receivable.

```
create      manual_assets row + a first asset_valuations row (both required; an ELIGIBLE
            asset with no valuation in force at asOf is EXCLUDED and named, never zeroed)
revalue     INSERT a new asset_valuations row. Never UPDATE an existing one — that would
            retroactively rewrite historical net worth.
dispose     SET disposed_on = <date> (and is_active = false, for the UI only), plus the
            sale proceeds recorded as an ordinary receipt into an account. The asset stops
            contributing from disposed_on; every earlier net-worth figure is unchanged.
            The DATE is what the calculation reads -- a flag alone would erase the asset
            from history the moment it was sold (§9.3).
delete      permitted only when the asset has no valuations outside its creation date;
            otherwise archive. Deleting valuation history destroys past net-worth figures.
```

`valuationInForce(asset, asOf)` is the row with the greatest `as_of <= asOf`. **Valuations are a time series, not a field.** This is the same rule as balances: the record is the source, the current value is derived from it by date. A valuation is denominated in the **asset's** currency; there is no separate currency on the valuation row to disagree with it.

**Disposal proceeds are a reporting artefact worth knowing about.** Recording the sale of a flat as ordinary `income` puts the whole proceeds into [§8](#8-cash-flow-calculations)'s `income`, which inflates the savings rate for that period. Net worth is unaffected — the bridge's `Asset additions/disposals` line carries `−(valuation in force)` against `Savings`' `+proceeds`, so the two net to the gain and `Unexplained` stays zero. The default category set therefore includes **`Other Income → Asset sale proceeds`**, so the receipt is identifiable and can be excluded from a savings-rate reading. A structural fix — a disposal that is neither income nor a transfer — is deferred; it would need a fifth transaction shape for one case.

**Liabilities.** Two mutually exclusive shapes, discriminated by `linked_account_id` ([§9.2](#92-enforcement)):

| Shape | `linked_account_id` | Contribution to net worth | Use for |
|---|---|---|---|
| **Transacted** | set (`UNIQUE`), and the account must be of kind `credit_card` or `loan` (**I-27**) | **none.** The account contributes, by sign | credit cards, loans whose EMIs flow through an account |
| **Scheduled** | `NULL` | the latest `liability_balances` row with `as_of <= asOf` | loans tracked only as a statement figure |

> **A `liabilities` row with `linked_account_id` set is metadata.** It carries the name, the kind, the interest rate, the EMI and the schedule dates. It carries **no money** into net worth. The money is the account's balance, counted once, by sign.

```
create      liabilities row; scheduled shape also needs a first liability_balances row
repay       transacted: an ordinary transfer or expense against the linked account
            scheduled:  INSERT a new liability_balances row. Never UPDATE.
close       INSERT a terminal liability_balances row with outstanding = 0, dated on the
            closing date, THEN is_active = false. The zero row is what the calculation
            reads: under a date-driven rule the flag changes nothing, so without it the
            last non-zero balance would stay in force forever (I-28). A liability with a
            non-zero outstanding cannot be closed — it is flagged, exactly like an account.
```

Deleting the linked account is refused (`ON DELETE RESTRICT`): `SET NULL` would silently convert a transacted liability into a scheduled one with no balance rows, which then contributes zero. Accounts carrying ledger history already cannot be deleted, so the stricter rule costs nothing.

A `liability_balances` row is denominated in the **liability's** currency; there is no separate currency on the balance row to disagree with it.

`interest_rate`, `emi_amount`, `started_on`, and `ends_on` are **descriptive only at launch**. Nothing computes an amortisation schedule from them; the change bridge splits principal from interest only where the user has recorded both, and reports the liability change as one figure otherwise. Deriving a schedule to split a number the user did not record would be inventing data. Until it exists the fields must not be presented as though the app is tracking the loan for you.

**Neither entity is ever created by the AI without confirmation**, and neither has a delete proposal kind ([AI-SYSTEM.md §9](AI-SYSTEM.md#9-the-mutation-boundary)).

### 9.5 The cost-to-market restatement

Comparing the two bases at one date is a **restatement**, not a bridge ([ADR-31](DECISIONS.md#adr-31--cost-to-market-is-a-restatement-at-an-instant-not-a-bridge-over-time)). A bridge explains movement between two dates on one basis; a change of basis is not movement, and `bridge()` refuses it.

```
netWorth(asOf, 'cost')
  − Σ baseCostBasis(unpriced positions)         removed: not valuable on this basis
  + Σ ( costAtSpot − costAtAcquisitionRates )   FX rebasis
  + Σ ( marketAtSpot − costAtSpot )             price effect
= netWorth(asOf, 'market')
```

over **priced** positions only, where `costAtSpot = Σ tax_lots.remaining_cost × fxRateOn(asOf)` and `costAtAcquisitionRates = Σ tax_lots.remaining_cost × lot.fx_rate_to_base`. Both are expressible because `remaining_cost` is held in the **instrument's** currency alongside the acquisition rate, so **no new column is required**.

**Every term is computed; none is a residual.** Defining the price effect as the plug would make the identity trivially true and hide the bug it should surface — the same reasoning that keeps `fx_effect` computed in the bridge.

Three rules on presentation, each guarding a misreading with a financial consequence:

- **The restatement explains a difference, never a gain.** The price effect is unrealised and says nothing about what the user earned.
- **The removed-unpriced line is not a loss.** It is what the comparison set aside for want of a price, and must be labelled so a reader can tell it from a holding that fell.
- **There is no liability term and no manual-asset term.** Both are identical under either basis; a restatement line for either means something is wrong.

### 9.6 What `market` basis does not change

Stated because the plausible assumption is that a "market" basis marks everything to market:

| Component | Under `basis: 'market'` |
|---|---|
| Account balances | **identical.** A balance is a recorded fact, not a price |
| Manual assets | **identical** — the user's own `asset_valuations` figure. A manual asset has a **valuation, not a price**, and does not become market-priced because the basis label changed |
| Liabilities | **identical.** A loan's outstanding principal is a contractual amount; marking own debt to market is out of scope and always will be |
| Realised P&L, cost basis, tax lots | **untouched.** Valuation reads the ledger; it never writes to it |
| The `cost` figure itself | **untouched, and remains the default** ([ADR-32](DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view)) |

## 10. Calculation engine contract

Every function in `src/server/domain/calc/` and every derivation in the lot engine obeys the same contract. This is what "deterministic financial engine" means concretely.

### 10.1 Purity and determinism

- **Pure where possible.** A calculation takes data and returns a result. `replay()` (lot engine), `xirr()`, `twr()`, `allocation()`, `cashflow()`, `budgetStatus()`, and `netWorthBridge()` take arrays and return values — no database handle, no clock, no I/O.
- **Time is injected.** Functions that need "now" take it as a parameter (`ctx.now`). No `new Date()` inside a calculation. This makes every time-dependent result testable without mocking the global clock.
- **Ordering is total, and orders *events* rather than *rows*.** Any replay uses a total order — `(date, created_at, id)`, and for the lot engine `(trade_date, kind_rank, created_at, id)`, which places corporate actions after same-day trades ([INVESTMENT-DOMAIN.md §3](INVESTMENT-DOMAIN.md#ordering)). Two records on the same date must sort identically on every run, on every machine. `created_at` alone is a total order over rows but **not** over economic events: it lets the answer depend on the order the user happened to enter things.
- **Same inputs → identical bytes out.** Asserted as a property test. This is what makes the derived-and-cached design of [ADR-06](DECISIONS.md#adr-06--holdings-are-derived-cached-and-rebuildable) safe.

### 10.2 Rounding

- Rounding happens **at the boundary of a calculation, never inside an accumulation**. Sum first at full precision, round once.
- Every lossy operation names its scale and mode explicitly; there is no default ([ADR-04](DECISIONS.md#adr-04--money-is-an-exact-scaled-integer-never-a-float)).
- Per-unit values are carried at scale 8, monetary totals at scale 4, rates at scale 10.
- A split of one amount into parts uses `allocate`, which distributes the remainder deterministically so the parts sum back **exactly**. Never `amount / n` applied n times.
  This is normative for the lot engine, not only for bill-splitting. A sale spanning three lots allocates the net proceeds across them by quantity; computing a per-unit proceeds figure once and multiplying it per lot rounds twice and leaves a residue in **realised P&L — a tax figure** ([INVESTMENT-DOMAIN.md §4](INVESTMENT-DOMAIN.md#why-disposal-allocates-instead-of-dividing)).
- **Prefer holding money exactly and deriving the rate, over holding the rate and deriving money.** A lot stores `cost_total` and `remaining_cost`; `cost_per_unit` is derived. The inverse arrangement forces a rounded multiplication on every read and recomputes the rate on every corporate action, compounding error — which is why invariant I-6 could previously only hold "within one minor unit per lot". An invariant with a tolerance is not an invariant.

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
  assets.ts         manual assets, valuations          <- the only writer of asset data
  liabilities.ts    CRUD, balances                     <- the only writer of liability data
  networth.ts       READ ONLY: asOf, series, bridge, reconcile.
                    Exports NO function taking a WriteCtx — net worth opens no ledger
                    and therefore cannot mutate anything (I-32, ADR-24).
  _guards.ts        requireOwnership, requireActiveAccount, requireCategoryKind
  _ctx.ts           ReadCtx  = { userId, now, fx }                  <- queries take this
                    WriteCtx = ReadCtx & { tx, audit }              <- commands take this

src/server/domain/              FINANCIAL ENGINE — pure, total, no I/O
  ledger/     buildEntries, assertEntryInvariants, deriveBalance
  calc/       cashflow.ts, periods.ts, budget.ts, recurrence.ts
  networth/   keys.ts        SourceKey, ContributionMap, add() that throws on a duplicate
              eligibility.ts one predicate per row of the §9.3 eligibility table
              compose.ts     components + rates -> NetWorthResult
              bridge.ts      two NetWorthResults + period flows -> lines + unexplained
              reconcile.ts   independent recomputation by group, and the equality assertion
```

The investment engine occupies the same two layers and obeys the same contract; its modules are listed in [INVESTMENT-ENGINE-DESIGN.md §6](INVESTMENT-ENGINE-DESIGN.md) and arrive in Phase 4:

```
src/server/domain/lots/         replay, the FIFO MatchingStrategy, replay ordering
src/server/domain/pricing/      valuation, allocation, concentration
src/server/domain/calc/         portfolio.ts, xirr.ts, twr.ts
src/server/services/            instruments.ts, investments.ts, positions.ts, portfolio.ts
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
14. Net worth on a date before any transaction — zero, with full coverage. An empty system is fully covered: nothing was left out.
15. Net worth with an **eligible** manual asset that has no valuation in force — excluded and named, coverage below 1.0, **never zero**.
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

### Net worth — the as-of and classification cases ([§9](#9-net-worth))

Added by the Phase 5 design review. Each guards a defect the pre-review rules would have produced.

29. **Overpaid credit card.** `balance = +₹5,000` → a **+₹5,000 asset** contribution. Not zero, and not a ₹5,000 liability ([ADR-25](DECISIONS.md#adr-25--net-worth-classification-is-by-the-economic-sign-of-the-balance-not-by-account-kind)).
30. **Overdrawn bank account.** `balance = −₹10,000` → a **₹10,000 liability** contribution, not a negative asset.
31. **Account created after the as-of date.** Opened 2026 with `opening_balance = ₹50,000`; `netWorth('2020-12-31')` includes **neither the ₹50,000 nor the account** — it is absent from the breakdown, not present at zero.
32. **Account created before the as-of date.** Opened 2019; `netWorth('2020-12-31')` includes its opening balance plus every movement booked on or before that date, and nothing later.
33. **Account closed after the as-of date**, and **closed before it while still carrying a balance** — both fully counted at their balance on `asOf`. Closing does not settle ([case 7](#12-edge-cases-that-must-be-covered-by-tests)).
34. **A `transfer_in` whose carried `acquired_on` predates its `opened_on` by two years** — the destination lot contributes only from `opened_on`; the source lot contributes until its `transfer_out`; neither period counts the value twice.
35. **A `buy` leaves net worth unchanged** at every date on or after its `trade_date`; a `sell` moves it by exactly the realised P&L; a `split` and a `bonus` move it by exactly zero.
36. **Manual asset disposed after the as-of date** — fully present at `asOf` at its valuation in force; absent from `disposed_on` onward.
37. **A scheduled liability closed without a terminal zero balance row** — rejected by the service, because a date-driven rule would otherwise keep its last balance in force forever.
38. **A liability linked to a `bank` account** — rejected at creation; otherwise the liability contributes nothing and the account contributes as an asset, and the debt disappears.
39. **Missing FX rate for one component** — that component is excluded and named, coverage falls on **its own side** only, and neither the component nor the total is zeroed or nulled.
40. **Negative net worth** — reported as negative. No `abs()` is applied to a total anywhere.
