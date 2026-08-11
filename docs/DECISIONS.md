# Architecture Decision Record

One entry per material decision. Each states the decision, why, and what was rejected. Amend rather than delete; supersede with a new ADR that references the old one.

---

## ADR-01 — Single Next.js application, no service split

**Decision.** One Next.js 16 (App Router) TypeScript application containing UI, API route handlers, server actions, domain logic, and the AI layer. One PostgreSQL database. One deployable unit.

**Why.** Single user, single writer, no independent scaling axis. Every cross-service boundary would be pure overhead and a place for financial data to drift out of sync.

**Rejected.** Separate API service (needless network hop, duplicate auth, distributed transactions for a one-user app). Serverless-function-per-endpoint (cold starts on a low-traffic personal app, connection-pool pain against Postgres).

---

## ADR-02 — PostgreSQL as the single source of financial truth

**Decision.** PostgreSQL 17. All financial records live in it. No secondary store, no cache that can answer a financial question authoritatively.

**Why.** Exact `NUMERIC` arithmetic, real transactions, mature date/interval handling, generated columns, `JSONB` for the small number of genuinely schemaless fields (AI payloads, snapshot breakdowns), and trivial backup via `pg_dump`.

**Rejected.** SQLite (no `NUMERIC` — its `DECIMAL` is a float alias, which is disqualifying for money; weaker concurrent access; harder managed hosting). MySQL (weaker `JSONB`, no partial indexes, worse `NUMERIC` ergonomics). Any document database (financial data is intensely relational).

---

## ADR-03 — Drizzle ORM over Prisma

**Decision.** Drizzle ORM + drizzle-kit for schema and migrations.

**Why.**
- Drizzle returns `NUMERIC` columns as **strings** by default, which is exactly what we want — the value is parsed into our own `Money`/`Decimal` type rather than silently becoming a lossy JS `number`. Prisma maps `Decimal` to a bundled Decimal.js instance, which is safe but introduces a second numeric type alongside ours.
- No separate query engine binary; no generate step in the deploy path; smaller cold start.
- SQL-shaped API. The financial engine has several aggregate queries (balances, period roll-ups, allocation) that are naturally expressed as SQL. Drizzle lets them stay SQL without dropping to raw strings.
- Migrations are plain `.sql` files under version control and can be reviewed as SQL.

**Rejected.** Prisma 7 (heavier, engine binary, `Decimal` type duplication, migration DSL further from the SQL that actually runs). Raw `pg` + hand-written SQL (loses type safety across ~30 tables; we would rebuild a worse ORM). Kysely (excellent, but no first-class migration/schema story — we would still add drizzle-kit or equivalent).

---

## ADR-04 — Money is an exact scaled integer, never a float

**Decision.**
- Storage: monetary amounts as `NUMERIC(20,4)`; quantities as `NUMERIC(28,8)`; unit prices as `NUMERIC(20,8)`; FX rates as `NUMERIC(20,10)`.
- Application: a first-party `Money` value type = `{ minor: bigint, currency: CurrencyCode }` at a fixed scale of 4 for all currencies, plus a `Quantity` type at scale 8. Implemented in `src/lib/decimal/` with no external dependency.
- `number` is permitted **only** inside iterative numeric solvers (XIRR/IRR root-finding). Solver output is a rate, never a monetary amount, and is rounded to a declared precision before it leaves the module.
- Rounding is explicit at every division; default is half-up at the target scale. A rounding call MUST name its scale.

**Why.** IEEE-754 cannot represent 0.1. Any float in an accumulation path eventually produces a balance that does not reconcile. A `bigint` at fixed scale is exact, comparable, and cheap; scale 4 covers paise/cents plus two extra digits for intermediate FX and fee splitting without needing per-currency scale logic in the arithmetic core (display scale is a formatting concern, driven by `currencies.minor_units`).

**Rejected.** `decimal.js` / `big.js` (well-tested, but arbitrary precision invites unrounded intermediates and a second numeric type in the codebase; we want a small, total, auditable API). `dinero.js` v2 (good model, but its immutable-transformer API and currency registry are more machinery than a single-user app needs). Storing minor units as `BIGINT` in Postgres (loses the ability to read/aggregate amounts meaningfully in SQL and in `psql`, which matters for backup verification and ad-hoc audit).

---

## ADR-05 — Entry-based ledger for cash movements

