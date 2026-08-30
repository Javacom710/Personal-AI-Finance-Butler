# Testing Strategy

The bar: **a feature is not done until the calculation behind it is tested, including its edge cases.** Coverage percentage is not the target; coverage of the financial engine's edge cases is.

## 1. Layers

| Layer | Tool | Scope | Speed | Run |
|---|---|---|---|---|
| Unit | Vitest | Pure functions: `Money`, lot engine, XIRR, TWR, recurrence expansion, allocation, invariants | < 5 s total | every save |
| Property | Vitest + fast-check | Algebraic laws over money and lots | < 30 s | every commit |
| Integration | Vitest + real Postgres | Application services against a live schema: transaction boundaries, authorization guards, constraints, triggers, rebuilds | < 60 s | every commit |
| Golden scenario | Vitest + real Postgres | Full multi-year fixtures with hand-verified expected outputs | < 60 s | every commit |
| Contract | Vitest + recorded fixtures | Market-data adapters against captured provider responses | < 10 s | every commit |
| AI | Vitest, no network | Tool schemas, capability gating, fallback classes, loop policy, proposal validation, injection cases | < 10 s | every commit |
| Model eval | Live provider | Model quality per tier â€” **manual, never in CI** (Â§7a) | minutes | Phase 8, quarterly |
| E2E | Playwright | The handful of flows a broken build must not ship | < 3 min | pre-deploy |

Integration tests require a Postgres instance. `testcontainers` was the original preference (decision **D-4**), but Docker was never installed, so they run against a dedicated `financeos_test` database on the local **PostgreSQL 18.4 service** (**D-23**), truncated between test files. The database is always available â€” it starts with Windows â€” so no test setup starts or waits for it.

## 2. Priority order

If time is short, tests are written in this order. This ordering is the point of the document.

1. `Money` arithmetic and rounding
2. Lot engine (FIFO, splits, bonuses, oversell)
3. Transaction invariants and transfer handling
4. Account balance
5. Net worth and change attribution (including `unexplained = 0`)
6. XIRR / TWR
7. Recurrence expansion and idempotent posting
8. Budget status
9. AI proposal validation
10. UI

## 3. Unit tests â€” the engine

### `Money`

Table-driven, covering:
- Construction from `NUMERIC(20,4)` strings including trailing zeros, negative values, and the scale boundary.
- `add`/`sub` associativity and commutativity; `sum([])` returns zero rather than throwing.
- Cross-currency `add` throws (a programming error, deliberately not a `Result`).
- Every rounding mode at the `.00005` boundary and at negative values (`half_up` on `-0.5` must be documented and tested, not assumed).
- `allocate` â€” parts sum back exactly for every split of 1 to 12 ways over amounts that do not divide evenly.
- `toMinorNumber` throws above `Number.MAX_SAFE_INTEGER`.
- `NUMERIC(20,4)` upper bound: no overflow, no silent truncation.

### `UnitPrice`

- A NAV of `123.45678900` round-trips through `UnitPrice` without loss. **The same value through `Money` is asserted to lose precision** â€” proving the test detects the truncation rather than passing vacuously.
- `valueOf(quantity, price)` at the `.5` boundary in both signs; `perUnit` throws on a zero quantity.
- `mulQtyRatio(m, num, den)` â€” the property that matters: consuming a lot in any sequence of partial slices, with the final slice taking the remainder verbatim, sums back to the original exactly.
- `NUMERIC(20,8)` boundary, same as `Money`.

### Property tests (fast-check)

```
âˆ€ a, b, c : Money(same currency)
  add(add(a,b),c) === add(a,add(b,c))
  add(a,b) === add(b,a)
  sub(a,a) is zero
  neg(neg(a)) === a

âˆ€ m : Money, parts : positive weights
  sum(allocate(m, parts)) === m

âˆ€ m : Money, s : string
  fromDbString(toDbString(m)) === m

âˆ€ txns : valid investment transaction sequence
  Î£ tax_lots.remaining_quantity === positions.quantity
  Î£ tax_lots.remaining_cost === positions.cost_basis            -- EXACT, no tolerance (I-6)
  Î£ cost_consumed + remaining_cost === cost_total   per lot     -- I-20, holds after any
                                                                -- sequence of buys, sells,
                                                                -- splits and bonuses
  replay(txns) === replay(txns)                     -- determinism
  replay(txns) === rebuildIncrementally(txns)       -- incremental === full
  replay(shuffleWithinTradeDate(txns)) === replay(txns)   -- entry order is not an input

âˆ€ ledger, âˆ€ T                                       -- net worth (Phase 5)
  netWorth(T) is independent of the order rows were entered
  assets(T) âˆ’ liabilities(T) === Î£ contributionsMap(T)          -- I-22, EXACT
  investmentCostBasisAsOf(T) === boundedReplay(ledger, T).cost  -- the prefix property
âˆ€ buy   : netWorth(T) unchanged for every T â‰¥ trade_date        -- I-25
âˆ€ sell  : Î”netWorth === realised P&L, exactly                   -- I-25
âˆ€ split, âˆ€ bonus : Î”netWorth === 0, exactly                     -- money is ratio-invariant
```

