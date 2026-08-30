# Market-Value Net Worth — Phase 6.11 architecture and design review

**Status:** design review complete 2026-08-21; **OD-14, OD-15 and OD-16 resolved and applied to the
canonical documents the same day.** **Implemented and verified 2026-08-27** — 1,396 tests passing,
`verify:integrity` 33 passed / 0 failed / 19 engine-enforced / 2 deferred, **no schema change and no
snapshots**. Every gate in [§21](#21-implementation-gates) is met; the two things implementation found
that this document did not anticipate are recorded in [§24](#24-what-implementation-found).

**Nature of this document:** a review record and rationale, like
[INVESTMENT-ENGINE-DESIGN.md](INVESTMENT-ENGINE-DESIGN.md), [NET-WORTH-DESIGN.md](NET-WORTH-DESIGN.md)
and [MARKET-DATA-DESIGN.md](MARKET-DATA-DESIGN.md). **Non-normative** — the rules it proposed now live
in [FINANCIAL-DOMAIN.md §9.3, §9.5, §9.6](FINANCIAL-DOMAIN.md#93-calculation),
[INVESTMENT-DOMAIN.md §5.1](INVESTMENT-DOMAIN.md#51-market-value-of-a-position-as-of-a-date),
`SCHEMA.md` §12, `TESTING.md` §6.7 and ADR-31/ADR-32; where this document and a canonical one differ,
the canonical one wins.

> **One decision came back differently from the recommendation, and this document has been corrected
> rather than left standing.** [§15](#15-ui--the-minimum), [§21](#21-implementation-gates) and
> [§22](#22-decisions--all-three-resolved-2026-08-21) originally assumed `market` would become the default basis, following
> ADR-23. **OD-16 resolved that the default remains `cost`**
> ([ADR-32](DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view)),
> and those three sections now say so. Nothing else in the design changed: every methodology,
> invariant and measurement below was approved as written.

**Baseline reviewed:** commit `ec96b93`. 1,267 tests passing, `verify:integrity` 33 passed / 0 failed
/ 9 engine-enforced / 4 deferred, typecheck, lint and production build clean, live Twelve Data smoke
test passing.

**Documents read:** `CLAUDE.md`, `PROJECT-STATE.md`, `ROADMAP.md`, `MARKET-DATA-DESIGN.md`,
`NET-WORTH-DESIGN.md`, `FINANCIAL-DOMAIN.md`, `INVESTMENT-DOMAIN.md`, `SCHEMA.md`, `TESTING.md`,
`ARCHITECTURE.md`, `DECISIONS.md`.

**Implementation read, not assumed:** `domain/networth/{compose,keys,eligibility,bridge,reconcile}.ts`,
`services/networth.ts`, `domain/pricing/valuation.ts`, `services/{prices,portfolio,market-data}.ts`,
`domain/fx.ts`, `domain/lots/engine.ts`, `db/schema/investments.ts`, the market-data layer and all
four adapters. Where documentation and code disagreed, the code is reported.

---

## 0. Executive summary

Phase 6.11 is **smaller than it looks**, and the reason is that Phase 5 was built for it. Three
things that would normally be the hard parts are already done:

1. **The source key is already right.** `keys.ts:23` keys a position at `(account, instrument)` —
   not per lot — with the comment *"that is what keeps the key stable when Phase 6 replaces the cost
   figure with a market figure."* The identity does not change, so **I-21 and I-22 hold unmodified.**
2. **Double-counting cost and market is structurally impossible.** `ContributionMap.add()` throws on
   a duplicate key. A market figure and a cost figure for the same position share a key, so emitting
   both is a `DuplicateContribution` crash in development and CI — not a wrong number in production.
3. **`compose()` barely changes.** It sums `ComponentInput`s and knows nothing about where a figure
   came from. **The basis is a property of component *construction*, not of composition** — which is
   why widening the basis is a change to one function in `services/networth.ts`, not to the domain.

Five conclusions drive the rest:

- **The cost→market relationship is a *restatement*, not a bridge.** `bridge()` already refuses to
  bridge across a basis change (`bridge.ts:122`), and it is right to: a bridge explains *movement over
  time*, and a change of basis is not movement. Conflating them would let a user read a valuation
  difference as a gain they made. **[ADR-31](DECISIONS.md#adr-31--cost-to-market-is-a-restatement-at-an-instant-not-a-bridge-over-time)**, approved.
- **That restatement decomposes exactly into price and FX**, with **no schema change**, because
  `tax_lots` carries `remaining_cost` in instrument currency alongside the acquisition
  `fx_rate_to_base`. This is a stronger answer than deferring FX attribution — see [§7](#7-unrealised-fx),
  which also explains why the *holding-level* unrealised P&L stays combined.
- **A partial valuation is shown, and labelled.** Never suppressed, never completed with cost.
  `valuationStatus` is `complete | partial | unavailable`, and coverage becomes **value-weighted** by
  base cost basis — which is exactly what D-29 promised Phase 6 would do.
- **Snapshots are closed, by measurement.** A 365-point market-value series over a portfolio larger
  than the target user's measures **123 ms**. See [§12](#12-snapshots--closed-by-measurement).
- **No schema change is required at all.** Every input already exists.

**Total new machinery:** one ratio-aware quantity function, one market component builder, one
restatement calculator, a status/coverage type, and UI copy. `quantityHeldOn` is the only genuinely
new algorithm, and `ROADMAP.md` has flagged it since the Phase 6 review.

---

## 1. The two valuation bases

### 1.1 Recommendation: widen the union, and change nothing else

```ts
export type ValuationBasis = 'cost' | 'market';
```

This is the smallest abstraction that keeps the model coherent, and it is not widening for
convenience — [ADR-23](DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost)
already specifies both members and their meanings, and the parameter already exists in every
signature. Phase 5 deliberately shipped it as a **one-member union** so that widening it would be a
compile error at every site that must be reconsidered. That mechanism should be *used*, not
circumvented.

**Rejected: a separate `MarketNetWorthResult` type.** It would duplicate `compose`, `reconcile`, the
contributions map and every group subtotal, giving two implementations of "add up net worth" free to
disagree — the exact thing [FINANCIAL-DOMAIN.md §10.5](FINANCIAL-DOMAIN.md#105-single-implementation-per-concept)
forbids. The two bases differ in **one term** of a four-term sum; they are not two calculations.

**Rejected: a numeric or open `string` basis.** Nothing is gained and exhaustiveness is lost.

### 1.2 Where the basis actually lives

```
netWorthAsOf(ctx, { asOf, basis })
        │
        ├── componentsAt(ctx, sources, asOf, basis)   ← THE ONLY PLACE THE BASIS MATTERS
        │       accounts      identical in both bases
        │       positions     cost  → Σ remaining_cost × lot.fx_rate_to_base
        │                     market → Σ qtyHeldOn × priceOn × fxOn
        │       manual assets identical in both bases
        │       liabilities   identical in both bases
        │
        └── compose(components, { asOf, base, basis })  ← basis is CARRIED, never read
```

`compose()` records the basis on its result and never branches on it. That is what makes
`reconcile()` work unchanged for both bases: it is a second traversal of whatever the map holds.

**Three of the four component families are basis-independent.** Cash, manual assets and liabilities
are not securities and have no market price; treating them otherwise is [§9](#9-manual-assets) and
[§10](#10-liabilities). Only the investment block differs.

---

## 2. Single counting under market valuation

### 2.1 The worked case

Brokerage opens with ₹1,00,000 and buys ₹60,000 of securities now worth ₹72,000.

| Source key | Cost basis | Market basis |
|---|---|---|
| `account:zerodha` | ₹40,000 | ₹40,000 |
| `position:zerodha:INFY` | ₹60,000 | **₹72,000** |
| **Net worth** | **₹1,00,000** | **₹1,12,000** |

**Inside a `market` calculation**, the market figure occupies the position's key *instead of* the cost
figure — never in addition to it. That is a statement about one calculation's internals, not about the
two metrics: **Net Worth at Cost remains a first-class figure and the default**
([ADR-32](DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view)).
Neither metric replaces the other.

### 2.2 Why that is structural rather than careful

The purchase is a single `investment_transactions` row that debits brokerage cash by exactly what the
lot it opens gains, so cash and positions are disjoint **before net worth is involved at all** — the
Phase 5 finding, unchanged by valuation basis because a price cannot move cash.

What Phase 6.11 adds is that the two bases cannot both contribute:

```
map.add({ key: {t:'position', accountId, instrumentId}, native: cost   })
map.add({ key: {t:'position', accountId, instrumentId}, native: market })
                                       ↑ same keyId → DuplicateContribution thrown
```

**A cost-plus-market double count is a crash, not a number.** This is the strongest property in the
design and it costs nothing to keep: it follows from building components by key rather than by
concatenating arrays.

**One rule the builder must obey:** a position excluded under market (no price) must **not** fall back
to emitting its cost component. That would produce a figure in no basis at all, and ADR-23 forbids it.
It is excluded and named — [§5](#5-partial-valuation).

---

## 3. Price selection

Reuses the Phase 6.9 machinery entirely. Nothing new is designed here; what follows is the binding
statement of which existing function answers which question.

| Question | Answer | Source |
|---|---|---|
| Price for **today** | `quotesFor()` → `PriceResult` | `services/prices.ts` |
| Price **as of T** | `closeAsOf(series, T, cadence)` — greatest `as_of ≤ T`, **bounded** | `services/prices.ts` |
| Trading date | `instrument_prices.as_of`, the session in the market's timezone | SCHEMA.md §5 |
| Observation instant | exchange close on that date — 15:30 IST for XNSE/XBOM | `market-data/exchanges.ts` |
| Stale threshold | **sessions**, not hours ([ADR-28](DECISIONS.md#adr-28--staleness-is-measured-in-trading-sessions-not-wall-clock-hours)) | `market-data/freshness.ts` |
| Weekend / holiday | no session exists; carry back to the previous one, within the bound | ADR-28 |
| Missing price | `missing` with a reason; holding excluded and named | `price-result.ts` |
| Provider outage | invisible on the read path; the stored quote ages into `stale` | ADR-11 |
| Unsupported instrument | `unsupported_asset` | §12.1 of the market-data design |
| Split suppression | `unreconciled_corporate_action` — value **suppressed**, never adjusted | [ADR-29](DECISIONS.md#adr-29--provider-corporate-actions-are-detections-never-ledger-writes) |

**The carry-back bound is what stops a stale observation being used as though it were current.** Ten
calendar days for session-traded instruments, two for continuous. Beyond it the point is a gap, not a
value — so an instrument the provider dropped in 2024 does not quietly hold a 2024 price forever.

**A price is never interpolated, and a later price is never used for an earlier date.** Both would
make a historical figure change as new data arrives.

---

## 4. Staleness policy

The decision the task asks for, stated once: **a stale price is used, and the metric says so.**

| Price state | Contributes? | Effect on the metric |
|---|---|---|
| `current` (0 sessions behind) | yes | none |
| `recent` (1–2 sessions) | yes | none; the age is available on the row |
| `stale` (≥3 sessions, or >10 days) | **yes** | metric is flagged **`stale_inputs`**; the count and the oldest trading date are reported |
| `missing` (any reason) | **no** | holding **excluded and named**; coverage falls; status becomes `partial` |
| provider outage | *not a state* | the stored quote is used and ages naturally into `stale` |

**Why stale is used rather than excluded.** [ADR-11](DECISIONS.md#adr-11--market-data-behind-a-provider-abstraction-with-an-always-available-manual-provider)
already decided this for the portfolio, and the reasoning is stronger for net worth: refusing a stale
price would blank the headline figure every long weekend and after every market holiday. A figure
that disappears on a Sunday is not more honest than one that says "priced as of Friday" — it is less
usable and no more accurate.

**Why the metric still carries the flag.** This is finding **M3**, still open: `NetWorthResult` has
`assetCoverage`, `liabilityCoverage` and `excluded[]` but **no field for "used, but old"**. Under
`market` a portfolio priced entirely from three-week-old closes yields a confident headline with
nothing to qualify it. The staleness summary is a required V1 field, not a nicety.

**What is never done:** silently substituting cost for a stale or missing price. Not approved, not
proposed, and it would violate ADR-23.

---

## 5. Partial valuation

### 5.1 The worked case

| Component | Amount | Priced? |
|---|---|---|
| Cash | ₹5,00,000 | n/a — not a security |
| Equity A | ₹4,00,000 | ✅ |
| Equity B | ₹3,00,000 | ✅ |
| Mutual Fund C | ₹2,00,000 | ✅ |
| Manual property | ₹20,00,000 | valued, not priced ([§9](#9-manual-assets)) |
| Bond | cost ₹5,00,000 | ❌ no market price |

**Reported figure: ₹34,00,000** — the sum of everything that could be valued on this basis —
**labelled `partial`**, with the bond named and its ₹5,00,000 of **cost basis** shown as the
unresolved amount.

The headline is **not** ₹39,00,000. That number would be part market value and part acquisition cost:
a figure in no basis at all, which cannot be reconciled against either source and changes meaning as
coverage moves.

### 5.2 Valuation status

```ts
export type ValuationStatus = 'complete' | 'partial' | 'unavailable';
```

| Status | Meaning |
|---|---|
| `complete` | Every eligible component contributed. No exclusions on either side |
| `partial` | At least one eligible component was excluded and named. **The figure is still reported**, with the excluded magnitude beside it |
| `unavailable` | No investment component could be valued **and** the portfolio is non-empty. The headline is withheld; the cost figure remains available and is offered by name |

`unavailable` is deliberately narrow. A user with no investments at all is `complete`, not
`unavailable` — there is nothing missing. A user whose every holding is unpriced is `unavailable`,
because a "market-value net worth" consisting only of cash and property is a different statement from
the one the label makes.

### 5.3 Coverage becomes value-weighted

D-29 recorded that Phase 5's component-count coverage was a limitation forced by circumstance: the
only exclusion cause was a missing FX rate, and a component with no rate has no expressible base
value to weight by. **Under `market` that constraint disappears**, because an unpriced holding's
**base cost basis is known** — it is exactly what the `cost` basis would have used.

```
investmentCoverage = Σ baseCostBasis(priced positions)
                   ─────────────────────────────────────
                     Σ baseCostBasis(all open positions)
```

Two rules keep this honest:

- **Weight by cost, report both.** The ratio is cost-weighted because that is the only common
  denominator available for a holding with no price. The *excluded* list carries each holding's cost
  so the magnitude is visible, not just the ratio.
- **Coverage is reported per side and per cause**, extending Phase 5's existing split. An excluded
  asset makes the figure look lower; an excluded liability makes it look higher; one blended ratio
  would hide which direction the error runs.

**Non-investment components keep component-count coverage**, because a manual asset with no valuation
still has no expressible value — D-29's original reasoning, unchanged where it still applies.

---

## 6. The cost-to-market restatement

### 6.1 It is not a bridge, and the code already knows

`bridge()` throws when `opening.basis !== closing.basis` (`bridge.ts:122`), with the message *"a
bridge explains movement, and a change of basis is not movement (ADR-23)"*. That check is correct and
must stay. A bridge answers *"what happened between March and August?"*; the cost→market question is
*"why do these two figures for the same instant differ?"* Presenting the second as the first would
invite a user to read a valuation difference as a gain they realised.

**Proposed ADR-31: the cost→market relationship is a restatement at one instant, not a bridge over
time.** Separate function, separate type, separate screen affordance.

### 6.2 The restatement, and what it can explain exactly

At one `asOf`, both bases share every non-investment component identically. So the whole difference
lives in the investment block, and it decomposes **exactly** — verified against the schema, not
assumed:

```
NW(cost)
  − Σ baseCostBasis(unpriced positions)        ← removed: cannot be valued on this basis
  + Σ ( costAtSpot − costAtAcquisitionRates )  ← FX rebasis, priced positions only
  + Σ ( marketAtSpot − costAtSpot )            ← price effect, priced positions only
= NW(market)
```

where, per priced position:

| Term | Formula | Available today |
|---|---|---|
| `costAtAcquisitionRates` | `Σ tax_lots.remaining_cost × lot.fx_rate_to_base` | ✅ = `positions.base_cost_basis` (I-17) |
| `costAtSpot` | `Σ tax_lots.remaining_cost × fx(instrumentCcy → base, asOf)` | ✅ `remaining_cost` is instrument currency; the rate is a dated lookup |
| `marketAtSpot` | `quantityHeldOn × priceOn × fx(instrumentCcy → base, asOf)` | ✅ once `quantityHeldOn` exists |

**Every input already exists. No schema change, no new stored figure.**

### 6.3 What it cannot explain

- **It explains a difference, never a gain.** The price effect at one instant is *unrealised* and
  says nothing about what the user earned; realised P&L is a separate, already-correct figure.
- **The removed-unpriced line is not a loss.** It is the amount the comparison had to set aside, and
  must be labelled that way. A user seeing "−₹5,00,000" next to a bond has to be able to tell that
  from a bond that fell.
- **It cannot be decomposed per *lot* into price and FX** — see [§7](#7-unrealised-fx). The
  aggregate split above is exact; a per-lot attribution of a holding's unrealised P&L is not the same
  question and remains out of scope.
- **It says nothing about manual assets or liabilities**, which are identical on both bases. If a
  restatement line ever appears for them, something has gone wrong.

### 6.4 Two bridges still exist, one per basis

`bridge(t0, t1)` remains valid **within** a basis. Under `market` the `unrealized_gain` line stops
being `notMeasured` and carries a real figure — the change in `(market − cost)` across the period —
which is the line ADR-23 said Phase 6 would populate. The cost bridge is untouched, and golden
scenario **G4** must continue to close at exactly `0.0000`.

---

## 7. Unrealised FX

The project documents that unrealised FX is **not** separately decomposed
([INVESTMENT-DOMAIN.md §6.4](INVESTMENT-DOMAIN.md#64-foreign-currency-positions)): `HoldingView.baseUnrealizedPnl`
compares `baseMarketValue` at spot against `baseInvested` at acquisition rates, so it legitimately
contains both effects. **Phase 6.11 does not change that**, and the distinction matters:

| Question | Decomposable? | Why |
|---|---|---|
| *Why does NW(market) differ from NW(cost)?* | **Yes, exactly** — [§6.2](#62-the-restatement-and-what-it-can-explain-exactly) | Needs only aggregate cost in two denominations, both available |
| *How much of THIS HOLDING's unrealised P&L is currency?* | **No — deferred** | Needs a per-lot revaluation at two rates that no screen consumes |

So the recommendation is the third option in the task's list, sharpened: **preserve the combined
holding-level effect, and calculate the aggregate rebasis exactly** because the restatement needs it
anyway and the data is already there. Attribution stays separate from valuation correctness — the
net-worth figure is correct either way; only the explanation is coarser at the holding level.

**Do not let the aggregate split leak into `HoldingView`.** That would imply a per-holding
attribution the engine is not computing.

---

## 8. Historical market-value net worth

`netWorthAsOf(ctx, { asOf: T, basis: 'market' })` requires six dated inputs. Five already work.

| Input | Source | Rule | State |
|---|---|---|---|
| Account balances | ledger, date-bounded | Phase 5, unchanged | ✅ |
| **Position quantity at T** | `investment_transactions` | `quantityHeldOn` — ratio-aware | ❌ **the one new algorithm** |
| Price at T | `instrument_prices` | greatest `as_of ≤ T`, **bounded** | ✅ `closeAsOf` |
| FX at T | `fx_rates` | exact, else most recent earlier; identity/direct/inverse/triangulated | ✅ `selectRate` |
| Manual valuation at T | `asset_valuations` | `inForce` | ✅ |
| Liability balance at T | `liability_balances` | `inForce` | ✅ |

### 8.1 `quantityHeldOn` — the one genuinely new piece

**`Σ quantity where trade_date ≤ T` is wrong.** A `split` and a `bonus` carry `quantity IS NULL` and a
ratio (`CHECK inv_txn_corporate_action_shape`), so a running sum ignores them and reports the
pre-split quantity forever after.

```
quantityHeldOn(i, T) = Σ_{txn ≤ T} txn.quantity × Π{ ratio of every corporate action in (txn.trade_date, T] }
```

Phase 5 was immune to this because **money is invariant under corporate actions** — `replay()` leaves
`cost_total` and `remaining_cost` untouched. Market value is a *quantity* figure, and quantity is
exactly what a split changes. This is the single place where the at-cost design does not carry over.

**`positions` must not be used for a historical figure.** It is today's cache with no date bound
(ADR-06) — the same rule Phase 5 already follows for lots, restated because the temptation is
stronger here: `positions.quantity` looks exactly like what is wanted.

### 8.2 Historical edge rules

- **Weekend / holiday at T:** carry back to the previous session, within the bound. A TWR boundary or
  a month-end that lands on a Sunday is valued at Friday's close, which is correct and must be stated
  because `twr()` matches boundary dates exactly.
- **No price on or before T** (instrument younger than T, or history not backfilled): **excluded and
  named**, status `partial`. Never zero, never cost.
- **No FX on or before T:** excluded with `no_fx_rate` — Phase 5 behaviour, unchanged.
- **A stale *historical* observation** is a different thing from a stale current one: the carry-back
  distance is reported per point so a chart can render a gap rather than a confident line.
- **Instruments since fully disposed still matter** for any *series*, because they were held earlier
  in the window. Reading current positions to decide what to price produces a plausible, wrong series.

---

## 9. Manual assets

**A manual asset has a valuation, not a price, and the design must not blur them.**

| Aspect | Rule |
|---|---|
| Valuation | The user's own figure from `asset_valuations`, `inForce` at the date. **Identical under both bases** |
| Valuation date | The series date, never the entry date. An asset valued in March contributes that figure in June |
| Currency | The asset's own; converted at the dated rate like any other component |
| Disposal | `disposed_on <= asOf` → absent from that date on; every earlier figure unchanged |
| Historical | The same `inForce` lookup, already correct |
| Missing valuation | Eligible but unvalued → **excluded and named**, never zero (D-32) |

**Manual assets do not become "priced" under market basis.** A flat is not marked to market because
the basis label changed; the user's valuation is the only figure that exists. Reporting them as
market-priced would misrepresent their provenance, and it is exactly the kind of quiet upgrade
`CLAUDE.md` forbids.

**Consequence for coverage:** manual assets contribute to the *component-count* coverage, not to
investment coverage. Mixing them into a cost-weighted investment ratio would let a large unvalued flat
disguise a well-priced portfolio, or the reverse.

**Physical gold specifically** stays a manual asset (OD-12). Under `market` it is still the user's
valuation, and I-8b's warning about a gold asset sharing a name with a gold instrument becomes *more*
useful, because now the instrument really can be priced.

---

## 10. Liabilities

**Unchanged from Phase 5 in every respect**, and that is the finding rather than an omission.

| Aspect | Rule |
|---|---|
| Transacted (linked account) | Contributes **nothing** — the account contributes, by sign (ADR-25) |
| Scheduled | `liability_balances`, `inForce` at the date |
| Currency | Own currency, dated conversion |
| Missing historical balance | The debt did not yet exist at that date → contributes nothing |
| Repayment | Moves the balance series; the bridge's `liability_change` line covers scheduled only |

**A liability has no market value.** A loan's outstanding principal is a contractual amount, not a
traded price; marking debt to market is a fair-value-of-own-debt exercise that no personal finance
application should attempt and that `CLAUDE.md`'s scope explicitly excludes. Interest rate and EMI
remain descriptive (carried Phase 1 debt).

So `NW(market) − NW(cost)` has **no liability term**, and a restatement that produced one would be a
bug.

---

## 11. Coverage and completeness — the reported shape

```ts
interface MarketValuation {
  readonly status: ValuationStatus;              // complete | partial | unavailable
  readonly investmentCoverage: Rate;             // value-weighted, by base cost basis
  readonly assetCoverage: Rate;                  // component count (Phase 5, unchanged)
  readonly liabilityCoverage: Rate;              // component count (Phase 5, unchanged)
  readonly excluded: readonly ExcludedComponent[];   // extended with price reasons
  readonly excludedInvestmentCost: Money;        // what the unpriced holdings cost
  readonly staleness: {
    readonly count: number;
    readonly oldestTradingDate: IsoDate | null;  // "priced as of ..."
  };
}
```

`ExcludedComponent.reason` widens from `'no_fx_rate' | 'unvalued'` to add the price causes already
enumerated in `MissingPriceReason` — `no_provider`, `not_found`, `provider_error`, `rate_limited`,
`unsupported_asset`, `delisted`, `unreconciled_corporate_action`. Each is a different instruction to
the user, and collapsing them to "unpriced" would tell them to fix the wrong thing.

---

## 12. Snapshots — closed by measurement

[ADR-24](DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6)
deferred `net_worth_snapshots` to Phase 6 *"only if measurement justifies it."* It was measured.

**Method.** The real domain functions (`compose`, `reconcile`, `lotEligible`, `inForce`, `valueOf`)
over synthetic data at **8 accounts, 40 instruments, 480 lots, 100,000 price points, 2,500 FX rows**
— deliberately larger than the target user's portfolio, so the figures are an upper bound. The
per-point fold is what was timed; `loadSources()` runs **once per series** by design (D-31) and does
not scale with point count.

| Operation | Measured |
|---|---|
| Net worth at cost, 1 point | **0.31 ms** |
| Net worth at cost + reconcile, 1 point | **0.32 ms** |
| Net worth at market, 1 point | **2.9 ms** |
| 12-point at-cost series | **2.8 ms** |
| 12-point market-value series | **33 ms** |
| 365-point at-cost series | **82 ms** |
| 365-point market-value series, naive price scan | **1,156 ms** |
| **365-point market-value series, indexed price lookup** | **123 ms** |

**Decision: snapshots are NOT required. Close them.**

The naive figure is the interesting one. 1,156 ms looks like the case that justifies a cache — and it
is not, because the cost is a **linear scan of 2,500 price points per instrument per point**, which
is an implementation choice, not a property of the problem. Sorting each instrument's series once and
binary-searching per point takes the same work to **123 ms**, a 9× improvement for a few lines inside
one function.

Introducing a snapshot table to avoid a sort would have added a second stored representation of a
derived figure — free to drift, needing `user_state.valuation_version` to invalidate, and requiring
`verify:integrity` to assert snapshot = derivation — to solve a problem that indexing solves outright.
That is the trade ADR-24's four rules exist to force into the open, and it fails on the evidence.

**Proposed: 6.10 is closed as unnecessary**, with ADR-24's rules retained for the day something
genuinely measures slow. The escape hatch remains the one already designed: a roll-up keyed by
`investment_ledger_version`, never a mutable record.

**What would reopen it.** A daily series over 10+ years (3,650 points ≈ 1.2 s), or a portfolio an
order of magnitude larger. Neither is the target user. If it is ever reopened, measure first.

---

## 13. Performance

| Path | Shape | Assessment |
|---|---|---|
| Current net worth | 6 parallel queries + one fold | 0.3 ms fold; unchanged from Phase 5 |
| Current market-value net worth | the same 6, plus prices and FX | +2.6 ms fold |
| Monthly series (12 points) | **one** fetch, 12 folds (D-31) | 33 ms |
| Daily series (365 points) | one fetch, 365 folds | 123 ms **with indexed lookup** |
| Portfolio valuation | existing `valuePortfolio` | unchanged |
| FX retrieval | preloaded once per request (`services/_fx.ts`) | unchanged; already synchronous |

**Row volume.** A market-value series must load `instrument_prices` for the window once: 40
instruments × 10 years ≈ 100,000 rows ≈ **5.7 MB**. Acceptable for a single-user application, and it
is the same "fetch once, fold per point" shape D-31 already established.

**Two implementation constraints follow, and they are V1 requirements rather than optimisations:**

1. **Index the price series in memory before folding.** Sort once per instrument; binary-search per
   point. Without it a daily chart is a second of CPU.
2. **Bound the fetch by the window.** `historicalCloses(from, to)` already takes a range; a series
   must pass the series' own range, not fetch everything.

**No new infrastructure.** No Redis, no queue, no separate valuation database, no materialised view.
Nothing measured justifies any of them, and `CLAUDE.md` requires a demonstrated need.

---

## 14. Precision

```
provider observation   "1629.80004883"        decimal string from the adapter
   → UnitPrice          NUMERIC(20,8)         parsed exactly; >8 dp is REJECTED, never rounded
   → instrument_prices  NUMERIC(20,8)         stored verbatim
   → market value       valueOf(qty, price)   scale 8 × scale 8 → scale 4, ONE rounding, half_up
   → FX conversion      mulRate(value, rate)  scale 4 × scale 10 → scale 4, ONE rounding, half_up
   → aggregation        Money, bigint scale 4 exact addition; no rounding
   → display            src/lib/format        formatting only; never feeds a calculation
```

**Rounding happens exactly twice per position, and both are boundary roundings**, in the sense
[FINANCIAL-DOMAIN.md §10.2](FINANCIAL-DOMAIN.md#102-rounding) requires — at the end of a calculation,
never inside one:

| Step | Why it rounds | Why there |
|---|---|---|
| `valueOf(qty, price)` | scale 16 product → `Money` scale 4 | Market value is money, and money is scale 4 (ADR-04). The product is formed at full `bigint` width and rounded once |
| `mulRate(value, rate)` | scale 14 product → scale 4 | The same rule the database `CHECK`s use for every stored conversion |

**Aggregation never rounds.** Subtotals sum already-rounded `bigint` figures, which is what makes
`assets − liabilities = Σ map` exact with no tolerance (I-22). That property must survive the basis
change, and it does, because nothing about it depends on where a component's figure came from.

**`Number()` appears nowhere in the path.** The live observation `1629.80004883` is preserved
byte-for-byte from the provider into `instrument_prices`. Its float-shaped digits are Twelve Data's
own upstream artefact, faithfully carried rather than "cleaned" — cleaning it would be inventing a
price the provider never published.

**One consequence worth stating:** market value at scale 4 means a position of 10 million units at a
price with 8 decimals rounds at the fourth decimal of the *total*, not per unit. That is correct and
matches how every other monetary figure in the system behaves.

---

## 15. UI — the minimum

Four additions to the existing Net Worth page. **No new page, no dashboard, no chart.**

The **headline stays Net Worth at Cost** (ADR-32). Market value is reached by asking for it.

```
Net Worth at Cost                            ₹32,00,000     ← unchanged from Phase 5
  at market ₹34,00,000 · difference +₹2,00,000  →           ← one line, links to the market view
```

and on the market view, reached from that link:

```
Net Worth at Market Value                    ₹34,00,000
  at cost ₹32,00,000 · difference +₹2,00,000            ← the reciprocal line back
  ⚠ Partial — 1 holding unpriced (₹5,00,000 at cost)    ← status, only when not complete
  Priced as of 21 Aug 2026                              ← only when anything is stale
```

| Element | Rule |
|---|---|
| Headline | The basis is **in the label**, never implied. Phase 5's banner mechanism, reused |
| Cost comparison | One line, both figures and the difference. Not a second headline |
| Status | Rendered **only** when `partial` or `unavailable`, so it means something when it appears |
| Staleness | Rendered **only** when something is behind — M3's missing field, surfaced |
| Restatement | On the existing **drill-down**, not the summary. Three lines: removed-unpriced, FX rebasis, price effect |
| Headline basis | **`cost`** ([ADR-32](DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view)). The headline is **Net Worth at Cost**, unchanged from Phase 5 |
| Reaching `market` | An explicit, named affordance from the comparison line — *"view at market value"* — landing on the same page rendered at `basis: 'market'`, labelled as such. **Not** a silent toggle, and **not** a second headline |

**No calculation in UI code.** Every figure above comes from `MarketValuation` and the restatement
type; the components format and lay out. This is [ARCHITECTURE.md §5](ARCHITECTURE.md)'s rule and the
reason the Phase 5 pages could be verified by reading them.

**Copy that must not appear:** "estimated", "approximate", "live". The figure is exact arithmetic over
dated observations; what varies is *coverage* and *age*, and both are stated as facts.

---

## 16. Reconciliation

*"Why is my Net Worth at Market Value ₹X?"* — `reconcile()` works unchanged, because it is a second
traversal of whatever the contributions map holds and it never asked where a figure came from.

The reconciliation must distinguish six sources, which the existing `NetWorthGroup` already does:

| Source | Group | Under `market` |
|---|---|---|
| Cash | `cash`, `brokerage_cash` | identical to cost |
| Investment market value | `investments` | **replaced** — qty × price × fx |
| Manual assets | `property`, `vehicle`, `gold_physical`, … | identical to cost |
| Liabilities | `credit_card`, `loans`, … | identical to cost |
| FX conversion | per-contribution `rate` + `rateAsOf` | already carried on every `Contribution` |
| Unresolved | `excluded[]` + `excludedInvestmentCost` | **extended** with price reasons |

**Each priced position's row gains its provenance** — trading date, price source, freshness — because
"why is it ₹72,000?" is answered by *400 × ₹180.00, priced 21 Aug from twelvedata:XNSE*, and every one
of those is already on the `PriceResult`.

**I-22 is unchanged and must stay exact.** The residual is `Σ contributions − (assets − liabilities)`
and is `0` with no tolerance. It is reported rather than asserted silently so both `verify:integrity`
and the UI can see the check was made.

---

## 17. AI boundary

Unchanged, and stated so it is not eroded later: **the deterministic engine is the source of truth for
market-value net worth.** AI may explain a movement, summarise a period, or point at a concentration —
always from validated engine output, never by computing a figure of its own.

Three specific prohibitions for this metric:

- AI must not **select a price**. Freshness and carry-back are deterministic rules, not judgement.
- AI must not **fill a gap**. An unpriced holding stays unpriced; a model estimating its value would
  be fabricating financial data, which `CLAUDE.md`'s `<ai_mutation_rule>` and
  `<ai_financial_assistant>` both forbid.
- AI must not **restate the basis**. If asked "what's it worth at market?", the answer comes from the
  engine or it does not come.

The tool layer makes this structural: an AI caller holds an `AiReadCtx` — no database handle, no
transaction capability, and not a `ReadCtx` — while every market-data write takes a `WriteCtx` and
`withWriteCtx` itself requires a `RequestCtx` (ADR-21,
[ADR-33](DECISIONS.md#adr-33--the-transaction-opener-is-a-capability-carried-on-the-context-not-an-ambient-import)).

*Corrected 2026-08-30.* This paragraph previously said an AI caller "can build only a `ReadCtx`",
which was true and insufficient: a `ReadCtx` carries a full DML handle, and `withWriteCtx(readCtx, …)`
compiled clean. That was finding **F-1** of the Phase 7 review, closed before any AI code was written.

---

## 18. Adversarial scenarios

| # | Scenario | Expected behaviour |
|---|---|---|
| 1 | All assets priced | `complete`, coverage `1.0`, no staleness note |
| 2 | No investments at all | `complete` — nothing is missing. **Not** `unavailable` |
| 3 | One stale price | Contributes; metric flagged `stale_inputs` with the oldest trading date. Figure still shown |
| 4 | One missing price | Excluded and named; `partial`; its **cost** reported as unresolved; **never** substituted with cost inside the total |
| 5 | Unsupported instrument (FD, `other`) | `unsupported_asset`; excluded and named. Under `cost` it contributed normally — the difference is visible in the restatement's removed line |
| 6 | Weekend | Carry back to Friday's session. **Not stale** — 0 sessions behind (ADR-28) |
| 7 | Holiday | Same; a multi-day closure does not advance the session count |
| 8 | Provider outage | Invisible — reads touch only the database. The stored quote ages into `stale` and says so |
| 9 | Foreign-currency equity | `qty × price` in instrument currency, then × dated FX. Both `native` and `base` on the contribution |
| 10 | Missing FX | Excluded with `no_fx_rate` — Phase 5 behaviour. Triangulation is tried first (M1) |
| 11 | Historical price unavailable at T | That point is a **gap**; the series renders a break, not a line through it |
| 12 | Split detected **and recorded** | `quantityHeldOn` applies the ratio; market value correct; no suppression |
| 13 | Split detected, **not recorded** | Price **suppressed** (`unreconciled_corporate_action`); holding excluded; `partial`. The 80% phantom never appears (ADR-29) |
| 14 | Brokerage cash + positions | ₹40,000 + ₹72,000 = ₹1,12,000. Cost and market at one key is a `DuplicateContribution` throw |
| 15 | Fully sold holding | `quantityHeldOn = 0` → contributes nothing. Realised P&L is untouched and lives elsewhere |
| 16 | Account opened after `asOf` | **Absent** from the breakdown, not zero (ADR-26, N2) |
| 17 | Closed account | Contributes its balance at every date from its opening. `is_active` is read by no calculation (I-26) |
| 18 | Manual asset disposed | Absent from `disposed_on` onward; every earlier figure unchanged |
| 19 | Liability repayment | Balance series moves; identical under both bases |
| 20 | Negative net worth | Reported as negative. `sideOfAmount` classifies by sign; nothing clamps (ADR-25) |
| 21 | Large portfolio | 123 ms for 365 points at 40 instruments × 10 years, with indexed lookup ([§12](#12-snapshots--closed-by-measurement)) |
| 22 | Mixed currencies | Each component converted once at its own dated rate; subtotals sum already-rounded figures (I-22) |
| 23 | Twelve Data `1629.80004883` | Preserved exactly at scale 8; rounds once at `valueOf`, once at `mulRate` |
| 24 | AMFI NAV | Identical path — `nav` cadence, session-based freshness, same `closeAsOf` |
| 25 | Partial coverage | Figure shown, labelled `partial`, unresolved cost named. Never presented as complete |
| 26 | Cost vs market comparison | Restatement, not a bridge. Removed-unpriced / FX rebasis / price effect, closing exactly |

**Where this design could still produce a wrong number**, stated plainly:

1. **`quantityHeldOn` ignoring a ratio** — silently wrong after every corporate action, and the one
   new algorithm. It needs the heaviest tests in the phase.
2. **Using `positions` for a historical point** — plausible, tempting, and wrong at every date but today.
3. **A cost fallback creeping in** for an unpriced holding, producing a figure in no basis.
4. **The restatement's removed-unpriced line read as a loss** — a labelling failure with a financial
   consequence.
5. **An unbounded carry-back**, valuing a dropped instrument at a years-old price. Already bounded;
   must stay bounded.

---

## 19. Proposed invariants I-41 … I-49

Continuing `SCHEMA.md` §12, which currently ends at **I-40**.

| # | Invariant | Domain rule | Test | DB constraint |
|---|---|---|---|---|
| **I-41** | A net-worth figure carries exactly one basis, and no total mixes cost and market | `compose()` records `basis`; component builder branches once | type-level + integration | — (not expressible) |
| **I-42** | Under `market`, a position contributes market value **or** is excluded — never its cost | component builder | integration; a fixture with one unpriced holding | — |
| **I-43** | No source key contributes twice under either basis | `ContributionMap.add()` throws | unit (existing I-21 test, extended) | — |
| **I-44** | A stale price contributes and is reported; it never becomes `current` | `classifyFreshness` + the staleness summary | unit + integration | — |
| **I-45** | Every excluded component carries a machine-readable reason | `ExcludedComponent.reason` | integration, all 9 reasons | — |
| **I-46** | `quantityHeldOn(i, T)` applies every corporate-action ratio in `(trade_date, T]` | new domain function | **property test** across split/bonus/reverse | — |
| **I-47** | A historical figure reads no current-state cache — not `positions`, not `is_active` | date-driven builders | **source scan**, extending I-26's mechanism | — |
| **I-48** | The restatement closes: `NW(cost) − removed + fxRebasis + priceEffect = NW(market)`, exactly for single-currency data | restatement calculator | golden scenario | — |
| **I-49** | Market value preserves provider precision to scale 8, rounding only at `valueOf` and `mulRate` | `UnitPrice`, `valueOf`, `mulRate` | unit; `1629.80004883` end to end | `numeric(20,8)` on `instrument_prices` |

**I-38 and I-39 stop being deferred.** Both were reported as `skipped` by `verify:integrity` pending
this phase; 6.11 is where they become live engine invariants.

**None of these is a database constraint**, and that is expected: every one is a statement about a
*derived* figure, and net worth stores nothing. They are engine invariants in D-30's sense and should
be reported by `verify:integrity` with the file and test that enforce each — the same treatment the
eight Phase 5 engine invariants get, so the report stays a complete account of I-1 … I-49.

---

## 20. Schema delta

**None. Phase 6.11 requires no schema change.**

Verified against the live schema rather than assumed:

| Input | Table | Present? |
|---|---|---|
| Position quantity history | `investment_transactions` (`quantity`, `ratio_num`, `ratio_den`) | ✅ |
| Cost in instrument currency | `tax_lots.remaining_cost` | ✅ |
| Acquisition FX rate | `tax_lots.fx_rate_to_base` | ✅ |
| Historical prices | `instrument_prices` | ✅ |
| Current quotes | `instrument_quotes` | ✅ |
| FX observations | `fx_rates` | ✅ |
| Manual valuations | `asset_valuations` | ✅ |
| Liability balances | `liability_balances` | ✅ |
| Split suppression | `corporate_action_detections` | ✅ |

**No `net_worth_snapshots`** ([§12](#12-snapshots--closed-by-measurement)). **No
`user_state.valuation_version`** — it exists only to invalidate a snapshot cache, and there is no
cache. Both stay unbuilt.

**This is the strongest evidence that the Phase 5 design was right.** A phase that changes the
headline financial metric of the application needs no new table, because the data model already
separated *facts* from *figures*.

---

## 21. Implementation gates

### Required for V1

| Gate |
|---|
| `ValuationBasis` widened to `'cost' \| 'market'`; every resulting compile error visited deliberately |
| `quantityHeldOn` — ratio-aware, property-tested across split, bonus and reverse split |
| Market component builder: qty × price × dated FX, excluding and naming what it cannot price |
| `MarketValuation` — status, value-weighted investment coverage, excluded cost, staleness summary |
| Split suppression honoured (ADR-29) |
| The restatement, closing exactly for single-currency data (I-48) |
| Indexed price lookup — a V1 requirement, not an optimisation ([§13](#13-performance)) |
| **The default stays `cost`** ([ADR-32](DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view)) — asserted by a test, not just by omission: `netWorthAsOf(ctx, {})` returns `basis: 'cost'` and matches the Phase 5 figure byte-for-byte on the same fixture |
| The basis is named on **every** surface that shows either figure; no unqualified "Net worth" appears where the basis could be ambiguous |
| Bridge under `market`: `unrealized_gain` carries a real figure |
| I-41 … I-49 in `verify:integrity`; I-38/I-39 promoted from deferred |
| Release note: the basis switch moves net worth for **FX reasons alone**, independently of price |
| Golden **G5** (partial coverage) and **G6** (market-value with a foreign holding) |

**All met on 2026-08-27.** Two carry a note:

- **The indexed price lookup was necessary but not sufficient.** See [§24](#24-what-implementation-found).
- **`quantityHeldOn` is derived from `replay()` rather than re-implemented** as the cumulative
  ratio product this document sketched. The two forms disagree by units of 10⁻⁸ on a reverse split
  that does not divide evenly, because per-lot rounding and rounding-the-sum are different
  operations — and the per-lot answer is the one `positions.quantity` carries. `replay()` now emits
  a per-trade-date `quantityTimeline`; `quantityHeldOn` binary-searches it. The property test
  asserts equality against a **bounded replay**, which is what §21 asked for, and the ratio-product
  form is kept in the suite only as the wrong answer it proves wrong.

### Deferred

Per-lot FX attribution of holding-level unrealised P&L ([§7](#7-unrealised-fx)) · a basis toggle in
the UI · market-value allocation and concentration · intraday valuation · crypto (OD-11) · gold
(OD-12) · dividend-adjusted total-return series.

### Future optimisation — only on measurement

Snapshots under ADR-24's four rules ([§12](#12-snapshots--closed-by-measurement)) · a roll-up keyed by
`investment_ledger_version` · SQL-side quantity folding if the in-memory path ever measures slow.

---

## 22. Decisions — all three resolved 2026-08-21

**No open decision remains for Phase 6.11.**

| # | Decision | Outcome |
|---|---|---|
| **OD-14** | Apply this review to the canonical documents | ✅ **Approved and applied.** Reconciled, not appended: [ADR-31](DECISIONS.md#adr-31--cost-to-market-is-a-restatement-at-an-instant-not-a-bridge-over-time) and [ADR-32](DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view); methodology into `FINANCIAL-DOMAIN.md` §9.3/§9.5/§9.6, `INVESTMENT-DOMAIN.md` §5.1, `SCHEMA.md` §12, `TESTING.md` §6.7. **Phase 5's cost methodology untouched.** Draft **I-42 dissolved** — I-38 and I-39 already said it |
| **OD-15** | Snapshots | ✅ **Closed — not built.** No `net_worth_snapshots`, no job, no snapshot-based figure. Evidence in [§12](#12-snapshots--closed-by-measurement). Reopened only by a **real production measurement**, never by a roadmap entry |
| **OD-16** | Default valuation basis | ✅ **Resolved: the default remains `cost`.** `market` is a fully supported, explicitly requested alternate view. **This came back differently from the recommendation above**, and [ADR-32](DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view) supersedes ADR-23's default-flip consequence. Sections [15](#15-ui--the-minimum) and [21](#21-implementation-gates) were corrected rather than left standing |

**Why the OD-16 outcome is the better one, recorded because this document argued the other way.** The
recommendation weighed ADR-23's stated intent most heavily. The resolution weighs **historical
continuity** most heavily, and that is the stronger argument for a single-user application whose value
is a continuous record: flipping the default would restate every figure the user had already seen,
with no transaction behind the change. It also keeps a `partial`-capable figure out of the headline
position. The design needed no structural change to accommodate it — which is itself evidence the
basis abstraction was drawn in the right place.

---

## 23. Completion gate for this review

| Requirement | Status |
|---|---|
| Cost and market formally separated | ✅ [§1](#1-the-two-valuation-bases) — one union, one branch point, `compose()` unchanged |
| Single counting re-proved under market | ✅ [§2](#2-single-counting-under-market-valuation) — a double count is a thrown exception |
| Price selection deterministic | ✅ [§3](#3-price-selection) — every question mapped to an existing function |
| Stale / missing behaviour explicit | ✅ [§4](#4-staleness-policy) — stale is used and flagged; missing is excluded and named |
| Partial valuation explicit | ✅ [§5](#5-partial-valuation) — three statuses, value-weighted coverage |
| Historical methodology defined | ✅ [§8](#8-historical-market-value-net-worth) — six inputs, five already working |
| FX behaviour defined | ✅ [§7](#7-unrealised-fx) — aggregate split exact, holding-level attribution deferred |
| Manual assets defined | ✅ [§9](#9-manual-assets) — valuations, never prices |
| Liabilities defined | ✅ [§10](#10-liabilities) — unchanged; no market term exists |
| Reconciliation defined | ✅ [§16](#16-reconciliation) — six sources, I-22 exact |
| Precision defined | ✅ [§14](#14-precision) — two roundings, both at boundaries |
| Performance understood | ✅ [§13](#13-performance) — measured, not estimated |
| Snapshot necessity decided by evidence | ✅ [§12](#12-snapshots--closed-by-measurement) — **closed** |
| Schema changes identified | ✅ [§20](#20-schema-delta) — **none required** |
| Invariants defined | ✅ [§19](#19-proposed-invariants-i-41--i-49) — I-41 … I-49, each mapped |
| Implementation gates explicit | ✅ [§21](#21-implementation-gates) — V1 / deferred / future |
| No unresolved contradiction | ✅ One found and resolved: the task's "cost-to-market bridge" contradicts `bridge.ts:122`, which refuses cross-basis bridging. Resolved as a **restatement** (ADR-31) |
| **Implementation started** | ✅ **Complete, 2026-08-27.** See [§24](#24-what-implementation-found) |

---

## 24. What implementation found

Two things this review did not anticipate. Both are recorded here rather than only in the commit,
because both outlive the phase.

### 24.1 The FX lookup was the real cost of a series, not the price lookup

[§13](#13-performance) named two V1 constraints — index the price series, bound the fetch — and
[§12](#12-snapshots--closed-by-measurement) put a 365-point market series at **123 ms** with the
index in place. Both constraints were implemented as specified. The first benchmark run measured
**710 ms**.

The price index was working: 219× fewer observations scanned, exactly as designed. The remaining
cost was `selectRate()`, which rebuilds its whole `PairIndex` on **every call**. `indexRows` is
`O(rows)` and its result depends only on `(rows, on)`, so a single-date page — a handful of
conversions — cannot tell. A *series* asks once per foreign position per point, and over 2,500
stored observations that is a table scan wearing a lookup's clothes.

`rateSelector()` memoises the index per date. **The resolution rule is untouched** — identity →
direct → inverse → triangulated, dated by the stalest leg, one pivot only — so the change is to what
is recomputed and never to what is decided; all 1,396 tests confirm every Phase 3, 4 and 5 figure is
byte-identical. The series dropped to **80 ms**, beating the baseline, and the single-point market
fold from 3.0 ms to 0.3 ms.

**The lesson is the one ADR-24 already argues.** No test would have caught this: every figure was
already correct. It took a measurement — which is why `scripts/bench-networth.ts` is a committed,
runnable script rather than a table of numbers in this document, and why the same-shaped mistake in
two different lookups was found twice by the same method.

### 24.2 `ExclusionReason` needed a tenth member

[§11](#11-coverage-and-completeness--the-reported-shape) widened the exclusion reason to
`'no_fx_rate' | 'unvalued'` plus the seven `MissingPriceReason` members. Nine, and the tests were
specified against nine.

A historical valuation is a tenth case. When no observation exists on or before `T` **within the
carry-back bound** — the instrument is younger than the date, or its history has not been backfilled
that far — none of the seven is true: they are all verdicts about a *provider*, and the provider may
be working perfectly and simply have published nothing for a date before the instrument listed.
Folding it into `not_found` tells the user to re-map a symbol that is mapped; into `no_provider`,
that they must hand-enter a price for a date that has one everywhere else in the series.

So `ExclusionReason` carries **`no_price_on_date`**, and it is deliberately **not** a
`MissingPriceReason`: the market-data union describes provider verdicts and is untouched. This is a
gap in the point, not a fault in the feed.

### 24.3 Golden scenario numbering

`TESTING.md` §5's table **named G6** *"Corrections"*, while §6.7 and [§21](#21-implementation-gates)
of this document both named G6 *"market value with a foreign holding"* — one number, two meanings,
in three places. Phase 6.11 gates on the latter, so the market-value scenario **took G6** and the
corrections scenario **was renumbered G7** in `TESTING.md` §5, with a note in that table recording
the change. G5 was never in conflict — "sparse data" and "partial coverage" are the same
scenario under two names.
