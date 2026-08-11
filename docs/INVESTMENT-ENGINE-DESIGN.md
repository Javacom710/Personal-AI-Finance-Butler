# Investment Engine — Implementation Review & Design

**Status:** review complete, awaiting approval. **No code or schema has been changed.**
**Date:** 2026-08-11 · **Reviewed against:** `CLAUDE.md`, `docs/FINANCIAL-DOMAIN.md`, `docs/INVESTMENT-DOMAIN.md`, `docs/ARCHITECTURE.md`, `docs/SCHEMA.md`, `docs/DECISIONS.md`, `docs/TESTING.md`, the Phase 2 migration, `src/lib/decimal/`, and the 282 existing tests.

This document exists because `PROJECT-STATE.md`'s working protocol makes a design correction a **stop-and-explain event**, not an implementation detail. The approved baseline documents (`INVESTMENT-DOMAIN.md`, `SCHEMA.md`) are therefore **left untouched**; every correction below is proposed here and applied to them only after approval.

---

## 0. Blocking finding — the Financial Core does not exist yet

The request describes "the existing Money Management subsystem" and "existing Financial Core implementation" as the foundation to integrate with. **Neither is implemented.**

The repository has exactly one commit (`1d560ab`, Phase 2 — Foundation). The applied migration creates **nine tables**: `users`, `sessions`, `auth_events`, `currencies`, `fx_rates`, `settings`, `user_state`, `audit_log`, `jobs`. That matches `PROJECT-STATE.md` line 51: *"Phase 3 — Financial Core: not started; unblocked."*

What Phase 4 needs and does not have:

| Dependency | Owner | Status |
|---|---|---|
| `accounts` — `investment_transactions.account_id` FK target | Phase 3 | **missing** |
| `record_source` enum — `investment_transactions.source` | Phase 3 | **missing** |
| `deriveBalance()` — the sum both ledgers feed | Phase 3 | **missing** |
| `src/server/domain/`, `src/server/services/`, `_ctx.ts` (`ReadCtx`/`WriteCtx`) | Phase 3 | **missing** — no directory exists |
| `tests/golden/` harness | Phase 3 | **missing** |
| `ai_proposals` — `investment_transactions.ai_proposal_id` FK target | Phase 7 | missing (expected) |

There is no way to create `investment_transactions` — its `account_id` references a table that does not exist. **Phase 3 must land before any Phase 4 schema.** Everything below is therefore a design that Phase 3 must be built to receive; §11 lists what Phase 3 must do differently because of it.

### 0.1 Two circular table references that must be resolved in Phase 3

`SCHEMA.md` writes these inline, which is not applicable in migration order:

- `recurring_occurrences.investment_transaction_id → investment_transactions(id)` — a **Phase 3** table referencing a **Phase 4** table.
- `transactions.ai_proposal_id → ai_proposals(id)` and `investment_transactions.ai_proposal_id` — **Phase 3/4** tables referencing a **Phase 7** table.

**Resolution:** the referencing column is created nullable and **without** the FK constraint in the earlier phase; the later phase's migration adds the constraint with `ALTER TABLE ... ADD CONSTRAINT`. This is recorded because the alternative — reordering the phases — would put AI tables in Phase 3.

---

## 1. Review verdict on the existing design

The architecture is sound and the review found **no reason to redesign it**. The following are confirmed correct and are adopted unchanged:

- The investment ledger as sole truth; `tax_lots` / `lot_disposals` / `positions` as a rebuildable replay cache (ADR-06).
- A brokerage account is an `accounts` row with `kind='brokerage'` — **no separate investment-account table**. This is what makes "cash → asset" a net-worth no-op.
- Exactly one ledger per cash movement; no mirroring `transactions` row (invariant I-13).
- Dividends never reduce cost basis; `income_total` accrues **gross**, withholding accrues separately (I-12).
- FIFO behind a `MatchingStrategy` seam (ADR-07).
- Two denominators: `investedCapital` for unrealised, `costDeployed` for total return.
- `PriceResult` as a discriminated union; missing prices propagate as `null` + reason, never `0` (ADR-11, FINANCIAL-DOMAIN §10.3).
- Purity, injected time, total ordering (FINANCIAL-DOMAIN §10.1).

**AI involvement in authoritative calculations: none, and none is introduced.** The AI boundary is already correct — `ai_proposals` + server-side Zod + the `ReadCtx`/`WriteCtx` type split means a tool caller cannot construct a write context. The one rule this document adds is in §10.

What follows are **defects within that sound architecture** — places where the documents contradict each other or the schema, and where following them literally would produce wrong money.

---

## 2. Defects found (each would become a code bug)

### D1 — `INVESTMENT-DOMAIN.md` §4 contradicts §3 and invariant I-12 on income accrual

§4's engine pseudocode (line 153):

```
income (dividend | interest):  position.income += net
```

§3, the schema `CHECK`, and I-12 all require **gross**. Edge case 5b asserts `income_total = 500`, `taxes_total = 50` for a ₹500 dividend with ₹50 TDS — the pseudocode produces `income_total = 450`, `taxes_total = 0` and **fails that test**.

The pseudocode also never accrues a dividend's `fees` and `taxes` to `fees_total`/`taxes_total` at all — its `cost` branch fires only for `kind IN ('fee','tax')`.

Worse than either error alone: an implementer who follows §4 for income *and* §3 for tax gets `450 − 50 = 400` — the exact double-subtraction §3 warns about. **The contradiction is the hazard.** Corrected in §5.4.

### D2 — `tax_lots` has no total-cost column, so invariant I-6 cannot hold exactly

`INVESTMENT-DOMAIN.md` §4 states: *"Total cost is stored **per lot** as an exact `Money`, and `cost_per_unit` is derived."*

`SCHEMA.md` §6.1 `tax_lots` stores `original_quantity`, `remaining_quantity`, `cost_per_unit` — **and no total cost.** The document describes a column that does not exist.

Consequences of storing only the per-unit figure:

- I-6 (`positions.cost_basis = Σ remaining_quantity × cost_per_unit`) is a rounded product, which is why `TESTING.md` line 65 already concedes `± 1 minor unit per lot`. **An invariant with a tolerance is not an invariant.**
- Splits and bonuses "recompute `cost_per_unit = totalCost / qty`" — but `totalCost` must itself be reconstructed from an already-rounded `cost_per_unit`. Error compounds across successive corporate actions.
- `ROADMAP.md` Phase 4 requires *"Splits and bonuses preserve total cost basis **exactly**"* — unachievable as specified.

