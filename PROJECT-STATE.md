# Project State

Durable status record. Conversation history is temporary; this file is not. Read this first after any context reset, then verify it against `docs/`, the source tree, and the tests before trusting it.

**Last updated:** 2026-08-11 · **Current phase:** 2 complete · **Phase 3 ready to implement** · Phase 4 designed and blocked on Phase 3

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
| `docs/` | 11 architecture documents. Baseline, approved. |
| `CLAUDE.md` / `AGENTS.md` | The specification. Byte-identical duplicates (see OD-2). |
| `Workflow Setup.txt` | Canonical 15-phase map ([ADR-20](docs/DECISIONS.md)) |
| Application code | **Phase 2 foundation.** Next.js 16, exact-money primitives, database, auth, app shell, tests. |
| Git repository | Initialised, `core.autocrlf=input`. Phase 2 foundation is committed; the Phase 4 design review and this correction pass are committed on `claude/investment-engine-review-3ed9bd`. |

## Phases

| Phase | Status |
|---|---|
| 0 — Environment & Repository | ✅ complete |
| 1 — Architecture | ✅ complete, **approved** |
| 2 — Foundation | ✅ complete, verified |
| 3 — Financial Core | not started; **unblocked and next.** Carries five amendments from the Phase 4 review — listed in [ROADMAP.md](docs/ROADMAP.md) Phase 3 and [INVESTMENT-ENGINE-DESIGN.md §11](docs/INVESTMENT-ENGINE-DESIGN.md) |
| 4 — Investment Engine | **designed, reviewed, corrections applied. Blocked on Phase 3** — `investment_transactions.account_id` has no FK target until `accounts` exists |
| 5 — Net Worth | not started |
| 6 — Market Data | not started (OD-3 affects completion, not start) |
| 7 — AI Infrastructure | **blocked** on OD-1 (`NVIDIA_API_KEY`) |
| 8–14 | not started |

---

## Local environment — how to run it

The Phase 2 blocker (no PostgreSQL, no Docker) was resolved without Docker Desktop, using the documented fallback in decision **D-4** (native PostgreSQL 17).

| | |
|---|---|
| PostgreSQL | **17.7**, portable binaries at `E:\Claude\_tools\pg17\pgsql`, data at `E:\Claude\_tools\pgdata`. No installer, no admin rights, no Windows service. |
| Start / stop | `E:\Claude\_tools\pg17\pgsql\bin\pg_ctl.exe -D E:\Claude\_tools\pgdata -l E:\Claude\_tools\pg.log start` (and `stop`). **It does not start on boot** — start it before `npm run dev`. |
| Databases | `financeos` (development), `financeos_test` (integration tests, truncated between test files) |
| Roles | `financeos_migrator` owns the schema and is the only role with DDL. `financeos_app` has DML only, INSERT/SELECT on `audit_log`, SELECT on `currencies`. |
| Credentials | Development-only, in `.env` (git-ignored). Regenerate for production. |

```
npm run db:migrate            # apply migrations + re-apply grants
npm run db:seed               # idempotent reference data
npm run db:rollback           # reverse the newest migration
npm run auth:create-user -- --email you@example.com     # password in FOS_PASSWORD
npm run dev | build | start
npm test                      # unit + property + integration
```

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
| **D-9** | Portable PostgreSQL 17 rather than Docker Desktop | D-4's documented fallback. No admin rights, no reboot, no hypervisor dependency. Only the connection string differs from a container. |
| **D-10** | Two database roles from day one | SECURITY.md §2 requires it in production; doing it in development means a missing grant fails a test rather than a deploy. Integration tests run as the application role. |
| **D-11** | Auth rate limits derived from `auth_events` | SECURITY.md §6 requires Postgres-backed limits. Every attempt already writes a row, so counting rows in a window needs no new table and cannot drift from the audit trail. |
| **D-12** | Account provisioning by CLI, no signup route | Single-user application. A registration endpoint would be an unauthenticated write path existing only to be attacked. |
| **D-13** | Hand-written down migrations + `db:rollback` | drizzle-kit generates forward migrations only, and ROADMAP Phase 2 requires clean rollback. A schema-fingerprint test asserts migrate → rollback → migrate is identical. |
| **D-14** | `SESSION_COOKIE_SECRET` signs the TOTP challenge cookie | SECURITY.md §3 lists the secret but §1's design never consumes it. The half-finished login between the password and TOTP steps needed exactly one signed, short-lived carrier. The session cookie remains an unsigned opaque token whose SHA-256 is stored, per §1. |
| **D-15** | Argon2id at 128 MiB / 3 passes | Measured, not copied: 64 MiB gave 158 ms against SECURITY.md §1's ≥250 ms floor. The table of measurements is in `src/server/auth/password.ts`. Memory was raised rather than passes, because memory hardness is what degrades GPU attacks. |
| **D-16** | Decimal input rejects malformed digit grouping | `1,5` means one and a half in much of Europe. Stripping commas blindly would read it as fifteen — a tenfold error entered silently. Both Indian and Western grouping are accepted; anything else is rejected. |

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

