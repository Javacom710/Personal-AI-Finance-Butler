# Market Data — Phase 6 architecture and provider review

**Status:** design and provider review complete 2026-08-18. **Phase 6 implementation has NOT
started.** No provider package installed, no adapter written, no source file, schema, migration, API
or UI changed by this review.

**Nature of this document:** a review record and rationale, like
[INVESTMENT-ENGINE-DESIGN.md](INVESTMENT-ENGINE-DESIGN.md) and
[NET-WORTH-DESIGN.md](NET-WORTH-DESIGN.md). **Non-normative** — where it and a canonical document
differ, the canonical document wins until the findings in [§21](#21-defects-found-in-the-baseline-m1m13)
are approved and applied under **OD-10**.

**Baseline reviewed:** commit `ad18949` — Phases 0–5 complete and verified (1,049 tests; 27
invariants passing, 8 engine-enforced, 2 deferred). Canonical documents read: `CLAUDE.md`,
`PROJECT-STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `FINANCIAL-DOMAIN.md`, `INVESTMENT-DOMAIN.md`,
`SCHEMA.md`, `TESTING.md`, `DECISIONS.md`, `NET-WORTH-DESIGN.md`. Implementation read:
`db/schema/{investments,reference,settings,ops,enums}.ts`, migrations `0002`/`0003`,
`lib/decimal/price.ts`, `domain/pricing/{price-result,valuation,allocation}.ts`,
`domain/calc/{twr,xirr,portfolio}.ts`, `domain/fx.ts`, `domain/networth/{compose,keys,bridge}.ts`,
`domain/lots/engine.ts`, `services/{prices,portfolio,positions,networth,_fx,_ctx}.ts`,
`db/integrity.ts`, `jobs/`, and the Investments and Net Worth UI.

**Provider facts were verified against official sources on 2026-08-17/18**, not recalled. Every
pricing or coverage claim in [§13](#13-provider-evaluation) carries its source and access date, and
anything that could not be confirmed from an official page is marked **UNVERIFIED** rather than
guessed.

---

## 0. Executive summary

Phase 6 is where a price first enters the system. Everything the investment engine and net worth
compute today — cost basis, realised P&L, FIFO lots, Net Worth at Cost — was deliberately built to
need no price at all, which is why five phases shipped without one. That also means Phase 6 adds
**one new input to an existing engine**, and must not add a second engine.

Seven conclusions drive the design.

1. **The binding constraint is coverage and licence, not volume.** A 30-instrument personal portfolio
   refreshed once a day is ~900 requests a month. That is three orders of magnitude inside every
   candidate plan's quota, including free ones. So no Redis, no request coalescing, no cache tier:
   `instrument_quotes` and `instrument_prices` already *are* the cache, and the existing rule that a
   read never makes a network call already makes them the only cache a page can see.

2. **Eleven of the twelve implementation steps are unblocked today.** OD-3 — the commercial
   equity/ETF provider — has been treated as the gate on Phase 6. It is not. The two adapters that
   matter most for an INR-base Indian portfolio are **free, keyless and official**: AMFI for mutual
   funds and a central-bank FX feed for rates. OD-3 becomes step **6.9** of twelve
   ([§20](#20-recommended-mvp-architecture)), and nothing above it in the stack changes when it lands.

3. **The FX gap is live today, and it is not a Phase 6 nicety.** `fx_rates` is empty. Any component
   in a currency other than INR is currently *excluded* from net worth with `no_fx_rate`, and any
   foreign holding gets `baseMarketValue: null`. The FX adapter fixes a defect, not a feature.

4. **Staleness as currently specified will be wrong for every equity, every Monday.**
   `price_stale_after_hours` defaults to 24, and an end-of-day price from Friday's close is ~72 hours
   old by Monday morning. Under the current rule the entire portfolio carries a "stale" badge every
   week, which teaches the user to ignore the badge — defeating the one thing `CLAUDE.md` is most
   insistent about. Staleness must be measured in **trading sessions**, not wall-clock hours
   ([§11](#11-staleness), proposed **ADR-28**).

5. **The most dangerous number Phase 6 can produce is a market value computed across an unrecorded
   corporate action.** If a 1:5 split occurs and the user has not recorded it, quantity stays
   pre-split while the provider's price is post-split: market value silently falls by 80% and reads
   as a crash, not as a data gap. The system must **detect** the mismatch and *suppress* the value
   with a reason, never adjust it ([§12](#12-missing-data-behaviour), proposed **ADR-29**).

6. **Provider-sourced corporate actions must never write to the investment ledger.**
   `investment_transactions` rows of kind `split`/`bonus` drive `replay()`, and therefore every lot,
   position and realised-P&L figure in the system. An external feed inserting one is an unvalidated
   external source mutating Layer 1 — the exact shape `CLAUDE.md`'s AI mutation rule forbids, for the
   same reason. Detections are proposals for review (**ADR-29**).

7. **Adapters should return observations; the registry classifies freshness.** ADR-11 has adapters
   returning `PriceResult` directly, but `live`/`cached`/`stale` is a judgement about age *relative to
   now*, which every adapter would then make independently and could make differently. Today
   `classifyQuote()` already does it in one place, correctly. Phase 6 should keep that and refine
   ADR-11 accordingly (**ADR-27**).

**Recommended MVP:** three adapters plus the always-registered Manual provider — **AMFI** (Indian
mutual funds; free, official, keyless), **Frankfurter/ECB** (FX; free, keyless, no quota), **Manual**
(everything, always) — with **one** commercial adapter added at step 6.9 once OD-3 is decided.
Recurring cost of the MVP as specified: **₹0/month.** With OD-3 resolved: **₹500/month** (Kite
Connect, if a Zerodha account exists) or **≈₹2,800/month** (Twelve Data Grow, $29). Call volume costs
nothing on any candidate plan.

**Thirteen defects were found in the baseline** (M1–M13, [§21](#21-defects-found-in-the-baseline-m1m13)),
four of them high severity. None is a live bug in the sense of producing a wrong number today —
`instrument_prices` is empty and `fx_rates` is empty, so every affected path currently reports a
labelled gap. All four would produce a silently wrong financial figure on the day a provider is
connected.

---

## 1. What exists, precisely

Phase 6 does not start from nothing. The following is already built, tested and shipped, and the
design below is constrained by it rather than free to redesign it.

| Piece | Where | State |
|---|---|---|
| `UnitPrice`, scale 8 | `src/lib/decimal/price.ts` | Complete. `valueOf`, `perUnit`, `mulQtyRatio`, `pScale`; `bigint` throughout, no `number` in any conversion |
| `PriceResult` union | `src/server/domain/pricing/price-result.ts` | Complete. `live` / `cached` / `stale` / `missing`, with `isUsable` and `classifyQuote` |
| Staleness classification | same file | Computed from `as_of` vs `now` against `settings.price_stale_after_hours`; never stored |
| Currency-mismatch guard | `classifyQuote:84` | A quote whose currency is not the instrument's is `missing: 'provider_error'`. The one cross-table rule the database cannot express |
| Valuation with coverage | `domain/pricing/valuation.ts` | Complete. `marketValue: null` on a missing price; holding excluded from totals and weights; `excludedReason` travels to the screen |
| The single price read point | `services/prices.ts` → `quotesFor()` | Every consumer goes through it. One place to change |
| Manual price entry | `services/prices.ts` → `setManualPrice()` | Complete. Currency taken from the instrument, never the input; `as_of` is when the price was *true* |
| Historical price query | `services/prices.ts` → `historicalCloses()` | Written against the real shape; returns empty because the table is empty |
| `instruments` | `db/schema/investments.ts:71` | `symbol`, `exchange`, `isin`, `currency_code`, `country`, **`price_provider`**, **`provider_symbol`**, `metadata` jsonb |
| `instrument_prices` | `:127` | `PK (instrument_id, as_of)`, `as_of` is a **`date`**, `close numeric(20,8)`, `currency_code`, `source`, `fetched_at`. **Empty** |
| `instrument_quotes` | `:154` | `PK (instrument_id)`, `as_of` is a **`timestamptz`**, `price`, `currency_code`, `source`, `fetched_at` |
| `fx_rates` | `db/schema/reference.ts:22` | `PK (base_code, quote_code, as_of)`, `rate numeric(20,10)`, `source`. **Empty** |
| FX selection rule | `domain/fx.ts` | Exact date, else most recent **earlier**, else `no_rate`. Never interpolates. Direct beats inverse. **Does not triangulate** — see M1 |
| Per-request FX lookup | `services/_fx.ts` | Loads once per request, synchronous thereafter; only pairs touching base |
| TWR | `domain/calc/twr.ts` | Complete and pinned by tests. Requires a valuation at **every** boundary; returns `insufficient_price_history` otherwise |
| XIRR | `domain/calc/xirr.ts` | Complete and working — it needs only cash flows plus a terminal value, and the terminal value is `0` today |
| Corporate actions in the ledger | `db/schema/investments.ts:219`, `domain/lots/engine.ts:397` | `split`/`bonus` carry `ratio_num`/`ratio_den` and `quantity IS NULL`; `CHECK`ed; `replay()` applies them and leaves money untouched |
| Job queue | `db/schema/ops.ts`, `server/jobs/` | `FOR UPDATE SKIP LOCKED` runner, retries with backoff, `npm run jobs:run`. One handler registered (`recurring.post`). The table's own comment already anticipates `'prices.refresh'` |
| Net worth at cost | `domain/networth/compose.ts` | `ValuationBasis = 'cost'` — a one-member union, deliberately, so widening it is a compile error everywhere it matters |
| Settings | `db/schema/settings.ts` | `base_currency` (INR), `locale` en-IN, `timezone` Asia/Kolkata, `price_stale_after_hours` = 24 |

**What is empty and why it matters:** `instrument_prices` and `fx_rates` have zero rows. Every
consequence flows from those two facts — TWR returns `insufficient_price_history`, the growth series
is all gaps, unrealised P&L is `null`, market-value net worth does not exist, and every non-INR
component is excluded from net worth. All of that is *documented behaviour*, correctly labelled in
the UI, not a set of bugs.

---

## 2. The one-paragraph statement of what Phase 6 is

Phase 6 supplies two tables — `instrument_prices` and `fx_rates` — and keeps `instrument_quotes`
current, through a provider abstraction that no other layer can see. Every calculation that consumes
them already exists. **Market data feeds the existing financial engine; it does not compute
anything.** Anywhere this document appears to propose a calculation, that calculation lives in
`src/server/domain/` beside the ones already there, and the market-data layer's output is its input.

---

## 3. Actual data requirements

The task is to establish the minimum, not to enumerate what providers sell.

### 3.1 Asset coverage — what this user actually holds

`asset_class` has nine members. They do not have equal claims on Phase 6.

| Asset class | MVP? | Price source | Reasoning |
|---|---|---|---|
| **`mutual_fund`** | **Required** | AMFI | For a typical Indian retail portfolio this is the largest block by value. It is also the only class with a **free, official, authoritative** daily source. Highest value per unit of effort in the whole phase |
| **`equity`** | **Required** | OD-3 adapter | Indian equities first; international equities from the same adapter if it covers both. The class TWR and the growth series were built for |
| **`etf`** | **Required** | OD-3 adapter | Exchange-traded, so the equity adapter covers it with no extra work. Indian gold ETFs land here, which is how gold gets priced without a gold feed |
| `gold` | **Manual** | Manual / `manual_assets` | Physical gold is a `manual_assets` row with a valuation series — Phase 5 already supports this exactly. Gold ETFs and gold MFs are priced as `etf`/`mutual_fund`. A bullion feed adds a licence question and a unit-conversion problem (per gram, purity 995 vs 999) for one row |
| `crypto` | **Optional** | CoinGecko or manual | Only if held. Cheap to add (free tier, keyless public API) and cleanly separable, but it is the one class with genuinely 24/7 pricing, which complicates the staleness rule ([§11](#11-staleness)). Defer unless needed |
| `bond` | **No** | Manual | Retail bond quotes in India are thin and unreliable. A stale, wide quote is worse than the user's own mark |
| `fixed_deposit` | **No** | Not applicable | An FD has no market price. It accrues. Pricing it from a feed is a category error; if a current value is wanted it is an accrual calculation, and that is not market data |
| `cash_equivalent` | **No** | Not applicable | Liquid funds are `mutual_fund` and priced by AMFI. True cash is an account balance |
| `other` | **No** | Manual | By definition unmodellable |

**Conclusion: three classes need a feed** — mutual funds, equities, ETFs — and two of those share one
adapter. Everything else is manual, and manual is already built and always registered.

**Different asset classes do not share a provider, and should not.** AMFI publishes Indian mutual
fund NAV as the industry body that collects it; a commercial vendor selling the same NAV is
redistributing AMFI's data, usually a day later and with its own mapping errors. Using the primary
source where a primary source exists is not multi-provider complexity, it is correctness.

### 3.2 Price data — required for MVP vs useful later

| Data | MVP | Why / why not |
|---|---|---|
| **End-of-day close** | **REQUIRED** | The single most important item. Every figure this application shows is a daily figure. It is also all that is available for Indian equities at any sane price point |
| **Historical daily closes** | **REQUIRED** | The gate on TWR, the growth series, market-value net worth history, and the unrealised-gain line in the change bridge. Four features, one dependency |
| **FX daily rates + history** | **REQUIRED** | `fx_rates` is empty; foreign components are excluded from net worth *today*. Historical rates are required by ADR-12 for reproducible historical totals |
| **Instrument metadata** (name, currency, exchange, ISIN) | **REQUIRED** | Needed once, at instrument creation, to stop the user hand-typing a currency that then mismatches the quote and produces `provider_error` forever |
| **Symbol search** | **REQUIRED** | The alternative is the user guessing the provider's symbol format. This is the difference between an instrument that prices and one that returns `not_found` silently |
| **Splits / bonus ratios** | **REQUIRED — as detections** | Not to post to the ledger, but to *detect* the M5 hazard. Without this, an unrecorded split produces a silently wrong market value with no signal at all |
| **Current / real-time price** | Later | A personal finance tracker is opened to understand a position, not to trade it. EOD is the honest granularity, and the India tier of every candidate is EOD anyway |
| **Delayed price** | **Never mixed in** | A 15-minute-delayed intraday price and an EOD close age on different clocks. Admitting both makes one staleness rule impossible. If intraday is ever added it gets its own status, not a shared one |
| **Intraday / OHLCV bars** | Later | Nothing in the roadmap consumes them |
| **Dividends (provider feed)** | Later, as a reminder only | A dividend received is a *ledger event the user records*, with the actual amount net of TDS. A provider's declared DPS is not that number. Useful as a "you may have received a dividend" nudge; never as a financial fact |
| **Exchange identifiers** | **REQUIRED** | Normalised to MIC ([§8.2](#82-exchanges)) |
| **Trading calendars** | **No table** | Derived. See below — this is a deliberate simplification, not an omission |
| **Delisted / security history** | Later | Needed to explain why a series stopped. Until then, a delisted instrument produces `not_found`, which must not delete stored history ([§12](#12-missing-data-behaviour)) |

**Trading calendars: the stored price series *is* the calendar.** A date with an `instrument_prices`
row for an exchange is a session; a date without one is not. This is exactly correct for every
exchange a provider covers, needs no new table, no timezone-rule engine and no holiday list to
maintain, and cannot drift from the prices it describes. It is only insufficient for a question this
application does not ask — "is the market open *right now*" — which matters for intraday and nothing
else. `getTradingCalendar()` therefore stays in the interface as a capability an adapter *may*
declare, and no MVP adapter declares it.

---

## 4. The TWR dependency, precisely

This is the answer to "what exactly must exist to lift `insufficient_price_history`". It is a
data-availability statement, not an implementation.

`twr()` in `domain/calc/twr.ts` is complete and correct, and **needs no change**. Line 82 builds
boundaries, lines 86–88 refuse unless *every* boundary has a valuation. The gate is entirely in the
caller that builds the `valuations` array.

For an instrument set `S` over `[from, to]`, TWR becomes computable when all five hold:

1. **The boundary set** is `B = {from, to} ∪ {trade_date of every external flow in (from, to)}`.
   Flows are what `portfolioCashFlows()` already produces: buys, sells, dividends, interest, standalone
   fees and taxes, and — at account or instrument scope only — unmatched transfer legs. Corporate
   actions contribute no boundary, because they move no cash.

2. **For every `b ∈ B`, a portfolio valuation must exist.** That requires, for every instrument held
   at `b`: a price observation with `as_of ≤ b` within the carry-back bound ([§10.3](#103-priceon-and-the-bounded-carry-back)),
   and an FX rate for its currency on `b`.

3. **"Held at `b`" includes instruments since fully disposed.** A position sold in March still
   determined the January and February sub-period returns. An implementation that reads *current*
   positions to decide which prices to fetch will silently compute the wrong `V₀` for every early
   sub-period and produce a plausible, wrong TWR. This is the trap in this section.

4. **A boundary can fall on a non-trading day.** A SIP debit dated on a market holiday, or a
   month-end `to` on a Saturday, has no close. The carry-back rule supplies the previous session's
   close, and that is correct — but it must be applied *when building the array*, because `twr()`
   does an exact key match on the boundary date and will otherwise refuse forever. This is a real
   blocker for any Indian user with a monthly SIP.

5. **`instrument_prices` must cover `[min(B) − carryback, max(B)]`** for every instrument in (3), and
   `fx_rates` the same span for every instrument currency in that set.

**Practical shape of the requirement.** A five-year window with a monthly SIP gives ~60 boundaries;
with dividends, ~80. Sixty to eighty valuation dates per instrument is not what should be fetched —
the daily series is fetched once and the boundaries are read out of it. For 30 instruments over 10
years that is ~75,000 rows, which is nothing.

**What is *not* required:** intraday prices, a benchmark series, or a valuation on every calendar day.
TWR needs boundaries, not a continuous curve. The continuous curve is the *growth series*, a separate
feature with a separate (denser) requirement.

---

## 5. Historical portfolio valuation

Four features share one derivation, and the design's first duty is to make sure they share one
*implementation*.

| Feature | Needs |
|---|---|
| Historical portfolio value (growth series) | A value on each of ~365 chart points |
| Historical allocation | The same value, decomposed by dimension, on one date |
| TWR | The same value on ~60–80 boundary dates |
| Market-value net worth, as-of | The same value on the net-worth date |
| The unrealised-gain line in the change bridge | The same value at **two** dates, minus cost at both |

All five are `portfolioValueOn(d)`. `INVESTMENT-DOMAIN.md` §8.1 already specifies it:

```
portfolioValueOn(d) = Σ over instruments:
      quantityHeldOn(instrument, d)
    × priceOn(instrument, d)
    × fxRateOn(instrument.currency, base, d)
```

**No second engine.** `valuePortfolio()` in `domain/pricing/valuation.ts` already takes
`HoldingInput[]` — quantity, invested, price, fx — and produces coverage, weights and exclusions. The
as-of path must build `HoldingInput[]` for a date instead of for today, and hand it to the *same*
function. If a second valuation path appears, the Investments page and the Net Worth page will
eventually disagree about the same portfolio on the same day, and neither will be obviously wrong.

### 5.1 `quantityHeldOn` — the corporate-action trap

Already flagged in `ROADMAP.md` Phase 6 and `INVESTMENT-DOMAIN.md` §8.1, restated here because it is
the one place Phase 5's immunity does not carry over.

`Σ quantity where trade_date ≤ d` is **wrong**. A `split` and a `bonus` carry `quantity IS NULL` and
a ratio (`db/schema/investments.ts:219`, `CHECK inv_txn_corporate_action_shape`), so a running sum
ignores them and reports the pre-split quantity for the rest of time. Correct:

```
quantityHeldOn(i, d) = Σ_{txn ≤ d} txn.quantity × Π{ ratio of every corporate action in (txn.trade_date, d] }
```

**Phase 5 was immune because money is invariant under corporate actions** — `replay()` leaves
`cost_total` and `remaining_cost` untouched, so the at-cost as-of figure needs no ratio arithmetic.
Market value is a *quantity* figure, and quantity is exactly what a split changes.

### 5.2 One SQL pass, not 365 replays

`INVESTMENT-DOMAIN.md` §8.1 states this and it is worth keeping: a 365-point chart must be one pass —
a cumulative ratio product per instrument as a window function, joined to prices with a lateral
"greatest `as_of ≤ d`". The escape hatch if it measures slow is the one already designed for
balances: a roll-up keyed by `investment_ledger_version`, invalidatable and rebuildable, never a
mutable record.

### 5.3 Snapshots — the ADR-24 question, answered provisionally

ADR-24 deferred `net_worth_snapshots` to Phase 6 "only if measurement justifies it". This review's
position: **build 6.5 and 6.8 first, measure, and expect not to need them.** The derivation is one
indexed pass over ~75,000 price rows and a few thousand ledger rows for a realistic portfolio.
Postgres will do that in single-digit milliseconds. If measurement disagrees, ADR-24's four rules
apply unchanged — and note rule 3 requires `user_state.valuation_version`, which does not exist yet
and is a prerequisite, not an afterthought.

---

## 6. Market-value net worth — the exact dependency

Phase 5 ships **Net Worth at Cost**. Phase 6 adds `basis: 'market'` as a *distinct* calculation
(ADR-23). What that concretely requires:

| # | Requirement | Notes |
|---|---|---|
| 1 | `ValuationBasis` widens `'cost'` → `'cost' \| 'market'` | Deliberately a one-member union today, so widening it produces a compile error at every site that must be considered. Do not weaken this by adding a default case |
| 2 | The investment block under `'market'` is **not** the lot-cost sum | It is `Σ quantityHeldOn × priceOn × fxOn` at `asOf` — [§5](#5-historical-portfolio-valuation). Under `'cost'` it stays the `tax_lots` derivation, untouched |
| 3 | Prices for every held instrument at `asOf` | Including instruments the user stopped following. A gap is an exclusion, never a cost fallback |
| 4 | FX at `asOf`, not at acquisition | This is why the basis switch moves the figure for **FX reasons alone**, independently of price: `'cost'` carries the investment block at acquisition rates (`tax_lots.fx_rate_to_base`), `'market'` at spot. Already documented; belongs in the release note, not in a support conversation |
| 5 | **Value-weighted coverage** | D-29 deferred this with an explicit reason — an FX-excluded component has no expressible base value to weight by. A *price*-excluded component does: its base cost basis is known. So Phase 6 must weight by base cost basis, and a coverage ratio that stays component-count under market basis is a defect (M8) |
| 6 | Exclusion, never substitution | ADR-23: a single figure never mixes bases. An unpriced holding is excluded and **named**. The temptation to "fall back to cost for just that one" produces a number in no basis at all |
| 7 | The change bridge's unrealised line becomes real | It renders `—` / "not measured — at cost" today. Under `'market'` it is `Δ(marketValue − costBasis)` across the period, which needs a market valuation at **both** endpoints — i.e. history, not just today's quote |
| 8 | The contributions map is unchanged | An investment contributes under key `{account, instrument}` in both bases; only the amount differs. I-21 (no duplicate key) and I-22 (`assets − liabilities = Σ map`) hold without modification. This is why the basis can be added without touching `compose.ts`'s core |
| 9 | Default flips to `'market'` | With the basis banner following it. A user who has hand-entered prices currently sees market value on Investments and cost on Net Worth; after the flip they agree |

**One consequence to state in the release note besides the FX one:** under `'market'`, net worth
becomes *dependent on a third party*. A provider outage of several days will not change the figure
(reads never call out), but it will age it — and the staleness marking must reach the net-worth
surface, which it currently has no field to carry (M3).

---

## 7. The provider abstraction

`src/server/market-data/` — server-only, per `ARCHITECTURE.md` §4's module map, which already
reserves the directory. Credentials are read here and nowhere else, and never cross into `app/**`
(SECURITY.md; enforced by `npm run check:no-client-secrets`).

### 7.1 Interface

Refines ADR-11's sketch. Two changes, both load-bearing.

```ts
export interface MarketDataProvider {
  readonly key: ProviderKey;                    // 'manual' | 'amfi' | 'frankfurter' | ...
  readonly capabilities: ProviderCapabilities;

  supports(instrument: InstrumentRef): boolean;

  getInstrument(ref: ProviderRef): Promise<Result<InstrumentMetadata, ProviderFailure>>;
  searchInstruments(query: string, hint?: AssetClass): Promise<Result<InstrumentCandidate[], ProviderFailure>>;

  getLatestPrices(refs: readonly ProviderRef[]):
    Promise<Map<ProviderRefKey, Result<PriceObservation, ProviderFailure>>>;

  getHistoricalPrices(ref: ProviderRef, from: IsoDate, to: IsoDate):
    Promise<Result<readonly PriceObservation[], ProviderFailure>>;

  getCorporateActions(ref: ProviderRef, from: IsoDate, to: IsoDate):
    Promise<Result<readonly CorporateActionObservation[], ProviderFailure>>;

  getDividends(ref: ProviderRef, from: IsoDate, to: IsoDate):
    Promise<Result<readonly DividendObservation[], ProviderFailure>>;

  getFxRates(pairs: readonly CurrencyPair[], on?: IsoDate):
    Promise<Map<PairKey, Result<FxObservation, ProviderFailure>>>;
}
```

**Change 1 — adapters return `PriceObservation`, not `PriceResult` (proposed ADR-27).** `live` /
`cached` / `stale` is a judgement about age relative to *now*. If each adapter makes it, two adapters
can classify the same age differently, and the classification is no longer a property of the system.
`classifyQuote()` already does it correctly in one place; keep that, and let adapters report only
what they observed.

**Change 2 — every method returns `Result<_, ProviderFailure>`.** ADR-11's `getHistoricalPrices`
returns `PricePoint[]`, which has no way to distinguish "this instrument has no history" from "the
provider was down". Those require opposite responses: the first is permanent and should stop
retrying; the second is transient and should.

`getTradingCalendar()` is **deliberately absent from the MVP adapters** but reserved in
`ProviderCapabilities` — [§3.2](#32-price-data--required-for-mvp-vs-useful-later).

### 7.2 Capabilities — what makes fallback safe

```ts
export interface ProviderCapabilities {
  readonly assetClasses: readonly AssetClass[];
  readonly markets: readonly Mic[];             // ['XNSE','XBOM'] etc.; empty means market-agnostic
  readonly cadence: 'eod' | 'intraday' | 'continuous';
  readonly historyFrom: IsoDate | null;         // earliest available, null means unknown
  readonly provides: readonly ('latest'|'history'|'corporate_actions'|'dividends'|'fx'|'search'|'metadata')[];
  readonly requiresCredential: boolean;
}
```

This mirrors the model-fallback rule in `CLAUDE.md`: *fallbacks must respect task capability; do not
downgrade a task to an incapable provider merely because it is available.* The registry refuses a
resolution whose capability does not cover the request, rather than calling and getting a confusing
`not_found`.

### 7.3 Resolution order

ADR-11's order stands, with one addition:

1. `instruments.price_provider` if set **and registered and capable** → that adapter.
2. Otherwise the first registered adapter whose `supports()` and `capabilities` both admit it.
3. Otherwise `ManualProvider`.

**Addition (proposed ADR-30): once an instrument has stored price history, its provider is pinned.**
Rule 2 is fine for resolving a *new* instrument. Applied to one that already has two years of series
from provider A, it silently starts appending provider B's closes into the same `(instrument_id,
as_of)` table, and the series becomes a blend with no way to tell which point came from where. See
M6. Changing an instrument's provider is an explicit act that purges and re-backfills.

### 7.4 What the rest of the application sees

Unchanged from today: `quotesFor(ctx, ids) → Map<string, PriceResult>` and `historicalCloses(...)`.
No caller learns a provider name. The registry sits *behind* `services/prices.ts`, driven by the
refresh job — **not** in the read path, because a read never makes a network call.

```
prices.refresh job ─▶ registry ─▶ adapter ─▶ HTTP ─▶ normalise ─▶ observations
                                                                      │
                                            upsert (age-guarded, M7)  ▼
                                              instrument_quotes / instrument_prices
                                                                      │
page render ─▶ services/prices.ts ─▶ classifyQuote ─▶ PriceResult ────┘
```

---

## 8. Normalised data model

The rule: **no provider-specific string reaches `src/server/domain/`.** Normalisation happens at the
adapter boundary, on the way in.

### 8.1 Instrument identity

| Layer | Identity |
|---|---|
| Core financial logic | `instruments.id` — a uuid. The **only** identity any calculation uses. Every lot, position, price row and ledger row hangs off it |
| Cross-provider bridge | **ISIN** where available (`instruments.isin`, already indexed). Stable across ticker renames, and carried by both AMFI's NAV file and Indian exchange data |
| Human identity | `symbol` + `exchange`, `UNIQUE (user_id, symbol, exchange) NULLS NOT DISTINCT` |
| Provider lookup key | `price_provider` + `provider_symbol` — a **lookup key, not an identity** |

That separation is why a ticker rename is a metadata edit and not a data migration: history hangs off
the uuid, so changing `provider_symbol` re-points the fetch and orphans nothing.

### 8.2 Exchanges

Normalised to **ISO 10383 MIC**: `XNSE` (NSE), `XBOM` (BSE), `XNAS`, `XNYS`, `XLON`. Providers' own
formats — `.NS` / `.BO` suffixes, `NSE:` prefixes, `INFY.NSE` — are adapter-local and never stored in
`instruments.exchange`. `exchange` is `NULL` for a mutual fund, which has none, and the
`NULLS NOT DISTINCT` unique index already handles that correctly.

### 8.3 Observation types

```ts
export interface PriceObservation {
  readonly providerRef: ProviderRef;
  readonly close: UnitPrice;            // scale 8 — never Money
  readonly currency: CurrencyCode;      // ISO 4217, validated against `currencies`
  readonly tradingDate: IsoDate;        // the SESSION, in the market's timezone
  readonly observedAt: Date;            // the instant the value was true
  readonly kind: 'eod' | 'nav' | 'intraday';
  readonly source: string;              // 'amfi' | 'twelvedata:XNSE' | ...
}

export interface FxObservation {
  readonly base: CurrencyCode;
  readonly quote: CurrencyCode;
  readonly rate: Rate;                  // scale 10
  readonly asOf: IsoDate;
  readonly source: string;              // records derivation: 'ecb:frankfurter:cross'
}

export interface CorporateActionObservation {
  readonly providerRef: ProviderRef;
  readonly kind: 'split' | 'bonus';
  readonly exDate: IsoDate;
  readonly ratioNum: number;            // mirrors investment_transactions.ratio_num/_den exactly,
  readonly ratioDen: number;            // so a detection maps 1:1 onto a proposed ledger row
  readonly source: string;
}

export type ProviderFailure =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'rate_limited'; readonly retryAfterSeconds: number | null }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'transport'; readonly detail: string }
  | { readonly kind: 'malformed'; readonly detail: string };
```

`CorporateActionObservation` mirroring the ledger's `ratio_num`/`ratio_den` shape is deliberate: a
detection the user accepts becomes a proposed `investment_transactions` row with no translation step
where an inversion could creep in.

---

## 9. Price precision

`FINANCIAL-DOMAIN.md` §1 and ADR-04 forbid floating point as the authoritative representation. That
rule has to survive a JSON boundary, which is where it is easiest to lose.

**Rules for every adapter:**

1. **Prices are parsed as strings.** `UnitPrice.parseUserInput(text)` — the same boundary a
   human-typed price crosses. Never `Number(x)` then `.toString()`.
2. **Prefer a provider's string-typed price field** where it offers one. A JSON *number* is an IEEE
   754 double by specification; it round-trips safely below ~15 significant digits, which covers
   every realistic equity or NAV price, but it is a silent narrowing and there is no reason to accept
   one when a string is available. (Twelve Data returns prices as strings.)
3. **More than 8 decimal places is a rejection, not a rounding.** `parseFixed` at `PRICE_SCALE`
   already refuses; the adapter surfaces `malformed` rather than truncating. A truncated price is a
   wrong price that looks right.
4. **`UnitPrice`, never `Money`, in the market-data layer.** Reading a NAV of `123.45678900` into a
   `Money` truncates it to `123.4568` at the boundary — the exact defect `src/lib/decimal/price.ts`
   exists to prevent. `valueOf(quantity, price)` is the only place scale 8 becomes scale 4, and it
   rounds **once**, at the end.
5. **FX rates are `Rate`, scale 10**, parsed the same way.
6. **Split ratios are integers.** `ratio_num`/`ratio_den` are `integer` with a `CHECK > 0`. A provider
   reporting a split as the decimal `0.2` is normalised to `1/5` by the adapter, or rejected — never
   stored as a float.

---

## 10. Timestamp semantics

`CLAUDE.md` requires the system to distinguish these and not silently convert between them. Each gets
one definition and one storage location.

### 10.1 The eight terms

| Term | Definition | Where it lives |
|---|---|---|
| **Provider timestamp** | Whatever the provider stamped, in whatever zone. **Never stored raw.** Interpreted into the two fields below | adapter-local only |
| **Market timezone** | A property of the exchange — `Asia/Kolkata` for XNSE/XBOM, `America/New_York` for XNAS. A constant in the adapter's exchange table, not a database column in MVP | adapter |
| **Trading date** | The calendar date of the session **in the market's timezone**. The primary key of a daily close | `instrument_prices.as_of` (`date`) |
| **Observation date** | The date on which the value was *true*. For an EOD close, identical to the trading date. They differ only for intraday, which the MVP does not admit | — (equal to trading date) |
| **End-of-day price** | The official close of a trading date | `instrument_prices.close` |
| **Latest-known price** | The highest-`as_of` observation seen for an instrument, whatever its provenance | `instrument_quotes` (one row) |
| **Delayed price** | An intraday price N minutes behind live. **Not admitted in MVP** — it ages on a different clock from an EOD close, and mixing the two makes a single staleness rule impossible | not stored |
| **Stale price** | A classification, computed on read, never stored — see [§11](#11-staleness) | computed |

### 10.2 The instant an EOD close is stamped with

`instrument_quotes.as_of` is a `timestamptz`; an EOD close is a *date*. Something has to choose the
instant, and the obvious candidates differ by up to ten hours — which flips the stale/cached boundary
at a 24-hour threshold. **Rule: the instant is the exchange's official close on that trading date, in
the exchange's timezone** — 15:30 IST for XNSE/XBOM, 16:00 ET for XNAS/XNYS. Not midnight, not the
fetch time.

For a mutual-fund NAV, which has no exchange, the instant is the AMFI publication convention for that
NAV date. `fetched_at` records when the row arrived and is **never** used for staleness — a price
fetched two minutes ago can be three weeks old, and conflating the two is how a stale figure gets
presented as current.

### 10.3 `priceOn` and the bounded carry-back

`INVESTMENT-DOMAIN.md` §8.1 specifies "the `instrument_prices` row with the greatest `as_of ≤ d`".
Correct, and necessary — Sundays, holidays and TWR boundary dates all need it. But **unbounded, it
lies**: an instrument whose provider stopped covering it in 2024 would be valued at its 2024 close
forever, with no gap shown anywhere (M9).

**Rule: the carry-back is bounded.** Beyond the bound, the point is a gap, not a value.

| Instrument cadence | Bound |
|---|---|
| `eod` (equities, ETFs) | The most recent session on that exchange, plus an absolute backstop of **10 calendar days** |
| `nav` (mutual funds) | Same — AMFI publishes on business days |
| `continuous` (crypto) | **2 calendar days** — there are no non-trading days to forgive |

The backstop is what turns "the provider quietly stopped covering this" from an invisible wrong
number into a visible gap.

---

## 11. Staleness

This section contains the most consequential correction in the review.

### 11.1 The defect in the current rule

`settings.price_stale_after_hours` defaults to 24, and `classifyQuote()` compares `now − as_of` in
hours. For an **end-of-day** price that is wrong in a way that fires every week:

| Moment | Age of Friday's close | Current classification |
|---|---|---|
| Friday 18:00 IST | 2.5 h | `cached` ✅ |
| Saturday 18:00 IST | 26.5 h | **`stale`** ❌ |
| Monday 09:00 IST | 65.5 h | **`stale`** ❌ |
| Monday 18:00 IST | 74.5 h | **`stale`** — until Monday's close lands |

So every equity and every ETF in the portfolio carries a "stale" badge across every weekend, and for
several days after every one of India's many market holidays. A warning that fires when nothing is
wrong is a warning the user learns to dismiss — and then it fails silently on the day something *is*
wrong. `CLAUDE.md` is emphatic that stale data must never be presented as current; a badge that is
always on communicates nothing at all.

**It is worse for mutual funds.** AMFI publishes a NAV dated for a business day, and a Friday NAV is
routinely still the latest through Monday morning. Under a 24-hour rule, the *entire* fund block is
permanently stale.

### 11.2 The corrected rule (proposed ADR-28)

**Staleness is measured in trading sessions for session-traded instruments, and in wall-clock hours
only for continuously-traded ones.** Four states, as `CLAUDE.md` requires:

| State | Session-traded (`eod`, `nav`) | Continuous (`crypto`) |
|---|---|---|
| `current` | `as_of` is the most recent completed session | age ≤ 6 h |
| `recent` | 1–2 sessions behind | 6–24 h |
| `stale` | ≥ 3 sessions behind, **or** > 10 calendar days regardless | > 24 h |
| `missing` | no observation at all | no observation at all |

**The reference session comes from the stored series, not from a calendar.** For an exchange, it is
`max(instrument_prices.as_of)` across the instruments on it — which is populated after the first
refresh, cannot disagree with the prices it describes, and needs no holiday list. Two guards make it
safe:

- **Bootstrap:** with only one instrument on an exchange, its own latest *is* the reference, so
  `sessionsBehind = 0`. That is correct-by-construction and cannot cry stale falsely — but it also
  cannot detect a provider that stopped, which is exactly what the **10-calendar-day backstop**
  covers. The two rules together are complete.
- **Future-dated quote:** already handled — `classifyQuote` reports it as `cached` at age zero rather
  than "fresher than fresh", because it is a clock problem and still the best price available. That
  behaviour is retained.

`price_stale_after_hours` is retained for the continuous case and as the crypto threshold, so no
setting is removed.

### 11.3 What the UI shows

| Surface | Stale behaviour |
|---|---|
| Holding row | The price is **used**, with its trading date shown and a marker. Never blanked — refusing a stale price would blank the portfolio every long weekend, which ADR-11 explicitly rejects |
| Portfolio header | "Priced as of <date>" whenever any holding is behind, with the count |
| Allocation / weights | Computed on the priced set, as today; `coverage` unchanged |
| **Net worth (`basis: 'market'`)** | The same marking must reach here. `NetWorthResult` has `assetCoverage` and `excluded[]` but **no field for "used, but old"** — M3. A confident net-worth figure computed entirely from three-week-old closes is exactly the thing `CLAUDE.md` forbids |
| Never | A stale price rendered as `0`, or omitted from a total without being named |

---

## 12. Missing-data behaviour

`ROADMAP.md` Phase 6's first "done when" is: *all seven failure modes per adapter return a
`PriceResult` and never throw.* The current `MissingPriceReason` has three members and cannot express
several of the conditions below.

### 12.1 Proposed `MissingPriceReason`

```ts
export type MissingPriceReason =
  | 'no_provider'                       // existing
  | 'not_found'                         // existing
  | 'provider_error'                    // existing — incl. currency mismatch
  | 'rate_limited'                      // NEW — transient; retry is obviously right
  | 'unsupported_asset'                 // NEW — adapter exists, cannot price this class
  | 'delisted'                          // NEW — permanent; stop retrying, keep history
  | 'unreconciled_corporate_action';    // NEW — M5. The dangerous one
```

### 12.2 Behaviour per condition

| Condition | Classification | Engine behaviour | User sees |
|---|---|---|---|
| Instrument not found by provider | `not_found` | excluded from totals, named | "not recognised by <provider>" + a re-map action. **History is never deleted** |
| No historical prices | series gap | TWR `insufficient_price_history`; growth renders a break | the reason, and which instruments caused it |
| Provider outage | *invisible until the quote ages* | reads touch only the database, so nothing fails. The job retries with the existing backoff | nothing, until `stale` |
| Rate limit | `rate_limited` | job reschedules honouring `retryAfterSeconds`; the last good quote stays | nothing, unless it persists into `stale` |
| Malformed response | `provider_error` + a log line | row **not written**. A partially-parsed batch writes the rows that parsed and reports the rest | the affected instruments |
| Stale price | `stale` | **used**, marked | the trading date and a marker |
| Delisted | `delisted` | excluded from market value; **cost basis and realised P&L are unaffected** | "no longer trading — last price <date>" |
| Temporarily unavailable market | `stale` via session count | nothing special — a closed market is why the session rule exists | nothing |
| Unsupported asset (FD, `other`) | `unsupported_asset` | excluded from market-basis totals, named. Under `'cost'` unaffected | "priced manually" |
| **Unrecorded corporate action** | `unreconciled_corporate_action` | **market value suppressed** for that instrument | "a 1:5 split on <date> is not in your ledger — record it to resume valuation" |

**Never fabricated:** a price is never interpolated, never carried forward past the bound, never
defaulted to cost inside a market figure, and never zero. The existing rule stands — rendering `null`
as `0` reads as "worthless", which is a different financial statement from "unknown".

### 12.3 The unrecorded-corporate-action rule (proposed ADR-29)

The highest-severity hazard in Phase 6, and the one the current design has no defence against.

A 1:5 split occurs. The provider's prices are post-split from the ex-date. If the user has not
recorded the `split` row, `quantityHeldOn` returns the pre-split quantity, and:

```
market value = 100 units × ₹200 (post-split) = ₹20,000
correct      = 500 units × ₹200              = ₹1,00,000
```

An 80% loss appears in the portfolio, in allocation, in net worth under `'market'`, and in the change
bridge's revaluation line. Every figure is internally consistent and all of them are wrong. Nothing in
the current design signals it.

**Rule:** when a provider reports a corporate action with an ex-date inside the instrument's holding
period and no matching `investment_transactions` row exists, that instrument's market value is
`missing: 'unreconciled_corporate_action'` until reconciled. **Suppress, never adjust** — silently
applying the provider's ratio would make an external feed change a position, which is the ledger
mutation ADR-29 exists to forbid.

Applying the detection is a **user action** that creates an ordinary `split`/`bonus`
`investment_transactions` row through the normal validated service path — the same
propose-then-confirm shape `CLAUDE.md` mandates for AI-generated mutations, for the same reason: an
external source's interpretation must not become a financial fact without deterministic validation.

---

## 13. Provider evaluation

Verified against official sources, accessed **2026-08-17/18**. Anything not confirmable from an
official page is marked **UNVERIFIED**.

### 13.1 The three that need no decision

| | AMFI | Frankfurter | Manual |
|---|---|---|---|
| Covers | Indian mutual funds (all schemes) | FX, 201 currencies incl. INR | everything |
| Auth | **none** | **none** | none |
| Cost | **free** | **free** | free |
| Quota | none published | *"no quotas… no monthly or daily caps"* | n/a |
| Latest | `NAVAll.txt`, daily | `/v1/latest?base=USD&symbols=INR` | user entry |
| History | from **April 2006**; the NAV-history report is capped at **90 days per request** | **back to 1948** | user entry |
| Identifiers | AMFI scheme code + **ISIN** | ISO 4217 | n/a |
| Corporate actions | n/a (NAV is already adjusted) | n/a | n/a |
| Licence | Public industry-body data. **No machine-readable licence found — see [§18](#18-data-persistence) and OD-13** | *"free for commercial use"*; underlying central-bank terms apply | n/a |
| Verified | [amfiindia.com/spages/NAVAll.txt](https://www.amfiindia.com/spages/NAVAll.txt), [NAV download page](https://www.amfiindia.com/net-asset-value/nav-download) | [frankfurter.dev](https://frankfurter.dev/) — and a **live call** returned `{"amount":1.0,"base":"USD","date":"2026-08-17","rates":{"INR":95.61}}` | — |

Frankfurter describes itself as a *"free, open-source exchange rates API sourcing from 84 central
banks"*, blended by default. Two consequences worth stating: `?base=USD` produces a **cross rate**
derived through the reference currency, so `source` must record the derivation
(`ecb:frankfurter:cross`); and for an Indian user the RBI publishes its own INR reference rate with
stronger local provenance but no clean free API — noted as a possible later substitution behind the
same adapter interface.

### 13.2 Candidates for OD-3 — Indian equities and ETFs

| Provider | India (NSE/BSE) | International | Cadence for India | Entry price | Personal-use / storage | Verified |
|---|---|---|---|---|---|---|
| **Twelve Data** | **Yes** — XNSE requires **Grow+** | 20+ markets at Grow, 70+ at Pro | **EOD** (stated on the XNSE page) | **$29/mo** Grow; Basic free = 3 markets, **India not included** | Terms permit *"Store Data solely for Internal Use"*; redistribution needs an add-on; free tier bars commercial use | [pricing](https://twelvedata.com/pricing), [XNSE](https://twelvedata.com/exchanges/XNSE), [terms](https://twelvedata.com/terms) |
| **Kite Connect (Zerodha)** | **Yes** — native NSE/BSE | **None** | Realtime WebSocket + historical candles | **₹500/mo** (~$5); a free "Personal" tier exists for orders/portfolio but **not** market data | UNVERIFIED. Requires a **Zerodha account**, and its login expires daily — hostile to an unattended job | [zerodha.com/products/api](https://zerodha.com/products/api/) |
| **EODHD** | **UNVERIFIED** — no India entry found in the exchange list (70 exchanges as of Aug 2026) | Broad | EOD | $19.99/mo EOD-All-World; free = **20 calls/day** | Plans designated *"Personal use"*; commercial needs a separate plan | [pricing](https://eodhd.com/pricing), [exchanges](https://eodhd.com/financial-apis/list-supported-exchanges) |
| **marketstack** | **UNVERIFIED** — India not stated | "2700+ exchanges" claimed | EOD (intraday US only below Professional) | $9.99/mo Basic (10k req/mo); free = **100 req/mo**, 1 yr history | Commercial use from Basic; free-tier attribution UNVERIFIED | [marketstack.com/product](https://marketstack.com/product) |
| **Tiingo** | **No** — US, China, global; India not listed | Yes | EOD | $30/mo individual; free = 50 req/h, 500 symbols/mo | *"you may only use the data for your own personal use"* — a clean fit if it covered India | [pricing](https://www.tiingo.com/about/pricing) |
| **Alpha Vantage** | UNVERIFIED | Yes | — | free = **25 req/day**; paid from $49.99/mo | UNVERIFIED | [premium](https://www.alphavantage.co/premium/) |
| **Finnhub** | UNVERIFIED | Yes | — | UNVERIFIED — pricing page did not render | UNVERIFIED | [finnhub.io/pricing](https://finnhub.io/pricing) |
| **Yahoo Finance (unofficial)** | Yes in practice | Yes | Delayed/EOD | free | **Excluded.** No licence for programmatic access; every client is an unofficial scraper against terms that forbid it | — |
| **NSE / BSE direct (bhavcopy)** | Yes | No | EOD | free | **Excluded.** NSE's terms prohibit *"any systematic or automated data collection activities (including scraping, data mining, data extraction and data harvesting) on or in relation to our website without our express written consent."* Both exchanges also restricted overseas website access in 2025 | [NSE terms of use](https://dotexdata.nseindia.com/TermsAndConditions/TermsofUse.pdf) |
| **CoinGecko** (crypto only) | n/a | n/a | continuous | free Demo: **10,000 calls/mo**, 100/min, keyless public API; ~1 yr history | Paid tiers require *"Data provided by CoinGecko"* attribution; resale barred | [api pricing](https://www.coingecko.com/en/api/pricing) |

### 13.3 Reading of the table

**Twelve Data is the recommended OD-3 answer** on coverage: one adapter, one credential, one code
path covering Indian equities and ETFs (EOD), international equities, FX and crypto — and its terms
explicitly permit storing data for internal use, which is precisely this application's shape. $29/mo
is the cost of that consolidation.

**Kite Connect is materially cheaper (₹500/mo, roughly one-fifth)** and native to the market that
matters most, but carries two real engineering costs: it requires a Zerodha account, and its session
token expires daily behind an interactive login — hostile to an unattended `prices.refresh` job, and
the workaround is a stored-credential automation that `SECURITY.md` should not want. It also covers
no international market, so a US holding still needs a second adapter.

**Everything free was excluded for a reason, not for lack of looking.** Yahoo-compatible sources and
direct exchange scraping are the two obvious free routes to Indian equity prices, and both are
contractually prohibited. A system whose stated first priority is financial correctness should not
rest its valuation layer on a source that can be withdrawn without notice and is not licensed in the
first place.

**The free tiers of the commercial providers do not solve this either.** Twelve Data Basic excludes
India; EODHD free is 20 calls/day; marketstack free is 100 calls/month with one year of history;
Alpha Vantage free is 25 calls/day. None supports even a 30-instrument daily refresh with backfill.

---

## 14. Provider strategy

**Multi-provider — but three adapters, each the only good source for its domain, plus Manual.** This
is not multi-provider for novelty; it is what the coverage map forces.

```
Indian mutual funds      ──▶ AMFI          free · official · keyless · ISIN
FX                       ──▶ Frankfurter   free · central-bank · keyless · no quota
Everything, always       ──▶ Manual        already built · user-attested
Indian + intl equity/ETF ──▶ OD-3          one commercial adapter, added at step 6.9
```

**Why not a single provider.** A single commercial feed would cover equities, ETFs and FX, and
nominally mutual funds. It would still be the wrong choice for Indian MF NAV: a vendor selling that
NAV is redistributing AMFI's own publication, typically a day later and with its own scheme-mapping
errors. Using the primary source where one exists is correctness, not complexity — and it happens to
be free.

**Why not more.** No gold adapter (gold is an ETF, an MF, or a manual asset). No bond adapter (thin
quotes are worse than the user's mark). No crypto adapter unless crypto is held. Each would be a
provider added because it exists.

---

## 15. Fallback strategy

**There is no cross-provider price fallback, and that is a deliberate rule, not an omission (ADR-30).**

`CLAUDE.md`: *"Never combine inconsistent provider data silently."* Two providers' closes for the same
instrument differ — different venue, different auction handling, different adjustment policy. Splicing
them into one series makes the discontinuity indistinguishable from a real price move, and it lands in
unrealised P&L, TWR and net worth simultaneously.

| Data | Fallback permitted? | Rule |
|---|---|---|
| A price series (`instrument_prices`) | **No** | One provider per instrument, pinned once history exists. Switching purges and re-backfills |
| A latest quote (`instrument_quotes`) | **Manual only** | Manual is not a fallback in the same sense — it is a different, user-attested source, always visible as `source: 'manual'` and never silently substituted |
| FX rates | **Yes, with recorded provenance** | A rate is a market-wide observation, not an instrument-specific series. A second FX source is admissible provided `source` records which one; mixing two sources across dates for one pair is still avoided |
| Corporate actions | **Yes** | They are detections, not values. More sources means better detection; the user adjudicates |
| Instrument metadata / search | **Yes** | Advisory only. It never enters a calculation |

**Transport retry is not fallback.** Retry-with-backoff against the *same* provider is the job
runner's existing behaviour and needs no new concept.

**Capability-respecting refusal.** Mirroring `CLAUDE.md`'s model-fallback rule, the registry refuses a
resolution whose `ProviderCapabilities` do not cover the request rather than calling and interpreting
a confusing `not_found`.

---

## 16. Caching

**Required? Yes — and it already exists.** `instrument_quotes` and `instrument_prices` *are* the
cache. The existing rule that a read never makes a network call means pages can only ever see the
database, so there is nothing for a second cache layer to sit in front of.

**Redis is not justified and should not be added.** The measurement that would justify it does not
exist:

| Dimension | This application |
|---|---|
| Request reduction | ~30 instruments × 1 refresh/day ≈ **900 requests/month**. Three orders of magnitude inside every candidate quota |
| API limits | Twelve Data Grow is 55 credits/**minute**. A full refresh is ~30 credits — it finishes in one minute, once a day |
| Latency | Not on the read path at all. Page render is a Postgres query against an indexed table |
| Freshness | Governed by the refresh schedule, which is daily because the data is daily |
| Invalidation | Not applicable. A price row is an append, not an invalidation — a new observation is a new row or a newer `as_of`, never a correction to an old one |

The only in-process state worth having is the per-request FX lookup `services/_fx.ts` already builds
(loaded once per request so a pure calculation never awaits a rate mid-sum). Phase 6 extends it to
load the pairs market data needs; it adds no new mechanism.

**Sizing, so the "just store it" claim is checked rather than asserted.** 30 instruments × 250
sessions/year × 10 years ≈ **75,000 rows** in `instrument_prices`, at roughly 60 bytes plus index —
well under 20 MB. `fx_rates`: 3 pairs × 260 days × 10 years ≈ 8,000 rows.

---

## 17. Refresh strategy

Jobs are **defined** here; none is implemented in this review. The existing runner
(`FOR UPDATE SKIP LOCKED`, retries with backoff, `npm run jobs:run` under cron) is the mechanism, and
`db/schema/ops.ts` already names `'prices.refresh'` in its comment.

| Job | MVP? | Trigger | Scope | Notes |
|---|---|---|---|---|
| **`fx.refresh`** | **Yes** | Daily, after reference-rate publication (~19:30 IST) | Every currency in use vs base | Cheapest and highest-value: it un-excludes every foreign component from net worth |
| **`prices.refresh`** | **Yes** | Daily, after market close (~19:00 IST for XNSE/XBOM; AMFI NAV lands late evening) | Distinct instruments in **open** positions | Batched per provider. Writes `instrument_quotes` **and** appends today's `instrument_prices` row — one fetch serving both |
| **`prices.backfill`** | **Yes** | On instrument creation, and user-triggered | One instrument, bounded range | The only job that fetches a long history. AMFI's 90-day report cap means chunking |
| **`corporate_actions.refresh`** | **Yes** | Weekly | Held instruments | Produces **detections**. Cheap, and the M5 hazard is the reason it exists |
| User-triggered "refresh now" | **Yes** | A button | Enqueues the same jobs | ADR-11's rule: a read never fetches; a manual refresh enqueues |
| Intraday refresh | **No** | — | — | Nothing consumes an intraday price. The India tier is EOD regardless |
| `dividends.refresh` | **No** | — | — | A dividend is a ledger event the user records at the actual net amount |
| `networth.snapshot` | **Only if measured** | — | — | ADR-24's four rules; expect not to need it ([§5.3](#53-snapshots--the-adr-24-question-answered-provisionally)) |

**MVP job count: four.** All four are idempotent by construction — a price upsert keyed on
`(instrument_id, as_of)` re-run on the same day writes the same row, and the age guard in M7 makes a
late-arriving response harmless.

**Nothing schedules the runner automatically yet.** That is carried Phase 3 debt (`recurring.post`
has the same gap) and belongs to deployment, not to Phase 6.

---

## 18. Data persistence

Per category: whether, why, retention, frequency, authority.

| Category | Persist | Why | Retention | Update | Authoritative source |
|---|---|---|---|---|---|
| **Instrument metadata** | **Yes** — `instruments` (exists) | User-owned identity. The provider is a lookup key, never the identity | Forever | On user edit; a provider only *suggests* at creation | **The user.** A provider never overwrites a name or currency on a live instrument |
| **Latest quote** | **Yes** — `instrument_quotes` (exists) | Reads never call out, so the latest price must be resident | 1 row per instrument | Daily | Provider, or the user for manual |
| **Historical closes** | **Yes** — `instrument_prices` (exists) | The single dependency of TWR, growth, market-value net worth and the unrealised line. Providers cap history depth and can drop coverage; refetching is slow and sometimes impossible | **Forever** — 75k rows for a decade | Daily append + backfill | Provider (one per instrument, pinned) |
| **FX observations** | **Yes** — `fx_rates` (exists) | Already required by ADR-12: historical totals must be reproducible, so the rate that was used must be the rate that is stored | Forever | Daily | Central bank via the FX adapter |
| **Corporate actions** | **Yes** — a **new** `corporate_action_detections` table | Needed to detect the M5 hazard. Kept **out** of `investment_transactions`, which is the ledger | Forever (tiny) | Weekly | Provider — as a *detection*, never a fact |
| **Dividend calendar** | **No** | The financial fact is the ledger row the user records at the real net amount. Storing a provider's declared DPS creates a second number that will disagree | — | — | The user |
| **Trading calendars** | **No** | Derived from `instrument_prices` ([§3.2](#32-price-data--required-for-mvp-vs-useful-later)). A separate calendar would be a second source of truth about whether a market was open | — | — | derived |
| **Raw provider responses** | **No** | A debugging convenience that becomes a second copy of financial data with no retention policy. Structured log lines on failure, without payloads | — | — | — |
| **Search results** | **No** | Advisory, transient, never enters a calculation | — | — | — |

**`corporate_action_detections` — proposed shape** (additive; no existing table altered):

```sql
CREATE TABLE corporate_action_detections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instrument_id   uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  kind            investment_kind NOT NULL,        -- 'split' | 'bonus' only, CHECKed
  ex_date         date NOT NULL,
  ratio_num       integer NOT NULL CHECK (ratio_num > 0),
  ratio_den       integer NOT NULL CHECK (ratio_den > 0),
  source          text NOT NULL,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  -- Set ONLY when the user accepts the detection through the normal validated
  -- service path. Never written by an adapter or a job (ADR-29, invariant I-40).
  resolved_txn_id uuid REFERENCES investment_transactions(id) ON DELETE SET NULL,
  dismissed_at    timestamptz,
  UNIQUE (instrument_id, kind, ex_date)
);
```

The `UNIQUE (instrument_id, kind, ex_date)` is what makes weekly re-detection idempotent — the same
split found ten times is one row.

---

## 19. Cost model

At the rate this review verified live on 2026-08-17, **USD 1 = INR 95.61**.

| Scenario | Providers | Monthly | Annual |
|---|---|---|---|
| **MVP as specified** (mutual funds + FX + manual) | AMFI + Frankfurter + Manual | **₹0** | **₹0** |
| **+ OD-3 via Kite Connect** | above + Kite Connect | **₹500** | **₹6,000** |
| **+ OD-3 via Twelve Data Grow** | above + Twelve Data | **$29 ≈ ₹2,773** | **$348 ≈ ₹33,270** |
| + crypto | + CoinGecko Demo | **₹0** (10k calls/mo free) | ₹0 |

**Call volume under each usage pattern — none of which approaches a limit.**

| Pattern | Requests | Against |
|---|---|---|
| Low usage (10 instruments, daily refresh) | ~300/month | Twelve Data Grow: 55/minute |
| Moderate (30 instruments, daily + FX + weekly actions) | ~1,100/month | same |
| **Historical backfill, one-off** | ~30–60 requests total (one `time_series` call per instrument returns up to 5,000 points) | trivially inside a single day's allowance |
| AMFI daily | **1 request** — `NAVAll.txt` is one file containing every scheme | no quota |
| FX daily | **1 request** per pair | no quota |
| Future expansion (100 instruments, 10 yr history) | ~3,500/month | still inside Grow |

**The honest headline: the recurring cost of Phase 6 is entirely the OD-3 licence fee. Call volume
costs nothing on any candidate plan, at any usage level this application will reach.** That is the
fact that should keep the caching and rate-limiting design as small as [§16](#16-caching) makes it.

---

## 20. Recommended MVP architecture

### A. Required providers

| | Provider | Covers | Cost |
|---|---|---|---|
| 1 | **Manual** (exists) | Everything, always registered | ₹0 |
| 2 | **AMFI** | Indian mutual funds — latest NAV + history from 2006 | ₹0 |
| 3 | **Frankfurter** | FX, all currencies in use vs base, plus history | ₹0 |
| 4 | **OD-3 adapter** | Indian + international equities and ETFs, EOD | ₹500–₹2,800/mo |

### B. Optional providers

CoinGecko (crypto, free tier) — only if crypto is held. Nothing else.

### C. Data types to persist

`instruments` metadata · `instrument_quotes` latest · `instrument_prices` history · `fx_rates` ·
`corporate_action_detections` (new).

### D. Data types to fetch dynamically, never stored

Symbol search results · instrument metadata previews at creation time · provider health.

### E. Update frequency

FX daily · prices daily post-close · corporate actions weekly · backfill on demand · no intraday.

### F. Cache strategy

**PostgreSQL only.** The two price tables are the cache; the read path already cannot bypass them. No
Redis, no memoisation layer beyond the existing per-request FX lookup.

### G. Fallback strategy

No cross-provider price fallback. Manual is the universal floor. FX and corporate actions may have
multiple sources with recorded provenance. Retry-with-backoff is transport, handled by the existing
job runner.

### H. Internal normalised schema

Additive only. **No existing table is altered except by adding nullable columns or columns with
defaults**, preserving the Phase 4/5 precedent that a migration contains no `DROP` and no destructive
`ALTER` on a pre-existing table.

| Change | Kind |
|---|---|
| `corporate_action_detections` | new table |
| `instrument_prices` — add `provider_ref text NULL` | nullable column, provenance |
| `settings` — add `price_stale_after_sessions integer NOT NULL DEFAULT 3` | new column with a default, for ADR-28 |
| `MissingPriceReason` — 4 new members | TypeScript union, not a database enum |
| `ValuationBasis` — widen to `'cost' \| 'market'` | TypeScript union |
| `NetWorthResult` — add a staleness field (M3) | TypeScript interface |

### I. Provider abstraction

[§7](#7-the-provider-abstraction). `src/server/market-data/{index.ts, registry.ts, types.ts,
providers/{manual,amfi,frankfurter,<od3>}.ts}`. Credentials read only here. `quotesFor()` and
`historicalCloses()` remain the application's only price entry points.

### J. Implementation sequence

The point of this ordering: **OD-3 is step 9 of 12.** Eleven steps are unblocked today.

| Step | Work | Gated on |
|---|---|---|
| **6.0** | Apply this review's findings (M1–M13) to the canonical documents; 4 ADRs; new invariants | **OD-10** (user approval) |
| **6.1** | `market-data/` skeleton: types, capabilities, observations, registry, resolution order, `ManualProvider` over the existing quotes. **No network** | — |
| **6.2** | Staleness rework (ADR-28): session counting, the 10-day backstop, the 4 new `MissingPriceReason` members, UI copy | 6.1 |
| **6.3** | **FX adapter (Frankfurter)** + `fx.refresh` + base-pair normalisation (M1) + FX-age classification (M11) | 6.1 |
| **6.4** | **AMFI adapter** + `prices.refresh` for funds + ISIN/scheme mapping + backfill with 90-day chunking | 6.1, 6.2 |
| **6.5** | Historical valuation service: `quantityHeldOn` with ratio product, bounded `priceOn`, one-pass growth series | 6.4 |
| **6.6** | **TWR unblocked**: the boundary-valuation builder, incl. disposed instruments. `twr.ts` unchanged | 6.5 |
| **6.7** | `corporate_action_detections` + the suppression rule (ADR-29) + the review surface | 6.5 |
| **6.8** | **Market-value net worth**: `basis: 'market'`, value-weighted coverage, the real unrealised line, the default flip, the release note | 6.5, 6.7 |
| **6.9** | **OD-3 equity adapter.** Slots into the registry; nothing above changes | **OD-3** |
| **6.10** | Snapshots — **only if** 6.5/6.8 measure slow, under ADR-24's four rules | measurement |
| **6.11** | Completion gate: `ROADMAP.md` Phase 6 "done when", golden **G3/G5/G6**, **G2 on market value**, I-1…I-40 | all |

**Steps 6.3 and 6.4 alone deliver visible value with no credential and no cost:** every foreign
component re-enters net worth, and every mutual fund gets a real market value, a real unrealised P&L,
a real TWR and a real growth curve.

---

## 21. Defects found in the baseline (M1–M13)

None is a live wrong number today — `instrument_prices` and `fx_rates` are empty, so every affected
path reports a labelled gap. Each would produce a silently wrong financial figure on the day a
provider is connected. That is why they are worth finding now rather than in Phase 6 verification.

| # | Sev | Defect | Correction |
|---|---|---|---|
| **M1** | **High** | **`selectRate()` cannot triangulate, and reference FX feeds are quoted against one reference currency.** `domain/fx.ts` resolves *direct* or *inverse* only. An adapter that stores the feed's native rows (`EUR→INR`, `EUR→USD`) leaves a USD holding in an INR-base portfolio with **no rate**: `no_rate`, excluded, and the entire US block silently vanishes from net worth | Normalise **in the adapter**: persist the pairs the application needs, quoted against base, letting the feed compute the cross (`?base=USD&symbols=INR`). Record the derivation in `source`. `selectRate` is unchanged — its two-way rule stays the simple thing it is |
| **M2** | **High** | **Staleness is wall-clock, the data is end-of-day.** At `price_stale_after_hours = 24`, Friday's close is `stale` all weekend and until Monday's close lands. Every equity, every ETF, every mutual fund, every week. A permanently-on warning is an ignored warning | Session-based classification with a calendar-day backstop — [§11](#11-staleness), **ADR-28** |
| **M3** | **High** | **Staleness cannot reach the net-worth figure.** `NetWorthResult` carries `assetCoverage`, `liabilityCoverage` and `excluded[]`, but has **no field for "used, but old"**. Under `basis: 'market'` a portfolio priced from three-week-old closes yields a confident headline number with nothing to qualify it | Add a staleness summary to `NetWorthResult`; render it beside the basis banner that already exists |
| **M4** | **High** | **Nothing prevents a provider-sourced corporate action from being written to the ledger.** A `split` row drives `replay()` and therefore every lot, position and realised-P&L figure. An adapter inserting one is an unvalidated external source mutating Layer 1 — and it double-applies if the user already recorded it | Detections only, in their own table, applied by an explicit user action through the validated service path — **ADR-29**, invariant **I-40** |
| **M5** | **High** | **An unrecorded split produces a silently wrong market value.** Post-split price × pre-split quantity = an 80% phantom loss propagated into portfolio, allocation, net worth and the change bridge, all internally consistent | Detect and **suppress**: `missing: 'unreconciled_corporate_action'`. Never adjust — [§12.3](#123-the-unrecorded-corporate-action-rule-proposed-adr-29) |
| **M6** | Medium | **Two providers can silently blend one price series.** `instrument_prices` is `PK (instrument_id, as_of)` with `source` as a plain column, and ADR-11's resolution rule 2 permits a different adapter to claim an instrument whose `price_provider` is null. The last writer wins, per row | Pin the provider once history exists; switching purges and re-backfills — **ADR-30**, invariant **I-35** |
| **M7** | Medium | **`instrument_quotes` upsert has no age guard.** `setManualPrice` does `onConflictDoUpdate` unconditionally. A refresh job can overwrite a just-typed manual price with an older provider quote, or a late response can overwrite a newer one | Guard the write on `EXCLUDED.as_of >= instrument_quotes.as_of`; a manual price outranks a provider price of equal `as_of`. Invariant **I-36** |
| **M8** | Medium | **Coverage stays a component count under market basis**, though D-29 explicitly promised value weighting once price-driven exclusions arrive. One unpriced ₹40 L holding among twenty small ones reads as 95% covered | Weight by base cost basis — known in base even when the price is not, which is exactly why D-29 said Phase 6 could do it |
| **M9** | Medium | **The `priceOn` carry-back is unbounded.** "Greatest `as_of ≤ d`" is right, and without a bound an instrument the provider dropped in 2024 is valued at its 2024 close forever, invisibly | Bound it: latest session plus a 10-calendar-day backstop; 2 days for continuous instruments — [§10.3](#103-priceon-and-the-bounded-carry-back) |
| **M10** | Medium | **TWR boundary dates can fall on non-trading days.** `twr.ts:86-88` does an exact key match on every boundary; a SIP dated on a market holiday therefore returns `insufficient_price_history` permanently | The *caller* builds a valuation for every boundary using carry-back. `twr.ts` needs no change — state this so it is not "fixed" in the domain function |
| **M11** | Medium | **FX has no staleness concept at all.** Prices have a four-state `PriceResult`; `selectRate` returns the most recent earlier rate with **no age bound and no marker**. A month-old rate produces a confident base figure | Classify FX age the same way price age is classified, and surface it. The asymmetry is the defect |
| **M12** | Low–Med | **A symbol change is silent.** `provider_symbol` re-points cleanly (identity is the uuid, so history is safe), but nothing detects that a symbol now resolves to a *different company* — the dangerous direction | On `not_found`, never delete history and never silently re-resolve. Verify ISIN on re-map |
| **M13** | Low | **`instruments.isin` is stored, indexed and editable, but is never a lookup key.** `services/instruments.ts` carries it through create, read and update, and `instruments_isin_idx` exists — yet every resolution is by `id` or by `(user_id, symbol, exchange)` (`instruments.ts:96,159-163`), and no query matches on `isin`. So the index serves nothing today | Make ISIN the preferred provider mapping key where present — it is the correct cross-provider bridge, stable across ticker renames, and AMFI's NAV file carries it |

**Two things checked and found correct**, recorded so they are not re-litigated: the currency-mismatch
guard in `classifyQuote:84` is exactly right and is the one cross-table rule the database cannot
express; and the future-dated-quote handling (`cached` at age zero rather than discarded) is the right
call for a clock problem.

---

## 22. Proposed invariants I-33 … I-40

Continuing `SCHEMA.md` §12's numbering, which currently ends at **I-32**.

| # | Invariant | Enforced by |
|---|---|---|
| **I-33** | `instrument_quotes.currency_code = instruments.currency_code` for every row | engine (`classifyQuote`) + `verify:integrity` |
| **I-34** | `instrument_prices.currency_code = instruments.currency_code` for every row | `verify:integrity` |
| **I-35** | Every `instrument_prices` row for one instrument shares one `source` — no blended series (M6) | `verify:integrity` |
| **I-36** | `instrument_quotes.as_of >= max(instrument_prices.as_of)` for the same instrument — the latest quote is never older than the newest stored close (M7) | `verify:integrity` |
| **I-37** | No `instrument_prices` row is dated after the latest known session for its exchange | `verify:integrity` |
| **I-38** | Under `basis: 'market'`, every open position **either** contributes a priced value **or** appears in `excluded[]` with a reason — exhaustive and disjoint | engine + integration test |
| **I-39** | A market-basis figure never uses a cost figure for any holding — no cost fallback inside a market total (ADR-23) | engine + type-level test |
| **I-40** | A `corporate_action_detections` row's `resolved_txn_id` is only ever set through the validated service path; no adapter or job writes it (ADR-29, M4) | engine + integration test + source scan |

I-38 and I-39 are engine invariants in D-30's sense — not expressible as a query without
reimplementing net worth inside the checker — and should be reported by `verify:integrity` with the
file and test that enforce each, exactly as the eight Phase 5 engine invariants are.

---

## 23. Proposed ADRs

| | Decision | Replaces / refines |
|---|---|---|
| **ADR-27** | **Market-data adapters return observations; the registry classifies freshness.** `live`/`cached`/`stale` is a judgement about age relative to now, made once in one place, not independently by each adapter. Every adapter method returns a `Result` so "no such instrument" and "the provider is down" are distinguishable | **Refines ADR-11**, which has adapters returning `PriceResult` |
| **ADR-28** | **Staleness is measured in trading sessions, not wall-clock hours**, with a 10-calendar-day absolute backstop; wall-clock is retained only for continuously-traded instruments. The stored price series *is* the trading calendar | New. Corrects the consequence of `price_stale_after_hours` for EOD data |
| **ADR-29** | **Provider-sourced corporate actions are detections, never ledger writes.** An unreconciled detection **suppresses** the instrument's market value rather than adjusting it. Applying one is an explicit user action through the validated service path | New. Same rule, same reason, as `CLAUDE.md`'s AI mutation rule |
| **ADR-30** | **One provider per instrument price series, pinned once history exists.** No cross-provider price fallback; the only fallback is Manual, which is a different source and always visibly labelled. FX and corporate actions may have multiple sources with recorded provenance | New. Implements `CLAUDE.md`'s "never combine inconsistent provider data silently" |

**ADR-11 is refined, not replaced.** Its core — a provider abstraction, per-instrument selection, an
always-available manual provider, a discriminated price union, and valuation that never throws on a
missing price — all stands and is already implemented.

---

## 24. Adversarial review

Twenty scenarios, tested against the design above. The question in each is: **where could this produce
an incorrect financial number?**

| # | Scenario | Behaviour under this design | Residual risk |
|---|---|---|---|
| 1 | **Indian stock**, NSE, INR | OD-3 adapter, EOD close, trading date = IST session, no FX. `marketValue = qty × close` | None once OD-3 is resolved. **Until then: `no_provider`, excluded and named** |
| 2 | **US stock**, NASDAQ, USD, INR base | Price in USD (instrument currency), `baseMarketValue` via `fxOn(USD→INR, d)`. `returnPct` in USD so FX does not masquerade as price movement | `baseUnrealizedPnl` legitimately mixes price and FX — a **documented** Phase 4 limitation, not new |
| 3 | **Mutual fund** | AMFI, matched by ISIN or scheme code, no exchange; `exchange IS NULL` handled by the `NULLS NOT DISTINCT` index | AMFI publishes NAV at varying evening times; the daily job may catch T-1. Handled by the session rule, not by a wall clock |
| 4 | **ETF** | Same path as an equity | Indian gold ETFs land here — which is how gold gets priced with no gold feed |
| 5 | **No historical price** | `instrument_prices` empty for it → TWR `insufficient_price_history`, growth renders a break with the instrument named | **Correct today and after Phase 6.** The failure mode is a labelled gap |
| 6 | **Stale price** | Session-counted; **used** and marked; propagates to the portfolio header and to net worth | M3 must be fixed or the net-worth surface has no field to carry the marking |
| 7 | **Provider outage** | Invisible on the read path — reads touch only the database. Job retries with backoff. Quote ages into `stale` naturally | None. This property falls out of "a read never makes a network call" |
| 8 | **Rate limit** | `rate_limited`, distinct from `provider_error`; job honours `retryAfterSeconds`; last good quote retained | None at this volume ([§19](#19-cost-model)) |
| 9 | **Symbol change** | Identity is the uuid; history hangs off it. Re-map is a metadata edit | **M12** — nothing detects a symbol now resolving to a different company. Verify ISIN on re-map |
| 10 | **Corporate action** | Detected weekly, never auto-applied; the user creates the ledger row through the normal path | **M4/M5.** Without ADR-29 this is the worst failure mode in the phase |
| 11 | **Dividend** | Recorded by the user at the real net amount. A provider feed is a reminder at most | Deliberate. A provider's declared DPS is not the amount received after TDS |
| 12 | **Stock split** | See 10. Prices are post-split from the ex-date; quantity is only post-split once the ledger row exists | Suppression closes the window between the ex-date and the user recording it |
| 13 | **Delisted asset** | `delisted`: excluded from market value, **history preserved**, cost basis and realised P&L untouched | Distinguishing `delisted` from `not_found` needs provider support; degrades to `not_found`, which is also excluded-and-named — safe, just less specific |
| 14 | **Currency conversion** | Base-quoted pairs stored directly (M1); `selectRate` exact-or-earlier, never interpolated, never a later rate for an earlier date | Cross rates are derived through a reference currency — recorded in `source` rather than hidden |
| 15 | **Missing FX** | Component **excluded and named** with `no_fx_rate`. Already the Phase 5 behaviour and already tested | None. This is the existing, correct design |
| 16 | **Holiday / weekend** | Carry-back to the previous session, bounded. The session rule means no false staleness | **M9** — unbounded carry-back would be the silent failure. The 10-day backstop is the guard |
| 17 | **Timezone mismatch** | Trading date is defined in the **market's** timezone; the quote instant is the exchange's official close ([§10.2](#102-the-instant-an-eod-close-is-stamped-with)) | The single most likely source of an off-by-one-day error. It is why §10.2 exists |
| 18 | **Duplicate observation** | `PK (instrument_id, as_of)` makes a same-day refetch idempotent; the age-guarded upsert makes a late response harmless | **M7** must be fixed, or a late response overwrites a newer quote |
| 19 | **Conflicting provider observations** | Cannot arise: one provider per series, pinned (ADR-30). FX may have multiple sources, with `source` recorded per row | **M6** must be fixed, or rule 2 of the resolution order silently blends two series |
| 20 | **Historical as-of valuation** | `Σ quantityHeldOn(ratio-aware) × priceOn(bounded) × fxOn`, fed to the **existing** `valuePortfolio()` | The ratio product is mandatory ([§5.1](#51-quantityheldon--the-corporate-action-trap)). A running sum is silently wrong after every corporate action — the one place Phase 5's money-based immunity does not carry over |

**Where this design could still produce an incorrect number**, stated plainly:

1. **An unrecorded corporate action**, if ADR-29's suppression is not implemented. Highest severity.
2. **Foreign holdings vanishing from net worth**, if M1's base-pair normalisation is not implemented —
   a *silent omission*, which is worse than a wrong number because nothing is displayed at all.
3. **An off-by-one trading date** from timezone handling, which would misalign a TWR boundary and
   shift a sub-period return.
4. **An unbounded carry-back** valuing a dropped instrument at a years-old price.
5. **Blended provider series**, if the provider pin is not enforced — a discontinuity indistinguishable
   from a real price move.

All five have a stated correction above, and all five are testable before a provider is connected.

---

## 25. Open decisions

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| **OD-3** (existing) | The equity/ETF market-data provider and its terms | **Twelve Data Grow, $29/mo**, for coverage consolidation (India EOD + international + FX + crypto, one credential, storage-for-internal-use permitted). **Kite Connect at ₹500/mo** is a legitimate cheaper alternative if a Zerodha account exists and international coverage is not needed — but its daily-expiring login is hostile to an unattended refresh job. **Not a decision this review should take**: it is a cost and account question, not an engineering one | Step **6.9** only — not the phase |
| **OD-10** (new) | Apply this review's M1–M13, the four ADRs and I-33…I-40 to the canonical documents | **Recommend approval**, following the OD-4 and OD-9 precedent. Documentation-only; no source file, schema or test changes | Step **6.0**, and therefore the phase |
| **OD-11** (new) | Crypto — adapter or manual? | **Manual unless crypto is held.** CoinGecko's free tier is adequate and keyless if it is | Nothing |
| **OD-12** (new) | Physical gold — a bullion price feed, or a manual asset? | **Manual asset with a valuation series** (Phase 5 already supports this exactly). Avoids a licence question and a purity/unit-conversion problem for one row. Gold ETFs and gold MFs price through the normal adapters | Nothing |
| **OD-13** (new) | AMFI reuse terms | **Flag, do not guess.** AMFI publishes `NAVAll.txt` publicly and the whole Indian fintech industry consumes it, but no machine-readable licence or explicit reuse grant was found. Personal, non-redistributing use of published NAV data is the intended shape and the risk is low — but this review will not assert a licence it could not read. Confirm with AMFI before any non-personal use | Nothing for personal use; would block redistribution |

---

## 26. Completion gate for this review

| Requirement | Status |
|---|---|
| Actual data requirements defined | ✅ [§3](#3-actual-data-requirements) — three asset classes need a feed; six do not |
| Provider candidates evaluated | ✅ [§13](#13-provider-evaluation) — 10 evaluated, 2 excluded on licence grounds |
| Current provider capabilities verified | ✅ Official sources, accessed 2026-08-17/18; unverifiable claims marked **UNVERIFIED** |
| Licensing considerations identified | ✅ [§13](#13-provider-evaluation), [§18](#18-data-persistence), OD-13 — incl. the two exclusions and the AMFI open question |
| Cost understood | ✅ [§19](#19-cost-model) — ₹0 MVP; ₹6k–₹33k/yr with OD-3; volume is free at any tier |
| Provider strategy selected | ✅ [§14](#14-provider-strategy) — three adapters plus Manual, each the only good source for its domain |
| Fallback strategy defined | ✅ [§15](#15-fallback-strategy) — no cross-provider price fallback; Manual is the floor |
| Normalised data model defined | ✅ [§8](#8-normalised-data-model) |
| Persistence strategy defined | ✅ [§18](#18-data-persistence) — five categories persisted, four deliberately not |
| Refresh strategy defined | ✅ [§17](#17-refresh-strategy) — four MVP jobs |
| Staleness behaviour defined | ✅ [§11](#11-staleness) — session-based, ADR-28 |
| Missing-data behaviour defined | ✅ [§12](#12-missing-data-behaviour) — ten conditions, four new reasons |
| TWR dependency defined | ✅ [§4](#4-the-twr-dependency-precisely) — five conditions; `twr.ts` unchanged |
| Market-value net worth dependency defined | ✅ [§6](#6-market-value-net-worth--the-exact-dependency) — nine requirements |
| Implementation sequence explicit | ✅ [§20.J](#j-implementation-sequence) — twelve steps; OD-3 is step nine |
| No unresolved contradiction remains | ✅ Thirteen were found and each has a stated correction ([§21](#21-defects-found-in-the-baseline-m1m13)) |
| **Implementation started** | ❌ **No.** No package installed, no adapter, no schema, no migration, no source file changed |