Corrected in §4.1 and §5.2; I-6 becomes exact with **no tolerance**.

### D3 — FIFO disposal violates the project's own rounding rule

§4's matching loop computes `proceedsPerUnit = (gross − fees − taxes) / |quantity|` once, then `realized = take × (proceedsPerUnit − lot.costPerUnit)` per lot.

`FINANCIAL-DOMAIN.md` §10.2 states the opposite rule: *"A split of one amount into parts uses `allocate`, which distributes the remainder deterministically so the parts sum back **exactly**. Never `amount / n` applied n times."*

Dividing then multiplying per lot means `Σ realized_pnl ≠ netProceeds − Σ costConsumed`. On a sale spanning three lots the residue is silent and permanent — it lands in realised P&L, which is a tax figure. `allocate()` already exists in `src/lib/decimal/money.ts` and takes `bigint[]` weights; `Quantity.units` are bigints. Corrected in §5.3.

### D4 — `transfer_out` is not special-cased in the disposal branch

§3's table says `transfer_out` closes lots FIFO *"with `realized_pnl = 0`; basis carried to the destination"*. §4's dispose branch has no such case — it would compute a non-zero realised P&L from `gross`/`price`, manufacturing a taxable gain out of moving your own shares between your own accounts. Corrected in §5.3.

### D5 — `transfer_in`/`transfer_out` destroys the holding period

The destination lot's `opened_on` is the transfer date, so `lot_disposals.holding_days` on the eventual sale measures from the transfer, not the original purchase. Moving shares between two of your own demat accounts would reset a long-term holding to short-term — a materially wrong tax classification, and the exact thing a lot-based ledger exists to get right.

`tax_lots` needs an `acquired_on` distinct from `opened_on`. Corrected in §4.1.

### D6 — `base_realized_pnl` has no defined FX methodology

`lot_disposals.base_realized_pnl` exists; nothing says which rate produces it. Using the disposal-date rate on the whole P&L conflates price gain with currency gain. Edge case 12 requires *"FX component separated in attribution"* but no formula is given anywhere, and `lot_disposals` carries no `fx_rate_to_base` column to separate them with. Corrected in §9.

### D7 — `positions.fees_total` / `taxes_total` scope is ambiguous

`PortfolioSummary.totalReturn` subtracts `fees` and `taxes`. But a **buy** fee is already capitalised into cost basis, and a **sell** fee already reduces realised P&L. If trade fees also accrued to `fees_total`, every fee would be subtracted twice. §4's pseudocode accrues only standalone `fee`/`tax` rows — correct — but nothing states the rule, and the column names invite the opposite reading. Pinned down in §5.4 and verified arithmetically in §7.2.

### D8 — `cash_settled = false` can silently corrupt an account balance

`FINANCIAL-DOMAIN.md` §3 defines the balance as summing `investment_transactions.net_amount` **unconditionally**. `SCHEMA.md` §6 says only that `cash_settled = true` moves cash "through the investment ledger only" — nothing constrains `net_amount` when the flag is `false`.

A `cash_settled = false` row with a non-zero `net_amount` (an ESOP allotment, a purchase settled from an untracked account) moves the brokerage balance by an amount no cash ever moved. Needs a `CHECK`, not a convention. Corrected in §4.2.

### D9 — no per-unit price primitive exists

`src/lib/decimal/` provides `Money` (scale 4), `Quantity` (scale 8), `Rate` (scale 10). The schema stores **every** per-unit figure at `numeric(20,8)`: `investment_transactions.price`, `tax_lots.cost_per_unit`, `lot_disposals.proceeds_per_unit`, `instrument_prices.close`, `instrument_quotes.price`.

There is no type for these. Reading a NAV of `123.45678900` into a `Money` **truncates to `123.4568`** at the read boundary. `INVESTMENT-DOMAIN.md` §5's `avgCost: Money // PRICE_SCALE, half_up` is type-incoherent — `Money` has no scale-8 form.

This is the one genuinely missing piece of Phase 2 infrastructure. Corrected in §3.

### D10 — `positions.ledger_version` cannot work as a staleness check

`ARCHITECTURE.md` §6 lists the `positions` rebuild trigger as *"version mismatch, or targeted rebuild"*. But `investment_ledger_version` is a **single per-user counter**: any mutation bumps it, so after one trade every position in the portfolio except the one just rebuilt has a lower version. A staleness comparison would report the entire portfolio stale forever and trigger endless full rebuilds.

The counter is correct; the described use is not. `positions.ledger_version` is a **provenance stamp** for audit and debugging. Staleness is impossible by construction because the rebuild runs inside the same database transaction as the ledger mutation. Stated explicitly in §6.3 so nobody implements the comparison.

### D11 — same-date ordering makes corporate actions depend on data-entry order

Replay order is `(trade_date, created_at, id)`. A split and a buy on the same `trade_date` therefore replay in whichever order the rows were *entered*: a backdated buy entered after the split is not scaled by it, while the same buy entered before it is. Same ledger, two different answers.

Economically the shares are held by end of day and the split then applies. **Corporate actions must sort last within a `trade_date`**, by an explicit kind rank, before `created_at`. Corrected in §5.1.

### D12 — missing indexes and a missing `user_id`

- **`lot_disposals` has no index at all.** Realised P&L over a period (`PortfolioSummary`, the net-worth change bridge, the disposals UI) filters on `closed_on` and would seq-scan. It also has **no `user_id`**, so every such query must join through `tax_lots` — against `SCHEMA.md`'s own stated convention.
- **`investment_transactions` has no user+date index.** `inv_txn_replay_idx` leads with `(user_id, account_id, instrument_id, …)`, so the ledger list view ("all investment transactions, newest first") sorts on every load. The money side already has `transactions_user_date_idx`; the investment side needs its mirror.
- **`positions` has no instrument-first index** for "which accounts hold X" and for allocation-by-instrument.

Corrected in §4.3.

### D13 — `investment_transactions` CHECK constraints have gaps

Absent, and each is cheap to add:

- No identity between `gross_amount` and `|quantity| × price` for trades.
- No identity for `net_amount` on `buy`/`sell` (`buy: net = −(gross + fees + taxes)`), while `dividend`/`interest` already have one.
- `split`/`bonus` do not force `quantity IS NULL`, `price IS NULL`, `net_amount = 0`.
- Non-corporate-action kinds do not force `ratio_num IS NULL`.
- Nothing requires `currency_code` to match the instrument's currency (cross-table — needs the service layer, §6.2).

