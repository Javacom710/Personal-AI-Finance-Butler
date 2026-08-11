# Testing Strategy

The bar: **a feature is not done until the calculation behind it is tested, including its edge cases.** Coverage percentage is not the target; coverage of the financial engine's edge cases is.

## 1. Layers

| Layer | Tool | Scope | Speed | Run |
|---|---|---|---|---|
| Unit | Vitest | Pure functions: `Money`, lot engine, XIRR, TWR, recurrence expansion, allocation, invariants | < 5 s total | every save |
| Property | Vitest + fast-check | Algebraic laws over money and lots | < 30 s | every commit |
| Integration | Vitest + real Postgres | Application services against a live schema: transaction boundaries, authorization guards, constraints, triggers, rebuilds | < 60 s | every commit |
| Golden scenario | Vitest + real Postgres | Full multi-year fixtures with hand-verified expected outputs | < 60 s | every commit |
| Contract | Vitest + recorded fixtures | Market-data adapters against captured provider responses | < 10 s | every commit |
| AI | Vitest, no network | Tool schemas, capability gating, fallback classes, loop policy, proposal validation, injection cases | < 10 s | every commit |
| Model eval | Live provider | Model quality per tier — **manual, never in CI** (§7a) | minutes | Phase 8, quarterly |
| E2E | Playwright | The handful of flows a broken build must not ship | < 3 min | pre-deploy |

Integration tests require a Postgres instance. `testcontainers` was the original preference (decision **D-4**), but Docker was never installed, so they run against a dedicated `financeos_test` database on the local **PostgreSQL 18.4 service** (**D-23**), truncated between test files. The database is always available — it starts with Windows — so no test setup starts or waits for it.

## 2. Priority order

If time is short, tests are written in this order. This ordering is the point of the document.

1. `Money` arithmetic and rounding
2. Lot engine (FIFO, splits, bonuses, oversell)
3. Transaction invariants and transfer handling
4. Account balance
5. Net worth and change attribution (including `unexplained = 0`)
6. XIRR / TWR
7. Recurrence expansion and idempotent posting
8. Budget status
9. AI proposal validation
10. UI

## 3. Unit tests — the engine

### `Money`

Table-driven, covering:
- Construction from `NUMERIC(20,4)` strings including trailing zeros, negative values, and the scale boundary.
- `add`/`sub` associativity and commutativity; `sum([])` returns zero rather than throwing.
- Cross-currency `add` throws (a programming error, deliberately not a `Result`).
- Every rounding mode at the `.00005` boundary and at negative values (`half_up` on `-0.5` must be documented and tested, not assumed).
- `allocate` — parts sum back exactly for every split of 1 to 12 ways over amounts that do not divide evenly.
- `toMinorNumber` throws above `Number.MAX_SAFE_INTEGER`.
- `NUMERIC(20,4)` upper bound: no overflow, no silent truncation.

### `UnitPrice`

- A NAV of `123.45678900` round-trips through `UnitPrice` without loss. **The same value through `Money` is asserted to lose precision** — proving the test detects the truncation rather than passing vacuously.
- `valueOf(quantity, price)` at the `.5` boundary in both signs; `perUnit` throws on a zero quantity.
- `mulQtyRatio(m, num, den)` — the property that matters: consuming a lot in any sequence of partial slices, with the final slice taking the remainder verbatim, sums back to the original exactly.
- `NUMERIC(20,8)` boundary, same as `Money`.

### Property tests (fast-check)

```
∀ a, b, c : Money(same currency)
  add(add(a,b),c) === add(a,add(b,c))
  add(a,b) === add(b,a)
  sub(a,a) is zero
  neg(neg(a)) === a

∀ m : Money, parts : positive weights
  sum(allocate(m, parts)) === m

∀ m : Money, s : string
  fromDbString(toDbString(m)) === m

∀ txns : valid investment transaction sequence
  Σ tax_lots.remaining_quantity === positions.quantity
  Σ tax_lots.remaining_cost === positions.cost_basis            -- EXACT, no tolerance (I-6)
  Σ cost_consumed + remaining_cost === cost_total   per lot     -- I-20, holds after any
                                                                -- sequence of buys, sells,
                                                                -- splits and bonuses
  replay(txns) === replay(txns)                     -- determinism
  replay(txns) === rebuildIncrementally(txns)       -- incremental === full
  replay(shuffleWithinTradeDate(txns)) === replay(txns)   -- entry order is not an input
```

