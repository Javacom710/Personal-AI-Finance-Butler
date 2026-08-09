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
- Buying an instrument reduces the brokerage account's cash and creates a position. Net worth is unchanged by the purchase itself (cash → asset), which is the correct accounting.

## 3. The investment ledger

`investment_transactions` is append-first: transactions are added, corrected, or deleted, and everything downstream is re-derived.

### Kinds and their effects

| Kind | Quantity | Cash effect | Lot effect |
|---|---|---|---|
| `buy`, `mf_purchase` | `> 0` | `−(gross + fees + taxes)` | opens a lot at `(gross + fees) / quantity` |
| `sell`, `mf_redemption` | `< 0` | `+(gross − fees − taxes)` | closes lots FIFO, produces `lot_disposals` |
| `transfer_in` | `> 0` | `0` | opens a lot at the stated cost (transfer between own accounts preserves basis) |
| `transfer_out` | `< 0` | `0` | closes lots FIFO with `realized_pnl = 0`; basis carried to the destination |
| `dividend` | `null` | `+(gross − fees − taxes)` | **no lot change, ever.** Accrues **gross** to `positions.income_total`; withholding to `taxes_total` |
| `interest` | `null` | `+(gross − fees − taxes)` | same as dividend |
| `fee` | `null` | `− net` | none; accrues to `positions.fees_total` (or account-level if `instrument_id` is null) |
| `tax` | `null` | `− net` | none; accrues to `positions.taxes_total` |
| `split` | `null` | `0` | multiplies every open lot's quantity by `ratio_num/ratio_den`, divides `cost_per_unit` inversely |
| `bonus` | `null` | `0` | adds `ratio_num/ratio_den × quantity` units at **zero cost**, preserving total basis |

**Fee allocation.** Purchase fees are capitalised into the lot's `cost_per_unit`. Sale fees reduce proceeds and therefore reduce `realized_pnl`. Fees not attributable to a trade (annual demat charges) are recorded as `fee` with `instrument_id = NULL` and reduce cash and portfolio return without touching any lot.

### Dividends and interest are income, never a cost reduction

A dividend **does not touch a lot.** `cost_per_unit` is unchanged, `remaining_quantity` is unchanged, `cost_basis` is unchanged. It is a return *on* the investment, not a refund *of* it.

Why this matters beyond bookkeeping tidiness — reducing cost basis by the dividend would:

- **inflate every future realised gain**, because the disposal is measured against an artificially low cost. On a long-held dividend payer the cost basis can be driven toward zero, and the entire eventual sale is reported as capital gain.
- **misstate tax treatment.** Dividend income and capital gains are taxed differently and at different times. Folding one into the other makes the ledger unusable for tax purposes — which is the whole reason it is lot-based.
- **hide the return's composition.** "Did this holding earn ₹5,000 from price appreciation or from dividends?" becomes unanswerable, and the two are not equivalent.

The one legitimate cost-basis reduction is a **return of capital** distribution (a genuine refund of principal). That is a different corporate action, is not implemented at launch, and would be a distinct `kind` — never a `dividend` treated specially.

**Gross versus net.** Indian dividends attract TDS, so three numbers exist and must not be conflated:

```
gross_amount  500.0000   declared dividend          → income_total  += 500  (GROSS)
taxes          50.0000   TDS withheld               → taxes_total   +=  50
net_amount    450.0000   cash actually received     → account balance += 450
```

`income_total` accrues **gross** and `taxes_total` accrues the withholding separately, because `totalReturn = … + income − fees − taxes`. Accruing income net of tax *and* recording the tax would subtract it twice (₹400 instead of ₹450). Enforced by invariant I-12 and a database `CHECK`.

**Taxes.** Recorded, never computed. This application does not model tax liability ([CLAUDE.md §19](../CLAUDE.md) excludes tax filing); it records taxes actually paid so returns are net of them.

### Ordering

The engine replays in `(trade_date, created_at, id)` order — a total order, so two trades on the same date replay identically on every rebuild. This is why `inv_txn_replay_idx` exists.

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

The **disposal-matching strategy** is the only thing that varies between cost-basis methods. Everything else in the engine — lot opening, fee capitalisation, corporate actions, income accrual, position totals, the `Σ(remaining × cost_per_unit) = cost_basis` invariant — is method-independent. Isolating that one decision behind `MatchingStrategy` means adding a method later is a new `select()` implementation plus its own test table, not a second engine.

| Method | Status | Notes |
|---|---|---|
| `fifo` | **Implemented; the default** | Matches Indian tax treatment for listed equity and mutual funds. Also the most informative: average cost is derivable from FIFO lots (`cost_basis / quantity`), while the reverse is not true. |
| `average` | Interface only | Would collapse open lots into one weighted-average lot on each disposal. Some jurisdictions and some fund accounting require it. |
| `specific_id` | Interface only | Requires a UI for the user to pick lots at sale time, which is a product decision, not just an engine one. |

