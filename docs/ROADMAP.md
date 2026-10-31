# Development Roadmap

Canonical phase map: **`Workflow Setup.txt`, Phases 0–14** ([ADR-20](DECISIONS.md#adr-20--workflow-setuptxt-is-the-canonical-phase-map)).

Ordering principle: the financial engine is built and tested before any UI depends on it, and the AI is built after every number it can read is already correct.

A phase is complete only when every box is ticked — including tests, type check, lint, and a passing production build (`CLAUDE.md <testing_standard>`).

**The architecture in `docs/` is the implementation baseline** (approved 2026-08-09). Every phase from 2 onward follows the working protocol in [PROJECT-STATE.md](../PROJECT-STATE.md): read the relevant docs → inspect existing code → identify dependencies → implement **only this phase** → test → fix → verify the real workflow → update docs only on a material change.

**A discovered architectural problem is a stop-and-explain event, not an implementation decision.** Redesigning mid-phase is how a reviewed architecture silently becomes an unreviewed one.

---

## Where the project stands — Phase 5 checkpoint, 2026-08-15

| Phase | Status |
|---|---|
| 0 — Environment & Repository | ✅ complete |
| 1 — Architecture | ✅ complete, **approved** |
| 2 — Foundation | ✅ complete, verified |
| 3 — Financial Core | ✅ complete, verified |
| 4 — Investment Engine | ✅ **complete, verified** |
| 5 — Net Worth at Cost | ✅ **complete, verified** |
| 6 — Market Data | not started — **next** (OD-3 affects completion, not start) |
| 7 — AI Infrastructure | not started; **blocked** on OD-1 (`NVIDIA_API_KEY`) |
| 8–14 | not started |

**1,049 tests pass** — 617 unit, 56 property, 376 integration. Typecheck, lint and the production build are clean; `verify:integrity` reports 27 passing, 0 failing, 8 enforced by the engine and 2 deferred to Phase 9. **Signed-in browser verification passed**, finding and fixing two display defects. The per-gate results and decisions D-24…D-32 are recorded in [PROJECT-STATE.md](../PROJECT-STATE.md).

---

## A consequence of this ordering, stated up front

Market Data is **Phase 6**, after Investments (4) and Net Worth (5). That is deliberate and correct — cost basis, realised P&L, and the lot engine need no prices at all — but it has a visible consequence:

> **Between Phases 4 and 6, holdings are valued at cost, and the Phase 5 figure is "Net Worth at Cost".**

Unrealised P&L, portfolio return, XIRR, TWR, and market-value allocation are **not computable** until Phase 6. Phase 5 therefore ships with those metrics returning `null` with reason `no_price` — which is exactly the behaviour the engine contract requires ([FINANCIAL-DOMAIN.md §10.3](FINANCIAL-DOMAIN.md#103-missing-data-propagates-as-null-never-as-zero)), and it means the missing-price path is exercised for real before any provider exists.

This is a **declared valuation basis**, not a temporary approximation ([ADR-23](DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost)): the investment contribution is the exact Phase 4 cost basis, market value and cost are never mixed inside one figure, and the UI says "valued at cost — market pricing arrives in Phase 6" rather than showing a number that looks like a market valuation. Phase 6 adds `basis: 'market'` as a **distinct** calculation; the default stays `cost` ([ADR-32](DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view)).

---

## Phase 0 — Environment & Repository ✅ complete

- [x] Project directory, operating environment, runtimes, package managers inspected
- [x] Source files, dependencies, git state, database/deployment tooling surveyed
- [x] Environment variables and configuration files inspected
- [x] Constraints identified (see [ARCHITECTURE.md](ARCHITECTURE.md), Phase 0 report)
- [x] NVIDIA Build reachability confirmed; candidate model list checked against the live catalogue

---

## Phase 1 — Architecture ✅ complete

- [x] Application, repository, and database architecture
- [x] Financial, investment, and net-worth domain models
- [x] Financial calculation engine contract
- [x] Market-data abstraction
- [x] AI orchestration, NVIDIA Build integration, routing, fallback, evaluation framework, tool architecture, security boundary
- [x] Authentication architecture
- [x] UI information architecture
- [x] Testing, deployment, and backup/restore architecture
- [x] `docs/` written; decisions and rejected alternatives recorded in [DECISIONS.md](DECISIONS.md)

**OD-1 closed** once `NVIDIA_API_KEY` was configured (step 7.7). Phase 7 is complete as of 2026-10-26 — see the Phase 7 "Done when" list and [RECOVERY-2026-10.md](RECOVERY-2026-10.md).

---

## Phase 2 — Foundation ✅ complete

Skeleton, exact-money primitives, database, auth, test harness. **No features.**

- `git init`, `.gitignore`, `.gitattributes` (`* text=auto eol=lf`), `core.autocrlf=input`, rename `Claude.md` → `CLAUDE.md`
- Next.js 16 + TypeScript strict + Tailwind 4; ESLint with import-boundary and secret-prefix rules
- `src/lib/decimal/` — `Money`, `Quantity`, `Rate`, rounding, `allocate`
- `src/lib/env.ts` (Zod-validated), `src/lib/date/`
- Drizzle: `users`, `sessions`, `auth_events`, `currencies`, `fx_rates`, `settings`, `user_state`, `audit_log`, `jobs`; first migration; idempotent seed
- Auth: Argon2id, TOTP, recovery codes, opaque sessions, `requireSession()`, lockout, rate limiting
- App shell: navigation, layout, empty states for all six areas; security headers and CSP
- Vitest + fast-check + integration harness; CI pipeline

**Done when**
- [x] `Money` fully covered including both-sign rounding boundaries and the `NUMERIC(20,4)` limit
- [x] Property tests pass: associativity, commutativity, `allocate` sums back exactly, DB round-trip
- [x] Migrations apply and roll back cleanly; seed is idempotent
- [x] Login → TOTP → session works; revocation is immediate; lockout fires and releases
- [x] Session token stored only as a hash (verified by inspecting the table)
- [x] Every app route redirects to login when unauthenticated
- [x] No secret in any client bundle (verified by grepping build output)
- [x] `typecheck`, `lint`, `build` pass in CI

**Delivered beyond the checklist**, because the implementation surfaced a need:
- Least-privilege database roles, with `audit_log` append-only *at the grant level* and no DDL for the application role — asserted by integration tests that run as the application role.
- Hand-written down migrations plus `npm run db:rollback`, since drizzle-kit generates forward migrations only. A schema-fingerprint test asserts migrate → rollback → migrate is byte-identical.
- `users.last_totp_step` ([SCHEMA.md §1](SCHEMA.md#1-identity-and-session)) — the TOTP replay guard SECURITY.md §1 requires had nowhere to live.
- Account provisioning is a CLI (`npm run auth:create-user`), not a web route: login is therefore the only unauthenticated endpoint in the application.

---

## Phase 3 — Financial Core ✅ complete

- Schema: `accounts`, `categories`, `tags`, `transactions`, `transaction_entries`, `transaction_tags`, `budgets`, `recurring_rules`, `recurring_occurrences`, plus `check_transaction_shape()` and `check_category_shape()`
- Domain: accounts + balance, categories tree/rollup, transactions, transfers, FX lookup, budgets, recurrence expansion, job runner + `recurring.post`
- UI: accounts list and ledger, transactions table with filters, structured quick-add, categories, budgets, recurring + forward calendar
- `verify:integrity` with invariants I-1 to I-4, I-9, I-11

**Five amendments carried from the Phase 4 design review** ([INVESTMENT-ENGINE-DESIGN.md §11](INVESTMENT-ENGINE-DESIGN.md)). Each exists so Phase 4 does not have to widen a Phase 3 contract:

1. **`deriveBalance()` takes investment-ledger rows from the outset.** [FINANCIAL-DOMAIN.md §3](FINANCIAL-DOMAIN.md#3-accounts) already defines a balance as summing both ledgers. A money-only signature would have to change in Phase 4, and every caller with it.
2. **`recurring_occurrences.investment_transaction_id`** — created nullable and **without** its foreign key; Phase 4's migration adds the constraint. A migration cannot reference a table that does not exist yet.
3. **`transactions.ai_proposal_id`** — same treatment; Phase 7 adds the constraint.
4. **The `record_source` enum is created in Phase 3**, since both ledgers use it.
5. **`accounts.currency_code` is immutable once the account carries ledger rows** (OD-5). Enforced at the service layer, and the account form must not offer to change it after the first transaction.

**Done when**
- [x] Every edge case in [FINANCIAL-DOMAIN.md §12](FINANCIAL-DOMAIN.md#12-edge-cases-that-must-be-covered-by-tests) passes — except 15, 16, 24, 25, which are about `manual_assets` and `liabilities` and belong to Phase 5
- [x] Transfers appear in neither income nor expense totals anywhere
- [x] Cross-currency transfer residual is reported as an FX effect, not absorbed
- [x] The trigger rejects every invalid transaction shape
- [x] Recurrence handles the 31st across February in leap and non-leap years
- [x] Posting job run twice on one day creates exactly one transaction, incl. under two concurrent runners
- [x] Balances match a hand-computed figure over a 200-transaction fixture
- [x] Golden scenario **G1** passes
- [x] An expense can be entered in under 5 seconds, keyboard-only — the quick-add composer opens focused on the amount, and every field is reachable in entry order by tab

**Amendment status at the Phase 3/4 boundary.** Phase 3 shipped on a branch that did not carry the Phase 4 design review, so amendments 2 and 3 landed differently. Recorded rather than papered over:

| # | Phase 3 outcome | Closed by |
|---|---|---|
| 1 | ✅ `deriveBalance(opening, entryAmounts, investmentNetAmounts)` — the third parameter shipped in Phase 3, empty until Phase 4 fills it | — |
| 2 | `recurring_occurrences.investment_transaction_id` not created (D-17) | Phase 4 adds the column **and** its FK in one migration — legal now that `investment_transactions` exists |
| 3 | `transactions.ai_proposal_id` not created (D-17) | Phase 7, unchanged |
| 4 | ✅ `record_source` enum created in Phase 3 (`src/server/db/schema/enums.ts`) | — |
| 5 | ✅ `accounts.currency_code` immutable — `updateAccount` never patches it | — |

---

## Phase 4 — Investment Engine ✅ complete

The design was settled before implementation — [INVESTMENT-ENGINE-DESIGN.md](INVESTMENT-ENGINE-DESIGN.md), with its corrections applied to `INVESTMENT-DOMAIN.md` and `SCHEMA.md` under OD-4.

- `src/lib/decimal/price.ts` — the `UnitPrice` primitive, `valueOf` / `perUnit` / `mulQtyRatio`
- Schema `0002`: `instruments`, `instrument_prices`, `instrument_quotes`, `investment_transactions`, `tax_lots`, `lot_disposals`, `positions`; `recurring_occurrences.investment_transaction_id` gains its deferred FK
- `src/server/domain/lots/` — the pure `replay()` FIFO engine, `kind_rank` ordering, corporate actions
- `src/server/domain/pricing/` — `PriceResult`, valuation with coverage, allocation, concentration
- `src/server/domain/calc/` — `portfolio.ts`, `xirr.ts`, `twr.ts`
- Services: `instruments`, `investments`, `positions`, `portfolio`, `prices`; rebuild inside the mutation's transaction with `investment_ledger_version` stamping
- UI: overview, holdings, instrument detail with lots, the ledger, allocation, performance, instruments

**Done when**
- [x] Edge cases 1–14, 18–19 and **21–31** in [INVESTMENT-DOMAIN.md §12](INVESTMENT-DOMAIN.md#12-edge-cases-that-must-be-covered-by-tests) pass
- [x] Splits and bonuses preserve total cost basis **exactly** — `Σ cost_total` byte-identical before and after
- [x] Oversell is rejected with `shortBy` and writes nothing, including when introduced by a backdated sell
- [x] Incremental rebuild output is byte-identical to a full rebuild (property test **and** integration test)
- [x] Replay is independent of insertion order within a `trade_date` (property test; needs `kind_rank`)
- [x] Invariants I-5, I-6, I-7, **I-15, I-16, I-18, I-19, I-20** pass; I-6 asserted **exactly**, with no tolerance
- [x] The `CHECK` constraints reject at the database, asserted by 30 direct `INSERT`s that bypass the service
- [x] Golden scenarios **G2** and **L1** pass; market value asserted against manually entered prices
- [x] Market-value, unrealised P&L, and return metrics return `null` with reason `no_price` — not `0`
- [x] `verify:integrity` does **not** assert either non-invariant in [SCHEMA.md §12](SCHEMA.md#12-invariants-summary), and a test asserts their absence

### Corrections made during implementation

Four, each forced by a test rather than found by reading, and each changing something a canonical document states:

- **D-24** — partial cost consumption uses **flooring**, not `half_up`, because only flooring preserves the remaining basis and therefore invariant **I-19**.
- **D-25** — three new database `CHECK` constraints.
- **D-26** — **`withWriteCtxResult`**, giving atomic rollback to a mutation whose rebuild can fail after the row is written.
- **D-27** — **`ProportionBar`**, replacing CSP-incompatible inline dynamic width styling with compliant static classes.

They are recorded in full, with their rationale, in [PROJECT-STATE.md](../PROJECT-STATE.md) alongside D-9…D-23 — the D-series lives there, and keeping a second copy here would give two records free to drift.

`ai_proposal_id` on `investment_transactions` is deliberately absent, following the precedent D-17 set on `transactions.ai_proposal_id`: Phase 7 adds both columns with their foreign keys and the partial unique index invariant I-14 needs.

**Deferred to Phase 6, as designed:** the `MarketDataProvider` registry and its adapters, the `prices.refresh` job, and `instrument_prices` history. Prices are entered by hand; TWR therefore returns `null` with `insufficient_price_history` for every instrument, which is [INVESTMENT-DOMAIN.md §8](INVESTMENT-DOMAIN.md#8-time-weighted-return)'s documented launch behaviour and not a defect. The full list of Phase 4 scope boundaries — each an intentional roadmap limit rather than a defect — is in [PROJECT-STATE.md](../PROJECT-STATE.md).

**Final verification, 2026-08-11.** Unit **549**, property **47**, integration **316** — **912 passed, 0 failed**. Typecheck, lint and production build clean. Migration `0002` applies, rolls back and re-applies to a **byte-identical schema fingerprint**. `verify:integrity`: **21 passing, 0 failing, 3 deferred** (I-8 Phase 5; I-10, I-14 Phase 9). Live browser workflow passed. Every Phase 3 financial test continues to pass; three Phase 3 test files changed only because a phase-boundary expectation was superseded by Phase 4, and none was weakened.

---

## Phase 5 — Net Worth at Cost ✅ complete

**Design review complete 2026-08-12; OD-7, OD-8 and OD-9 approved and applied the same day; implemented and verified 2026-08-15; signed-in browser verification 2026-08-17** ([NET-WORTH-DESIGN.md](NET-WORTH-DESIGN.md)). The per-gate results, the browser verification table and the two defects it found are in [PROJECT-STATE.md](../PROJECT-STATE.md) under *Phase 5 final verification*.

**The figure this phase ships is "Net Worth at Cost"** ([ADR-23](DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost)). Investment positions contribute the **exact Phase 4 cost basis**. Market value and cost basis are never mixed inside one figure, and no screen shows an unqualified "Net worth" that could be read as a current market valuation. Market-value net worth is a distinct Phase 6 calculation.

Unblocked by Phase 4: `tax_lots` and `lot_disposals` exist, so the change bridge has `Σ lot_disposals.base_realized_pnl` by `closed_on` to draw on, and the single-counting rule has a real position cost basis to keep separate from a brokerage account's cash balance.

- Schema: `manual_assets`, `asset_valuations`, `liabilities`, `liability_balances`. **No `net_worth_snapshots`, no `user_state.valuation_version`** — both moved to Phase 6 ([ADR-24](DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6))
- Domain: `src/server/domain/networth/` — source keys and the `contributions` map, date-driven eligibility, composition, the change bridge, reconciliation
- Services: `assets.ts`, `liabilities.ts` (the only writers) and a **read-only** `networth.ts` with no `WriteCtx` signature
- **No `networth.snapshot` job.** Every figure is derived on demand
- UI: Net Worth at Cost — current, history, attribution waterfall, and assets/liabilities CRUD beneath it

**Three findings from the review that change the work** ([§14](NET-WORTH-DESIGN.md#14-defects-found-in-the-baseline-n1n19)):

- **The as-of investment figure cannot come from `positions`**, which is today's cache. It is derived from `tax_lots` / `lot_disposals` bounded by `opened_on` / `closed_on` — exact, because splits and bonuses touch no money and I-20 makes the subtraction residue-free.
- **Two as-of defects sit in the Phase 3 read path** and must be fixed before anything consumes it: `opening_balance` is added regardless of `opening_date` (N2), and `AccountView.baseBalance` converts at today's rate even when `asOf` was supplied (N3).
- **`accountRole()` classifies by kind**, which [ADR-25](DECISIONS.md#adr-25--net-worth-classification-is-by-the-economic-sign-of-the-balance-not-by-account-kind) makes wrong. Classification is by the economic **sign** of the balance. This is the one code change the correction pass implies, and it is Phase 5 work.

**Done when**
- [x] `accountRole()` classifies by **sign**: an overpaid credit card at `+₹5,000` contributes a **+₹5,000 asset** — not zero, not a liability — and an overdrawn bank account is a liability ([ADR-25](DECISIONS.md#adr-25--net-worth-classification-is-by-the-economic-sign-of-the-balance-not-by-account-kind), I-31)
- [x] An account created after the requested `asOf` contributes nothing, **including its opening balance**; created before, it contributes both; closed after `asOf`, it is fully counted (N2, [ADR-26](DECISIONS.md#adr-26--an-as-of-financial-figure-is-computed-from-dated-facts-only-no-current-state-flag-participates))
- [x] No calculation reads `is_active` on any table — asserted by a **source scan** (I-26)
- [x] The double-counting guard in [FINANCIAL-DOMAIN.md §9.2](FINANCIAL-DOMAIN.md#92-enforcement) throws on a duplicated source key (tested by deliberately duplicating one)
- [x] A credit-card account also present as a `liabilities` row is caught (I-8); a liability linked to a non-`credit_card`/`loan` account is rejected (I-27); a closed scheduled liability has its terminal zero row (I-28)
- [x] Net worth on a past date uses the valuation in force on that date; an **eligible** asset with no valuation in force is excluded and named, never zeroed
- [x] `investmentCostBasisAsOf(today)` equals `Σ positions.base_cost_basis` exactly (I-24)
- [x] `unexplained` is **exactly** zero on single-currency golden scenarios, within one base unit otherwise (I-30)
- [x] Golden scenario **G4** passes; **G1** gains its Net-Worth-at-Cost series assertions
- [x] `verify:integrity` reports **I-8 passing** rather than `skipped`, plus **I-21 … I-32**
- [x] The figure is labelled **Net Worth at Cost**, and the UI states that investments are at cost until Phase 6
- [x] Balances derived from the investment ledger are marked **trade-dated** ([ADR-22](DECISIONS.md#adr-22--financial-recognition-is-trade-dated-settlement_date-is-informational-metadata)'s carried UI requirement)
- [x] **Nothing in the Phase 5 diff touches market data, price refresh, price history, snapshots, or AI.** Those are later phases

---

## Phase 6 — Market Data — **complete: steps 6.0 … 6.11**

**Design review complete 2026-08-18** — [MARKET-DATA-DESIGN.md](MARKET-DATA-DESIGN.md). **OD-10
approved 2026-08-18**, and its findings are now applied *and implemented*, not merely documented.

| Step | State |
|---|---|
| 6.0 canonical corrections (M1–M13, ADR-27…ADR-30, I-33…I-40) | ✅ |
| 6.1 provider abstraction, registry, observation + failure model | ✅ |
| 6.2 persistence — `corporate_action_detections`, migration `0004` | ✅ |
| 6.3 FX — triangulation + Frankfurter adapter + `fx.refresh` | ✅ |
| 6.4 AMFI mutual-fund NAV adapter + `prices.refresh` | ✅ |
| 6.5 historical observation storage, bounded carry-back | ✅ |
| 6.6 freshness — one session-based classifier | ✅ |
| 6.7 corporate-action safety — detections, suppression | ✅ |
| 6.8 tests and the verification gate | ✅ **1,177 passing** |
| **6.9 commercial equity adapter (Twelve Data)** | ✅ built, tested, registered — **1,245 passing**. `TWELVE_DATA_API_KEY` is optional and unset here, so equities report `no_provider`; **no live smoke test has been run** |
| **6.10 snapshots** | ✅ **CLOSED — not built** (OD-15, 2026-08-21). A 365-point market-value series over a portfolio larger than the target user's runs in **123 ms**; the naive 1,156 ms was a linear price scan, not a missing cache. No table, no job, no snapshot-based figure. [ADR-24](DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6)'s four rules stay on the shelf, reopened only by a **real production measurement** |
| **6.11 market-value net worth (`basis: 'market'`)** | ✅ **implemented and verified 2026-08-27** — **1,396 passing**, `verify:integrity` 33 passed / 0 failed / 19 engine-enforced / 2 deferred. **No schema change** and **no snapshots**, as [MARKET-VALUE-NET-WORTH-DESIGN.md](MARKET-VALUE-NET-WORTH-DESIGN.md) §20 and OD-15 concluded. **The default basis remains `cost`** ([ADR-32](DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view)); `market` is reached from an explicit link. Golden **G5** and **G6** added |

Three conclusions shaped how this phase was sequenced:

- **OD-3 gates step 6.9 of twelve, not the phase.** The two adapters that matter most for an INR-base
  portfolio — **AMFI** (Indian mutual-fund NAV) and a **central-bank FX feed** — are free, keyless and
  official. Eleven of the twelve steps are unblocked today, and the FX adapter fixes a *live* gap:
  `fx_rates` is empty, so every non-INR component is currently excluded from net worth.
- **Thirteen defects were found in the baseline (M1–M13), four high severity — all now fixed.** None
  produced a wrong number at the time, because `instrument_prices` and `fx_rates` were empty; each
  would have produced a silently wrong figure on the day a provider was connected. The worst four:
  FX could not triangulate so foreign holdings vanished (M1); wall-clock staleness marked every EOD
  price stale every weekend (M2); staleness could not reach the net-worth figure (M3); and nothing
  prevented a provider corporate action reaching the ledger (M4) or detected an unrecorded split
  silently destroying 80% of a position's market value (M5).
- **Four ADRs and eight invariants (I-33 … I-40) are in force.** I-38 and I-39 describe market-value
  net worth and are reported by `verify:integrity` as **deferred**, not silently omitted.

The implementation sequence is [§20.J](MARKET-DATA-DESIGN.md#j-implementation-sequence); the ordering
below is the *scope* list, not the order of work.

- `MarketDataProvider` interface, registry, `PriceResult` union
- `ManualProvider` (always registered), AMFI adapter (Indian MF NAVs), FX adapter
- `prices.refresh` / `fx.refresh` jobs; caching to `instrument_quotes` / `instrument_prices`
- Valuation with coverage; XIRR, TWR, allocation, concentration metrics
- **Market-value net worth** — `basis: 'market'` as a distinct calculation alongside Phase 5's `'cost'`. **The default remains `cost`** ([ADR-32](DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view)); `market` is an explicit alternate view, and neither replaces the other. The bridge gains a real unrealised-gain line **under `market`**, and the cost bridge is untouched
- **Carried from Phase 5 by [ADR-24](DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6):** `net_worth_snapshots`, the `networth.snapshot` job and `user_state.valuation_version` — **only if measurement justifies them**, and only under ADR-24's four rules
- `quantityHeldOn` must apply corporate-action ratios, not sum `quantity` ([INVESTMENT-DOMAIN.md §8.1](INVESTMENT-DOMAIN.md#81-portfolio-growth-over-time))
- UI: staleness indicators, price history, performance page, allocation page

**Done when**
- [x] All seven failure modes per adapter return a `PriceResult` and never throw
- [x] An unpriced holding is excluded from totals, marked in the UI, and reduces `coverage`
- [x] A stale price is used and visibly marked
- [x] No provider credential is reachable from any client bundle
- [x] XIRR matches a spreadsheet reference to 6 decimal places across 10 series
- [x] Every `null` metric carries its reason
- [x] `basis: 'market'` net worth **excludes** unpriced holdings and names them; it never falls back to cost inside the same figure ([ADR-23](DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost))
- [x] The release note states that the basis switch moves net worth for **FX reasons alone**, independently of price ([FINANCIAL-DOMAIN.md §9.3](FINANCIAL-DOMAIN.md#93-calculation)) — golden **G6**'s 3 August point asserts it with the price held constant
- [x] The portfolio growth series is correct across a split and a bonus — a plain running sum of `quantity` is not
- [x] Golden scenarios **G5** and **G6** pass. **G3** remains open — it needs a multi-currency *portfolio* fixture rather than a net-worth one, and no Phase 6.11 gate depends on it
- [x] All invariants pass in `verify:integrity`, and no declared non-invariant is asserted ([SCHEMA.md §12](SCHEMA.md#12-invariants-summary))
- [x] Snapshots were **not** introduced, so the conditional assertion does not apply (OD-15)
- [x] Staleness is measured in **trading sessions**, not wall-clock hours, and a price from Friday's close is not marked stale on Monday morning ([MARKET-DATA-DESIGN.md §11](MARKET-DATA-DESIGN.md#11-staleness))
- [x] A stale price is marked on the **net-worth** surface too, not only on the holdings table
- [x] An FX rate carries an age classification, as a price does
- [x] No provider-sourced corporate action ever creates an `investment_transactions` row; an unreconciled one **suppresses** the instrument's market value rather than adjusting it
- [x] `priceOn` carry-back is **bounded**; beyond the bound the point is a gap, not a value
- [x] The TWR boundary-valuation builder includes instruments **since fully disposed**, and supplies a valuation for a boundary falling on a non-trading day
- [x] Market-basis coverage is **value-weighted** by base cost basis, not a component count (D-29)
- [x] Every `instrument_prices` series for one instrument comes from **one** provider

**Two findings from implementing 6.11**, recorded because neither is in the design and both
outlive it:

- **`ExclusionReason` gained a tenth member, `no_price_on_date`.** The seven `MissingPriceReason`
  members are verdicts about a *provider*; none is true when the feed is healthy and has simply
  published nothing for a date before the instrument listed. Folding the historical gap into
  `not_found` would tell the user to re-map a symbol that is mapped. It is a net-worth exclusion
  cause only — the market-data union is untouched.
- **`selectRate()` rebuilt its pair index on every call**, which a *series* pays once per foreign
  position per point. Invisible on a single-date page and dominant at 365 points. `rateSelector()`
  memoises the index per date; the resolution rule is unchanged, so every Phase 3/4/5 figure is
  byte-identical. Found by the benchmark, not by a test — see §12 of the design review.

---

## Phase 7 — AI Infrastructure

**Design review complete 2026-08-29** — [AI-INFRASTRUCTURE-DESIGN.md](AI-INFRASTRUCTURE-DESIGN.md).
**Steps 7.0-7.7 complete.** 7.0-7.6 landed 2026-08-30; 7.7 (the live smoke test) ran once `NVIDIA_API_KEY` was configured, closing OD-1. Phase 8 (model evaluation) and Phase 9 (AI features) have NOT started.

**Environment migrated to SSD 2026-09-09, and both category-B qualifications are now closed.** The canonical repository is `C:\Dev\AI Enabled Personal Finance`; **`E:` is no longer the development location.** Full detail in PROJECT-STATE.md, "Development environment moved to SSD".

The two things that blocked category A on 2026-09-03:

- **The unreliable storage is no longer under the repository.** `E:` is a partition of Disk 0 (`ST1000DM010`, HDD), which logged a further 93 paging-I/O errors, 5 surprise-removals and 6 NTFS delayed-write failures in the seven days to 2026-09-09. The work moved to Disk 2 (`WDC WDS240G2G0B`, SSD — that is `C:`) by `git clone` rather than file copy, so every object was checksum-verified in transit; all 10 branch SHAs and the `HEAD` tree hash match the source exactly. **The failing drive was not repaired** — it was vacated. `next build`, which segfaulted on `E:` with `0xC0000005` until a disk-corrupted binary was reinstalled, now completes in 38 s on the first attempt.
- **The date-dependent test defect is fixed at the runner, not in the assertions.** `runDueJobs` now resolves the run's instant once and threads it to every handler as `JobDeps { now }`; `RECURRING_POST` passes it to `createReadCtx`. Recurring semantics are untouched, and production still gets the wall clock. No assertion was weakened — `toBe(2)` stands — and two regression tests pin three different injected instants. Reverting the one-line fix fails 5 of that file's 10 tests, so the guard is not vacuous.

**Authoritative baseline on the SSD, 2026-09-09:** `npm test` → **75 files, 1,560 passed, 0 failed, 0 skipped, 547 s**. Typecheck 4 s, lint 63 s, build 38 s, `verify:integrity` 33/0/28/2, `check:no-client-secrets` clean. **Phase 7 is category A — fully verified.**

**Remaining risks, neither an environment caveat:**

- The repository still has **no remote**. Every commit exists in two local copies, one of them on the dying drive. A backup is the highest-value next action.
- **No model has been measured.** Routing stays gated by `capabilities.ts`, and Phase 8 owns model selection — including the `nemotron-3-nano-30b-a3b` → `nemotron-nano-3-30b-a3b` drift recorded under [ADR-41](DECISIONS.md#adr-41--a-catalogue-drift-is-reported-never-silently-re-routed).

**The authenticated catalogue moved again on 2026-09-03**: 82 models, and Tier 1's primary `nvidia/nemotron-3-nano-30b-a3b` is absent — apparently renamed to `nvidia/nemotron-nano-3-30b-a3b`. **Routing was not changed**; a transposed identifier is not proof of the same model, and `CLAUDE.md` requires evaluation first. Tier 1 still serves via fallback to `openai/gpt-oss-20b`. Phase 8 resolves it with the eval harness.

Architecture only, no user-facing features.

> **The review found three properties `AI-SYSTEM.md` calls non-negotiable that were false against the
> Phase 6.11 code — F-1, F-2 and F-3. All three are now closed**, in code, before any AI code was
> written, and the canonical documents have been reconciled rather than appended to.
>
> | | Was | Is |
> |---|---|---|
> | **F-1** | `withWriteCtx(readCtx, …)` compiled clean, and `ReadCtx.db` is a full DML executor | `withWriteCtx` requires a `RequestCtx` carrying `beginTransaction`, granted only by `createReadCtx`; the AI layer holds an `AiReadCtx` with no `db` at all. Both the escalation and the raw write are **compile errors** ([ADR-33](DECISIONS.md#adr-33--the-transaction-opener-is-a-capability-carried-on-the-context-not-an-ambient-import), **I-50**) |
> | **F-2** | the ESLint AI zone matched only `@/`-aliased paths, so `'../../db/client'` linted clean | aliased **and** relative patterns, plus a source scan covering the dynamic `import()` ESLint cannot see, plus the capability types ([ADR-34](DECISIONS.md#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths), **I-51**, **I-52**) |
> | **F-3** | `breakdown()` returned parent **and** child rows, each rolled up; summing them double-counted | it returns a structure with an authoritative `total` and an `additivity` tag; both depths partition exactly ([ADR-37](DECISIONS.md#adr-37--a-breakdown-declares-whether-its-rows-partition-its-total), **I-54**) |
>
> Also closed: exact values now cross a JSON boundary as tagged digit strings rather than not at all
> ([ADR-36](DECISIONS.md#adr-36--exact-values-cross-a-json-boundary-as-a-tagged-string-projection-never-as-a-json-number), **I-53**).
> **OD-17 is resolved** by the recommended option — narrow the context the AI layer receives
> ([ADR-35](DECISIONS.md#adr-35--ai-infrastructure-is-strictly-read-only-a-mutation-needs-a-separate-approved-proposal-workflow)).
> See [AI-INFRASTRUCTURE-DESIGN.md §0](AI-INFRASTRUCTURE-DESIGN.md#0-the-finding-that-matters-most).

**Three tools have no engine behind them, and are removed from the Phase 7 registry rather than
stubbed** — `run_financial_scenario` (nothing at all), `calculate_financial_metrics` (3 of 4 metrics
missing), `get_portfolio_performance`'s TWR (implemented, tested, and wired to nothing). That is
deterministic financial-engine work, not AI work: **OD-18, deferred 2026-08-30**. The governing rule
is normative in `AI-SYSTEM.md` §8 — *an AI capability exists only where a deterministic application
capability already exists or has an explicitly approved implementation path.* **AI must not become a
substitute for missing financial-engine functionality.**

**The Overview page stays a Phase-2 placeholder for now** — **OD-19, deferred 2026-08-30** as a
product/UI work item scheduled with the Phase 9 UX pass. It does not block Phase 7.

| Step | Delivers | Needs the key? |
|---|---|---|
| **7.0 boundary pre-work** ✅ **done 2026-08-30** | `RequestCtx` capability + `AiReadCtx`; ESLint zone extended to relative paths and the query builder; source-scan and compile tests (**I-50 … I-54**); the breakdown contract; the exact-value JSON projection; ADR-33 … ADR-37; root lint scoped away from `.claude/worktrees/**` | no |
| **7.1 provider abstraction** DONE **2026-08-30** | `AiProvider` + `nvidia-build.ts` over injected `fetch` (ADR-40); every failure classified, nothing thrown (**I-55**) | no |
| **7.2 configuration** DONE **2026-08-30** | `NVIDIA_API_KEY` + tier lists in `src/lib/env.ts`, passed into `config/models.ts`; catalogue identifiers reconciled; `config/capabilities.ts` with an explicit declared/measured split | no |
| **7.3 tool framework** DONE **2026-08-30** | 18 read-only tools over real services, `AiReadCtx` throughout, per-field projection, row caps, 150 KB byte budget, visible truncation, strict Zod schemas (**I-57**) | no |
| **7.4 orchestrator** DONE **2026-08-30** | requirements -> select -> fallback -> breaker; hard capability gate, no cross-tier downgrade, Tier 3 unreachable by escalation (**I-56**) | no |
| **7.5 structured outputs** DONE **2026-08-30** | Zod as the single boundary; validate -> one repair carrying field errors -> reject (**I-57**) | no |
| **7.6 observability + kill switch** DONE **2026-08-30** | closed scalar record + injected sink; `settings.ai_enabled` **now actually read**, failing closed; per-user rate limiter (**I-58**). Conversation tables deliberately not created — nothing writes conversations yet. Migration `0005` was later used for `ai_usage_daily`, the daily budget's ledger (B-3a, 2026-10-26), which code does fill | no |
| **7.7 live smoke test** DONE | `npm run ai:smoke` / `ai:catalogue` exist and degrade honestly (exit 0 with local instructions) when no key is set. **Run once `NVIDIA_API_KEY` was configured**, closing OD-1 (see the Phase 7 status above) | yes — done |

**Two structural constraints the review surfaced:**

- **`src/server/ai/config/` cannot read `process.env`** — the ESLint rule confines it to
  `src/lib/env.ts`. ADR-17's env-driven tier lists must be declared there and *passed in*.
- **Nothing the services return is JSON-serializable.** `Money.minor`, `Rate`, `UnitPrice` and
  `Quantity` are `bigint`; `JSON.stringify` throws on all of them. Every tool needs an explicit
  projection — including the 13 that otherwise "need no new code". **Resolved in 7.0:**
  `src/lib/format/json-projection.ts` provides the per-type projections (ADR-36); what remains for
  7.3 is the per-tool field selection, which is deliberately not a generic walker.

**Done when**
- [x] AI code cannot obtain a `WriteCtx` — asserted by a `tsc` test **and** an import ban **and** a source scan *(step 7.0; **I-50**, **I-51**)*
- [x] No `ctx.db` DML is reachable from `src/server/ai/**` — asserted by source scan *(step 7.0; **I-51**. The capability carries no `db` at all, so this is belt to the type system's braces)*
- [x] The ESLint AI zone catches relative-path imports, not only `@/` ones *(step 7.0; verified empirically, and the scan additionally catches the dynamic `import()` ESLint never checks)*
- [x] Every candidate model in `CLAUDE.md` is confirmed, corrected, or removed against the authenticated catalogue *(confirmed 2026-08-31; the Tier 1 primary's 2026-09-03 drift is deferred to Phase 8 by recorded decision — [ADR-45](DECISIONS.md#adr-45--the-tier-1-catalogue-drift-is-deferred-to-phase-8), B-3e)*
- [x] Every tool schema asserts `additionalProperties: false` and a complete `required` array *(B-3d, #6: swept across the registry in `ai-tools.test.ts`)*
- [x] No tool input schema contains a user-identifier field (asserted by test) *(`ai-tools.test.ts`, `ai-infrastructure.test.ts`)*
- [x] Every tool result is explicitly projected; no `bigint` reaches JSON *(the projection primitives exist — step 7.0, **I-53**; the per-tool field selection is 7.3; asserted in `ai-infrastructure.test.ts`)*
- [x] Every summary tool that partitions carries its own total, and `Σ rows === total` at every depth *(step 7.0 for the engine contract — `breakdown()` carries `total` and `additivity`, **I-54**. The per-tool projections are 7.3)*
- [x] Row caps, `truncated` flags, and the byte budget are enforced and tested *(B-3c, #5: the budget counts UTF-8 bytes, holdings are capped, and the dispatcher refuses any result over the ceiling)*
- [x] Fallback: each failure class routes correctly; the circuit breaker opens and half-opens *(`ai-routing.test.ts`, `ai-provider.test.ts`)*
- [x] **Cross-tier and cross-capability downgrade is impossible** — asserted by test *(`ai-routing.test.ts`)*
- [x] A model with no `capabilities.ts` entry cannot be routed to; startup fails loudly *(B-3b, #11; the matrix stays a `.ts` file — [ADR-44](DECISIONS.md#adr-44--the-capability-matrix-stays-capabilitiests-checked-at-startup))*
- [x] Daily budget is checked **before** the request *(B-3a, #10: `ai_usage_daily` — [ADR-43](DECISIONS.md#adr-43--the-daily-ai-budget-is-kept-in-a-table))*
- [x] `ai_enabled = false` produces **zero egress** and leaves every other feature working — asserted by test *(`ai-infrastructure.test.ts`)*
- [x] `NVIDIA_API_KEY` appears in no client bundle, no log, no test fixture *(`check:no-client-secrets` in CI; `ai-provider.test.ts`)*
- [x] The full deterministic suite passes with **no key configured** *(every CI run: CI sets no key)*

---

## Phase 8 — Model Evaluation

- Golden task suites: `parse`, `classify`, `tool-select`, `grounding`, `analysis`, `scenario`, `document`, `injection`, `robustness`
  - *Progress (one PR per suite):* `parse` ✅ built — 40 cases, `src/server/ai/eval/tasks/parse.ts`. `classify` ✅ built — 60 cases, `tasks/classify.ts`. `tool-select` ✅ built — 30 cases, `tasks/tool-select.ts`. `routing` ✅ built — 57 cases, `tasks/routing.ts`, scoring the deterministic escalation classifier (`orchestrator/escalation.ts`), 57/57. The rest not started. **No model has been run against any suite yet.**
  - *Catalogue (ADR-45):* re-read 2026-10-31 (85 models). Five evaluation candidates added (`EVALUATION_CANDIDATES` in `config/models.ts`), unrouted until measured.
- Runner, deterministic scoring, report generation
- Record measured entries: results in `ai_model_evaluations`, loaded over the declared defaults in `capabilities.ts` ([ADR-44](DECISIONS.md#adr-44--the-capability-matrix-stays-capabilitiests-checked-at-startup))
- Select production routing order per tier

**Done when**
- [ ] Every tier has at least one model meeting its thresholds (Tier 1 `schemaAdherence ≥ 0.95`; any tool-using route `toolCallCorrectness ≥ 0.90`)
- [ ] Scoring is deterministic wherever a right answer exists; LLM-as-judge is advisory only and never scores a numeric claim
- [ ] The `grounding` suite compares stated figures against engine output
- [ ] The `injection` suite confirms no write is attempted and no unexpected tool is called
- [ ] A routing order is proposed by the harness and accepted into configuration by a human
- [ ] CI fails when a production-routed model has no entry or a stale one

---

## Phase 9 — AI Features

- Natural-language transaction entry (proposal flow, quick-add free-text path)
- Financial assistant: the question set in `CLAUDE.md <ai_financial_assistant>`
- Portfolio analysis, financial-health analysis, period summaries, cross-domain analysis
- Scenario analysis — engine computes, model explains
- Tier 4 document/receipt extraction → proposal pipeline

**Done when**
- [ ] The proposal corpus (~40 cases) produces the expected status for every case
- [ ] Amounts round-trip as decimal strings; a JSON-number amount is rejected
- [ ] Malformed or ambiguous output is rejected with field-level errors, never guessed at
- [ ] Applying a proposal calls the same application service as the manual path, re-validated and re-authorized
- [ ] Invariant I-10 passes: no applied proposal without an `ai_confirmed` audit entry
- [ ] Proposals expire after 24 h and cannot then be applied
- [ ] Every one of the 12 example questions in `CLAUDE.md <ai_financial_assistant>` is answered correctly and grounded in tool output
- [ ] Fact / calculation / interpretation / scenario / recommendation are visually distinguished
- [ ] `null` metrics reported as unavailable with a reason, never as zero
- [ ] A vision task never falls back to a text-only model

---

## Phase 10 — UI/UX Refinement

- Overview page (two charts, no more); deterministic insight rules — **not** model-generated
- Transaction-entry speed, portfolio inspection, net-worth comprehension, AI interaction
- Mobile layout; loading, empty, and error states everywhere; accessibility
- Remove unnecessary UI; performance pass against [ARCHITECTURE.md §9](ARCHITECTURE.md#9-performance-targets)

**Done when**
- [ ] Overview renders within target on a 5-year dataset without waiting on any AI call
- [ ] Insights are deterministic and each links to its underlying records
- [ ] Every page usable at 375 px
- [ ] Keyboard path for transaction entry verified end to end
- [ ] All performance targets met, or an exception documented

---

## Phase 11 — Security

Audit against `CLAUDE.md <development_method>` Phase 10 and [SECURITY.md](SECURITY.md).

**Done when**
- [ ] Auth, authorisation, endpoints, secrets, database access, input/output validation reviewed
- [ ] AI tool permissions, prompt-injection resistance, mutation controls re-verified against the shipped code
- [ ] Sensitive-logging review: no balances, amounts, holdings, tokens, or keys in logs
- [ ] Third-party data exposure documented: exactly what goes to NVIDIA Build
- [ ] Market-data and model failure paths re-verified
- [ ] Rate limits verified under load
- [ ] `npm audit` clean at high and critical
- [ ] Every finding fixed, not merely recorded

---

## Phase 12 — Testing

**Done when**
- [ ] Unit, property, integration, golden-scenario, contract, AI, and E2E suites all pass
- [ ] Type checking, linting, and production build pass
- [ ] Every golden scenario asserts `unexplained ≈ 0`
- [ ] No skipped tests remain in the tree
- [ ] Failures were fixed, not reported

---

## Phase 13 — Deployment

- Provision and harden the host; Docker Compose; Caddy TLS
- Migrations as a privileged one-shot; application role cannot run DDL
- Backup pipeline (encrypted, off-site) and a **verified** restore
- Health check, uptime monitoring, rollback procedure

**Done when**
- [ ] Reachable over HTTPS on the user's domain with valid TLS and HSTS
- [ ] Postgres unreachable from the network
- [ ] Backup runs, uploads, **and a restore has been verified with `verify:integrity` passing**
- [ ] Rollback procedure executed once in anger, not just written down
- [ ] All jobs run on schedule
- [ ] Every item on the [pre-launch checklist](DEPLOYMENT.md#9-pre-launch-checklist) ticked

---

## Phase 14 — Continuous Improvement

Ongoing, not a one-off.

- Re-run `ai:eval` quarterly and on any model or provider change; re-tune routing from measurements
- Watch `ai_model_attempts` for models degrading in production before the next scheduled evaluation
- Monthly restore drill; watch backup age
- Review `null`-metric frequency — a metric that is usually unavailable is a data-collection problem, not a display problem
- Re-audit prompts when models change; revisit deferred items (embeddings, additional cost-basis methods, WebAuthn, WAL archiving) only against the criteria recorded for each

---

## Overall definition of done

Per `CLAUDE.md <production_definition_of_done>`:

- [ ] Runs locally; authentication works; UI responsive; database reliable; production build passes
- [ ] Accounts, transactions, transfers, categories, budgets, recurring all correct; balances correct
- [ ] Investment accounts, assets, transactions work; holdings correctly derived
- [ ] Portfolio valuation, realised and unrealised P&L, dividends/interest, fees, allocation, performance all work
- [ ] Market-data failures handled correctly
- [ ] Assets, liabilities, net worth, historical net worth correct; **double counting prevented**
- [ ] NVIDIA Build integration, model abstraction, routing, and fallback work
- [ ] Routine tasks use an efficient model; advanced reasoning uses a reasoning model; multimodal uses a multimodal model; embeddings used only where justified (currently: nowhere)
- [ ] Structured outputs validated; AI tools controlled; AI cannot mutate financial records
- [ ] NL transaction entry works; answers grounded; no fabrication; injection cannot bypass security
- [ ] Secrets server-side; authorisation deterministic; exposure minimised; rate limiting present
- [ ] Backups, restore, export, and deletion all work
- [ ] Tests, type check, lint, and build pass; critical workflows verified
- [ ] No known critical financial-integrity or security defects

---

## Deliberately deferred

Not built unless explicitly requested (`CLAUDE.md <feature_scope>`): brokerage execution, automated/autonomous trading, bank synchronisation, automatic statement import, tax filing, robo-advisory, product marketplace, social features, multi-user households, native mobile, WhatsApp, voice, derivatives/options/futures engines, high-frequency market data, a full planning suite, RAG, a vector database, multi-agent architecture.

Recorded future work with stated activation criteria: embeddings ([ADR-19](DECISIONS.md#adr-19--embeddings-deferred-full-text-search-first-pgvector-if-ever)), additional cost-basis methods, bond accrual pricing, WebAuthn passkeys, WAL archiving to cut RPO from 24 h to minutes.