`CHECK (instrument_id IS NOT NULL OR kind IN ('fee','tax','interest'))` is correct but exposes an unhandled case: **account-level `fee` and `interest` rows have no position to accrue to**, and `positions` is keyed by instrument. §3's *"or account-level if `instrument_id` is null"* names the case and nothing implements it. Resolved in §7.3.

### D14 — XIRR and TWR have undefined behaviour at the points that matter

- **XIRR scope handling is undefined for transfers.** `transfer_in` has a cash effect of `0` but is an acquisition. At portfolio scope a matched pair nets to zero correctly; at **instrument or account scope** an unmatched leg must enter the series at its basis or the return is meaningless. §8.1.
- **Whether brokerage cash is inside the portfolio is never stated.** It determines whether a received dividend is a return *to* the investor or an internal move. §8.1 fixes it: cash is outside; net worth counts it separately.
- **TWR's boundary convention is undefined** — a flow dated `D` belongs to the period ending `D` or the one starting `D`, and the two give different answers. §8.2.
- **TWR is unavailable at launch and this should be said out loud.** It needs `instrument_prices` history, which only `getHistoricalPrices()` populates, which needs the provider blocked on **OD-3**. Every equity TWR returns `null` with `insufficient_price_history` until that is resolved.

### D15 — a non-invariant that looks like an invariant

After a split, `Σ lot_disposals.quantity + tax_lots.remaining_quantity ≠ tax_lots.original_quantity`, because the split scales the lot's quantities but not the historical disposal rows. The relation is intuitive, will be assumed by whoever writes the integrity checker, and is **false by design**. Recorded in §12 as an explicit non-invariant.

---

## 3. Required primitive — `UnitPrice` (fixes D9)

A fourth scaled type in `src/lib/decimal/`, following the existing `Quantity`/`Rate` file structure exactly.

```ts
export const PRICE_SCALE = 8;
export const PRICE_MAX_UNITS = 10n ** 20n - 1n;      // NUMERIC(20,8)

export interface UnitPrice { readonly units: bigint }

UnitPrice.fromDbString(s): UnitPrice
UnitPrice.fromUnits(units: bigint): UnitPrice
UnitPrice.parseUserInput(s): Result<UnitPrice, ParseError>
UnitPrice.zero(): UnitPrice
```

Three cross-type operations, each with an explicit `Rounding` and no default:

```ts
/** quantity × price → Money.  scale 8 × scale 8 → scale 4. */
valueOf(q: Quantity, p: UnitPrice, c: CurrencyCode, r: Rounding): Money

/** money ÷ quantity → per-unit price.  Derives cost_per_unit and avgCost. */
perUnit(m: Money, q: Quantity, r: Rounding): UnitPrice        // throws on zero quantity

/** money × (num ÷ den) where both are quantities — exact proportional cost consumption. */
mulQtyRatio(m: Money, num: Quantity, den: Quantity, r: Rounding): Money
```

All three are single `divRound` calls over `bigint`s — no `number` appears. `mulQtyRatio` is what makes partial-lot cost consumption exact (§5.3).

`HoldingView.avgCost` and `PortfolioSummary` per-unit fields change type from `Money` to `UnitPrice`.

**Cost:** one new file, one barrel export, one unit-test file mirroring `tests/unit/quantity-rate.test.ts`, plus property tests. No runtime dependency.

---

## 4. Database changes required

Migration `0002_phase4_investments.sql`, generated by `drizzle-kit` from new Drizzle table files, applied **after** Phase 3's `0001`.

### 4.1 `tax_lots` — store exact money, derive the per-unit figure (fixes D2, D5)

```sql
CREATE TABLE tax_lots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  instrument_id      uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  opened_by_txn_id   uuid NOT NULL REFERENCES investment_transactions(id) ON DELETE CASCADE,

  opened_on          date NOT NULL,       -- when this lot row came into being
  acquired_on        date NOT NULL,       -- CHANGED: original acquisition, survives transfers (D5)

  original_quantity  numeric(28,8) NOT NULL CHECK (original_quantity > 0),
  remaining_quantity numeric(28,8) NOT NULL CHECK (remaining_quantity >= 0),

  cost_total         numeric(20,4) NOT NULL CHECK (cost_total >= 0),      -- NEW: exact, D2
  remaining_cost     numeric(20,4) NOT NULL CHECK (remaining_cost >= 0),  -- NEW: exact, D2

  currency_code      char(3) NOT NULL REFERENCES currencies(code),
  fx_rate_to_base    numeric(20,10) NOT NULL CHECK (fx_rate_to_base > 0),

  CHECK (remaining_quantity <= original_quantity),
  CHECK (remaining_cost     <= cost_total),
  CHECK ((remaining_quantity = 0) = (remaining_cost = 0))   -- drained together, always
);
```

`cost_per_unit` is **dropped as a stored column** and derived as `cost_total / original_quantity` at `PRICE_SCALE`. This is the same reasoning that already keeps `positions.avg_cost` out of the schema (`SCHEMA.md` §6.1): a derived money figure that is stored is a second figure free to drift.

The last `CHECK` is the one that matters — it makes "a lot with units but no basis" (or the reverse) unrepresentable.

### 4.2 `lot_disposals` — store money, make realised P&L a checkable identity (fixes D6, D12)

```sql
CREATE TABLE lot_disposals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- NEW (D12)
  lot_id             uuid NOT NULL REFERENCES tax_lots(id) ON DELETE CASCADE,
  closed_by_txn_id   uuid NOT NULL REFERENCES investment_transactions(id) ON DELETE CASCADE,
  closed_on          date NOT NULL,

  quantity           numeric(28,8) NOT NULL CHECK (quantity > 0),
  proceeds           numeric(20,4) NOT NULL,                    -- NEW: allocated share, exact
  cost_consumed      numeric(20,4) NOT NULL CHECK (cost_consumed >= 0),  -- NEW: exact
  realized_pnl       numeric(20,4) NOT NULL,

  fx_rate_to_base    numeric(20,10) NOT NULL CHECK (fx_rate_to_base > 0), -- NEW: disposal-date rate (D6)
  base_realized_pnl  numeric(20,4) NOT NULL,
  base_fx_component  numeric(20,4) NOT NULL,                    -- NEW: currency share of the P&L (D6)

  holding_days       integer NOT NULL CHECK (holding_days >= 0),

  CONSTRAINT lot_disposal_pnl_identity                          -- NEW: I-15
    CHECK (realized_pnl = proceeds - cost_consumed)
);
CREATE INDEX lot_disposals_user_closed_idx ON lot_disposals (user_id, closed_on DESC, id DESC);
CREATE INDEX lot_disposals_lot_idx         ON lot_disposals (lot_id);
CREATE INDEX lot_disposals_txn_idx         ON lot_disposals (closed_by_txn_id);
```

