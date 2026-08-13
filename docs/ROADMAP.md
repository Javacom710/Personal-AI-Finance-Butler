# Development Roadmap

Canonical phase map: **`Workflow Setup.txt`, Phases 0–14** ([ADR-20](DECISIONS.md#adr-20--workflow-setuptxt-is-the-canonical-phase-map)).

Ordering principle: the financial engine is built and tested before any UI depends on it, and the AI is built after every number it can read is already correct.

A phase is complete only when every box is ticked — including tests, type check, lint, and a passing production build (`CLAUDE.md <testing_standard>`).

**The architecture in `docs/` is the implementation baseline** (approved 2026-08-09). Every phase from 2 onward follows the working protocol in [PROJECT-STATE.md](../PROJECT-STATE.md): read the relevant docs → inspect existing code → identify dependencies → implement **only this phase** → test → fix → verify the real workflow → update docs only on a material change.

**A discovered architectural problem is a stop-and-explain event, not an implementation decision.** Redesigning mid-phase is how a reviewed architecture silently becomes an unreviewed one.

---

## Where the project stands — Phase 4 checkpoint, 2026-08-11

| Phase | Status |
|---|---|
| 0 — Environment & Repository | ✅ complete |
| 1 — Architecture | ✅ complete, **approved** |
| 2 — Foundation | ✅ complete, verified |
| 3 — Financial Core | ✅ complete, verified |
| 4 — Investment Engine | ✅ **complete, verified** |
| 5 — Net Worth at Cost | **designed and decided 2026-08-12; implementation not started** — next |
| 6 — Market Data | not started (OD-3 affects completion, not start) |
| 7 — AI Infrastructure | not started; **blocked** on OD-1 (`NVIDIA_API_KEY`) |
| 8–14 | not started |

**912 tests pass** — 549 unit, 47 property, 316 integration. Typecheck, lint and the production build are clean; `verify:integrity` reports 21 invariants passing, 0 failing and 3 deferred. The per-gate results, the Phase 4 scope boundaries, and decisions D-24…D-27 are recorded in [PROJECT-STATE.md](../PROJECT-STATE.md).

---

## A consequence of this ordering, stated up front

Market Data is **Phase 6**, after Investments (4) and Net Worth (5). That is deliberate and correct — cost basis, realised P&L, and the lot engine need no prices at all — but it has a visible consequence:

> **Between Phases 4 and 6, holdings are valued at cost, and the Phase 5 figure is "Net Worth at Cost".**

Unrealised P&L, portfolio return, XIRR, TWR, and market-value allocation are **not computable** until Phase 6. Phase 5 therefore ships with those metrics returning `null` with reason `no_price` — which is exactly the behaviour the engine contract requires ([FINANCIAL-DOMAIN.md §10.3](FINANCIAL-DOMAIN.md#103-missing-data-propagates-as-null-never-as-zero)), and it means the missing-price path is exercised for real before any provider exists.

This is a **declared valuation basis**, not a temporary approximation ([ADR-23](DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost)): the investment contribution is the exact Phase 4 cost basis, market value and cost are never mixed inside one figure, and the UI says "valued at cost — market pricing arrives in Phase 6" rather than showing a number that looks like a market valuation. Phase 6 adds `basis: 'market'` as a **distinct** calculation and makes it the default.

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

**Blocked from Phase 7 onward** by OD-1 (`NVIDIA_API_KEY`). Phases 2–6 are unblocked.

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

## Phase 5 — Net Worth at Cost — **designed and decided; not started**

**Design review complete 2026-08-12; OD-7, OD-8 and OD-9 approved and applied the same day** ([NET-WORTH-DESIGN.md](NET-WORTH-DESIGN.md)). **No Phase 5 code, schema, migration, service, API, UI or test exists.** Implementation is unblocked: the gates below and the fuller list in [NET-WORTH-DESIGN.md §19](NET-WORTH-DESIGN.md#19-phase-5-implementation-gates) agree, and where one is more specific it is that one.

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
- [ ] `accountRole()` classifies by **sign**: an overpaid credit card at `+₹5,000` contributes a **+₹5,000 asset** — not zero, not a liability — and an overdrawn bank account is a liability ([ADR-25](DECISIONS.md#adr-25--net-worth-classification-is-by-the-economic-sign-of-the-balance-not-by-account-kind), I-31)
- [ ] An account created after the requested `asOf` contributes nothing, **including its opening balance**; created before, it contributes both; closed after `asOf`, it is fully counted (N2, [ADR-26](DECISIONS.md#adr-26--an-as-of-financial-figure-is-computed-from-dated-facts-only-no-current-state-flag-participates))
- [ ] No calculation reads `is_active` on any table — asserted by a **source scan** (I-26)
- [ ] The double-counting guard in [FINANCIAL-DOMAIN.md §9.2](FINANCIAL-DOMAIN.md#92-enforcement) throws on a duplicated source key (tested by deliberately duplicating one)
- [ ] A credit-card account also present as a `liabilities` row is caught (I-8); a liability linked to a non-`credit_card`/`loan` account is rejected (I-27); a closed scheduled liability has its terminal zero row (I-28)
- [ ] Net worth on a past date uses the valuation in force on that date; an **eligible** asset with no valuation in force is excluded and named, never zeroed
- [ ] `investmentCostBasisAsOf(today)` equals `Σ positions.base_cost_basis` exactly (I-24)
- [ ] `unexplained` is **exactly** zero on single-currency golden scenarios, within one base unit otherwise (I-30)
- [ ] Golden scenario **G4** passes; **G1** gains its Net-Worth-at-Cost series assertions
- [ ] `verify:integrity` reports **I-8 passing** rather than `skipped`, plus **I-21 … I-32**
- [ ] The figure is labelled **Net Worth at Cost**, and the UI states that investments are at cost until Phase 6
- [ ] Balances derived from the investment ledger are marked **trade-dated** ([ADR-22](DECISIONS.md#adr-22--financial-recognition-is-trade-dated-settlement_date-is-informational-metadata)'s carried UI requirement)
- [ ] **Nothing in the Phase 5 diff touches market data, price refresh, price history, snapshots, or AI.** Those are later phases

---

## Phase 6 — Market Data

- `MarketDataProvider` interface, registry, `PriceResult` union
- `ManualProvider` (always registered), AMFI adapter (Indian MF NAVs), FX adapter
- `prices.refresh` / `fx.refresh` jobs; caching to `instrument_quotes` / `instrument_prices`
- Valuation with coverage; XIRR, TWR, allocation, concentration metrics
- **Market-value net worth** — `basis: 'market'` as a distinct calculation alongside Phase 5's `'cost'`, becoming the default; the full attribution bridge with a real unrealised-gain line
- **Carried from Phase 5 by [ADR-24](DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6):** `net_worth_snapshots`, the `networth.snapshot` job and `user_state.valuation_version` — **only if measurement justifies them**, and only under ADR-24's four rules
- `quantityHeldOn` must apply corporate-action ratios, not sum `quantity` ([INVESTMENT-DOMAIN.md §8.1](INVESTMENT-DOMAIN.md#81-portfolio-growth-over-time))
- UI: staleness indicators, price history, performance page, allocation page

**Done when**
- [ ] All seven failure modes per adapter return a `PriceResult` and never throw
- [ ] An unpriced holding is excluded from totals, marked in the UI, and reduces `coverage`
- [ ] A stale price is used and visibly marked
- [ ] No provider credential is reachable from any client bundle
- [ ] XIRR matches a spreadsheet reference to 6 decimal places across 10 series
- [ ] Every `null` metric carries its reason
- [ ] `basis: 'market'` net worth **excludes** unpriced holdings and names them; it never falls back to cost inside the same figure ([ADR-23](DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost))
- [ ] The release note states that the basis switch moves net worth for **FX reasons alone**, independently of price ([FINANCIAL-DOMAIN.md §9.3](FINANCIAL-DOMAIN.md#93-calculation))
- [ ] The portfolio growth series is correct across a split and a bonus — a plain running sum of `quantity` is not
- [ ] Golden scenarios **G3**, **G5**, **G6** pass; **G2** now passes on market value
- [ ] All invariants (I-1 … I-32) pass in `verify:integrity`, and no declared non-invariant is asserted ([SCHEMA.md §12](SCHEMA.md#12-invariants-summary))
- [ ] If snapshots are introduced: `verify:integrity` asserts **snapshot = derivation**, and the current figure is still always derived

---

## Phase 7 — AI Infrastructure

**Blocked by OD-1 (`NVIDIA_API_KEY`).** Architecture only, no user-facing features.

- `AiProvider` interface; `nvidia-build.ts`; `npm run ai:catalogue` to verify the live model list
- `config/models.ts` (env-driven tiers), `capabilities.json` scaffold, `pricing.ts`
- Orchestrator: requirements, candidate selection, fallback chain, health/circuit breaker
- All 22 read tools with Zod schemas, row caps, byte budget; the read loop
- Structured-output strategies and the one-repair-then-reject path
- Observability: `ai_messages`, `ai_model_attempts`, `ai_usage_daily`; daily budget

**Done when**
- [ ] Every candidate model in `CLAUDE.md` is confirmed, corrected, or removed against the authenticated catalogue
- [ ] Every tool schema asserts `additionalProperties: false` and a complete `required` array
- [ ] No tool input schema contains a user-identifier field (asserted by test)
- [ ] Row caps, `truncated` flags, and the byte budget are enforced and tested
- [ ] Fallback: each failure class routes correctly; the circuit breaker opens and half-opens
- [ ] **Cross-tier downgrade is impossible** — asserted by test
- [ ] A model with no `capabilities.json` entry cannot be routed to
- [ ] Daily budget is checked **before** the request
- [ ] `ai_enabled = false` leaves every other feature working

---

## Phase 8 — Model Evaluation

- Golden task suites: `parse`, `classify`, `tool-select`, `grounding`, `analysis`, `scenario`, `document`, `injection`, `robustness`
- Runner, deterministic scoring, report generation
- Populate `capabilities.json` and `ai_model_evaluations`
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