The last three are the properties that catch the classes of bug where a rebuild produces a different answer than the incremental path, and where the answer depends on the order rows happened to be entered.

`Σ remaining_cost === cost_basis` is asserted **exactly**. The former `± 1 minor unit per lot` tolerance was a consequence of storing `cost_per_unit` and multiplying it on read; lots now store money exactly and derive the rate, so there is nothing to drift ([INVESTMENT-DOMAIN.md §4](INVESTMENT-DOMAIN.md#rounding-in-the-engine)). A property test with a tolerance would pass against an engine that leaks a paisa per disposal.

**Not asserted, deliberately:** `Σ lot_disposals.quantity + remaining_quantity === original_quantity`. It is false after a corporate action touches a partially disposed lot — see the non-invariants table in [SCHEMA.md §12](SCHEMA.md#12-invariants-summary).

### Lot engine

Every case listed in [INVESTMENT-DOMAIN.md §12](INVESTMENT-DOMAIN.md#12-edge-cases-that-must-be-covered-by-tests) is a named test. Each is a plain array of transactions in, expected lots/disposals/position out — no database, no mocks.

Hand-verified reference cases (computed independently in a spreadsheet, checked into `tests/golden/`):
- **L0 — the average-cost drift case (minimal, run first).** Buy 100 @ ₹100, buy 100 @ ₹150 → quantity 200, `cost_basis` ₹25,000, derived average ₹125. Then sell 100 @ ₹200 → FIFO closes the ₹100 lot entirely, realised P&L ₹10,000, remaining `cost_basis` ₹15,000, **derived average jumps to ₹150 with nothing purchased**. Asserts that average cost is computed from surviving lots, never carried forward. A stored average would report ₹125 and a realised P&L of ₹7,500 — wrong by ₹2,500 on a taxable gain.
- 3 buys at ₹100/₹150/₹200, sell 150 units of 300 — FIFO realised P&L to the paisa, and `Σ realized_pnl = netProceeds − Σ cost_consumed` **exactly** across the three lots.
- Buy, 1:5 split, sell — realised P&L must be identical to the no-split equivalent at the adjusted price, and `Σ cost_total` byte-identical before and after the split.
- Buy, 1:1 bonus, sell half — derived average cost halves, basis unchanged, realised P&L exact.
- Buy in USD with an FX move, sell — base-currency P&L splits correctly into price and FX components, and the two sum back to `base_realized_pnl` exactly (I-18).
- **L1 — the fee double-count case.** The worked fixture in [INVESTMENT-DOMAIN.md §6.3](INVESTMENT-DOMAIN.md#63-worked-verification-that-nothing-is-counted-twice): buy 100 @ ₹100 + ₹50 fee, ₹500 dividend with ₹50 TDS, sell 40 @ ₹150 + ₹30 fee, remainder at ₹160. Asserts `totalReturn = ₹5,970` by **both** the component sum and the cash cross-check, `totalReturnPct = 59.40%` on `costDeployed`, and `unrealizedReturnPct = 59.20%` on `investedCapital`. Accruing trade fees to `fees_total` as well gives ₹5,890; using one denominator for both gives 99.00%.

Every case in [INVESTMENT-DOMAIN.md §12](INVESTMENT-DOMAIN.md#12-edge-cases-that-must-be-covered-by-tests) is a named test, including cases **21–31** added by the Phase 4 design review — each guards a specific defect that the pre-review documents would have produced.

### XIRR / TWR

- Known-answer tests against Excel/LibreOffice `XIRR` for 10 cash-flow series, agreeing to 6 decimal places.
- Convergence: a series with a −95% return (near the bracket edge) resolves via bisection.
- All `null` paths: fewer than 2 flows, single-sign flows, same-date flows, non-convergence, insufficient price history for TWR. Each asserts `null` **and** the stated reason — a test that only asserts `null` would pass if the function always returned `null`.
- **Scope construction**, which is where the series is most easily built wrong ([INVESTMENT-DOMAIN.md §7](INVESTMENT-DOMAIN.md#7-xirr)):
  - Brokerage cash is **excluded** from the terminal value; a dividend reinvested the same day contributes `+500` then `−500` and nets to zero, while an un-reinvested one remains a return.
  - A matched `transfer_out`/`transfer_in` pair is **excluded** at portfolio scope and produces the same XIRR as if the transfer had never happened.
  - The same unmatched leg at **account** and **instrument** scope enters at `gross_amount` — asserted against a fixture where treating it as a zero flow yields a divergent or infinite return.
- **TWR boundary convention:** a flow dated `D` belongs to the period *starting* at `D`. A fixture with one flow is asserted against the hand-computed figure under that convention, and against the figure the opposite convention would produce — so the choice is pinned, not accidental.

### Recurrence

- Monthly on the 31st across Jan→Feb→Mar in a leap and a non-leap year.
- `BYMONTHDAY=-1`, `BYDAY=MO` weekly, `INTERVAL=2` fortnightly, `COUNT` and `UNTIL` termination.
- DST boundaries in `Asia/Kolkata` (no DST — also tested with a DST timezone to prove the date maths is timezone-correct rather than accidentally correct).

## 4. Integration tests

Against a real Postgres, because half the invariants are database constraints and triggers.

- The `check_transaction_shape()` trigger rejects every invalid shape in the [FINANCIAL-DOMAIN.md §12](FINANCIAL-DOMAIN.md#12-edge-cases-that-must-be-covered-by-tests) list.
- `ON DELETE RESTRICT` blocks deleting a category in use, an account with entries, an instrument with transactions.
- `UNIQUE (rule_id, due_on)` — the posting job run twice on the same day creates exactly one transaction. Also tested with two concurrent runners.
- A failed write inside an application service rolls back completely (the service owns the transaction boundary): no orphan entries, no bumped `ledger_version`, no audit row.
- `rebuildPosition` is idempotent: running it twice produces identical rows.
- Full rebuild equals incremental rebuild across a 500-transaction fixture.
- **Investment `CHECK` constraints reject at the database, not merely at the service.** Each asserted by a direct `INSERT` that bypasses the service layer: `cash_settled = false` with a non-zero `net_amount` (I-16); `realized_pnl ≠ proceeds − cost_consumed` (I-15); a lot with `remaining_quantity = 0` but non-zero `remaining_cost` (I-19); a `split` carrying a quantity or a price; `gross_amount` disagreeing with `|quantity| × price`. A rule enforced only in TypeScript is not enforced against a restore, a script, or `psql`.
- **The three-denomination cash chain (OD-5).** A USD instrument bought, and a USD dividend received, into an **INR** brokerage account: both rows insert successfully; `net_amount_instrument` satisfies its per-kind identity in USD; `net_amount = round(net_amount_instrument × fx_rate_instrument_to_account, 4)` in INR; `base_net_amount` follows from that; and `deriveBalance()` returns rupees throughout. **A regression test asserts the row is not rejected** — stating the identity on `net_amount` instead makes every foreign-currency dividend and trade unrecordable, which is a schema-level failure no engine test would catch.
- **Same-currency collapse.** With instrument and account currency equal, `fx_rate_instrument_to_account = 1` and `net_amount_instrument = net_amount` exactly — asserted so the common path cannot drift from the general one.
- **A backdated oversell rolls back completely.** Inserting a sell dated before existing purchases such that the position goes short at that instant leaves lots, disposals, positions and `investment_ledger_version` byte-identical to before — the rebuild shares the mutation's transaction ([INVESTMENT-DOMAIN.md §4](INVESTMENT-DOMAIN.md#rebuild)).
- Job claiming with `FOR UPDATE SKIP LOCKED` under two concurrent runners: each job executes exactly once.
- `verify:integrity` passes on a freshly seeded database and fails on a deliberately corrupted one (a test that asserts the checker actually catches something).

## 5. Golden scenarios

Multi-year fixtures with every figure verified by hand once and then frozen. These are the regression net for the whole engine.

| Scenario | Exercises |
|---|---|
| **G1 — Salaried year** | 12 monthly salaries, ~200 expenses, 2 transfers, 3 budgets. Asserts: monthly and annual income/expense/savings/savings rate, budget utilisation, account balances, net-worth series. |
| **G2 — Equity investor** | 20 buys, 8 partial sells, 2 splits, 1 bonus, 6 dividends, brokerage fees. Asserts: FIFO realised P&L, holdings, allocation, XIRR, TWR. Also asserts `Σ cost_total` is unchanged by both splits and the bonus, that trade fees appear in **no** `fees_total`, and that a split sharing a `trade_date` with a buy gives the same result under both insertion orders. |
| **G3 — Mixed portfolio** | Equity + mutual funds + gold + a USD ETF + a fixed deposit. Asserts: multi-currency valuation, per-class allocation, FX component in attribution summing back to `base_realized_pnl` exactly, and that the USD ETF bought from an INR brokerage account leaves the account balance in rupees throughout (OD-5). |
| **G4 — Debt and liabilities** | Home loan with EMIs, a credit card carrying a balance, a car loan closed mid-period. Asserts: liability totals, no double counting, net-worth attribution split into principal and interest. |
| **G5 — Sparse data** | 3 unpriced instruments, a manual asset with no valuation, a missing FX rate, a stale price. Asserts: coverage < 1, correct `null` propagation, nothing silently zeroed, the UI-facing warnings present. |
| **G6 — Corrections** | A transaction edited, one deleted, an investment transaction back-dated before existing ones. Asserts: derived state rebuilt correctly, historical snapshots recomputed, audit trail complete. |

**Every golden scenario asserts `unexplained ≈ 0`** in the net-worth bridge (tolerance: one base-currency unit). This single assertion catches most engine regressions, because almost any calculation error shows up as an unexplained residual.

Golden expected values live in `tests/golden/*.expected.json`. Changing one requires a PR comment explaining why the previously verified number was wrong.

## 6. Market-data contract tests

- Real provider responses captured once into `tests/fixtures/market-data/` and replayed. No network in CI.
- Every adapter is tested for: normal response, empty response, malformed JSON, HTTP 500, HTTP 429, timeout, and an unknown symbol. **All seven must produce a `PriceResult`, never a thrown exception.**
- `ManualProvider` staleness transitions at the `price_stale_after_hours` boundary.
- Registry resolution order: explicit provider → first supporting provider → manual.
- A separate, opt-in `test:live-providers` script hits real endpoints and is run manually before changing a provider — never in CI.

## 7. AI tests — all offline

**No test in CI calls NVIDIA Build.** The model is not the system under test; our handling of it is. Model quality is measured separately by the evaluation harness (§7a), which is online, manual, and never gates a merge.

- **Schema generation:** every tool's `z.toJSONSchema()` output has `additionalProperties: false` and a complete `required` array.
- **Tool handlers:** each tested directly, including the row cap, the `truncated` flag, and the projected field set. A test asserts no handler's output contains a field outside its declared contract — the data-minimisation guarantee.
- **Authorisation:** a test asserts that no tool input schema contains a user-identifier field. If someone adds one, this fails.
- **Model-identifier leakage:** a source scan asserts no model id string appears outside `src/server/ai/config/`, and that no file under `prompts/`, `loop.ts`, `tools/`, or `structured/` branches on a model identity. This is what keeps "swap a model = one env line" true over time (AI-SYSTEM.md §17).
- **Routing:** a labelled corpus asserts the tier for each message shape. Explicitly includes the **sticky-escalation trap** — a Tier-2 question followed by "what's my HDFC balance?" must route back to Tier 1, not inherit Tier 2. Also asserts Tier 3 is unreachable without an explicit user action, and that `runFinancialScenario` stays at Tier 2.
- **Write-unreachability (type-level):** a `tsc`-based test asserts that calling any command service with a `ReadCtx` fails to compile, and a source scan asserts no file under `src/server/ai/**` imports `db/**`, `domain/**`, or any `services/*` command export. These are the two mechanisms behind "the AI cannot write" — if either lapses, the claim is false.
- **Double-confirm:** applying the same proposal twice concurrently produces exactly one transaction. Asserted against a real Postgres with two parallel calls — the compare-and-swap must lose one, and the partial unique index must catch it even with the CAS stubbed out.
- **Expired proposal:** confirming after `expires_at` writes nothing and returns a typed error.
- **Capability gating** (the highest-value new tests, because they enforce [ADR-18](DECISIONS.md#adr-18--a-measured-capability-matrix-gates-routing-and-fallback)):
  - A model with `structuredOutput: 'none'` is never selected for a proposal task.
  - A model with `toolCalling: 'none'` is never selected for a tool-using task.
  - A text-only model is never selected for a vision task.
  - **Cross-tier downgrade is impossible:** with every Tier 2 candidate failing, the request errors with `all_candidates_exhausted` — it does not return a Tier 1 answer.
  - A model absent from `capabilities.json`, or with a stale entry, is excluded from routing.
  - Tier 3 is unreachable without an explicit user action.
- **Fallback behaviour** against recorded provider responses: each failure class (`unavailable`, `rate_limited`, `timeout`, `invalid_schema`, `tool_call_failed`, `content_filter`, `transport`) routes as specified; `content_filter` is **not** retried on another model; the circuit breaker opens after 3 consecutive failures and half-opens after the cool-down; `ai_model_attempts` records every attempt with its class.
- **Loop policy:** tool-use iteration, the 8-iteration cap, the 150 KB byte budget, the daily budget check firing **before** the request, every `tool_call_id` being answered, and error results being returned rather than dropped.
- **Structured-output strategies:** `json_schema`, `json_object`, and prompted-JSON paths each tested; exactly **one** repair attempt is made; a second failure rejects rather than retrying forever.
- **Proposal validation:** a corpus of ~40 model outputs — good, malformed, ambiguous, adversarial — each with an expected outcome. Includes: amount as a JSON number instead of a string, negative amount for income, category-kind mismatch, non-existent account name, date before the account opened, amount with 6 decimal places.
- **Injection corpus:** transaction descriptions and notes containing instruction-shaped text. Assertion: no write occurs, no unexpected tool call is made, no tier escalation happens, and the loop completes normally.
- **Prompt size budget:** the rendered system prompt plus tool schemas is asserted under a token ceiling. Because NVIDIA Build has no prompt caching, prompt size is a linear per-request cost — this test replaces the cache-hit test that a caching provider would have needed, and guards the same property (nobody silently grows the prefix).

### 7a. Model evaluation harness — online, manual, not CI

Phase 8. `npm run ai:eval` calls the live provider and is **never** part of the merge pipeline: it costs money, it is slow, and model output is not deterministic.

- Deterministic scoring wherever a right answer exists: schema valid, field-exact match, correct tool, correct arguments, stated figure equals engine figure.
- LLM-as-judge is used only for prose quality, is advisory, and never scores a numeric claim.
- Output is written to `capabilities.json` and `ai_model_evaluations`.
- **CI does check one thing:** that every production-routed model has a `capabilities.json` entry no older than 30 days and measured against the current eval version. That is a freshness assertion over stored results, not a live call.

## 8. E2E tests

Deliberately few. Playwright, against a seeded database.

1. Login → TOTP → dashboard renders with correct figures.
2. Create an expense via quick-add (structured path) → appears in the list → account balance updated.
3. Create a transfer → appears in both accounts → does **not** appear in income or expense totals. *(This is the highest-value E2E test in the suite.)*
4. Record a buy → holding appears with correct average cost → record a sell → realised P&L correct.
5. AI proposal (mocked model response) → card renders → confirm → transaction created with `source='ai'` and an audit entry with `actor='ai_confirmed'`.
6. Export data → archive downloads and parses.
7. Unauthenticated access to every app route redirects to login.

## 9. Definition of done for a financial calculation

A calculation ships only when all of the following hold:

- [ ] Implemented as a pure function where possible
- [ ] Unit tests for the happy path
- [ ] Unit tests for every edge case in the relevant `Edge cases` list
- [ ] Zero, negative, and empty-input cases explicitly tested
- [ ] `null`/unavailable paths tested with their stated reason, not just `null`
- [ ] Rounding behaviour tested at the `.5` boundary in both signs
- [ ] Reference case verified independently (spreadsheet or published formula) and checked in
- [ ] Covered by at least one golden scenario
- [ ] Type checking passes
- [ ] Lint passes
- [ ] Production build passes

## 10. CI pipeline

```
npm ci
npm run typecheck          # tsc --noEmit, strict
npm run lint               # eslint, incl. import-boundary and no-NEXT_PUBLIC-secret rules
npm run test:unit
npm run test:property
npm run test:integration   # spins up Postgres
npm run test:golden
npm run test:ai
npm run build              # next build must succeed
npm audit --audit-level=high
npm run test:e2e           # pre-deploy only
```

Any failure blocks the merge. There is no `--passWithNoTests` and no skipped test left in the tree — a skipped test is deleted or fixed.