**Decision.** Two tables: `transactions` (the user-facing header — date, kind, description, category, notes) and `transaction_entries` (one signed amount per affected account). Income and expense have exactly one entry; a transfer has exactly two that net to zero in base currency. Account balance = `opening_balance + SUM(entries.amount)`.

**Why.**
- Every balance, period total, and allocation query has **one** shape: sum signed entries. No `CASE WHEN account_id = ... THEN -amount ELSE +amount` branching duplicated across a dozen queries, which is where sign errors live.
- Transfers are structurally incapable of being counted as income or expense — the classification lives on the header and transfers carry no category. This is a hard requirement in `CLAUDE.md` and this design enforces it rather than relying on every query remembering to filter.
- Split transactions (one purchase, several categories or accounts) become a data change, not a schema change.

**Cost accepted.** One extra join for a transaction list, and a validation function that enforces the per-kind entry invariants (see [SCHEMA.md](SCHEMA.md)).

**Rejected.** Single-row transfers (`account_id` + `counter_account_id`): simpler to write, but every aggregate becomes two-branch and every new report is a fresh opportunity to get a sign wrong. Full general-ledger double-entry with a chart of accounts and equity/retained-earnings accounts: correct, but it makes a personal expense entry require choosing two accounts, which destroys the fast-entry UX and is not what a single user needs.

---

## ADR-06 — Holdings are derived, cached, and rebuildable

**Decision.** `investment_transactions` is the only investment truth. `tax_lots`, `lot_disposals`, and `positions` are **derived tables** produced by a deterministic replay of the ledger in `(trade_date, kind_rank, created_at, id)` order. They are rebuilt on every ledger mutation for the affected `(account, instrument)` pair, and can be fully rebuilt from scratch by a single command.

