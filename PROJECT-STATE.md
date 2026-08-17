# Project State

Durable status record. Conversation history is temporary; this file is not. Read this first after any context reset, then verify it against `docs/`, the source tree, and the tests before trusting it.

**Last updated:** 2026-08-15 · **Current phase:** **5 complete — Net Worth at Cost** · **Phase 6 — Market Data is next, and not started**

This is the **Phase 5 completion checkpoint**, and the handover into Phase 6. Phases 0–5 are done; the verification that closed Phase 5 — automated **and** signed-in browser — is recorded below under *Phase 5 final verification*.

**1,049 tests pass** — 617 unit, 56 property, 376 integration. `verify:integrity` reports **27 passing, 0 failing, 8 enforced by the engine, 2 deferred to Phase 9**. Typecheck, lint and the production build are clean. **Signed-in browser verification passed**, finding and fixing two display defects.

**Infrastructure verified:** PostgreSQL **18.4** as the Windows service `postgresql-x64-18` (`Automatic` start, runs as `NT AUTHORITY\NetworkService`), independent of any shell or tool lifetime. Databases `financeos` and `financeos_test`, two least-privilege roles, connectivity confirmed by the 376 integration tests, `verify:integrity` against `financeos`, and a live signed-in browser session.

**Phase 6 — Market Data has NOT started.** No provider, adapter, refresh job, price history, market-value net worth, snapshot table or snapshot job exists.

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
| 6 — Market Data | not started; **next** (OD-3 affects completion, not start) |
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

## Phase 6 — Market Data · NOT STARTED

The next phase. Nothing in it has been built: no provider, no adapter, no
refresh job, no price history, no market-value net worth, no snapshot table or
job.

**Purpose.** Give the investment engine prices. Phase 4 built cost basis,
realised P&L and the lot engine — none of which need a price — and Phase 5 built
net worth on that same at-cost footing. Phase 6 is where a price first enters
the system.

| What it unblocks | Why it is blocked today |
|---|---|
| **Market-value net worth** — `basis: 'market'` as a **distinct** calculation alongside Phase 5's `'cost'`, becoming the default ([ADR-23](docs/DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost)) | No price source. A single figure must never mix the two bases |
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

**The next action is a Phase 6 architecture and provider review** — not
implementation. Read `docs/ARCHITECTURE.md`, `docs/INVESTMENT-DOMAIN.md` §5 and
§8.1, [ADR-11](docs/DECISIONS.md#adr-11--market-data-behind-a-provider-abstraction-with-an-always-available-manual-provider),
and `docs/ROADMAP.md` Phase 6 before writing anything.

---

## Open decisions

| # | Decision | Blocks |
|---|---|---|
| **OD-1** | `NVIDIA_API_KEY` — needed to verify the model catalogue authenticated and to run the eval harness | Phases 7–9 |
| **OD-2** | `AGENTS.md` is byte-identical to `CLAUDE.md`. Two copies of a 2,181-line spec will drift. Recommendation: reduce `AGENTS.md` to a pointer — not done unilaterally, as another tool may require full content at that path | Nothing technically; an instruction-correctness risk |
| **OD-3** | Equity/ETF market-data provider and its terms. **Phase 4 consequence:** `instrument_prices` stays empty, so TWR returns `null` with `insufficient_price_history` and portfolio growth renders as gaps. Both are the documented behaviour, not defects | Phase 6 completion; TWR and the growth series until then |

### Resolved

| # | Decision | Outcome |
|---|---|---|
| **OD-4** | Amend the approved baseline with the Phase 4 review's D1–D15 | ✅ **Approved and applied 2026-08-11.** The corrections are in the canonical documents; the landing table is at the top of [INVESTMENT-ENGINE-DESIGN.md](docs/INVESTMENT-ENGINE-DESIGN.md), which is now a review record, not a specification |
| **OD-5** | `investment_transactions.net_amount` currency | ✅ **Approved 2026-08-11: the account's currency.** `price` / `gross_amount` / `fees` / `taxes` stay in the instrument's. `deriveBalance()` therefore never mixes currencies, and an account's `currency_code` is immutable once it carries ledger rows. See [FINANCIAL-DOMAIN.md §3](docs/FINANCIAL-DOMAIN.md), [SCHEMA.md §6](docs/SCHEMA.md), [ADR-12](docs/DECISIONS.md) |
| **OD-7** | Net-worth valuation basis before market data exists | ✅ **Approved 2026-08-12: Net Worth at Cost.** Phase 5 calculates and presents net worth **at cost**; investment positions contribute the **exact Phase 4 cost basis**; market value and cost are **never mixed inside one figure**; no screen shows an unqualified "Net worth" that could imply a current market valuation. Phase 6 introduces market-value net worth as a **distinct** calculation. **No valuation toggle in Phase 5** — the existing design does not need one. Normative: [ADR-23](docs/DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost) |
| **OD-8** | `net_worth_snapshots` and the `networth.snapshot` job | ✅ **Approved 2026-08-12: moved to Phase 6.** Phase 5 uses deterministic derivation; **every Phase 5 gate requiring a snapshot is removed**; `user_state.valuation_version` is deferred with them. Phase 6 may still introduce snapshots if measurement justifies it, under four stated rules. Normative: [ADR-24](docs/DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6) |
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
| How does the AI layer work and what can't it do? | [docs/AI-SYSTEM.md](docs/AI-SYSTEM.md) |
| What must be tested before a phase is done? | [docs/TESTING.md](docs/TESTING.md) and each phase's "Done when" |
| What am I building next? | [docs/ROADMAP.md](docs/ROADMAP.md) — **Phase 6, Market Data**. Not started; OD-3 gates its completion, not its start |