`realized_pnl = proceeds − cost_consumed` becomes a **database-enforced identity** rather than a hope. `proceeds_per_unit` and `cost_per_unit` are derived for display.

`holding_days = closed_on − lot.acquired_on` — from the acquisition, not the lot's creation (D5).

### 4.3 `positions`, `investment_transactions` — indexes and constraints (fixes D8, D12, D13)

```sql
-- positions: unchanged in shape; cost_basis is now Σ remaining_cost (exact).
CREATE INDEX positions_instrument_idx ON positions (user_id, instrument_id);

-- investment_transactions: the ledger list view (D12)
CREATE INDEX inv_txn_user_date_idx ON investment_transactions (user_id, trade_date DESC, id DESC);

-- Added CHECK constraints (D8, D13)
ALTER TABLE investment_transactions
  ADD CONSTRAINT inv_txn_unsettled_moves_no_cash            -- D8
      CHECK (cash_settled OR net_amount = 0),
  ADD CONSTRAINT inv_txn_gross_identity                     -- D13
      CHECK (kind NOT IN ('buy','sell','mf_purchase','mf_redemption','transfer_in','transfer_out')
             OR gross_amount = round(abs(quantity) * price, 4)),
  ADD CONSTRAINT inv_txn_buy_net_identity
      CHECK (kind NOT IN ('buy','mf_purchase')
             OR net_amount = -(gross_amount + fees + taxes)),
  ADD CONSTRAINT inv_txn_sell_net_identity
      CHECK (kind NOT IN ('sell','mf_redemption')
             OR net_amount = gross_amount - fees - taxes),
  ADD CONSTRAINT inv_txn_transfer_no_cash
      CHECK (kind NOT IN ('transfer_in','transfer_out') OR net_amount = 0),
  ADD CONSTRAINT inv_txn_corporate_action_shape             -- D13
      CHECK (kind NOT IN ('split','bonus')
             OR (quantity IS NULL AND price IS NULL AND gross_amount IS NULL
                 AND net_amount = 0 AND fees = 0 AND taxes = 0)),
  ADD CONSTRAINT inv_txn_ratio_only_on_corporate_actions
      CHECK (kind IN ('split','bonus') OR (ratio_num IS NULL AND ratio_den IS NULL));
```

`round(abs(quantity) * price, 4)` is immutable on `numeric`, so the database can enforce it — the same technique already used for `base_amount` in `transaction_entries`.

### 4.4 Unchanged

`instruments`, `instrument_prices`, `instrument_quotes`, `positions` (shape), and the `investment_kind` / `asset_class` / `cost_basis_method` enums are adopted from `SCHEMA.md` **as written**. One service-layer rule attaches to `instrument_quotes` — see §6.2 (D). No `portfolio_snapshots` table — see §8.3.

---

## 5. Financial calculation methodology

### 5.1 Replay order (fixes D11)

```
ORDER BY trade_date,
         kind_rank,        -- NEW: 0 = trades & income, 1 = split, 2 = bonus
         created_at,
         id
```

Corporate actions apply **after** all same-day trades: you hold the shares by end of day, then the ratio applies. `split` before `bonus` because a bonus on a split-adjusted base is the conventional reading. `kind_rank` is derived in the engine from `kind` — not a stored column — and the index `inv_txn_replay_idx` is unchanged, since sorting a single position's transactions in memory is free.

### 5.2 Lot representation

A lot carries **two exact `Money` values and two `Quantity` values**. Per-unit figures are derived, never stored:

```
cost_total          Money      exact acquisition cost of original_quantity, incl. capitalised buy fees
remaining_cost      Money      exact un-disposed portion of cost_total
original_quantity   Quantity
remaining_quantity  Quantity
acquired_on         Date       original acquisition; survives transfer_in
```

### 5.3 Disposal — exact by construction (fixes D3, D4)

```
dispose (sell | mf_redemption | transfer_out):
  slices = FIFO-select lots until |quantity| is covered   -- oversell → Result.err, nothing written

  -- Proceeds are ALLOCATED, never divided-then-multiplied (FINANCIAL-DOMAIN §10.2)
  if kind == 'transfer_out':
      proceeds_i = costConsumed_i           -- basis carried, realised P&L is exactly zero (D4)
  else:
      netProceeds = gross - fees - taxes    -- one exact Money from the row
      proceeds_i  = allocate(netProceeds, [take_1.units, … take_n.units])

  for each slice i:
      costConsumed_i = take_i == lot.remaining_quantity
                         ? lot.remaining_cost                                  -- drain exactly
                         : mulQtyRatio(lot.remaining_cost, take_i,
                                       lot.remaining_quantity, 'half_up')
      lot.remaining_cost     -= costConsumed_i
      lot.remaining_quantity -= take_i
      realized_i = proceeds_i - costConsumed_i
      holding_days_i = closed_on - lot.acquired_on
```

Two properties this buys, both asserted as tests:

- `Σ proceeds_i = netProceeds` **exactly** — `allocate` distributes the remainder largest-first, ties by index.
- `Σ costConsumed_i` over a lot's full life `= cost_total` **exactly** — because the final slice that drains a lot takes `remaining_cost` verbatim rather than recomputing it.

Therefore `Σ realized_pnl = netProceeds − Σ cost_consumed` exactly, and I-6 needs no tolerance.

### 5.4 Income, fees and taxes — the accrual rule (fixes D1, D7)

Stated once, because the ambiguity is what causes double-subtraction:

| Source | Where it goes | Never also in |
|---|---|---|
| `buy` fee, `buy` tax | capitalised into `tax_lots.cost_total` | `fees_total` / `taxes_total` |
| `sell` fee, `sell` tax | reduce `netProceeds` → reduce `realized_pnl` | `fees_total` / `taxes_total` |
| `dividend` / `interest` `gross_amount` | `positions.income_total` — **GROSS** | — |
| `dividend` / `interest` `fees` | `positions.fees_total` | — |
| `dividend` / `interest` `taxes` (TDS) | `positions.taxes_total` | `income_total` |
| standalone `fee` row | `positions.fees_total`, or portfolio-level if `instrument_id IS NULL` | — |
| standalone `tax` row | `positions.taxes_total`, or portfolio-level if `instrument_id IS NULL` | — |

