# Net Worth — Phase 5 architecture and design review

**Status:** design review complete, 2026-08-12. **Phase 5 implementation has not started.**
**Nature of this document:** a review record and rationale, like
[INVESTMENT-ENGINE-DESIGN.md](INVESTMENT-ENGINE-DESIGN.md). **Non-normative** — where it and a
canonical document differ, the canonical document wins until the corrections in
[§14](#14-defects-found-in-the-baseline-n1n19) are approved and applied.

**Baseline reviewed:** commit `8b60a6d` — Phases 0–4 complete and verified (912 tests, 21 invariants
passing, 3 deferred). Canonical documents read: `CLAUDE.md`, `PROJECT-STATE.md`, `ROADMAP.md`,
`ARCHITECTURE.md`, `FINANCIAL-DOMAIN.md`, `INVESTMENT-DOMAIN.md`, `SCHEMA.md`, `TESTING.md`,
`DECISIONS.md`. Implementation read: the money and investment schema files and migrations
`0001`/`0002`, `domain/ledger/`, `domain/lots/`, `domain/pricing/`, `domain/calc/`, `domain/fx.ts`,
`services/{accounts,transactions,transfers,cashflow,positions,portfolio,prices,_ctx,_fx}.ts`,
`db/integrity.ts`, `jobs/`, and the Money and Investments UI.

**Resolved decisions are not reopened.** OD-4, OD-5 and OD-6/[ADR-22](DECISIONS.md#adr-22--financial-recognition-is-trade-dated-settlement_date-is-informational-metadata)
(trade-dated recognition) are taken as given throughout. Two contradictions *inside* the current
canonical set were found and are recorded in [§14](#14-defects-found-in-the-baseline-n1n19) rather
than silently resolved.

---

## 0. Executive summary

Net Worth is **an aggregation, not a ledger.** It introduces no new source of financial truth for
anything the system already records. Its whole job is to take four existing bodies of fact — account
balances, investment cost/value, manually-valued assets, and liabilities — apply a date rule to each,
convert each to base currency, and add them up **once**.

Four conclusions drive the design:

1. **Single counting is a structural property of Phase 3/4, not something Phase 5 must invent.** A
   purchase debits brokerage cash and opens a lot inside one ledger row, so cash and position are
   already disjoint. Phase 5's contribution is to make the disjointness *checkable* — a
   `contributions: Map<SourceKey, Money>` that throws on a duplicate key, and a reconciliation that
   recomputes the total by a second path.
2. **Historical net worth must be derived from dated rows, never from current-state flags — and the
   Phase 4 cache cannot answer an as-of question.** `positions` is today's snapshot. The as-of
   investment figure is derived instead from `tax_lots` and `lot_disposals` bounded by
   `opened_on` / `closed_on`. Because a split and a bonus touch **no money**, the *cost* form of that
   derivation is exact and immune to corporate actions — which is precisely why Phase 5's at-cost
   basis is cheap and correct, and why the market-value form is Phase 6 work.
3. **Nothing needs to be stored.** Every figure is derivable in a small number of set-based queries,
   including the month-end history series. Snapshots are therefore recommended **out** of Phase 5
   ([OD-8](#od-8--net_worth_snapshots-and-the-networthsnapshot-job-move-to-phase-6)).
4. **The baseline has nineteen defects that Phase 5 would otherwise walk into**, two of them
   material: an as-of balance that adds an account's opening balance to dates *before the account
   existed* (N2), and a §9.3 formula that would report investments as **zero** in the current
   price-free state (N6). Neither is a live bug today — no caller passes `asOf` — which is exactly
   why they survived four phases.

Phase 5 ships **at cost**, deterministically, with `null`-and-a-reason wherever a figure is genuinely
unavailable, and with a reconciliation that can answer *"why is my net worth ₹X"* down to the
individual row.

---

## 1. Composition — what net worth is made of

### 1.1 Definitions

```
netWorth(T, basis) = assets(T, basis) − liabilities(T)

assets(T, basis)      = Σ contributions where side = 'asset'
liabilities(T)        = Σ |contributions| where side = 'liability'
```

There is no third category. Every contribution lands on exactly one side, chosen **by sign**
([§2.2](#22-classification-is-by-sign-not-by-kind)).

`basis ∈ { 'cost', 'market' }`. Phase 5 implements `'cost'` only; `'market'` is the Phase 6 default.
The parameter exists in Phase 5 so that Phase 6 is a new valuation function and a changed default,
not a re-plumbing ([§4](#4-investments)).

### 1.2 Sources, and which are authoritative

| Component | Table(s) | Authoritative or derived | Owned by |
|---|---|---|---|
| Cash / bank / wallet / brokerage / card / loan balance | `accounts` + `transaction_entries` + `investment_transactions` | **derived** — `deriveBalance()`; no stored column | [FINANCIAL-DOMAIN.md §3](FINANCIAL-DOMAIN.md#3-accounts) |
| Investment cost basis | `tax_lots`, `lot_disposals` | **derived cache** of a ledger replay; rebuildable | [INVESTMENT-DOMAIN.md §4](INVESTMENT-DOMAIN.md#4-cost-basis-engine-default-fifo) |
| Investment market value (Phase 6) | above + `instrument_quotes` / `instrument_prices` | derived | Phase 6 |
| Manual asset value | `manual_assets` + `asset_valuations` | **authoritative** — an append-only valuation series | Phase 5 |
| Liability outstanding (scheduled) | `liabilities` + `liability_balances` | **authoritative** — an append-only balance series | Phase 5 |
| Liability outstanding (transacted) | the linked account's balance | **derived** — contributes through the account, never separately | Phase 5 |
| FX rate | `fx_rates` | authoritative, insert-only per `(pair, as_of)` | [FINANCIAL-DOMAIN.md §2](FINANCIAL-DOMAIN.md#2-fx) |
| Net worth, at any date | — | **derived on demand** | Phase 5 |

**Phase 5 adds exactly two new sources of financial truth**, `manual_assets`/`asset_valuations` and
`liabilities`/`liability_balances`, and both are append-only series rather than mutable fields — the
same shape as the ledger, for the same reason: *updating a value in place retroactively rewrites
every historical figure derived from it.*

Everything else Phase 5 touches, it **reads**.

### 1.3 Categories, for display and reconciliation

Asset groups: `cash` (bank + cash + wallet), `brokerage cash`, `investments` (by asset class),
`property`, `vehicle`, `gold_physical`, `collectible`, `receivable`, `other`.
Liability groups: `credit_card`, `loans` (by `liability_kind`), `overdrawn accounts`.

These are **presentation and reconciliation groupings over the contributions map**, not a second
summation. The map is the only place a total is formed ([§3.2](#32-the-contributions-map)).

---

## 2. Accounts

### 2.1 Every account, of every kind, contributes exactly once

`deriveBalance(account, T)` is the single implementation
([FINANCIAL-DOMAIN.md §10.5](FINANCIAL-DOMAIN.md#105-single-implementation-per-concept)) and Phase 5
calls it — it does not re-sum the ledger. Its two terms are already the two ledgers, unioned in
`entryTotals()` with **no `cash_settled` filter**, which is correct: I-16's `CHECK` guarantees an
unsettled row carries zero, and filtering here would hide a broken constraint instead of surfacing
it.

### 2.2 Classification is by **sign**, not by kind

> `balance > 0` → asset at `balance`. `balance < 0` → liability at `|balance|`. `balance = 0` →
> contributes nothing to either subtotal, and still occupies its key in the map.

`accounts.kind` decides **which group the row is displayed in** and **which sign is expected** (a
`bank` account in credit, or a `credit_card` in debit, is flagged on screen). It does **not** decide
which side of the sheet the money lands on.

This is a correction to [FINANCIAL-DOMAIN.md §3](FINANCIAL-DOMAIN.md#3-accounts)'s table and to
§9.3's formula, and it is not cosmetic — see N1 in [§14](#14-defects-found-in-the-baseline-n1n19).
Under the current rules an **overpaid credit card** (balance `+₹5,000`) is in neither term of §9.3
and vanishes from net worth entirely, while `accountRole()` in
`src/server/domain/ledger/balance.ts:88` classifies it as a *liability* by kind —
so a calculator built on `accountRole` + `abs()` would report it as a ₹5,000 **debt**. Same row, two
implementations, a ₹10,000 spread.

Sign-based classification also removes the gap for an overdrawn `bank` account, and buys a much
stronger structural property:

```
Σ over ALL accounts of contribution(a, T) = Σ over ALL accounts of balance(a, T)
```

The account block of net worth is a plain sum of balances. Nothing can be double-counted or dropped
by a kind test, because there is no kind test.

**Credit available on a card is not an asset** and is excluded from every total
([FINANCIAL-DOMAIN.md §3](FINANCIAL-DOMAIN.md#3-accounts)) — `availableCredit()` already exists and
is display-only. Phase 5 must not put it in the map.

### 2.3 Historical eligibility — the account lifecycle rule

> **An account contributes to `netWorth(T)` when `opening_date <= T`, and its balance is the ledger
> bounded by `T`. `is_active` is never read by any calculation.**

Two halves, both load-bearing.

**`is_active` is not a filter.** [FINANCIAL-DOMAIN.md §9.3](FINANCIAL-DOMAIN.md#93-calculation)
already says this; the implementation consequence is that Phase 5 **must** call
`listAccounts(ctx, { includeInactive: true, asOf })`. The default excludes inactive accounts (N4),
so a net-worth calculator written against the default would silently drop every closed account from
every historical figure — the exact failure §9.3 exists to prevent, arriving through a default
argument rather than through a filter anyone wrote.

**`opening_date` *is* a filter, and this is the defect worth the most.** `deriveBalance()` adds
`opening_balance` unconditionally
(`src/server/domain/ledger/balance.ts:35`, applied in
`src/server/services/accounts.ts:220`). An account opened in 2026 with an
opening balance of ₹50,000 therefore contributes ₹50,000 to net worth **as of 2020**. The date bound
in `entryTotals()` correctly bounds the *movements* and does not bound the *opening position*, which
is not a movement.

The fix belongs in Phase 5's eligibility predicate, not in `deriveBalance()`:

```
contribution(account a, T) = a.opening_date <= T ? balance(a, T) : none
```

An account excluded this way is **absent from the map**, not present at zero — so it does not appear
in a breakdown and cannot be confused with an account that genuinely held nothing.

| Scenario | Result |
|---|---|
| Account created after `T` | absent from `netWorth(T)`; appears from its `opening_date` onward |
| Account closed after `T` | present in `netWorth(T)` at its balance on `T` |
| Account closed before `T`, emptied | present, contributing `0` |
| Account closed before `T`, still carrying a balance | present at that balance — closing does not settle ([§3](FINANCIAL-DOMAIN.md#3-accounts), edge case 7) |
| Account deleted | it had no ledger rows, so it never contributed |

---

## 3. The single-counting model

### 3.1 Why the sum is non-overlapping — the proof, not the promise

`CLAUDE.md <net_worth>` names the hazard exactly: *an investment held inside an investment account
must not accidentally be counted as both an account balance and an investment asset.* The worked
example in the Phase 5 brief:

```
brokerage cash ₹100,000, positions ₹0                → contribution ₹100,000
buy ₹60,000 of securities
brokerage cash  ₹40,000, positions ₹60,000           → contribution ₹100,000   (not ₹160,000)
```

This holds **because of how Phase 3/4 record the purchase, not because Phase 5 subtracts anything.**
One `investment_transactions` row carries `net_amount = −60,000` (account currency, OD-5) and opens a
lot with `cost_total = 60,000` (instrument currency). `deriveBalance()` sums `net_amount`
unconditionally, so the cash falls by exactly what the lot gains. The two figures are the two halves
of one row.

Formally, for an account `a` whose instruments share its currency, and any `T`:

```
balance(a,T) + Σ_{lots ℓ in a} remainingCost(ℓ,T)
  = opening(a) + Σ money-ledger entries(≤T)
                + Σ investment cash effects that are NOT trades (≤T)
```

Buys and sells cancel out of the right-hand side entirely. That identity is the single-counting
rule, and it is directly testable — see NW-5 in [§11](#11-invariants).

The corollary that matters for the UI: **a purchase moves net worth by exactly zero, and a sale moves
it by exactly the realised P&L.** A dividend moves it by the *net* received. A fee moves it by
`−fee`.

### 3.2 The contributions map

Prose is not enforcement. The calculator builds an explicit map and sums **only** the map:

```ts
type SourceKey =
  | { t: 'account';   accountId: string }
  | { t: 'position';  accountId: string; instrumentId: string }
  | { t: 'asset';     assetId: string }
  | { t: 'liability'; liabilityId: string };

interface Contribution {
  readonly key: SourceKey;
  readonly side: 'asset' | 'liability';
  readonly group: string;              // display + reconciliation grouping
  readonly native: Money;              // the component's own currency
  readonly rate: Rate;                 // the rate used, and its as_of
  readonly rateAsOf: IsoDate;
  readonly base: Money;                // round(native × rate, 4)
  readonly label: string;              // "HDFC Savings", "INFY in Zerodha", …
}
```

`add()` **throws** on a duplicate key. The total is `Σ map.values().base` — never a sum over
concatenated arrays, because concatenation is how a source gets counted twice without anyone
noticing. A duplicate is a crash in development and in CI, not a wrong number in production.

**Positions are aggregated to `(account, instrument)` before insertion.** The at-cost derivation
works per *lot*; several lots of one instrument in one account collapse into one key. Keeping the key
at `(account, instrument)` — rather than at `(lot)` — is what makes the map key stable when Phase 6
replaces the cost figure with a market figure computed per position.

### 3.3 The overlaps the schema can and cannot prevent

| Overlap | Prevented by |
|---|---|
| Two liabilities claiming one account | `UNIQUE (linked_account_id)` — a database constraint |
| A transacted liability counted alongside its account | design: a linked liability contributes **nothing**; the account contributes ([§5.2](#52-liabilities--two-shapes-discriminated-by-linked_account_id)) |
| Brokerage cash counted as both a balance and a "cash holding" | design: there is no cash instrument; `cash_equivalent` instruments are real holdings bought with cash |
| A position counted alongside the cash that bought it | the ledger — [§3.1](#31-why-the-sum-is-non-overlapping--the-proof-not-the-promise) |
| The same source key inserted twice | the map — it throws |
| **Physical gold also held as a gold ETF/SGB instrument** | **nothing structural.** A name-similarity warning only |
| **A manual asset that duplicates an account** ("Cash at home" as both) | **nothing structural.** User discipline |

The last two are honest limits. They are reported as *warnings* by `verify:integrity`, never asserted
as invariants — an invariant that can be legitimately violated is a false alarm generator, and a
false alarm generator is eventually ignored.

---

## 4. Investments

### 4.1 Phase 5 does not recompute positions. It bounds them by date.

`positions` is **today's** cache. It has no as-of form and must not be given one — it is stamped with
a provenance version and rebuilt inside the mutation's transaction
([ARCHITECTURE.md §6](ARCHITECTURE.md#6-cache-invalidation)), which is a statement about *now*.

For `T = today` the investment contribution is read straight from `positions`:

```
contribution(position p, today) = p.base_cost_basis          -- basis 'cost',  Phase 5
                               or valueHolding(p, quote).baseMarketValue   -- basis 'market', Phase 6
```

For `T < today` it is derived from the lot tables:

```sql
-- investment cost basis in BASE currency, as of T
select l.account_id, l.instrument_id,
       sum(round((l.cost_total - coalesce(d.consumed, 0)) * l.fx_rate_to_base, 4)) as base_cost
  from tax_lots l
  left join lateral (
    select sum(cost_consumed) as consumed
      from lot_disposals
     where lot_id = l.id and closed_on <= :T
  ) d on true
 where l.user_id = :user
   and l.opened_on <= :T
 group by l.account_id, l.instrument_id
```

Three properties make this exact rather than approximate, and each is worth stating because each is a
place a plausible alternative is wrong.

**(a) Money is invariant under corporate actions.** `replay()` leaves `costTotal` and `remainingCost`
untouched by both `split` and `bonus`
(`src/server/domain/lots/engine.ts:420`) — the basis is spread over more or fewer
units and the *derived* per-unit cost changes as a consequence. So a cost-based as-of figure needs no
ratio arithmetic at all. The quantity-based equivalent does, and getting it wrong is the defect N14
records against [INVESTMENT-DOMAIN.md §8.1](INVESTMENT-DOMAIN.md#81-portfolio-growth-over-time).

**(b) The prefix property of FIFO.** The disposals dated `≤ T` in a *full* replay are byte-identical
to those a replay *bounded at* `T` would produce. Under the total order
`(trade_date, kind_rank, created_at, id)`, an event at date `d` depends only on events ordered before
it; appending later events cannot change the prefix. So reading the current cache and bounding by
date is not an approximation of a bounded replay — it **is** one.

**(c) I-20 makes the subtraction exact.** `Σ cost_consumed + remaining_cost = cost_total` holds per
lot over its whole life, unconditionally, because the slice that drains a lot takes `remaining_cost`
verbatim. So `cost_total − Σ(consumed ≤ T)` is the true remaining basis at `T`, with no residue.

At `T = today` the derivation must reproduce `Σ positions.base_cost_basis` exactly. That equality is
invariant **NW-4** and ties the as-of path to the Phase 4 cache — if either drifts, the check fires.

### 4.2 `opened_on`, not `acquired_on` — the transfer trap

A `transfer_in` carries the *original* acquisition date forward so a demat transfer does not reset a
long-term holding to short-term: `tax_lots.acquired_on` may be years before `tax_lots.opened_on`.

As-of eligibility must use **`opened_on`**. Using `acquired_on` would place the destination lot in
the destination account from the original purchase date — while the source account's lot is *also*
still open until its `transfer_out` — and the same value would be counted **twice** for the entire
intervening period. This is the one place in the whole design where a plausible column choice
produces a silent double count, and it earns its own invariant (**NW-3**).

The matched pair is otherwise self-cancelling: at the transfer date the source lot's basis drains to
the disposal (`proceeds = cost_consumed`, realised P&L exactly zero by construction) and the
destination lot opens with the same basis at the same rate. Net worth is unchanged across the pair.

An **unmatched** `transfer_in` — shares gifted in, or an existing holding recorded when the user
started using the app — opens basis with no cash movement, so net worth genuinely rises. That is
correct, and it needs its own bridge line or the bridge will not close
([§7.3](#73-the-change-bridge), N15).

### 4.3 Valuation basis, prices, and what "at cost" means

`instrument_quotes` can already hold prices — `setManualPrice` exists and the Investments pages
render market value with coverage. But `instrument_prices` (the historical series) is empty until
Phase 6, and no provider exists (OD-3).

Consequences:

- **A market-valued net worth for a past date is not computable at all**, because there is no
  historical price. `basis: 'market'` is therefore meaningful only at `T = today`, and only for the
  priced subset.
- [FINANCIAL-DOMAIN.md §9.3](FINANCIAL-DOMAIN.md#93-calculation)'s `Σ marketValue(position) —
  priced holdings only` would today report investments as **₹0** for a user with no manual prices,
  because every holding is unpriced. That is the opposite of ROADMAP's stated Phase 4–6 consequence,
  *"holdings are valued at cost and net worth is an at-cost figure."* One of the two is wrong (N6).

**Recommendation, and it needs approval** — see
[OD-7](#od-7--phase-5-values-investments-at-cost-even-where-a-manual-price-exists):

> Phase 5 computes `basis: 'cost'`. `positions.base_cost_basis` (or its as-of derivation) is the
> investment contribution, coverage for the investment block is `1.0` because cost is always known,
> and the Net Worth page states the basis in one line and links to Investments for the market view.

Zero-quantity and fully-sold positions contribute **nothing** at `basis: 'cost'` —
`remaining_cost = 0` by I-19, so they fall out arithmetically rather than by a filter. They are
retained in `positions` so realised P&L is not lost (edge case 18); net worth simply reads zero from
them.

When Phase 6 arrives, `basis: 'market'` values the priced subset, **excludes** the unpriced with a
named `excluded` list and a coverage ratio below 1.0 (ADR-11, §10.4), and the default flips. The
switch will move net worth for two reasons at once — price movement, and the FX asymmetry in
[§6.3](#63-the-fx-asymmetry-stated-because-it-is-real) — and the release note must say so.

---

## 5. Manual assets and liabilities

### 5.1 Manual assets — the existing model is sufficient, with four corrections

`manual_assets` + `asset_valuations` as specified in [SCHEMA.md §7](SCHEMA.md#7-manual-assets) is the
right model and needs no expansion. Valuations are a **time series, not a field**, which is the same
rule as balances and for the same reason.

```
valuationInForce(asset, T) = the asset_valuations row with the greatest as_of <= T
```

**Eligibility.**

```
eligible(asset, T)  ⇔  startOf(asset) <= T  AND  (disposed_on IS NULL OR disposed_on > T)
startOf(asset)      =  acquired_on ?? (the earliest asset_valuations.as_of)
```

- `disposed_on` is the calculation's input. `is_active` is a UI convenience **derived** from it and
  is never read by a calculation — a flag alone would erase the asset from history the moment it was
  sold ([§9.3](FINANCIAL-DOMAIN.md#93-calculation)).
- An asset **disposed after `T`** is fully present in `netWorth(T)`.
- An asset **acquired after `T`** is absent — not zero.

**An eligible asset with no valuation in force is `excluded`, not zero** (N7). §9.3 currently says it
*"contributes zero and is listed as unvalued"*, which contradicts
[§10.3](FINANCIAL-DOMAIN.md#103-missing-data-propagates-as-null-never-as-zero), §10.4 and golden
scenario **G5**'s own assertion that *nothing is silently zeroed*. Correct behaviour: leave it out of
the total, name it in `excluded`, and reduce asset coverage. A ₹80 lakh flat contributing ₹0 to a
headline figure is a materially wrong number presented as a right one.

**Do manual assets need valuation history?** Yes, and they already have it. Without the series,
`netWorth(T)` for any past `T` would use today's estimate and every historical figure would move
each time the user updated a property valuation. This is not optional and is not a Phase 5 addition —
it is the existing design.

**Four corrections** (details in [§14](#14-defects-found-in-the-baseline-n1n19)): add `user_id` to
`asset_valuations` (N12); make the valuation currency unambiguously the asset's (N11); state the
disposal-proceeds reporting artefact (N18); and add `UNIQUE (user_id, name)` for parity with
`accounts` (N19).

### 5.2 Liabilities — two shapes, discriminated by `linked_account_id`

| Shape | `linked_account_id` | Outstanding at `T` | Contributes to net worth |
|---|---|---|---|
| **Transacted** | set (`UNIQUE`) | `|balance(account, T)|` | **Nothing.** The account contributes, by sign |
| **Scheduled** | `NULL` | latest `liability_balances` row with `as_of <= T` | Yes, as a liability |

This is the double-count guard, and it is worth restating in the strongest form:

> **A `liabilities` row with `linked_account_id` set is metadata.** It carries the name, the kind,
> the interest rate, the EMI and the schedule dates. It carries **no money** into net worth. The
> money is the account's balance, counted once, by sign.

Three enforcement gaps in the current specification:

- **Nothing constrains the linked account's kind (N8).** A liability linked to a `bank` account with
  a positive balance contributes nothing *and* the account contributes as an **asset** — the debt
  disappears. A cross-table rule cannot be a `CHECK`, so it is a service guard plus an integrity
  check (**NW-7**).
- **`ON DELETE SET NULL` silently changes the shape (N9).** Deleting the account converts a
  transacted liability into a scheduled one with no balance rows, which then contributes zero.
  `RESTRICT` is correct; accounts with ledger history already cannot be deleted, so the change costs
  nothing.
- **Closing a scheduled liability needs a terminal zero row (N10).** Under a purely date-driven rule
  `is_active = false` changes nothing, so the last non-zero `liability_balances` row stays in force
  forever. `close` must `INSERT` a final `outstanding = 0` row dated on the closing date. Then a
  closed loan is correctly present in every earlier figure and correctly absent from every later one,
  with no flag involved (**NW-8**).

**Is interest required in Phase 5?** No. `interest_rate`, `emi_amount`, `started_on` and `ends_on`
stay **descriptive only**, exactly as `PROJECT-STATE.md` already carries them. Nothing derives an
amortisation schedule, and the UI must not imply one. The change bridge splits principal from
interest **only where the user recorded both** — i.e. an EMI entered as two transactions, or a
scheduled liability whose new balance row implies the principal portion. Where it cannot, it reports
the liability change as one figure. Building an amortisation engine to split a number the user did
not record would be inventing data.

**Are liabilities transaction-driven or snapshot-driven?** *Both, and never the same one twice.*
Transacted liabilities are transaction-driven through the existing ledger — a repayment is an
ordinary transfer or expense against the linked account, and needs nothing new. Scheduled liabilities
are snapshot-driven through an append-only series, for the case the user genuinely cannot transact:
a loan they only see as a statement figure. There is no third mechanism, and a liability cannot be
both.

---

## 6. Currency and FX

### 6.1 The conversion chain

```
component's own currency
        ↓  rate in force on T  (exact as_of, else most recent earlier, else no_rate)
base currency (settings.base_currency)
```

`selectRate()` in `src/server/domain/fx.ts` already implements the rule and takes
the date as an argument, so Phase 5 needs no new FX logic — only to pass `T` rather than `today`.

| Component | Native currency | Rate used |
|---|---|---|
| Account balance | `accounts.currency_code` (immutable once the account has rows) | `rate(accountCcy → base, T)` |
| Investment cost basis | instrument currency | **each lot's own `fx_rate_to_base`** — never re-rated |
| Investment market value (Phase 6) | instrument currency | `rate(instrumentCcy → base, T)` |
| Manual asset | `manual_assets.currency_code` | `rate(assetCcy → base, T)` |
| Scheduled liability | `liabilities.currency_code` | `rate(liabCcy → base, T)` |

### 6.2 `AccountView.baseBalance` must not be used (N3)

`src/server/services/accounts.ts:223` converts at `ctx.today` regardless of the
`asOf` passed to the same call. The *native* balance honours `asOf`; the base figure does not. A
historical net worth built on `baseBalance` would price 2021's rupee balance at 2026's dollar rate.

Phase 5 therefore takes `AccountView.balance` (native, correct) and converts it itself at `T`. The
Phase 3 defect is recorded rather than fixed inside Phase 5, because no current caller passes `asOf`
and changing a Phase 3 read path is out of Phase 5's scope
([OD-9](#od-9--apply-n1n19-to-the-canonical-documents)).

### 6.3 The FX asymmetry, stated because it is real

The investment block is carried at **acquisition** rates (`tax_lots.fx_rate_to_base`, never revalued
— [INVESTMENT-DOMAIN.md §6.4](INVESTMENT-DOMAIN.md#64-foreign-currency-positions)); every other block
converts at the **as-of** rate. So a base-currency net worth legitimately mixes a historical-rate term
with spot-rate terms.

This is not a defect — re-rating a lot would make last year's cost basis move every morning — but it
has two consequences that must be written down (N17):

1. For a foreign-currency holding, Phase 5's at-cost net worth contains **no unrealised FX**. The
   currency movement appears only when the position is sold, as `base_fx_component` (I-18).
2. When Phase 6 switches the default to `basis: 'market'`, the investment term moves to the spot
   rate. Net worth will change **for FX reasons alone**, independently of any price. That is a basis
   change, and it belongs in the Phase 6 release note, not in a support conversation.

### 6.4 Missing FX

A missing rate does **not** zero a component and does **not** null the whole figure.

```ts
interface NetWorthResult {
  readonly asOf: IsoDate;
  readonly basis: 'cost' | 'market';
  readonly base: CurrencyCode;
  readonly assets: Money;
  readonly liabilities: Money;
  readonly netWorth: Money;
  readonly assetCoverage: Rate;        // converted asset value ÷ total eligible asset value
  readonly liabilityCoverage: Rate;    // the same, for liabilities
  readonly excluded: readonly ExcludedComponent[];  // { ref, side, reason, nativeAmount }
  readonly contributions: readonly Contribution[];
  readonly warnings: readonly NetWorthWarning[];
}
```

**Asset and liability coverage are reported separately, deliberately.** An excluded asset makes net
worth look *lower*; an excluded liability makes it look *higher*. One blended ratio would hide which
direction the figure is wrong in. The UI must show both when either is below 1.0, and the AI tool
result must carry both.

A component whose native value is zero needs no rate and is never excluded for `no_fx_rate`. Coverage
is measured over **value**, not over row count, so one unconverted ₹5 receivable does not read as the
same problem as one unconverted flat.

### 6.5 Rounding

Each component is converted once — `round(native × rate, 4)`, `half_up`, matching the mode the
database `CHECK`s use — and the **already-rounded** base figures are what the map holds and what the
subtotals sum. This is not a violation of *"round at the boundary, never inside an accumulation"*
([§10.2](FINANCIAL-DOMAIN.md#102-rounding)): each conversion is a separate boundary, because each
uses a different rate. Summing unrounded products would mean the displayed component figures did not
add up to the displayed total, which is worse than a fraction of a paisa.

Because the subtotals sum the same rounded values the map holds, `assets − liabilities = Σ map`
**exactly**, with no tolerance. That is invariant **NW-2**.

---

## 7. Historical, as-of, and change attribution

### 7.1 The eligibility table — the normative core of Phase 5

Everything about "net worth as of T" reduces to this table. **Not one row uses a current-state flag.**

| Component | Eligible at `T` when | Value at `T` | Explicitly NOT filtered by |
|---|---|---|---|
| Account | `opening_date <= T` | `opening_balance + Σ entries(booked_on ≤ T) + Σ inv(trade_date ≤ T)` | `accounts.is_active` |
| Investment lot | `opened_on <= T` | `cost_total − Σ disposals(closed_on ≤ T).cost_consumed` | `instruments.is_active`, `positions.quantity`, `acquired_on` |
| Manual asset | `startOf(asset) <= T` and (`disposed_on IS NULL` or `disposed_on > T`) | `valuationInForce(asset, T)` | `manual_assets.is_active` |
| Liability — scheduled | a `liability_balances` row exists with `as_of <= T` | that row's `outstanding` | `liabilities.is_active` |
| Liability — transacted | never eligible in its own right | — | — |
| FX rate | a `fx_rates` row exists with `as_of <= T` | that row's rate | `fetched_at` |
| Price (Phase 6) | an `instrument_prices` row exists with `as_of <= T` | that row's `close` | `instrument_quotes.as_of` |

Every date in that table is a **fact about the entity**, recorded when the event happened.
`is_active` describes an entity *today*; net worth is computed *as of* a date; mixing the two rewrites
history silently, and the series changes shape every time the user tidies up.

### 7.2 The history series is one pass per component, not N point computations

[ARCHITECTURE.md §9](ARCHITECTURE.md#9-performance-targets) budgets 500 ms for a full snapshot at one
date. Sixty month-end points computed pointwise is thirty seconds — unusable, and the reason a
snapshot table looks necessary when it is not.

A series over month-ends `D₁…Dₙ` is **five set-based queries**, none of which loops over dates:

1. **Accounts** — movements bucketed to their month, cumulative `SUM() OVER (PARTITION BY account_id ORDER BY month)`, plus `opening_balance` from the first month where `opening_date <= Dᵢ`.
2. **Investments** — `tax_lots` bucketed by `opened_on`'s month and `lot_disposals` by `closed_on`'s month, each cumulative, then differenced.
3. **Manual assets** — `DISTINCT ON (asset_id, month)` over a cross of eligible assets and month-ends against `asset_valuations`, taking the greatest `as_of <= Dᵢ`.
4. **Liabilities** — the same shape over `liability_balances`.
5. **FX** — one row per `(currency, month-end)`, greatest `as_of <= Dᵢ`.

Then one pure fold in the engine builds a `NetWorthResult` per point, through the **same**
`compose()` the single-date path uses. There is no second implementation of net worth for the chart,
which is what makes the chart's last point provably equal to the headline figure (**NW-9**).

This is why snapshots are recommended out of Phase 5
([OD-8](#od-8--net_worth_snapshots-and-the-networthsnapshot-job-move-to-phase-6)): the performance
problem they exist to solve does not exist once the series is set-based, and a cache that is not
needed is a second source of truth waiting to drift.

### 7.3 The change bridge

For `[t₀, t₁]`, decompose `netWorth(t₁) − netWorth(t₀)` into lines the user can act on. The
decomposition is **derived from the composition**, not invented alongside it — every line corresponds
to a term in [§7.1](#71-the-eligibility-table--the-normative-core-of-phase-5).

Writing `bal_a` for a native balance, `r_a(T)` for its rate, `cost_ℓ` for a lot's remaining basis and
`f_ℓ` for its (fixed) acquisition rate:

```
NW(T) = Σ_a bal_a(T)·r_a(T) + Σ_ℓ cost_ℓ(T)·f_ℓ + Σ_m val_m(T)·r_m(T) − Σ_L out_L(T)·r_L(T)
```

so

```
ΔNW = Σ_a Δbal_a·r_a(t₁)             ← account flows, at the closing rate
    + Σ_a bal_a(t₀)·[r_a(t₁) − r_a(t₀)]   ← FX revaluation of opening balances
    + Σ_ℓ Δcost_ℓ·f_ℓ                ← basis added and consumed
    + (the same two terms for manual assets and liabilities)
```

**The lines**, and where each comes from:

| Line | Definition | Source |
|---|---|---|
| Savings | `income − expenses` over `[t₀,t₁]`, base | `transaction_entries.base_amount` where `transactions.kind ∈ {income, expense}` |
| Investment income | gross dividends + interest received | `investment_transactions`, kinds `dividend`/`interest`, at gross |
| Investment costs | −(fees + taxes paid) | standalone `fee`/`tax` rows plus the withholding inside income rows |
| Realised P&L | `Σ lot_disposals.base_realized_pnl` with `closed_on ∈ [t₀,t₁]` | one indexed scan on `lot_disposals_user_closed_idx` |
| Unrealised investment gain | **`0` by construction at `basis: 'cost'`**, with the basis stated | see below |
| Investment transfers in/out | unmatched `transfer_in` / `transfer_out` basis, at the lot rate | N15 — without this the bridge cannot close |
| Asset revaluation | `Σ (valuationInForce(t₁) − valuationInForce(t₀))` over assets held throughout | `asset_valuations` |
| Asset additions / disposals | valuation at acquisition, and −(valuation in force) at disposal | `manual_assets` |
| Liability change | `−(liabilities(t₁) − liabilities(t₀))`, split into principal and interest **only where recorded** | accounts + `liability_balances` |
| FX effect | opening-balance revaluation **plus** `Σ flows · (r(t₁) − r(booking))` | computed explicitly, never as a plug |
| **Unexplained** | `ΔNW − Σ(above)` | always computed, always shown when non-zero |

Four notes, each a place the obvious version is wrong:

- **`Savings` cannot double-count investment income**, because it sums `transactions`, and investment
  income lives in `investment_transactions`. This is the reason
  [FINANCIAL-DOMAIN.md §8](FINANCIAL-DOMAIN.md#8-cash-flow-calculations) keeps them separate — the
  bridge is the consumer that rule was written for.
- **Buys and sells need no line.** A buy is `−cash + basis = 0`; a sell is `+proceeds − basis =`
  realised P&L, which the Realised P&L line already carries. Adding a "purchases" line would
  double-count.
- **`Unrealised investment gain` is `0` at `basis: 'cost'`** — arithmetically, because
  `Δcost = purchases − consumed` exactly, not because it was skipped. The UI must render it as
  *"not measured — holdings valued at cost"* rather than as `₹0`, which would read as *"the portfolio
  did not move."* Both endpoints of the bridge are on the same basis, so the identity closes exactly
  (N16).
- **`FX effect` is computed, not plugged.** Defining it as the residual would make `unexplained`
  trivially zero and destroy the only assertion in the suite that catches most engine regressions.
  For a single-currency user every term is identically zero and `unexplained` must be **exactly** 0 —
  the documented one-base-unit tolerance is for multi-currency data only.

`Unexplained` is always displayed when it exceeds one base unit. *A bridge that silently balances is a
bridge that is hiding an error.*

---

## 8. Snapshots versus derivation

| | Derived on demand | Snapshot cache |
|---|---|---|
| Historical accuracy | exact, and self-correcting after any edit | correct only until an input changes |
| Rebuildability | nothing to rebuild | needs a job, and a way to know it is stale |
| Correction / replay (G6) | next read is right | every snapshot from the edit date onward is silently wrong |
| Auditability | every figure traces to rows | traces to a row that traces to rows that may have changed |
| Performance | 5 queries per series ([§7.2](#72-the-history-series-is-one-pass-per-component-not-n-point-computations)) | 1 query |

**Recommendation: Phase 5 derives everything, and `net_worth_snapshots` + `networth.snapshot` move to
Phase 6** ([OD-8](#od-8--net_worth_snapshots-and-the-networthsnapshot-job-move-to-phase-6)). Three
reasons:

1. The performance case evaporates once the series is set-based. `CLAUDE.md` and
   [FINANCIAL-DOMAIN.md §3](FINANCIAL-DOMAIN.md#3-accounts) both say to measure before caching.
2. **The stamp is incomplete (N13).** `net_worth_snapshots` records `money_ledger_version` and
   `investment_ledger_version`. It does not record anything covering `asset_valuations`,
   `liability_balances`, `instrument_quotes` or `fx_rates` — so a snapshot can be stale with both
   stamps matching. Shipping it in Phase 5 means shipping a cache that cannot tell when it is wrong.
3. Phase 6 is where the cost genuinely arrives: a market-valued series joins a price per instrument
   per date. That is the right moment to measure, and by then the counter set can be completed.

**If the table ships in Phase 5 anyway**, the rules are non-negotiable:

- The **current** figure is always derived. A snapshot is never read for today.
- A historical point is read from a snapshot **only** when every stamped input version matches;
  otherwise it is derived and the row rewritten.
- `verify:integrity` asserts **snapshot = derivation** for a sample of dates. The cache is then a
  checked artefact rather than a trusted one.
- Stored: `total_assets`, `total_liabilities`, `net_worth`, `breakdown` (group subtotals),
  `price_coverage`, and every input version. Derived, never stored: the contributions map, the
  bridge, and anything that names a row.

Independently of OD-8, Phase 5 should add **`user_state.valuation_version`**, bumped by every write to
`manual_assets`, `asset_valuations`, `liabilities` and `liability_balances`. One column, in the Phase
5 migration rather than a later one, and it is what any future cache — or Phase 6's — will need.

---

## 9. Service and API architecture

**Net Worth is a read-only aggregation service. It opens no ledger and owns no financial mutation.**

```
src/server/services/
  assets.ts        manual assets + valuations   — the only Phase 5 writer of asset data
  liabilities.ts   liabilities + balances       — the only Phase 5 writer of liability data
  networth.ts      READ ONLY. Takes ReadCtx. Has no command and no WriteCtx signature.
                     netWorthAsOf(ctx, T, opts) → NetWorthResult
                     netWorthSeries(ctx, span, periodKind) → NetWorthPoint[]
                     netWorthBridge(ctx, t0, t1) → Bridge
                     reconcile(ctx, T) → Reconciliation

src/server/domain/networth/          PURE — no db handle, no clock
  keys.ts          SourceKey, ContributionMap, add() that throws on a duplicate
  eligibility.ts   eligibleAt(component, T) — one predicate per row of §7.1
  compose.ts       components + rates → NetWorthResult (assets, liabilities, coverage, excluded)
  bridge.ts        two NetWorthResults + period flows → lines + unexplained
  reconcile.ts     independent recomputation by group, and the equality assertion
```

`networth.ts` having **no `WriteCtx` function at all** is the structural claim: net worth cannot
mutate anything, because it has nothing to mutate with. The AI tool layer of Phase 7 can therefore be
handed `get_net_worth` and `get_net_worth_history` with no additional guard —
[FINANCIAL-DOMAIN.md §11](FINANCIAL-DOMAIN.md#11-module-map--services-versus-engine)'s type-level
write boundary already covers it.

**What Net Worth consumes rather than reimplements:**

| Needs | Calls | Never does |
|---|---|---|
| Account balance | `listAccounts(ctx, { includeInactive: true, asOf })` → `deriveBalance()` | re-sum `transaction_entries` |
| Investment value at today | `positions` via `holdings()` / `valuePortfolio()` | re-replay the lot engine |
| Investment value at `T` | the bounded `tax_lots`/`lot_disposals` query in [§4.1](#41-phase-5-does-not-recompute-positions-it-bounds-them-by-date) | rebuild positions on a read |
| Realised P&L in a period | `lot_disposals` by `closed_on` | recompute FIFO |
| Period income / expenses | `cashflow.periodSummary(ctx, range)` | re-classify transactions |
| An FX rate on a date | `ctx.fx.rate(from, to, T)` | interpolate, or default to 1 |

`assets.ts` and `liabilities.ts` follow the established command shape exactly: Zod parse →
`requireOwnership` → `withWriteCtxResult` → insert → `audit.record` → version bump. `withWriteCtxResult`
(D-26) is the right wrapper, so a command that fails after writing rolls back completely.

---

## 10. UI

Lean. Everything authoritative is computed server-side; the page renders `NetWorthResult`.

**`/net-worth` — one screen.**
- Headline: net worth, with the delta against a selectable comparison date (30 d / 1 y / custom).
- Two grouped tables — Assets and Liabilities — with group subtotals and a row per contribution,
  each linking to its source (account ledger, instrument detail, asset detail, liability detail).
- **Basis banner**, one line: *"Investments are valued at cost. Market pricing arrives in Phase 6."*
  Required by the ROADMAP gate.
- **Trade-dated banner** where balances are shown, discharging the ADR-22 carried requirement:
  *"Balances are trade-dated; a broker's cleared cash can differ for up to one settlement cycle."*
  Also owed on the accounts list, the account ledger and the investment ledger's cash column.
- Coverage notice whenever `assetCoverage < 1` or `liabilityCoverage < 1`, naming what was excluded
  and why. Never a silently smaller number.

**`/net-worth/history`** — one line chart plus a month-end table. Gaps render as gaps.

**`/net-worth/change`** — the waterfall table from [§7.3](#73-the-change-bridge): opening, each line, closing,
and `Unexplained` shown whenever it exceeds one base unit. Every row drills through to its records.

**`/net-worth/assets`, `/net-worth/liabilities`** — dense CRUD, with the valuation and balance series
inline. No new top-level navigation item; `CLAUDE.md <primary_navigation>` fixes the six.

**The UI contains no financial calculation.** Not a subtotal, not a percentage, not a currency
conversion. `formatMoney` renders; `NetWorthResult` decides. A page that computed its own subtotal
would be the second implementation §10.5 exists to forbid.

---

## 11. Invariants

Continuing the numbering in [SCHEMA.md §12](SCHEMA.md#12-invariants-summary). **I-8 is restated**
(it was deferred to Phase 5 and is reported as `skipped` by `verify:integrity` today).

| # | Invariant | Domain rule | DB constraint | Test |
|---|---|---|---|---|
| **I-8** | No account is counted twice: every `liabilities` row with `linked_account_id` set contributes **zero**, and no two rows claim one account | [§5.2](#52-liabilities--two-shapes-discriminated-by-linked_account_id) | `UNIQUE (linked_account_id)` | integration + `verify:integrity` + **G4** |
| **NW-1** | The contributions map is injective — no `SourceKey` is inserted twice | [§3.2](#32-the-contributions-map) | — (engine throws) | unit: deliberately duplicate a key and assert the throw |
| **NW-2** | `netWorth = Σ map = assets − liabilities`, computed by two independent paths | [§6.5](#65-rounding) | — | unit + `verify:integrity` |
| **NW-3** | A lot contributes at `T` iff `opened_on <= T` — never `acquired_on` | [§4.2](#42-opened_on-not-acquired_on--the-transfer-trap) | — | integration: a `transfer_in` carrying a 2-year-old `acquired_on` contributes to neither account before its `opened_on` |
| **NW-4** | `investmentCostBasisAsOf(today) = Σ positions.base_cost_basis`, exactly | [§4.1](#41-phase-5-does-not-recompute-positions-it-bounds-them-by-date) | — | `verify:integrity` + property |
| **NW-5** | A `buy` leaves `netWorth(T)` unchanged for every `T ≥ trade_date`; a `sell` changes it by exactly the realised P&L; a `dividend` by exactly the net received | [§3.1](#31-why-the-sum-is-non-overlapping--the-proof-not-the-promise) | — | property test over generated ledgers |
| **NW-6** | No calculation reads `is_active` on `accounts`, `manual_assets`, `liabilities` or `instruments` | [§7.1](#71-the-eligibility-table--the-normative-core-of-phase-5) | — | source scan, like the model-identifier scan in TESTING §7 |
| **NW-7** | `liabilities.linked_account_id` references an account of kind `credit_card` or `loan` | [§5.2](#52-liabilities--two-shapes-discriminated-by-linked_account_id) | cross-table → service guard | integration + `verify:integrity` |
| **NW-8** | Every inactive scheduled liability has a terminal `liability_balances` row with `outstanding = 0` | [§5.2](#52-liabilities--two-shapes-discriminated-by-linked_account_id) | — | integration + `verify:integrity` |
| **NW-9** | The last point of `netWorthSeries` equals `netWorthAsOf(today)`, byte-identical | [§7.2](#72-the-history-series-is-one-pass-per-component-not-n-point-computations) | — | integration |
| **NW-10** | The bridge closes: `ΔNW − Σ lines = 0` **exactly** for single-currency data, and within one base unit with FX | [§7.3](#73-the-change-bridge) | — | every golden scenario |
| **NW-11** | `asset_valuations.currency_code = manual_assets.currency_code`; likewise for liabilities | [§5.1](#51-manual-assets--the-existing-model-is-sufficient-with-four-corrections) | cross-table → service guard, or drop the column | integration + `verify:integrity` |
| **NW-12** | An account contributes at `T` iff `opening_date <= T` | [§2.3](#23-historical-eligibility--the-account-lifecycle-rule) | — | integration + property |
| **NW-13** | Every row read by a net-worth query is the session user's | [§9](#9-service-and-api-architecture) | `user_id` columns | integration: a second user's data is invisible |

### Explicit non-invariants

Stated because each is intuitive, will be assumed, and is **false**. `verify:integrity` must not
assert them.

| Relation | Why it fails |
|---|---|
| `positions.quantity > 0` ⟺ the position contributes at `T` | A position sold to zero today still had value at earlier dates; a lot opened after `T` contributes nothing at `T`. Quantity is a *today* fact. |
| `Σ liability_balances.outstanding` over active liabilities = total liabilities | Transacted liabilities take their figure from the account and contribute **zero** through `liability_balances`. |
| `assets(T)` = `Σ balance(a,T)` over accounts with a positive balance | True only before any manual asset or investment exists. |
| `netWorth` is monotone in `T` | Obviously false, and stated so no series-smoothing "fix" is ever attempted. |
| A snapshot with matching ledger versions is current | Prices, FX rates, valuations and liability balances are not covered by either counter (N13). |

---

## 12. Adversarial edge-case results

All 35 scenarios from the review brief, with the expected economic result and the mechanism that
produces it. Each becomes a named test.

| # | Scenario | Expected result | Mechanism / risk |
|---|---|---|---|
| 1 | Empty system | `netWorth = 0`, coverage `1.0`, **not** `null` | Empty is fully covered — nothing was left out. Matches `valuePortfolio`'s empty case |
| 2 | Cash only | `= Σ balances` | Sign-based classification |
| 3 | Investments only | `= Σ base_cost_basis` at `basis:'cost'` | §4.1 |
| 4 | Cash + investments | the sum of both, no interaction | disjoint source keys |
| 5 | Brokerage cash + securities | `cash + basis`, never `cash + basis + cash` | §3.1 — the ledger, not a subtraction |
| 6 | Buy | **ΔNW = 0** | NW-5. Same-currency case exact; cross-currency differs only by the two rates |
| 7 | Sell | ΔNW = realised P&L | NW-5 |
| 8 | Dividend | ΔNW = net received (`gross − fees − taxes`) | I-12; bridge splits it into income and costs |
| 9 | Transfer into brokerage | ΔNW = 0 | both legs are accounts; Σ Δbalance = 0 |
| 10 | Transfer out of brokerage | ΔNW = 0 | same |
| 11 | Foreign-currency account | balance native, converted at `rate(ccy→base, T)` | §6.1; missing rate → excluded, not zero |
| 12 | Foreign-currency investment | basis at **lot acquisition** rates, not `T`'s | §6.3 — no unrealised FX at cost, by design |
| 13 | Multiple currencies | each component converted independently, summed after rounding | §6.5 |
| 14 | Missing FX rate | that component `excluded`, coverage < 1 on **its own side**, named | §6.4. Never zero, never a whole-figure `null` |
| 15 | Missing historical price | irrelevant at `basis:'cost'`; at `'market'` the holding is excluded with `no_price` | Phase 6 |
| 16 | Closed account | still contributes its balance on `T`; contributes `0` once emptied | NW-6 — `is_active` unread |
| 17 | Account closed **after** `T` | fully present at `T` | §2.3 |
| 18 | Account created **after** `T` | **absent**, opening balance included | **N2** — the highest-value fix in this review |
| 19 | Manual asset disposed | absent from `T ≥ disposed_on` | `disposed_on` is a date, not a flag |
| 20 | Manual asset disposed **after** `T` | fully present at `T`, at its valuation in force | §5.1 |
| 21 | Liability with payments | transacted → the account balance rises toward zero; scheduled → a new `liability_balances` row | §5.2; never both |
| 22 | Zero-value position | contributes `0`; retained in `positions` for realised P&L | falls out arithmetically (I-19), not by a filter |
| 23 | Fully sold position | contributes `0`; its P&L is in the bridge's Realised line | edge case 18 |
| 24 | Same-day transactions | order-independent | every bound is `≤ date`; FIFO order within a day is already fixed by `kind_rank` |
| 25 | Corrected / replayed ledger | the next read is correct; **no snapshot to invalidate** | the strongest argument for OD-8; **G6** |
| 26 | Rebuilt positions | identical net worth before and after `rebuildAllPositions` | rebuild is byte-identical (Phase 4 property) |
| 27 | Historical NW before / after a purchase | before: cash. after: cash − X + basis X. Equal | NW-5 |
| 28 | Historical NW before / after a disposal | before: asset at valuation. after: cash at proceeds. Δ = gain | §5.1; and see N18 on the savings-rate artefact |
| 29 | Transfer between two owned accounts | ΔNW = 0 same-currency; = the FX residual cross-currency | the residual is the bridge's FX line, never income |
| 30 | Brokerage cash → investment position | ΔNW = 0 | the brief's central case; §3.1 |
| 31 | Partial FX data | converted components counted, others excluded, coverage per side | §6.4 |
| 32 | Negative net worth | reported as negative | no `abs()` anywhere on the total |
| 33 | Large values / precision | exact to `NUMERIC(20,4)`; `Money` is bigint throughout | no float on any path |
| 34 | User isolation | a second user's rows are invisible | `user_id` filtered from the session; NW-13; needs N12's added columns |
| 35 | Double counting of brokerage cash | impossible | ledger coupling + the map's duplicate-key throw |

**Additional cases surfaced by this review**, not in the brief:

| # | Scenario | Expected result |
|---|---|---|
| 36 | Overpaid credit card (balance `> 0`) | counted as an **asset** at `+balance` | N1 — currently vanishes, or is reported as a debt |
| 37 | Overdrawn bank account | counted as a **liability** at `|balance|` | N1 |
| 38 | Unmatched `transfer_in` (gifted or migrated shares) | net worth **rises** by the lot's basis; the bridge carries it on its own line | N15 |
| 39 | `transfer_in` whose `acquired_on` predates `opened_on` by years | contributes only from `opened_on` | **NW-3** — the silent-double-count trap |
| 40 | Manual asset with no valuation in force at `T`, but eligible | **excluded**, named, coverage reduced — not zero | N7; **G5** already asserts nothing is silently zeroed |
| 41 | Scheduled liability closed with no terminal zero row | its last balance would stay in force forever | NW-8 — `close` must write the zero row |
| 42 | Liability linked to a `bank` account | rejected at creation | NW-7 — otherwise the debt disappears |
| 43 | Fixed deposit modelled as an instrument with a manual price | in net worth throughout at cost until Phase 6 | INVESTMENT-DOMAIN §12 case 20 |

---

## 13. Test strategy

Following [TESTING.md](TESTING.md)'s layering. Net worth is **priority 5** in its ordering, behind
`Money`, the lot engine, transaction invariants and account balance — all of which now exist.

**Unit (pure, no database).** `ContributionMap` duplicate-key throw; `eligibleAt` for every row of
§7.1 at `T` before / on / after each boundary date; `compose()` on hand-built components including
the empty case, the all-excluded case and the negative-net-worth case; `bridge()` on hand-built
endpoints with `unexplained` asserted **exactly zero**; per-side coverage arithmetic.

**Property (fast-check).**
- `∀ ledgers, ∀ T` : `netWorth(T)` is independent of the order rows were entered.
- `∀ buy` : `netWorth(T)` unchanged for every `T ≥ trade_date` (NW-5).
- `∀ sell` : `ΔnetWorth` = realised P&L exactly.
- `∀ T` : `assets(T) − liabilities(T) = Σ map(T)` (NW-2), with no tolerance.
- `∀ T ≤ today` : `investmentCostBasisAsOf(T)` computed from the cache equals a bounded `replay()` of
  the same ledger (the prefix property in [§4.1](#41-phase-5-does-not-recompute-positions-it-bounds-them-by-date)).

**Integration (real Postgres).** The eligibility table, row by row, with an account, an asset, a
liability and a lot each crossing `T`; N2's account-created-after-`T` case as an explicit regression;
`includeInactive` omitted must be caught by NW-6's source scan rather than by a reviewer;
`verify:integrity` fails on a deliberately corrupted database (a liability linked to a bank account, a
duplicate source key, a closed liability with no zero row); user isolation.

**Golden.** **G4 — Debt and liabilities** is the Phase 5 gate: a home loan with EMIs, a credit card
carrying a balance, a car loan closed mid-period. Asserts liability totals, no double counting, and
the principal/interest split where recorded. **G1** gains its net-worth series assertions. Every
golden scenario asserts `unexplained` — exactly `0` where single-currency, within one base unit
otherwise (NW-10).

**Deferred to Phase 6, deliberately:** G3 (multi-currency valuation) and G5 (sparse data) both need
prices. Phase 5 asserts the `basis:'cost'` behaviour they will later extend.

---

## 14. Defects found in the baseline (N1–N19)

Found by this review against the current canonical documents and the Phase 3/4 implementation.
**None is a live bug today** — no caller passes `asOf`, and Phase 5's tables do not exist — which is
precisely why they survived four phases and four completion gates.

Applying these to the canonical documents requires approval
([OD-9](#od-9--apply-n1n19-to-the-canonical-documents)), following the OD-4 precedent.

| # | Severity | Defect | Where | Correction |
|---|---|---|---|---|
| **N1** | High | §9.3 classifies accounts by **kind**: an overpaid credit card is in neither term and vanishes; an overdrawn bank account is misclassified as a negative asset. `accountRole()` classifies a card as a liability regardless of sign, so a calculator using it plus `abs()` reports an overpayment as a debt | `FINANCIAL-DOMAIN.md` §3 + §9.3; `domain/ledger/balance.ts:88` | Classify by **sign**. Kind decides the display group and the expected sign only |
| **N2** | **High** | The as-of balance adds `opening_balance` unconditionally, so an account contributes its opening balance to dates **before it existed** | `domain/ledger/balance.ts:35`, `services/accounts.ts:220` | Eligibility predicate `opening_date <= T`; the account is **absent**, not zero |
| **N3** | High | `AccountView.baseBalance` converts at `ctx.today` even when `asOf` was supplied — the native figure honours the date, the base figure does not | `services/accounts.ts:223` | Phase 5 converts from `balance` itself at `T`; record the Phase 3 defect |
| **N4** | High | `listAccounts` excludes inactive accounts by default, so a historical figure written against the default silently drops every closed account | `services/accounts.ts:96` | Phase 5 must pass `includeInactive: true`; NW-6 asserts no calculation reads the flag |
| **N5** | High | There is no as-of position, and `positions` must not be given one | `services/portfolio.ts`, `services/positions.ts` | Derive from `tax_lots`/`lot_disposals` bounded by date; NW-4 ties it to the cache |
| **N6** | **High** | §9.3's *"Σ marketValue — priced holdings only"* reports investments as **₹0** in the current price-free state, contradicting ROADMAP's *"net worth is an at-cost figure"* | `FINANCIAL-DOMAIN.md` §9.3 vs `ROADMAP.md` | Declare `basis`; Phase 5 is `'cost'`; Phase 6 adds `'market'` with coverage — see **OD-7** |
| **N7** | High | §9.3 says an unvalued manual asset *"contributes zero"*, contradicting §10.3, §10.4 and **G5**'s *"nothing silently zeroed"* | `FINANCIAL-DOMAIN.md` §9.3 | Exclude it, name it, reduce coverage |
| **N8** | Medium | Nothing constrains `linked_account_id` to a `credit_card`/`loan` account — a link to a bank account makes the debt disappear | `SCHEMA.md` §8 | Service guard + NW-7 |
| **N9** | Medium | `linked_account_id ON DELETE SET NULL` silently converts a transacted liability into a scheduled one that then contributes zero | `SCHEMA.md` §8 | `RESTRICT` |
| **N10** | Medium | Closing a scheduled liability by flag alone leaves its last non-zero balance in force forever under a date-driven rule | `FINANCIAL-DOMAIN.md` §9.4 | `close` writes a terminal `outstanding = 0` row; NW-8 |
| **N11** | Medium | `asset_valuations.currency_code` / `liability_balances.currency_code` may disagree with the parent's currency; nothing prevents it | `SCHEMA.md` §7, §8 | Drop the column (it is the parent's fact), or guard it; NW-11 |
| **N12** | Medium | `asset_valuations` and `liability_balances` carry no `user_id`, against SCHEMA.md's own convention and the `lot_disposals` precedent set by the Phase 4 review | `SCHEMA.md` §7, §8 | Add `user_id`, with the index |
| **N13** | Medium | `net_worth_snapshots` stamps only the two ledger counters — nothing covers `asset_valuations`, `liability_balances`, `instrument_quotes` or `fx_rates`, so a snapshot can be stale with matching stamps | `SCHEMA.md` §9, `ARCHITECTURE.md` §6 | Add `user_state.valuation_version`; and see **OD-8** |
| **N14** | Medium | §8.1's `quantityHeldOn` as *"a running sum over the ledger"* is wrong for any instrument with a split or bonus — those rows carry `quantity IS NULL` and a ratio | `INVESTMENT-DOMAIN.md` §8.1 | Phase 6: apply the cumulative ratio, or replay bounded. Phase 5 is unaffected — cost is ratio-invariant |
| **N15** | Low | The bridge has no line for an unmatched `transfer_in`/`transfer_out`, which moves net worth with no cash movement — so the bridge cannot close | `FINANCIAL-DOMAIN.md` §9 | Add the line |
| **N16** | Low | The bridge's `Investment gains/losses` line is undefined at cost basis | `FINANCIAL-DOMAIN.md` §9 | `0` by construction, with the basis stated; rendered as *"not measured"*, never as `₹0` |
| **N17** | Low | The FX asymmetry — investments at acquisition rates, everything else at the as-of rate — is real, intentional and **unstated** | `FINANCIAL-DOMAIN.md` §9.3 | State it, and note that Phase 6's basis switch moves net worth for FX reasons alone |
| **N18** | Low | Disposing a manual asset by recording the proceeds as ordinary income inflates `income` and the savings rate | `FINANCIAL-DOMAIN.md` §9.4 | Seed an `Other Income → Asset sale proceeds` category and state the artefact; a structural fix is deferred |
| **N19** | Low | `manual_assets` and `liabilities` have no `UNIQUE (user_id, name)`, unlike `accounts` | `SCHEMA.md` §7, §8 | Add it |

---

## 15. Schema delta proposal

**Not implemented. No migration is written.** `0003_phase5_net_worth.sql` is Phase 5 implementation
work, and this section is its specification.

Everything below is **additive**. No existing column is dropped or narrowed, so the down migration is
a clean reverse ([D-13](../PROJECT-STATE.md)).

### 15.1 New enums

```sql
CREATE TYPE manual_asset_kind AS ENUM
  ('property','vehicle','gold_physical','collectible','receivable','other');
CREATE TYPE liability_kind AS ENUM
  ('home_loan','auto_loan','personal_loan','student_loan','credit_card','other');
```

Both are already specified in `SCHEMA.md` §7–8 and unchanged.

### 15.2 `manual_assets` — authoritative

As `SCHEMA.md` §7, plus:

| Change | Why | Historical implication |
|---|---|---|
| `UNIQUE (user_id, name)` | parity with `accounts`; two "Flat" rows are almost always a duplicate entry (N19) | none |
| index `(user_id, disposed_on)` | every as-of query filters on it | none |
| keep `disposed_on` **and** `is_active` | `disposed_on` is the calculation's input; `is_active` is a UI convenience derived from it | the flag must never enter a query |

### 15.3 `asset_valuations` — authoritative, append-only

As `SCHEMA.md` §7, plus:

| Change | Why | Authoritative or derived |
|---|---|---|
| **add `user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`** | SCHEMA.md's own convention; the `lot_disposals` precedent; without it every as-of query joins through the parent to establish ownership (N12) | authoritative |
| **drop `currency_code`** | it is the asset's currency, and a stored duplicate is a second figure free to drift (N11). If retained instead, it needs a service guard and NW-11 | — |
| index `(user_id, asset_id, as_of DESC)` | `valuationInForce` is *"greatest `as_of <= T`"* — this is the index that makes it a seek | — |
| existing `UNIQUE (asset_id, as_of)` | one valuation per asset per day (edge case 24) | — |

**No `UPDATE` path.** Revaluing inserts; the service exposes no update, and correcting a wrong
valuation is a delete-plus-insert that the audit log records in full.

### 15.4 `liabilities` — authoritative

As `SCHEMA.md` §8, plus:

| Change | Why |
|---|---|
| `linked_account_id … ON DELETE **RESTRICT**` | `SET NULL` silently changes the liability's shape (N9) |
| `UNIQUE (user_id, name)` | N19 |
| index `(user_id, is_active)` | list views only — never a calculation |
| **no** kind `CHECK` on the linked account | cross-table; enforced by a service guard and NW-7 (N8) |

`interest_rate`, `emi_amount`, `started_on`, `ends_on` remain **descriptive**. No column implies a
computed schedule, and none is added.

### 15.5 `liability_balances` — authoritative, append-only

As `SCHEMA.md` §8, plus the same two changes as `asset_valuations`: add `user_id`, drop the redundant
`currency_code`, and index `(user_id, liability_id, as_of DESC)`.

### 15.6 `user_state.valuation_version`

```sql
ALTER TABLE user_state ADD COLUMN valuation_version bigint NOT NULL DEFAULT 0;
```

Bumped by every write to `manual_assets`, `asset_valuations`, `liabilities`, `liability_balances`.
One column, in this migration rather than a later one, and it is the counter N13 shows is missing.

### 15.7 `net_worth_snapshots` — **derived cache, recommended out of Phase 5**

See [OD-8](#od-8--net_worth_snapshots-and-the-networthsnapshot-job-move-to-phase-6). If it ships
anyway, it needs `valuation_version` added to its stamp set and the four rules in
[§8](#8-snapshots-versus-derivation) enforced — in particular `verify:integrity` asserting
**snapshot = derivation**.

### 15.8 What is deliberately **not** added

| Not added | Why |
|---|---|
| `accounts.current_balance` | ADR-05; balances are derived, permanently |
| `manual_assets.current_value` | it is `valuationInForce(asset, today)` — a stored derivation is a second figure |
| `liabilities.outstanding` | same |
| A `net_worth` column anywhere | derived, always |
| An amortisation-schedule table | nothing computes one; `CLAUDE.md <feature_scope>` excludes a lending platform |
| A `net_worth_components` table | the contributions map is derived per request and is never stored |
| An "asset category" table | `manual_asset_kind` covers it; a user-editable taxonomy is unjustified at one user |

---

## 16. Boundaries with other phases

| | Phase 5 owns | Phase 5 does **not** |
|---|---|---|
| **Phase 4 — Investments** | reading `positions`, `tax_lots`, `lot_disposals`; bounding them by date | recompute cost basis, re-replay the lot engine, or write to any investment table |
| **Phase 6 — Market Data** | the `basis` parameter and the `'cost'` implementation; the `excluded`/coverage shape prices will flow into | implement `MarketDataProvider`, any adapter, `prices.refresh`, or historical price fetching. **Net worth may consume prices; it must not fetch them** |
| **Phase 7–9 — AI** | `netWorthAsOf` / `netWorthSeries` as the only implementation the tools can call | expose a write path. `networth.ts` has no `WriteCtx` signature, so `get_net_worth` **cannot** mutate — the guarantee is structural, not procedural. **AI is never authoritative for a net-worth figure** |
| **Phase 10 — UX** | the functional Net Worth pages | the Overview net-worth strip, insight rules, or the performance pass |
| **Phase 11 — Security** | `user_id` on every new table; ownership guards | the audit sweep |

**Intentionally deferred, with the criterion for revisiting each:**

| Deferred | Revisit when |
|---|---|
| Market-value net worth | Phase 6, once a price source exists (OD-3) |
| Unrealised FX separated from unrealised price movement | a screen consumes it; needs a per-lot revaluation ([INVESTMENT-DOMAIN.md §6.4](INVESTMENT-DOMAIN.md#64-foreign-currency-positions)) |
| Amortisation schedules; a principal/interest split the user did not record | the user asks; today it would be invented data |
| Net-worth goals, projections, forecasting | `CLAUDE.md <feature_scope>` — not requested |
| Snapshot caching | measurement shows the derived series misses its target |
| Structural handling of manual-asset disposal proceeds (N18) | the savings-rate artefact proves annoying in real use |
| A structural guard against physical gold duplicating a gold instrument | it cannot be built; the warning stays a warning |

---

## 17. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **A calculation reads `is_active`** — the single easiest mistake, because the flag is right there on every row and the default argument hides it | high | silently wrong history, and the series changes shape as the user tidies up | NW-6 as a **source scan**, not a code review — the same mechanism TESTING §7 uses for model identifiers |
| **N2 ships uncaught** — the opening balance is not a movement, so a date bound on movements looks complete | medium | every historical figure before an account's creation is wrong by its opening balance | an explicit regression test named for the defect; case 18 |
| The bridge's FX line is quietly defined as the residual | medium | `unexplained` becomes trivially zero and the suite's single best regression detector dies | NW-10 asserts **exactly** zero on single-currency data, where a residual definition and a computed one are indistinguishable unless the computation is real |
| The at-cost basis is mistaken for a market valuation by the user | medium | a wrong impression of wealth | the basis banner is a ROADMAP gate, not a nicety |
| Snapshots ship and go stale behind matching version stamps | medium (if OD-8 is declined) | a confidently wrong historical figure | derive-only; or the four rules in §8 plus a snapshot-equals-derivation check |
| The history series is built pointwise | medium | 30 s page load, then a snapshot table added to "fix" it — a cache introduced to paper over a query shape | §7.2's five-query design, with the target asserted in a test |
| `manual_assets` grows toward a valuation-workflow subsystem | low | scope creep into a phase nobody reviewed | §15.8's explicit not-added list |
| Phase 6's basis switch moves net worth for FX reasons alone and reads as a bug | low | lost confidence | N17 stated now, in the release note then |

---

## 18. Open decisions

### OD-7 — Phase 5 values investments **at cost**, even where a manual price exists

`setManualPrice` already exists, so a user can price a holding today, and the Investments pages
already show market value with coverage. If Net Worth values the same holdings at cost, **two pages
report two different numbers for the same securities.**

**Recommended:** yes, `basis: 'cost'` — it is ROADMAP's stated Phase 4–6 consequence and the Phase 5
gate already requires the UI to say so. A partial market valuation would be a total in no basis at
all: part market, part cost, with no way to state what the number means. The Net Worth page states
the basis in one line and links to Investments for the market view.

**Alternatives:** (b) market where priced, **excluded** where not, per ADR-11 — honest, but reports
investments as ₹0 for a user with no manual prices; (c) market where priced, cost where not — one
number, two bases, unstateable; (d) a user-visible basis toggle in Phase 5 rather than Phase 6 —
small, and it removes the two-pages problem entirely.

**Blocks:** the meaning of the Phase 5 headline figure, and Phase 5's UI copy.

### OD-8 — `net_worth_snapshots` and the `networth.snapshot` job move to Phase 6

**Recommended:** yes. Phase 5 derives everything. The performance case for the cache disappears once
the history series is set-based ([§7.2](#72-the-history-series-is-one-pass-per-component-not-n-point-computations)),
and the cache as currently specified **cannot tell when it is stale** — its stamp covers neither
valuations, nor liability balances, nor prices, nor FX (N13). Phase 6 is where a market-valued series
makes the cost real and where the measurement can be made against real data.

This removes two items from the Phase 5 "Done when" list (`networth.snapshot` job; *"snapshot job is
idempotent"*), which is why it needs approval rather than being taken as an implementation decision.

**Alternative:** ship it in Phase 5 under the four rules in [§8](#8-snapshots-versus-derivation) —
current is always derived, historical reads require a full version match, `verify:integrity` asserts
snapshot = derivation, and `valuation_version` is added to the stamp set.

**Blocks:** the Phase 5 schema delta and two ROADMAP gates.

### OD-9 — Apply N1–N19 to the canonical documents

The Phase 4 review found 15 defects and applied them under **OD-4** before implementation started.
This review found 19 in the same way, two of them material (N2, N6), and one of them — N1 — a live
disagreement between `FINANCIAL-DOMAIN.md` §3 and `domain/ledger/balance.ts`.

**Recommended:** yes, apply them to `FINANCIAL-DOMAIN.md`, `SCHEMA.md`, `INVESTMENT-DOMAIN.md` and
`ARCHITECTURE.md` **before** Phase 5 implementation begins, so the implementation baseline is
corrected rather than worked around. No application code or schema changes as part of the
correction pass. The one code change implied — `accountRole()`'s kind-first classification (N1) — is
Phase 5 implementation work, not part of the documentation pass, and is listed in the gates below.

**Blocks:** Phase 5 implementation start. Implementing against documents known to contain N2 and N6
would put the defects in the code.

---

## 19. Phase 5 implementation gates

Phase 5 is complete only when **every** box is ticked. The first four are new; the rest carry forward
from `ROADMAP.md` Phase 5.

**Preconditions**
- [ ] OD-7, OD-8 and OD-9 are decided
- [ ] If OD-9 is approved: the canonical documents carry N1–N19, and the cross-document link check passes

**Correctness**
- [ ] `accountRole()` classifies by **sign**; an overpaid credit card is an asset and an overdrawn bank account is a liability, each asserted (N1)
- [ ] An account created after the requested `asOf` contributes **nothing**, including its opening balance — asserted by a test named for N2
- [ ] No calculation reads `is_active` on `accounts`, `manual_assets`, `liabilities` or `instruments` — asserted by a **source scan** (NW-6)
- [ ] `investmentCostBasisAsOf(today)` equals `Σ positions.base_cost_basis` exactly (NW-4)
- [ ] A `transfer_in` carrying an `acquired_on` years before its `opened_on` contributes to neither account before `opened_on` (NW-3)
- [ ] The double-counting guard throws on a duplicated source key — tested by deliberately duplicating one
- [ ] A credit-card account also present as a `liabilities` row is caught (I-8)
- [ ] A liability linked to a non-`credit_card`/`loan` account is rejected (NW-7)
- [ ] A closed scheduled liability has a terminal zero balance row (NW-8)
- [ ] Net worth on a past date uses the valuation in force on that date
- [ ] An eligible manual asset with no valuation in force is **excluded and named**, never zeroed (N7)
- [ ] Asset and liability coverage are reported **separately** and shown whenever either is below 1.0
- [ ] `unexplained` is **exactly** zero on single-currency golden scenarios, and within one base unit otherwise (NW-10)
- [ ] The last point of the history series is byte-identical to `netWorthAsOf(today)` (NW-9)

**Scope and structure**
- [ ] `networth.ts` exports **no** function taking a `WriteCtx` — asserted by a type-level test
- [ ] Net worth calls `deriveBalance`, `cashflow`, `ctx.fx` and the lot tables; it re-implements none of them
- [ ] The UI contains no subtotal, percentage or currency conversion of its own

**Integrity and tests**
- [ ] `verify:integrity` reports **I-8 passing** rather than `skipped`, plus NW-2, NW-4, NW-7, NW-8, NW-11, NW-13
- [ ] Every scenario in [§12](#12-adversarial-edge-case-results) — 1–43 — is a named test
- [ ] Golden scenario **G4** passes; **G1** gains its net-worth series assertions
- [ ] If OD-8 is declined: the snapshot job is idempotent, and `verify:integrity` asserts snapshot = derivation

**UI**
- [ ] The Net Worth page states that investments are valued at cost until Phase 6
- [ ] Balances derived from the investment ledger are marked **trade-dated** — on the accounts list, the account ledger, the investment ledger's cash column, and Net Worth ([ADR-22](DECISIONS.md#adr-22--financial-recognition-is-trade-dated-settlement_date-is-informational-metadata)'s carried requirement)

**Quality**
- [ ] A full-series render meets [ARCHITECTURE.md §9](ARCHITECTURE.md#9-performance-targets), asserted rather than assumed
- [ ] `typecheck`, `lint` and `build` pass; every Phase 3 and Phase 4 test still passes
