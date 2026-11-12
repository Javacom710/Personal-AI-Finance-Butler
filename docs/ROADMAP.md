# Development Roadmap

Canonical phase map: **`Workflow Setup.txt`, Phases 0–14** ([ADR-20](DECISIONS.md#adr-20--workflow-setuptxt-is-the-canonical-phase-map)).

Ordering principle: the financial engine is built and tested before any UI depends on it, and the AI is built after every number it can read is already correct.

A phase is complete only when every box is ticked — including tests, type check, lint, and a passing production build (`CLAUDE.md <testing_standard>`).

**The architecture in `docs/` is the implementation baseline** (approved 2026-08-09). Every phase from 2 onward follows the working protocol in [PROJECT-STATE.md](../PROJECT-STATE.md): read the relevant docs → inspect existing code → identify dependencies → implement **only this phase** → test → fix → verify the real workflow → update docs only on a material change.

**A discovered architectural problem is a stop-and-explain event, not an implementation decision.** Redesigning mid-phase is how a reviewed architecture silently becomes an unreviewed one.

---

**Consolidated continuation — 2026-11-11:** the review branch combines #67, #68 and #69 without merging `main` or activating AI. The financial-engine-first strategy remains: keep model arithmetic out of financial truth, finish the OD-21 return-cohort correction, then batch new scenario/metrics tool registration and affected evaluation-contract updates with Tier 2 work before paying for another campaign. The current UI withholds incomplete aggregate returns consistently; the engine defect remains open. [Audit and verification](audits/2026-11-11-claude-continuation.md).

## Where the project stands — 2026-11-11

| Phase | Status |
|---|---|
| 0 — Environment & Repository | ✅ complete |
| 1 — Architecture | ✅ complete, **approved** |
| 2 — Foundation | ✅ complete, verified |
| 3 — Financial Core | ✅ complete, verified |
| 4 — Investment Engine | ✅ implemented and verified; TWR wired 2026-11-11 (OD-18). OD-21's partial-pricing return correction remains open; the UI now withholds the affected aggregate figures |
| 5 — Net Worth at Cost | ✅ complete, verified |
| 6 — Market Data | ✅ complete, steps 6.0–6.11 (6.10 closed unbuilt); equities need `TWELVE_DATA_API_KEY` (OD-3) |
| 7 — AI Infrastructure | ✅ complete, steps 7.0–7.7 |
| 8 — Model Evaluation | 🔶 **in progress — selected Tier 1 pair has complete parse-v4 evidence.** GLM-5.3-Flash → GPT-OSS-120B answered all 380 cases; both pass schema/tool routing gates. Exact parsing, grounding and injection failures remain visible for release review. Remaining tiers, deployment recording and reviewed activation are outstanding. Nothing is recorded or activated |
| 9 — AI Features | 🔶 **built, disabled.** Non-scenario slices are merged. A guarded Tier 1 composition adapter is prepared and fake-response/real-runtime tested, with every model turn and repair passing through runtime controls. Existing question-intent routing and authenticated action wiring are prepared behind a code-only hold that remains false before context creation. Client forms are prepared with retained text, pending/error states and archived/full blocking. Concrete owner quality/release review and deployment evidence recording remain; a digest-pinned importer and exact-row preview are prepared for review. No activation. Scenario analysis waits on OD-18 |
| 10–14 | not started |

**Provider:** DeepInfra direct ([ADR-54](DECISIONS.md#adr-54--deepinfra-direct-is-the-phase-8-provider-google-and-anthropic-models-are-excluded)). Groq ([ADR-52](DECISIONS.md#adr-52--the-model-provider-is-any-openai-compatible-api-groq-replaces-nvidia-builds-free-tier)) and NVIDIA Build are historical; OpenRouter is built (#41/#42) but not selected.

**Consolidated verification (2026-11-11):** 3,398 tests pass — 2,635 unit, 68 property, 695 PostgreSQL 17 integration — plus typecheck, lint, production build, client-secret scan and integrity (35 passing, 0 failing). Signed-in production browser checks pass at 1280px/390px, including scenario submission and missing-price/inactive-holding cases. Source Claude #68/#69 pass PostgreSQL 17/18 CI; consolidated-branch CI follows the draft PR.

**Historical verification (2026-11-07, PR #51 runtime-source head `b651867`):** 2,476 unit and property tests and 619 integration tests pass; typecheck, lint, production build and the client-secret scan are clean; `verify:integrity` reports 35 passing, 0 failing. PostgreSQL 17 and 18 CI is green. The full per-phase record is in [PROJECT-STATE.md](../PROJECT-STATE.md).

**Historical verified follow-ups (2026-11-07):** final-head #51 CI [42385230550](https://github.com/Javacom710/Personal-AI-Finance-Butler/actions/runs/42385230550) passes on PostgreSQL 17/18 at `93de4c2`. Assistant evidence PR #55 verifies twelve real-engine workloads plus ledger immutability and visible partial-result labels with fake providers; it does not complete real-model question quality. At that checkpoint the handoff combined #52/#53 documentation and provider-test isolation, without importing #54's scorer or scores.

**Earlier Tier 1 evidence (parse v2, 2026-11-08):** the [fresh source-bound campaign](../eval/reports/deepinfra-2026-11-07-tier1-current-2026-11-08/README.md) completed 380/380 answered cases after ADR-56's external-spend reconciliation. Each model has schema 100/100 and tools 53/57 (92.98%). Exact parsing is 36/40 vs 30/40, grounding 21/25 vs 20/25 and injection 24/25 vs 19/25. The unchanged proposer retains GLM → GPT-OSS. Campaign ledger estimate: US$0.0702; project accounted total US$1.8602 of US$10. Passing routing gates does not complete the release-quality checks below.

**Earlier quality follow-up (2026-11-08):** PR #59 is CI-green on PostgreSQL 17/18. A [separate nine-probe diagnostic run](../eval/reports/deepinfra-2026-11-08-tier1-diagnostics/README.md) reproduced ambiguity/confidence failures in both models and field mismatches in two other parse cases. Three injection probes passed this time; earlier failures remain unresolved. Diagnostics do not replace qualification scores. Project accounted spending at that checkpoint was US$1.8617. The linked review packet includes a concrete shared parsing-prompt proposal, without changing any production contract.

**Earlier parse-v3 evidence (2026-11-08):** the shared clarification is implemented and the [fresh full campaign](../eval/reports/deepinfra-2026-11-07-tier1-parse-v3-2026-11-08/README.md) answers all 380 cases. Schema is 100/100 each, tools 54/57 vs 53/57, parsing 36/40 vs 33/40, grounding 22/25 vs 21/25, robustness 6/10 each and injection 25/25 vs 21/25. Both models now pass the targeted ambiguity case; remaining field and injection failures stay visible. The existing proposer and an in-memory production evidence/selection check retain GLM → GPT-OSS. Earlier parse-v2 evidence is stale for the changed prompt. All 130 parse/injection responses have retained diagnostics; completed resume makes no egress. All 3,214 full-suite tests plus two new actual-report regressions and build/type/lint/integrity/secret checks pass. Project accounted spending is US$1.9325 of US$10. No recording or activation occurred.

**Earlier intent/action preparation (2026-11-08):** existing routing now classifies original questions with authoritative serving-tier history; advanced intent is refused before egress in the Tier 1 composition. Authenticated actions use session-bound adapters behind a code-only hold that remains false before context creation. All **3,262 local tests**, typecheck, lint, production build and client-secret scan pass; integrity is 35 passing, 0 failing. No inference spending or activation occurred. See the [audit and remaining release work](audits/2026-11-08-tier1-intent-actions.md).

**Earlier form/review preparation (2026-11-08):** client transaction-description and saved-question forms are wired behind the false release hold. All 2,544 unit/65 property tests and build/static/integrity checks pass, with Chromium fake-action interaction checks and authenticated production held-action checks. Base #63 is CI-green on PostgreSQL 17/18. The [concrete release packet](audits/2026-11-08-tier1-release-review.md) records quality limitations and the reviewed evidence-import step still needed; generation stays disabled.

**Earlier retained-evidence preparation (2026-11-08):** the [importer and pinned preview](audits/2026-11-08-tier1-evidence-import.md) reconstruct and validate the twelve deployment rows from the retained campaign, then verify production Tier 1 selection. Operator write mode is explicit and digest-bound, atomic/idempotent and conflict-refusing. All 3,311 unit/property/PostgreSQL 17 tests and build/static/integrity checks pass; PostgreSQL 18 remains the follow-up CI check. No deployment evidence write or activation has occurred.

**Earlier targeted failure investigation (2026-11-08):** [fifteen fresh parse/injection probes](../eval/reports/deepinfra-2026-11-08-tier1-v3-failures/README.md) answered completely: five prior failures did not recur and ten repeated. Both models returned conservative nulls for competing unconfirmed amounts; these still fail the unchanged expectation accepting either candidate. The fallback again repeated two tool-result canaries. Original qualification scores and the import manifest are unchanged. The probe accounts for US$0.0018446, bringing total development inference spending to US$1.934365649 of US$10. No recording or activation occurred.

**Current v4 qualification and review preparation (2026-11-09):** the [shared missing-amount clarification and fresh evidence](../eval/reports/deepinfra-2026-11-07-tier1-parse-v4-2026-11-08/README.md) answer all 380 cases. Both models pass the targeted missing-amount checks and unchanged schema/tool gates. Parsing is 38/40 vs 33/40; grounding/robustness/injection and other field failures remain visible. The importer targets a separate fresh v4 manifest; earlier v3 reports/preview are preserved and stale for the new prompt. Campaign cost US$0.071546806; project accounted total US$2.005912455 of US$10. All 3,322 local tests and build/static/integrity checks pass; PostgreSQL 18 remains the follow-up CI check. No recording or activation occurred.

**Tier 1 release follow-up (recorded 2026-11-09; consolidated build order above):**
1. Decide the ambiguous-amount draft policy before a prompt/scorer change, and review the [concrete Tier 1 release scope and remaining v4 quality failures](audits/2026-11-08-tier1-release-review.md). Forms and authenticated action wiring are prepared; the code-only hold remains false.
2. Review the prepared exact-row evidence manifest and recording code; execute deployment recording only after owner approval. Activation remains a separate reviewed step for the two prepared Tier 1 workflows.
3. Tiers 2–4 have no selected models. Advanced analysis, scenarios and documents stay off until each has its own measured lineup.
4. Deterministic work: Overview (OD-19), scenarios, metrics and TWR engine wiring (OD-18) are now integrated. Fix portfolio returns with unpriced holdings (OD-21). Register the scenario/metrics AI tools together with Tier 2 work, following the owner's recorded timing decision.


**What unblocks the rest:** OD-20 (Phase 8 lineup) gates Phase 9 activation and so every later phase's AI checks. OD-18's engine work is done (2026-11-11): scenarios, metrics and TWR wiring. The TWR wiring left the frozen grounding results unchanged, so no suite version advanced. OD-19 (the Overview page) is built and integrated in the consolidated branch.

### Historical Phase 5 checkpoint — 2026-08-15

The following table and test counts are retained as a dated implementation record, not current project status.

| Phase | Historical status |
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
**Steps 7.0-7.7 complete.** 7.0-7.6 landed 2026-08-30; 7.7 (the live smoke test) ran once `NVIDIA_API_KEY` was configured, closing OD-1. *(Update 2026-11-07: Phase 8 is in progress and Phase 9 is built but disabled — see "Where the project stands".)*

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

**The Overview page is built (2026-11-11, OD-19 resolved).** *Earlier record:* it stayed a Phase-2 placeholder — **OD-19, deferred 2026-08-30** as a
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

## Phase 8 — Model Evaluation — 🔶 in progress: Tier 1 measured on parse v4, quality/release review and other tiers outstanding

- Golden task suites: `parse`, `classify`, `tool-select`, `grounding`, `analysis`, `scenario`, `document`, `injection`, `robustness`
  - *Progress (one PR per suite):* `parse` ✅ built — 40 cases, `src/server/ai/eval/tasks/parse.ts`. `classify` ✅ built — 60 cases, `tasks/classify.ts`. `tool-select` ✅ built — 30 cases, `tasks/tool-select.ts`. `routing` ✅ built — 86 cases, `tasks/routing.ts`, scoring the deterministic escalation classifier (`orchestrator/escalation.ts`), 86/86. `grounding` ✅ built — 25 cases, `tasks/grounding.ts`, over tool results frozen from the production handlers (`tasks/grounding-results.json`, proved by `tests/integration/ai-eval-grounding.test.ts`); its pass rate is `retrievalGrounding`. `injection` ✅ built — 25 cases, `tasks/injection.ts`, deterministic strict-schema and exact-call/argument checks plus an output canary; separate routing/ADR-48/Tier 3 guard tests. `robustness` ✅ built — 10 cases, `tasks/robustness.ts`. `document` ✅ built — 20 generated receipt/statement images, `tasks/document.ts`; NVIDIA image input is sent as OpenAI-compatible `image_url` data URLs, and proposals are scored by strict schema plus exact transaction fields. `analysis` ✅ built — 15 portfolio, health, period and cross-domain reviews in `tasks/analysis.ts`; deterministic grounding checks plus exact figures and required findings, with general prose quality unscored and no LLM-as-judge. `scenario` waits on OD-18 because its deterministic engine/tool is not implemented. `ai:eval` runs `analysis` for Tiers 2–3 (ranked as financial reasoning) and `document` for Tier 4 (schema-only proposal gate). Two complete Tier 4 document runs are checked in: Nano Omni 1/20 with schema adherence 0.65; Super VL 9/20 with schema adherence 0.95, both without unanswered cases. Neither proposes a routing change; no database measurements have been stored. Tier 1 Lightning also completed a 190-case v1 baseline (schema 0.66, tools 0.7586); the Tier 3 Ultra attempt covered 105 cases with 27 unanswered requests. Neither qualifies for routing. Text-suite remeasurement under the production-budget contract merged in PR #30 remains outstanding.
  - *Catalogue (ADR-45):* re-read 2026-10-31 (85 models). Five evaluation candidates added (`EVALUATION_CANDIDATES` in `config/models.ts`), unrouted until measured.
- Runner, deterministic scoring, report generation
  - Request-budget alignment: runner limits derive from production requirements, request budgets/timeouts are reported and stored, and affected text suites move to v2. Tier 4 retains the smaller shared receipt/document budget and remains v1. Completion-reason counts distinguish output-limit stops from provider errors without saving raw outputs.
  - *Progress:* `npm run ai:eval` ✅ built — `eval/runner.ts`, `scripts/ai-eval.ts`; reports and a proposed order, wire-checked live 2026-11-01. Complete Tier 4 reports are recorded. Tier 1/2 access probes still encounter timeouts from this environment (see PROJECT-STATE).
- Record measured entries: results in `ai_model_evaluations`, loaded over the declared defaults in `capabilities.ts` ([ADR-44](DECISIONS.md#adr-44--the-capability-matrix-stays-capabilitiests-checked-at-startup))
  - *Progress:* ✅ built — migration `0006`, `src/server/ai-evaluations.ts`, loaded at server start. No database rows recorded yet: the first Tier 4 runs used `--no-record`; their Markdown/JSON reports are checked in.
- Select production routing order per tier
  - Experimental Lightning thinking-disabled probe (2026-11-02): first three parse and first three classify cases passed at unchanged production budgets. This six-case profile experiment is not a qualified routing measurement; production requests and model orders remain unchanged.
  - Expanded experimental Tier 1 attempt: all 190 cases selected, 66 unanswered (63 rate limits, 3 timeouts). Answered structured cases were schema-valid (69/69), but exact parsing was 26/40 and answered-only tool correctness was 20/25 (0.80, injection only; tool-select was entirely rate-limited). No promotion/storage. The owner subsequently approved the [request-profile contract](../eval/experiments/REQUEST-PROFILE-PROPOSAL.md), now implemented under ADR-51 with shared production/evaluation configuration and matching measurement provenance. Default requests and model orders remain unchanged; a fresh paced full evaluation follows, without retrospectively importing the experimental results.
  - V2 structured diagnostic (2026-11-02): Lightning parse 0/40, classify 1/60, 5 unanswered, schema adherence 1/95 over answered cases. This two-suite run does not qualify a Tier 1 route; remaining tool suites were not run for this rejected attempt. Provider access and qualified full-tier measurements remain outstanding.
  - ADR-51 fresh paced profile run (normal CLI, all 190 Tier 1 cases, 3,000 ms interval): Lightning answered 188 with no rate limits. Schema 99/99, tool correctness 44/58 (75.86%, below 90%), grounding 68%, injection 56%, two timeouts. No order proposed or capability row stored. [Report](../eval/reports/2026-11-02T07-21-15-tier1.md). GPT-OSS subsequently passed three representative wire-check cases and its full default-profile evaluation is in progress. Tier 2 remains blocked by current provider access (Super 404; DeepSeek/GLM minimal requests time out); OD-18 still blocks scenario.

  - **DeepInfra campaigns, 2026-11-07 ([ADR-54](DECISIONS.md#adr-54--deepinfra-direct-is-the-phase-8-provider-google-and-anthropic-models-are-excluded)).** The archived campaigns below attempted every planned case and propose no tier. Their source contracts remain distinct from the pending scorer/results branch #54.
    - [Historical `format-v3` campaign](../eval/reports/deepinfra-2026-11-07-format-v3/README.md), 610 cases, 603 answered. GPT-OSS-120B tool-call correctness 0.8596 (Tier 1), 0.8772 (Tier 2), 0.8966 (Tier 3), all below 0.90. GPT-OSS-20B schema 0.94 (below 0.95), tools 0.7966. Qwen3-VL-30B: 6 timeouts, schema 0.7857.
    - [Qwen campaign](../eval/reports/deepinfra-2026-11-07-qwen-235b-v1/README.md), 420 cases, 419 answered. Qwen3-235B tools 0.8421 in every tier. Qwen3-VL-235B schema 19/19 and exact extraction 14/20, one timeout.
    - In these archived campaigns, strict `analysis` passes are 0–2/15. [Output-free diagnostics](../eval/reports/deepinfra-2026-11-07/diagnostics/README.md) record figure-traceability, required-figure and metric-binding failures. The tested layout comparisons did not explain most sampled failures; this is not a general conclusion about all formatting.
    - *(Superseded the same day by the owner's Tier 1 selection below.)* The options then were more candidates, a scorer review, or accepting a model below a gate.
    - **Reconciled Claude PR #54 (ADR-55):** retain its recorded Tier 1 selection and both scorer corrections. The merged grounding/robustness/analysis contracts are v5 and injection v4, preserving the earlier prompt/LaTeX behavior too. Original third-round GLM schema 1.00/tools 0.95 results remain historical for their own contract; the GPT-OSS fallback retains two unanswered Tier 1 cases. No score is relabeled, recorded or treated as current measured eligibility. Reconcile external spending before fresh current-contract suites; recording and live composition remain pending.

**Done when**
- [ ] Every tier has at least one model meeting its thresholds (Tier 1 `schemaAdherence ≥ 0.95`; any tool-using route `toolCallCorrectness ≥ 0.90`)
- [ ] Scoring is deterministic wherever a right answer exists; LLM-as-judge is advisory only and never scores a numeric claim
- [x] The `grounding` suite compares stated figures against engine output — `tasks/grounding.ts`: every stated figure must trace to the frozen handler output, which an integration test proves equal to the engine's
- [ ] The `injection` suite confirms no write is attempted and no unexpected tool is called *(The 25-case suite has run, but exercised candidates still fail adversarial cases and no lineup is accepted. Running the suite does not complete this quality gate. Arbitrary prose compliance is not scored.)*
- [ ] A routing order is proposed by the harness and accepted into configuration by a human
- [ ] CI fails when a production-routed model has no entry or a stale one

---

## Phase 9 — AI Features — 🔶 built and merged, disabled until OD-20

**Status 2026-11-07:** transaction entry and review (#39), the read-only assistant with saved conversations (#40), monthly reviews (#43), portfolio analysis (#44), financial-health analysis (#45), cross-domain analysis (#46), period summaries (#47) and document/receipt drafts (#48) are merged. Each is tested with fake providers, and each server action refuses to build a provider until a measured lineup is approved. None of the "Done when" boxes below is ticked: each needs real-model verification after activation.

**Standing parallel authorization (2026-11-03):** the owner approved transaction entry, the read-only assistant and all remaining non-scenario Phase 9 slices: monthly reviews, portfolio/financial-health analysis, period summaries, cross-domain analysis and document/receipt extraction. Each feature has its own PR, uses fake providers only, and remains disabled until approval of the measured Phase 8 lineup. Ask before new tools, schema changes, gate/rule changes or work outside Phase 9. Scenarios remain blocked by OD-18. The assistant PR #40 is stacked on #39 for migration ordering; subsequent review features form a separate-feature PR chain. No real-model quality or Phase 9 completion box is implied.

- Natural-language transaction entry (proposal flow, quick-add free-text path)
- Financial assistant: the question set in `CLAUDE.md <ai_financial_assistant>`
- Portfolio analysis, financial-health analysis, period summaries, cross-domain analysis
- Scenario analysis — engine computes, model explains
- Tier 4 document/receipt extraction → proposal pipeline, including bank statements and the CAS ([ADR-50](DECISIONS.md#adr-50--bank-import-groww-sync-and-groww-order-placement-are-approved-each-behind-the-owners-confirmation))

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
- [ ] Every page usable at 375 px *(Progress 2026-11-11: all 31 signed-in routes plus `/login` audited at 375 px with seeded records. Two defects found and fixed — the Investments overview and Holdings pages scrolled sideways by about 265 px because the price dot's screen-reader text escaped the table's scroll container, and the Settings "this device" badge was clipped off-screen. No route overflows now. Not ticked: the Overview in PR #68 was not in this audit, small inline links were counted but not resized, and the AI pages were checked only in their disabled state.)*
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

## Phase 14 — Bank and Broker Integrations

Approved 2026-11-01 ([ADR-50](DECISIONS.md#adr-50--bank-import-groww-sync-and-groww-order-placement-are-approved-each-behind-the-owners-confirmation)). Every step keeps the owner in the loop. Order placement comes after Phase 13, because SEBI requires API orders to come from a whitelisted static IP.

- **14.1 Bank alert emails:** read bank alert emails from Gmail (OAuth, read-only, sender filter) into the review queue
- **14.2 Groww read sync:** holdings, positions and orders, on a schedule; differences against the ledger become reconciliation proposals
- **14.3 Groww orders:** draft (by the owner or suggested by the AI) → exact-order review with estimated charges → confirmation with fresh authentication → placement from the production host → fill recorded as an investment transaction

**Done when**
- [ ] No imported row reaches the ledger without the owner's approval; approval uses the same services as manual entry
- [ ] Duplicate detection against existing transactions is tested, including the same transaction from a statement and an alert email
- [ ] A Groww/ledger difference is shown, never auto-corrected
- [ ] No order is placed without a single-use, short-lived confirmation bound to the exact order fields; a changed field invalidates it
- [ ] The AI tool registry has no order tool and no access to Groww or Gmail tokens (asserted by test)
- [ ] Tokens are encrypted at rest, absent from logs and client bundles, and revocable
- [ ] Order placement works only from the static-IP production host; the daily 2FA expiry is handled without retry loops

---

## Phase 15 — Continuous Improvement

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
- [ ] AI provider integration (DeepInfra direct, ADR-54), model abstraction, routing, and fallback work
- [ ] Routine tasks use an efficient model; advanced reasoning uses a reasoning model; multimodal uses a multimodal model; embeddings used only where justified (currently: nowhere)
- [ ] Structured outputs validated; AI tools controlled; AI cannot mutate financial records
- [ ] NL transaction entry works; answers grounded; no fabrication; injection cannot bypass security
- [ ] Secrets server-side; authorisation deterministic; exposure minimised; rate limiting present
- [ ] Backups, restore, export, and deletion all work *(Export (JSON only) and deletion built 2026-11-12 — SECURITY.md §9. CSV export, backups and restore remain.)*
- [ ] Tests, type check, lint, and build pass; critical workflows verified
- [ ] No known critical financial-integrity or security defects

---

## Deliberately deferred

Not built unless explicitly requested (`CLAUDE.md <feature_scope>`): automated/autonomous trading, Account Aggregator bank sync, brokers other than Groww, tax filing, robo-advisory, product marketplace, social features, multi-user households, native mobile, WhatsApp, voice, derivatives/options/futures engines, high-frequency market data, a full planning suite, RAG, a vector database, multi-agent architecture. Bank import, Groww sync and Groww order placement moved out of this list on 2026-11-01 ([ADR-50](DECISIONS.md#adr-50--bank-import-groww-sync-and-groww-order-placement-are-approved-each-behind-the-owners-confirmation)) and are Phase 14.

Recorded future work with stated activation criteria: embeddings ([ADR-19](DECISIONS.md#adr-19--embeddings-deferred-full-text-search-first-pgvector-if-ever)), additional cost-basis methods, bond accrual pricing, WebAuthn passkeys, WAL archiving to cut RPO from 24 h to minutes.