The corrected engine branches, replacing §4's:

```
income (dividend | interest):
    position.income_total += gross_amount        -- GROSS (D1, I-12) — not net
    position.fees_total   += fees
    position.taxes_total  += taxes
    -- no lot is touched, ever

cost (fee | tax):
    position.fees_total / taxes_total += |net_amount|
```

**Trade fees and taxes appear in exactly one place: the cost basis or the realised P&L.** They are never in `fees_total`. Verified arithmetically in §7.2.

### 5.5 Corporate actions — exact by construction

```
split (ratio_num:ratio_den):
    for lot in open:
        lot.original_quantity  = qScale(original_quantity,  num, den, 'half_up')
        lot.remaining_quantity = qScale(remaining_quantity, num, den, 'half_up')
        -- cost_total and remaining_cost UNCHANGED

bonus (ratio_num:ratio_den):
    for lot in open:
        bonusQty = qScale(lot.remaining_quantity, num, den, 'half_up')
        lot.remaining_quantity += bonusQty
        lot.original_quantity  += bonusQty
        -- cost_total and remaining_cost UNCHANGED
```

**No money arithmetic occurs**, so total basis is preserved to the minor unit with no rounding argument to get wrong — satisfying `ROADMAP.md` Phase 4's "preserve total cost basis exactly". This is strictly better than the documented "recompute `cost_per_unit = totalCost / qty`", which rounds on every action.

Closed lots (`remaining_quantity = 0`) are not in the working array and are untouched — correct, since scaling them would corrupt settled disposal history. The consequence is the non-invariant in D15/§12.

Reverse split is `ratio_num < ratio_den`; quantity rounding at `QTY_SCALE = 8` is the only lossy step (edge case 8).

### 5.6 Rebuild

`rebuildPosition(userId, accountId, instrumentId)` is adopted from `INVESTMENT-DOMAIN.md` §4 unchanged, with two clarifications:

- It runs **inside the same database transaction** as the ledger mutation that triggered it. There is no window in which `positions` disagrees with the ledger.
- A mutation anywhere in a position's history re-replays that position's **entire** history — never an incremental patch (`ARCHITECTURE.md` §6). A backdated `sell` that oversells therefore fails the whole transaction and writes nothing.

---

## 6. Module layout

Following `FINANCIAL-DOMAIN.md` §11's test — *if removing the database would break it, it is a service; if it would not, it is engine.*

```
src/lib/decimal/
  price.ts                 UnitPrice, valueOf, perUnit, mulQtyRatio            [NEW, §3]

src/server/domain/          FINANCIAL ENGINE — pure, total, no I/O
  lots/engine.ts            replay(txns, method) → { lots, disposals, position }
  lots/fifo.ts              the FIFO MatchingStrategy (ADR-07's one seam)
  lots/order.ts             replay ordering incl. kind_rank                    [§5.1]
  pricing/valuation.ts      HoldingView, marketValue, unrealised, coverage
  pricing/allocation.ts     allocation(dimension), concentration, HHI
  calc/portfolio.ts         PortfolioSummary assembly
  calc/xirr.ts              Newton–Raphson + bisection fallback
  calc/twr.ts               chain-linked sub-period returns

src/server/services/        APPLICATION SERVICES — impure, transactional
  instruments.ts            CRUD; cost_basis_method change → full rebuild + audit
  investments.ts            create/update/delete investment transactions
  positions.ts              rebuildPosition, rebuildAll
  portfolio.ts              summary, holdings, allocation, performance
```

### 6.1 The write path

```
createInvestmentTransaction(ctx: WriteCtx, input) →
  1. VALIDATE    Zod parse
  2. AUTHORIZE   resolve account + instrument; requireOwnership; require active
  3. RESOLVE     FX rate for trade_date → base
  4. ENGINE      buildInvestmentRow() — signs derived from `kind`; caller never supplies one
  5. BEGIN
       INSERT investment_transactions
       rebuildPosition(user, account, instrument)      -- full replay; may return err(oversell)
       INSERT audit_log
       UPDATE user_state SET investment_ledger_version = investment_ledger_version + 1
     COMMIT                                            -- oversell → ROLLBACK, nothing written
  6. Invalidate: net_worth_snapshots on/after trade_date
```

Step 4 mirrors the money side's `buildEntries()`: the caller supplies a positive quantity and a `kind`; the engine decides the sign. This removes the largest class of data-entry bug on both ledgers.

### 6.2 Cross-table currency rules (fixes D13, D8)

Three rules the database cannot express, enforced in step 2 and by `verify:integrity`:

