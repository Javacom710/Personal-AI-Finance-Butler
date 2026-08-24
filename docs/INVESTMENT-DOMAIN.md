# Investment & Portfolio Domain Model

Investments are a first-class part of the product, not a bolt-on. The investment ledger is the only truth; every holding, cost basis, and performance figure is derived from it ([ADR-06](DECISIONS.md#adr-06--holdings-are-derived-cached-and-rebuildable)).

## 1. Instruments

An `instruments` row describes *what* is held, independent of *how much*. Deliberately not coupled to any broker, exchange, or provider.

| Field | Purpose |
|---|---|
| `symbol` + `exchange` | Human-facing identity (`RELIANCE`/`NSE`, `VOO`/`NYSEARCA`, `BTC`/`null`) |
| `isin` | Stable cross-provider identifier where one exists |
| `asset_class` | Drives allocation, tax treatment hints, and default cost-basis method |
| `currency_code` | The currency the instrument is priced and transacted in |
| `price_provider` + `provider_symbol` | Which adapter fetches its price, and under what key. `NULL` = manual pricing |
| `cost_basis_method` | Selects the matching strategy for the cost basis engine. Default `fifo`; `average` and `specific_id` are interface-only at launch (§4) |
| `metadata` | Provider-specific extras (fund house, expense ratio, maturity date, coupon) |

Asset classes: `equity`, `mutual_fund`, `etf`, `bond`, `fixed_deposit`, `gold`, `crypto`, `cash_equivalent`, `other`. Adding a class is a migration on one enum plus an allocation label — no engine change, because the engine is class-agnostic.

**Fixed deposits and bonds** are modelled as instruments with a quantity of 1 (or face value) and a manual price that the user updates, or a computed accrual price in a later phase. This keeps them inside net worth and allocation without a separate subsystem.

## 2. Investment accounts

There is no separate investment account table. A brokerage or demat account is an `accounts` row with `kind='brokerage'` ([SCHEMA.md §4](SCHEMA.md#4-money-core)). Consequences:

- The cash sitting in a brokerage account is a normal account balance and appears in "liquid cash" if the user classifies it that way.
- Transferring money from a bank account into a brokerage account is an ordinary transfer — not an expense, not an investment transaction.
- Buying an instrument reduces the brokerage account's cash and creates a position. Net worth is unchanged by the purchase itself (cash → asset), which is the correct accounting — and it is **exact**, not approximate, because one ledger row carries `net_amount = −(gross + fees + taxes)` and opens a lot with `cost_total = gross + fees + taxes`. The cash falls by exactly what the lot gains, because they are two halves of one row ([FINANCIAL-DOMAIN.md §9.1](FINANCIAL-DOMAIN.md#91-the-single-counting-rule), invariant **I-25**).

### 2.1 Two currencies per transaction, and which one `net_amount` is in

An investment transaction can legitimately straddle two currencies: a USD ETF bought from an INR brokerage account. Three columns therefore mean three different things, and conflating any two of them produces a wrong balance.

| Column | Currency | Purpose |
|---|---|---|
| `price`, `gross_amount`, `fees`, `taxes` | **instrument currency** (`currency_code`) | What the trade was, in the instrument's own terms. Cost basis, realised P&L and every `positions` total are computed here. |
| `net_amount_instrument` | **instrument currency** | The cash effect in the instrument's terms. **Every per-kind identity holds here** — `net = gross − fees − taxes` and its siblings. |
| `fx_rate_instrument_to_account` | — | The dated rate between them. Exactly `1` when they are the same currency. |
| `net_amount` | **account currency** | The cash effect on `account_id`. This is what `deriveBalance()` sums. |
| `base_net_amount` | base currency | `round(net_amount × fx_rate_to_base, 4)`, for aggregation |

> **`net_amount` is denominated in the account's currency.** Account-balance derivation must never mix currencies.

This resolves decision **OD-5**. `deriveBalance()` ([FINANCIAL-DOMAIN.md §3](FINANCIAL-DOMAIN.md#3-accounts)) sums `opening_balance + Σ transaction_entries.amount + Σ investment_transactions.net_amount` into a single figure in the **account's** currency. If `net_amount` were in the instrument's currency, that sum would add dollars to rupees and produce a number that is not money in any currency — silently, with no constraint able to catch it.

**Why the cash effect is carried twice.** The per-kind identities — `buy: net = −(gross + fees + taxes)`, `dividend: net = gross − fees − taxes` — relate the cash effect to three **instrument-currency** figures. Stated on `net_amount`, they would equate an account-currency column with an instrument-currency expression: false for every row where the two differ, so a USD dividend paid into an INR brokerage account would be **rejected by the database**. Keeping `net_amount_instrument` puts each identity where all of its terms share a currency, and reduces the instrument→account step to a single checked multiplication. It is the same shape as `transaction_entries`' `amount → base_amount`, one link longer.

The conversion is **explicit and dated**, using the FX methodology in [FINANCIAL-DOMAIN.md §2](FINANCIAL-DOMAIN.md#2-fx) — exact `as_of` match, else the most recent earlier rate, else reject with `no_rate`. Never a default of 1 as a fallback; `1` appears only when the two currencies are genuinely the same.

**Everything in `positions` is in the instrument's currency** — `cost_basis`, `realized_pnl`, `income_total`, `fees_total`, `taxes_total`. So the engine accrues from the instrument-currency columns (`gross_amount`, `fees`, `taxes`, `net_amount_instrument`), never from `net_amount`. Mixing the two would put two currencies in one column with nothing able to detect it.

`cash_settled = false` means no cash moved at all, and therefore `net_amount = 0` **and** `net_amount_instrument = 0` — enforced by a `CHECK` (invariant I-16), because `deriveBalance()` sums `net_amount` **unconditionally** and a non-zero value on an unsettled row would move a balance no cash ever moved.

## 3. The investment ledger

`investment_transactions` is append-first: transactions are added, corrected, or deleted, and everything downstream is re-derived.

### Kinds and their effects

Cash effects are stated in the **instrument currency**; `net_amount` carries the same movement converted to the **account currency** ([§2.1](#21-two-currencies-per-transaction-and-which-one-net_amount-is-in)).

| Kind | Quantity | Cash effect | Lot effect |
|---|---|---|---|
| `buy`, `mf_purchase` | `> 0` | `−(gross + fees + taxes)` | opens a lot with `cost_total = gross + fees + taxes` |
| `sell`, `mf_redemption` | `< 0` | `+(gross − fees − taxes)` | closes lots FIFO, produces `lot_disposals` |
| `transfer_in` | `> 0` | `0` | opens a lot at the stated cost, **carrying the original `acquired_on`** (transfer between own accounts preserves basis *and* holding period) |
| `transfer_out` | `< 0` | `0` | closes lots FIFO with `realized_pnl = 0` **by construction**; basis carried to the destination |
| `dividend` | `null` | `+(gross − fees − taxes)` | **no lot change, ever.** Accrues **gross** to `positions.income_total`; `fees` to `fees_total`; withholding to `taxes_total` |
| `interest` | `null` | `+(gross − fees − taxes)` | same as dividend |
| `fee` | `null` | `− net` | none; accrues `\|net_amount_instrument\|` to `positions.fees_total` (or portfolio-level if `instrument_id` is null — [§6.2](#62-account-level-fees-interest-and-taxes)) |
| `tax` | `null` | `− net` | none; accrues `\|net_amount_instrument\|` to `positions.taxes_total` (or portfolio-level) |
| `split` | `null` | `0` | scales every open lot's quantities by `ratio_num/ratio_den`. **`cost_total` and `remaining_cost` are untouched** |
| `bonus` | `null` | `0` | adds `ratio_num/ratio_den ×` held units at **zero cost**. **`cost_total` and `remaining_cost` are untouched** |

**Fee and tax allocation — each amount is counted in exactly one place.** This table is normative; the double-subtraction it prevents is the most expensive error in the engine.

| Source | Accrues to | Never also to |
|---|---|---|
| `buy` / `mf_purchase` fees and taxes | capitalised into `tax_lots.cost_total` | `fees_total` / `taxes_total` |
| `sell` / `mf_redemption` fees and taxes | reduce net proceeds → reduce `realized_pnl` | `fees_total` / `taxes_total` |
| `dividend` / `interest` `gross_amount` | `positions.income_total` — **gross** | — |
| `dividend` / `interest` `fees` | `positions.fees_total` | `income_total` |
| `dividend` / `interest` `taxes` (TDS) | `positions.taxes_total` | `income_total` |
| standalone `fee` / `tax` row | `positions.fees_total` / `taxes_total`, or portfolio-level when `instrument_id IS NULL` | — |
| **`transfer_in` / `transfer_out`** | **nothing — a transfer carries no fees or taxes** (see below) | — |

**A transfer carries no fees or taxes**, enforced by `CHECK (kind NOT IN ('transfer_in','transfer_out') OR (net_amount = 0 AND fees = 0 AND taxes = 0))`. A demat transfer charge is recorded as a separate `fee` row.

That costs one extra row for an uncommon event and removes three edge cases that otherwise have no good answer: a fee on a `transfer_in` would make `net_amount ≠ 0` and contradict "no cash effect"; a fee on a `transfer_out` has no basis to capitalise into and no realised P&L to reduce, so it would silently vanish from total return; and capitalising a service charge into cost basis would understate every future gain. Recording it as a `fee` puts it in exactly one place, with the same treatment as any other non-trade charge.

**Trade fees never reach `fees_total`.** `totalReturn` subtracts `fees` and `taxes` ([§6](#6-portfolio-metrics)), and a purchase fee is already inside the cost basis while a sale fee has already reduced realised P&L — accruing either again would subtract it twice. Fees not attributable to a trade (annual demat charges) are recorded as `fee` with `instrument_id = NULL`; they reduce cash and portfolio return without touching any lot. The arithmetic is verified end-to-end in [§6.3](#63-worked-verification-that-nothing-is-counted-twice).

### Dividends and interest are income, never a cost reduction

A dividend **does not touch a lot.** `cost_total` is unchanged, `remaining_cost` is unchanged, `remaining_quantity` is unchanged, and the derived per-unit cost is therefore unchanged. It is a return *on* the investment, not a refund *of* it.

Why this matters beyond bookkeeping tidiness — reducing cost basis by the dividend would:

- **inflate every future realised gain**, because the disposal is measured against an artificially low cost. On a long-held dividend payer the cost basis can be driven toward zero, and the entire eventual sale is reported as capital gain.
- **misstate tax treatment.** Dividend income and capital gains are taxed differently and at different times. Folding one into the other makes the ledger unusable for tax purposes — which is the whole reason it is lot-based.
- **hide the return's composition.** "Did this holding earn ₹5,000 from price appreciation or from dividends?" becomes unanswerable, and the two are not equivalent.

The one legitimate cost-basis reduction is a **return of capital** distribution (a genuine refund of principal). That is a different corporate action, is not implemented at launch, and would be a distinct `kind` — never a `dividend` treated specially.

**Gross versus net.** Indian dividends attract TDS, so three numbers exist and must not be conflated:

```
gross_amount  500.0000   declared dividend          → income_total  += 500  (GROSS)
fees            0.0000   collection charges         → fees_total    +=   0
taxes          50.0000   TDS withheld               → taxes_total   +=  50
net_amount    450.0000   cash actually received     → account balance += 450
```

`income_total` accrues **gross**, `fees_total` accrues any collection charge, and `taxes_total` accrues the withholding — three separate accruals, because `totalReturn = … + income − fees − taxes`. The contribution to total return is then `500 − 0 − 50 = 450`, exactly the cash received.

Accruing income **net** of tax *and* recording the tax subtracts it twice (₹400 instead of ₹450). Accruing net and *not* recording the tax gives the right total return by accident, but reports the dividend as ₹450 when ₹500 was declared — which makes the ledger useless for tax purposes, the whole reason it is lot-based. Both are wrong; only gross-plus-separate-withholding is right. Enforced by invariant I-12 and a database `CHECK`, and asserted by edge case 5b.

**Taxes.** Recorded, never computed. This application does not model tax liability ([CLAUDE.md §19](../CLAUDE.md) excludes tax filing); it records taxes actually paid so returns are net of them.

### Ordering

The engine replays in `(trade_date, kind_rank, created_at, id)` order — a total order, so two transactions on the same date replay identically on every rebuild. This is why `inv_txn_replay_idx` exists.

**The date is always `trade_date`** ([ADR-22](DECISIONS.md#adr-22--financial-recognition-is-trade-dated-settlement_date-is-informational-metadata), resolving OD-6). It is the financial recognition date and the cash date for every kind in the table above. `settlement_date` is informational metadata: it is recorded, and it controls no recognition, no cash effect, no ordering and no rebuild. `ReplayTxn` carries no settlement field, so the engine cannot read it. No settlement-date-based cash movement exists, and settlement-aware accounting logic is out of scope for the current architecture.

**`kind_rank` puts corporate actions last within a `trade_date`:**

| Rank | Kinds |
|---|---|
| 0 | `buy`, `sell`, `mf_purchase`, `mf_redemption`, `transfer_in`, `transfer_out`, `dividend`, `interest`, `fee`, `tax` |
| 1 | `split` |
| 2 | `bonus` |

Without it, a split and a buy sharing a `trade_date` replay in whichever order the **rows were entered** — so a backdated purchase entered after the split is not scaled by it, while the same purchase entered before it is. One ledger, two different answers, decided by data-entry history. That is not determinism; it only looks like it, because `created_at` is a total order over rows rather than over economic events.

Rank 0 before rank 1 matches reality: the shares are held by end of day, and the ratio then applies to the holding. `split` before `bonus` because a bonus declared alongside a split applies to the split-adjusted base.

`kind_rank` is **derived in the engine from `kind`**, not stored — sorting one position's transactions in memory is free, and a stored rank is another column that can drift. `inv_txn_replay_idx` is unchanged.

## 4. Cost basis engine (default FIFO)

`src/server/domain/lots/engine.ts` — a pure function. **The method is a parameter, not an assumption.**

```ts
type CostBasisMethod = 'fifo' | 'average' | 'specific_id';

interface MatchingStrategy {
  readonly method: CostBasisMethod;
  select(open: Lot[], required: Quantity, txn: InvestmentTransaction): LotSlice[];
}

function replay(
  transactions: InvestmentTransaction[],   // one (account, instrument), in replay order
  method: CostBasisMethod,                 // from instruments.cost_basis_method
): Result<{ lots: TaxLot[]; disposals: LotDisposal[]; position: PositionTotals }, ReplayError>
```

Pure: no database, no clock, no I/O. It takes an array and returns the derived state, which makes every edge case a table-driven unit test.

### Why the method is pluggable but only one is implemented

The **disposal-matching strategy** is the only thing that varies between cost-basis methods. Everything else in the engine — lot opening, fee capitalisation, corporate actions, income accrual, position totals, the `Σ remaining_cost = cost_basis` invariant — is method-independent. Isolating that one decision behind `MatchingStrategy` means adding a method later is a new `select()` implementation plus its own test table, not a second engine.

| Method | Status | Notes |
|---|---|---|
| `fifo` | **Implemented; the default** | Matches Indian tax treatment for listed equity and mutual funds. Also the most informative: average cost is derivable from FIFO lots (`cost_basis / quantity`), while the reverse is not true. |
| `average` | Interface only | Would collapse open lots into one weighted-average lot on each disposal. Some jurisdictions and some fund accounting require it. |
| `specific_id` | Interface only | Requires a UI for the user to pick lots at sale time, which is a product decision, not just an engine one. |

`instruments.cost_basis_method` carries the setting per instrument, defaulting to `fifo` — so a future jurisdiction change or a single instrument needing different treatment is a data change, not a migration of the engine ([ADR-07](DECISIONS.md#adr-07--cost-basis-engine-with-a-pluggable-matching-strategy-default-fifo)).

**Changing an instrument's method is a rebuild, not a mutation.** It rewrites derived history: the service updates `cost_basis_method`, then triggers a full `rebuildPosition()` for every account holding that instrument inside the same transaction. Realised P&L on already-closed disposals will change, so the UI must warn before applying it, and the change is recorded in `audit_log`.

### Lot representation

A lot carries **two exact `Money` values and two `Quantity` values**. Every per-unit figure is derived, never stored:

```
cost_total          Money       exact acquisition cost of original_quantity, incl. capitalised fees
remaining_cost      Money       exact un-disposed portion of cost_total
original_quantity   Quantity
remaining_quantity  Quantity
acquired_on         Date        original acquisition — survives transfer_in
opened_on           Date        when this lot row came into being
```

`cost_per_unit` is **not a stored column**. It is `cost_total / original_quantity` at `PRICE_SCALE`, computed on read — the same reasoning that keeps `positions.avg_cost` out of the schema ([SCHEMA.md §6.1](SCHEMA.md#61-derived-investment-state-adr-06)): a derived money figure that is stored is a second figure free to drift from the first.

Holding money exactly and deriving the rate — rather than holding the rate and deriving money — is what makes [§4's rounding guarantees](#rounding-in-the-engine) hold with no tolerance.

### FIFO matching strategy

```
open: Lot[] = []          // ordered oldest-first
for txn in transactions (in replay order, see Ordering above):
  switch txn.kind:

    acquire (buy | mf_purchase | transfer_in):
      open.push({
        openedOn:   trade_date,
        acquiredOn: txn.original_acquired_on ?? trade_date,   -- transfer_in carries it forward
        originalQty: |quantity|, remainingQty: |quantity|,
        costTotal:   gross + fees + taxes,                    -- exact Money, no division
        remainingCost: gross + fees + taxes,                  -- transfer_in: fees = taxes = 0,
        txnId,                                                -- so costTotal is the carried basis
      })

    dispose (sell | mf_redemption | transfer_out):
      slices = []                                    -- FIFO selection, no money arithmetic yet
      remaining = |quantity|
      while remaining > 0:
        if open is empty: ERROR oversell             -- Result.err, nothing written. See below.
        lot  = open[0]
        take = min(lot.remainingQty, remaining)
        slices.push({ lot, take })
        remaining -= take
        if take == lot.remainingQty: open.shift()    -- WORKING array only; the row survives

      -- Proceeds are ALLOCATED across the slices, never divided-then-multiplied.
      if kind == 'transfer_out':
        proceeds[i] = costConsumed[i]                -- basis carried; realised P&L exactly zero
      else:
        netProceeds = gross - fees - taxes           -- one exact Money from the row
        proceeds    = allocate(netProceeds, [slices.take ...])   -- sums back to netProceeds

      for each slice i:
        costConsumed[i] = take == lot.remainingQty
              ? lot.remainingCost                    -- drains the lot exactly; no residue
              : mulQtyRatio(lot.remainingCost, take, lot.remainingQty, half_up)
        lot.remainingCost -= costConsumed[i]
        lot.remainingQty  -= take
        emit disposal {
          lot, take, proceeds[i], costConsumed[i],
          realized: proceeds[i] - costConsumed[i],
          holdingDays: trade_date - lot.acquiredOn,  -- from ACQUISITION, not from openedOn
        }

    split:                                           -- ratio_num : ratio_den
      for lot in open:
        lot.originalQty  = qScale(lot.originalQty,  ratio_num, ratio_den, half_up)
        lot.remainingQty = qScale(lot.remainingQty, ratio_num, ratio_den, half_up)
        -- costTotal and remainingCost UNTOUCHED. No money arithmetic occurs.

    bonus:                                           -- ratio_num : ratio_den
      for lot in open:
        bonusQty = qScale(lot.remainingQty, ratio_num, ratio_den, half_up)
        lot.remainingQty += bonusQty
        lot.originalQty  += bonusQty                 -- keeps remaining <= original
        -- costTotal and remainingCost UNTOUCHED. Basis spread over more units.

    income (dividend | interest):
      position.incomeTotal += gross_amount           -- GROSS, never net (I-12)
      position.feesTotal   += fees
      position.taxesTotal  += taxes
      -- no lot is touched, ever

    cost (fee | tax):
      position.feesTotal / taxesTotal += |net_amount_instrument|
      -- instrument currency, like every other positions total. NOT |net_amount|,
      -- which is the account's currency (§2.1).
```

**`transfer_out` produces zero realised P&L by construction**, not by a subtraction that happens to cancel: its proceeds are *defined* as the cost consumed. Moving your own shares between your own accounts cannot manufacture a taxable gain.

### Why disposal allocates instead of dividing

`FINANCIAL-DOMAIN.md` §10.2 is normative here: *"A split of one amount into parts uses `allocate`, which distributes the remainder deterministically so the parts sum back exactly. Never `amount / n` applied n times."*

Computing a `proceedsPerUnit` once and multiplying it per lot rounds twice, so a sale spanning three lots leaves a residue of a few minor units between `Σ realized_pnl` and `netProceeds − Σ cost_consumed`. That residue is silent, permanent, and lands in **realised P&L — a tax figure**.

Two properties the form above guarantees instead, both asserted as tests:

- `Σ proceeds[i] = netProceeds` **exactly** — `allocate` hands out the remainder largest-first, ties by index.
- `Σ costConsumed` over a lot's whole life `= cost_total` **exactly** — because the slice that drains a lot takes `remainingCost` verbatim rather than recomputing it.

Therefore `Σ realized_pnl = netProceeds − Σ cost_consumed` exactly, and invariant **I-15** (`realized_pnl = proceeds − cost_consumed`) is enforceable as a database `CHECK` rather than trusted.

### Closed lots are retained, never deleted

`open.shift()` removes a fully-consumed lot from the engine's **working array** so FIFO advances. It does **not** discard the lot: `replay()` emits every lot it ever opened, and a fully-disposed lot is persisted with `remaining_quantity = 0`.

This is load-bearing in three places, and deleting closed lots would silently break all three:

- `costDeployed` ([§6](#6-portfolio-metrics)) sums `cost_total` over **all** lots ever opened. Drop the closed ones and total return is computed against a shrinking denominator.
- `lot_disposals` rows reference `lot_id`; the parent must survive for realised-P&L history and holding-period classification to be reconstructable.
- A position sold down to zero keeps its row with `quantity = 0` (edge case 18) so realised P&L is not lost. Its lots must survive for the same reason.

`positions.cost_basis` sums `remaining_cost`, which is zero on a fully disposed lot, so retained closed lots contribute nothing to it. Retention costs storage, not correctness.

Closed lots are also **not** touched by corporate actions — they are absent from the `open` working array, and scaling them would corrupt settled disposal history. See the non-invariant note below.

### Rounding in the engine

**Money is held exactly; per-unit rates are derived.** A lot stores `cost_total` and `remaining_cost` as exact `Money` at `MONEY_SCALE = 4`; `cost_per_unit` is derived at `PRICE_SCALE = 8` for display and never participates in an accumulation.

That inversion is what removes the tolerance. Concretely:

| Operation | Money arithmetic performed | Exactness |
|---|---|---|
| Acquire | `cost_total = gross + fees + taxes` — addition only | exact |
| Split / bonus | **none** — only quantities are scaled | exact, unconditionally |
| Partial disposal | `mulQtyRatio` on the consumed share; the remainder stays in `remaining_cost` | exact in aggregate: the residue is retained, not discarded |
| Final disposal of a lot | takes `remaining_cost` verbatim | exact; drains to zero |

Invariant **I-6** is therefore `Σ tax_lots.remaining_cost = positions.cost_basis` — an **exact equality with no tolerance**, checkable by `verify:integrity` as a plain sum. The previous formulation (`Σ remaining_quantity × cost_per_unit`, "within one minor unit per lot") could not be exact, because it multiplied a rounded rate by a quantity on every read and recomputed that rate on every corporate action, compounding the error. An invariant with a tolerance is not an invariant.

Quantity rounding still occurs, at `QTY_SCALE = 8`, when a split ratio does not divide the held quantity evenly (edge case 8). It affects units, never basis.

**An explicit non-invariant.** After a split or bonus touches a partially disposed lot:

```
Σ lot_disposals.quantity + tax_lots.remaining_quantity  ≠  tax_lots.original_quantity
```

The corporate action scales the lot's quantities; already-settled disposal rows are historical records and are not rewritten. The relation is intuitive and **false by design** — `verify:integrity` must not assert it. The money relation is the one that holds unconditionally, and is the one to check:

```
Σ lot_disposals.cost_consumed + tax_lots.remaining_cost  =  tax_lots.cost_total
```

### Oversell

Selling more units than are held is a **data error, not a short position**. The engine returns `Result.err({ kind: 'oversell', instrumentId, tradeDate, shortBy })`. The UI surfaces it as "you are selling 50 units but only 30 are held as of this date — check for a missing purchase, bonus, or split". The transaction is **not** written. Shorting is out of scope at launch; when added it becomes a distinct `short_sell` kind rather than a negative position.

### Rebuild

```
rebuildPosition(userId, accountId, instrumentId):
  BEGIN
    DELETE lot_disposals WHERE lot_id IN (lots for this position)
    DELETE tax_lots      WHERE (user, account, instrument)
    txns = SELECT ... ORDER BY trade_date, created_at, id   -- index order
    txns = sortByReplayOrder(txns)                          -- applies kind_rank (see Ordering)
    result = replay(txns, instrument.cost_basis_method)
    INSERT lots, disposals
    UPSERT positions with result.position + current investment_ledger_version
  COMMIT
```

Full rebuild (`npm run rebuild:positions`) loops every `(account, instrument)` pair. It must produce byte-identical output to the incremental path — asserted in integration tests.

**The rebuild runs inside the same database transaction as the ledger mutation that triggered it.** There is no window in which `positions` disagrees with the ledger, and a replay that fails — an oversell introduced by a backdated sell — rolls the whole mutation back rather than leaving derived state behind (edge case 30). A mutation anywhere in a position's history re-replays that position's **entire** history; there is no incremental-patch path, because incremental patching is where derived state drifts ([ARCHITECTURE.md §6](ARCHITECTURE.md#6-cache-invalidation)).

**`positions.ledger_version` is a provenance stamp, not a staleness check.** Nothing compares it against `user_state.investment_ledger_version` to decide whether to rebuild. `investment_ledger_version` is a single per-user counter, so after any trade every position except the one just rebuilt carries a lower value — a staleness comparison would report the whole portfolio stale forever and trigger endless full rebuilds. Correctness comes from the shared transaction above; the stamp answers *"which ledger state produced this row"* for audit and for `verify:integrity`.

## 5. Valuation

`src/server/domain/pricing/` combines positions with prices.

```ts
interface HoldingView {
  instrument: Instrument;
  quantity: Quantity;
  avgCost: UnitPrice;           // cost_basis / quantity, PRICE_SCALE, half_up
  invested: Money;              // = cost_basis = Σ remaining_cost
  price: PriceResult;           // discriminated union, ADR-11
  marketValue: Money | null;    // null when price.status === 'missing'
  unrealizedPnl: Money | null;
  returnPct: Rate | null;
  weightPct: Rate | null;       // of the priced portion of the portfolio
}
```

```
marketValue   = valueOf(quantity, price)        (half_up at MONEY_SCALE)
unrealizedPnl = marketValue − invested
returnPct     = invested > 0 ? unrealizedPnl / invested : null
```

### `UnitPrice` — the per-unit scaled type

Every per-unit figure in the schema is `numeric(20,8)`: `investment_transactions.price`, `instrument_prices.close`, `instrument_quotes.price`, and the derived `cost_per_unit` / `proceeds_per_unit`. `Money` is scale 4, so reading a NAV of `123.45678900` into a `Money` **truncates it to `123.4568`** at the read boundary.

`src/lib/decimal/price.ts` therefore adds a fourth scaled type alongside `Money`, `Quantity` and `Rate`, following the same construction rules ([FINANCIAL-DOMAIN.md §1](FINANCIAL-DOMAIN.md#1-money-and-exact-arithmetic)):

```ts
const PRICE_SCALE = 8;
interface UnitPrice { readonly units: bigint }        // NUMERIC(20,8)

valueOf(q: Quantity, p: UnitPrice, c: CurrencyCode, r: Rounding): Money   // qty × price → scale 4
perUnit(m: Money, q: Quantity, r: Rounding): UnitPrice                    // money ÷ qty → scale 8
mulQtyRatio(m: Money, num: Quantity, den: Quantity, r: Rounding): Money   // exact proportional cost
```

All three are a single `divRound` over `bigint`s; no `number` appears. `mulQtyRatio` is what makes partial-lot cost consumption exact ([§4](#fifo-matching-strategy)). Like every other lossy operation, each takes an explicit `Rounding` with no default.

**A price is only usable when its currency matches the instrument's.** `instrument_quotes.currency_code ≠ instruments.currency_code` is a provider error, surfaced as `status: 'missing', reason: 'provider_error'` — never a silently mixed multiplication. The database cannot express this cross-table rule; the market-data layer and `verify:integrity` enforce it.

**Unpriced holdings.** `marketValue` is `null`, the holding is excluded from portfolio totals and from `weightPct` denominators, and the portfolio summary reports `pricedValue`, `unpricedCount`, and `coverage = pricedCostBasis / totalCostBasis`. Rendering shows the holding with an explicit "no price" marker rather than a zero, because a zero would read as "worthless".

### 5.1 Market value of a position as of a date

The same three factors the portfolio uses, stated as a dated function because net worth at
`basis: 'market'` consumes it ([FINANCIAL-DOMAIN.md §9.3](FINANCIAL-DOMAIN.md#93-calculation)):

```
marketValue(p, T) = quantityHeldOn(p, T) × priceOn(p.instrument, T) × fxRateOn(p.instrument.currency → base, T)
```

`quantityHeldOn` and the bounded `priceOn` are defined in [§8.1](#81-portfolio-growth-over-time) — the
same definitions, not a second copy. Two properties carry over and are worth naming here:

- **Quantity is where corporate actions bite.** Money is invariant under a split or bonus, so the
  *cost* form needs no ratio arithmetic; market value is a quantity figure and does. `Σ quantity` is
  wrong after any corporate action (**I-46**).
- **A suppressed instrument yields no market value at all.** An unreconciled split makes price and
  quantity sit on opposite sides of the action, so the position is excluded rather than valued
  ([ADR-29](DECISIONS.md#adr-29--provider-corporate-actions-are-detections-never-ledger-writes)).

**Why a holding is unpriced is part of the answer, not a footnote.** `MissingPriceReason` distinguishes seven conditions, because they call for different responses from both the system and the user:

| Reason | Meaning | Retry? |
|---|---|---|
| `no_provider` | No adapter claims it and no manual price exists | no — the user acts |
| `not_found` | The provider ran and does not know the symbol | no — re-map. **History is never deleted** |
| `provider_error` | The provider failed, **or** returned a currency that is not the instrument's | yes |
| `rate_limited` | Quota exhausted; the last good quote stands | yes, honouring `retryAfterSeconds` |
| `unsupported_asset` | An adapter exists but cannot price this class — a fixed deposit has no market price | no |
| `delisted` | The instrument has stopped trading. Cost basis and realised P&L are unaffected | no |
| `unreconciled_corporate_action` | A provider action with an ex-date inside the holding period is not in the ledger ([§11](#11-corporate-actions)) | no — the user records the action |

Collapsing `not_found` into `provider_error` would make a permanent condition look transient and produce an infinite retry; collapsing `rate_limited` into it would do the reverse.

## 6. Portfolio metrics

```ts
// EVERY monetary field below is in the BASE currency. A portfolio spans instruments in
// different currencies, so a summary in "the instrument currency" is not a number.
// Sources are therefore the base-denominated columns: positions.base_cost_basis,
// lot_disposals.base_realized_pnl, and instrument-currency totals converted at the
// rates in force. Per-holding figures in HoldingView stay in the instrument currency.
interface PortfolioSummary {
  investedCapital: Money;       // Σ positions.base_cost_basis over OPEN positions
                                // = Σ (tax_lots.remaining_cost × lot.fx_rate_to_base)
                                // — capital currently at risk
  costDeployed: Money;          // Σ (tax_lots.cost_total × lot.fx_rate_to_base) over ALL lots
                                // ever opened, including closed — capital ever committed
  marketValue: Money;           // priced holdings only
  unrealizedPnl: Money;         // marketValue − investedCapital
  realizedPnl: Money;           // Σ lot_disposals.base_realized_pnl
  dividends: Money;             // GROSS declared, per I-12
  interest: Money;              // GROSS declared
  fees: Money;                  // Σ positions.fees_total  + portfolio-level fee rows (§6.2)
  taxes: Money;                 // Σ positions.taxes_total + portfolio-level tax rows (§6.2)
  totalReturn: Money;           // unrealized + realized + dividends + interest − fees − taxes

  unrealizedReturnPct: Rate | null;  // unrealizedPnl / investedCapital
  totalReturnPct: Rate | null;       // totalReturn / costDeployed
  xirr: Rate | null;
  twr: Rate | null;
  coverage: Rate;               // 0..1
  asOf: Date;
  staleInstruments: InstrumentRef[];
}
```

### Two denominators, and why using one for both is wrong

Once any position has been **partially sold**, "invested capital" and "capital deployed" diverge, and picking the wrong one inflates the return.

Buy 100 @ ₹100, sell 40 @ ₹150, remainder worth ₹160:

| | |
|---|---|
| `investedCapital` (60 units still held × ₹100) | ₹6,000 |
| `costDeployed` (100 units ever bought × ₹100) | ₹10,000 |
| `realizedPnl` | ₹2,000 |
| `unrealizedPnl` (₹9,600 − ₹6,000) | ₹3,600 |
| `totalReturn` | ₹5,600 |

- `unrealizedReturnPct = 3600 / 6000` = **60%** — correct. Both numerator and denominator describe the *same* 60 units.
- `totalReturnPct = 5600 / 10000` = **56%** — correct. The ₹2,000 realised gain was earned by the 40 units that have since left; charging it against the ₹6,000 still invested would credit the remaining units with a profit they did not make.
- `5600 / 6000` = **93%** — **wrong, and it is the default mistake.** It mixes a numerator spanning 100 units with a denominator spanning 60.

`totalReturnPct` is **not** annualised, and it has a known weakness: `costDeployed` accumulates across round trips, so buying and selling the same ₹10,000 ten times shows ₹100,000 deployed and a small-looking percentage. That is why **XIRR is the headline figure** — it is money-weighted and handles both the size and the timing of every flow. `totalReturnPct` is a supporting figure and must be labelled *on capital deployed* wherever it appears.

Both denominators are now **plain sums of exact `Money`** — `Σ remaining_cost` and `Σ cost_total`. Neither multiplies a per-unit rate by a quantity, so neither moves when a split or bonus rescales the units underneath them ([§4](#rounding-in-the-engine)).

### 6.2 Account-level fees, interest and taxes

`investment_transactions` permits `instrument_id IS NULL` for `fee`, `tax` and `interest` — annual demat charges, idle-cash interest. These have **no position to accrue to**, because `positions` is keyed by instrument.

They are summed **directly from the ledger** into `PortfolioSummary.fees` / `.taxes` / `.interest` and attributed to no holding. So they reduce portfolio return without distorting any instrument's cost basis, return percentage, or allocation weight.

`positions.fees_total` and `positions.taxes_total` therefore hold **only instrument-attributed amounts**. That is what makes the two sums disjoint and the addition in §6's interface safe.

### 6.3 Worked verification that nothing is counted twice

The accrual rules in [§3](#kinds-and-their-effects) and the two denominators above are load-bearing together. Verified end to end:

> Buy 100 @ ₹100 with ₹50 brokerage · ₹500 dividend with ₹50 TDS · sell 40 @ ₹150 with ₹30 brokerage · remainder marked at ₹160.

| Step | Effect |
|---|---|
| Buy | `cost_total = 10,050` · cash −10,050 |
| Dividend | `income_total = 500` (gross), `taxes_total = 50` · cash +450 |
| Sell 40 | `netProceeds = 5,970`; `cost_consumed = mulQtyRatio(10,050, 40, 100) = 4,020`; `realized = 1,950` · cash +5,970 |
| Remainder | `quantity = 60`, `remaining_cost = 6,030`; `marketValue = 9,600`; `unrealized = 3,570` |

```
totalReturn = unrealized + realized + income − fees − taxes
            = 3,570     + 1,950    + 500    − 0    − 50     = 5,970

cross-check = marketValue + cash in − cash out
            = 9,600 + (450 + 5,970) − 10,050                = 5,970    ✓
```

The two agree **exactly**. The ₹50 buy fee lives only in `cost_total`; the ₹30 sale fee lives only in `realized_pnl`; only the ₹50 TDS reaches `taxes_total`. Adding trade fees to `fees_total` as well would give ₹5,890 — **wrong by ₹80**, the sum of the two brokerage charges. This is a named test.

Denominators: `costDeployed = 10,050` → `totalReturnPct = 59.40%`. `investedCapital = 6,030` → `unrealizedReturnPct = 59.20%`. Using `investedCapital` for both would report **99.00%**.

### 6.4 Foreign-currency positions

Cost basis is held in the **instrument's** currency, at the rate in force on acquisition. `tax_lots.fx_rate_to_base` is the rate on `acquired_on` and **never changes** — which is what makes a currency movement a *gain* rather than a silent restatement of history. Revaluing the lot at today's rate would make last year's cost basis move every morning.

`positions.base_cost_basis = Σ (remaining_cost × lot.fx_rate_to_base)`, summed **per lot**, because lots acquired at different times carry different rates. It is not `cost_basis × today's rate`.

**Realised P&L decomposition.** With `fl` = the lot's acquisition rate and `fd` = `lot_disposals.fx_rate_to_base` (the rate on the disposal date):

```
base_realized_pnl    = proceeds × fd  −  cost_consumed × fl
base_fx_component    = cost_consumed × (fd − fl)
base_price_component = (proceeds − cost_consumed) × fd

  price + fx = (p−c)·fd + c·(fd−fl) = p·fd − c·fl = base_realized_pnl        ✓
```

`base_fx_component` is **stored**; `base_price_component` is **derived as the difference**, so the two can never fail to sum to the total (invariant **I-18**). Storing both would be a second figure free to drift; storing neither would make edge case 12's "FX component separated in attribution" uncomputable after the fact, because the acquisition rate is not recoverable from the disposal row alone.

Applying the disposal-date rate to the whole P&L — the obvious shortcut — conflates the price gain with the currency gain and reports both as investment performance.

**Unrealised FX is not separated at launch.** `marketValue` uses the current rate while `investedCapital` uses acquisition rates, so `unrealizedPnl` legitimately contains both effects. Separating it needs a per-lot revaluation that no screen currently consumes. Stated as a known limitation so it is not later discovered as a bug.

## 7. XIRR

`src/server/domain/calc/xirr.ts`.

**Cash-flow construction** — from the investor's perspective, one series per scope (whole portfolio, one account, one instrument):

| Event | Sign |
|---|---|
| Purchase (incl. fees) | negative (money out) |
| Sale proceeds (net of fees/taxes) | positive |
| Dividend / interest received | positive |
| Standalone fee / tax | negative |
| Current market value of open positions at `asOf` | positive terminal flow |

**Brokerage cash is outside the portfolio.** A dividend is a positive flow — money returned to the investor — and idle cash is **not** part of the terminal value. Net worth counts that cash separately as an account balance ([FINANCIAL-DOMAIN.md §9.1](FINANCIAL-DOMAIN.md#91-the-single-counting-rule)), so including it here would count it twice and make the return depend on how much cash happened to be sitting uninvested.

This makes reinvestment net correctly: a ₹500 dividend followed by a ₹500 purchase contributes `+500` then `−500` — zero, which is right, because nothing left the portfolio. An un-reinvested dividend correctly remains a `+500` return.

**Transfers are scope-dependent**, because `net_amount = 0` describes the *cash* effect, not the *scope* effect:

| Scope | `transfer_in` | `transfer_out` |
|---|---|---|
| Portfolio | excluded — a matched pair nets to zero | excluded |
| Account | outflow at `gross_amount` | inflow at `gross_amount` |
| Instrument | outflow at `gross_amount` | inflow at `gross_amount` |

At account or instrument scope an unmatched leg is a real flow into or out of that scope. Treating a `transfer_in` as a zero flow because no cash moved would report an infinite return on shares that appeared from nowhere.

**Solver.** Newton–Raphson on `NPV(r) = Σ cf_i / (1+r)^(d_i/365)`, seeded at `r = 0.1`, with bisection fallback over `[-0.9999, 10]` when Newton diverges or leaves the bracket. Tolerance `1e-7` on NPV expressed as a fraction of total inflow; maximum 100 iterations.

**Returns `null` when:**
- fewer than two cash flows,
- all cash flows have the same sign (no root exists),
- the solver fails to converge,
- all flows fall on the same date.

`null` renders as `—` with a tooltip explaining why. **Never** substitute 0.

**Precision.** This is the one place `number` is used ([ADR-04](DECISIONS.md#adr-04--money-is-an-exact-scaled-integer-never-a-float)). `Money` values are converted to `number` at the module boundary, the solver runs in floating point (correct — it is a root-finding problem, not an accounting one), and the resulting rate is rounded to 6 decimal places and returned as a `Rate`. No monetary value ever comes back out of this module.

**Day count.** Actual/365 fixed. Documented on screen next to the figure.

## 8. Time-weighted return

`src/server/domain/calc/twr.ts`. Modified Dietz per sub-period, chain-linked:

```
For each sub-period [t_{i-1}, t_i] bounded by external cash-flow dates:
  r_i = (V_i − V_{i-1} − C_i) / (V_{i-1} + Σ_j w_j·c_j)
        where C_i = net external flows in the period,
              w_j = (t_i − t_j) / (t_i − t_{i-1})

TWR = Π(1 + r_i) − 1        (annualised over ≥1y: (1+TWR)^(365/days) − 1)
```

**Boundary convention: a flow dated `D` belongs to the period *starting* at `D`.** Sub-period `i` is the half-open interval `(t_{i−1}, t_i]`, valued at each boundary's close. This is stated because the alternative assignment gives a different answer, and the choice must be deliberate rather than an artefact of how the loop was written.

With a boundary at every flow date there are no intra-period flows, so `C_i = 0`, the weighting term vanishes, and Modified Dietz degenerates to `r_i = (V_i − V_{i−1}) / V_{i−1}`. The weighted form above is retained only for the case where two flows collapse onto one boundary.

TWR requires valuations at sub-period boundaries, which requires `instrument_prices` history. When history is incomplete, TWR returns `null` with `reason: 'insufficient_price_history'` rather than a figure computed from partial data.

**At launch that is every equity and ETF.** `instrument_prices` is populated only by `getHistoricalPrices()`, which needs the commercial provider blocked on decision **OD-3** ([§10](#10-market-data-architecture)). Until it is resolved, only manually priced instruments and AMFI-sourced mutual funds produce a TWR figure. This is a stated launch limitation shown in the UI as the `insufficient_price_history` reason — not a defect to chase, and not grounds for substituting a partial figure.

**Which to show where.** XIRR is the headline (it answers "what return did *my* money earn"). TWR is shown on the Performance page for comparing against a benchmark, since it removes the effect of contribution timing. Both are labelled with their day-count and annualisation basis.

### 8.1 Portfolio growth over time

`CLAUDE.md <investment_management>` requires **portfolio growth** as a deterministic figure. It is **derived, not stored** — there is no `portfolio_snapshots` table.

```
portfolioValueOn(d) = Σ over instruments:
      quantityHeldOn(instrument, d)          -- see below: NOT a plain running sum
    × priceOn(instrument, d)                 -- instrument_prices row with the greatest as_of <= d
    × fxRateOn(instrument.currency, base, d)
```

Both inputs are already stored — `investment_transactions` and `instrument_prices` — so a snapshot table would be a cache of a derivable value, which [ADR-06](DECISIONS.md#adr-06--holdings-are-derived-cached-and-rebuildable) and [FINANCIAL-DOMAIN.md §3](FINANCIAL-DOMAIN.md#3-accounts) both say not to build until measurement demands it.

**`quantityHeldOn` is not `Σ quantity where trade_date <= d`.** A `split` and a `bonus` carry `quantity IS NULL` and a **ratio**, so a plain running sum over the ledger silently ignores them and reports the pre-split quantity forever after. Two correct forms:

```
quantityHeldOn(i, d) = Σ_{txn ≤ d} txn.quantity × Π{ ratio of every corporate action in (txn.trade_date, d] }
```

— a cumulative ratio product per instrument, expressible as one window pass — **or** `replay()` bounded at `d`, which is exact by construction but is one replay per point. Whichever is used, the split must be applied; a chart that is silently wrong after every corporate action is worse than no chart.

**The money form has no such hazard, which is why Phase 5 uses it.** `replay()` leaves `cost_total` and `remaining_cost` **untouched** by both `split` and `bonus` ([§4](#4-cost-basis-engine-default-fifo)) — the basis is spread over more or fewer units and only the *derived* per-unit cost changes. So a cost-basis-as-of figure needs no ratio arithmetic at all:

```
baseCostBasisAsOf(d) = Σ over tax_lots ℓ with ℓ.opened_on <= d:
      (ℓ.cost_total − Σ lot_disposals.cost_consumed where lot_id = ℓ AND closed_on <= d)
    × ℓ.fx_rate_to_base
```

This is exact, not approximate, for three reasons: money is invariant under corporate actions; FIFO's total order `(trade_date, kind_rank, created_at, id)` gives replay a **prefix property**, so the disposals dated `≤ d` in a full replay are exactly those a replay bounded at `d` would produce; and invariant **I-20** makes the subtraction residue-free. At `d = today` it reproduces `Σ positions.base_cost_basis` exactly (**I-24**).

Eligibility is by **`opened_on`**, never `acquired_on` — a `transfer_in` carries the original acquisition date back, and using it would place the destination lot in the destination account while the source lot is still open, double-counting the whole intervening period (**I-23**).

**Implementation constraint, because the naive form is a trap.** A 365-point chart must be **one SQL pass** — not 365 position replays. If that measures slow, the escape hatch is the one already designed for balances: a derived roll-up keyed by `investment_ledger_version`, invalidatable and rebuildable, **never** a mutable record.

**`priceOn(d)` carries back, but not indefinitely.** "The row with the greatest `as_of <= d`" is required — Sundays, market holidays and TWR boundary dates all need it. Unbounded, it lies: an instrument whose provider stopped covering it in 2024 would be valued at its 2024 close forever, with no gap shown anywhere. So the carry-back is **bounded**, and beyond the bound the point is a gap:

| Cadence | Bound |
|---|---|
| `eod` (equities, ETFs), `nav` (mutual funds) | The latest known session on that exchange, plus an absolute backstop of **10 calendar days** |
| `continuous` | **2 calendar days** — there are no non-trading days to forgive |

The backstop is what turns "the provider quietly stopped" from an invisible wrong number into a visible gap.

**Days with no price are gaps, not zeros.** The series is only as complete as `instrument_prices`. AMFI fills it for Indian mutual funds; equities and ETFs wait on the **OD-3** adapter. A gap renders as a break in the line with the affected instruments named — never interpolated, never zero, and never silently omitted from the total ([§5](#5-valuation), [FINANCIAL-DOMAIN.md §10.4](FINANCIAL-DOMAIN.md#104-partial-results-are-labelled-not-hidden)).

**A TWR boundary needs a valuation, and a boundary can fall on a non-trading day.** `twr()` matches boundary dates exactly, so a SIP debit dated on a market holiday would otherwise return `insufficient_price_history` permanently — which is every Indian investor with a monthly SIP. The **caller** builds a valuation for every boundary using the bounded carry-back above; `twr()` itself is unchanged. The boundary set must also include **instruments since fully disposed**: a position sold in March still determined the January and February sub-period returns, and reading *current* positions to decide which prices to fetch produces a plausible, wrong figure.

## 9. Asset allocation

```
allocation(dimension) = [{ key, label, marketValue, weightPct, costBasis, unrealizedPnl }]
```

Dimensions: `asset_class`, `instrument`, `account`, `currency`, `country`. Weights are over **priced** market value; the response includes `unpricedValue` so the UI can show "94% of portfolio classified; 2 holdings unpriced".

Concentration metrics (for the AI's "how concentrated is my portfolio?"): top-1 / top-3 / top-5 weight, count of holdings above 10% weight, and the Herfindahl–Hirschman index over instrument weights. All deterministic, all computed here rather than by the model.

## 10. Market data architecture

`src/server/market-data/` — server-only. Provider credentials are read from environment variables inside this directory and **never** cross into `app/**` or any client bundle ([SECURITY.md](SECURITY.md)).

```ts
interface MarketDataProvider {
  readonly key: ProviderKey;
  readonly capabilities: ProviderCapabilities;
  supports(instrument: InstrumentRef): boolean;

  getInstrument(ref):        Promise<Result<InstrumentMetadata, ProviderFailure>>;
  searchInstruments(q, hint?): Promise<Result<InstrumentCandidate[], ProviderFailure>>;
  getLatestPrices(refs):     Promise<Map<ProviderRefKey, Result<PriceObservation, ProviderFailure>>>;
  getHistoricalPrices(ref, from, to): Promise<Result<PriceObservation[], ProviderFailure>>;
  getCorporateActions(ref, from, to): Promise<Result<CorporateActionObservation[], ProviderFailure>>;
  getDividends(ref, from, to):        Promise<Result<DividendObservation[], ProviderFailure>>;
  getFxRates(pairs, on?):    Promise<Map<PairKey, Result<FxObservation, ProviderFailure>>>;
}
```

**An adapter returns observations, not verdicts** ([ADR-27](DECISIONS.md#adr-27--market-data-adapters-return-observations-the-registry-classifies-freshness)). `live` / `cached` / `stale` is a judgement about age relative to now; the registry makes it once, in one function, so two adapters cannot reach different verdicts about the same age. An adapter reports a price, a currency, a trading date, an instant and a source, and nothing else.

**Every method returns a `Result`,** because *"this instrument has no history"* and *"the provider was down"* demand opposite responses — the first must stop retrying, the second must retry — and a bare array cannot tell them apart. `ProviderFailure` has five members: `not_found`, `rate_limited`, `unsupported`, `transport`, `malformed`.

`ProviderCapabilities` declares asset classes, markets (MIC), cadence (`eod` / `intraday` / `continuous`), history depth, which operations are provided, and whether a credential is required. The registry **refuses** a resolution whose capabilities do not cover the request rather than calling and interpreting a confusing `not_found` — the same rule as `CLAUDE.md <model_fallbacks>`: never downgrade a task to an incapable provider merely because it is available.

### Resolution order for one instrument

1. `instrument.price_provider` if set **and registered and capable** → that adapter.
2. Otherwise the first registered adapter whose `supports()` and `capabilities` both admit it.
3. Otherwise `ManualProvider`.

**Once an instrument has stored price history its provider is pinned** ([ADR-30](DECISIONS.md#adr-30--one-provider-per-instrument-price-series-the-only-price-fallback-is-manual)). Rule 2 resolves a *new* instrument; applied to one that already has two years of series it would interleave a second vendor's closes into the same table, and the splice would be indistinguishable from a real price move. Changing a provider purges and re-backfills.

`ManualProvider` reads the latest user-written `instrument_quotes` row. It is always registered, so **every** instrument can always be valued once the user enters a price. It is the only price fallback, and it is not a substitute source but a different kind of source — user-attested, always labelled `source: 'manual'`, never silently selected over a provider.

### Caching and refresh

- The registry writes through to `instrument_quotes` and upserts `instrument_prices`. The quote write is **age-guarded** — `EXCLUDED.as_of >= instrument_quotes.as_of` — so a late-arriving response cannot overwrite a newer quote, and a refresh cannot overwrite a price the user has just typed (invariant **I-36**).
- **A read never triggers a network call.** Pages render from the database and show staleness; a manual "refresh prices" action enqueues a job. One consequence worth stating: a provider outage is *invisible* on the read path, and only becomes visible as the stored quote ages into `stale`.
- MVP jobs are `fx.refresh` (daily), `prices.refresh` (daily, after close), `prices.backfill` (on demand) and `corporate_actions.refresh` (weekly). All are idempotent — a price upsert keyed `(instrument_id, as_of)` re-run on the same day writes the same row. **No intraday refresh:** nothing consumes an intraday price, and mixing a delayed price with an end-of-day close would make one staleness rule impossible.
- Rate limits and provider errors are caught in the adapter, normalised to a `ProviderFailure`, and mapped by the registry onto a `missing` reason plus a log entry. **One broken provider never breaks a page**, because the page was never waiting on it.

### Corporate actions are detections

A provider's split or bonus information is stored in `corporate_action_detections` and **never** becomes an `investment_transactions` row except through an explicit user action on the ordinary validated path ([ADR-29](DECISIONS.md#adr-29--provider-corporate-actions-are-detections-never-ledger-writes), [SCHEMA.md §5.1](SCHEMA.md#51-corporate-action-detections)). An open detection whose ex-date falls inside the holding period **suppresses** that instrument's market value rather than adjusting it — see [§11](#11-corporate-actions).

### Providers (decision OD-3)

| Source | Covers | Auth | Status |
|---|---|---|---|
| **Manual** | everything | none | **Built.** Always registered |
| **AMFI** `NAVAll.txt` + NAV-history report | Indian mutual funds, from 2006 | **none** | **Built.** Free, daily, official. Reuse terms are **OD-13** — documented, not assumed |
| **Frankfurter** (central-bank reference rates) | FX, incl. INR | **none** | **Built.** No quota; history to 1948 |
| **Twelve Data** | NSE/BSE equities & ETFs (EOD), international, FX | API key | **Decided, not integrated.** Sits behind the provider credential/configuration step; the registry needs no change to accept it |
| Kite Connect | NSE/BSE | account + daily login | **Rejected** — a daily-expiring interactive login is unusable from an unattended job |
| Crypto | — | — | **Deferred (OD-11).** `cadence: 'continuous'` exists and is tested; no adapter ships |
| Bullion / gold | — | — | **Deferred (OD-12).** Gold prices as an ETF or MF, or is a `manual_assets` valuation series |

No provider is hard-coded into the design. Adding one is a new file in `providers/` plus a registry line; **no file outside `src/server/market-data/providers/` may name a provider.**

## 11. Corporate actions

In every row below, **stored basis (`cost_total`, `remaining_cost`) is untouched by a `split` or `bonus`** — only quantities move. Per-unit cost changes because it is *derived* from an unchanged total over a changed quantity, not because anything divided it.

| Action | Modelled as | Effect |
|---|---|---|
| Stock split (1:5) | `split` with `ratio_num=5, ratio_den=1` | Quantities ×5; derived per-unit cost ÷5; basis unchanged **exactly** |
| Reverse split (5:1) | `split` with `ratio_num=1, ratio_den=5` | Quantities ÷5; derived per-unit cost ×5; basis unchanged **exactly** |
| Bonus issue (1:1) | `bonus` with `ratio_num=1, ratio_den=1` | Quantity doubles at zero incremental cost; derived per-unit cost halves |
| Cash dividend | `dividend` | Cash in, `income_total` up **gross**, no lot change |
| Stock dividend | `bonus` | Same as bonus issue |
| Rights issue | `buy` at the rights price | Ordinary purchase; opens a new lot with its own `acquired_on` |
| Merger / demerger | `transfer_out` + `transfer_in` on the new instrument, basis apportioned by the user | Basis **and `acquired_on`** preserved; the apportionment ratio is a user input, not a guess |
| Buyback / delisting | `sell` at the buyback price | Ordinary disposal |
| Fixed-deposit maturity | `sell` at face + accrued | Closes the position, realises the return |

**Corporate actions are entered by the user; no provider feed may mutate the ledger** ([ADR-29](DECISIONS.md#adr-29--provider-corporate-actions-are-detections-never-ledger-writes)). A provider's split or bonus is stored as a *detection* in `corporate_action_detections` ([SCHEMA.md §5.1](SCHEMA.md#51-corporate-action-detections)) and becomes an `investment_transactions` row only when the user accepts it, through the ordinary validated service path. A `split` row drives `replay()` and therefore every lot, position and realised-P&L figure in the system; an unvalidated external source must not be able to write one — the same rule, for the same reason, as the AI mutation rule.

**An unreconciled detection suppresses market value; it never adjusts it.** Between an ex-date and the moment the user records the action, the provider's price is post-split while the ledger's quantity is not:

```
observed = 100 units (pre-split) × ₹200 (post-split) = ₹20,000
correct  = 500 units             × ₹200              = ₹1,00,000
```

An 80% phantom loss, internally consistent across the portfolio, allocation, market-basis net worth and the change bridge — every figure agreeing, all of them wrong. So when an open detection's `ex_date` falls inside the holding period, that instrument's price is reported `missing: 'unreconciled_corporate_action'` and the holding is **excluded and named**, exactly as an unpriced holding is. Applying the provider's ratio instead would be the ledger mutation this rule exists to forbid, and would leave quantity wrong everywhere else besides.

**Ordering matters, in two distinct ways.**

1. *Across dates.* A split dated between a purchase and a sale must replay in date order or the realised P&L is wrong by the split factor. This is a golden-scenario test.
2. *Within one date.* A split sharing a `trade_date` with a trade is ordered by `kind_rank`, not by which row was entered first ([§3 Ordering](#ordering)). Without that, the same ledger yields two different answers depending on data-entry history.

**Holding period survives a transfer.** `transfer_out` → `transfer_in` carries `acquired_on` to the destination lot, so `holding_days` on the eventual sale is measured from the original purchase. Without it, moving shares between two of your own demat accounts would silently reset a long-term holding to short-term — a materially wrong tax classification, and precisely what a lot-based ledger exists to get right.

## 12. Edge cases that must be covered by tests

1. Multiple purchases at different prices, then a partial sell — FIFO order, correct realised P&L, correct remaining basis.
1a. **Partial sell of a single lot** (buy 100 @ ₹100, sell 40 @ ₹150). Asserts, individually: the lot survives with `remaining_quantity = 60`; `positions.quantity = 60`; `cost_basis` falls by the **cost** of the units sold (40 × ₹100 = ₹4,000 → ₹6,000), **not** by the ₹6,000 of proceeds; derived average price stays ₹100; `realized_pnl = ₹2,000` and is not folded into `cost_basis`; `unrealizedPnl` is measured against ₹6,000, never against the original ₹10,000.
1b. Same fixture, no price available — `unrealizedPnl` is `null` with reason `no_price`, while `realizedPnl` is still ₹2,000. Realised P&L never depends on market data.
1c. Same fixture — `totalReturnPct` uses `costDeployed` (₹10,000), not `investedCapital` (₹6,000). Asserts 56%, not 93%.
2. Sell that spans three lots exactly, and one that spans them partially.
3. Sell everything, then buy again — new lot, realised P&L retained on the position.
4. Purchase fees capitalised; sale fees reduce proceeds; both reflected in `returnPct`.
5. Dividend received on a holding, then the holding is fully sold — dividend stays in `income_total`; the position row survives at `quantity = 0`.
5a. **Dividend does not touch the lot.** After a ₹500 dividend on 100 shares bought at ₹100: `cost_total` still ₹10,000, `remaining_cost` still ₹10,000, derived per-unit cost still ₹100, `income_total` = ₹500. Asserts no cost-basis reduction.
5b. **Dividend with TDS** (gross ₹500, TDS ₹50, net ₹450): `income_total` = 500, `taxes_total` = 50, cash +450, and the contribution to `totalReturn` is exactly +450 — not +400 (double-subtracted) and not +500 (tax ignored).
5c. **No mirroring row.** A dividend raises the brokerage balance by ₹450 exactly once; asserts no `transactions` row exists for the same event (invariant I-13).
6. Split before a sale; split after a sale; split with no holding.
7. Bonus issue — total basis unchanged, average cost halves, unrealised P&L jumps by exactly the market value of the bonus units.
8. Split with a ratio that does not divide evenly into the held quantity (fractional units retained at `QTY_SCALE`).
9. Oversell — rejected with `shortBy`, no partial write.
10. Instrument with no price at all — excluded from totals, coverage < 1, listed as unpriced.
11. **Stale price — measured in sessions, not hours** ([ADR-28](DECISIONS.md#adr-28--staleness-is-measured-in-trading-sessions-not-wall-clock-hours)). A close 3+ completed sessions behind the latest known session is `stale`: still used, visibly marked. Asserts specifically that **Friday's close read on Monday morning is not stale** — the wall-clock rule reported it as stale for ~72 hours every weekend, which is a warning that fires when nothing is wrong. A continuously-traded instrument still ages in hours; an observation more than 10 calendar days old is `stale` regardless of session count.
12. Foreign-currency instrument — cost basis in instrument currency, base-currency figures using dated FX, FX component separated in attribution.
13. Two transactions on the same `trade_date` — replay order stable across rebuilds; incremental rebuild output identical to full rebuild.
14. Transfer of a holding between two of the user's own accounts — basis preserved, zero realised P&L.
15. XIRR with a single cash flow → `null`. With all-negative flows → `null`. With a large loss (r near −1) → converges via bisection.
16. XIRR where the terminal value is zero (position fully sold) → uses realised flows only.
17. TWR with a missing month of price history → `null` with a reason, not a partial figure.
18. Zero-quantity position after full disposal — position row retained with `quantity = 0` for realised-P&L history; excluded from holdings display and from allocation.
19. Fee with `instrument_id = NULL` — reduces cash and portfolio return, allocated to no position, appearing in **no** allocation slice and in **no** instrument's return percentage ([§6.2](#62-account-level-fees-interest-and-taxes)).
20. Fixed deposit priced manually, maturing mid-period — appears in net worth throughout, closes cleanly.

### Cases added by the Phase 4 design review

Each guards a defect that the previous version of this document would have produced. Recorded in [INVESTMENT-ENGINE-DESIGN.md §2](INVESTMENT-ENGINE-DESIGN.md).

21. **Income accrues gross, with the withholding separate.** Dividend gross ₹500, TDS ₹50 → `income_total = 500`, `taxes_total = 50`, and the contribution to `totalReturn` is exactly **+450** — not 400 (double-subtracted) and not 500 (tax ignored). Extends 5b to assert all three figures rather than the total alone.
22. **Multi-lot disposal loses nothing.** A sale spanning three lots → `Σ realized_pnl = netProceeds − Σ cost_consumed` **to the minor unit**, and `Σ proceeds = netProceeds` exactly. Fails against any divide-then-multiply implementation.
23. **Corporate actions preserve basis byte-for-byte.** 1:5 split, then a 1:1 bonus, then a partial sell → `Σ cost_total` is byte-identical before and after both actions, and `Σ cost_consumed + remaining_cost = cost_total` still holds.
24. **`transfer_out` realises nothing and preserves the clock.** Every disposal it produces has `realized_pnl = 0`; the destination lot's `acquired_on` is the **original** purchase date; `holding_days` on the eventual sale is measured from it, not from the transfer.
25. **Same-date ordering is entry-order independent.** A buy and a split sharing a `trade_date`, inserted in both possible orders → identical lots, identical basis. Fails without `kind_rank`.
26. **Unsettled rows move no cash.** `cash_settled = false` with a non-zero `net_amount` → rejected by the **database**, not merely by the service (invariant I-16).
27. **FX decomposition sums.** A USD instrument against an INR base with a rate move between buy and sell → `base_price_component + base_fx_component = base_realized_pnl` **exactly** (invariant I-18).
28. **Per-unit precision survives the read boundary.** A NAV of `123.45678900` round-trips through `UnitPrice` without loss; the same value through `Money` is asserted to **lose** precision — proving the test detects the truncation rather than passing vacuously.
29. **Nothing is counted twice.** The [§6.3](#63-worked-verification-that-nothing-is-counted-twice) fixture → `totalReturn = ₹5,970` by the component sum **and** by the cash cross-check. Adding trade fees to `fees_total` gives ₹5,890 and fails.
30. **A backdated oversell writes nothing.** Inserting a sell dated before existing purchases such that the position goes short at that instant → the whole transaction rolls back; lots, disposals, positions and `investment_ledger_version` are byte-identical to before.
31. **The quantity relation is not asserted after a corporate action.** `Σ lot_disposals.quantity + remaining_quantity ≠ original_quantity` following a split on a partially disposed lot, while `Σ cost_consumed + remaining_cost = cost_total` still holds. Guards `verify:integrity` against asserting the intuitive-but-false relation ([§4](#rounding-in-the-engine)).

### Cases added by the Phase 6 market-data review

Each guards a defect found in [MARKET-DATA-DESIGN.md §21](MARKET-DATA-DESIGN.md#21-defects-found-in-the-baseline-m1m13).

32. **Friday's close is not stale on Monday** (M2). A quote dated Friday, read Monday 09:00 IST with Friday still the latest session → `current`, not `stale`. The wall-clock rule reported `stale` for ~72 hours every weekend. Paired with: a close 3 completed sessions behind **is** `stale`, and one 11 calendar days old is `stale` regardless of session count.
33. **An unrecorded split suppresses market value, and does not adjust it** (M5). Provider reports a 1:5 split with an ex-date inside the holding period, no matching ledger row → the holding's price is `missing: 'unreconciled_corporate_action'`, `marketValue` is `null`, the holding is named in `unpriced`, and **no** quantity or price is altered. Asserts specifically that the ₹20,000 phantom figure is never produced.
34. **A provider never writes an `investment_transactions` row** (M4, I-40). After a corporate-actions refresh that detects a split, the investment ledger is byte-identical and `investment_ledger_version` is unchanged; the detection lives only in `corporate_action_detections`. Accepting the detection through the service path *does* create the row, and stamps `resolved_txn_id`.
35. **Triangulated FX keeps a foreign holding in the figure** (M1). With only `EUR→INR` and `EUR→USD` stored and base INR, a USD holding resolves via one pivot instead of being dropped with `no_fx_rate`; the resulting selection is dated by its **stalest** leg, and a direct pair — even an older one — still wins.
36. **The price carry-back is bounded** (M9). An instrument whose last close is 40 days before the valuation date is a **gap**, not a value carried forward; one whose last close is the previous session is valued from it.
37. **A late provider response cannot overwrite a newer quote** (M7, I-36). Writing an observation dated earlier than the stored `instrument_quotes.as_of` leaves the stored row unchanged; a manual price is not replaced by a provider price of the same `as_of`.
38. **A malformed provider response writes nothing** (security). A response with a price of `"12.3456789012"` (11 decimals), a negative close, or a currency that is not the instrument's → rejected at the adapter boundary; no row is written and the previous quote survives.
39. **Two providers never blend one series** (M6, I-35). Attempting to store an observation whose `source` differs from the instrument's existing series is refused rather than interleaved.
40. **TWR boundaries land on non-trading days** (M10). A flow dated on a market holiday still yields a valuation for that boundary via bounded carry-back, so TWR computes instead of returning `insufficient_price_history` forever. Asserts `twr()` itself is unchanged — the builder supplies the point.
