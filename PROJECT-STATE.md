# Project State

Durable status record. Conversation history is temporary; this file is not. Read this first after any context reset, then verify it against `docs/`, the source tree, and the tests before trusting it.

**Last updated:** 2026-08-12 · **Current phase:** 4 complete and verified · **Phase 5 — Net Worth: design review complete 2026-08-12, implementation NOT started**

This is the **Phase 4 completion checkpoint**, plus the **Phase 5 design review**. Phases 0–4 are done; the verification that closed Phase 4 is recorded below under *Phase 4 final verification*, along with the scope boundaries that are intentional roadmap limits rather than defects.

**No Phase 5 code, schema, migration, service, API or UI exists.** The design review produced documentation only — [docs/NET-WORTH-DESIGN.md](docs/NET-WORTH-DESIGN.md) — and three open decisions (OD-7, OD-8, OD-9) that gate the start of implementation.

Sequence approved 2026-08-11: **Phase 3 — Money Management → Phase 4 — Investment Engine.**

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
| `docs/` | 13 documents — the approved architecture baseline, plus two **non-normative review records** ([INVESTMENT-ENGINE-DESIGN.md](docs/INVESTMENT-ENGINE-DESIGN.md), [NET-WORTH-DESIGN.md](docs/NET-WORTH-DESIGN.md)). |
| `CLAUDE.md` / `AGENTS.md` | The specification. Byte-identical duplicates (see OD-2). |
| `Workflow Setup.txt` | Canonical 15-phase map ([ADR-20](docs/DECISIONS.md)) |
| Application code | **Phases 2–4.** Next.js 16, exact-money primitives, database, auth, app shell; the money core (accounts, categories, tags, transactions, transfers, budgets, recurring rules, the job runner and the Money UI); and the investment engine (instruments, the investment ledger, the FIFO lot engine, positions, valuation, allocation, XIRR/TWR and the Investments UI). |
| Git repository | Initialised, `core.autocrlf=input`. Phase 2 and Phase 3 are committed; the Phase 4 design review and its documentation correction pass were merged in from `claude/investment-engine-review-3ed9bd`. |

## Phases

| Phase | Status |
|---|---|
| 0 — Environment & Repository | ✅ complete |
| 1 — Architecture | ✅ complete, **approved** |
| 2 — Foundation | ✅ complete, verified |
| 3 — Financial Core | ✅ complete, verified |
| 4 — Investment Engine | ✅ complete, verified |
| 5 — Net Worth | **design review complete 2026-08-12; implementation NOT started.** Blocked on OD-7, OD-8, OD-9 |
| 6 — Market Data | not started (OD-3 affects completion, not start) |
| 7 — AI Infrastructure | not started; **blocked** on OD-1 (`NVIDIA_API_KEY`) |
| 8–14 | not started |

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

## Phase 5 design review — 2026-08-12

**Design and architecture only. Nothing was implemented.** No application code, schema, migration, service, API or UI changed; `0003_phase5_net_worth.sql` does not exist. The output is [docs/NET-WORTH-DESIGN.md](docs/NET-WORTH-DESIGN.md) — a review record with the same standing as `INVESTMENT-ENGINE-DESIGN.md`: **non-normative**, and where it and a canonical document differ, the canonical document wins until OD-9 is approved.

### What it settles