- `investment_transactions.currency_code` **must equal** `instruments.currency_code`.
- `instrument_quotes.currency_code` **must equal** `instruments.currency_code`. A provider returning a price in another currency is a `status: 'missing', reason: 'provider_error'`, not a silently mixed multiplication (D8's valuation analogue).
- The account's currency need **not** match — buying a USD ETF from an INR brokerage account is legitimate; `net_amount` is in the instrument currency and `deriveBalance()` already sums the account's own currency, so this is a Phase 3 contract to confirm (§11).

### 6.3 Cache invalidation (fixes D10)

`positions.ledger_version` is a **provenance stamp**, not a staleness check. Nothing compares it to `user_state.investment_ledger_version` to decide whether to rebuild, because a single global counter makes every non-rebuilt position look stale after any trade. Correctness comes from the rebuild sharing the mutation's transaction (§5.6). The stamp answers *"which ledger state produced this row"* for audit and for `verify:integrity`.

`ARCHITECTURE.md` §6's table needs its "version mismatch" trigger corrected to say this.

---

## 7. Portfolio metrics

### 7.1 Definitions

```
investedCapital = Σ positions.cost_basis            = Σ tax_lots.remaining_cost   (open positions)
costDeployed    = Σ tax_lots.cost_total             (ALL lots ever opened)
marketValue     = Σ valueOf(quantity, price)        (priced holdings only)
unrealizedPnl   = marketValue − investedCapital
realizedPnl     = Σ lot_disposals.realized_pnl
income          = Σ positions.income_total          (GROSS dividends + interest)
fees            = Σ positions.fees_total   + Σ account-level fee rows
taxes           = Σ positions.taxes_total  + Σ account-level tax rows
totalReturn     = unrealizedPnl + realizedPnl + income − fees − taxes

unrealizedReturnPct = investedCapital > 0 ? unrealizedPnl / investedCapital : null
totalReturnPct      = costDeployed    > 0 ? totalReturn   / costDeployed    : null
```

`costDeployed = Σ tax_lots.cost_total` is now a **plain sum of exact money** — no `original_quantity × cost_per_unit` product, so it survives splits and bonuses unchanged (§5.5). The two-denominator reasoning in `INVESTMENT-DOMAIN.md` §6 is adopted verbatim and is unaffected.

### 7.2 Arithmetic verification of the accrual rule

Worked end-to-end to prove no figure is counted twice (D7). Buy 100 @ ₹100 with ₹50 brokerage; ₹500 dividend with ₹50 TDS; sell 40 @ ₹150 with ₹30 brokerage; remainder marked at ₹160.

| Step | Effect |
|---|---|
| Buy | `cost_total = 10,050`  ·  cash −10,050 |
| Dividend | `income_total = 500` (gross), `taxes_total = 50`  ·  cash +450 |
| Sell 40 | `netProceeds = 5,970`; `costConsumed = 40/100 × 10,050 = 4,020`; `realized = 1,950`  ·  cash +5,970 |
| Remaining | `quantity = 60`, `remaining_cost = 6,030`; `marketValue = 9,600`; `unrealized = 3,570` |

```
totalReturn = 3,570 + 1,950 + 500 − 0 − 50 = 5,970
cross-check = marketValue + cash in − cash out
            = 9,600 + (450 + 5,970) − 10,050 = 5,970    ✓
```

The two agree **exactly**. The buy fee sits only in `cost_total`; the sale fee sits only in `realized_pnl`; only the dividend TDS reaches `taxes_total`. Adding trade fees to `fees_total` would give `5,890` — wrong by ₹80. This becomes a named test (§13, T-9).

`costDeployed = 10,050` → `totalReturnPct = 59.40%`; `investedCapital = 6,030` → `unrealizedReturnPct = 59.20%`. Using `investedCapital` for both would report `99.00%`.

The same arithmetic reproduces `INVESTMENT-DOMAIN.md` §6's fee-free worked example exactly (56% and 60%, not 93%).

### 7.3 Account-level fees and interest (fixes D13)

Rows with `instrument_id IS NULL` (annual demat charges, idle-cash interest) have no position to accrue to. They are summed **directly from the ledger** into `PortfolioSummary.fees` / `.interest` / `.taxes` and are attributed to no holding — so they reduce portfolio return without distorting any instrument's cost basis or weight. `positions.fees_total` therefore holds only instrument-attributed amounts, which is what makes the two sums disjoint.

### 7.4 Valuation and allocation

Adopted from `INVESTMENT-DOMAIN.md` §5 and §9 unchanged. `marketValue` is `null` when `price.status === 'missing'`; unpriced holdings are excluded from totals **and from `weightPct` denominators**, and reported as `unpricedCount` + `coverage`. `null` renders as `—` with a reason, never `0` — a zero reads as "worthless".

Positions with `quantity = 0` are retained for realised-P&L history and excluded from holdings display and allocation (edge case 18).

---

## 8. Performance methodologies

### 8.1 XIRR (fixes D14)

Solver adopted unchanged: Newton–Raphson on `NPV(r) = Σ cf_i / (1+r)^(d_i/365)`, seeded at `0.1`, bisection fallback over `[−0.9999, 10]`, tolerance `1e-7` of total inflow, 100 iterations, Actual/365 fixed. `Money → number` only at the module boundary; no monetary value returns.

**Two scope rules the design was missing:**

**Brokerage cash is outside the portfolio.** A dividend is a positive flow (money returned to the investor) and idle cash is not a terminal value — it is counted in net worth as an account balance (`FINANCIAL-DOMAIN.md` §9.1). This makes reinvestment net correctly: `+500` dividend then `−500` purchase sums to zero, while an un-reinvested dividend correctly remains a return.

**Transfers are scope-dependent:**

| Scope | `transfer_in` | `transfer_out` |
|---|---|---|
| Portfolio | excluded — a matched pair nets to zero | excluded |
| Account | outflow at `gross_amount` (the stated basis) | inflow at `gross_amount` |
| Instrument | outflow at `gross_amount` | inflow at `gross_amount` |

An unmatched leg at account or instrument scope is a real flow into or out of that scope. Treating a `transfer_in` as a zero flow because `net_amount = 0` would report an infinite return on shares that appeared from nowhere.

Returns `null` with a reason — never `0` — for: fewer than two flows, all flows same-sign (`no_sign_change`), non-convergence (`did_not_converge`), all flows on one date.

### 8.2 TWR (fixes D14)

Chain-linked sub-period returns bounded by external cash-flow dates, as documented. Two clarifications:

- **Boundary convention:** a flow dated `D` belongs to the period **starting** at `D`. Sub-period `i` is `(t_{i−1}, t_i]` valued at each boundary's close. Stated because the alternative gives different answers and the choice must not be accidental.
- With boundaries at every flow date there are no intra-period flows, so Modified Dietz degenerates to `r_i = (V_i − V_{i−1}) / V_{i−1}`. The weighted form is retained only for the case where two flows collapse onto one boundary.

**TWR returns `null` with `insufficient_price_history` for every instrument lacking a complete `instrument_prices` series across the window.** Until **OD-3** is resolved, that is every equity and ETF — only manually priced instruments and AMFI-sourced mutual funds will produce a figure. This is a launch limitation to state in the UI, not a bug to chase.

XIRR is the headline; TWR appears on the Performance page for benchmark comparison. Both are labelled with day-count and annualisation basis.

### 8.3 Historical portfolio snapshots — decision

`PROJECT-STATE.md` carries this as open debt: *"`PortfolioSnapshot` folded into `net_worth_snapshots.breakdown` (JSONB). Flagged for a decision before Phase 6."*

**Recommendation: do not add a `portfolio_snapshots` table.** It is a cache of a derivable value, and `ADR-06` plus `FINANCIAL-DOMAIN.md` §3 both say derive until measurement says otherwise. Portfolio value on any past date is `Σ (quantity held on D) × (price on D)` — both already stored, in `investment_transactions` and `instrument_prices`.

The performance chart is the one demanding read: 365 daily points. It must **not** be 365 replays. One SQL pass — a running quantity per instrument per day, joined to `instrument_prices` — produces the whole series. If that measures slow, the escape hatch is the same one already designed for balances: a derived roll-up keyed by `investment_ledger_version`, invalidatable and rebuildable, never a mutable record.

Honest limitation: the chart is only as complete as `instrument_prices`, which is empty until OD-3. Days without a price are gaps in the series, shown as gaps — not interpolated, and not zero.

---

## 9. Currency handling (fixes D6)

Adopted from ADR-12: every row stores native amount + currency + the `fx_rate_to_base` used + the derived base amount.

**Cost basis is held in the instrument's currency at the acquisition rate.** `tax_lots.fx_rate_to_base` is the rate on `acquired_on` and never changes — so `base_cost_basis` does not move when the rupee moves, which is what makes an FX gain a *gain* rather than a silent restatement of history.

**Realised P&L decomposition**, using `fl` = the lot's acquisition rate and `fd` = `lot_disposals.fx_rate_to_base` (the disposal-date rate):

```
base_realized_pnl = proceeds × fd − cost_consumed × fl
base_fx_component = cost_consumed × (fd − fl)
base_price_component = (proceeds − cost_consumed) × fd

  price + fx = (p−c)·fd + c·(fd−fl) = p·fd − c·fl = base_realized_pnl   ✓ identity holds
```

`base_fx_component` is stored; `base_price_component` is derived as the difference, so the two can never fail to sum. This is what edge case 12 requires and what the current schema cannot express.

`positions.base_cost_basis = Σ (remaining_cost × lot.fx_rate_to_base)` — summed per lot, because lots acquired at different times carry different rates. Not `cost_basis × today's rate`.

**Unrealised FX** is not separated at launch: `marketValue` uses the current rate and `investedCapital` the acquisition rates, so `unrealizedPnl` legitimately contains both effects. Separating it needs a per-lot revaluation the UI has no use for yet. Stated so it is a known limitation rather than a discovered surprise.

---

## 10. Integration points

### 10.1 With Money (Phase 3)

| Point | Contract |
|---|---|
| Brokerage account | An `accounts` row, `kind='brokerage'`. No parallel account table. |
| Bank → brokerage | An ordinary **transfer**. Not an expense, not an investment transaction. |
| Buying an instrument | Reduces brokerage cash **and** opens a lot, in one ledger. Net worth unchanged. |
| Balance | `deriveBalance()` sums `investment_transactions.net_amount` **unconditionally** — which is exactly why D8's `CHECK (cash_settled OR net_amount = 0)` is required. |
| Mirroring rows | **Forbidden** (I-13). Reporting may union the two ledgers; that is a read, not a row. |
| Investment income | Not money-domain income. A dividend never inflates the savings rate; it does raise the brokerage balance and portfolio income. |
| Investment purchases | Not expenses. Investment **fees and taxes** do reduce net worth, reported in portfolio metrics — never in `expenses`. |
| Recurring SIPs | `recurring_rules.kind='investment'` → an `investment_transactions` row via `recurring_occurrences.investment_transaction_id` (§0.1). |

### 10.2 With Net Worth (Phase 5)

The single-counting rule (`FINANCIAL-DOMAIN.md` §9.1) is adopted unchanged. The two rows that matter:

- **Cash in a brokerage account** is owned by `accounts.balance` — never also a "cash" holding or a cash allocation slice.
- **An instrument in a brokerage account** is owned by `positions.marketValue` — never also part of that account's balance.

These do not overlap **only because a purchase debits cash in the same ledger entry that creates the position**. That coupling is the mechanism; invariant I-4 asserts it.

The `contributions: Map<SourceKey, Money>` in `computeNetWorth()` is the enforcement — a duplicate `('position', accountId, instrumentId)` key throws in development rather than producing a wrong number in production.

Change-bridge components this phase must supply: `Σ lot_disposals.base_realized_pnl` by `closed_on` (the new `lot_disposals_user_closed_idx` exists for this), income and costs by period, and per-position market-value deltas net of contributions.

`ROADMAP.md` Phase 4 defers market value to Phase 6 — so Phase 4's net-worth contribution is at cost, with `null` and reason `no_price` everywhere market value is required.

### 10.3 With AI (Phases 7–9)

Unchanged and already correct. Recorded because it is on the review list:

- The AI reads through tools taking a `ReadCtx`; a caller with no `tx` and no `audit` **cannot** invoke a command — a `tsc` error, not a review comment.
- Every mutation goes `AI → ai_proposals → Zod → service validation → user confirmation → database`. `investment_transactions.ai_proposal_id` plus the partial unique index means one proposal can produce at most one row (I-14).
- **The AI performs no arithmetic.** `get_portfolio_summary` and `get_asset_allocation` return figures already computed by `src/server/domain/` — the same functions the screen calls, which is why an AI answer cannot disagree with the UI (`FINANCIAL-DOMAIN.md` §10.5).
- XIRR, TWR, cost basis and realised P&L are **never** model-derived. No exception, including "explain this number".

---

## 11. What Phase 3 must do differently

Consequences of this review that land on the **Financial Core**, not on Phase 4:

1. **`deriveBalance()` must take investment ledger rows as a parameter from day one** — `FINANCIAL-DOMAIN.md` §3 already defines the balance as summing both ledgers. Phase 3 must not ship a money-only signature that Phase 4 then has to widen.
2. **`recurring_occurrences.investment_transaction_id`** — create the column nullable, **without** the FK. Phase 4 adds the constraint (§0.1).
3. **`transactions.ai_proposal_id`** — same treatment; Phase 7 adds the constraint.
4. **`record_source` enum** must be created in Phase 3, since both ledgers use it.
5. **Confirm the account-currency contract** (§6.2): `deriveBalance()` sums `net_amount` in the account's currency, so a foreign-currency instrument bought from an INR account needs its cash effect expressed in the account's currency. Phase 3 should decide whether `net_amount` is instrument-currency or account-currency. **Recommendation: account currency**, with the instrument-currency gross retained on the row — otherwise the balance sums two currencies. *This is the one open item this review could not close from the documents alone.*

---

## 12. Invariants — revised

| # | Invariant | Change | Enforced by |
|---|---|---|---|
| I-5 | `Σ tax_lots.remaining_quantity = positions.quantity` | unchanged | integrity command |
| I-6 | `Σ tax_lots.remaining_cost = positions.cost_basis` | **exact — tolerance removed** (D2) | integrity command |
| I-7 | No negative `remaining_quantity`, no negative position | unchanged | `CHECK` + engine |
| I-12 | `income_total` accrues gross; `taxes_total` the withholding | **now matches the engine** (D1) | `CHECK` + engine |
| I-13 | No cash movement in both ledgers | unchanged | integrity command |
| **I-15** | `lot_disposals.realized_pnl = proceeds − cost_consumed` | **new** (D3) | `CHECK` |
| **I-16** | `cash_settled = false ⟹ net_amount = 0` | **new** (D8) | `CHECK` |
| **I-17** | `positions.base_cost_basis = Σ (remaining_cost × lot.fx_rate_to_base)` | **new** (D6) | integrity command |
| **I-18** | `base_realized_pnl = base_price_component + base_fx_component` | **new** (D6) | engine + integrity command |
| **I-19** | `(remaining_quantity = 0) = (remaining_cost = 0)` per lot | **new** (D2) | `CHECK` |

**Explicit non-invariant** (D15), recorded so the integrity checker does not assert it:

> `Σ lot_disposals.quantity + tax_lots.remaining_quantity` **does not** equal `tax_lots.original_quantity` once a split or bonus has touched a partially disposed lot. The corporate action scales the lot's quantities; settled disposal rows are historical records and are not rewritten. The **money** relation `Σ cost_consumed + remaining_cost = cost_total` **does** hold unconditionally, and is the one to assert.

---

## 13. Test strategy

All 20 edge cases in `INVESTMENT-DOMAIN.md` §12 are adopted as named tests. Phase 4's `ROADMAP` gate covers 1–14 and 18–19; 15–17 and 20 need prices and move to Phase 6. The engine is pure, so each is an array of transactions in, expected lots/disposals/position out — no database, no mocks.

**Tests this review adds**, each mapping to a defect that would otherwise ship:

| # | Test | Guards |
|---|---|---|
| T-1 | Dividend gross 500 / TDS 50 → `income_total = 500`, `taxes_total = 50`, contribution to `totalReturn` exactly `+450` — not 400, not 500 | D1 |
| T-2 | Sale spanning 3 lots → `Σ realized_pnl = netProceeds − Σ cost_consumed` **to the minor unit** | D3 |
| T-3 | 1:5 split then 1:1 bonus then a partial sell → `Σ cost_total` byte-identical before and after both actions | D2, D5 |
| T-4 | `transfer_out` → every disposal has `realized_pnl = 0`; destination `acquired_on` = **original** purchase date; `holding_days` on eventual sale measured from it | D4, D5 |
| T-5 | Buy and split on the same `trade_date`, entered in **both** orders → identical lots | D11 |
| T-6 | `cash_settled = false` with non-zero `net_amount` → rejected by the database, not merely by the service | D8 |
| T-7 | USD instrument, INR base, rate moves between buy and sell → `base_price_component + base_fx_component = base_realized_pnl` exactly | D6 |
| T-8 | NAV `123.45678900` round-trips through `UnitPrice` without loss; the same value through `Money` is asserted to **lose** precision (proving the test is real) | D9 |
| T-9 | The §7.2 worked example → `totalReturn = 5,970` by both the component sum and the cash cross-check | D7 |
| T-10 | Backdated `sell` that oversells → whole transaction rolls back; the ledger is byte-identical to before | D14/§5.6 |
| T-11 | Account-level `fee` (`instrument_id IS NULL`) → reduces `PortfolioSummary.fees` and portfolio return, appears in **no** position and in **no** allocation slice | D13 |

**Property tests** (fast-check is already a dependency):

- `Σ costConsumed + remaining_cost = cost_total` holds after **any** sequence of buys, sells, splits and bonuses.
- Incremental rebuild output is byte-identical to a full rebuild — the `ROADMAP` Phase 4 gate.
- Replay is order-stable: shuffling same-`trade_date` insertion order changes nothing after §5.1's `kind_rank`.

**Golden scenarios:** `L0` (average-cost drift) and `G2` (20 buys, 8 partial sells, 2 splits, 1 bonus, 6 dividends, fees) are hand-computed and checked into `tests/golden/`. `G3` (multi-currency) needs prices and moves to Phase 6. Per `TESTING.md`, every golden scenario asserts `unexplained ≈ 0` in the net-worth bridge.

**Not tested at Phase 4** and stated so the gate is honest: market value, unrealised P&L, allocation weights, XIRR and TWR against real prices. Phase 4 asserts they return `null` with reason `no_price` / `insufficient_price_history`. Each `null` test asserts **the reason**, never merely `null` — a test asserting only `null` passes against a function that always fails.

---

## 14. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Phase 3 does not exist**; Phase 4 cannot begin | **blocking** | Build Phase 3 first, with §11's five amendments |
| The `INVESTMENT-DOMAIN.md` §4 pseudocode is copied verbatim into the engine | **high** | D1, D3, D4 are wrong in the approved baseline; correct the document **before** implementing, not after |
| Trade fees double-subtracted in `totalReturn` | high | §5.4's accrual table + T-9's cash cross-check |
| Cost-basis drift across corporate actions | high | §5.5 touches no money at all; T-3 asserts byte-identity |
| Holding period lost across transfers → wrong LTCG/STCG | high | `acquired_on` (§4.1); T-4 |
| Prices unavailable at launch (**OD-3**) | medium | Phase 4 is priced-independent by design; `ManualProvider` is always registered; TWR honestly returns `null` |
| TWR silently unusable for every equity | medium | §8.2 states it; the UI shows the reason, not a blank |
| Performance chart is 365 replays | medium | §8.3's single-pass SQL; measure before caching |
| `instruments` is per-user (`UNIQUE (user_id, symbol, exchange)`) | low | Carried Phase 1 debt. Correct at one user; a migration, not a redesign |
| Unrealised FX not separated from price movement | low | §9 states it as a known limitation |
| `settlement_date` stored but unused | low | See §15 decision 2 |

---

## 15. Decisions needed

Everything else in this document is an engineering call already made. These three are not mine to make.

**1. Sequencing.** Phase 4 cannot start. The options are (a) build Phase 3 — Financial Core in full, then return to Phase 4 with this design applied, or (b) apply only the document corrections in §2 now and defer all implementation. **Recommendation: (a)**, with §11's amendments folded into Phase 3 so nothing has to be widened later.

**2. `settlement_date` semantics.** The column exists; `deriveBalance()` uses `trade_date`. In a T+1 market the cash actually moves a day later. **Recommendation: keep `trade_date` as the cash date** — the divergence lasts one day, affects no realised figure, and modelling settlement means a second date dimension on every balance query. Keep the column as a recorded fact and state in the UI that balances are trade-dated. Confirm, or drop the column.

**3. Amending the approved baseline.** `PROJECT-STATE.md`'s protocol makes a design correction a stop-and-explain event, which is why `INVESTMENT-DOMAIN.md` and `SCHEMA.md` are untouched. On approval, D1–D15 are applied to those documents and this file becomes the review record. **Confirm before those edits are made.**