The last three are the properties that catch the classes of bug where a rebuild produces a different answer than the incremental path, and where the answer depends on the order rows happened to be entered.

`Î£ remaining_cost === cost_basis` is asserted **exactly**. The former `Â± 1 minor unit per lot` tolerance was a consequence of storing `cost_per_unit` and multiplying it on read; lots now store money exactly and derive the rate, so there is nothing to drift ([INVESTMENT-DOMAIN.md Â§4](INVESTMENT-DOMAIN.md#rounding-in-the-engine)). A property test with a tolerance would pass against an engine that leaks a paisa per disposal.

**Not asserted, deliberately:** `Î£ lot_disposals.quantity + remaining_quantity === original_quantity`. It is false after a corporate action touches a partially disposed lot â€” see the non-invariants table in [SCHEMA.md Â§12](SCHEMA.md#12-invariants-summary).

### Lot engine

Every case listed in [INVESTMENT-DOMAIN.md Â§12](INVESTMENT-DOMAIN.md#12-edge-cases-that-must-be-covered-by-tests) is a named test. Each is a plain array of transactions in, expected lots/disposals/position out â€” no database, no mocks.

Hand-verified reference cases (computed independently in a spreadsheet, checked into `tests/golden/`):
- **L0 â€” the average-cost drift case (minimal, run first).** Buy 100 @ â‚¹100, buy 100 @ â‚¹150 â†’ quantity 200, `cost_basis` â‚¹25,000, derived average â‚¹125. Then sell 100 @ â‚¹200 â†’ FIFO closes the â‚¹100 lot entirely, realised P&L â‚¹10,000, remaining `cost_basis` â‚¹15,000, **derived average jumps to â‚¹150 with nothing purchased**. Asserts that average cost is computed from surviving lots, never carried forward. A stored average would report â‚¹125 and a realised P&L of â‚¹7,500 â€” wrong by â‚¹2,500 on a taxable gain.
- 3 buys at â‚¹100/â‚¹150/â‚¹200, sell 150 units of 300 â€” FIFO realised P&L to the paisa, and `Î£ realized_pnl = netProceeds âˆ’ Î£ cost_consumed` **exactly** across the three lots.
- Buy, 1:5 split, sell â€” realised P&L must be identical to the no-split equivalent at the adjusted price, and `Î£ cost_total` byte-identical before and after the split.
- Buy, 1:1 bonus, sell half â€” derived average cost halves, basis unchanged, realised P&L exact.
- Buy in USD with an FX move, sell â€” base-currency P&L splits correctly into price and FX components, and the two sum back to `base_realized_pnl` exactly (I-18).
- **L1 â€” the fee double-count case.** The worked fixture in [INVESTMENT-DOMAIN.md Â§6.3](INVESTMENT-DOMAIN.md#63-worked-verification-that-nothing-is-counted-twice): buy 100 @ â‚¹100 + â‚¹50 fee, â‚¹500 dividend with â‚¹50 TDS, sell 40 @ â‚¹150 + â‚¹30 fee, remainder at â‚¹160. Asserts `totalReturn = â‚¹5,970` by **both** the component sum and the cash cross-check, `totalReturnPct = 59.40%` on `costDeployed`, and `unrealizedReturnPct = 59.20%` on `investedCapital`. Accruing trade fees to `fees_total` as well gives â‚¹5,890; using one denominator for both gives 99.00%.

Every case in [INVESTMENT-DOMAIN.md Â§12](INVESTMENT-DOMAIN.md#12-edge-cases-that-must-be-covered-by-tests) is a named test, including cases **21â€“31** added by the Phase 4 design review â€” each guards a specific defect that the pre-review documents would have produced.

### XIRR / TWR

- Known-answer tests against Excel/LibreOffice `XIRR` for 10 cash-flow series, agreeing to 6 decimal places.
- Convergence: a series with a âˆ’95% return (near the bracket edge) resolves via bisection.
- All `null` paths: fewer than 2 flows, single-sign flows, same-date flows, non-convergence, insufficient price history for TWR. Each asserts `null` **and** the stated reason â€” a test that only asserts `null` would pass if the function always returned `null`.
- **Scope construction**, which is where the series is most easily built wrong ([INVESTMENT-DOMAIN.md Â§7](INVESTMENT-DOMAIN.md#7-xirr)):
  - Brokerage cash is **excluded** from the terminal value; a dividend reinvested the same day contributes `+500` then `âˆ’500` and nets to zero, while an un-reinvested one remains a return.
  - A matched `transfer_out`/`transfer_in` pair is **excluded** at portfolio scope and produces the same XIRR as if the transfer had never happened.
  - The same unmatched leg at **account** and **instrument** scope enters at `gross_amount` â€” asserted against a fixture where treating it as a zero flow yields a divergent or infinite return.
- **TWR boundary convention:** a flow dated `D` belongs to the period *starting* at `D`. A fixture with one flow is asserted against the hand-computed figure under that convention, and against the figure the opposite convention would produce â€” so the choice is pinned, not accidental.

### Recurrence

- Monthly on the 31st across Janâ†’Febâ†’Mar in a leap and a non-leap year.
- `BYMONTHDAY=-1`, `BYDAY=MO` weekly, `INTERVAL=2` fortnightly, `COUNT` and `UNTIL` termination.
- DST boundaries in `Asia/Kolkata` (no DST â€” also tested with a DST timezone to prove the date maths is timezone-correct rather than accidentally correct).

## 4. Integration tests

Against a real Postgres, because half the invariants are database constraints and triggers.

- The `check_transaction_shape()` trigger rejects every invalid shape in the [FINANCIAL-DOMAIN.md Â§12](FINANCIAL-DOMAIN.md#12-edge-cases-that-must-be-covered-by-tests) list.
- `ON DELETE RESTRICT` blocks deleting a category in use, an account with entries, an instrument with transactions.
- `UNIQUE (rule_id, due_on)` â€” the posting job run twice on the same day creates exactly one transaction. Also tested with two concurrent runners.
- A failed write inside an application service rolls back completely (the service owns the transaction boundary): no orphan entries, no bumped `ledger_version`, no audit row.
- `rebuildPosition` is idempotent: running it twice produces identical rows.
- Full rebuild equals incremental rebuild across a 500-transaction fixture.
- **Investment `CHECK` constraints reject at the database, not merely at the service.** Each asserted by a direct `INSERT` that bypasses the service layer: `cash_settled = false` with a non-zero `net_amount` (I-16); `realized_pnl â‰  proceeds âˆ’ cost_consumed` (I-15); a lot with `remaining_quantity = 0` but non-zero `remaining_cost` (I-19); a `split` carrying a quantity or a price; `gross_amount` disagreeing with `|quantity| Ã— price`. A rule enforced only in TypeScript is not enforced against a restore, a script, or `psql`.
- **The three-denomination cash chain (OD-5).** A USD instrument bought, and a USD dividend received, into an **INR** brokerage account: both rows insert successfully; `net_amount_instrument` satisfies its per-kind identity in USD; `net_amount = round(net_amount_instrument Ã— fx_rate_instrument_to_account, 4)` in INR; `base_net_amount` follows from that; and `deriveBalance()` returns rupees throughout. **A regression test asserts the row is not rejected** â€” stating the identity on `net_amount` instead makes every foreign-currency dividend and trade unrecordable, which is a schema-level failure no engine test would catch.
- **Same-currency collapse.** With instrument and account currency equal, `fx_rate_instrument_to_account = 1` and `net_amount_instrument = net_amount` exactly â€” asserted so the common path cannot drift from the general one.
- **A backdated oversell rolls back completely.** Inserting a sell dated before existing purchases such that the position goes short at that instant leaves lots, disposals, positions and `investment_ledger_version` byte-identical to before â€” the rebuild shares the mutation's transaction ([INVESTMENT-DOMAIN.md Â§4](INVESTMENT-DOMAIN.md#rebuild)).
- Job claiming with `FOR UPDATE SKIP LOCKED` under two concurrent runners: each job executes exactly once.
- `verify:integrity` passes on a freshly seeded database and fails on a deliberately corrupted one (a test that asserts the checker actually catches something).

### Net worth (Phase 5)

Each case guards a defect the pre-review rules would have produced. The full list is [FINANCIAL-DOMAIN.md Â§12](FINANCIAL-DOMAIN.md#12-edge-cases-that-must-be-covered-by-tests) cases 14â€“16 and 29â€“40; the ones that need a real database:

- **The eligibility table, row by row** ([FINANCIAL-DOMAIN.md Â§9.3](FINANCIAL-DOMAIN.md#93-calculation)): an account, a lot, a manual asset and a liability each crossing `asOf`, asserted the day before, the day of, and the day after their own boundary date.
- **Account created after `asOf`** contributes **nothing â€” including its opening balance** (case 31). Named for the defect, because the date bound covers movements and an opening position is not a movement.
- **An overpaid credit card at `+â‚¹5,000` contributes a `+â‚¹5,000` asset** (case 29) â€” asserted against both wrong answers: zero, and a â‚¹5,000 liability.
- **`is_active` is read by no calculation** (**I-26**) â€” a **source scan** over `src/server/domain/networth/**` and the net-worth read path, in the same style as the model-identifier scan in Â§7. A rule that depends on every future reader remembering it is not a rule.
- **A `transfer_in` carrying an `acquired_on` two years before its `opened_on`** contributes to neither account before `opened_on` (**I-23**).
- **`investmentCostBasisAsOf(today)` equals `Î£ positions.base_cost_basis`** exactly (**I-24**) â€” the as-of derivation and the Phase 4 cache cannot drift apart unnoticed.
- **`verify:integrity` fails on a deliberately corrupted database**: a liability linked to a `bank` account (**I-27**), a scheduled liability closed with no terminal zero row (**I-28**), a duplicated source key (**I-21**).
- **User isolation** â€” a second user's accounts, assets, liabilities and lots are invisible to every net-worth query (**I-32**).
- **`networth.ts` exports no function taking a `WriteCtx`** â€” a `tsc`-based test, the same mechanism as the AI write-unreachability test in Â§7.

## 5. Golden scenarios

Multi-year fixtures with every figure verified by hand once and then frozen. These are the regression net for the whole engine.

| Scenario | Exercises |
|---|---|
| **G1 â€” Salaried year** | 12 monthly salaries, ~200 expenses, 2 transfers, 3 budgets. Asserts: monthly and annual income/expense/savings/savings rate, budget utilisation, account balances, and the **Net Worth at Cost** series. |
| **G2 â€” Equity investor** | 20 buys, 8 partial sells, 2 splits, 1 bonus, 6 dividends, brokerage fees. Asserts: FIFO realised P&L, holdings, allocation, XIRR, TWR. Also asserts `Î£ cost_total` is unchanged by both splits and the bonus, that trade fees appear in **no** `fees_total`, and that a split sharing a `trade_date` with a buy gives the same result under both insertion orders. |
| **G3 â€” Mixed portfolio** | Equity + mutual funds + gold + a USD ETF + a fixed deposit. Asserts: multi-currency valuation, per-class allocation, FX component in attribution summing back to `base_realized_pnl` exactly, and that the USD ETF bought from an INR brokerage account leaves the account balance in rupees throughout (OD-5). |
| **G4 â€” Debt and liabilities** | Home loan with EMIs, a credit card carrying a balance, a car loan closed mid-period. Asserts: liability totals, no double counting (**I-8**), the terminal zero balance row the closed loan requires (**I-28**), attribution split into principal and interest **only where the user recorded both**, and an **overpaid credit card counted as an asset** (**I-31**). The Phase 5 gate. |
| **G5 â€” Sparse data** | âœ… Two unpriced holdings, a manual asset held but unvalued, a USD manual asset with no FX rate, and a stale price. Asserts: value-weighted investment coverage against component-count coverage, correct `null` propagation, nothing silently zeroed, the stale price used *and* flagged, and the restatement closing at exactly `0.0000`. `tests/integration/golden-g5.test.ts` |
| **G6 â€” Market value with a foreign holding** | âœ… A USD ETF bought at â‚¹75 to the dollar and valued at â‚¹83, beside an INR equity. Asserts the FX rebasis and the price effect separately, and pins the release-note fact at a date where the price has **not** moved: the entire difference is currency. `tests/integration/golden-g6.test.ts` |
| **G7 â€” Corrections** | A transaction edited, one deleted, an investment transaction back-dated before existing ones. Asserts: derived state rebuilt correctly, historical figures recomputed, audit trail complete. **Not yet built.** |

> **G6 was renumbered.** This table previously named G6 *"Corrections"*, while Â§6.7 and
> [MARKET-VALUE-NET-WORTH-DESIGN.md Â§21](MARKET-VALUE-NET-WORTH-DESIGN.md#21-implementation-gates)
> both named it the market-value foreign-holding scenario. Phase 6.11 gates on the latter, so the
> market-value scenario is **G6** and corrections becomes **G7**. Recorded rather than silently
> resolved, because a scenario number appearing in two places with two meanings is how a frozen
> expectation stops being frozen.

**Every golden scenario asserts `unexplained` in the net-worth bridge.** For **single-currency** data it is asserted **exactly zero** â€” every FX term is identically zero there, so a tolerance would only hide a real residual, and *an invariant with a tolerance is not an invariant*. The one-base-unit tolerance applies to multi-currency scenarios only (**I-30**). This single assertion catches most engine regressions, because almost any calculation error shows up as an unexplained residual.

The bridge's `FX effect` is **computed** â€” opening-balance revaluation plus per-flow rate movement â€” never defined as the residual. Defining it as the plug would make `unexplained` trivially zero and destroy the assertion. A test asserts the bridge over a **multi-currency** fixture where a plugged FX line and a computed one give different answers.

**G1 and G4 were the Phase 5 gate; G5 and G6 are the Phase 6.11 gate**, and both extend the
`basis: 'cost'` behaviour Phase 5 asserts rather than replacing it â€” G4 still closes at exactly
`0.0000`. G2 passes at cost. **G3 remains open**: it needs a multi-currency *portfolio* fixture
rather than a net-worth one, and no Phase 6.11 gate depends on it.

Golden expected values live in `tests/golden/*.expected.json`. Changing one requires a PR comment explaining why the previously verified number was wrong.

## 6. Market-data contract tests

- Real provider responses captured once into `tests/fixtures/market-data/` and replayed through an injected fetch. **No network in CI**, and no adapter reads `process.env` or a live clock during a test.
- Every adapter is tested for: normal response, empty response, malformed JSON, HTTP 500, HTTP 429, timeout, and an unknown symbol. **All seven must produce a `ProviderFailure`, never a thrown exception** â€” and the registry must map each onto a `PriceResult`, so the seven survive end to end.
- **Adapters return observations, never a freshness verdict** ([ADR-27](DECISIONS.md#adr-27--market-data-adapters-return-observations-the-registry-classifies-freshness)). Asserted by a **source scan**: no file under `providers/**` may reference `'stale'`, `'cached'` or `'live'`. A rule that depends on every future adapter author remembering it is not a rule.
- Registry resolution order: explicit provider â†’ first supporting *and capable* provider â†’ manual. Plus **capability refusal**: a request an adapter's `ProviderCapabilities` do not cover is refused rather than attempted.
- **A read makes no network call.** Asserted by running the portfolio and net-worth read paths with a fetch that throws if invoked.
- A separate, opt-in `test:live-providers` script hits real endpoints and is run manually before changing a provider â€” never in CI.

### 6.1 Freshness ([ADR-28](DECISIONS.md#adr-28--staleness-is-measured-in-trading-sessions-not-wall-clock-hours))

One classifier, so one test file covers every provider.

- **Trading day:** an observation from the latest known session â†’ `current`.
- **Weekend:** Friday's close read Monday 09:00 IST, Friday still the latest session â†’ **`current`**, not `stale`. This is the regression the wall-clock rule failed, every week.
- **Holiday:** a multi-day exchange closure does not advance the session count.
- **Sessions:** 1â€“2 behind â†’ `recent`; 3+ â†’ `stale`.
- **Backstop:** > 10 calendar days â†’ `stale` regardless of session count, which is what catches a provider that quietly stopped.
- **Continuous cadence:** still hours â€” â‰¤ 6 h `current`, â‰¤ 24 h `recent`, beyond `stale`.
- **Bootstrap:** one instrument on an exchange is its own reference and reports `current`, never a false alarm.
- **Future-dated:** reported at age zero, not "fresher than fresh" â€” a clock problem, still the best price available.

### 6.2 FX ([FINANCIAL-DOMAIN.md Â§2](FINANCIAL-DOMAIN.md#2-fx))

- **Direct**, **inverse**, **triangulated** and **no route**, each asserting the `source` label.
- **A direct pair wins over a more recent inverse or triangulated route.**
- **A triangulated rate is dated by its stalest leg**, and a leg dated after `on` disqualifies the route.
- **One pivot only** â€” a route needing two hops is `no_rate`.
- Historical / as-of selection: exact date, else most recent earlier, **never** later.
- Stale rate: used, and marked.
- Provider failure: the stored series is unchanged and no fabricated rate appears.

### 6.3 AMFI

- Valid NAV line â†’ one observation with the right scheme code, ISIN, NAV date and `INR`.
- Missing scheme, blank NAV, `N.A.` NAV â†’ skipped, not zero.
- Malformed line, header/section lines, CRLF and a truncated file â†’ no throw, no partial write.
- Date parsing across `DD-MMM-YYYY`, including a leap day.
- Instrument mapping by **ISIN first**, then scheme code.

### 6.4 Corporate-action safety ([ADR-29](DECISIONS.md#adr-29--provider-corporate-actions-are-detections-never-ledger-writes))

- Split detected â†’ a `corporate_action_detections` row and **no** `investment_transactions` row; `investment_ledger_version` unchanged.
- An open detection inside the holding period â†’ that instrument's price is `missing: 'unreconciled_corporate_action'`, `marketValue` is `null`, and **no quantity or price is adjusted**.
- Accepting a detection through the service path creates the ledger row and stamps `resolved_txn_id`; a source scan asserts nothing under `market-data/**` or `jobs/**` writes that column (**I-40**).
- Re-detecting the same action ten times leaves one row.

### 6.5 Historical observations

- **Duplicate observation** â€” same `(instrument_id, as_of)` twice is idempotent, not a second row.
- **Deterministic retrieval** â€” the same range query returns the same series, ordered.
- **Date boundaries** â€” `from` and `to` inclusive; a range with no rows is empty, not an error.
- **As-of selection** â€” greatest `as_of <= d`, **bounded**; beyond the bound a gap, never a carried-forward value.
- **Age-guarded quote write** (**I-36**) â€” an older observation never overwrites a newer stored quote, and a provider price never replaces a manual price of the same `as_of`.
- **One source per series** (**I-35**) â€” an observation whose `source` differs from the existing series is refused, not interleaved.

### 6.6 Security

- No provider credential appears in any client bundle (`check:no-client-secrets`), in a log line, or in a test fixture.
- The AMFI and Frankfurter adapters require **no** credential at all, asserted by their `capabilities.requiresCredential === false`.
- **A malformed provider response cannot corrupt financial state:** after a fixture of hostile responses â€” 11-decimal prices, negative closes, wrong currency, absurd dates, injected SQL-looking strings â€” the ledger, lots, positions and `instrument_prices` are byte-identical to before.

## 6.7 Market-value net worth (Phase 6.11)

The cost path is already covered by the Phase 5 suite and **must not regress**: golden **G4** keeps
closing at exactly `0.0000`, and every existing net-worth assertion is a cost-basis assertion.

- **The default is `cost`** ([ADR-32](DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view)).
  Asserted directly: `netWorthAsOf(ctx, {})` returns `basis: 'cost'`, and its figure is byte-identical
  to the Phase 5 result on the same fixture. A default that drifted would restate history silently.
- **`quantityHeldOn` â€” a property test**, not an example test (**I-46**). Across split, bonus and
  reverse split, in any order, with a disposal before and after each: the ratio product must equal a
  bounded `replay()`. This is the one genuinely new algorithm in the phase and the one place a plain
  `Î£ quantity` looks right and is wrong.
- **Cost and market never mix** (**I-41**, **I-43**). Emitting both components for one position must
  **throw** `DuplicateContribution` â€” asserted as a throw, because that is the guarantee.
- **Priced or excluded, never cost-substituted** (**I-38**, **I-39**). A fixture with one unpriced
  holding: the total omits it, `excluded[]` names it with a reason, and the total is **not** the
  cost-substituted figure.
- **Partial and unavailable states**: `complete` with everything priced; `partial` with one holding
  unpriced and its cost reported; `unavailable` when positions exist and none can be priced â€” the
  headline withheld, the cost figure offered.
- **Coverage is value-weighted for price exclusions** and component-count for FX and unvalued assets
  (D-29). Asserted with a large unpriced holding among small priced ones, where the two measures give
  visibly different answers.
- **Stale contributes and is flagged** (**I-44**); a stale price is never swapped for cost.
- **Suppression** (ADR-29): an unrecorded split excludes the position; the phantom figure never appears.
- **Historical correctness** (**I-47**): a source scan asserting no market path reads `positions` or
  `is_active`; plus an as-of fixture where today's cache and the historical answer differ.
- **The restatement closes exactly** for single-currency data (**I-48**), with the removed-unpriced,
  FX-rebasis and price-effect terms each computed â€” none a residual.
- **Precision end to end** (**I-49**): `1629.80004883` from the provider survives to the position's
  market value with rounding only at `valueOf` and `mulRate`.
- **Golden G5** â€” partial coverage. **Golden G6** â€” market value with a foreign holding, exercising
  the FX rebasis.

**Built 2026-08-27**, in `tests/unit/networth-market-domain.test.ts` (46),
`tests/property/quantity-held-on.test.ts` (9), `tests/integration/networth-market.test.ts` (41),
the two golden suites (23) and the extended `tests/unit/networth-source-scan.test.ts` (10 new).

Two notes where the suite differs from the sketch above:

- **The exclusion-reason test covers ten reasons, not nine.** Implementation found a tenth case â€”
  no observation on or before `T` within the carry-back bound, which is a gap in the point rather
  than a fault in the feed. See
  [MARKET-VALUE-NET-WORTH-DESIGN.md Â§24.2](MARKET-VALUE-NET-WORTH-DESIGN.md#24-what-implementation-found).
- **`quantityHeldOn`'s property test compares against a bounded `replay()`**, which is what this
  section asks for â€” but the implementation *derives* the timeline from `replay()` rather than
  re-deriving it as a cumulative ratio product. The two forms disagree by units of 10â»â¸ on a
  reverse split that does not divide evenly, and the per-lot answer is the one `positions.quantity`
  carries. The ratio-product form is kept in the suite only as the wrong answer it proves wrong.

## 7. AI tests â€” all offline

**No test in CI calls NVIDIA Build.** The model is not the system under test; our handling of it is. Model quality is measured separately by the evaluation harness (Â§7a), which is online, manual, and never gates a merge.

- **Schema generation:** every tool's `z.toJSONSchema()` output has `additionalProperties: false` and a complete `required` array.
- **Tool handlers:** each tested directly, including the row cap, the `truncated` flag, and the projected field set. A test asserts no handler's output contains a field outside its declared contract â€” the data-minimisation guarantee.
- **Authorisation:** a test asserts that no tool input schema contains a user-identifier field. If someone adds one, this fails.
- **Model-identifier leakage:** a source scan asserts no model id string appears outside `src/server/ai/config/`, and that no file under `prompts/`, `loop.ts`, `tools/`, or `structured/` branches on a model identity. This is what keeps "swap a model = one env line" true over time (AI-SYSTEM.md Â§17).
- **Routing:** a labelled corpus asserts the tier for each message shape. Explicitly includes the **sticky-escalation trap** â€” a Tier-2 question followed by "what's my HDFC balance?" must route back to Tier 1, not inherit Tier 2. Also asserts Tier 3 is unreachable without an explicit user action, and that `runFinancialScenario` stays at Tier 2.
- **Write-unreachability â€” three mechanisms, built and asserted 2026-08-30, before any AI code exists** ([ADR-33](DECISIONS.md#adr-33--the-transaction-opener-is-a-capability-carried-on-the-context-not-an-ambient-import), [ADR-34](DECISIONS.md#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths)). Two are not enough, and the Phase 7 review showed why: each closes a hole the others cannot see.
  - **Types (I-50)** â€” `tests/unit/ai-write-boundary.test.ts` type-checks probe sources against the project's own `tsconfig.json` and asserts the diagnostic codes. `withWriteCtx(ai, â€¦)` â†’ TS2345; `ai.db` â†’ TS2339; `listAccounts(ai)` and `deleteTransaction(ai, â€¦)` â†’ TS2345. It also asserts the **negative**: a `RequestCtx` *can* still open a write, so a boundary that broke the application would fail here rather than mysteriously elsewhere. A runtime test expecting a throw would assert the weaker property while the compile-time one rotted.
  - **ESLint AI zone (I-51)** â€” aliased *and* relative import patterns, plus `drizzle-orm` and `pg` outright. Relative coverage is the point: `no-restricted-imports` matches the raw specifier string with gitignore semantics, so `'../../db/client'` was accepted by every earlier form of the rule, including `**/server/db/*`, which requires a literal `server` segment the specifier lacks.
  - **Source scan (I-51, I-52)** â€” `tests/unit/ai-boundary-source-scan.test.ts` covers what ESLint structurally cannot: **dynamic `import()` and `require()`**, which that rule never checks in any zone, plus `ctx.db` DML and any mention of a write-boundary symbol. It also asserts `eslint.config.mjs` still carries the relative patterns, which is the assertion most likely to be silently reverted, and that `AiReadCtx` declares no `db`/`fx`/`beginTransaction` while the bridge stays a module-private `WeakMap`.
  - **Non-vacuity:** `src/server/ai/**` does not exist until step 7.1. The scan therefore asserts a corpus of synthetic violations, the ESLint config, and the capability shape â€” all of which hold today â€” and activates its directory checks from the first file placed there. A scan over an empty set passing silently is the failure mode this whole section exists to avoid.
- **Exact-value projection (I-53):** `tests/unit/json-projection.test.ts` â€” property tests over generated values past `MAX_SAFE_INTEGER` assert every projection agrees with `toDbString` and round-trips through `fromDbString`, that no figure is ever a JSON number, that a price and a quantity of identical digits stay distinguishable, and that a missing figure projects to `null` and never to zero ([ADR-36](DECISIONS.md#adr-36--exact-values-cross-a-json-boundary-as-a-tagged-string-projection-never-as-a-json-number)).
- **Provider (I-55):** `tests/unit/ai-provider.test.ts` — injected `fetch`, so no test touches the network. Every failure mode is asserted to return a *classified* result rather than throw: unconfigured (and **no call made**), 401/403, 429 with `Retry-After`, 5xx, socket error, abort, non-JSON body, empty choices. Two credential assertions: the key appears only in the auth header, and never in an error even when the provider echoes it back.
- **Routing and gates (I-56):** `tests/unit/ai-routing.test.ts` — the capability gate in **both** directions (an incapable model is unreachable; a capable one is reachable, so the filter is not simply excluding everything), refusal of a declared entry for a score-gated route, **cross-tier downgrade impossible** with a capable Tier 1 model deliberately present and not offered, Tier 3 unreachable by escalation, breaker open/half-open/close, attempt ceiling, fail-closed short-circuit.
- **Tools and structured output (I-57):** `tests/unit/ai-tools.test.ts` — no tool input accepts a user identifier, swept across the whole registry; `additionalProperties: false` on every schema; unknown tool, non-JSON arguments, invented argument and malformed date all rejected before a handler runs; a handler that throws becomes a readable tool failure rather than ending the turn. Structured output across eight malformed shapes, with exactly one repair then rejection.
- **Kill switch, rate limit and isolation (I-58):** `tests/integration/ai-infrastructure.test.ts` — `ai_enabled = false` produces zero egress and is recorded as a refusal; failing closed with no settings row; other features still work while disabled; per-user rate limiting; **user isolation swept across every tool** against two users' real data, including every spelling of a `userId` argument a model might invent; figures projected as tagged strings, breakdown `additivity` carried, and a domain error stripped of the entity id that for a settings error *is* the user id.
- **The deterministic suite never calls NVIDIA.** `npm run ai:smoke` is opt-in, network-using and never in CI — the same shape as `smoke:market-data`. With no key it exits 0 and prints local configuration instructions.
- **Breakdown additivity (I-54):** `tests/unit/breakdown-contract.test.ts` â€” property tests over generated two-level trees assert `Î£ folded === Î£ direct` exactly, that every input id lands in exactly one row, and that no emitted row is a descendant of another. `tests/integration/golden-g1.test.ts` asserts the partition at **both** depths against the golden figures. A consumer cannot read a complete breakdown as an additive flat list, because a non-partitioning row set declares itself ([ADR-37](DECISIONS.md#adr-37--a-breakdown-declares-whether-its-rows-partition-its-total)).
- **Double-confirm:** applying the same proposal twice concurrently produces exactly one transaction. Asserted against a real Postgres with two parallel calls â€” the compare-and-swap must lose one, and the partial unique index must catch it even with the CAS stubbed out.
- **Expired proposal:** confirming after `expires_at` writes nothing and returns a typed error.
- **Capability gating** (the highest-value new tests, because they enforce [ADR-18](DECISIONS.md#adr-18--a-measured-capability-matrix-gates-routing-and-fallback)):
  - A model with `structuredOutput: 'none'` is never selected for a proposal task.
  - A model with `toolCalling: 'none'` is never selected for a tool-using task.
  - A text-only model is never selected for a vision task.
  - **Cross-tier downgrade is impossible:** with every Tier 2 candidate failing, the request errors with `all_candidates_exhausted` â€” it does not return a Tier 1 answer.
  - A model absent from `capabilities.json`, or with a stale entry, is excluded from routing.
  - Tier 3 is unreachable without an explicit user action.
- **Fallback behaviour** against recorded provider responses: each failure class (`unavailable`, `rate_limited`, `timeout`, `invalid_schema`, `tool_call_failed`, `content_filter`, `transport`) routes as specified; `content_filter` is **not** retried on another model; the circuit breaker opens after 3 consecutive failures and half-opens after the cool-down; `ai_model_attempts` records every attempt with its class.
- **Loop policy:** tool-use iteration, the 8-iteration cap, the 150 KB byte budget, the daily budget check firing **before** the request, every `tool_call_id` being answered, and error results being returned rather than dropped.
- **Structured-output strategies:** `json_schema`, `json_object`, and prompted-JSON paths each tested; exactly **one** repair attempt is made; a second failure rejects rather than retrying forever.
- **Proposal validation:** a corpus of ~40 model outputs â€” good, malformed, ambiguous, adversarial â€” each with an expected outcome. Includes: amount as a JSON number instead of a string, negative amount for income, category-kind mismatch, non-existent account name, date before the account opened, amount with 6 decimal places.
- **Injection corpus:** transaction descriptions and notes containing instruction-shaped text. Assertion: no write occurs, no unexpected tool call is made, no tier escalation happens, and the loop completes normally.
- **Prompt size budget:** the rendered system prompt plus tool schemas is asserted under a token ceiling. Because NVIDIA Build has no prompt caching, prompt size is a linear per-request cost â€” this test replaces the cache-hit test that a caching provider would have needed, and guards the same property (nobody silently grows the prefix).

### 7a. Model evaluation harness â€” online, manual, not CI

Phase 8. `npm run ai:eval` calls the live provider and is **never** part of the merge pipeline: it costs money, it is slow, and model output is not deterministic.

- Deterministic scoring wherever a right answer exists: schema valid, field-exact match, correct tool, correct arguments, stated figure equals engine figure.
- LLM-as-judge is used only for prose quality, is advisory, and never scores a numeric claim.
- Output is written to `capabilities.json` and `ai_model_evaluations`.
- **CI does check one thing:** that every production-routed model has a `capabilities.json` entry no older than 30 days and measured against the current eval version. That is a freshness assertion over stored results, not a live call.

## 8. E2E tests

Deliberately few. Playwright, against a seeded database.

1. Login â†’ TOTP â†’ dashboard renders with correct figures.
2. Create an expense via quick-add (structured path) â†’ appears in the list â†’ account balance updated.
3. Create a transfer â†’ appears in both accounts â†’ does **not** appear in income or expense totals. *(This is the highest-value E2E test in the suite.)*
4. Record a buy â†’ holding appears with correct average cost â†’ record a sell â†’ realised P&L correct.
5. AI proposal (mocked model response) â†’ card renders â†’ confirm â†’ transaction created with `source='ai'` and an audit entry with `actor='ai_confirmed'`.
6. Export data â†’ archive downloads and parses.
7. Unauthenticated access to every app route redirects to login.

## 9. Definition of done for a financial calculation

A calculation ships only when all of the following hold:

- [ ] Implemented as a pure function where possible
- [ ] Unit tests for the happy path
- [ ] Unit tests for every edge case in the relevant `Edge cases` list
- [ ] Zero, negative, and empty-input cases explicitly tested
- [ ] `null`/unavailable paths tested with their stated reason, not just `null`
- [ ] Rounding behaviour tested at the `.5` boundary in both signs
- [ ] Reference case verified independently (spreadsheet or published formula) and checked in
- [ ] Covered by at least one golden scenario
- [ ] Type checking passes
- [ ] Lint passes
- [ ] Production build passes

## 10. CI pipeline

```
npm ci
npm run typecheck          # tsc --noEmit, strict
npm run lint               # eslint, incl. import-boundary and no-NEXT_PUBLIC-secret rules
npm run test:unit
npm run test:property
npm run test:integration   # spins up Postgres
npm run test:golden
npm run test:ai
npm run build              # next build must succeed
npm audit --audit-level=high
npm run test:e2e           # pre-deploy only
```

Any failure blocks the merge. There is no `--passWithNoTests` and no skipped test left in the tree â€” a skipped test is deleted or fixed.