| Area | Conclusion |
|---|---|
| **Single counting** | A structural property of Phase 3/4, not something Phase 5 invents: one `investment_transactions` row debits brokerage cash by exactly what the lot it opens gains, so cash and positions are already disjoint. Phase 5's contribution is to make it *checkable* — a `contributions: Map<SourceKey, Money>` that throws on a duplicate, plus a second-path reconciliation |
| **Account classification** | **By sign, not by kind.** `balance > 0` → asset, `< 0` → liability, `= 0` → neither. Kind decides the display group and the expected sign only |
| **Historical / as-of** | One eligibility table, every row date-driven. `is_active` is read by **no** calculation, on any table — asserted by a source scan, not by review |
| **Investments as of `T`** | Derived from `tax_lots` / `lot_disposals` bounded by `opened_on` / `closed_on` — **not** from `positions`, which is today's cache. Exact for three reasons: splits and bonuses touch no money, FIFO has a prefix property, and I-20 makes the subtraction residue-free |
| **Valuation basis** | `basis ∈ {'cost','market'}`; Phase 5 implements `'cost'`, Phase 6 adds `'market'` and flips the default |
| **Liabilities** | Two shapes. Transacted (linked account) contributes **nothing** — the account does. Scheduled contributes from an append-only balance series. Interest stays descriptive; no amortisation is computed |
| **Manual assets** | The existing model is sufficient. Valuations are a series, not a field. Four corrections, none of them an expansion |
| **Snapshots** | **Recommended out of Phase 5.** The history series is five set-based queries, so the performance case disappears — and the cache as specified cannot tell when it is stale (N13) |
| **Service shape** | `networth.ts` is read-only and exports **no** `WriteCtx` signature. Net Worth introduces no ledger and cannot mutate anything |

### 19 defects found in the baseline

Recorded as **N1–N19** in [NET-WORTH-DESIGN.md §14](docs/NET-WORTH-DESIGN.md). None is a live bug — no caller passes `asOf` and the Phase 5 tables do not exist — which is why they survived four completion gates. The two material ones:

