# Project State

Durable status record. Conversation history is temporary; this file is not. Read this first after any context reset, then verify it against `docs/`, the source tree, and the tests before trusting it.

> **Read first — status as of 2026-10-31.** **Phase 7 (AI Infrastructure) is complete**: every ROADMAP Phase 7 "Done when" box is ticked, with the evidence named on each. **Phase 8 (Model Evaluation) started 2026-10-31**: the golden corpora are being built one suite per PR, starting with `parse`; the ADR-45 catalogue check is done and five evaluation candidates were added (see the [Phase 8 log](#phase-8-log)). Both hard drives that held working copies have failed; the repository lives on GitHub, and Claude, Codex and ChatGPT work from it through pull requests. The dated sections further down are historical records. For the recovery, the blocker register and the working rules, see [docs/RECOVERY-2026-10.md](docs/RECOVERY-2026-10.md).

**Last updated:** 2026-10-31 · **Current phase:** **8 — Model Evaluation, in progress** ([log](#phase-8-log)). Phase 7 — AI Infrastructure COMPLETE (steps 7.0–7.7; blockers B-1 … B-4, H-1 and R-1 … R-4 closed). Phase 6 remains complete (steps 6.0–6.9 and 6.11 implemented and verified; 6.10 closed unbuilt).

*The paragraphs from here to "Working protocol" are the 2026-08-30 record, kept as written.*

**Phase 7 pre-implementation correction pass — 2026-08-30.** The Phase 7 design review found three properties the canonical documents call non-negotiable that were **false** against the Phase 6.11 code (**F-1**, **F-2**, **F-3**). All three are now closed in code, with compile-time and automated regression protection, **before any AI infrastructure exists**. No provider, no SDK, no `NVIDIA_API_KEY`, no tools, no orchestrator, and no file under `src/server/ai/`. See [What step 7.0 delivered](#what-step-70-delivered--phase-7-pre-implementation-corrections--2026-08-30).

**Phase 6.11 — Net Worth at Market Value — is implemented and verified** (2026-08-27). `basis: 'market'` is a distinct, fully reconciled calculation alongside Phase 5's `cost`. **No schema change and no snapshots** were required, exactly as [docs/MARKET-VALUE-NET-WORTH-DESIGN.md](docs/MARKET-VALUE-NET-WORTH-DESIGN.md) §20 and OD-15 concluded.

**The default valuation basis remains `cost`** ([ADR-32](docs/DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view)). `market` is a fully supported alternate view, reached from an explicit link on the Net Worth page. **Neither replaces the other**, and Phase 5's cost methodology is untouched — asserted rather than assumed: a price arriving moves Net Worth at Cost by **zero** minor units, and the browser check confirmed the headline held at ₹76,90,000.00 across a price being recorded.

**1,396 tests pass** — 129 added in 6.11, and every Phase 3, 4, 5 and 6.0–6.9 test still passes. `verify:integrity` reports **33 passing, 0 failing, 19 engine-enforced, 2 deferred** — I-38 and I-39 promoted from deferred, I-41 and I-43 … I-49 added, and I-42 deliberately absent. Typecheck, lint, the production build and `check:no-client-secrets` are clean.

### What Phase 6.11 delivered

| | |
|---|---|
| Engine | `ValuationBasis` widened to `'cost' \| 'market'`; the basis is a property of component *construction*, so `compose()` carries it and never branches on it |
| The one new algorithm | `quantityHeldOn` (`domain/lots/quantity.ts`). `replay()` now emits a per-trade-date `quantityTimeline`, so the corporate-action ratio arithmetic has **one** implementation. Property-tested against a bounded replay across splits, bonuses and reverse splits (**I-46**) |
| Completeness | `MarketValuation` — `complete` / `partial` / `unavailable`, value-weighted investment coverage by base cost basis (**D-29**), excluded cost, staleness summary |
| Restatement | `domain/networth/restate.ts` — removed-unpriced, FX rebasis, price effect, each computed and none a residual, closing exactly (**I-48**, [ADR-31](docs/DECISIONS.md#adr-31--cost-to-market-is-a-restatement-at-an-instant-not-a-bridge-over-time)) |
| Performance | Indexed price lookup (`domain/pricing/price-series.ts`) and a memoised FX pair index. A 365-point market series runs in **80 ms** against the design's 123 ms baseline — `npm run bench:networth` |
| UI | `/net-worth` keeps its Phase 5 headline and gains one reciprocal line; `/net-worth/market` is the new, explicitly-labelled alternate view |

### Two findings from implementation, neither in the design

- **`ExclusionReason` gained `no_price_on_date`.** The seven `MissingPriceReason` members are verdicts about a *provider*, and none is true when the feed is healthy and has simply published nothing for a date before the instrument listed. Folding the historical gap into `not_found` would tell the user to re-map a symbol that is already mapped. The market-data union is untouched; this member exists on the net-worth exclusion type only.
- **`selectRate()` rebuilt its pair index on every call.** Invisible for the handful of conversions a single-date page makes, and dominant for a *series*, which asks once per foreign position per point. `rateSelector()` memoises the index per date; the resolution rule — identity → direct → inverse → triangulated, dated by the stalest leg — is unchanged, so every Phase 3/4/5 figure is byte-identical. **Found by the benchmark, not by a test**: the first measurement came in at 710 ms against the design's 123 ms, and the price index alone did not explain it.

**What now works that did not before:** Indian mutual funds price from **AMFI**; FX comes from **Frankfurter/ECB**, including by **triangulation** where no direct pair exists; equities and ETFs on NSE, BSE and three international venues price from **Twelve Data**; staleness is measured in **trading sessions**; and a provider corporate action cannot reach the ledger.

**OD-3 is resolved in code and open in configuration.** The Twelve Data adapter is built, tested and registered. `TWELVE_DATA_API_KEY` is **optional and not set here**, so equities currently report `no_provider` rather than a price — the application runs normally without it. **No live smoke test has been run**; `npm run smoke:market-data` is ready and exits with configuration guidance until a key exists.

This file also remains the **Phase 5 completion checkpoint** and carries the **Phase 6 design review** ([docs/MARKET-DATA-DESIGN.md](docs/MARKET-DATA-DESIGN.md)), whose findings **OD-10 approved and which are now applied**.

**1,049 tests pass** — 617 unit, 56 property, 376 integration. `verify:integrity` reports **27 passing, 0 failing, 8 enforced by the engine, 2 deferred to Phase 9**. Typecheck, lint and the production build are clean. **Signed-in browser verification passed**, finding and fixing two display defects.

**Infrastructure verified:** PostgreSQL **18.4** as the Windows service `postgresql-x64-18` (`Automatic` start, runs as `NT AUTHORITY\NetworkService`), independent of any shell or tool lifetime. Databases `financeos` and `financeos_test`, two least-privilege roles, connectivity confirmed by the 376 integration tests, `verify:integrity` against `financeos`, and a live signed-in browser session.

Sequence approved 2026-08-11: **Phase 3 — Money Management → Phase 4 — Investment Engine.**


---

## Phase 8 log

**2026-10-31 — catalogue check (ADR-45) done.** Two independent reads agree. One on the development PC (posted on PR #15: `npm run ai:catalogue` plus a direct read of `/v1/models`), and `npm run ai:catalogue` from a cloud session once its key and network access were set up. An earlier cloud attempt the same morning had no key and could not reach the host.

**85 models** (82 on 2026-09-03).

| Configured candidate | 2026-10-31 | In the catalogue instead |
|---|---|---|
| `nvidia/nemotron-3-super-120b-a12b` | present | — |
| `nvidia/nemotron-3-ultra-550b-a55b` | present | — |
| `nvidia/nemotron-3-nano-30b-a3b` (**Tier 1 primary**) | **still missing** | `nvidia/nemotron-nano-3-30b-a3b`, unchanged since 2026-09-03 |
| `google/gemma-4-31b-it` | present | — |
| `openai/gpt-oss-20b` | present | — |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | present | — |
| `nvidia/nemotron-3-embed-1b` | present | — |
| `deepseek-ai/deepseek-v4-flash` → `-0731` (Tier 2 fallback) | **now missing — new drift** | `deepseek-ai/deepseek-v4.1-flash` |
| `zai-org/glm-5.2` | absent, as before | `z-ai/glm-5.3-flash` |
| `nvidia/nemotron-nano-12b-v2-vl` | absent | `nvidia/nemotron-3.5-super-vl-120b-a12b`, the only new VL model |
| `deepseek-ai/deepseek-v4-pro`, `mistralai/mistral-medium-3.5-128b`, `qwen/qwen3-next-80b-a3b-instruct` | absent | — |

New since 2026-09-03: a `nvidia/nemotron-3.5-*` family. Its models are `lightning-30b-a3b`, `super-vl-120b-a12b`, `bolt-e4b`, `embed-1b`, `embed-8b` and `content-safety`.

**What this means for routing today, which is unchanged (ADR-41):**
- **Tier 1** serves through `openai/gpt-oss-20b`. Its primary costs one failed attempt per breaker window.
- **Tier 2** is now down to one live model, `nemotron-3-super-120b-a12b`, because its DeepSeek fallback is gone.

**Five evaluation candidates added**, approved by the owner. They are in `EVALUATION_CANDIDATES` in `src/server/ai/config/models.ts`. None is in a tier order or reachable by name normalisation (asserted in `ai-routing.test.ts`), and `ai:catalogue` now reports each one.
- Tier 1: `nvidia/nemotron-nano-3-30b-a3b` and `nvidia/nemotron-3.5-lightning-30b-a3b`.
- Tier 2: `deepseek-ai/deepseek-v4.1-flash` and `z-ai/glm-5.3-flash`.
- Tier 4: `nvidia/nemotron-3.5-super-vl-120b-a12b`.

A candidate enters routing only after it has a measured capability entry and a human accepts the proposed order.

**Environment note.** Node 22's built-in `fetch` ignores `HTTPS_PROXY`, so behind the cloud egress proxy every AI script fails with `transport — fetch failed` (DNS `ENOTFOUND`). The fix is to run with `NODE_USE_ENV_PROXY=1`. No code change was made: the PC has no proxy, and production should not depend on one.

**2026-10-31 — `parse` corpus built** (`src/server/ai/eval/tasks/parse.ts`, 40 cases, suite version 1). Cases: plain expenses, income, four transfer shapes (between own accounts, credit-card bill, ATM to cash, wallet top-up), shorthand amounts (k, lakh), Indian digit grouping, six non-INR cases, relative and boundary dates (month end, 29 February, the year before), missing and ambiguous input, adversarial text inside the input, and Hinglish. Scoring is deterministic. Two changes came with it:

- **The harness reported field accuracy as `schemaAdherence`.** `schemaValid` was set to `passed`, so a well-formed proposal with a wrong date lowered the number the Tier 1 ≥ 0.95 gate reads. A case can now supply `checkSchema`, and the parse suite does.
- **`TransactionProposal.amount` is nullable** (AI-SYSTEM.md §9). With a required amount, an input that states no amount had no schema-valid answer except an invented one.

`TransactionProposal` and the parse prompt now exist in code (`ai/proposals/schemas.ts`, `ai/prompts/parse-transaction.ts`), because the suite has to measure what production will send. Phase 9 reuses both; the proposal flow itself is still Phase 9.

**2026-10-31 — #15 merged; `classify` corpus built** (`src/server/ai/eval/tasks/classify.ts`, 60 cases, suite version 1). The cases cover every leaf of the default category tree, Indian merchants and Hinglish, raw bank-statement text (UPI, POS, NEFT, BIL, INT.PD), descriptions that state no purpose, adversarial text and income. The answer is a category **path** (`"Food > Dining"`). The response schema makes it an enum of the user's paths for the transaction's kind, plus `null` for "cannot tell", so an invented or wrong-kind category fails validation rather than scoring as a near miss. Scoring is exact: the most specific right path. A second path is accepted only where either is defensible, and `null` only where the description gives no purpose.

The schema (`categorySuggestionSchema` in `ai/proposals/schemas.ts`) and the prompt (`ai/prompts/classify-transaction.ts`) are the ones Phase 9 will use. The fixture tree is restated in the suite, because the AI layer may not import `db/`; a test asserts it equals `DEFAULT_CATEGORIES`.

**2026-10-31 — #16 merged; `tool-select` corpus built** (`src/server/ai/eval/tasks/tool-select.ts`, 30 cases, suite version 1). Each case is a finance question asked on a fixed date (2026-10-15, a Thursday). The model gets the production tool registry. Every registry tool is expected by at least one case. The cases cover spending and cash flow, budgets and recurring bills, balances, net worth (cost and market basis, one date or a series), investments, two questions that need two tools each (cash against upcoming obligations; loans, where a loan tracked as an account has its balance in `get_accounts`), two questions that need no tool (a concept, and a write request the read-only tools cannot do), and an attempt to pass a `userId`. Only the first turn is scored, and scoring is deterministic:
- Every call must name a registry tool, and its arguments must pass that tool's own `.strict()` schema, the same check dispatch makes.
- Every call must match an expected call, arguments included. "Last month" is any `asOf` in September; the current month may also be omitted. Dates and date sets are exact.
- A question that needs several tools passes when the first turn calls any of them correctly.

Two changes came with it:
- **The harness counted a correct "no call" as a tool-call failure.** `toolCallValid` was `toolCalls.length > 0 && passed`, so a model that rightly answered a concept question without a tool lowered `toolCallCorrectness`. A case can now supply `checkToolCalls`, and the tool-select suite does.
- **The `answerFinanceQuestion` prompt now exists** (`ai/prompts/answer-finance-question.ts`). It sends the date, the weekday, the base currency and the rules, but no account or category list. Phase 9 reuses it.

**Finding, not fixed here:** AI-SYSTEM.md §8 describes a `categoryNames` argument on `get_expense_summary`, resolved server-side. The registry has no such argument. So "how much did I spend on food" is answered from a category breakdown, which the suite expects. Whether to add `categoryNames` is for the `grounding` suite to decide.

Next: `grounding`, `scenario`, `injection`, `robustness`, `document`, `analysis`; then the `ai:eval` runner.

**2026-10-31 — `routing` corpus and the escalation classifier built** (`src/server/ai/eval/tasks/routing.ts`, 59 cases, suite version 1; `src/server/ai/orchestrator/escalation.ts`). AI-SYSTEM.md §6.2 assigns Tier 1 → Tier 2 escalation to a deterministic classifier in application code, which did not exist; `escalated()` was its only half. No model runs in this suite: each case is a user message, optionally after a previous message and its tier, labelled with the tier §6.4's rule gives it (one tool call answers it → Tier 1). The classifier gets **59 / 59**, with zero over- and under-escalations. The corpus covers:
- plain Tier 1 questions, and keyword lookalikes that must stay Tier 1 (the Health spending category, "SBI vs HDFC" on one date, food against transport in one month, "driving lessons" and an audit fee as expenses, a filter phrased with "if", "more than ₹5,000");
- the five Tier 2 triggers: review or analysis, multi-period comparison, scenario, "why" or "how has X changed", and cross-domain, which needs two domains (cash against upcoming obligations escalates, food against total expenses does not; "how much of my net worth is invested?" stays Tier 1, because one result carries both figures);
- the sticky-escalation trap (a Tier 2 review, then "what's my HDFC balance?" → Tier 1) and dependent follow-ups ("and last year?", "break that down") that inherit the previous tier, Tier 1 included ("why?" after a simple answer stays Tier 1), while a complete question after "and" or "but" does not;
- wording aimed at the router ("use the biggest model", "switch to Tier 3"), which changes nothing. No message reaches Tier 3.

**Reconciliation, for the owner to confirm.** SECURITY.md §8 says tier is "never inferred from user text"; AI-SYSTEM.md §6.2 classifies the user's message. The classifier reconciles them by what §8 protects against: it can choose only Tier 1 or Tier 2, only for the two capabilities with `allowTierEscalation` (`answerFinanceQuestion`, `summarizeFinancialData`), and both tiers get the same read-only tools. Text can make a request costlier (bounded by the daily budget), never more permissive. The classifier is not yet wired into a request path; Phase 9's assistant calls it.
---

## Working protocol — applies to every phase from 2 onward

Approved by the user on 2026-08-09. The architecture documents in `docs/` are the **implementation baseline**.

Before implementing any phase:

1. Read the relevant architecture documentation.
2. Inspect the existing implementation.
3. Identify dependencies on existing code.
4. Implement **only the current phase**.
5. Test it.
6. Fix failures.
7. Verify the actual workflow.
8. Update documentation **only when implementation materially changes the architecture**.

**Do not silently redesign major architecture during implementation.** If a major architectural problem is discovered: **stop before making the change**, explain the issue and the proposed correction, and wait.

Corollaries that follow from the above:
- No scope creep into a later phase, even when it looks cheap.
- No new runtime dependency without a justification line ([ARCHITECTURE.md §3](docs/ARCHITECTURE.md)).
- A phase is complete only when every box in its `ROADMAP.md` "Done when" list is ticked — including typecheck, lint, and a passing production build.
- Documentation edits during implementation should be corrections and additions, not redesigns. A redesign is a stop-and-explain event.

---

## What exists

| | |
|---|---|
| `docs/` | 14 documents — the approved architecture baseline, plus three **non-normative review records** ([INVESTMENT-ENGINE-DESIGN.md](docs/INVESTMENT-ENGINE-DESIGN.md), [NET-WORTH-DESIGN.md](docs/NET-WORTH-DESIGN.md), [MARKET-DATA-DESIGN.md](docs/MARKET-DATA-DESIGN.md)). |
| `CLAUDE.md` / `AGENTS.md` | The specification. Byte-identical duplicates (see OD-2). |
| `Workflow Setup.txt` | Canonical 15-phase map ([ADR-20](docs/DECISIONS.md)) |
| Application code | **Phases 2–5.** Next.js 16, exact-money primitives, database, auth, app shell; the money core (accounts, categories, tags, transactions, transfers, budgets, recurring rules, the job runner and the Money UI); the investment engine (instruments, the investment ledger, the FIFO lot engine, positions, valuation, allocation, XIRR/TWR and the Investments UI); and **Net Worth at Cost** (manual assets, liabilities, the contributions map, date-driven as-of aggregation, reconciliation, the change bridge and the Net Worth UI). |
| Git repository | Initialised, `core.autocrlf=input`. Phases 2–5 are committed on `claude/net-worth-architecture-review-7b1dc5`, which carries the Phase 5 design review, its correction pass, and the Phase 5 implementation. |

## Phases

| Phase | Status |
|---|---|
| 0 — Environment & Repository | ✅ complete |
| 1 — Architecture | ✅ complete, **approved** |
| 2 — Foundation | ✅ complete, verified |
| 3 — Financial Core | ✅ complete, verified |
| 4 — Investment Engine | ✅ complete, verified |
| 5 — Net Worth at Cost | ✅ **complete, verified** |
| 6 — Market Data | ✅ **complete, verified.** 6.0–6.9 and **6.11** implemented; **6.10 closed — not built** (OD-15). No open decision remains |
| 6.5 — Recovery (Oct 2026) | ✅ repository rebuilt from the failed drives and published to GitHub — [docs/RECOVERY-2026-10.md](docs/RECOVERY-2026-10.md) |
| 7 — AI Infrastructure | ✅ **complete, 2026-10-26.** 7.0–7.7 built; the Phase 8 entry-gate blockers closed (PRs #5–#12, #14) |
| 8 — Model Evaluation | **in progress** since 2026-10-31: golden corpora being built, one PR per suite (`parse`, `classify` and `tool-select` done). No model measured yet — see [Phase 8 log](#phase-8-log) |
| 9–14 | not started |

---

## Local environment — how to run it

| | |
|---|---|
| PostgreSQL | **18.4**, installed at `C:\Program Files\PostgreSQL\18`, data at `C:\Program Files\PostgreSQL\18\data`. |
| Service | **`postgresql-x64-18`**, start type `Automatic`, running as `NT AUTHORITY\NetworkService`. **Starts with Windows.** Nothing in this project starts or stops it. |
| Start / stop | `Start-Service postgresql-x64-18` / `Stop-Service postgresql-x64-18` from an elevated shell. Ordinarily neither is needed. |
| Databases | `financeos` (development), `financeos_test` (integration tests, truncated between test files) |
| Roles | `financeos_migrator` owns the schema and is the only role with DDL. `financeos_app` has DML only, INSERT/SELECT on `audit_log`, SELECT on `currencies`. |
| Credentials | Development-only, in `.env` (git-ignored). Regenerate for production. |

Also installed by the PostgreSQL 18 installer and **not used by this application**: `pgagent-pg18`, and PgBouncer on port 6432. The application connects directly to 5432 — connection pooling is deferred until there is a measured need ([ARCHITECTURE.md §10](docs/ARCHITECTURE.md)).

```
npm run db:migrate            # apply migrations + re-apply grants
npm run db:seed               # idempotent reference data + default categories
npm run db:rollback           # reverse the newest migration
npm run auth:create-user -- --email you@example.com     # password in FOS_PASSWORD
npm run verify:integrity      # check the financial invariants against real data
npm run bench:networth        # the Phase 6.11 performance measurement, repeated
npm run jobs:run              # drain the job queue once (cron drives this)
npm run dev | build | start
npm test                      # unit + property + integration
```

**The database needs no babysitting.** It runs under the Windows Service Control
Manager (`postgres.exe ← pg_ctl.exe ← services.exe ← wininit.exe`), so it is not
in any shell's process tree and survives a terminal closing, a tool teardown and
a reboot alike. During Phase 3 the database was a portable instance started by
hand; it was repeatedly killed by console-close events mid-test-run, and a
`db:ensure` script existed to resurrect it. Both the script and the problem are
gone — see **D-23**.

There is **no signup page**. The account is provisioned from the host, which makes login the only unauthenticated endpoint in the application.

---

## What Phase 2 delivered

| Area | Where |
|---|---|
| Exact money | `src/lib/decimal/` — `Money` (bigint, scale 4), `Quantity` (8), `Rate` (10), four rounding modes, `allocate` |
| Calendar dates | `src/lib/date/` — ISO strings, not `Date`; leap years, month clamping, epoch-day arithmetic |
| Environment | `src/lib/env.ts` — Zod-validated, fails fast, one place `process.env` is read (enforced by lint) |
| Errors | `src/lib/result.ts` — `Result<T, DomainError>`; `app/error.tsx` shows a correlation ID, never a stack trace |
| Logging | `src/server/log.ts` — structured JSON with a redaction pass that removes credentials **and financial figures** by field name |
| Database | `src/server/db/` — 9 tables, 3 enums, one checked-in migration, hand-written down migration, idempotent seed, least-privilege grants |
| Authentication | `src/server/auth/` — Argon2id (128 MiB, measured 337 ms), mandatory TOTP, 10 recovery codes, opaque sessions stored as SHA-256, lockout, rate limiting |
| App shell | `app/` — six areas, responsive sidebar/bottom nav, honest empty states, nonce-based CSP in `proxy.ts` |
| Tests | 282 across unit / property / integration; CI in `.github/workflows/ci.yml` |

### Decisions taken during implementation

Each is reversible; the reasoning is recorded so it can be challenged.

| # | Decision | Why |
|---|---|---|
| **D-9** | ~~Portable PostgreSQL 17 rather than Docker Desktop~~ — **superseded by D-23** | Was D-4's documented fallback, chosen because it needed no admin rights, no reboot and no hypervisor. It worked, but a postmaster with no service manager behind it is killed whenever the console that started it closes. Kept here rather than deleted, because the reasoning explains why the project ran on a portable instance for its first two phases. |
| **D-10** | Two database roles from day one | SECURITY.md §2 requires it in production; doing it in development means a missing grant fails a test rather than a deploy. Integration tests run as the application role. |
| **D-11** | Auth rate limits derived from `auth_events` | SECURITY.md §6 requires Postgres-backed limits. Every attempt already writes a row, so counting rows in a window needs no new table and cannot drift from the audit trail. |
| **D-12** | Account provisioning by CLI, no signup route | Single-user application. A registration endpoint would be an unauthenticated write path existing only to be attacked. |
| **D-13** | Hand-written down migrations + `db:rollback` | drizzle-kit generates forward migrations only, and ROADMAP Phase 2 requires clean rollback. A schema-fingerprint test asserts migrate → rollback → migrate is identical. |
| **D-14** | `SESSION_COOKIE_SECRET` signs the TOTP challenge cookie | SECURITY.md §3 lists the secret but §1's design never consumes it. The half-finished login between the password and TOTP steps needed exactly one signed, short-lived carrier. The session cookie remains an unsigned opaque token whose SHA-256 is stored, per §1. |
| **D-15** | Argon2id at 128 MiB / 3 passes | Measured, not copied: 64 MiB gave 158 ms against SECURITY.md §1's ≥250 ms floor. The table of measurements is in `src/server/auth/password.ts`. Memory was raised rather than passes, because memory hardness is what degrades GPU attacks. |
| **D-16** | Decimal input rejects malformed digit grouping | `1,5` means one and a half in much of Europe. Stripping commas blindly would read it as fifteen — a tenfold error entered silently. Both Indian and Western grouping are accepted; anything else is rejected. |

---

## What Phase 3 delivered

| Area | Where |
|---|---|
| Schema | `src/server/db/schema/money.ts` — 9 tables, 7 enums, migration `0001`, hand-written down migration |
| Shape triggers | `check_transaction_shape()` (deferred constraint trigger, I-1/I-2/I-3) and `check_category_shape()` (two levels, matching kind) |
| Engine | `src/server/domain/` — `buildEntries`, `assertEntryInvariants`, `deriveBalance`, cash flow, budget status, category rollup, FX selection, the one `ratio()` |
| Recurrence | `src/lib/date/rrule.ts` — RFC 5545 subset, with month-end **clamping** rather than skipping |
| Periods | `src/lib/date/periods.ts` — monthly, fiscal-aligned quarters, fiscal years |
| Services | `src/server/services/` — accounts, categories, tags, transactions, transfers, budgets, recurring, cash flow, reference; `ReadCtx`/`WriteCtx` as the write boundary |
| Jobs | `src/server/jobs/` — `FOR UPDATE SKIP LOCKED` runner + `recurring.post` |
| Formatting | `src/lib/format/` — exact digit grouping, Indian and Western, no float in the path |
| Integrity | `src/server/db/integrity.ts` + `npm run verify:integrity` — I-1…I-4, I-9, I-11 checked; the rest reported as not yet applicable |
| UI | `app/(app)/money/` — hub, accounts + ledger, transactions with filters, categories, budgets, recurring |
| Tests | 663 across unit / property / integration, including golden scenario **G1** |

### Decisions taken during implementation

| # | Decision | Why |
|---|---|---|
| **D-17** | `transactions.ai_proposal_id` and `recurring_occurrences.investment_transaction_id` deferred | Both are foreign keys to tables that do not exist until Phases 7 and 4. Adding the column early would ship half of an unreviewed phase. |
| **D-18** | Cash-flow totals are summed in the engine over fetched rows, not in SQL | The headline figure and every breakdown are then the same sum over the same array, so a category total that disagreed with the expense total would be arithmetically impossible rather than merely unlikely. Escape hatch if it ever gets slow: a roll-up keyed by `money_ledger_version`. |
| **D-19** | `MetricUnavailable` gained `out_of_range` | A property test produced a savings rate too large for `NUMERIC(20,10)` — ₹0.0001 of income against real spending. The previous code threw a `RangeError` out of a page render. Clamping was rejected: a clamped ratio is a wrong number that looks right. |
| **D-20** | The default expense category is **Business expenses**, not Business | `UNIQUE (user_id, parent_id, name)` does not include `kind`, so a top-level income *Business* and expense *Business* cannot coexist; `ON CONFLICT DO NOTHING` silently dropped one. Renamed rather than widening a reviewed constraint. `seedDefaultCategories` now refuses a list with duplicate top-level names. |
| **D-21** | `postOccurrence` claims and posts inside a **savepoint** | Returning an error from an open transaction does not undo the writes already in it. Without the savepoint a failed posting left the occurrence marked `posted` with no transaction — I-9 violated and a commitment silently never paid. Caught by an integration test. |
| **D-22** | `db:seed` tops up default categories for existing users | The account provisioned in Phase 2 had none, which left the money pages with no category to offer. Idempotent, so an account that already has them is untouched. |

### Decision taken after Phase 3

| # | Decision | Why |
|---|---|---|
| **D-23** | **PostgreSQL 18.4 as a Windows service, replacing the portable 17.7 (supersedes D-9)** | A postmaster started by hand belongs to the process tree of whatever started it, and dies with that console. It happened four times during Phase 3, each time looking like a test failure rather than an environment failure, and each recovery cost a manual restart. A service is owned by the Service Control Manager, starts with Windows, and cannot be reaped by a terminal closing. The migration was a logical dump and restore — verified metric-by-metric against the source, with roles, grants, schema, Drizzle history and data all preserved — so no connection string in `.env` changed. The 17.7 data directory is retained as a rollback until the new instance has some mileage. |

---

## What Phase 4 delivered

| Area | Where |
|---|---|
| Primitive | `src/lib/decimal/price.ts` — `UnitPrice` at scale 8, `valueOf` / `perUnit` / `mulQtyRatio`. `Money` is scale 4 and truncates a NAV at the read boundary. |
| Schema | `src/server/db/schema/investments.ts` — 7 tables, 3 enums, migration `0002`, hand-written down migration. Purely additive; no destructive statement. |
| Lot engine | `src/server/domain/lots/` — `replay()`, the FIFO `MatchingStrategy` (ADR-07's one seam), `kind_rank` ordering |
| Pricing | `src/server/domain/pricing/` — `PriceResult`, valuation with coverage, allocation across five dimensions, concentration with HHI |
| Metrics | `src/server/domain/calc/` — `portfolio.ts` (two denominators), `xirr.ts` (Newton + bisection), `twr.ts` (Modified Dietz, chain-linked) |
| Services | `src/server/services/` — instruments, investments, positions, portfolio, prices. Rebuild shares the mutation's transaction. |
| Integrity | I-5, I-6, I-7, I-12, I-13, I-15…I-20 added to `verify:integrity`; 21 checked, 3 deferred, both non-invariants deliberately unasserted |
| UI | `app/(app)/investments/` — overview, holdings, instrument detail with lots, ledger, allocation, performance, instruments |
| Tests | **249 added** — 150 unit, 13 property, 86 integration — taking the suite from 663 to **912**. Includes golden **G2** and **L1**. |

### Phase 4 final verification — 2026-08-11

The results the completion gate actually produced, not a summary of intent.

| Gate | Result |
|---|---|
| Unit | **549 passed** |
| Property | **47 passed** |
| Integration | **316 passed** |
| **Total** | **912 passed**, 0 failed |
| Typecheck (`tsc --noEmit`, strict) | clean |
| Lint (`eslint .`) | clean |
| Production build (`next build`) | clean |
| Migration apply → rollback → re-apply | **byte-identical schema fingerprint** — columns, constraints, triggers and functions |
| `verify:integrity` | **21 passing, 0 failing, 3 deferred** |
| Live browser workflow | **passed** — sign-in, instrument creation through the server action, a seeded ledger, and every Investments page rendering its hand-verified figures |

**Every Phase 3 financial test continues to pass.** Three Phase 3 test files changed, and in each case only because a phase-boundary expectation was **superseded by Phase 4** — none was weakened, and no assertion about a financial calculation was altered:

| File | What was superseded |
|---|---|
| `tests/integration/integrity.test.ts` | Asserted I-5, I-6, I-7 and I-12 were reported `skipped`. Phase 4 implements the tables they describe, so they are now checked. The test now asserts the opposite, plus that neither declared non-invariant is asserted. |
| `tests/integration/schema.test.ts` | Asserted `instruments`, `positions` and `tax_lots` did **not** exist. Phase 4 creates them; the guard now points at the Phase 5 and Phase 9 tables instead. |
| `tests/integration/migrations.test.ts` | Its `MIGRATIONS` list ended at `0001`. It now includes `0002`, so the rollback/re-apply fingerprint covers Phase 4 — including the first `ALTER TABLE … DROP COLUMN` in a down migration. |

`verify:integrity` checks **I-1, I-2, I-2b, I-3, I-4, I-4b, I-5, I-6, I-7, I-9, I-9b, I-11, I-11b, I-12, I-13, I-15, I-16, I-17, I-18, I-19, I-20**. I-6 is asserted **exactly, with no tolerance**. Three remain deferred and are reported as `skipped` rather than silently omitted: **I-8** (Phase 5), **I-10** and **I-14** (Phase 9).

### Decisions taken during implementation

Each was forced by a test rather than found by reading. Full rationale in [ROADMAP.md](docs/ROADMAP.md) Phase 4.

| # | Decision | Why |
|---|---|---|
| **D-24** | Partial cost consumption uses **flooring**, not `half_up` | [INVESTMENT-DOMAIN.md §4](docs/INVESTMENT-DOMAIN.md)'s pseudocode says `half_up`; its own prose says the residue is *retained*. Only `floor` does both, and only `floor` preserves **I-19** — a database `CHECK`. A lot with ₹0.0001 of basis over 10 units, selling 6, drains to zero basis with units remaining under `half_up`, and the row is rejected mid-rebuild. Found by a property test. No documented figure changes: every worked example divides exactly. |
| **D-25** | Three new database `CHECK` constraints | `inv_txn_acquisition_has_cost` (a purchase whose total rounds to zero would open a lot with units and no basis, failing I-19 mid-rebuild), `inv_txn_original_acquired_not_in_future` (would make `holding_days` negative and surface against `lot_disposals` rather than the row at fault), and `positions_units_and_basis_agree`. |
| **D-26** | `withWriteCtxResult` — atomic rollback for a command that returns an error | Returning an error from inside an open transaction does not undo the writes already in it. An investment mutation inserts its row and bumps `investment_ledger_version` **before** the rebuild can discover an oversell, so edge case 30 was unreachable without this. Generalises Phase 3's D-21 savepoint into the write boundary itself. |
| **D-27** | `ProportionBar` — static width classes instead of inline `style={{ width }}` | The CSP in `proxy.ts` sets `style-src 'self' 'nonce-…'`, which governs style **attributes**. The bars rendered at zero width in every browser with only a console violation to show for it. Phase 3's budget bar shared the defect; both now use `ProportionBar`. |

### Phase 4 scope boundaries and known limitations

Each of these is an **intentional roadmap boundary**, not a defect.

| Limitation | Where it is settled |
|---|---|
| **TWR returns `null` with reason `insufficient_price_history`** for every instrument. `instrument_prices` is empty because it is populated by `getHistoricalPrices()`, which needs the provider blocked on **OD-3**. The algorithm, its Modified Dietz form and its boundary convention are implemented and pinned by a test asserting both the correct figure and the figure the opposite convention would give. | [INVESTMENT-DOMAIN.md §8](docs/INVESTMENT-DOMAIN.md#8-time-weighted-return) |
| **No `MarketDataProvider` registry.** The `PriceResult` union and the staleness classification exist — they are the contract every future adapter returns — but nothing resolves an instrument to a provider. | Phase 6 |
| **No market-data adapters.** No AMFI, no FX, no commercial equity source. Prices are entered by hand into `instrument_quotes` through `setManualPrice`. | Phase 6, gated on OD-3 |
| **No `prices.refresh` job** and no scheduled price fetching. A read never triggers a network call, and there is no network call to trigger. | Phase 6 |
| **AI functionality is outside Phase 4 entirely.** No orchestrator, no tools, no proposals. Every investment figure is produced by `src/server/domain/`, which is what will make an AI answer unable to disagree with a screen when Phase 7 arrives. | Phases 7–9 |
| **`ai_proposal_id` is absent from `investment_transactions`**, following the precedent D-17 set on `transactions.ai_proposal_id`. Phase 7 adds both columns with their foreign keys and the partial unique index invariant **I-14** needs. | Phase 7 |
| **I-8 deferred to Phase 5; I-10 and I-14 deferred to Phase 9.** Reported by `verify:integrity` as `skipped` with the phase named. | [SCHEMA.md §12](docs/SCHEMA.md#12-invariants-summary) |
| **Unrealised FX is not separated** from unrealised price movement. `marketValue` uses the current rate while `investedCapital` uses acquisition rates, so `unrealizedPnl` legitimately contains both. Realised P&L **is** decomposed (I-18). | [INVESTMENT-DOMAIN.md §6.4](docs/INVESTMENT-DOMAIN.md#64-foreign-currency-positions) |
| **`average` and `specific_id` cost-basis methods are interface-only.** `strategyFor` rejects them rather than silently falling back to FIFO. | [ADR-07](docs/DECISIONS.md), [INVESTMENT-DOMAIN.md §4](docs/INVESTMENT-DOMAIN.md#4-cost-basis-engine-default-fifo) |
| **Recurring SIPs are not wired.** `recurring_occurrences.investment_transaction_id` and its foreign key exist; the `investment` recurring kind is still refused by the service layer, exactly as in Phase 3. | Not yet scheduled |

**One consequence of ADR-22 is documented but not yet implemented.** The decision requires the UI to make clear that displayed balances are **trade-dated rather than settlement-dated**; no screen says so today. The engine behaviour is already correct and needs no change — this is a copy addition on the surfaces that show a balance derived from the investment ledger (the accounts list, the account ledger, and the investment ledger's cash column). Recorded here rather than done as part of the OD-6 resolution, because resolving a decision is a documentation act and this is a UI change; it should be picked up by the next piece of work that touches those screens.

---

## Documentation correction pass — 2026-08-11

The Phase 4 design review found 15 defects (D1–D15) in the approved baseline. Under **OD-4** they were applied to the canonical documents; under **OD-5** the `net_amount` currency question was settled. No application code or schema changed.

| Document | What changed |
|---|---|
| `docs/INVESTMENT-DOMAIN.md` | Lot model (`cost_total` / `remaining_cost`, `cost_per_unit` derived); corrected FIFO engine (allocate, exact drain, gross income, zero-P&L transfers); `kind_rank` ordering; new §2.1 currency, §6.2 account-level charges, §6.3 worked verification, §6.4 FX decomposition; `UnitPrice`; XIRR scope; TWR boundary + OD-3 limit; edge cases 21–31 |
| `docs/SCHEMA.md` | `tax_lots` and `lot_disposals` DDL rewritten; 8 new `CHECK` constraints; 5 new indexes; `lot_disposals.user_id`; invariants I-15…I-20; two explicit non-invariants; OD-5 currency rules; forward-reference migration policy |
| `docs/FINANCIAL-DOMAIN.md` | Balance formula's currency contract (OD-5); account currency immutability; `UnitPrice` in §1; `allocate` rule made normative for the lot engine; investment module map |
| `docs/TESTING.md` | I-6 asserted exactly, tolerance removed; `UnitPrice` tests; order-independence property; DB-level constraint tests; XIRR scope and TWR boundary tests; golden **L1**; G2/G3 extended |
| `docs/ARCHITECTURE.md` | §6 rebuild trigger corrected — `positions.ledger_version` is a provenance stamp, not a staleness check; invariant count |
| `docs/DECISIONS.md` | ADR-06 (rebuild transaction + stamp), ADR-07 (I-6 restatement), ADR-12 (OD-5) |
| `docs/ROADMAP.md` | Phase 3 gains the five carried amendments and two gates; Phase 4 gains `UnitPrice`, the new edge cases and invariants, and its Phase 3 block |

**Verification run after the pass:** 154 anchored cross-document links and 67 plain file links all resolve; invariants I-1…I-20 are each defined once in `SCHEMA.md` §12 and referenced consistently; no stale `cost_per_unit`-as-column, `± 1 minor unit`, `(trade_date, created_at, id)` or `income += net` remains in a normative position. A seven-lens consistency audit with adversarial verification then ran across all nine documents.

### Corrections the audit forced — beyond D1–D15

| | Defect | Fix |
|---|---|---|
| **Blocking** | Applying OD-5 naively broke every per-kind cash identity. `net_amount = gross_amount − fees − taxes` equates an **account-currency** column with an **instrument-currency** expression — false for any foreign-currency row, so a USD dividend paid into an INR account would have been **rejected by the database**. Golden scenario `G3` asserts exactly that case | The cash effect is carried at three `CHECK`ed denominations: `net_amount_instrument` (where the identities hold) → `net_amount` (what `deriveBalance()` sums) → `base_net_amount`. Extends `transaction_entries`' ADR-12 pattern by one link |
| High | `positions.fees_total` / `taxes_total` accrued instrument-currency `fees` from dividends and account-currency `\|net_amount\|` from standalone `fee` rows — two currencies in one column | All `positions` totals are instrument currency; standalone rows accrue `\|net_amount_instrument\|` |
| High | `ARCHITECTURE.md` §5's read-path diagram still rebuilt positions "if version changed", which §6 of the same file forbids | Read path reads the cache as-is; rebuilds happen only in the write transaction |
| High | `FINANCIAL-DOMAIN.md` §10.1 still fixed replay order at `(date, created_at, id)`, omitting `kind_rank`, while explicitly naming the lot engine | Restated, with why `created_at` orders rows but not economic events |
| High | `PortfolioSummary` mixed base-currency `realizedPnl` with instrument-currency `investedCapital` | Every `PortfolioSummary` field is base currency; `HoldingView` stays instrument currency |
| High | *(pre-existing)* Net worth filtered accounts and assets on the current-state `is_active` flag inside an `asOf` calculation — an account closed today vanished from last year's figure, contradicting §12 edge case 7 | Every filter is date-driven; `manual_assets` gains `disposed_on` |
| Medium | `CLAUDE.md` requires "portfolio growth" with no canonical source defined | New [INVESTMENT-DOMAIN.md §8.1](docs/INVESTMENT-DOMAIN.md) — derived, one SQL pass, gaps shown as gaps |
| Medium | `ROADMAP.md` Phase 6 said "all ten invariants"; `PROJECT-STATE.md` said "14 invariants" and "no commit yet" | Corrected to twenty and to the actual history |

**One new rule decided during the pass:** a `transfer_in` / `transfer_out` carries **no fees or taxes** (`CHECK`), because a fee on a transfer-in contradicts "no cash effect", and one on a transfer-out has no basis to capitalise into and no realised P&L to reduce — it would vanish from total return. Demat transfer charges are a separate `fee` row.

---

## What Phase 5 delivered

| Area | Where |
|---|---|
| Schema | `src/server/db/schema/networth.ts` — 4 tables, 2 enums, migration `0003`, hand-written down migration. **Purely additive**: no `DROP`, no `ALTER` on any Phase 3/4 table |
| Domain | `src/server/domain/networth/` — `keys.ts` (source identity + the duplicate-rejecting contributions map), `eligibility.ts` (one date predicate per rule), `compose.ts`, `bridge.ts`, `reconcile.ts` |
| Ledger correction | `src/server/domain/ledger/balance.ts` — `accountRole()` now classifies by **sign** via one shared `sideOfAmount()`; `openingContribution()` and `existedAt()` gate the opening balance by `opening_date` |
| Services | `assets.ts` and `liabilities.ts` (the only writers) and a **read-only** `networth.ts` with no `WriteCtx` in any signature |
| Integrity | I-8, I-24, I-27, I-28, I-32 checked against real rows; I-21, I-22, I-23, I-25, I-26, I-29, I-30, I-31 reported as `engine` with the file and test that enforce each |
| UI | `app/(app)/net-worth/` — the figure, both sides grouped and drillable, history, the change waterfall, and assets/liabilities CRUD |
| Tests | **137 added** — 51 unit, 9 property, 77 integration — taking the suite from 912 to **1,049**. Includes golden **G4** and the two browser-found regressions |

### Phase 5 final verification — 2026-08-15

| Gate | Result |
|---|---|
| Unit | **617 passed** |
| Property | **56 passed** |
| Integration | **376 passed** |
| **Total** | **1,049 passed**, 0 failed |
| Typecheck (`tsc --noEmit`, strict) | clean |
| Lint (`eslint .`) | clean |
| Production build (`next build`) | clean — 25 routes, 5 of them net worth |
| Migration apply → rollback → re-apply | **byte-identical schema fingerprint**, now covering `0003` |
| Migration inspected before applying | no `DROP`, no `TRUNCATE`, no `ALTER` on a pre-existing table; every `ALTER TABLE` targets a table the same migration creates |
| Existing data preserved | row counts identical across all 25 pre-existing tables before and after |
| `verify:integrity` | **27 passing, 0 failing, 8 engine-enforced, 2 deferred** |
| Every Phase 3 and Phase 4 test | still passing |
| **Signed-in browser verification** | **passed** — see the table above |
| Net Worth routes unauthenticated | all five `307` to `/login?next=…` |
| Dev-server compile | no errors on any net-worth route |

**Golden scenario G4** — a home loan with EMIs, a credit card carrying a balance, and a car loan closed mid-period — passes with `unexplained` **exactly `0.0000`**.

### Phase 5 signed-in browser verification — 2026-08-17

Performed against the development account (`dev@example.local`, provisioned by
`npm run dev:login` — see *Development sign-in* below), signed in through the
**real** password → TOTP → session flow. A demo dataset was seeded through the
application services so the figures below are hand-checkable.

| Checked | Result |
|---|---|
| `/net-worth` renders signed in | ✅ headline ₹75,90,000 = assets ₹99,35,000 − liabilities ₹23,45,000, matching the hand-computed figure |
| Labelled **Net Worth at Cost** | ✅ page title, headline label, and the basis banner |
| Asset breakdown | ✅ grouped: Cash and bank, Other assets, Brokerage cash, Investments (at cost), Property — each row drillable |
| Liability breakdown | ✅ Credit cards, Loans, with per-row detail |
| Reconciliation | ✅ *"Reconciled: 8 sources, checked by a second independent sum"* |
| Drill-down | ✅ Net worth → Zerodha ledger: opening ₹1,00,000, buy −₹60,000, balance ₹40,000 — the single-counting story end to end |
| Historical / as-of | ✅ 12 month-ends; 2025 rows show only the 2024-opened account, every 2026-opened account absent |
| Currency formatting | ✅ Indian digit grouping throughout (₹99,35,000.00), `en-IN` |
| **No double counting** | ✅ brokerage cash ₹40,000 + INFY basis ₹60,000 = the ₹1,00,000 it started with, not ₹1,60,000 |
| **Overpaid credit card** | ✅ Amex at `+₹5,000` under **assets** — not zero, not a liability |
| Closed account historically | ✅ "Old savings", closed, still contributes ₹30,000 at every date from its opening |
| **Opening balances obey `opening_date`** | ✅ an account dated 1 Dec 2026 contributes nothing today, and ₹50,000 from that date |
| Trade-dated wording (ADR-22) | ✅ present on the net-worth page beneath the balances it qualifies |
| Change bridge | ✅ Jan→Jun: −₹40,000 savings + ₹6,00,000 revaluation + ₹2,00,000 liability change = ₹7,60,000 delta, **Unexplained ₹0.00** |
| Unrealised gain line | ✅ renders as `—` with *"not measured — at cost"*, never as ₹0 |
| Append-only proof | ✅ recording a valuation dated 1 Aug moved **today** to ₹76,90,000 and left 30 Jun and 31 Jul unchanged at ₹75,90,000 |
| Empty state | ✅ before seeding: ₹0.00, "Nothing on this side", full coverage — no fabricated figures |
| Error state | ✅ a duplicate-dated valuation is refused with a domain sentence, not a stack trace |
| Success state | ✅ *"Valuation recorded. Earlier figures are unchanged."*, page revalidated immediately |
| Console / runtime errors | ✅ none in the **production** build; the dev server's CSP inline-style noise is Turbopack's HMR client (measured, see known debt) |
| Mobile at 375 px | ✅ no horizontal overflow on any of the five net-worth routes |
| Redirects after auth | ✅ none; every route returns 200 signed in, and 307 to `/login?next=…` signed out |
| Phase 3 Money pages | ✅ accounts list, balances, available credit, closed-account flag all correct |
| Phase 4 Investments pages | ✅ INFY 600 @ ₹100, invested ₹60,000; unpriced → market value, unrealised and return all `—` with a coverage note, never `0` |

**Two defects found and fixed**, both surfaced only by looking at rendered pages:

| | Defect | Fix | Regression test |
|---|---|---|---|
| 1 | An **overpaid credit card was grouped under "Cash and bank"**. The figure and the side were right (ADR-25), but a receivable from a card issuer filed beside a current account reads as spendable money | `accountGroup()` classifies on side first: a `credit_card`/`loan` in credit is **Other assets** | 4 cases in `networth.test.ts` covering card-in-credit, loan-in-credit, card-in-debit and an overdrawn bank account |
| 2 | A **future-dated account reported its opening balance as money held today** on the accounts page, while net worth correctly excluded it — two screens, one account, two figures. `FINANCIAL-DOMAIN.md` §3 says the default bound is *today*, not "unbounded"; the gate treated it as unbounded | `toView` gates the opening balance by `asOf ?? ctx.today` | asserts the account read **and** net worth both report `0` today, and both report ₹50,000 from the opening date |

Neither changed a total that was already correct: the first moved a row between display groups, the second removed a figure that should never have been shown.

### Decisions taken during implementation

| # | Decision | Why |
|---|---|---|
| **D-28** | `AccountRole` gains a third member, `'none'` | ADR-25 classifies by sign, and a zero balance genuinely sits on neither side. Folding it into `'asset'` would have put a settled credit card under Assets at ₹0; folding it into `'liability'` is the defect ADR-25 exists to remove. One Phase 3 assertion inverted as a result — a repaid card in **G1** — and it is the only Phase 3/4 expectation Phase 5 changed |
| **D-29** | Coverage is a **component-count** ratio in Phase 5, not value-weighted | `FINANCIAL-DOMAIN.md` §9.3 asks for value weighting, but Phase 5's only exclusion cause is a missing FX rate — and a component with no rate has no expressible base value to weight by. `excluded` carries each component's native amount and currency so the magnitude is still visible. Phase 6's price-driven exclusions **are** value-weightable, because cost basis is known in base even when a price is not |
| **D-30** | `verify:integrity` gains two statuses, `engine` and `warning` | Eight net-worth invariants are not expressible as a query, and a SQL approximation of any of them would be a second implementation of net worth living in the checker — free to disagree with the engine. Reporting them with the file and test that enforce each keeps the report a complete account of I-1 … I-32 rather than falling silent. `warning` carries the gold-name heuristic, which a user can legitimately violate |
| **D-31** | The net-worth series is **one fetch, one fold per point** | ADR-24 rules out snapshots, so a 12-point history had to not be 12 computations. `loadSources()` fetches everything once with no date bound; the bound is a pure predicate applied per point. This is also what makes I-29 true by construction rather than by coincidence |
| **D-32** | An unvalued-but-held asset is excluded via an explicit `unvalued` flag | The first cut forced it down the `no_fx_rate` path with a ₹0.0001 sentinel, which put a lie in `excluded[].native`. A separate reason costs one enum member and lets the UI say "held, but not valued by this date" rather than "no exchange rate" |

### Fixed during implementation

Each was found by a test rather than by reading.

1. **`text + text` in the bridge's cost query.** Two `numeric` sums were each cast to `::text` and then added — string concatenation, which Postgres refuses. Summed as numerics and cast once. Caught by every bridge test at once.
2. **A blank optional field arrived as `''`, not `undefined`.** `z.string().trim().max(20).optional().or(z.literal('')…)` never reaches the `.or`, because `''` satisfies the first branch — so `interestRate` on an untouched form failed `Rate.parseUserInput('')` with a required-field error. `.min(1)` before `.optional()` is what makes the fallback reachable.
3. **`eslint.config.mjs` would not load at all — a tooling compatibility fix, retained deliberately.** Since `eslint-config-next@16.3.0` the config object declaring the `react`, `import` and `jsx-a11y` plugins carries a `files` glob; this project's global rules object had none, so it referenced `react/no-danger` for file types where the plugin was out of scope and ESLint refused the whole configuration. **Pre-existing** — it failed identically on the Phase 4 tree — and fixed here because the completion gate requires lint to run. It is a one-line `files` scope matching the upstream glob, changes no rule and disables no check, and is **kept rather than reverted**: without it `npm run lint` cannot execute at all, so the verification gate could not be met. Revisit only if a future `eslint-config-next` drops the glob.

---

## Phase 5 design review — 2026-08-12

**Design and architecture only. Nothing was implemented.** No application code, schema, migration, service, API or UI changed; `0003_phase5_net_worth.sql` does not exist. The output is [docs/NET-WORTH-DESIGN.md](docs/NET-WORTH-DESIGN.md) — a review record with the same standing as `INVESTMENT-ENGINE-DESIGN.md`: **non-normative**, and where it and a canonical document differ, the canonical document wins until OD-9 is approved.

### What it settles

| Area | Conclusion |
|---|---|
| **Single counting** | A structural property of Phase 3/4, not something Phase 5 invents: one `investment_transactions` row debits brokerage cash by exactly what the lot it opens gains, so cash and positions are already disjoint. Phase 5's contribution is to make it *checkable* — a `contributions: Map<SourceKey, Money>` that throws on a duplicate, plus a second-path reconciliation |
| **Account classification** | **By sign, not by kind.** `balance > 0` → asset, `< 0` → liability, `= 0` → neither. Kind decides the display group and the expected sign only |
| **Historical / as-of** | One eligibility table, every row date-driven. `is_active` is read by **no** calculation, on any table — asserted by a source scan, not by review |
| **Investments as of `T`** | Derived from `tax_lots` / `lot_disposals` bounded by `opened_on` / `closed_on` — **not** from `positions`, which is today's cache. Exact for three reasons: splits and bonuses touch no money, FIFO has a prefix property, and I-20 makes the subtraction residue-free |
| **Valuation basis** | `basis ∈ {'cost','market'}`; Phase 5 implements `'cost'` and presents **Net Worth at Cost**, Phase 6 adds `'market'` as a distinct calculation and flips the default. The two are **never mixed inside one figure** |
| **Liabilities** | Two shapes. Transacted (linked account) contributes **nothing** — the account does. Scheduled contributes from an append-only balance series. Interest stays descriptive; no amortisation is computed |
| **Manual assets** | The existing model is sufficient. Valuations are a series, not a field. Four corrections, none of them an expansion |
| **Snapshots** | **Moved to Phase 6.** The history series is five set-based queries, so the performance case disappears — and the cache as specified cannot tell when it is stale (N13). Phase 5 derives everything; no gate depends on a snapshot |
| **Service shape** | `networth.ts` is read-only and exports **no** `WriteCtx` signature. Net Worth introduces no ledger and cannot mutate anything |

### 19 defects found in the baseline — **all applied 2026-08-12**

Recorded as **N1–N19** in [NET-WORTH-DESIGN.md §14](docs/NET-WORTH-DESIGN.md#14-defects-found-in-the-baseline-n1n19), with a per-finding disposition table. None was a live bug — no caller passes `asOf` and the Phase 5 tables do not exist — which is why they survived four completion gates. The three that mattered:

- **N2 (high).** `deriveBalance()` added `opening_balance` unconditionally, so an account opened in 2026 contributed its opening balance to net worth **as of 2020**. The date bound in `entryTotals()` correctly bounds *movements*; an opening position is not a movement. → [ADR-26](docs/DECISIONS.md#adr-26--an-as-of-financial-figure-is-computed-from-dated-facts-only-no-current-state-flag-participates), and the balance formula in [FINANCIAL-DOMAIN.md §3](docs/FINANCIAL-DOMAIN.md#3-accounts) now carries the gate.
- **N6 (high).** §9.3's *"Σ marketValue — priced holdings only"* would have reported investments as **₹0** in the current price-free state, directly contradicting `ROADMAP.md`'s *"net worth is an at-cost figure"* — a contradiction inside the canonical set. → [ADR-23](docs/DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost): a **declared basis**, `cost` in Phase 5, never mixed with market value.
- **N1 (high, and live).** `FINANCIAL-DOMAIN.md` §3 and `src/server/domain/ledger/balance.ts:88` disagreed about an overpaid credit card: §9.3 dropped it from net worth entirely, `accountRole()` reported it as a debt — a ₹10,000 spread on a ₹5,000 balance. → [ADR-25](docs/DECISIONS.md#adr-25--net-worth-classification-is-by-the-economic-sign-of-the-balance-not-by-account-kind): classification by **sign**. **This is the one code change the correction pass implies, and it is Phase 5 implementation work — no source file was touched.**

### Added to the canonical documents, not implemented

**12 new invariants — I-21 … I-32** — plus **I-8 restated**, in [SCHEMA.md §12](docs/SCHEMA.md#12-invariants-summary). The draft `NW-n` labels were folded into the canonical numbering so there is one authoritative scheme; draft `NW-11` was **dissolved**, because N11's correction (dropping the redundant `currency_code`) removes the disagreement it would have policed. Also: six explicit **non-invariants**, 43 adversarial scenarios mapped to named tests, twelve new net-worth edge cases in [FINANCIAL-DOMAIN.md §12](docs/FINANCIAL-DOMAIN.md#12-edge-cases-that-must-be-covered-by-tests), and an entirely additive schema delta ([§15](docs/NET-WORTH-DESIGN.md#15-schema-delta-proposal)).

### Four new ADRs

| | Decision |
|---|---|
| [**ADR-23**](docs/DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost) | Net worth carries a **declared valuation basis**; Phase 5 ships **Net Worth at Cost**; the two bases are never mixed in one figure |
| [**ADR-24**](docs/DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6) | Net worth is **derived on demand**; snapshots deferred to Phase 6, with four rules attached if they are ever built |
| [**ADR-25**](docs/DECISIONS.md#adr-25--net-worth-classification-is-by-the-economic-sign-of-the-balance-not-by-account-kind) | Classification is by the **economic sign** of the balance, not by account kind |
| [**ADR-26**](docs/DECISIONS.md#adr-26--an-as-of-financial-figure-is-computed-from-dated-facts-only-no-current-state-flag-participates) | An `asOf` figure is computed **from dated facts only**; no current-state flag participates |

---

## Development sign-in — local only

There is no signup route and no development bypass in the authentication code.
`src/server/auth/**` is untouched by this: the login flow has no dev flag, no
skipped factor and no back door, so signing in locally exercises the **real**
password → TOTP → session path with real Argon2id verification, the real replay
guard, and the real opaque session cookie.

The second factor is **TOTP**, not SMS or email — a code is *computed* from a
shared secret, so no message provider is involved and none needs stubbing.

```
npm run dev:login            # provision dev@example.local (once), then print a code
npm run dev:login -- --otp   # print a fresh code
```

| | |
|---|---|
| Account | `dev@example.local` — non-personal, `.local` is reserved and cannot resolve. Created **beside** the real account, which is never touched |
| Password | 24 random bytes, generated at provisioning, written to `.dev-credentials.json` (git-ignored, mode 0600). Never printed |
| OTP | `npm run dev:login -- --otp` — the script is an authenticator app for this one account |
| Production guard | Refuses on `NODE_ENV=production`, checked **before** touching the database or filesystem and again after `loadDotEnv`, so a `.env` cannot move the process into production behind the first check. Exits non-zero, writes nothing. Verified |
| Reachability | A `scripts/` entry point: never bundled, never imported by the application, never reachable over HTTP |

**Never create this account on a deployed host.** It exists so a local browser
can exercise the shipped login flow; it has no production counterpart.

---

## Phase 6 — Market Data · scope as planned (historical record)

The next phase. Nothing in it has been built: no provider, no adapter, no
refresh job, no price history, no market-value net worth, no snapshot table or
job.

**Purpose.** Give the investment engine prices. Phase 4 built cost basis,
realised P&L and the lot engine — none of which need a price — and Phase 5 built
net worth on that same at-cost footing. Phase 6 is where a price first enters
the system.

| What it unblocks | Why it is blocked today |
|---|---|
| **Market-value net worth** — `basis: 'market'` as a **distinct** calculation alongside Phase 5's `'cost'`. **The default remains `cost`** ([ADR-32](docs/DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view), superseding ADR-23 on this point); neither basis replaces the other | No price source. A single figure must never mix the two bases |
| **TWR** — returns `null` with `insufficient_price_history` for every instrument | `instrument_prices` is empty; it is populated by `getHistoricalPrices()`, which needs a provider |
| **Portfolio growth series** | Same: the series is only as complete as `instrument_prices`, and gaps render as gaps, never as zeros |
| **Unrealised P&L, portfolio return, market-value allocation** | Not computable without a price; each correctly reports `null` with a reason today |

**Open decision — OD-3, the equity/ETF market-data provider and its terms.** It
gates Phase 6's *completion*, not its start: the `MarketDataProvider` interface,
the registry, the `ManualProvider` and the AMFI adapter (free, official, no key)
can all be built before it is settled. It is a commercial choice about terms, not
an engineering one, and it is **not** resolved here — the canonical documents do
not require it for this checkpoint.

**Carried into Phase 6 from Phase 5, deliberately deferred:**

- `net_worth_snapshots`, the `networth.snapshot` job, and
  `user_state.valuation_version` ([ADR-24](docs/DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6)).
  Phase 5 derives every figure and stores nothing, so the performance case does
  not arise; a market-valued series that joins a price per instrument per date is
  where it might. If introduced, only under ADR-24's four rules — current is
  always derived, a historical point is read only on a full version match, the
  stamp set is completed first, and `verify:integrity` asserts snapshot =
  derivation.
- **Value-weighted coverage.** Phase 5 reports a component-count ratio (D-29),
  because a component with no FX rate has no expressible base value to weight by.
  Phase 6's price-driven exclusions **are** weightable: cost basis is known in
  base even when a price is not.
- **`quantityHeldOn` must apply corporate-action ratios**, not sum `quantity`
  ([INVESTMENT-DOMAIN.md §8.1](docs/INVESTMENT-DOMAIN.md#81-portfolio-growth-over-time)).
  A split carries `quantity IS NULL` and a ratio, so a plain running sum reports
  the pre-split quantity forever. Phase 5 was immune because money is invariant
  under corporate actions; Phase 6's market value is not.

**The Phase 6 basis switch will move net worth for FX reasons alone**, not only
price: the investment block is carried at acquisition rates under `'cost'` and at
spot under `'market'` ([FINANCIAL-DOMAIN.md §9.3](docs/FINANCIAL-DOMAIN.md#93-calculation)).
That belongs in the release note, not in a support conversation.

---

## Phase 6 design review — 2026-08-18

**Design and provider evaluation only. Nothing was implemented.** No source file, schema, migration,
service, API, UI or provider package changed; no dependency was installed. The output is
[docs/MARKET-DATA-DESIGN.md](docs/MARKET-DATA-DESIGN.md) — a review record with the same standing as
`INVESTMENT-ENGINE-DESIGN.md` and `NET-WORTH-DESIGN.md`: **non-normative**, and where it and a
canonical document differ, the canonical document wins until **OD-10** is approved.

Provider facts were **verified against official sources on 2026-08-17/18**, not recalled; anything
unconfirmable from an official page is marked `UNVERIFIED` in the document rather than guessed.

### What it settles

| Area | Conclusion |
|---|---|
| **Phase 6's real gate** | **OD-3 is step 6.9 of twelve, not the phase.** The two adapters that matter most for an INR-base portfolio are free, keyless and official: **AMFI** (Indian mutual-fund NAV, history to 2006) and a **central-bank FX feed**. Eleven of twelve steps are unblocked today |
| **The live gap** | `fx_rates` is empty, so **every non-INR component is excluded from net worth right now**. The FX adapter fixes a defect, not a feature — and it is free and needs no credential |
| **Asset coverage** | Only **three** of nine asset classes need a feed — mutual funds, equities, ETFs — and two share one adapter. Gold is an ETF, an MF, or a manual asset; FDs have no market price; bonds are better marked by the user |
| **Provider strategy** | **Three adapters plus Manual**, each the only good source for its domain. Not multi-provider for novelty: a vendor selling Indian MF NAV is redistributing AMFI's own publication, later and with its own mapping errors |
| **Fallback** | **No cross-provider price fallback.** Splicing two vendors' closes makes the discontinuity indistinguishable from a real price move. Manual is the only floor, always labelled |
| **Caching** | **PostgreSQL only — the two price tables already are the cache.** Volume is ~900 requests/month, three orders of magnitude inside every candidate quota. The binding constraint is coverage and licence, not volume |
| **Trading calendars** | **No table.** The stored price series *is* the calendar — a date with a row is a session. Cannot drift from the prices it describes |
| **Corporate actions** | **Detections, never ledger writes.** A `split` row drives `replay()` and therefore every lot, position and P&L figure; an adapter inserting one is an unvalidated external source mutating Layer 1 |
| **Cost** | MVP as specified: **₹0/month.** With OD-3: **₹500/mo** (Kite Connect) or **≈₹2,800/mo** (Twelve Data Grow, $29). Call volume costs nothing on any candidate plan |

### 13 defects found in the baseline — M1–M13

Recorded in [MARKET-DATA-DESIGN.md §21](docs/MARKET-DATA-DESIGN.md#21-defects-found-in-the-baseline-m1m13)
with a per-finding correction. **None produces a wrong number today** — `instrument_prices` and
`fx_rates` are empty, so every affected path reports a labelled gap, which is why they survived five
completion gates. Each would produce a silently wrong financial figure on the day a provider is
connected. The five that matter:

- **M5 (high).** An **unrecorded split** produces post-split price × pre-split quantity — an 80%
  phantom loss propagated into the portfolio, allocation, market-basis net worth and the change
  bridge, every figure internally consistent and all of them wrong. → **ADR-29**: detect and
  **suppress** with `unreconciled_corporate_action`; never adjust.
- **M4 (high).** Nothing prevents a provider-sourced corporate action from being written to
  `investment_transactions`. Same rule and same reason as `CLAUDE.md`'s AI mutation rule. → **ADR-29**,
  invariant **I-40**.
- **M1 (high).** `selectRate()` in `src/server/domain/fx.ts` resolves **direct or inverse only** — it
  cannot triangulate. An FX adapter storing a reference feed's native EUR-quoted rows would leave a
  USD holding in an INR-base portfolio with **no rate at all**, silently dropping the whole foreign
  block from net worth. → normalise **in the adapter**, request base-quoted pairs, record the
  derivation in `source`. `selectRate` stays the simple thing it is.
- **M2 (high).** `price_stale_after_hours = 24` against **end-of-day** data marks Friday's close stale
  all weekend and until Monday's close lands — every equity, every ETF, every mutual fund, every
  week. A permanently-on warning is an ignored warning. → **ADR-28**: staleness in **trading
  sessions**, with a 10-calendar-day backstop; wall-clock retained only for crypto.
- **M3 (high).** `NetWorthResult` has coverage and exclusions but **no field for "used, but old"**, so
  a market-basis figure built entirely from three-week-old closes has nothing to qualify it.

**Two things were checked and found correct**, recorded so they are not re-litigated: the
currency-mismatch guard at `price-result.ts:84`, and the future-dated-quote handling (`cached` at age
zero rather than discarded — a clock problem, still the best price available).

### Proposed, not applied

**Four ADRs** — ADR-27 (adapters return observations; the registry classifies freshness — *refines*
ADR-11), ADR-28 (session-based staleness), ADR-29 (corporate actions are detections), ADR-30 (one
provider per price series; no cross-provider blending). **Eight invariants**, I-33 … I-40, continuing
`SCHEMA.md` §12 which currently ends at I-32. One new table, `corporate_action_detections`, and three
additive column changes. **Twenty adversarial scenarios** are worked through in
[§24](docs/MARKET-DATA-DESIGN.md#24-adversarial-review), ending with the five places the design could
still produce an incorrect number.

### The two dependencies the review was asked to define precisely

- **TWR** ([§4](docs/MARKET-DATA-DESIGN.md#4-the-twr-dependency-precisely)) — five conditions.
  `twr.ts` **needs no change**; the entire gate is in the caller that builds the `valuations` array.
  Two traps: the boundary set must include instruments **since fully disposed** (a position sold in
  March still determined January's sub-period), and a boundary falling on a **non-trading day** needs
  a carried-back valuation or `twr.ts`'s exact key match refuses forever — which is every Indian user
  with a monthly SIP.
- **Market-value net worth** ([§6](docs/MARKET-DATA-DESIGN.md#6-market-value-net-worth--the-exact-dependency))
  — nine requirements. The contributions map is **unchanged**, so I-21 and I-22 hold without
  modification; only the investment block's amount differs.

---

## What Phase 6 delivered — steps 6.0 … 6.8 · 2026-08-18

| Area | Where |
|---|---|
| **6.0** Canonical corrections | M1–M13 **reconciled** into `DECISIONS.md` (ADR-27…ADR-30), `SCHEMA.md` (§5, new §5.1, I-33…I-40), `FINANCIAL-DOMAIN.md` (§2 rewritten with the resolution table, new §2.1 triangulation and §2.2 rate age), `INVESTMENT-DOMAIN.md` (§5 reasons table, §8.1 bounded carry-back, §10 rewritten, §11 detections, edge cases 32–40), `ARCHITECTURE.md`, `TESTING.md` (§6.1–6.6) |
| **6.1** Provider abstraction | `src/server/market-data/` — `types.ts` (observations, `ProviderFailure`, `ProviderCapabilities`), `registry.ts` (resolution, capability refusal, failure→reason), `http.ts` (injected `fetch`, timeout, 429/404/5xx normalisation), `index.ts` (`defaultRegistry`) |
| **6.2** Persistence | `corporate_action_detections` (new table), `instrument_prices.provider_ref`, `settings.price_stale_after_sessions`. Migration `0004`, hand-written down migration |
| **6.3** FX | `domain/fx.ts` gains **triangulation** through one pivot; `providers/frankfurter.ts`; `fx.refresh` job; base-quoted pair normalisation |
| **6.4** AMFI | `providers/amfi.ts` — `NAVAll.txt` parser, ISIN-first mapping, publication-instant stamping; `prices.refresh` job |
| **6.5** Historical observations | `services/market-data.ts` — `storePriceObservations` with the three guards; `backfillPrices`; `closeAsOf` with the **bounded** carry-back |
| **6.6** Freshness | `market-data/freshness.ts` — **one** classifier, sessions for `eod`/`nav`, hours for `continuous`, 10-day backstop; `PriceResult` gains `freshness` + `sessionsBehind`; four new `MissingPriceReason` members; the Investments price indicator now speaks in sessions |
| **6.7** Corporate-action safety | Detections only; `suppressedInstrumentIds` blanks a value rather than adjusting it; `dismissDetection`; I-40 source scan |
| **6.8** Tests | **128 added** — `freshness`, `fx-triangulation`, `market-data-adapters` (7 failure modes × 2 adapters), `market-data-registry`, `market-data-source-scan`, `market-data` integration |

### Verification — 2026-08-18

| Gate | Result |
|---|---|
| `npm test` | **1,177 passed**, 0 failed (58 files) — up from 1,049 |
| Every Phase 3 / 4 / 5 test | **still passing** |
| Typecheck (`tsc --noEmit`, strict) | clean |
| Lint (`eslint .`) | clean |
| Production build | clean — 23 routes |
| `verify:integrity` | **33 passed, 0 failed**, 9 engine-enforced, 4 deferred |
| Migration inspected before applying | **0 DROP / TRUNCATE / RENAME**, 0 standalone DELETE; every `ALTER` on a pre-existing table is `ADD COLUMN` or `ADD CONSTRAINT` on the new column |
| Migration apply → rollback → re-apply | fingerprint identical, now covering `0004` |
| Existing data preserved | row counts identical across all 29 pre-existing tables; `price_stale_after_sessions` backfilled to 3 |
| `check:no-client-secrets` | no secret in 19 client files |
| Provider isolation | source scan: no file outside `providers/` names a provider; no adapter reads `process.env`; all three declare `requiresCredential: false` |
| No ledger mutation | `investment_ledger_version` and the derived fingerprint byte-identical after a corporate-action detection |

### Decisions taken during implementation

| # | Decision | Why |
|---|---|---|
| **D-33** | **`PriceResult` gains `freshness` and `sessionsBehind` rather than renaming its `status`** | ADR-28 needs four states; the union already had `live`/`cached`/`stale`/`missing`. Renaming would have churned every Phase 4 call site to express the same thing. `freshness` is typed **per variant** — `'stale'` on the stale arm, `'current' \| 'recent'` on the cached arm — so the two fields cannot disagree. Two Phase 4 test fixtures gained the fields; no assertion about a figure changed |
| **D-34** | **Triangulation lives in `selectRate`, not only in the adapter** | The design proposed adapter-side base-pair normalisation alone. Both are implemented, because either alone leaves a gap: normalisation cannot help a pair nobody requested, and triangulation alone puts an avoidable rounding in the common case. The domain rule is the safety net and is tried **last**, after direct and inverse |
| **D-35** | **Suppression tests "held units before the ex-date", not merely "a detection exists"** | Someone who bought *after* a split already holds post-split quantity and their figures are correct. Suppressing those would blank a correct holding, which is its own dishonesty. Asserted both ways |
| **D-36** | **The session calendar is derived per exchange from `instrument_prices`, keyed `''` for instruments with none** | ADR-28 says the price series is the calendar. Mutual funds have no exchange and share a NAV publication rhythm, so they need a bucket rather than an exception |
| **D-37** | **`I-40` is split into a source scan plus a queryable `I-40b`** | "No adapter writes the ledger" is not expressible as SQL. What *is* expressible is that a resolved detection points at a ledger row for the same instrument, kind and user — so both halves are checked rather than one being asserted and the other assumed |

### Fixed during implementation

1. **`daysApart` passed a one-indexed month to `Date.UTC`.** 31 January would have become 3 March, so the carry-back bound was wrong on exactly the month-end dates it matters on. Replaced with the domain's property-tested `daysBetween`. Caught while reading the diff, before any test ran.
2. **A test fixture set `positions.quantity = 0` directly** and hit `positions_units_and_basis_agree` (D-25). The constraint is right and the fixture was wrong: a full disposal now goes through `recordSell`, so the test exercises a state the engine can actually produce.

### Scope boundaries — deliberately not built

| Not built | Why |
|---|---|
| **Twelve Data adapter** | OD-3. Step **6.9**, behind the credential/configuration step. No SDK installed; adding it is one file plus one line of `defaultRegistry()` |
| **Automated equity refresh** | Follows the equity adapter; there is nothing to refresh until one exists |
| **Crypto provider** | Deferred (**OD-11**). The `continuous` cadence and its wall-clock branch are implemented and tested, so enabling crypto is an adapter, not a rule change |
| **Dedicated gold provider** | Deferred (**OD-12**). Gold prices as an ETF or MF, or is a `manual_assets` valuation series |
| **Market-value net worth** | A later Phase 6 step. `ValuationBasis` is still the one-member union `'cost'`, so widening it stays a compile error at every site that must be considered. **I-38 and I-39 are reported as deferred**, not silently omitted |
| **Net-worth snapshots** | ADR-24 — only if measurement justifies them, and nothing has been measured slow |
| **AI market-data analysis** | Phases 7–9 |
| **Corporate-action provider feed** | No shipping adapter supplies one, so `corporate_actions.refresh` ordinarily returns `unsupported`. The **detection, storage and suppression path is complete and tested** — what is missing is a source, not the safety machinery |
| **Historical backfill from a provider** | AMFI's daily file carries one NAV per scheme, so `getHistoricalPrices` is not implemented for it and `backfillPrices` correctly reports the refusal. History accumulates one session per day from the daily refresh, and arrives in bulk with the equity adapter |

---

## What step 6.9 delivered — Twelve Data · 2026-08-18

**The abstraction held.** The adapter is one new file in `providers/`, one entry
in `defaultRegistry()`, and one optional environment variable. **No file above
`src/server/market-data/` was modified to accommodate it** — the property the
whole abstraction exists to provide, now demonstrated rather than asserted.

| Area | Where |
|---|---|
| Adapter | `src/server/market-data/providers/twelvedata.ts` — `/quote`, `/time_series`, `/splits`; prices parsed as strings at `dp=8`; errors read from the **body**, not the HTTP status |
| Exchange identity | `src/server/market-data/exchanges.ts` — `NSE`→`XNSE`, `BSE`→`XBOM`, plus `XNAS`/`XNYS`/`XLON`, with per-venue close instants computed through `Intl` (DST-correct) |
| Credential | `TWELVE_DATA_API_KEY`, **optional**, read once in the composition root and injected. Placeholder in `.env.example` |
| Smoke test | `npm run smoke:market-data` — a `scripts/` entry point, deliberately **not** in the deterministic suite |
| Tests | **68 added** — 49 unit across all 21 required cases, 17 integration, 2 strengthened source scans |

### Verification — 2026-08-18

| Gate | Result |
|---|---|
| `npm test` | **1,245 passed**, 0 failed (60 files) — up from 1,177 |
| Every Phase 3 / 4 / 5 test | **still passing** |
| Typecheck · lint · production build | clean · clean · clean (23 routes) |
| `verify:integrity` | **33 passed, 0 failed**, 9 engine-enforced, 4 deferred |
| Schema | **unchanged** — 6.9 required no migration |
| `check:no-client-secrets` | no secret in **21** client files; a **canary run with a planted key** also clean |
| Provider absent from the browser | the string `twelvedata` appears in **no** client asset |
| Live smoke test | ✅ **run 2026-08-31 against the real provider.** Catalogue read (83 models), text generation on `nvidia/nemotron-3-nano-30b-a3b` (2,288 ms, 47 completion tokens), structured output validated, an unknown model classified as `transport`. No financial data sent; no credential printed |

### The defect this step found and fixed

**A user-typed exchange crashed the whole price refresh.** `instruments.exchange`
is free text (`NSE`), and the refs builder added in step 6.5 asserted it was
already a MIC — so `mic('NSE')` **threw**, aborting `prices.refresh` for the
entire portfolio, not just the offending instrument. Every market-data test to
that point used a mutual fund, whose exchange is `null`, so the equity path had
never been exercised. `resolveMic` now translates or returns `null`, and an
adapter that needs a venue refuses the instrument cleanly. Two regression tests.

### Decisions taken during implementation

| # | Decision | Why |
|---|---|---|
| **D-38** | **The credential is read in the composition root and injected**, not read by the adapter | An adapter reading `process.env` is untestable without mutating global state and adds a second place to look for a leak. Injection means all 49 adapter tests run with no environment at all, and the source scan asserting "no adapter reads the environment" is enforceable |
| **D-39** | **Twelve Data is registered even when unconfigured** | An adapter that vanishes when the key is missing makes "why is nothing priced?" depend on which files loaded. Registered-but-unconfigured returns one typed refusal on every path, and the reason reaches the screen |
| **D-40** | **An error body is checked before the HTTP status is trusted** | Twelve Data returns `{"status":"error","code":429}` with HTTP 200. Trusting transport alone would read a rate-limit refusal as a successful empty response — a portfolio that quietly stops updating |
| **D-41** | **An unresolvable exchange is a refusal, never a guess** | `INFY` without a venue could be the NSE listing or a same-named foreign one. Pricing the wrong security is worse than pricing nothing, and `resolveMic` returns `null` rather than picking a plausible venue |
| **D-42** | **`source` is scoped by venue — `twelvedata:XNSE`** | I-35 pins one source per series. Venue-scoping means a series can never silently mix two listings of the same company |

### Scope boundaries — deliberately not built in 6.9

Automated equity refresh (the existing `prices.refresh` already routes equities;
scheduling is unchanged), crypto (**OD-11**), gold (**OD-12**), market-value net
worth, snapshots, AI. `ValuationBasis` remains the one-member union `'cost'`.

**TWR is not wired into the portfolio summary.** Its *data path* is proven end to
end — stored history → `closeAsOf` → a valuation at every boundary including a
non-trading day → `twr()` returning a figure — but `services/portfolio.ts` still
reports `insufficient_price_history` unconditionally. That connection is a later
step and is not claimed here.

---

## Phase 6.11 design review — 2026-08-21

**Design only. Nothing was implemented.** No source file, schema, migration, service, API, UI or test
changed. The output is [docs/MARKET-VALUE-NET-WORTH-DESIGN.md](docs/MARKET-VALUE-NET-WORTH-DESIGN.md),
a **non-normative** review record with the same standing as the three before it.

### What it settles

| Area | Conclusion |
|---|---|
| **Two bases** | Widen `ValuationBasis` to `'cost' \| 'market'` — the smallest abstraction, and the one ADR-23 already specified. **The basis is a property of component *construction*, not of composition**: `compose()` carries it and never branches on it, so the domain is untouched and `reconcile()` works for both bases unchanged |
| **Single counting** | **A cost-plus-market double count is a thrown exception, not a wrong number.** Both would use the same `position:(account,instrument)` key, and `ContributionMap.add()` throws on a duplicate. The key was designed this way in Phase 5 — `keys.ts:23` says so in as many words |
| **Cost → market** | **A restatement at an instant, not a bridge over time** ([ADR-31](docs/DECISIONS.md#adr-31--cost-to-market-is-a-restatement-at-an-instant-not-a-bridge-over-time)). `bridge()` already refuses cross-basis bridging and is right to; conflating them would let a user read a valuation difference as a gain they made |
| **FX** | The restatement decomposes **exactly** into price and FX rebasis, with **no new column** — `tax_lots` carries `remaining_cost` in instrument currency alongside the acquisition rate. The *holding-level* combined figure (INVESTMENT-DOMAIN §6.4) is deliberately unchanged: different question |
| **Partial valuation** | Shown and labelled, never suppressed and never completed with cost. `complete \| partial \| unavailable`, with **value-weighted** investment coverage by base cost basis — what D-29 promised |
| **Staleness** | A stale price is **used and flagged**; refusing it would blank the headline every long weekend. Finding **M3** — no field for "used, but old" — becomes a V1 requirement |
| **Historical** | Five of six inputs already work. The one new algorithm is **`quantityHeldOn`**, ratio-aware; `positions` must never serve a historical date |
| **Manual assets** | Have a **valuation, not a price**, and do not become "priced" because the basis label changed |
| **Liabilities** | **Unchanged** — a liability has no market value, so the restatement has no liability term |
| **Schema** | **No change required.** Every input exists |

### 6.10 snapshots — closed by measurement

Measured against the real domain functions over synthetic data at 40 instruments, 480 lots and
100,000 price points — larger than the target portfolio, so an upper bound:

| Operation | Measured |
|---|---|
| Net worth at cost, 1 point | 0.31 ms |
| Net worth at market, 1 point | 2.9 ms |
| 12-point market-value series | 33 ms |
| 365-point market-value series, naive scan | 1,156 ms |
| **365-point market-value series, indexed lookup** | **123 ms** |

The naive figure is the instructive one: 1,156 ms looks like a case for a cache and is not — it is a
linear scan of 2,500 price points per instrument per point. Sorting once and binary-searching takes it
to 123 ms. A snapshot table would have added a second stored representation of a derived figure, free
to drift, needing `user_state.valuation_version` and an integrity assertion, to avoid a sort.
**Recommended closed (OD-15).**

### Proposed, not applied

**[ADR-31](docs/DECISIONS.md#adr-31--cost-to-market-is-a-restatement-at-an-instant-not-a-bridge-over-time)** ·
**invariants I-41 … I-49**, each mapped to a domain rule and a test (none is a database constraint —
net worth stores nothing) · **I-38 and I-39 promoted** from deferred to live · golden scenarios **G5**
and **G6** · **26 adversarial scenarios** with expected behaviour.

### One contradiction found and resolved

The task specified a *"cost-to-market bridge"*. `bridge.ts:122` **refuses** to bridge across a basis
change, deliberately and with a good reason. Resolved in favour of the code: it is a **restatement**,
and ADR-31 records why the distinction is not pedantry.

### Decisions — resolved 2026-08-21

| # | Outcome |
|---|---|
| **OD-14** | ✅ **Approved and applied.** [ADR-31](docs/DECISIONS.md#adr-31--cost-to-market-is-a-restatement-at-an-instant-not-a-bridge-over-time) and [ADR-32](docs/DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view) carry the architecture; the methodology went into `FINANCIAL-DOMAIN.md` §9.3 (`marketValue` normative), new §9.5 (restatement) and §9.6 (what market basis does **not** change), `INVESTMENT-DOMAIN.md` §5.1, `SCHEMA.md` §12 (**I-41, I-43…I-49**) and `TESTING.md` §6.7. **Reconciled, not appended** — draft **I-42 was dissolved** on discovering I-38/I-39 already stated it |
| **OD-15** | ✅ **Closed — snapshots not built.** No `net_worth_snapshots`, no job, no snapshot-based figure. Evidence: **123 ms** for a 365-point market-value series with an indexed price lookup, against 1,156 ms for the naive linear scan the earlier draft measured. Reopened only by a **real production measurement** |
| **OD-16** | ✅ **Resolved: the default basis remains `cost`.** This came back **differently from the design's recommendation**, and ADR-32 supersedes ADR-23's default-flip consequence. Every document that implied market would replace cost has been corrected, including two non-normative review records |

### Why OD-16's outcome is the right one

Recorded because the design argued the other way. Flipping the default would have **restated every
figure the user had already seen** — six months of history and a differently-shaped chart, with no
transaction behind any of it. Cost basis also changes only when the *user* does something (earns,
spends, buys, sells, revalues, repays), which is the property a "how am I doing?" headline wants;
market moves with prices and FX, neither of which they control. And a default should not be able to
report `partial` because a provider had a bad morning — cost coverage is `1.0` by construction.

That the design needed **no structural change** to accommodate the opposite answer is itself evidence
the basis abstraction was drawn in the right place.

**Implementation followed on 2026-08-27** and every gate in
[MARKET-VALUE-NET-WORTH-DESIGN.md §21](docs/MARKET-VALUE-NET-WORTH-DESIGN.md#21-implementation-gates)
is met — see *What step 6.11 delivered* below.

`TWELVE_DATA_API_KEY` is configured and the live smoke test passes, so 6.9 carries no outstanding
verification either.


Superseded pointer, kept for the record: the earlier instruction here was to *perform* this review by
reading `docs/ARCHITECTURE.md`, `docs/INVESTMENT-DOMAIN.md` §5 and
§8.1, [ADR-11](docs/DECISIONS.md#adr-11--market-data-behind-a-provider-abstraction-with-an-always-available-manual-provider),
and `docs/ROADMAP.md` Phase 6 before writing anything.

---

## What step 6.11 delivered — Net Worth at Market Value · 2026-08-27

| Area | Where |
|---|---|
| Basis | `ValuationBasis = 'cost' \| 'market'` in `domain/networth/compose.ts`. Phase 5 shipped it as a one-member union so widening it would be a compile error at every site that had to be reconsidered; that mechanism was used, not circumvented |
| Quantity | `domain/lots/quantity.ts` — `quantityHeldOn`, reading a per-trade-date `quantityTimeline` that `replay()` now emits. **One** implementation of the corporate-action ratio arithmetic |
| Market components | `services/_networth-market.ts` (loader and price selector) and `marketPositions()` in `services/networth.ts` (the builder). Priced or excluded, never cost-substituted |
| Completeness | `domain/networth/market.ts` — status, value-weighted investment coverage, excluded cost, staleness |
| Restatement | `domain/networth/restate.ts` — three computed lines, closing exactly |
| Price index | `domain/pricing/price-series.ts` — sort once per instrument, binary-search per point |
| UI | `app/(app)/net-worth/market/page.tsx`, plus one reciprocal line on the existing page |
| Benchmark | `scripts/bench-networth.ts`, `npm run bench:networth` |
| Tests | **129 added** — 46 unit, 9 property, 41 integration, 23 golden (G5 + G6), 10 source-scan |

### Verification — 2026-08-27

| Gate | Result |
|---|---|
| `npm test` | **1,396 passed**, 0 failed (66 files) — up from 1,267 |
| Every Phase 3 / 4 / 5 / 6.0–6.9 test | **still passing** |
| Typecheck · lint · production build | clean · clean · clean (25 routes) |
| `verify:integrity` | **33 passed, 0 failed**, 19 engine-enforced, 2 deferred |
| Schema | **unchanged** — no migration, as §20 concluded |
| Snapshots | **not built** — OD-15 stands on measurement |
| `check:no-client-secrets` | no secret in 21 client files |
| Net Worth at Cost | **unchanged** — a price arriving moves it by zero minor units, asserted by test and confirmed in the browser |
| Browser — desktop 1440px | default view headline held at ₹76,90,000.00; comparison line, market view, restatement, reconciliation all correct |
| Browser — mobile 375px | no horizontal page overflow; the one wide table scrolls inside its own container |
| Console | no errors beyond the pre-existing Next dev-mode CSP `style-src` notices, which appear identically on the Phase 5 page |

### Performance — measured, not asserted

`npm run bench:networth`, at 8 accounts · 40 instruments · 480 lots · 100,000 price points · 2,500 FX rows:

| Operation | Measured | Design baseline (§12) |
|---|---|---|
| Net worth at cost, 1 point | 0.4 ms | 0.31 ms |
| Net worth at market, 1 point | 0.3 ms | 2.9 ms |
| 12-point market-value series | 4.4 ms | 33 ms |
| 365-point at-cost series | 42 ms | 82 ms |
| **365-point market-value series, indexed** | **80 ms** | **123 ms** |

The naive-scan control measures 14.6 s here against the design's 1,156 ms; that row is a
same-machine control for the *shape* of the cost, not a reproduction — this scan validates each
stored date, so its absolute number is its own. **The gate is the indexed figure**, and it beats the
baseline.

### The defect this step found and fixed

**`selectRate()` rebuilt its whole pair index on every call.** `indexRows` is `O(rows)` and its
result depends only on `(rows, on)`, so one conversion on one page cannot tell the difference — but
a market-value **series** asks for a rate once per foreign position per point, and over 2,500 stored
observations that is a table scan wearing a lookup's clothes. The first benchmark run came in at
**710 ms** against the design's 123 ms, and the price index alone did not explain it.

`rateSelector()` memoises the index per date. The resolution rule is untouched — identity → direct →
inverse → triangulated, dated by the stalest leg, one pivot only — so the change is to what is
recomputed, never to what is decided, and all 1,396 tests confirm every Phase 3/4/5 figure is
byte-identical. The series dropped to **80 ms** and the single-point market fold from 3.0 ms to
0.3 ms.

**Worth stating plainly: a test would not have caught this.** Every figure was already correct. It
took a measurement, which is the argument ADR-24 makes for measuring before caching — and the reason
the benchmark is a committed script rather than a number in a document.

---

## What step 7.0 delivered — Phase 7 pre-implementation corrections — 2026-08-30

**Scope: architecture and tooling boundaries only. No AI infrastructure was implemented.** No AI provider, no SDK installed, no `NVIDIA_API_KEY` configured or requested, no AI tools, no orchestrator, and **no file under `src/server/ai/`** — that directory still does not exist. The work was to make the corrections the Phase 7 design review identified *before* anything is built on top of them.

### The three findings, and how each is now closed

| | The claim the documents made | What the code actually did | The correction |
|---|---|---|---|
| **F-1** | `AI-SYSTEM.md` §1: *"the AI layer holds only a `ReadCtx` … so a write from AI code does not compile"* | Two independent holes. `withWriteCtx(readCtx, …)` **compiled clean**, and `ReadCtx.db` is a `DbExecutor` exposing `.insert`, `.update`, `.delete`, `.execute` and `.transaction` | `withWriteCtx`/`withWriteCtxResult` require a **`RequestCtx`** carrying `beginTransaction`, granted only by `createReadCtx`. The AI layer holds an **`AiReadCtx`** with no `db`, no `fx` and no capability — and which is not a `ReadCtx`. Both holes are now compile errors ([ADR-33](docs/DECISIONS.md#adr-33--the-transaction-opener-is-a-capability-carried-on-the-context-not-an-ambient-import)) |
| **F-2** | `AI-SYSTEM.md` §3: *"nothing inside it imports `src/server/db/`"* | The ESLint AI zone matched only `@/`-aliased specifiers, so `import { db } from '../../db/client'` linted clean. Adding the engine zone's `**/server/db/*` would not have helped — it requires a literal `server` segment the specifier lacks | Aliased **and** relative patterns, `drizzle-orm`/`pg` banned outright, plus a source scan and the capability types. Three mechanisms ([ADR-34](docs/DECISIONS.md#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths)) |
| **F-3** | `AI-SYSTEM.md` §8: *"Σ rows = total at every depth"* | `breakdown()` returned **every node** of the category tree — parents and children — each rolled up. Summing them double-counted every pair; the golden test worked around it by filtering on `›` in the label | `breakdown()` returns a structure with an authoritative `total` and an `additivity` tag; both depths partition exactly, and a tag breakdown declares itself `overlapping` ([ADR-37](docs/DECISIONS.md#adr-37--a-breakdown-declares-whether-its-rows-partition-its-total)) |

**The type change proved itself on contact.** Changing `withWriteCtx` to require a `RequestCtx` made `tsc` report the escalation at every site that used it. There were three, all test harnesses legitimately standing in for a user request — and **no production code at all**, because every server action already obtains its context from `createReadCtx`.

### Also delivered

| | |
|---|---|
| **AI-safe numeric projection** | `src/lib/format/json-projection.ts`. `Money`, `Quantity`, `UnitPrice` and `Rate` cross a JSON boundary as `{ kind, digits…, scale }` — exact digits as a string, tagged. No `Number()` anywhere; the domain types are unchanged and gain no `toJSON` ([ADR-36](docs/DECISIONS.md#adr-36--exact-values-cross-a-json-boundary-as-a-tagged-string-projection-never-as-a-json-number)) |
| **The read capability** | `src/server/ai-read/` — `index.ts` exports `AiReadCtx` and nothing else; `internal.ts` holds the one bridge back to a `ReadCtx`, bound in a module-private `WeakMap` and banned from the AI zone. Phase 7.3 adds the projected read functions to `index.ts` |
| **Root lint scope** | `eslint.config.mjs` now ignores `.claude/**`. `eslint .` was walking the sibling Claude worktrees — five complete copies of this repository nested inside it — because flat config skips neither dot-directories nor `.gitignore` |
| **Tag breakdowns declared non-additive** | Not in the original finding; found while fixing F-3. `tagBreakdown` inner-joins `transaction_tags`, so a two-tag transaction counts twice and an untagged one not at all. The old bare array gave a consumer no way to know |

### Tests and checks added — I-50 … I-54

| Invariant | Mechanism | Where |
|---|---|---|
| **I-50** | **Compile test.** Type-checks probe sources against the project's own `tsconfig.json` via an overlay host — nothing is written to the tree — and asserts the diagnostic codes: `withWriteCtx(ai, …)` → TS2345, `ai.db` → TS2339, `listAccounts(ai)` → TS2345. Also asserts a `RequestCtx` **can** still open a write, so a boundary that broke the application fails here rather than mysteriously elsewhere | `tests/unit/ai-write-boundary.test.ts` (10 tests) |
| **I-51**, **I-52** | **Source scan.** Catches what ESLint structurally cannot — **dynamic `import()` and `require()`**, which `no-restricted-imports` never checks in any zone — plus `ctx.db` DML and any mention of a write-boundary symbol. Also asserts `eslint.config.mjs` still carries the relative patterns | `tests/unit/ai-boundary-source-scan.test.ts` (17 tests) |
| **I-53** | Property tests over generated values past `MAX_SAFE_INTEGER`: the projection agrees with `toDbString`, round-trips through `fromDbString`, is never a JSON number, keeps a price distinguishable from a quantity, and projects a missing figure to `null` rather than zero | `tests/unit/json-projection.test.ts` (17 tests) |
| **I-54** | Property tests over generated two-level trees: `Σ folded === Σ direct` exactly, every input id lands in exactly one row, no emitted row is a descendant of another. The integration half asserts the partition at **both** depths against the golden figures | `tests/unit/breakdown-contract.test.ts` (9 tests), `tests/integration/golden-g1.test.ts` |

**Both F-2 mechanisms were verified empirically, not assumed.** A probe importing `'../../db/client'` relatively is rejected by ESLint *and* the scan. The same import written `await import('../../db/client')` **passes ESLint with exit 0** and is caught only by the scan — which is the concrete reason the scan exists.

**Non-vacuity.** `src/server/ai/**` does not exist yet, and a scan over an empty set passes for the wrong reason. The scan therefore asserts a corpus of synthetic violations, the ESLint config itself, and the capability's shape — all of which hold today — and activates its directory checks from the first file Phase 7 places there.

### Deferred, explicitly

- **OD-18** — the scenario engine, the three missing metrics and the TWR wiring are **not** built. They are removed from the Phase 7 tool registry rather than stubbed. *An AI capability exists only where a deterministic application capability already exists or has an explicitly approved implementation path.*
- **OD-19** — the Overview page is **not** redesigned or implemented. Recorded as a future product/UI work item, scheduled with the Phase 9 UX pass. It does not block Phase 7.

### Verification

**1,456 tests pass and 3 are skipped** (71 files, 1,459 total) — 63 added over the 1,396 of the 6.11 baseline, and every Phase 3, 4, 5 and 6 test still passes. The 3 skips are the AI-zone directory checks, which activate from the first file Phase 7 places under `src/server/ai/` and are deliberately inert until then. `verify:integrity` reports **33 passing, 0 failing, 24 engine-enforced, 2 deferred** (I-50 … I-54 added). Typecheck, lint and the production build are clean, and `eslint .` **from the repository root** now reports **0 problems** where it previously reported **121,213** — it was descending into five complete worktree copies of this repository.

**One test caught a real defect in this very change**, which is the point of writing them first. `breakdown()`'s first cut derived a rollup row's `childCount` as `foldedIds.length - 1`, which undercounts a parent whose children were the only things spent on — the commonest shape in the seed tree, where `Food` has no direct entries of its own. The golden G1 assertion failed on it. The fix reads the descendants directly, and `tests/unit/breakdown-contract.test.ts` now covers both that shape and the single-child case a `length > 1` test for `isRollup` also gets wrong.

**No financial calculation changed.** `rollup()`, `cashflow()`, `periodSummary()` and every engine function are untouched; F-3 changed the *shape* of a row set and the arithmetic that assembles it, not the figures. The golden expectations in `tests/golden/` were not edited.

---

## Live provider verification — 2026-08-31

`NVIDIA_API_KEY` was configured after the Phase 7 commit, so `npm run ai:smoke` and `npm run ai:catalogue` ran against the real provider for the first time. Connectivity, generation, structured output and failure classification all pass.

**The catalogue read corrected the routing table, and disproved two claims this project had been carrying since Phase 0.** `AI-SYSTEM.md` §2.3 recorded them from an *unauthenticated* read; the authenticated one shows otherwise:

| Identifier | Was recorded as | Actually |
|---|---|---|
| `zai-org/glm-5.2` | ⚠️ "real id is `z-ai/glm-5.2`" | ❌ **absent.** No GLM model exists under any publisher prefix |
| `nvidia/nemotron-nano-12b-v2-vl` | ✅ present | ❌ **absent** |

Both were in `config/models.ts`'s default order — GLM as the Tier 2 fallback, the 12b model as the **Tier 4 primary** — so two of the four routed tiers pointed at models the provider would not serve. This is precisely the failure the design review predicted ("any routing table written against `CLAUDE.md`'s list verbatim would fail at runtime"), and the table written from that list inherited it.

Corrected: Tier 2 drops GLM and keeps two candidates; **Tier 4 now has exactly one model and therefore no fallback**, which is the honest configuration rather than a second entry that would answer a document question without having seen the document. Five of thirteen candidates are now recorded `catalogue: null`. Two new tests assert that no tier routes to an absent model and that fallback exists wherever it is possible.

**Also repaired:** the Phase 7 commit introduced mojibake into four documents — ❌, —, §, × and ⏸ double-encoded by a PowerShell write. Clean through `1483166`, corrupted in `c9fe823`, repaired here. The same write path had put a UTF-8 BOM into `package.json`, which broke `next build` until it was stripped.

---

## Adversarial security gate — step 7.0 — 2026-08-30

**Ten attack categories, fourteen import probes, five findings, all fixed.** The review attacked the corrected boundary rather than re-reading it: every result below was produced by writing a probe file into `src/server/ai/`, running the real ESLint config and the real source scan against it, and recording what happened.

**The headline: the boundary was the right idea in the wrong shape.** [ADR-34](docs/DECISIONS.md#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths) closed the relative-path hole but kept a **denylist** naming `db`, `domain` and `services`. Seven of fourteen probes passed **both** ESLint and the source scan.

| # | Route | Granted | Severity | Status |
|---|---|---|---|---|
| **S-1** | `@app/(app)/money/actions`, aliased or relative | A `'use server'` action takes a **form, not a context**, and builds a `WriteCtx` internally from the session. Importing one mutates the ledger with the user's own authority — **no write capability passes through AI code at all**, so ADR-33's type guarantees are bypassed rather than broken | **CRITICAL** | ✅ fixed |
| **S-2** | `@/server/jobs` | `enqueue` / `runDueJobs` / `scheduleRecurringPost`; the handlers call `withWriteCtx`. The same defeat, one indirection away | **CRITICAL** | ✅ fixed |
| **S-3** | `@/lib/env` | `env()` returns `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `SESSION_COOKIE_SECRET`, `TWELVE_DATA_API_KEY` and, by design, `NVIDIA_API_KEY` — to the one layer that sends text to a third party | **HIGH** | ✅ fixed |
| **S-4** | `@/server/auth/**` | Sessions, password verification, and decryption of TOTP secrets and recovery codes under `APP_ENCRYPTION_KEY`; `account.ts` opens its own transaction | **HIGH** | ✅ fixed |
| **S-5** | `ignores: ['…/nvidia-build.ts']` | `ignores` drops a config object *entirely* for the named file, so the exemption meant to permit `openai` also gave the wire client the database, the services and the engine | **HIGH** | ✅ fixed |
| | `@/server/market-data/http` | Arbitrary outbound HTTP with provider credentials — an exfiltration channel | MEDIUM | ✅ fixed |
| | `@/server/health` | Executes SQL, even if only a fixed probe | LOW | ✅ fixed |
| **S-6** | `AiReadCtx` was mutable | `readonly` is erased at runtime. It could never redirect a read — the `WeakMap` keys on identity — but a projection rendering `ai.userId` could label one user's figures with another's name | LOW | ✅ fixed |

**The fix is a change of shape, not a longer list** ([ADR-38](docs/DECISIONS.md#adr-38--the-ai-zone-is-an-allowlist-a-new-directory-is-closed-on-the-day-it-is-created)). Deny `@/server/**`, re-admit exactly `@/server/ai-read` and `@/server/log`, re-deny the bridge inside the first. Adding the six missing directories to the denylist would have closed these seven routes and left the shape that produced them — the next directory would be open again. `@/server/whatever-comes-next` is now closed, and a test asserts it.

**The source scan no longer keeps its own copy of the list.** It reads the patterns out of `eslint.config.mjs`. The copy had already drifted, which is how five routes stayed open in *both* mechanisms at once — the defence-in-depth was two mechanisms enforcing one stale list, not two independent checks.

### Results by attack category

| Attack | Result | Blocked by |
|---|---|---|
| **1 — write escalation** | No path found after the fix. `withWriteCtx(ai, …)` / `ai.db` / service calls are compile errors; every import route to a write helper, a server action or a job is denied | structural (types) + static (ESLint) + source scan |
| **2 — raw database access** | No path. `db`, `drizzle-orm`, `pg`, `health` all denied; the capability carries no handle to write through | structural + static + scan |
| **3 — tool escalation** | Bounded by construction: `ai-read/index.ts` exports only the capability type today, so no tool can reach a service until 7.3 adds enumerated projections there. `ai-read/**` now has its own zone banning the write surface **by name** (`importNames`) while leaving queries importable | structural + static |
| **4 — prompt injection** | No control depends on model behaviour. Authorization is `ctx.userId` filtering inside services; the capability has no database handle; tier and requirements are computed from the *capability*, never from content. A model that decides to misbehave still cannot reach anything | structural |
| **5 — cross-user access** | Blocked. `createReadCtx(anyUserId)` is denied to the zone; the capability is bound in a module-private `WeakMap` and now frozen; a forged or copied capability is refused at runtime | structural + runtime + static |
| **6 — JSON projection** | No loss found. Round-trips at `NUMERIC(20,4)`'s maximum and its negation, past `MAX_SAFE_INTEGER`, at zero and negative zero; a price stays distinguishable from a quantity of identical digits; identical digits in different currencies stay distinct; every projection states its own scale | structural + test |
| **7 — breakdown semantics** | Unambiguous. `additivity` is a **required** field — a `Breakdown` omitting it does not compile — and the result does not type-check as `BreakdownRow[]`, so reaching the rows means reading the declaration | structural + test |
| **8 — secret exposure** | Closed. `@/lib/env` and `@/server/auth/**` denied; `@/server/log` re-admitted deliberately because it exports `redact`/`log` and re-exports nothing from the environment | static + scan |
| **9 — dependency escape** | `src/lib/**` verified to import no database, service or engine module; `@/server/ai-read` imports only `@/lib` types; `@/server/log` reads `LOG_LEVEL` and exposes none of it | static + scan |
| **10 — fail closed** | Every category above is blocked by at least one mechanism that does not depend on a developer remembering a rule. Nothing remains classified CRITICAL, HIGH or MEDIUM | — |

**One residual, accepted and already designed for.** `DomainError` carries an entity id, and for a `settings` error that id **is the user id**, so a tool that returned a raw error would leak it. No tool exists yet; `AI-INFRASTRUCTURE-DESIGN.md` §6.4 already requires a projected error, and Phase 7.3 must implement it. Recorded here so it is a scheduled requirement rather than a discovery.

**What the review did not test.** Live prompt injection against a model, and the runtime behaviour of tools — neither exists. The relevant property was tested instead: that no security control *depends* on the model choosing correctly.

**Verification after the fixes:** 1,470 tests pass and 3 are skipped (71 files), typecheck clean, lint clean, production build clean, `verify:integrity` 33 passing / 0 failing / 24 engine-enforced / 2 deferred.

**AI implementation has still not started.** No provider, no SDK, no `NVIDIA_API_KEY`, no tools, no orchestrator, and `src/server/ai/` does not exist — every probe directory created during this review was deleted, and `git status` is clean.

---

## What Phase 7 delivered — AI Infrastructure — 2026-08-30

**Infrastructure only. No user-facing AI feature exists**, and none was started: no chat interface, no natural-language transaction entry, no assistant, no portfolio analyst, no document extraction, no RAG, no vector store, and no autonomous action. Those are Phase 8 (evaluation) and Phase 9 (features).

**The security gate from step 7.0 is intact and was strengthened by being used.** The three AI-zone directory scans that were inert while `src/server/ai/` did not exist are now live and passing against real code, and the allowlist caught two boundary mistakes while this phase was written — an in-zone module named `health.ts` colliding with the `@/server/health` ban (renamed to `breaker.ts` rather than widening the rule), and a namespace `import * as services` in the read capability that reached the write helpers by name (replaced with explicit named imports). Neither was resolved by relaxing a rule.

### What was built

| Step | Delivered |
|---|---|
| **7.1 provider** | `AiProvider` interface (`provider/types.ts`) and the NVIDIA Build adapter (`provider/nvidia-build.ts`) — the only file that knows the wire format, the endpoints, or the bearer header. Every method returns a classified `Result`; nothing throws |
| **7.2 configuration** | `config/models.ts` — tier → ordered candidates, env-driven, with **`CLAUDE.md`'s candidate list reconciled against the catalogue**: one identifier corrected (`deepseek-v4-flash` → `-0731`) and **five** recorded as absent rather than silently substituted. `config/capabilities.ts` — the gate |
| **7.3 tools** | 18 read-only tools over real services, `AiReadCtx` throughout, per-field JSON projection, row caps, a 150 KB byte budget and visible truncation. Zod `.strict()` schemas → JSON Schema |
| **7.4 orchestrator** | `requirements` → `select` → `fallback`, with a circuit breaker. Routing is decided from the capability alone, before any content is read |
| **7.5 structured output** | Parse → validate → **one** repair carrying the field errors → reject. Zod is the single validation boundary (ADR-16) |
| **7.6 observability + switches** | A closed record of scalars with nowhere to put a figure; `settings.ai_enabled` **now actually read**; a per-user fixed-window rate limiter |
| **7.7 live smoke test** | `npm run ai:smoke` / `ai:catalogue`. **Not run — no credential (OD-1).** It exits 0 and prints local configuration instructions rather than failing |

### Decisions taken, and one deviation recorded

- **[ADR-40](docs/DECISIONS.md#adr-40--the-nvidia-adapter-is-written-over-fetch-the-openai-client-is-deferred-to-the-phase-that-needs-streaming) — the adapter is written over injected `fetch`, not the `openai` client.** `AI-SYSTEM.md` §2.2 chose the client for SSE parsing and retries; Phase 7 needs neither, because there is no streaming caller until Phase 9 and retry policy belongs to the orchestrator. This is a deviation from a canonical document and is recorded as one; §2.2 has been amended. The `openai` import ban stays, so adopting the client later is a change to one file.
- **Declared versus measured capabilities.** `AI-SYSTEM.md` §5 describes `capabilities.json` as written by the eval harness, with measured scores gating routes. The eval cannot run without a credential, which left a choice between an empty matrix (nothing routable, provider untestable) and inventing scores (forbidden). Neither was taken: every entry carries `source`, `'declared'` entries come from documentation and can serve only routes with **no** score threshold, and `'measured'` is required for every structured-output and tool-using route. **No score in the repository is a benchmark result.**

### Boundaries kept, and what is deliberately absent

`run_financial_scenario`, `calculate_financial_metrics` and a TWR tool are **not** in the registry — **OD-18**, unchanged: an AI capability exists only where a deterministic one does. `retrieveRelevantContext` and Tier 5 are absent — ADR-19. `portfolio()` still reports `twr: unavailable('insufficient_price_history')`, and the tool projects that **reason** rather than a number.

The AI layer cannot obtain a `WriteCtx`, execute SQL, reach a service directly, read the environment, or name another user — each asserted rather than intended, and each unchanged from the step 7.0 gate.

### Tests — I-55 … I-58

| Invariant | Covers | Where |
|---|---|---|
| **I-55** | Provider: unconfigured, auth, 429 with `Retry-After`, 5xx, timeout, socket error, non-JSON body, no choices, tool-call passthrough, content filter; the credential never leaves the auth header, even when the provider echoes it in an error | `tests/unit/ai-provider.test.ts` (20) |
| **I-56** | Capability gates in both directions, unmeasured-score refusal, **cross-tier downgrade impossible**, Tier 3 unreachable by escalation, breaker open/half-open/close, attempt ceiling, fail-closed short-circuit, identifier normalisation | `tests/unit/ai-routing.test.ts` (26) |
| **I-57** | No tool accepts a user identifier (swept across the registry), `additionalProperties: false` everywhere, unknown tool, non-JSON arguments, invented argument, malformed date, handler that throws; validate → one repair → reject across eight malformed shapes | `tests/unit/ai-tools.test.ts` (25) |
| **I-58** | `ai_enabled = false` produces **zero egress**, fails closed with no settings row, and leaves other features working; per-user rate limiting; **user isolation swept across every tool** with two users' real data; figures projected, breakdown additivity carried, domain errors stripped of the entity id | `tests/integration/ai-infrastructure.test.ts` (14) |

### Verification

**1,553 tests pass** (75 files) — 85 added, and every Phase 3, 4, 5 and 6 test still passes. `verify:integrity` reports **33 passing, 0 failing, 28 engine-enforced, 2 deferred**. Typecheck, lint and the production build are clean; `check:no-client-secrets` passes.

### Not done, and why

- **The live smoke test has not run.** `NVIDIA_API_KEY` is unset (**OD-1**). Everything else is verified without it, which was the design requirement.
- **No model has been measured.** Phase 8 runs `ai:eval`; the harness exists (`ai/eval/harness.ts`) and records schema adherence, tool-call correctness, latency percentiles and error class, with `null` printed as *not measured* rather than `0`.
- **No AI database tables.** `ai_messages`, `ai_model_attempts` and `ai_usage_daily` are specified in `SCHEMA.md` and not created: nothing writes conversations yet, and a migration for tables no code fills is schema debt. Observability records to an injected sink; the database sink lands with the feature that produces conversations.
- **The read loop is not built.** The orchestrator can call a model with tools, and `dispatchToolCall` executes one — but the multi-turn loop that feeds results back belongs with the assistant in Phase 9.

---

## Phase 7 final verification — 2026-09-03

**Verdict: B — implementation complete, verification partially blocked by the environment.** Every application check passes. Two things stop this being an unqualified pass, and neither is application code: the machine's storage is physically unreliable, and the provider's catalogue moved under a routing table written against it.

### The environment fault, found and named

The "repeated machine-level I/O/process failures" carried through Phases 6 and 7 are a **hardware storage fault**, not a code or tooling problem. The Windows System log records, over 30 days:

| Event | Count | Meaning |
|---|---|---|
| `disk` 51 | 30,318 | I/O error during a paging operation on `\Device\Harddisk0\DR0` |
| `storahci` 129 | 245 | the AHCI controller reset the device |
| `disk` 153 | 160 | I/O operation retried |
| `disk` 157 | 160 | **"Disk 0 has been surprise removed"** — the drive left the bus mid-operation |
| `Ntfs` 50 | — | **"{Delayed Write Failed} … The data has been lost"**, naming files inside this worktree |

Disk 0 is the 932 GB `ST1000DM010` HDD hosting `E:\`, and therefore the repository *(true when written; the repository later moved to the SSD, then to `H:`, and now lives on GitHub — see docs/RECOVERY-2026-10.md)*. SMART still reports *Healthy*, which fits a cable, power or controller fault rather than media wear.

**It was caught in the act.** At 01:06:29 on 2026-09-03, during `npm ci`, the drive surprise-removed and NTFS reported a lost delayed write. The result was a silently corrupted 106 MB native binary: `@next/swc-win32-x64-msvc/next-swc.win32-x64-msvc.node` had **every byte from offset 94,371,840 (exactly 90 MiB) to EOF zeroed**, while retaining its full length — a pre-allocated file whose tail never flushed. `next build` loaded that PE image and died with `0xC0000005` (access violation) in 1.6 s. The npm cache was intact (`npm cache verify`: 1,063 entries), so the corruption occurred on extraction, not download. Reinstalling produced a binary byte-identical to a known-good copy, and the build then passed in 48 s.

**Consequence for trust.** Any file on `E:` can be silently corrupted at any moment, with correct length and no error surfaced to the writing process. A green run on this machine is evidence about the code only insofar as the disk behaved during that run. **The drive's cable/power/controller should be replaced, and the repository re-verified afterwards, before Phase 7 is called fully verified.**

A second, unrelated environment effect is worth recording because it wastes time: Git-Bash on Windows emulates `fork()` via `CreateProcessW`, so a shell loop spawning a subprocess per file exhausts the process table at a few hundred spawns (`fork: Resource temporarily unavailable`, and a spurious "working directory was deleted"). Whole-tree scans must run as **one** process, not a per-file loop.

### Corruption found and repaired

**14 tracked files carried double-encoded UTF-8** (mojibake): text written as UTF-8, misread as CP1252, re-encoded as UTF-8. An em dash — one character, bytes `E2 80 94` — came back as the three characters CP1252 assigns to those bytes (`U+00E2 U+20AC U+201D`), and every other non-ASCII character expanded the same way. It is *valid* UTF-8, which is why an encoding-validity check cannot see it and why it survived earlier passes.

*(Described by codepoint rather than quoted, deliberately: a literal example here would make this file register as corrupt in its own scan, and invite a later repair pass to "fix" the illustration.)*

Two separate write events, both from the PowerShell write path already blamed in the 2026-08-31 entry:

| Introduced by | Files | Previously repaired? |
|---|---|---|
| `ddbaf86` (Phase 6.9) | `scripts/check-no-client-secrets.ts`, `src/server/services/market-data.ts`, `tests/integration/market-data-equity.test.ts`, `tests/unit/market-data-source-scan.test.ts` | **no — never** |
| `c9fe823` (Phase 7) | `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/SECURITY.md`, `docs/TESTING.md`, `src/server/ai-read/{index,projections,queries}.ts`, `src/server/ai/tools/dispatch.ts`, `tests/unit/ai-provider.test.ts` | **partially** — `cbc0637` fixed four documents and missed these ten |

The 2026-08-31 claim that the mojibake was "repaired here" was therefore **incomplete**, and is corrected by this entry.

**1,468 sequences repaired across the 14 files, verified three ways:** every file shows equal `+N -N` in `git diff --numstat` (pure in-place substitution, no structural change); re-corrupting the repaired text reproduces the original byte-for-byte; and for `docs/ARCHITECTURE.md` the repaired box diagram is **byte-identical to the last clean ancestor** (`c773551`), including its pre-existing ragged right edge. All 16 non-comment occurrences were `describe()` labels and one `console.error` string — no identifier, key, comparison or control flow. The affected tests were re-run and pass unchanged.

The box-drawing characters needed a second pass: `┐` is `E2 94 90`, and `0x90` is **undefined** in CP1252, so the decoder emitted the C1 control character `U+0090` rather than a printable one.

**Two NUL bytes are not corruption and were left alone**: `'\0uncategorised'` in `domain/calc/cashflow.ts` is a deliberate sentinel map key that no user category can collide with, and `'/\0'` in `tests/unit/safe-redirect.test.ts` is a NUL-injection vector that must be rejected. Both predate Phase 7 and parse cleanly.

### The catalogue moved again

`npm run ai:smoke` on 2026-09-03 returns **82 models, not the 83 recorded on 2026-08-31**, and **`nvidia/nemotron-3-nano-30b-a3b` — the Tier 1 primary — is no longer in it.**

It appears **renamed, not withdrawn**: the catalogue now carries `nvidia/nemotron-nano-3-30b-a3b`, the same words with the version segment transposed. A new generation has also appeared (`nvidia/nemotron-3.5-lightning-30b-a3b`, `nvidia/nemotron-3.5-content-safety`). This is the third identifier drift in this pool, after `deepseek-v4-flash` → `-0731` and the GLM correction.

**Routing was deliberately not changed.** A transposed name is not proof of the same model, `CLAUDE.md` requires evaluation against real workloads before a route is finalised, and inventing a replacement is exactly the failure this project keeps catching. It is recorded here for Phase 8 to resolve with the eval harness.

**Runtime impact — degraded, not broken.** `transport` carries the `next_candidate` disposition (`ai/errors.ts`), so the dead identifier fails and the chain falls through to `openai/gpt-oss-20b`; the circuit breaker then opens on it and stops trying. Tier 1 keeps serving. The cost is one wasted request and round-trip per breaker window. **Tiers 2, 3 and 4 are unaffected — every identifier they route to is still present.**

### Verification matrix — run sequentially, one at a time

| Check | Result |
|---|---|
| **Full test suite** | ❌ **1,555 passed, 3 failed, 1,558 total** (75 files) · **641 s** |
| Typecheck | ✅ clean (4 s) |
| Lint | ✅ clean (59 s) |
| Production build | ✅ clean (48 s) — **after** repairing the disk-corrupted native binary; it segfaulted before |
| `verify:integrity` | ✅ **33 passed, 0 failed, 28 engine-enforced, 2 deferred** |
| `check:no-client-secrets` | ✅ no secret in 21 client files (7 values checked across `.next/static`) |
| AI security probes | ✅ boundary source scan, write boundary, read capability — all pass |
| Deterministic AI provider/routing/tools | ✅ **114 passed** across 6 files |
| AI integration (`ai-infrastructure`) | ✅ pass |
| Live NVIDIA smoke test | ✅ catalogue, generation (2,897 ms), structured output *valid*, unknown model → `transport` |

**The three failures are a test defect, not an application regression, and not the environment.** All three are in `tests/integration/jobs.test.ts` (a Phase 3 file, untouched by Phase 7) and all assert `expected 3 to be 2`. They fail identically in isolation, so they are deterministic rather than contention.

The cause is a **date-dependent test**. The fixture pins the clock — `setupMoneyFixture({ now: '2026-08-10' })` — but `runDueJobs()` reaches the job handler, which calls `createReadCtx(userId)` and builds a **fresh context from the real system clock** (`services/_ctx.ts`, `today: todayIn(timezone, now)`). The pin covers the assertion context and not the job's execution context. With a rule starting `2026-07-01` and `postDueOccurrences` posting everything where `due_on <= ctx.today`, three occurrences are due on 2026-09-03 where two were due on 2026-08-10. **Three is the correct application answer.** The suite was last green on 2026-08-30 and broke on 2026-09-01 with no code change.

Not fixed here: this task was scoped to verification, and the fix belongs with the recurring/ledger area — either injecting a clock into the job path or making the assertion relational (post-run count unchanged by a second run) rather than absolute. Bumping `2` to `3` would re-arm the same bomb for October.

### What remains true, and what is not yet proven

- The AI layer is still read-only, and each control is enforced by a mechanism rather than a convention: types (`AiReadCtx` cannot become a `WriteCtx`), the ESLint allowlist (deny `@/server/**`, re-admit `ai-read` and `log`), a source scan that reads its patterns *from* `eslint.config.mjs`, and runtime binding in a module-private `WeakMap`. I-50 … I-58 all pass.
- No credential reaches a client bundle, a log, a test file or a tracked file — re-checked against the real build.
- **Not proven on this machine:** that a full-suite green run is repeatable, because the disk can corrupt any file mid-run without reporting it. This is the sole reason the phase is **B** rather than **A**.

---

## Development environment moved to SSD — 2026-09-09

**`E:` is no longer the canonical development location.** The repository now lives at:

```
C:\Dev\AI Enabled Personal Finance          ← canonical, on the SSD
```

### Why

`E:` is a partition of **Disk 0** (`ST1000DM010`, 931.5 GB, HDD), the drive whose fault is documented in the 2026-09-03 entry. It was still failing at the time of the move: in the seven days to 2026-09-09 it logged a further **93 paging-I/O errors, 5 surprise-removal events and 6 NTFS delayed-write failures**. `G:` is the other partition of the same disk and is equally affected. `H:` is a second HDD (Disk 1). **Disk 2 — `WDC WDS240G2G0B`, 223.6 GB, SSD — is the only solid-state device, and it is `C:`.** That made the target unambiguous.

**Nothing was repaired.** The failing drive has not been fixed, replaced or re-cabled. The work was moved off it.

### How, and why it was a clone rather than a copy

The migration used `git clone`, not a file copy, for one reason: **git verifies a checksum over every object it transfers, and a file copy verifies nothing.** On a disk that silently returns zeroed tails — as it did to a 106 MB binary on 2026-09-03 — a copy is exactly the operation that cannot detect what it just lost.

Before the clone, `git fsck --full --strict` on the source **exited 0**: the object database on the failing disk was intact, so there was a good copy to take. After the clone, verification was explicit rather than assumed:

| Check | Result |
|---|---|
| `git fsck --full --strict` on the SSD clone | exit 0 |
| All 10 branch SHAs, source vs clone | identical |
| `HEAD^{tree}` source vs clone | `1a6f135e…` on both sides |
| Tracked files vs their blobs | clean |
| `.env` SHA-256, source vs copy | identical (824 bytes, 10 variables) |

`node_modules`, `.next` and every other generated artefact were **not** copied; they were rebuilt from the lockfile with `npm ci`. The point of the move is to stop trusting what that disk wrote, and a generated artefact is the cheapest thing in the tree to reconstruct.

**The `origin` remote was removed.** The clone briefly pointed at `E:`, and leaving it would have made a failing disk the upstream of the healthy checkout.

**This repository has no remote at all, and that is now the largest single risk to the project.** Every commit from Phase 0 to here exists in exactly two places, both local, one of them on a dying drive. A backup — an external disk or a private remote — is worth more than any remaining Phase 7 work.

### What was left where it was

**PostgreSQL was not touched.** Its data directory is `C:\Program Files\PostgreSQL\18\data` — already on the SSD, never on the failing disk. Service `postgresql-x64-18` running and listening on 5432; all four roles connect; `financeos` and `financeos_test` both reachable with 30 tables each; data intact (2 users, 6 accounts, 58 categories, 20 audit rows). No reset, no migration, no recreation.

The old `E:` tree was left in place, untouched and clean, as a fallback. It is no longer canonical and no longer receives work.

### The date-bomb test, fixed at the runner

The three `jobs.test.ts` failures recorded on 2026-09-03 are resolved, and the fix is in the job runner rather than in the assertions.

**The defect.** `setupMoneyFixture({ now })` pinned `fixture.ctx` — which is what the assertions read — but `runDueJobs()` reached `createReadCtx(userId)` inside the handler, which built a *fresh* context from `new Date()`. The fixture pinned the observer and not the subject, so how many occurrences the job posted was a function of the machine's calendar. The file was green on 2026-08-30 and red on 2026-09-01 with no code change.

**The fix.** `JobDeps { now: Date }` is threaded from `runDueJobs` through `runOne` into every handler, and `RECURRING_POST` passes it to `createReadCtx`. The instant is resolved **once per run**, so two jobs claimed by the same run cannot disagree about the date. This is the injection the codebase already uses everywhere else — `createReadCtx`'s `now`, the AI circuit breaker's `now` — extended to the one path still reading the clock behind its caller.

**Recurring semantics are unchanged.** `postDueOccurrences` still posts exactly `due_on <= ctx.today`, and production calls `runDueJobs()` with no `now` and gets the wall clock as before. What changed is that the clock became *reachable* from a caller.

**No assertion was weakened.** `toBe(2)` still stands; bumping it to `3` was explicitly rejected, because that would have re-armed the same bomb for October. Two regression tests were added: one runs the identical rule at three injected instants (2026-08-10 → 2, 2026-11-05 → 5, 2027-02-01 → 8), and one asserts that two runs at the same instant agree with each other and with the literal 2.

**The guard was proved non-vacuous.** With the one-line fix reverted, 5 of the 10 tests in the file fail, including both new ones. With it in place, all 10 pass.

### Baseline on the SSD

| Check | E: (2026-09-03) | C: (2026-09-09) |
|---|---|---|
| Typecheck | ✅ 4 s | ✅ **4 s** |
| Lint | ✅ 59 s | ✅ **63 s** |
| Production build | ❌ **segfault `0xC0000005`** until a corrupt binary was reinstalled | ✅ **38 s, first attempt** |
| `verify:integrity` | ✅ 33 / 0 / 28 / 2 | ✅ **33 / 0 / 28 / 2** |
| `check:no-client-secrets` | ✅ | ✅ **21 files, 7 values** |
| Full suite | ❌ 1,555 pass / **3 fail** / 1,558 · 641 s | ✅ **1,560 pass / 0 fail / 0 skipped · 75 files · 547 s** |

The authoritative run is `npm test` from `C:\Dev\AI Enabled Personal Finance` on 2026-09-09: **75 test files, 1,560 passed, 0 failed, 0 skipped, 547 s** (exit 0). Two more tests than the 1,558 counted on `E:`, which are the two regression guards added with the runner fix. Wall-clock fell from 641 s to 547 s.

**Phase 7 is now category A — fully verified** — on the SSD checkout, with one qualification that is deliberately *not* an environment caveat: no model has been measured, so routing remains gated by `capabilities.ts` and Phase 8 still owns model selection. The reason the phase was **B** on 2026-09-03 was the storage, and the repository no longer sits on that storage.

**The failing drive still exists and is still failing.** Nothing in this entry should be read as a repair. `E:` and `G:` remain partitions of Disk 0, and anything still stored there is at risk.

---

## Open decisions

| # | Decision | Blocks |
|---|---|---|
| **OD-2** | `AGENTS.md` is byte-identical to `CLAUDE.md`. Two copies of a 2,181-line spec will drift. Recommendation: reduce `AGENTS.md` to a pointer — not done unilaterally, as another tool may require full content at that path | Nothing technically; an instruction-correctness risk |
| **OD-3** | Equity/ETF market-data provider and its terms. **Phase 4 consequence:** `instrument_prices` stays empty, so TWR returns `null` with `insufficient_price_history` and portfolio growth renders as gaps. Both are the documented behaviour, not defects. **Recommendation added 2026-08-18:** **Twelve Data Grow, $29/mo** (verified: India = XNSE at EOD, needs Grow+; terms permit storing data for internal use) for coverage consolidation across Indian + international equities, ETFs, FX and crypto in one adapter. **Kite Connect at ₹500/mo** is a legitimate cheaper alternative if a Zerodha account exists and no international coverage is needed — but its login expires daily, which is hostile to an unattended refresh job, so it costs engineering what it saves in fees. Free routes were evaluated and **excluded on licence grounds**, not overlooked: NSE's terms prohibit automated collection from its website, and Yahoo-compatible sources have no licence for programmatic access. This is a cost-and-account decision, not an engineering one | **Step 6.9 only — not the phase.** Eleven of twelve steps are unblocked ([MARKET-DATA-DESIGN.md §20.J](docs/MARKET-DATA-DESIGN.md#j-implementation-sequence)) |
| **OD-18** | **Where the scenario engine, the three missing metrics, and the TWR wiring belong.** ⏸ **Deferred 2026-08-30 — explicitly not Phase 7.** `run_financial_scenario` has no backing of any kind; `calculate_financial_metrics` has 1 of 4 metrics; `twr()` and `growthSeries()` are implemented, tested and called by nothing (`portfolio.ts` hardcodes `twr: unavailable('insufficient_price_history')`). All three are **deterministic financial-engine work** and are **removed from the Phase 7 tool registry rather than stubbed**. The governing rule is now normative in `AI-SYSTEM.md` §8: *an AI capability exists only where a deterministic application capability already exists or has an explicitly approved implementation path.* **AI must not become a substitute for missing financial-engine functionality.** Scheduling is a later decision — a Phase 6.12 step, or folded into Phase 9 | Nothing in Phase 7 |
| **OD-19** | **The Overview page is still a Phase-2 placeholder.** ⏸ **Deferred 2026-08-30 as a future product/UI work item — explicitly not a Phase 7 blocker.** `app/(app)/page.tsx` renders "Money arrives in Phase 3" while Phases 3–6.11 are complete. `CLAUDE.md <overview>` makes it a MUST-BUILD surface and every figure it describes is now computable. It is not redesigned or implemented now; it is scheduled with the Phase 9 UX pass | Nothing. Phase 7 proceeds without it |
| **OD-13** | **AMFI reuse terms.** `NAVAll.txt` is published publicly and the whole Indian fintech industry consumes it, but **no machine-readable licence or explicit reuse grant was found**, so none is asserted. The adapter is built for personal, non-redistributing use and says so in its own header. Confirm with AMFI before any non-personal use | Nothing for personal use; would block redistribution |

### Resolved

| # | Decision | Outcome |
|---|---|---|
| **OD-1** | `NVIDIA_API_KEY` | ✅ **Resolved: the key was configured and the 7.7 live smoke test and the authenticated catalogue read ran.** No longer blocks anything |
| **OD-17** | How to close the AI write boundary (Phase 7 review **F-1**/**F-2**) | ✅ **Resolved 2026-08-30 by the recommended option: narrow the context the AI layer receives.** The AI layer holds an `AiReadCtx` — no `db`, no `fx`, no transaction capability, and **not** a `ReadCtx` — so both the escalation and the raw write are compile errors. `withWriteCtx` now requires a `RequestCtx` carrying `beginTransaction`, granted only by `createReadCtx`; changing that signature made `tsc` report every escalation site, and all three were test harnesses legitimately standing in for a user request. **AI infrastructure is strictly read-only**, and any future AI-assisted mutation needs a separate approved proposal/confirmation workflow. Normative: [ADR-33](docs/DECISIONS.md#adr-33--the-transaction-opener-is-a-capability-carried-on-the-context-not-an-ambient-import), [ADR-34](docs/DECISIONS.md#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths), [ADR-35](docs/DECISIONS.md#adr-35--ai-infrastructure-is-strictly-read-only-a-mutation-needs-a-separate-approved-proposal-workflow). Invariants **I-50 … I-52** |
| **OD-4** | Amend the approved baseline with the Phase 4 review's D1–D15 | ✅ **Approved and applied 2026-08-11.** The corrections are in the canonical documents; the landing table is at the top of [INVESTMENT-ENGINE-DESIGN.md](docs/INVESTMENT-ENGINE-DESIGN.md), which is now a review record, not a specification |
| **OD-5** | `investment_transactions.net_amount` currency | ✅ **Approved 2026-08-11: the account's currency.** `price` / `gross_amount` / `fees` / `taxes` stay in the instrument's. `deriveBalance()` therefore never mixes currencies, and an account's `currency_code` is immutable once it carries ledger rows. See [FINANCIAL-DOMAIN.md §3](docs/FINANCIAL-DOMAIN.md), [SCHEMA.md §6](docs/SCHEMA.md), [ADR-12](docs/DECISIONS.md) |
| **OD-7** | Net-worth valuation basis before market data exists | ✅ **Approved 2026-08-12: Net Worth at Cost.** Phase 5 calculates and presents net worth **at cost**; investment positions contribute the **exact Phase 4 cost basis**; market value and cost are **never mixed inside one figure**; no screen shows an unqualified "Net worth" that could imply a current market valuation. Phase 6 introduces market-value net worth as a **distinct** calculation. **No valuation toggle in Phase 5** — the existing design does not need one. Normative: [ADR-23](docs/DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost) |
| **OD-8** | `net_worth_snapshots` and the `networth.snapshot` job | ✅ **Approved 2026-08-12: moved to Phase 6.** Phase 5 uses deterministic derivation; **every Phase 5 gate requiring a snapshot is removed**; `user_state.valuation_version` is deferred with them. Phase 6 may still introduce snapshots if measurement justifies it, under four stated rules. Normative: [ADR-24](docs/DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6) |
| **OD-10** | Apply the Market Data review's M1–M13 to the canonical documents | ✅ **Approved and applied 2026-08-18.** Reconciled, not appended: four findings became [ADR-27](docs/DECISIONS.md#adr-27--market-data-adapters-return-observations-the-registry-classifies-freshness) … [ADR-30](docs/DECISIONS.md#adr-30--one-provider-per-instrument-price-series-the-only-price-fallback-is-manual); the rest folded into `FINANCIAL-DOMAIN.md` §2, `INVESTMENT-DOMAIN.md` §5/§8.1/§10/§11, `SCHEMA.md` §5/§5.1/§12 and `TESTING.md` §6. Invariants **I-33 … I-40** added, and **all thirteen findings are implemented**, not merely documented |
| **OD-11** | Crypto market data | ✅ **Deferred 2026-08-18.** No adapter ships. The `continuous` cadence and its wall-clock branch are implemented and tested, so enabling crypto later is an adapter rather than a rule change |
| **OD-12** | Dedicated gold market data | ✅ **Deferred 2026-08-18.** Gold prices as a gold ETF or gold MF through the ordinary adapters, or as a `manual_assets` valuation series. No bullion feed, no purity/unit model |
| **OD-9** | Apply the Net Worth review's N1–N19 to the canonical documents | ✅ **Approved and applied 2026-08-12.** The normative rules were **reconciled**, not appended to — each now has one authoritative statement. Four findings became ADRs ([ADR-23](docs/DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost), [ADR-24](docs/DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6), [ADR-25](docs/DECISIONS.md#adr-25--net-worth-classification-is-by-the-economic-sign-of-the-balance-not-by-account-kind), [ADR-26](docs/DECISIONS.md#adr-26--an-as-of-financial-figure-is-computed-from-dated-facts-only-no-current-state-flag-participates)); the rest were folded into `FINANCIAL-DOMAIN.md`, `SCHEMA.md`, `INVESTMENT-DOMAIN.md`, `ARCHITECTURE.md` and `TESTING.md`. Per-finding disposition: [NET-WORTH-DESIGN.md §14](docs/NET-WORTH-DESIGN.md#14-defects-found-in-the-baseline-n1n19). **No source file, schema, migration or test was touched** |
| **OD-6** | `settlement_date` semantics | ✅ **Resolved 2026-08-11: financial recognition is trade-dated.** `trade_date` is the financial recognition date and the cash date; `settlement_date` is a recorded factual attribute of the transaction and controls nothing — not recognition, not cash-balance derivation, not ledger dating, not replay, and not historical or `asOf` calculations. `deriveBalance()` and `replay()` continue to use the trade-dated ledger. **No settlement-date-based cash movement is to be introduced, and settlement-aware accounting logic is out of scope for the current architecture.** Because balances are trade-dated, a displayed balance can differ from the broker's cleared cash for up to one settlement cycle, so **the UI should make clear that displayed balances are trade-dated rather than settlement-dated**. Normative record: [ADR-22](docs/DECISIONS.md#adr-22--financial-recognition-is-trade-dated-settlement_date-is-informational-metadata), with the rule restated in [FINANCIAL-DOMAIN.md §3](docs/FINANCIAL-DOMAIN.md#3-accounts), [SCHEMA.md §6](docs/SCHEMA.md#6-investment-ledger) and [INVESTMENT-DOMAIN.md §3](docs/INVESTMENT-DOMAIN.md#ordering) |

---

## Known debt and accepted risks

Recorded so these are not rediscovered as bugs.

**Carried from Phase 1**
- **`instruments` is per-user** (`UNIQUE (user_id, symbol, exchange)`). Correct at one user, wrong at ~10k — a migration, not a redesign.
- **Balances are computed on every read**, no stored column. Escape hatch pre-designed: a materialised roll-up keyed by `money_ledger_version`.
- **No Row-Level Security.** Fine single-user; the priority item if this ever becomes multi-tenant.
- ~~**`PortfolioSnapshot`** folded into `net_worth_snapshots.breakdown` (JSONB). Flagged for a decision before Phase 6.~~ **Resolved 2026-08-11**: no `portfolio_snapshots` table. Historical portfolio value is derivable from `investment_transactions` + `instrument_prices` in a single SQL pass; the escape hatch is a roll-up keyed by `investment_ledger_version`, never a mutable record ([INVESTMENT-ENGINE-DESIGN.md §8.3](docs/INVESTMENT-ENGINE-DESIGN.md)).
- **Tier 5 embeddings deferred** with written activation criteria ([ADR-19](docs/DECISIONS.md)).
- **Liability `interest_rate` / `emi_amount` are descriptive only** — no amortisation schedule is computed, and the UI must not imply one.

**New in Phase 2**
- **The compromised-password list is a starter set** (`src/server/auth/common-passwords.ts`, ~110 entries). The 12-character minimum already excludes most published breach corpora, but Phase 11 should bundle a filtered real extract or use the HIBP range API. The limitation is written at the top of that file.
- **No TOTP QR code.** Enrolment shows the base32 secret and the `otpauth://` URI; every authenticator supports manual entry. A QR renderer is a dependency Phase 2 did not need — revisit in Phase 10.
- **4 moderate `npm audit` advisories**, all one advisory (GHSA-67mh-4wv8-2f99, esbuild dev-server CORS) reaching us through `drizzle-kit → @esbuild-kit/*`, which upstream has deprecated. Development-only, never in a runtime bundle, and below the `high` threshold SECURITY.md §11 sets. `npm audit fix --force` would downgrade drizzle-kit to 0.18.1 — a breaking change for a vulnerability we are not exposed to. Re-check when drizzle-kit drops the dependency.
- **Session revocation UI is not built.** `revokeSession` / `revokeOtherSessions` exist and are tested; Settings lists active sessions but offers no revoke button until Phase 10.
- **No E2E suite yet.** Playwright is Phase 12; Phase 2 workflow verification was done by hand in a browser and is recorded below.
- **~~PostgreSQL does not start automatically.~~** Resolved by D-23 — it is a Windows service with `Automatic` start.
- **A PostgreSQL 17.7 rollback is still on disk**, unused: the old data directory `E:\Claude\_tools\pgdata` (91 MB) and the portable install `E:\Claude\_tools\pg17` (897 MB), plus logical dumps under `E:\Claude\_tools\pg-migration-backup-20260810-233153\`. Delete once PostgreSQL 18 has proven itself. The dumps contain a password hash and an encrypted TOTP secret, so they are deliberately outside the repository and must never be committed.
- **CI still tests against `postgres:17`** (`.github/workflows/ci.yml`), while development is now 18.4. Not changed here because it decides what the suite is tested against, which is a call worth making deliberately rather than as cleanup.

**New in Phase 5**
- **Net worth is at cost, and says so on every screen.** Investments contribute their acquisition cost until Phase 6 ([ADR-23](docs/DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost)). A user who has hand-entered prices will see market value on Investments and cost on Net Worth; the basis banner exists so that reads as a stated fact rather than a discrepancy.
- **Coverage is a component count, not a value ratio** (D-29). Honest but coarser than `FINANCIAL-DOMAIN.md` §9.3 asks for, and unavoidable while the only exclusion cause is a missing rate. Phase 6 can make it value-weighted.
- **A manual-asset disposal inflates the savings rate for that period.** The proceeds are ordinary income while the asset they replaced never was, so `income` rises by the whole sale. Net worth is unaffected — the bridge nets the proceeds against the asset's last valuation — and the seeded `Other Income → Asset sale proceeds` category exists so the receipt can be filtered out of a savings reading. A structural fix needs a fifth transaction shape for one case, and is deferred ([FINANCIAL-DOMAIN.md §9.4](docs/FINANCIAL-DOMAIN.md#94-asset-and-liability-lifecycle)).
- **A scheduled liability's repayment is recorded as an expense**, because there is no account to transfer to. The bridge closes — savings falls and the liability line rises by the same amount — but the savings rate for that period reads low. Inherent to the scheduled shape; a transacted liability has no such artefact.
- **`user_state.valuation_version` is not added.** Nothing in Phase 5 reads it, because net worth is derived and there is no cache to invalidate. It is a prerequisite for any Phase 6 snapshot ([ADR-24](docs/DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6) rule 3).
- **The CSP inline-style console errors are development-only, and this is now measured rather than assumed.** The same route rendered by `next start` from the production build logs **zero** console errors; the dev server logs them on every load. Only the server differs, which confirms the Turbopack HMR client as the source (carried Phase 3 debt). No application file emits an inline `style` attribute — `ProportionBar` uses static width classes for exactly this reason (D-27).
- **This worktree now has its own `node_modules`.** `next build` under Turbopack resolves the workspace root from the nearest lockfile and then requires `next/package.json` beneath it, so a worktree sharing the parent's install cannot build (a junction is rejected: *"points out of the filesystem root"*). `npm ci` in the worktree is the fix, and the Phase 4 worktree had already done the same.

**New in Phase 3**
- **Deleting a user is not one statement.** `SCHEMA.md`'s conventions claim it is, and it is not: `users → accounts` cascades, but `transaction_entries.account_id` is `ON DELETE RESTRICT`, and Postgres does not order cascades so it can hit the restricted edge first. Deleting a user therefore fails unless `transactions` are deleted first. **`RESTRICT` is the right rule** — it is what stops an account with history being deleted — so the fix belongs in the deletion *service* (delete transactions, then the user, in one transaction), not in the schema. Nothing depends on this until data deletion is built in Phase 11; recorded so it is not rediscovered as a bug then.
- **A transfer cannot be edited from the transactions page.** `updateTransfer` exists, is tested, and rebuilds both legs together; the transactions table offers only Delete for a transfer, because a two-leg edit form is UI work Phase 3 did not need. Deleting and re-entering is correct in the meantime.
- **No inline edit in the transactions table.** ROADMAP listed it; the table is read-and-delete plus the quick-add composer. Deferred to the Phase 10 UX pass rather than half-built.
- **`recurring.post` is driven by cron, not by an in-process scheduler.** `npm run jobs:run` drains the queue; nothing schedules it automatically yet. Deployment (Phase 13) owns the cron entry.
- **The dev server logs CSP violations for inline styles.** They come from Turbopack's HMR client in development only; the production build's styles are in a stylesheet and the nonce-based CSP is unaffected.

---

## Phase 2 verification record

Run on 2026-08-09 against the production build, not the dev server.

| Check | Result |
|---|---|
| Migrations from an empty database | ✅ applied; grants re-applied |
| Rollback then re-migrate | ✅ schema fingerprint byte-identical |
| Seed run twice | ✅ 12 currencies both times |
| `npm test` | ✅ **282 passed**, 0 skipped (17 files) |
| `npm run typecheck` | ✅ clean |
| `npm run lint` | ✅ clean |
| `npm run build` | ✅ 9 routes |
| `npm run check:no-client-secrets` | ✅ no secret in 17 client files |
| `npm audit --audit-level=high` | ✅ exit 0 |
| Unauthenticated route → login | ✅ 307 to `/login?next=%2Finvestments` |
| Password step alone | ✅ no session row created |
| Wrong TOTP code | ✅ rejected, no session |
| Correct TOTP code | ✅ session issued, returned to the originally requested page |
| Session cookie | ✅ `HttpOnly` — invisible to `document.cookie` |
| Token storage | ✅ only SHA-256 in `sessions.token_hash` |
| Sign out | ✅ row deleted, protected routes redirect again |
| `auth_events` trail | ✅ `totp_failure`, `login_success`, `logout` |
| Security headers | ✅ CSP with per-request nonce + `strict-dynamic`, HSTS, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, COOP/CORP, no `X-Powered-By` |
| Mobile at 375 px | ✅ sidebar hidden, bottom nav fixed, no horizontal overflow |
| `GET /api/health` | ✅ `200 {"status":"ok"}` |

**Bugs found and fixed during Phase 2 verification** (recorded because each passed an earlier gate):
1. `app/(auth)/login/actions.ts` exported a constant from a `'use server'` module — accepted by `tsc` and by `next build`, HTTP 500 on the first POST. Fixed by moving the state shape to `form-state.ts`; `tests/unit/server-actions.test.ts` now guards the rule and was itself verified to fail on a deliberate violation.
2. The authenticated layout redirected to `/login` without the return path. Fixed by passing the pathname through an `x-pathname` request header from `proxy.ts`.
3. `Money.parseUserInput` accepted `1,5` as fifteen. Fixed to validate digit grouping (D-16).
4. Argon2id at 64 MiB measured 158 ms against a ≥250 ms requirement, and the source comment claimed 310 ms without having measured. Fixed to 128 MiB and the real measurement table recorded.

---

## Phase 3 verification record

Run on 2026-08-10.

| Check | Result |
|---|---|
| `npm test` | ✅ **663 passed** — 433 unit + property, 230 integration |
| `npm run typecheck` | ✅ clean |
| `npm run lint` | ✅ clean |
| `npm run build` | ✅ 15 routes, 6 of them money |
| `npm run check:no-client-secrets` | ✅ no secret in 18 client files |
| `npm run verify:integrity` | ✅ 8 passed, 0 failed, 7 not yet applicable |
| Migrate → roll back → migrate | ✅ fingerprint identical, now including constraints, triggers and functions |
| Golden scenario **G1** | ✅ 14 assertions against hand-computed figures |
| Transfer excluded from income/expense | ✅ in the engine, in the services, in a tag report, and on screen |
| 200-transaction fixture | ✅ balance matches the hand-computed ₹49,985.0000 |
| Recurring 31st across February | ✅ 28 Feb 2026 and 29 Feb 2028, clamped rather than skipped |
| Double post, same occurrence | ✅ one transaction, in tests and through the real UI |
| Two concurrent job runners | ✅ each job and each occurrence handled exactly once |
| Live workflow | ✅ account → expense → income → transfer → budget → recurring rule → post, in a browser |
| Savings rate with zero income | ✅ renders `—` with "the denominator is zero", never `0%` |
| Mobile at 375 px | ✅ no horizontal overflow, sidebar hidden, bottom nav fixed |

**Bugs found and fixed during Phase 3 verification:**
1. **A failed recurring posting kept its claim** — the occurrence was marked `posted` with no transaction behind it (I-9 violated, commitment silently skipped). Found by an integration test; fixed with a savepoint (D-21).
2. **An extreme savings rate threw out of a page render** — found by a property test; fixed by returning `out_of_range` (D-19).
3. **A duplicate default category name was silently dropped** by `ON CONFLICT DO NOTHING` — found by asserting the seeded count; fixed by renaming and by refusing a list with duplicates (D-20).
4. **`quarterRange` stepped back to the fiscal year start instead of the quarter start** — found by a unit test before anything consumed it.
5. **A render-prop form crashed every page that used one** — "Functions are not valid as a child of Client Components". It typechecked, linted and built; only loading the page in a browser caught it. Fixed by making each form a concrete client component.
6. **`rollbackLast` reversed the newest migration twice** when two existed, because it indexed the end of the journal rather than the applied count.

---

## Where knowledge lives

| Question | File |
|---|---|
| Why was X decided that way? | [docs/DECISIONS.md](docs/DECISIONS.md) — 26 ADRs with rejected alternatives, plus D-9…D-23 above and D-24…D-27 in [ROADMAP.md](docs/ROADMAP.md) Phase 4 |
| What are the tables and invariants? | [docs/SCHEMA.md](docs/SCHEMA.md) — 32 invariants (I-1 … I-32) plus six explicit non-invariants |
| How does money behave? | [docs/FINANCIAL-DOMAIN.md](docs/FINANCIAL-DOMAIN.md) |
| How do holdings and returns behave? | [docs/INVESTMENT-DOMAIN.md](docs/INVESTMENT-DOMAIN.md) — corrected and authoritative |
| Why does the investment engine work that way? | [docs/INVESTMENT-ENGINE-DESIGN.md](docs/INVESTMENT-ENGINE-DESIGN.md) — the Phase 4 review record and rationale. **Non-normative**: where it and a canonical document differ, the canonical document wins |
| How is net worth meant to work, and why? | [docs/NET-WORTH-DESIGN.md](docs/NET-WORTH-DESIGN.md) — the Phase 5 design review: single counting, as-of methodology, FX, liabilities, reconciliation, the schema delta, 43 edge cases, and the N1–N19 disposition table. **Non-normative** — the rules themselves now live in `FINANCIAL-DOMAIN.md` §9, `SCHEMA.md` §7–9/§12 and ADR-23…ADR-26 |
| How is the AI layer meant to work, and what can't it do? | [docs/AI-INFRASTRUCTURE-DESIGN.md](docs/AI-INFRASTRUCTURE-DESIGN.md) — the Phase 7 review: the write-boundary defects, model tiers and the provisional stack, routing, the real tool surface, mutation, context budgets, prompt injection, cost, the RAG decision and the implementation sequence. **Non-normative** |
| How does market-value net worth work, and why? | [docs/MARKET-VALUE-NET-WORTH-DESIGN.md](docs/MARKET-VALUE-NET-WORTH-DESIGN.md) — the Phase 6.11 review: the two bases, single counting under market, price selection, partial valuation, the restatement, historical reconstruction, precision, the snapshot measurement and 26 adversarial scenarios. **Non-normative** — the rules live in `FINANCIAL-DOMAIN.md` §9.3/§9.5/§9.6, `INVESTMENT-DOMAIN.md` §5.1, `SCHEMA.md` §12 and ADR-31/ADR-32 |
| Where do prices come from, and which provider? | [docs/MARKET-DATA-DESIGN.md](docs/MARKET-DATA-DESIGN.md) — the Phase 6 review: data requirements, ten providers evaluated against verified official sources, the TWR and market-value-net-worth dependencies stated precisely, staleness, missing-data behaviour, caching, persistence, cost, 20 adversarial scenarios, and the M1–M13 defect table. **Non-normative** until OD-10 |
| How does the AI layer work and what can't it do? | [docs/AI-SYSTEM.md](docs/AI-SYSTEM.md) |
| What must be tested before a phase is done? | [docs/TESTING.md](docs/TESTING.md) and each phase's "Done when" |
| What am I building next? | [docs/ROADMAP.md](docs/ROADMAP.md) — **Phase 8, Model Evaluation**. Start with the golden task corpora for `src/server/ai/eval/harness.ts`; run `npm run ai:catalogue` first to see the current catalogue (ADR-45) |