## Open decisions

| # | Decision | Blocks |
|---|---|---|
| **OD-1** | `NVIDIA_API_KEY` — needed to verify the model catalogue authenticated and to run the eval harness | Phases 7–9 |
| **OD-2** | `AGENTS.md` is byte-identical to `CLAUDE.md`. Two copies of a 2,181-line spec will drift. Recommendation: reduce `AGENTS.md` to a pointer — not done unilaterally, as another tool may require full content at that path | Nothing technically; an instruction-correctness risk |
| **OD-3** | Equity/ETF market-data provider and its terms | Phase 6 completion |
| **OD-6** | `settlement_date` — keep `trade_date` as the cash date (recommended: the divergence lasts one day and affects no realised figure, cost basis or P&L), model settlement, or drop the column. **Does not block Phase 3**, which never reads it; settle before Phase 4 writes it | Phase 4 schema |

### Resolved

| # | Decision | Outcome |
|---|---|---|
| **OD-4** | Amend the approved baseline with the Phase 4 review's D1–D15 | ✅ **Approved and applied 2026-08-11.** The corrections are in the canonical documents; the landing table is at the top of [INVESTMENT-ENGINE-DESIGN.md](docs/INVESTMENT-ENGINE-DESIGN.md), which is now a review record, not a specification |
| **OD-5** | `investment_transactions.net_amount` currency | ✅ **Approved 2026-08-11: the account's currency.** `price` / `gross_amount` / `fees` / `taxes` stay in the instrument's. `deriveBalance()` therefore never mixes currencies, and an account's `currency_code` is immutable once it carries ledger rows. See [FINANCIAL-DOMAIN.md §3](docs/FINANCIAL-DOMAIN.md), [SCHEMA.md §6](docs/SCHEMA.md), [ADR-12](docs/DECISIONS.md) |

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
- **PostgreSQL does not start automatically.** Start it before `npm run dev` (command above).

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

**Bugs found and fixed during verification** (recorded because each passed an earlier gate):
1. `app/(auth)/login/actions.ts` exported a constant from a `'use server'` module — accepted by `tsc` and by `next build`, HTTP 500 on the first POST. Fixed by moving the state shape to `form-state.ts`; `tests/unit/server-actions.test.ts` now guards the rule and was itself verified to fail on a deliberate violation.
2. The authenticated layout redirected to `/login` without the return path. Fixed by passing the pathname through an `x-pathname` request header from `proxy.ts`.
3. `Money.parseUserInput` accepted `1,5` as fifteen. Fixed to validate digit grouping (D-16).
4. Argon2id at 64 MiB measured 158 ms against a ≥250 ms requirement, and the source comment claimed 310 ms without having measured. Fixed to 128 MiB and the real measurement table recorded.

---

## Where knowledge lives

| Question | File |
|---|---|
| Why was X decided that way? | [docs/DECISIONS.md](docs/DECISIONS.md) — 21 ADRs with rejected alternatives, plus D-9…D-16 above |
| What are the tables and invariants? | [docs/SCHEMA.md](docs/SCHEMA.md) — 20 invariants (I-1 … I-20) plus two explicit non-invariants |
| How does money behave? | [docs/FINANCIAL-DOMAIN.md](docs/FINANCIAL-DOMAIN.md) |
| How do holdings and returns behave? | [docs/INVESTMENT-DOMAIN.md](docs/INVESTMENT-DOMAIN.md) — corrected and authoritative |
| Why does the investment engine work that way? | [docs/INVESTMENT-ENGINE-DESIGN.md](docs/INVESTMENT-ENGINE-DESIGN.md) — the Phase 4 review record and rationale. **Non-normative**: where it and a canonical document differ, the canonical document wins |
| How does the AI layer work and what can't it do? | [docs/AI-SYSTEM.md](docs/AI-SYSTEM.md) |
| What must be tested before a phase is done? | [docs/TESTING.md](docs/TESTING.md) and each phase's "Done when" |
| What am I building next? | [docs/ROADMAP.md](docs/ROADMAP.md) — Phase 3, Financial Core |