- **N2 (high).** `deriveBalance()` adds `opening_balance` unconditionally, so an account opened in 2026 contributes its opening balance to net worth **as of 2020**. The date bound in `entryTotals()` correctly bounds *movements*; an opening position is not a movement.
- **N6 (high).** [FINANCIAL-DOMAIN.md §9.3](docs/FINANCIAL-DOMAIN.md#93-calculation)'s *"Σ marketValue — priced holdings only"* reports investments as **₹0** in the current price-free state, directly contradicting `ROADMAP.md`'s *"net worth is an at-cost figure"*. A contradiction inside the canonical set, surfaced rather than resolved unilaterally.

Also live today: **N1** — `FINANCIAL-DOMAIN.md` §3 and `src/server/domain/ledger/balance.ts:88` disagree about an overpaid credit card. §9.3 drops it from net worth entirely; `accountRole()` reports it as a debt. Same row, a ₹10,000 spread on a ₹5,000 balance.

### Proposed additions, not implemented

13 invariants (**I-8 restated**, plus **NW-1 … NW-13**), five explicit **non-invariants**, 43 adversarial scenarios each mapped to a named test, a schema delta ([§15](docs/NET-WORTH-DESIGN.md#15-schema-delta-proposal)) that is entirely additive, and the implementation gates in [§19](docs/NET-WORTH-DESIGN.md#19-phase-5-implementation-gates).

---

## Open decisions

| # | Decision | Blocks |
|---|---|---|
| **OD-1** | `NVIDIA_API_KEY` — needed to verify the model catalogue authenticated and to run the eval harness | Phases 7–9 |
| **OD-2** | `AGENTS.md` is byte-identical to `CLAUDE.md`. Two copies of a 2,181-line spec will drift. Recommendation: reduce `AGENTS.md` to a pointer — not done unilaterally, as another tool may require full content at that path | Nothing technically; an instruction-correctness risk |
| **OD-3** | Equity/ETF market-data provider and its terms. **Phase 4 consequence:** `instrument_prices` stays empty, so TWR returns `null` with `insufficient_price_history` and portfolio growth renders as gaps. Both are the documented behaviour, not defects | Phase 6 completion; TWR and the growth series until then |
| **OD-7** | **Phase 5 values investments at cost, even where a manual price exists.** `setManualPrice` already works, so a user can price a holding today and the Investments pages show market value — if Net Worth values the same securities at cost, two pages report two numbers for the same holdings. **Recommended: yes**, `basis: 'cost'` (ROADMAP's stated Phase 4–6 consequence), with the page stating the basis and linking to Investments. A partial market valuation would be a total in no basis at all. Alternative worth considering: a user-visible basis toggle in Phase 5 rather than Phase 6 | The meaning of the Phase 5 headline figure, and its UI copy |
| **OD-8** | **`net_worth_snapshots` and the `networth.snapshot` job move to Phase 6.** **Recommended: yes** — the history series is five set-based queries, so the performance case for a cache disappears, and the cache as specified stamps only the two ledger counters: nothing covers `asset_valuations`, `liability_balances`, `instrument_quotes` or `fx_rates`, so a snapshot can be stale with both stamps matching (N13). Removes two ROADMAP "Done when" items, which is why it needs approval rather than being an implementation call | The Phase 5 schema delta and two Phase 5 gates |
| **OD-9** | **Apply N1–N19 to the canonical documents before Phase 5 implementation begins**, following the OD-4 precedent. Documentation only; no code or schema changes in the pass. **Recommended: yes** — implementing against documents known to contain N2 and N6 would put those defects into the code | Phase 5 implementation start |

### Resolved

| # | Decision | Outcome |
|---|---|---|
| **OD-4** | Amend the approved baseline with the Phase 4 review's D1–D15 | ✅ **Approved and applied 2026-08-11.** The corrections are in the canonical documents; the landing table is at the top of [INVESTMENT-ENGINE-DESIGN.md](docs/INVESTMENT-ENGINE-DESIGN.md), which is now a review record, not a specification |
| **OD-5** | `investment_transactions.net_amount` currency | ✅ **Approved 2026-08-11: the account's currency.** `price` / `gross_amount` / `fees` / `taxes` stay in the instrument's. `deriveBalance()` therefore never mixes currencies, and an account's `currency_code` is immutable once it carries ledger rows. See [FINANCIAL-DOMAIN.md §3](docs/FINANCIAL-DOMAIN.md), [SCHEMA.md §6](docs/SCHEMA.md), [ADR-12](docs/DECISIONS.md) |
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
| Why was X decided that way? | [docs/DECISIONS.md](docs/DECISIONS.md) — 21 ADRs with rejected alternatives, plus D-9…D-23 above and D-24…D-27 in [ROADMAP.md](docs/ROADMAP.md) Phase 4 |
| What are the tables and invariants? | [docs/SCHEMA.md](docs/SCHEMA.md) — 20 invariants (I-1 … I-20) plus two explicit non-invariants |
| How does money behave? | [docs/FINANCIAL-DOMAIN.md](docs/FINANCIAL-DOMAIN.md) |
| How do holdings and returns behave? | [docs/INVESTMENT-DOMAIN.md](docs/INVESTMENT-DOMAIN.md) — corrected and authoritative |
| Why does the investment engine work that way? | [docs/INVESTMENT-ENGINE-DESIGN.md](docs/INVESTMENT-ENGINE-DESIGN.md) — the Phase 4 review record and rationale. **Non-normative**: where it and a canonical document differ, the canonical document wins |
| How is net worth meant to work, and what is wrong with the baseline? | [docs/NET-WORTH-DESIGN.md](docs/NET-WORTH-DESIGN.md) — the Phase 5 design review: single counting, as-of methodology, FX, liabilities, reconciliation, the schema delta, 13 invariants, 43 edge cases, defects N1–N19. **Non-normative**, same rule |
| How does the AI layer work and what can't it do? | [docs/AI-SYSTEM.md](docs/AI-SYSTEM.md) |
| What must be tested before a phase is done? | [docs/TESTING.md](docs/TESTING.md) and each phase's "Done when" |
| What am I building next? | [docs/ROADMAP.md](docs/ROADMAP.md) — Phase 5, Net Worth. **Designed, not started**: OD-7, OD-8 and OD-9 gate the first line of code |