`instruments.cost_basis_method` carries the setting per instrument, defaulting to `fifo` — so a future jurisdiction change or a single instrument needing different treatment is a data change, not a migration of the engine ([ADR-07](DECISIONS.md#adr-07--cost-basis-engine-with-a-pluggable-matching-strategy-default-fifo)).

**Changing an instrument's method is a rebuild, not a mutation.** It rewrites derived history: the service updates `cost_basis_method`, then triggers a full `rebuildPosition()` for every account holding that instrument inside the same transaction. Realised P&L on already-closed disposals will change, so the UI must warn before applying it, and the change is recorded in `audit_log`.

### FIFO matching strategy

```
open: Lot[] = []          // ordered oldest-first
for txn in transactions:
  switch txn.kind:
    acquire (buy | mf_purchase | transfer_in):
      costPerUnit = (gross + fees) / |quantity|          -- rounded half_up at PRICE_SCALE
      open.push({ openedOn: trade_date, qty: |quantity|, costPerUnit, txnId })

    dispose (sell | mf_redemption | transfer_out):
      remaining = |quantity|
      proceedsPerUnit = (gross - fees - taxes) / |quantity|
      while remaining > 0:
        if open is empty: ERROR oversell        -- see below
        lot = open[0]
        take = min(lot.remaining, remaining)
        realized = take * (proceedsPerUnit - lot.costPerUnit)
        emit disposal { lot, take, proceedsPerUnit, lot.costPerUnit, realized,
                        holdingDays: trade_date - lot.openedOn }
        lot.remaining -= take
        remaining     -= take
        if lot.remaining == 0: open.shift()   -- leaves the WORKING array only;
                                              -- the lot row is still emitted and persisted
                                              -- with remaining_quantity = 0. See below.

    split:
      factor = ratio_num / ratio_den
      for lot in open:
        lot.qty          *= factor
        lot.costPerUnit  /= factor        -- total basis preserved exactly; see rounding note

    bonus:
      factor = ratio_num / ratio_den
      for lot in open:
        bonusQty = lot.qty * factor
        lot.qty += bonusQty
        lot.costPerUnit = lot.totalCost / lot.qty    -- basis unchanged, spread over more units

    income (dividend | interest):  position.income += net
    cost   (fee | tax):            position.fees/taxes += |net|
```

### Closed lots are retained, never deleted

`open.shift()` removes a fully-consumed lot from the engine's **working array** so FIFO advances. It does **not** discard the lot: `replay()` emits every lot it ever opened, and a fully-disposed lot is persisted with `remaining_quantity = 0`.

This is load-bearing in three places, and deleting closed lots would silently break all three:

- `costDeployed` ([§6](#6-portfolio-metrics)) sums `original_quantity × cost_per_unit` over **all** lots. Drop the closed ones and total return is computed against a shrinking denominator.
- `lot_disposals` rows reference `lot_id`; the parent must survive for realised-P&L history and holding-period classification to be reconstructable.
- A position sold down to zero keeps its row with `quantity = 0` (edge case 18) so realised P&L is not lost. Its lots must survive for the same reason.

`positions.cost_basis` counts only `remaining_quantity`, so retained closed lots contribute nothing to it. Retention costs storage, not correctness.

### Rounding in the engine

Per-unit values are held at `PRICE_SCALE = 8`. Total cost is stored **per lot** as an exact `Money`, and `cost_per_unit` is derived. On splits and bonuses the engine adjusts quantity and recomputes `cost_per_unit = totalCost / qty`, so the invariant `Σ(remaining_quantity × cost_per_unit) = cost_basis` holds to within one minor unit per lot. Invariant **I-6** in [SCHEMA.md §12](SCHEMA.md#12-invariants-summary) asserts this and the integrity command reports any lot that drifts.

### Oversell

Selling more units than are held is a **data error, not a short position**. The engine returns `Result.err({ kind: 'oversell', instrumentId, tradeDate, shortBy })`. The UI surfaces it as "you are selling 50 units but only 30 are held as of this date — check for a missing purchase, bonus, or split". The transaction is **not** written. Shorting is out of scope at launch; when added it becomes a distinct `short_sell` kind rather than a negative position.

### Rebuild

```
rebuildPosition(userId, accountId, instrumentId):
  BEGIN
    DELETE lot_disposals WHERE lot_id IN (lots for this position)
    DELETE tax_lots      WHERE (user, account, instrument)
    txns = SELECT ... ORDER BY trade_date, created_at, id
    result = replay(txns, instrument.cost_basis_method)
    INSERT lots, disposals
    UPSERT positions with result.position + current investment_ledger_version
  COMMIT
```

Full rebuild (`npm run rebuild:positions`) loops every `(account, instrument)` pair. It must produce byte-identical output to the incremental path — asserted in integration tests.

## 5. Valuation

`src/server/domain/pricing/` combines positions with prices.

```ts
interface HoldingView {
  instrument: Instrument;
  quantity: Quantity;
  avgCost: Money;               // cost_basis / quantity, PRICE_SCALE, half_up
  invested: Money;              // = cost_basis
  price: PriceResult;           // discriminated union, ADR-11
  marketValue: Money | null;    // null when price.status === 'missing'
  unrealizedPnl: Money | null;
  returnPct: Rate | null;
  weightPct: Rate | null;       // of the priced portion of the portfolio
}
```

```
marketValue   = quantity × price                (half_up at MONEY_SCALE)
unrealizedPnl = marketValue − invested
returnPct     = invested > 0 ? unrealizedPnl / invested : null
```

**Unpriced holdings.** `marketValue` is `null`, the holding is excluded from portfolio totals and from `weightPct` denominators, and the portfolio summary reports `pricedValue`, `unpricedCount`, and `coverage = pricedCostBasis / totalCostBasis`. Rendering shows the holding with an explicit "no price" marker rather than a zero, because a zero would read as "worthless".

## 6. Portfolio metrics

```ts
interface PortfolioSummary {
  investedCapital: Money;       // Σ cost_basis over OPEN positions — capital currently at risk
  costDeployed: Money;          // Σ (original_quantity × cost_per_unit) over ALL lots ever
                                // opened, including closed ones — total capital ever committed
  marketValue: Money;           // priced holdings only
  unrealizedPnl: Money;         // marketValue − investedCapital
  realizedPnl: Money;           // Σ lot_disposals.base_realized_pnl
  dividends: Money;
  interest: Money;
  fees: Money;
  taxes: Money;
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

TWR requires valuations at sub-period boundaries, which requires `instrument_prices` history. When history is incomplete, TWR returns `null` with `reason: 'insufficient_price_history'` rather than a figure computed from partial data.

**Which to show where.** XIRR is the headline (it answers "what return did *my* money earn"). TWR is shown on the Performance page for comparing against a benchmark, since it removes the effect of contribution timing. Both are labelled with their day-count and annualisation basis.

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
  readonly key: string;
  supports(instrument: Instrument): boolean;
  getQuotes(instruments: Instrument[]): Promise<Map<InstrumentId, PriceResult>>;
  getHistoricalPrices(i: Instrument, from: Date, to: Date): Promise<PricePoint[]>;
  searchInstruments(query: string, hint?: AssetClass): Promise<InstrumentCandidate[]>;
  getFxRates(pairs: [CurrencyCode, CurrencyCode][], on?: Date): Promise<Map<string, Rate>>;
}
```

### Resolution order for one instrument

1. `instrument.price_provider` if set and registered → adapter.
2. Otherwise the first registered adapter whose `supports()` returns true.
3. Otherwise `ManualProvider`.

`ManualProvider` reads the latest `instrument_quotes` row that was written by the user and returns `status: 'cached' | 'stale'` based on its age. It is always registered, so **every** instrument can always be valued once the user enters a price.

### Caching and refresh

- `getQuotes` writes through to `instrument_quotes`; `getHistoricalPrices` upserts `instrument_prices`.
- A `prices.refresh` job runs on a schedule (default: hourly during market hours, once daily otherwise) over the distinct instruments in open positions. Batched per provider.
- A read never triggers a network call. Pages render from the cache and show staleness; a manual "refresh prices" action enqueues the job.
- Rate limits and provider errors are caught inside the adapter and returned as `status: 'missing', reason: 'provider_error'`, plus a log entry. One broken provider never breaks a page.

### Candidate providers (decision OD-3)

| Source | Covers | Auth | Notes |
|---|---|---|---|
| AMFI `NAVAll.txt` | Indian mutual funds | none | Free, daily, official. Recommended first non-manual adapter. |
| RBI / exchangerate.host | FX | none / free tier | Daily reference rates |
| A commercial equity API | NSE/BSE/US equities & ETFs | API key | **Requires a user decision (OD-3)** — pricing and terms vary; must be server-side only |
| Manual | everything | none | Always available fallback |

No provider is hard-coded into the design. Switching one is a new file in `providers/` plus a registry line.

## 11. Corporate actions

| Action | Modelled as | Effect |
|---|---|---|
| Stock split (1:5) | `split` with `ratio_num=5, ratio_den=1` | Quantities ×5, per-unit cost ÷5, basis unchanged |
| Reverse split (5:1) | `split` with `ratio_num=1, ratio_den=5` | Quantities ÷5, per-unit cost ×5 |
| Bonus issue (1:1) | `bonus` with `ratio_num=1, ratio_den=1` | Quantity doubles at zero incremental cost |
| Cash dividend | `dividend` | Cash in, `income_total` up, no lot change |
| Stock dividend | `bonus` | Same as bonus issue |
| Rights issue | `buy` at the rights price | Ordinary purchase; opens a new lot |
| Merger / demerger | `transfer_out` + `transfer_in` on the new instrument, basis apportioned by the user | Basis preserved; the apportionment ratio is a user input, not a guess |
| Buyback / delisting | `sell` at the buyback price | Ordinary disposal |
| Fixed-deposit maturity | `sell` at face + accrued | Closes the position, realises the return |

Corporate actions are entered by the user; no provider feed is trusted to mutate the ledger automatically. When an action arrives from a provider it is surfaced as a suggestion, not applied.

**Ordering matters.** A split dated between a purchase and a sale must replay in date order or the realised P&L is wrong by the split factor. This is a golden-scenario test.

## 12. Edge cases that must be covered by tests

1. Multiple purchases at different prices, then a partial sell — FIFO order, correct realised P&L, correct remaining basis.
1a. **Partial sell of a single lot** (buy 100 @ ₹100, sell 40 @ ₹150). Asserts, individually: the lot survives with `remaining_quantity = 60`; `positions.quantity = 60`; `cost_basis` falls by the **cost** of the units sold (40 × ₹100 = ₹4,000 → ₹6,000), **not** by the ₹6,000 of proceeds; derived average price stays ₹100; `realized_pnl = ₹2,000` and is not folded into `cost_basis`; `unrealizedPnl` is measured against ₹6,000, never against the original ₹10,000.
1b. Same fixture, no price available — `unrealizedPnl` is `null` with reason `no_price`, while `realizedPnl` is still ₹2,000. Realised P&L never depends on market data.
1c. Same fixture — `totalReturnPct` uses `costDeployed` (₹10,000), not `investedCapital` (₹6,000). Asserts 56%, not 93%.
2. Sell that spans three lots exactly, and one that spans them partially.
3. Sell everything, then buy again — new lot, realised P&L retained on the position.
4. Purchase fees capitalised; sale fees reduce proceeds; both reflected in `returnPct`.
5. Dividend received on a holding, then the holding is fully sold — dividend stays in `income_total`; the position row survives at `quantity = 0`.
5a. **Dividend does not touch the lot.** After a ₹500 dividend on 100 shares bought at ₹100: `cost_per_unit` still ₹100, `cost_basis` still ₹10,000, derived average still ₹100, `income_total` = ₹500. Asserts no cost-basis reduction.
5b. **Dividend with TDS** (gross ₹500, TDS ₹50, net ₹450): `income_total` = 500, `taxes_total` = 50, cash +450, and the contribution to `totalReturn` is exactly +450 — not +400 (double-subtracted) and not +500 (tax ignored).
5c. **No mirroring row.** A dividend raises the brokerage balance by ₹450 exactly once; asserts no `transactions` row exists for the same event (invariant I-13).
6. Split before a sale; split after a sale; split with no holding.
7. Bonus issue — total basis unchanged, average cost halves, unrealised P&L jumps by exactly the market value of the bonus units.
8. Split with a ratio that does not divide evenly into the held quantity (fractional units retained at `QTY_SCALE`).
9. Oversell — rejected with `shortBy`, no partial write.
10. Instrument with no price at all — excluded from totals, coverage < 1, listed as unpriced.
11. Price older than `price_stale_after_hours` — `status: 'stale'`, still used, visibly marked.
12. Foreign-currency instrument — cost basis in instrument currency, base-currency figures using dated FX, FX component separated in attribution.
13. Two transactions on the same `trade_date` — replay order stable across rebuilds; incremental rebuild output identical to full rebuild.
14. Transfer of a holding between two of the user's own accounts — basis preserved, zero realised P&L.
15. XIRR with a single cash flow → `null`. With all-negative flows → `null`. With a large loss (r near −1) → converges via bisection.
16. XIRR where the terminal value is zero (position fully sold) → uses realised flows only.
17. TWR with a missing month of price history → `null` with a reason, not a partial figure.
18. Zero-quantity position after full disposal — position row retained with `quantity = 0` for realised-P&L history; excluded from holdings display and from allocation.
19. Fee with `instrument_id = NULL` — reduces cash and portfolio return, allocated to no position.
20. Fixed deposit priced manually, maturing mid-period — appears in net worth throughout, closes cleanly.