`kind_rank` places corporate actions **after** same-day trades. Ordering on `created_at` alone is a total order over *rows*, not over *economic events*: a split and a buy sharing a `trade_date` would replay in whichever order the rows happened to be entered, so one ledger could yield two answers ([INVESTMENT-DOMAIN.md §3](INVESTMENT-DOMAIN.md#ordering)).

**Why.** Recomputing every position on every page load is too slow once there are thousands of transactions; treating positions as independently editable truth guarantees they will eventually disagree with the ledger. Derive-and-cache with a forced rebuild path gives read speed without a second source of truth.

**How the cache stays honest.** The rebuild runs **inside the same transaction as the ledger mutation**, so `positions` never disagrees with the ledger and a failed replay rolls the mutation back. `user_state.investment_ledger_version` invalidates `net_worth_snapshots`, which is computed per date over the whole portfolio; on `positions` the recorded version is a **provenance stamp only**, because a single per-user counter would mark every non-mutated position stale forever ([ARCHITECTURE.md §6](ARCHITECTURE.md#6-cache-invalidation)).

**Rejected.** Recompute-on-read only (too slow, and repeated identical work). Positions as editable primary records (unauditable — you can no longer answer "why is this the average price").

---

## ADR-07 — Cost basis engine with a pluggable matching strategy, default FIFO

**Decision.** One cost basis engine whose **disposal-matching strategy is a parameter**, with FIFO as the default and the only implemented strategy at launch. `instruments.cost_basis_method` carries the setting per instrument (`fifo` | `average` | `specific_id`), so a jurisdiction change or a single instrument needing different treatment is a data change, not an engine rewrite. Average cost is reported as `cost_basis / quantity`, derived from the same lots.

**Why the seam is exactly there.** Matching is the *only* thing that varies between methods. Lot opening, fee capitalisation, corporate actions, income accrual, position totals, and the `Σ remaining_cost = cost_basis` invariant are all method-independent. Isolating one `select()` call means a second method is a new strategy plus its own test table — not a second engine to keep in sync.

**Why FIFO is the default.** It matches Indian tax treatment for listed equity and mutual funds, and it is strictly the most informative: average cost falls out of FIFO lots for free, while FIFO cannot be recovered from an average-cost position. Changing an instrument's method triggers a full rebuild of its positions and rewrites realised P&L on closed disposals, so the UI warns first and the change is audited.

**Why.** FIFO matches Indian tax treatment for listed equity and mutual funds, and it is the strictly more informative engine — average cost falls out of it for free, while the reverse is not true. One engine means one set of edge cases (partial sells, splits mid-holding, bonus issues, buy-back to zero and re-entry) to test.

**Rejected.** Weighted-average-only (cannot produce lot-level realised P&L or holding-period classification for tax). Implementing both engines at launch (duplicated edge-case surface for a benefit nobody has asked for).

---

## ADR-08 — AI proposes; application code mutates

**Decision.** No AI tool may write to the database. Write-shaped AI output is produced as a **structured output** (a JSON Schema derived from the Zod schema, delivered through whichever mechanism the selected model supports — see [AI-SYSTEM.md §9](AI-SYSTEM.md#9-the-mutation-boundary)), validated, persisted to `ai_proposals` with status `pending`, surfaced to the user for confirmation, and only then executed by the same application service that a manual UI entry calls ([ADR-21](#adr-21--application-services-are-a-distinct-layer-from-the-financial-engine)).

Flow: `user input → AI interpretation → structured proposal → Zod validation → entity resolution → application service → database → result shown to user`.

**Why.** This is a hard requirement in `CLAUDE.md` and it is also the only design in which prompt injection cannot cause a financial mutation. A malicious or malformed instruction can at worst produce a proposal the user sees and rejects. It also means AI-created records are indistinguishable in quality from manual ones, because they go through the same validation and the same balance invariants.

**Rejected.** Write tools with a server-side confirmation flag (the confirmation would then be model-controlled state — one wrong tool argument away from an unreviewed write). Direct writes with an undo log (undo is not consent).

---

## ADR-09 — NVIDIA Build as the model provider, behind a provider abstraction

**Supersedes an earlier draft of this ADR** that specified Anthropic Claude models. That draft misread the specification: `CLAUDE.md <ai_architecture>` mandates *"open/open-weight models available through NVIDIA Build"*, and `<ai_model_tiers>` defines five capability tiers with named candidates. The financial architecture was unaffected; the AI layer was redesigned.

**Decision.** All model access goes through `AiProvider`, implemented once for NVIDIA Build (`https://integrate.api.nvidia.com/v1`, OpenAI-compatible). Five capability tiers, model identifiers supplied entirely by configuration ([ADR-17](#adr-17--model-identifiers-are-configuration-not-code)).

**Client choice.** The `openai` npm package with `baseURL` pointed at NVIDIA Build. It is used here as a *wire-format client* for an OpenAI-compatible API — it handles SSE parsing, retries, and typed request shapes — not as an OpenAI dependency. It is imported only by `src/server/ai/provider/nvidia-build.ts`.

**Why not a hand-rolled `fetch` client.** SSE parsing, retry/backoff, and streaming tool-call reassembly are fiddly and already solved. Writing them again would be a worse version of a well-tested library, and the `AiProvider` interface already isolates it.

**Consequences that shaped the rest of the design.** NVIDIA Build has **no prompt caching**, no server-side fallback, no refusal stop-reason, and no reasoning-effort parameter. Tool calling and `response_format: json_schema` support **vary by model**. Therefore: cost control moved from caching to prompt trimming ([AI-SYSTEM.md §12](AI-SYSTEM.md#12-cost-and-token-control)), fallback is ours to implement ([ADR-18](#adr-18--a-measured-capability-matrix-gates-routing-and-fallback)), and no capability may be assumed.

**Rejected.** Anthropic/OpenAI hosted models (contradicts the specification). Local inference via Ollama/vLLM (the hardware — Ryzen 5 2600, 17 GB RAM, no discrete GPU — cannot run a 120B-parameter model; and it would add an inference stack to operate). A single model for everything (Tier 1 workloads want a fast small model; Tier 2 analysis wants a large one; using one means overpaying or under-reasoning).

---

## ADR-17 — Model identifiers are configuration, not code

**Decision.** No model identifier appears outside `src/server/ai/config/`. Tiers are populated from environment variables as ordered candidate lists:

```
AI_TIER1_MODELS=nvidia/nemotron-3-nano-30b-a3b,openai/gpt-oss-20b,google/gemma-4-31b-it
AI_TIER2_MODELS=nvidia/nemotron-3-super-120b-a12b,z-ai/glm-5.2
AI_TIER3_MODELS=nvidia/nemotron-3-ultra-550b-a55b
AI_TIER4_MODELS=nvidia/nemotron-nano-12b-v2-vl,nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
AI_TIER5_MODELS=nvidia/nemotron-3-embed-1b
```

The application requests a *capability* (`analyzePortfolio`), never a model.

**Why.** `CLAUDE.md <ai_configuration>` requires exactly this. It is also the only way the Phase 8 evaluation can change production routing without a code change — the evaluation writes a proposed order, a human accepts it into configuration, and no business logic moves.

**Rejected.** Model names inline at call sites (the failure mode the specification names explicitly). A database table for routing (configuration that must be present before the app can serve a request belongs in the environment, not behind a query).

---

## ADR-18 — A measured capability matrix gates routing and fallback

**Decision.** `src/server/ai/config/capabilities.json` records, per model: tool-calling support, structured-output mode, vision, context and output limits, and measured scores for schema adherence, tool-call correctness, grounding, injection resistance, and latency percentiles. It is **written by the evaluation harness**, not by hand. The router filters candidates against it before any fallback ordering. A model with no entry is unusable; an entry older than 30 days is flagged stale and fails CI.

**Why.** On open-weight models, `response_format: json_schema` and function calling are *sometimes* supported and *often* partially supported. Assuming support produces a failure mode that is invisible until a user's transaction is silently mis-parsed. Measuring it turns "varies by model" from a risk into an input. This is also the mechanism that enforces `CLAUDE.md <model_fallbacks>`: *"A structured financial mutation cannot use a fallback model that cannot reliably produce the required schema"* — a `structuredOutput: "none"` model is filtered out before it can ever be selected.

**Consequence.** Cross-tier downgrade is forbidden. If every Tier 2 candidate fails, the request fails rather than being quietly answered by a Tier 1 model.

**Rejected.** Trusting provider documentation (documentation describes the model family; the deployed endpoint is what matters). Try-and-see at runtime without recording (repeats the same failure for every user request). A hand-maintained matrix (drifts the moment a model is updated).

---

## ADR-19 — Embeddings deferred; full-text search first, `pgvector` if ever

**Decision.** Tier 5 is designed but not built. If semantic retrieval is ever needed, PostgreSQL full-text search (`tsvector`) is tried first; only if it measurably fails does `pgvector` go into the **existing** database. No separate vector store, ever.

**Why.** `CLAUDE.md <ai_memory>` is explicit that structured financial facts are retrieved by SQL and that vector storage must not be introduced for them. Every question the assistant must answer today is a structured query. Approximate retrieval over financial facts is a correctness regression dressed as a feature.

**Activation criteria** (all three, documented in [AI-SYSTEM.md §11](AI-SYSTEM.md#11-tier-5--embeddings-deferred-with-explicit-activation-criteria)): a real corpus of unstructured text exists; full-text search has been tried and measurably falls short; the benefit is demonstrated on real data.

**Rejected.** Building RAG at launch because an embedding model is in the candidate list — the specification forbids precisely this reasoning.

---

## ADR-20 — `Workflow Setup.txt` is the canonical phase map

**Decision.** The 15-phase sequence in `Workflow Setup.txt` (Phases 0–14) is canonical. `docs/ROADMAP.md` is rewritten to match. Where it differs from `CLAUDE.md <development_method>` (12 phases), the workflow file wins.

**Why.** It is the most recent instruction from the user and the most granular. Its two substantive differences are both improvements: **Market Data becomes its own phase (6)** rather than being folded into investments — correct, because the provider abstraction, caching, staleness semantics, and failure handling are a distinct body of work with their own tests; and **Continuous Improvement (14)** is added, which is where the evaluation harness re-runs and routing gets re-tuned.

**Rejected.** `CLAUDE.md`'s 12-phase list (superseded by the newer file). The 8-phase plan in the previous ROADMAP draft (mine, and less granular than either).

---

## ADR-10 — Database-backed opaque sessions, not a JWT or an OAuth framework

**Decision.** Argon2id password hash + mandatory TOTP second factor + opaque 256-bit random session tokens stored hashed in a `sessions` table, delivered in an `HttpOnly; Secure; SameSite=Lax` cookie. No JWTs. No external identity provider. WebAuthn/passkey added in a later phase as an additional factor.

**Why.** For a private single-user application the entire OAuth surface is attack surface with no benefit — there is no third party to federate with. Server-side opaque sessions have the properties we actually want: instant revocation, no signature-verification pitfalls, no token-expiry-vs-logout mismatch, no secret-rotation choreography. The crypto primitives used are standard library and audited (`argon2id` via `@node-rs/argon2`, `crypto.randomBytes`, `crypto.timingSafeEqual`) — **no hand-rolled cryptography**, only a hand-rolled session table, which is a lookup.

**Rejected.** Auth.js/NextAuth (designed around federated providers; its adapters, callbacks, and JWT strategy are a large configuration surface for a login form). `better-auth` (good library, and a reasonable alternative if the user prefers a maintained dependency — flagged as an open decision). Stateless JWT sessions (revocation requires a denylist, which is a session table with extra steps).

---

## ADR-11 — Market data behind a provider abstraction, with an always-available manual provider

**Decision.** `src/server/market-data/` exposes a `MarketDataProvider` interface (`getQuotes`, `getHistoricalPrices`, `searchInstruments`, `getFxRates`). Provider-specific code lives in `providers/<name>.ts` and is imported nowhere else. A `ManualProvider` backed by user-entered prices is always registered and is the fallback for every instrument. Provider selection is per-instrument (`instruments.price_provider`), not global.

Every price returned is a discriminated union:

```ts
type PriceResult =
  | { status: 'live';   price: Money; asOf: Date; source: string }
  | { status: 'cached'; price: Money; asOf: Date; source: string; ageHours: number }
  | { status: 'stale';  price: Money; asOf: Date; source: string; ageHours: number }
  | { status: 'missing'; reason: 'no_provider' | 'not_found' | 'provider_error' };
```

Valuation functions MUST NOT throw on `missing`; they return a partial valuation with an explicit coverage ratio, and the UI shows which instruments are unpriced.

**Why.** `CLAUDE.md` requires provider independence and explicit staleness. A portfolio value that silently omits an unpriced holding is worse than one that says "₹X across 12 of 14 holdings; 2 unpriced".

**Rejected.** Throwing on missing prices (turns one bad symbol into a blank dashboard). A single global provider (Indian mutual-fund NAVs and international equities genuinely need different sources). Client-side price fetching (would expose provider credentials to the browser — forbidden).

---

## ADR-12 — Base currency with dated FX, stored alongside native amounts

**Decision.** The user picks one base currency (`settings.base_currency`, default `INR`). Every monetary row stores the native `amount` + `currency_code` + the `fx_rate_to_base` used + the derived `base_amount`. Aggregations run on `base_amount`. Historical revaluation uses dated rates from `fx_rates`.

**"Native" means the account's currency for any figure that a balance sums** (decision **OD-5**, approved 2026-08-11). `deriveBalance()` adds `transaction_entries.amount` and `investment_transactions.net_amount` into one figure with no currency argument, so both must be denominated in the account's currency or the sum mixes currencies undetectably.

An investment transaction genuinely straddles two currencies, so it extends this pattern by **one link** rather than departing from it:

```
transaction_entries      amount ──fx_rate_to_base──> base_amount
investment_transactions  net_amount_instrument ──fx_rate_instrument_to_account──>
                         net_amount ──fx_rate_to_base──> base_net_amount
```

Every arrow is a `CHECK`ed `round(x × rate, 4)`. The middle column exists because the per-kind cash identities (`net = gross − fees − taxes` and siblings) relate the cash effect to **instrument-currency** figures; stated on the account-currency column they would be false for every foreign-currency row, making a USD dividend into an INR account unrecordable. The account-currency column exists because `deriveBalance()` must not add dollars to rupees. `fx_rate_instrument_to_account` is exactly `1` in the common same-currency case.

An account's currency is immutable once it carries ledger rows. See [SCHEMA.md §6](SCHEMA.md#6-investment-ledger), [INVESTMENT-DOMAIN.md §2.1](INVESTMENT-DOMAIN.md#21-two-currencies-per-transaction-and-which-one-net_amount-is-in) and [FINANCIAL-DOMAIN.md §3](FINANCIAL-DOMAIN.md#3-accounts).

**Why.** Storing only the native amount makes every aggregate a join against a rate table with date resolution — slow and easy to get wrong. Storing only the base amount loses the original record. Storing both plus the rate makes the conversion auditable and lets a later rate correction be a targeted recompute.

**Rejected.** Converting on read (unacceptable query cost and non-reproducible historical totals). Single-currency-only (the investment side needs at least one foreign currency for international equities).

---

## ADR-13 — Self-hosted deployment on a single VPS, data under user control

**Decision.** Recommended target: one small VPS running Docker Compose — Next.js in standalone output mode, PostgreSQL 17, and Caddy for automatic TLS on the user's domain. Nightly encrypted `pg_dump` to off-site object storage.

**Why.** The database holds a complete picture of the user's finances. Keeping it on infrastructure the user controls, with an encrypted backup they hold the key to, is the correct default for this data class. Cost is roughly $6–12/month. `CLAUDE.md` calls for HTTPS in production, secure backups, and complete data deletion — all straightforward here.

**Rejected as default (offered as an alternative).** Vercel + Neon/Supabase: near-zero operations and excellent DX, but places the full financial dataset with two additional third parties and makes "complete data deletion" a request rather than a `DROP DATABASE`. Flagged as an open decision — if the user prefers zero-ops, the application code is unchanged; only `DEPLOYMENT.md` and the connection string differ.

---

## ADR-14 — Background work via a Postgres job table, not a queue service

**Decision.** A `jobs` table plus a single in-process runner using `SELECT ... FOR UPDATE SKIP LOCKED`. Jobs: recurring-transaction posting, price refresh, nightly net-worth snapshot, backup verification.

**Why.** Job volume is a handful per day. `CLAUDE.md` explicitly excludes Redis and message queues without a concrete requirement. A Postgres-backed queue is transactional with the data it mutates, which is the property that actually matters for "did the recurring rent posting run exactly once".

**Rejected.** Redis/BullMQ (a second datastore, a second failure mode, no transactional coupling). External cron hitting an HTTP endpoint (needs its own auth surface and gives no at-least-once semantics). `setInterval` in the app process only (loses work on restart) — the runner *is* in-process, but state lives in the table, so restarts are safe.

---

## ADR-15 — Idempotency for recurring postings via a materialised occurrence row

**Decision.** `recurring_occurrences` carries `UNIQUE (rule_id, due_on)`. Posting a recurring item first inserts the occurrence row inside the same transaction as the resulting `transactions` row. A duplicate run hits the unique constraint and is a no-op.

**Why.** "Did rent get posted twice?" is the single most damaging routine bug in a personal finance app, and a `last_posted_on` timestamp does not prevent it under retries or clock changes. A unique key on the natural identity does.

**Rejected.** `last_posted_on` comparison only (racy, and wrong after a date-boundary retry).

---

## ADR-16 — Zod as the single validation boundary, including for AI schemas

**Decision.** Zod 4 schemas in `src/lib/schemas/` are the one definition of every input shape. HTTP handlers, server actions, and AI structured outputs all validate against them. AI tool input schemas and proposal output schemas are generated from the same Zod definitions via `z.toJSONSchema()` — one definition, no drift between what the model is told and what the server accepts.

**Why.** A separate hand-written JSON Schema for the model is a guaranteed source of drift; when it drifts, the model produces output the server rejects, which reads to the user as "the AI is broken".

**Rejected.** Hand-written JSON Schema for AI plus Zod for HTTP (drift). Validating AI output only with `try/catch` on the application service (loses field-level error reporting needed for the "reject and explain" path).

---

## ADR-21 — Application services are a distinct layer from the financial engine

**Decision.** Insert `src/server/services/**` between the presentation layer and the financial engine. It owns **orchestration, validation, permissions, and workflows**. The engine (`src/server/domain/**`) becomes pure: no database handle, no clock, no I/O — data in, values out.

| Concern | Layer |
|---|---|
| Zod parsing of input | Application services |
| Ownership and permission checks (**authorization**) | Application services |
| Transaction boundary (`BEGIN` / `COMMIT`) | Application services — **exclusively** |
| Entity resolution, FX rate lookup | Application services |
| Audit rows, `ledger_version` bumps, cache invalidation, job enqueue | Application services |
| Signs, balances, cost basis, XIRR, allocation, net worth, invariant checks | Financial engine (pure) |
| SQL | Repositories under `src/server/db/` |

**Why.** Previously orchestration and calculation shared one layer, which meant "compute the FIFO disposal" and "open a transaction, check the user owns this account, write an audit row" lived in the same functions. Separating them buys three concrete things:

1. **The engine becomes trivially testable.** A pure `replay()` or `buildEntries()` needs no database, no fixtures, no mocks — a table-driven unit test per edge case. This is what makes the edge-case lists in the domain documents affordable to actually write.
2. **Authorization gets exactly one home.** "Where is this permission checked?" has one answer. A missing check is visible as an absent guard call in one file, not as an absence spread across a codebase. This matters more than usual here because the AI's tools enter through these same services — the model cannot bypass a check that lives on the only path in.
3. **Mutation becomes structurally impossible below the service layer.** The engine cannot write even by mistake, because it holds nothing to write with. That is a stronger guarantee than a rule saying it shouldn't.

**Cost accepted.** One more layer to traverse, and a genuine discipline risk: it is tempting to let a service do "just a little" arithmetic inline. The lint boundary catches imports, not judgement, so this is a review responsibility — any arithmetic on `Money` inside `services/**` is a review-blocking comment.

**Rejected.** Keeping orchestration inside the domain layer (the previous design — conflates two responsibilities and forces every calculation test to stand up a database). A full ports-and-adapters/hexagonal structure with repository interfaces and dependency injection containers (correct for a large team on a long-lived system; disproportionate for a single-user application, and `CLAUDE.md <engineering_rules>` says to avoid premature abstraction). Putting authorization in the presentation layer (it would then be duplicated across server actions, route handlers, and AI tools — three places to forget).

---

## Decisions taken independently in Phase 1

Per `CLAUDE.md <decision_policy>`, these were resolved rather than escalated. Each is reversible at low cost; the reasoning is recorded so it can be challenged.

| # | Decision | Taken | Reversal cost |
|---|---|---|---|
| D-1 | Canonical phase map | `Workflow Setup.txt`, 15 phases ([ADR-20](#adr-20--workflow-setuptxt-is-the-canonical-phase-map)) | Trivial — renumber `ROADMAP.md` |
| D-4 | Local development database | ~~Docker Desktop for Windows~~ — **superseded.** Docker was never installed; Phase 2 used the documented fallback of a native PostgreSQL 17 (**D-9**), and after Phase 3 that became PostgreSQL 18.4 running as a Windows service (**D-23**, [PROJECT-STATE.md](../PROJECT-STATE.md)). Integration tests therefore use a dedicated `financeos_test` database rather than `testcontainers`. | Low — a connection string |
| D-5 | Production hosting | Self-hosted VPS ([ADR-13](#adr-13--self-hosted-deployment-on-a-single-vps-data-under-user-control)) | Low — application code is identical on Vercel; only `DEPLOYMENT.md` changes |
| D-6 | Base currency / locale / timezone | `INR` / `en-IN` / `Asia/Kolkata` as **defaults in `settings`**, user-editable from day one, never hard-coded | None — it is a settings row |
| D-7 | Equity price provider | Deferred to Phase 6. `ManualProvider` + AMFI (free, no key, official) ship first; the abstraction makes the choice late-binding | None by design |
| D-8 | Repository hygiene | `core.autocrlf=input`, `.gitattributes` normalising text, rename `Claude.md` → `CLAUDE.md` before `git init` | None |

## Open decisions requiring the user

| # | Decision | Why it cannot be defaulted | Blocks |
|---|---|---|---|
| **OD-1** | **`NVIDIA_API_KEY`** | The candidate list in `CLAUDE.md` does not fully match the live catalogue (5 of 13 identifiers differ or are absent — see [AI-SYSTEM.md §2.3](AI-SYSTEM.md#23-model-catalogue-reality-check)). The unauthenticated catalogue may be partial. Tier membership cannot be finalised without an authenticated read, and the evaluation harness cannot run at all. | Phase 7 (AI infrastructure) onward. Phases 1–6 are unblocked. |
| **OD-2** | **`AGENTS.md` duplication** | `AGENTS.md` is byte-identical to `Claude.md` (46,058 bytes each). Two copies of a 2,181-line specification will drift, and drift in the spec is worse than drift in code. Recommendation: reduce `AGENTS.md` to a one-line pointer. Not done unilaterally — the file may exist because another tool requires full content at that path. | Nothing technically; it is a correctness-of-instructions risk |
| **OD-3** | **Equity/ETF market-data provider terms** | Needed by Phase 6. Free sources cover Indian mutual funds (AMFI) and FX; listed equities generally need a paid API whose terms are a commercial choice, not an engineering one. | Phase 6 completion (not its start) |
