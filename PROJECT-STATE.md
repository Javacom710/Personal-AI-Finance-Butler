# Project State

Durable status record. Conversation history is temporary; this file is not. Read this first after any context reset, then verify it against `docs/`, the source tree, and the tests before trusting it.

**Last updated:** 2026-08-10 · **Current phase:** 3 complete, 4 not started

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
| `docs/` | 11 architecture documents. Baseline, approved. |
| `CLAUDE.md` / `AGENTS.md` | The specification. Byte-identical duplicates (see OD-2). |
| `Workflow Setup.txt` | Canonical 15-phase map ([ADR-20](docs/DECISIONS.md)) |
| Application code | **Phases 2–3.** Next.js 16, exact-money primitives, database, auth, app shell — plus the whole money core: accounts, categories, tags, transactions, transfers, budgets, recurring rules, the job runner and the Money UI. |
| Git repository | Initialised, `core.autocrlf=input`. **No commit yet** — the working tree is the state. |

## Phases

| Phase | Status |
|---|---|
| 0 — Environment & Repository | ✅ complete |
| 1 — Architecture | ✅ complete, **approved** |
| 2 — Foundation | ✅ complete, verified |
| 3 — Financial Core | ✅ complete, verified |
| 4 — Investment Engine | not started; **unblocked** |
| 5 — Net Worth | not started |
| 6 — Market Data | not started (OD-3 affects completion, not start) |
| 7 — AI Infrastructure | **blocked** on OD-1 (`NVIDIA_API_KEY`) |
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

## Open decisions

| # | Decision | Blocks |
|---|---|---|
| **OD-1** | `NVIDIA_API_KEY` — needed to verify the model catalogue authenticated and to run the eval harness | Phases 7–9 |
| **OD-2** | `AGENTS.md` is byte-identical to `CLAUDE.md`. Two copies of a 2,181-line spec will drift. Recommendation: reduce `AGENTS.md` to a pointer — not done unilaterally, as another tool may require full content at that path | Nothing technically; an instruction-correctness risk |
| **OD-3** | Equity/ETF market-data provider and its terms | Phase 6 completion |

---

## Known debt and accepted risks

Recorded so these are not rediscovered as bugs.

**Carried from Phase 1**
- **`instruments` is per-user** (`UNIQUE (user_id, symbol, exchange)`). Correct at one user, wrong at ~10k — a migration, not a redesign.
- **Balances are computed on every read**, no stored column. Escape hatch pre-designed: a materialised roll-up keyed by `money_ledger_version`.
- **No Row-Level Security.** Fine single-user; the priority item if this ever becomes multi-tenant.
- **`PortfolioSnapshot`** folded into `net_worth_snapshots.breakdown` (JSONB). Flagged for a decision before Phase 6.
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
| Why was X decided that way? | [docs/DECISIONS.md](docs/DECISIONS.md) — 21 ADRs with rejected alternatives, plus D-9…D-23 above |
| What are the tables and invariants? | [docs/SCHEMA.md](docs/SCHEMA.md) — 14 invariants |
| How does money behave? | [docs/FINANCIAL-DOMAIN.md](docs/FINANCIAL-DOMAIN.md) |
| How do holdings and returns behave? | [docs/INVESTMENT-DOMAIN.md](docs/INVESTMENT-DOMAIN.md) |
| How does the AI layer work and what can't it do? | [docs/AI-SYSTEM.md](docs/AI-SYSTEM.md) |
| What must be tested before a phase is done? | [docs/TESTING.md](docs/TESTING.md) and each phase's "Done when" |
| What am I building next? | [docs/ROADMAP.md](docs/ROADMAP.md) — Phase 4, Investment Engine |
