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

**How the cache stays honest.** The rebuild runs **inside the same transaction as the ledger mutation**, so `positions` never disagrees with the ledger and a failed replay rolls the mutation back. On `positions` the recorded version is a **provenance stamp only**, because a single per-user counter would mark every non-mutated position stale forever ([ARCHITECTURE.md §6](ARCHITECTURE.md#6-cache-invalidation)).

**`positions` answers a question about *today*.** It carries no date bound and must never be given one. A historical or `asOf` investment figure is derived instead from `tax_lots` and `lot_disposals` bounded by `opened_on` / `closed_on` ([FINANCIAL-DOMAIN.md §9.3](FINANCIAL-DOMAIN.md#93-calculation)) — which is exact rather than approximate, because money is invariant under corporate actions, FIFO's total order gives replay a prefix property, and invariant I-20 makes the subtraction residue-free.

`net_worth_snapshots` is **not** part of this design at launch: net worth is derived on demand and snapshots are deferred to Phase 6 ([ADR-24](#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6)).

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
AI_TIER2_MODELS=nvidia/nemotron-3-super-120b-a12b,deepseek-ai/deepseek-v4-flash-0731
AI_TIER3_MODELS=nvidia/nemotron-3-ultra-550b-a55b
AI_TIER4_MODELS=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
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

**Decision.** A `jobs` table plus a single in-process runner using `SELECT ... FOR UPDATE SKIP LOCKED`. Jobs: recurring-transaction posting, price refresh, FX refresh, backup verification, audit retention.

*A nightly net-worth snapshot was originally on this list. It is not built: net worth is derived on demand ([ADR-24](#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6)), and the job returns only if a Phase 6 measurement justifies it.*

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

## ADR-22 — Financial recognition is trade-dated; `settlement_date` is informational metadata

**Decision.** Resolves **OD-6**, approved 2026-08-11.

`investment_transactions.trade_date` is the **financial recognition date and the cash date**. `settlement_date` is a recorded factual attribute of the transaction and **controls nothing**:

| Concern | Date used |
|---|---|
| Financial recognition | `trade_date` |
| Cash-balance derivation — `deriveBalance()` | `trade_date` |
| Ledger dating and the running-balance order | `trade_date` |
| Transaction replay — `replay()` and every rebuild | `trade_date` |
| Historical and `asOf` calculations | `trade_date` |
| `settlement_date` | **none — informational only** |

No settlement-date-based cash movement exists, and none is to be introduced. **Settlement-aware accounting logic is out of scope** for the current architecture; adding it later is a deliberate architectural change, not an incremental fix.

**Why.** In a T+1 market the cash genuinely moves a day after the trade, so the two dates differ — but the divergence lasts one day and affects **no realised figure, no cost basis and no P&L**. Modelling settlement properly means carrying a second date dimension through every balance query, every `asOf` bound and every replay ordering, to move a number by one day. That is a large, permanent complexity cost for an accuracy gain the product does not need.

Recording the column rather than dropping it keeps a fact the user may have entered from a contract note, and leaves the option open: a future settlement model would read a column that already holds real data instead of starting from nothing.

**Consequence the UI must carry.** Because balances are trade-dated, a displayed balance can differ from the broker's cleared cash for up to one settlement cycle. **The UI should make clear that displayed balances are trade-dated rather than settlement-dated**, wherever an account balance derived from the investment ledger is shown.

**Rejected.** *Modelling settlement* — a second date dimension on every balance query, `asOf` bound and replay ordering, for a one-day divergence in a figure no downstream calculation depends on. *Dropping the column* — it is a real attribute of a real transaction, printed on every contract note; discarding user-entered facts to save a nullable date is the wrong trade, and it would foreclose a settlement model that later data could support.

---

## ADR-23 — Net worth carries a declared valuation basis; Phase 5 ships **Net Worth at Cost**

**Decision.** Resolves **OD-7**, approved 2026-08-12. Supersedes the market-value formulation previously in [FINANCIAL-DOMAIN.md §9.3](FINANCIAL-DOMAIN.md#93-calculation).

Net worth is computed at a **declared basis**, and the basis is part of the answer rather than an implementation detail:

| Basis | Investment contribution | Available | Default? |
|---|---|---|---|
| `cost` | the exact Phase 4 cost basis — `Σ tax_lots.remaining_cost × lot.fx_rate_to_base`, per lot | **Phase 5** | **yes** ([ADR-32](#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view)) |
| `market` | `Σ marketValue(position)`, unpriced holdings **excluded** and named, with a coverage ratio | **Phase 6.11** | no — requested explicitly |

**Both bases are first-class and fully supported. Neither replaces the other**; they answer different
questions — *what did I put in* versus *what is it worth now*.

**Phase 5 computes and presents `cost` only, and names it "Net Worth at Cost" wherever the unqualified term could imply a current market valuation.** Phase 6 introduces `market` as a distinct calculation.

**A single net-worth figure never mixes the two bases.** A total that is part market value and part acquisition cost is a number in no basis at all: it cannot be explained, cannot be reconciled against either source, and changes meaning as price coverage varies. Where a holding cannot be priced under `market`, it is excluded and named ([ADR-11](#adr-11--market-data-behind-a-provider-abstraction-with-an-always-available-manual-provider), [FINANCIAL-DOMAIN.md §10.4](FINANCIAL-DOMAIN.md#104-partial-results-are-labelled-not-hidden)) — never silently backfilled with its cost.

**Why the basis is explicit rather than implied by the phase.** `setManualPrice` already exists, so a user can price a holding today and the Investments pages already show market value with coverage. Without a declared basis, Net Worth and Investments would report two different numbers for the same securities with nothing on either screen saying why. Naming the basis makes the difference a stated fact instead of a discrepancy.

**Consequences.**
- The investment block of `basis: 'cost'` carries **no unrealised gain and no unrealised FX**. Currency movement on a foreign holding surfaces only on disposal, as `base_fx_component` (I-18).
- The change bridge's unrealised-gain line is **zero by construction** at `basis: 'cost'` — arithmetically, because `Δcost = purchases − consumed` exactly — and must be rendered as *"not measured — holdings valued at cost"*, never as `₹0`, which would read as *"the portfolio did not move"*.
- Coverage for the investment block is `1.0` under `cost`: acquisition cost is always known.
- ~~When Phase 6 makes `market` the default~~ — **superseded by [ADR-32](#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view) (OD-16, 2026-08-21): the default remains `cost`, and `market` is an explicit alternate view.** The underlying observation stands and still belongs in the Phase 6.11 release note: **whenever a user first views `market`, the figure differs from `cost` for two reasons at once** — price, and the FX rebasis from acquisition rates to spot ([FINANCIAL-DOMAIN.md §9.3](FINANCIAL-DOMAIN.md#93-calculation)). Because the default does not change, that difference is something the user opts into seeing rather than something that happens to them.

**No valuation toggle in Phase 5.** The parameter exists in the calculator's signature so Phase 6 is a new valuation function and a changed default rather than re-plumbing; it is not surfaced in the UI, because Phase 5 has exactly one basis to offer.

**Rejected.** *Market where priced, cost where not* — one number, two bases, unstateable, and it drifts silently as coverage changes. *Market with unpriced holdings excluded, in Phase 5* — honest under ADR-11, but with `instrument_prices` empty and no provider (OD-3) it reports investments as **₹0** for any user who has not hand-entered prices. *Leaving the basis implicit* — the defect this ADR resolves: `FINANCIAL-DOMAIN.md` §9.3 said market value while `ROADMAP.md` said at cost, and both were normative.

---

## ADR-24 — Net worth is derived on demand; snapshots are deferred to Phase 6

**Decision.** Resolves **OD-8**, approved 2026-08-12.

Phase 5 computes every net-worth figure — current, historical, series, and bridge — **by derivation from dated rows**. `net_worth_snapshots` and the `networth.snapshot` job move to **Phase 6**. No Phase 5 gate depends on a snapshot.

**Why.**

1. **The performance case does not hold.** A month-end series is **five set-based queries** — accounts by cumulative movement, lots and disposals bucketed by month, valuations and liability balances by greatest-`as_of`-per-bucket, and one FX row per currency per bucket — followed by one pure fold through the same `compose()` the single-date path uses. Snapshots exist to avoid *N* point computations; there are none. `CLAUDE.md` and [FINANCIAL-DOMAIN.md §3](FINANCIAL-DOMAIN.md#3-accounts) both say to measure before caching.
2. **The cache as specified cannot tell when it is stale.** `net_worth_snapshots` stamps `money_ledger_version` and `investment_ledger_version`. Nothing covers `asset_valuations`, `liability_balances`, `instrument_quotes` or `fx_rates` — so a snapshot goes stale behind two matching stamps. Shipping it would mean shipping a cache that is confidently wrong.
3. **Corrections are normal operations.** Editing a transaction dated last March makes every derived figure from March onward correct on the next read ([FINANCIAL-DOMAIN.md §3](FINANCIAL-DOMAIN.md#3-accounts)). With snapshots, the same edit silently invalidates every stored point from that date forward — the failure golden scenario **G6** exists to catch.

**Preserved for Phase 6.** Nothing here forecloses snapshots. If a market-valued series — which joins a price per instrument per date — misses [ARCHITECTURE.md §9](ARCHITECTURE.md#9-performance-targets), Phase 6 may introduce them **under four rules**:

- The **current** figure is always derived. A snapshot is never read for today.
- A historical point is read from a snapshot **only** when every stamped input version matches; otherwise it is derived and the row rewritten.
- The stamp set is completed first — `user_state.valuation_version`, bumped by every write to `manual_assets`, `asset_valuations`, `liabilities` and `liability_balances`, plus whatever covers prices and FX.
- `verify:integrity` asserts **snapshot = derivation** for a sample of dates, making the cache a checked artefact rather than a trusted one.

`user_state.valuation_version` is **not** added in Phase 5: nothing in Phase 5 reads it, and Phase 6 ships a migration anyway.

**Rejected.** *Snapshots in Phase 5 under the four rules* — buildable, but it adds a cache, a job, an invalidation counter and an integrity check to a phase whose figures are all derivable in five queries. *A `portfolio_snapshots` table* — already rejected for the same reason ([INVESTMENT-DOMAIN.md §8.1](INVESTMENT-DOMAIN.md#81-portfolio-growth-over-time)).

---

## ADR-25 — Net-worth classification is by the economic sign of the balance, not by account kind

**Decision.** Approved 2026-08-12, resolving finding **N1**. Supersedes the kind-driven table previously in [FINANCIAL-DOMAIN.md §3](FINANCIAL-DOMAIN.md#3-accounts).

> `balance > 0` → **asset** contribution of `balance`.
> `balance < 0` → **liability** contribution of `|balance|`.
> `balance = 0` → **no contribution to either subtotal**; the account still occupies its key in the contributions map.

`accounts.kind` decides **which group the row is displayed in** and **which sign is expected** — a `bank` account in credit, or a `credit_card` in debit, is flagged on screen. It does **not** decide which side of the balance sheet the money lands on.

**Why.** The kind-driven rule had two failure modes, and they disagreed with each other:

- **An overpaid credit card vanished.** §9.3's asset term excluded `credit_card`/`loan` kinds and its liability term required `balance < 0`, so a card at `+₹5,000` was in **neither**.
- **The same row was simultaneously a debt.** `accountRole()` classified `credit_card` as a liability regardless of sign, so a calculator built on it plus `abs()` reported the ₹5,000 credit as a ₹5,000 **debt** — a ₹10,000 spread on one row, from two implementations of one rule.
- **An overdrawn bank account was a negative asset**, which leaves net worth correct but both subtotals understated.

Sign-based classification removes all three and buys a structural property: `Σ contribution(a,T) = Σ balance(a,T)` over **all** accounts. The account block of net worth is a plain sum of balances — nothing can be dropped or duplicated by a kind test, because there is no kind test.

**Credit available on a card remains excluded from every total.** `credit_limit − |balance|` is shown on the account row so the figure is visible without being counted.

**Rejected.** *Kind decides the side, sign decides nothing* — the status quo, which loses an overpayment. *Kind decides the side and an overpayment is clamped to zero* — silently discards real money. *A per-account `sheet_side` column* — a stored classification that can disagree with the balance it classifies.

---

## ADR-26 — An as-of financial figure is computed from dated facts only; no current-state flag participates

**Decision.** Approved 2026-08-12, resolving findings **N2**, **N4**, **N7** and **N10** as one rule rather than four patches.

> **Every filter in an `asOf` calculation is a date comparison against a recorded fact. `is_active` — on `accounts`, `manual_assets`, `liabilities` or `instruments` — is read by no calculation, ever.**

`is_active` describes an entity *today*. Net worth is computed *as of* a date. Mixing the two rewrites history silently: an account closed this morning vanishes from last year's figure, and the series changes shape every time the user tidies up.

Four consequences, each of which was a separate latent defect:

| | Rule | Was |
|---|---|---|
| **N2** | An account contributes only when `opening_date <= asOf`, and its **opening balance is gated by the same test**. An excluded account is **absent** from the map, not present at zero | `deriveBalance()` added `opening_balance` unconditionally, so an account opened in 2026 contributed ₹50,000 to net worth as of 2020 — the date bound covered *movements*, and an opening position is not a movement |
| **N4** | The calculator considers **every** account regardless of `is_active` | the default `listAccounts` argument excludes inactive accounts, so a calculator written against the default silently dropped every closed account from every historical figure |
| **N7** | An **eligible** asset with no valuation in force at `asOf` is **excluded and named**, reducing coverage | *"contributes zero and is listed as unvalued"* — a ₹80 lakh flat contributing ₹0 to a headline figure, contradicting [§10.3](FINANCIAL-DOMAIN.md#103-missing-data-propagates-as-null-never-as-zero) and golden scenario **G5** |
| **N10** | Closing a scheduled liability **writes a terminal `liability_balances` row with `outstanding = 0`** dated on the closing date | `is_active = false` alone changed nothing under a date-driven rule, so the last non-zero balance stayed in force forever |

**Enforcement is mechanical, not editorial.** Invariant **I-26** is a **source scan** — the same technique [TESTING.md §7](TESTING.md#7-ai-tests--all-offline) uses to keep model identifiers out of the orchestrator — asserting that no file under `src/server/domain/networth/**` or the net-worth read path references `is_active`. A rule that depends on every future reader remembering it is not a rule.

**The eligibility table this produces is normative** and lives in [FINANCIAL-DOMAIN.md §9.3](FINANCIAL-DOMAIN.md#93-calculation).

**Rejected.** *Filtering on `is_active` and accepting that history moves* — the defect. *A `closed_on` column on `accounts` mirroring `manual_assets.disposed_on`* — unnecessary: a closed account's balance is already the right answer at every date, and adding a second lifecycle date invites a filter on it.

---

## ADR-27 — Market-data adapters return observations; the registry classifies freshness

**Decision.** Approved 2026-08-18 (OD-10), resolving finding **M-arch** in the Phase 6 review. **Refines [ADR-11](#adr-11--market-data-behind-a-provider-abstraction-with-an-always-available-manual-provider); does not replace it.**

ADR-11's sketch had every adapter return a `PriceResult` — the union whose members are `live` / `cached` / `stale` / `missing`. Three of those four are a judgement about **age relative to now**, and an adapter is the wrong place to make it: each adapter would make it independently, two adapters could reach different verdicts about the same age, and "stale" would stop being a property of the system.

> **An adapter reports only what it observed: a price, a currency, a trading date, an instant, and a source. The registry decides whether that observation is fresh, stale or unusable — once, in one function.**

Concretely:

| Layer | Returns | May decide |
|---|---|---|
| `providers/*.ts` | `PriceObservation` / `FxObservation` / `CorporateActionObservation`, or a `ProviderFailure` | nothing about freshness |
| `market-data/registry.ts` | `PriceResult` | freshness, provider selection, capability refusal, fallback |
| `services/prices.ts` | `PriceResult` | nothing — it reads what was stored and calls the one classifier |

**Every adapter method returns a `Result<_, ProviderFailure>`.** ADR-11's `getHistoricalPrices` returned a bare `PricePoint[]`, which cannot distinguish *"this instrument has no history"* from *"the provider was down"*. Those demand opposite responses — the first is permanent and must stop retrying, the second is transient and must retry — so collapsing them guarantees one of the two behaves wrongly. `ProviderFailure` has five members (`not_found`, `rate_limited`, `unsupported`, `transport`, `malformed`) and the registry maps each to a `MissingPriceReason`.

**Why.** `CLAUDE.md` requires the system to distinguish real-time, last-known, stale and missing prices, and requires provider independence. One classifier is what makes the first true; observations-not-verdicts is what makes the second true, because an adapter that cannot express a verdict cannot smuggle a policy.

**Rejected.** *Adapters returning `PriceResult` directly* (ADR-11's original form) — N adapters, N freshness policies, silently divergent. *A freshness helper each adapter calls* — better, but nothing forces the call, and the first adapter to skip it is undetectable.

---

## ADR-28 — Staleness is measured in trading sessions, not wall-clock hours

**Decision.** Approved 2026-08-18 (OD-10), resolving finding **M2**.

`settings.price_stale_after_hours` defaults to 24 and `classifyQuote()` compared `now − as_of` in hours. Against **end-of-day** data that is wrong every week, not occasionally:

| Moment | Age of Friday's close | Old verdict |
|---|---|---|
| Friday 18:00 IST | 2.5 h | `cached` |
| Saturday 18:00 IST | 26.5 h | **`stale`** |
| Monday 09:00 IST | 65.5 h | **`stale`** |

Every equity, every ETF and every mutual fund would carry a staleness badge across every weekend and for days after each of India's many market holidays. A warning that fires when nothing is wrong is a warning the user learns to dismiss — and it then fails silently on the day something is wrong, which is the exact outcome `CLAUDE.md` forbids.

> **For a session-traded instrument, staleness is the number of completed trading sessions between the observation's trading date and the latest known session. For a continuously-traded instrument, it remains wall-clock hours.**

| State | `eod` / `nav` | `continuous` |
|---|---|---|
| `current` | 0 sessions behind | ≤ 6 h |
| `recent` | 1–2 sessions behind | 6–24 h |
| `stale` | ≥ 3 sessions behind, **or** > 10 calendar days regardless | > 24 h |
| `missing` | no observation | no observation |

**The stored price series is the trading calendar.** The latest known session for an exchange is `max(instrument_prices.as_of)` across its instruments. This needs no calendar table, no holiday list and no timezone-rule engine; it is automatically correct for every exchange a provider covers; and it cannot drift from the prices it describes, because it *is* those prices. Two guards make it safe: with a single instrument on an exchange its own latest is the reference, giving `0` — correct by construction, and unable to raise a false alarm — and the **10-calendar-day backstop** is what still catches a provider that has quietly stopped.

**A stale price is used, and marked** — refusing it would blank the portfolio every long weekend, which [ADR-11](#adr-11--market-data-behind-a-provider-abstraction-with-an-always-available-manual-provider) already rejects. The marking must reach **every** surface that consumes the figure, including net worth (finding **M3**).

**`price_stale_after_hours` is retained**, now governing the continuous case only; `price_stale_after_sessions` (default 3) governs the session case. No setting was removed.

**Rejected.** *Raising the hour threshold to 72* — it moves the false positive to Tuesday after a long weekend rather than removing it, and it makes a genuinely three-day-old price look fine on a normal Wednesday. *A trading-calendar table* — a second source of truth about whether a market was open, free to disagree with the prices themselves. *Per-exchange hard-coded holiday lists* — unmaintainable, and wrong the first time an exchange adds a session.

---

## ADR-29 — Provider corporate actions are detections, never ledger writes

**Decision.** Approved 2026-08-18 (OD-10), resolving findings **M4** and **M5**.

A `split` or `bonus` row in `investment_transactions` drives `replay()`, and therefore every tax lot, every position, every realised-P&L figure and every historical valuation in the system. It is Layer 1 — financial truth.

> **A market-data provider may never create, modify or delete an `investment_transactions` row. Corporate-action information from a provider is a *detection*, stored in `corporate_action_detections`, and becomes a ledger row only through an explicit user action on the ordinary validated service path.**

This is the same rule, for the same reason, as `CLAUDE.md`'s `<ai_mutation_rule>`: an external source's interpretation must pass through deterministic backend validation and user confirmation before it becomes a financial fact. A price feed is no more trustworthy than a language model here — arguably less, since nobody reviews it.

**The second half of the decision is what makes it safe rather than merely tidy.** Refusing to auto-apply a split leaves a window between the ex-date and the user recording it, and in that window the provider's price is post-split while the ledger's quantity is pre-split:

```
observed  = 100 units (pre-split) × ₹200 (post-split) = ₹20,000
correct   = 500 units             × ₹200              = ₹1,00,000
```

An 80% phantom loss, internally consistent across the portfolio, allocation, market-basis net worth and the change bridge — every figure agreeing, all of them wrong.

> **An unreconciled detection whose ex-date falls inside the holding period *suppresses* that instrument's market value: `missing: 'unreconciled_corporate_action'`. It is never adjusted, never estimated, and no holding is ever mutated.**

Suppression is the honest response because the system genuinely does not know the position. Applying the provider's ratio would be the ledger mutation this ADR exists to forbid, wearing a different hat.

**Enforcement.** Invariant **I-40**: `corporate_action_detections.resolved_txn_id` is written only by the service path, asserted by a source scan and an integration test. `verify:integrity` reports it.

**Rejected.** *Auto-applying detections* — an unvalidated external source mutating Layer 1, and it double-applies whenever the user has already recorded the action. *Adjusting the price instead of the quantity* — invents a number, and leaves quantity wrong everywhere else. *Ignoring the mismatch* — the phantom-loss case above, which is the worst outcome available because it is silent.

---

## ADR-30 — One provider per instrument price series; the only price fallback is Manual

**Decision.** Approved 2026-08-18 (OD-10), resolving finding **M6**.

`instrument_prices` is keyed `(instrument_id, as_of)` with `source` as an ordinary column, and [ADR-11](#adr-11--market-data-behind-a-provider-abstraction-with-an-always-available-manual-provider)'s resolution rule 2 lets any capable adapter claim an instrument whose `price_provider` is unset. Together those permit two providers to interleave closes into one series, last writer winning per row.

> **Once an instrument has stored price history, its provider is pinned. Changing it is an explicit act that purges the series and re-backfills; it never interleaves.**

Two vendors' closes for the same instrument differ — different venue, different closing-auction handling, different adjustment policy. A blended series makes that discontinuity indistinguishable from a real price move, and the error lands in unrealised P&L, TWR and net worth simultaneously. `CLAUDE.md`: *"Never combine inconsistent provider data silently."*

**What may and may not fall back:**

| Data | Fallback | Why |
|---|---|---|
| Price series | **None** | The splice problem above. Invariant **I-35** asserts one `source` per series |
| Latest quote | **Manual only** | Manual is not a substitute source but a *different kind* of source — user-attested, always labelled `source: 'manual'`, never silently selected over a provider |
| FX rates | **Permitted, with recorded provenance** | A rate is a market-wide observation, not an instrument-specific series; `fx_rates.source` records which feed, and one pair still does not mix feeds across dates |
| Corporate actions | **Permitted** | Detections, not values. More sources means better detection, and the user adjudicates |
| Metadata / search | **Permitted** | Advisory; never enters a calculation |

**Capability-respecting refusal.** The registry refuses a resolution whose `ProviderCapabilities` do not cover the request rather than calling and interpreting a confusing `not_found` — mirroring the model-fallback rule in `CLAUDE.md <model_fallbacks>`: *do not downgrade a task to an incapable provider merely because it is available.*

**Transport retry is not fallback.** Retrying the *same* provider with backoff is the job runner's existing behaviour ([ADR-14](#adr-14--background-work-via-a-postgres-job-table-not-a-queue-service)) and introduces no new concept.

**Rejected.** *Best-available-source per day* — maximises coverage and destroys comparability, which is the only thing a price series is for. *Averaging two providers* — a number no provider published, reconcilable against nothing.

---

## ADR-31 — Cost to market is a **restatement at an instant**, not a bridge over time

**Decision.** **Approved 2026-08-21 under OD-14**, from the Phase 6.11 design review
([MARKET-VALUE-NET-WORTH-DESIGN.md §6](MARKET-VALUE-NET-WORTH-DESIGN.md#6-the-cost-to-market-restatement)).

> **A bridge explains movement between two dates on one basis. A restatement explains why two bases
> disagree at one date. They are different questions, they take different inputs, and they must never
> share a screen affordance or a type.**

`bridge()` already enforces half of this: it throws when `opening.basis !== closing.basis`, because
*"a change of basis is not movement"* (ADR-23). That check is correct and stays. This ADR names the
other half — the thing that *is* wanted when someone asks "why is market ₹2 lakh higher than cost?" —
and gives it its own shape.

**Why the distinction is not pedantry.** A bridge's lines are things the user *did* or that *happened
to them*: they saved, they sold, a price moved over the period. A restatement's lines are none of
those — the portfolio did not change between "at cost" and "at market"; only the question did.
Presenting the difference as a bridge line invites a user to read a valuation difference as a gain
they made, which is a materially wrong reading of their own finances.

**The restatement, which closes exactly:**

```
NW(cost)
  − Σ baseCostBasis(unpriced positions)        removed: not valuable on this basis
  + Σ ( costAtSpot − costAtAcquisitionRates )  FX rebasis
  + Σ ( marketAtSpot − costAtSpot )            price effect
= NW(market)
```

**It decomposes exactly, and needs no new column.** `tax_lots` carries `remaining_cost` in the
**instrument's** currency alongside the acquisition `fx_rate_to_base`, so cost is expressible at both
acquisition rates and spot. The difference between those two is the FX rebasis; the remainder is
price. Both terms are computed, neither is a residual.

**What it deliberately does not do.** It does not decompose a *holding's* unrealised P&L into price
and currency — that needs a per-lot revaluation no screen consumes, and
[INVESTMENT-DOMAIN.md §6.4](INVESTMENT-DOMAIN.md#64-foreign-currency-positions)'s combined figure
stands unchanged. The aggregate split and the per-lot split are different questions; only the first is
in scope.

**The removed-unpriced line is not a loss**, and must never be rendered as one. It is the amount the
comparison had to set aside for want of a price. A user looking at `−₹5,00,000` beside a bond has to
be able to tell that from a bond that fell by ₹5,00,000.

**Rejected.** *Extending `bridge()` with a basis-change line* — it would make `unexplained`
meaningless, destroy the one assertion in the suite that catches most engine regressions, and require
deleting the guard that currently prevents exactly this. *Defining the price effect as the residual* —
same objection as `fx_effect` in the bridge: a plug is not an explanation, and it hides the bug it
should surface. *Showing only the two totals with no explanation* — the user can subtract, but cannot
tell price movement from an unpriced holding dropping out, and those have opposite meanings.

---

## ADR-32 — The default valuation basis remains `cost`; `market` is an explicit alternate view

**Decision.** Resolves **OD-16**, approved 2026-08-21. **Supersedes the default-flip consequence of
[ADR-23](#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost)**;
every other part of ADR-23 stands unchanged.

> **`netWorthAsOf()` defaults to `basis: 'cost'`. `market` is reached by asking for it explicitly.
> Both are first-class, fully supported views; neither replaces the other.**

Phase 6.11 delivers **Net Worth at Market Value** as a complete, tested, reconciled calculation. What
it does **not** do is change what the application shows when nobody asked.

### Why the default stays at cost

**1. Switching the default silently restates every figure the user has already seen.** A user who has
watched their net worth for six months would open the application one morning to a different number,
a different history and a different shape of chart — with no transaction behind any of it. The
release note would explain it; the chart would still look like something happened.

**2. The headline moves for reasons the user did not cause.** Net Worth at Cost changes only when the
user *does* something: earns, spends, buys, sells, revalues an asset, repays a debt. That is a
property worth protecting in a personal finance application, where the headline answers *"how am I
doing?"* rather than *"what did the market do today?"* Under `market` the same figure moves with
prices **and** with FX — including the one-off rebasis from acquisition rates to spot on the very
first render ([MARKET-VALUE-NET-WORTH-DESIGN.md §6](MARKET-VALUE-NET-WORTH-DESIGN.md#6-the-cost-to-market-restatement)).

**3. A default should not be able to report `partial` or `unavailable`.** Cost basis has coverage
`1.0` by construction — acquisition cost is always known. Market coverage depends on a third party
being reachable, entitled and current; a headline that degrades when a provider has a bad morning is
a poor default even though the degradation itself is handled honestly
([§5](MARKET-VALUE-NET-WORTH-DESIGN.md#5-partial-valuation)).

**4. Cost is the basis the rest of the system already agrees with.** Golden scenario **G4** closes at
exactly `0.0000` on cost; the change bridge's lines are all cost-basis movements; `verify:integrity`
asserts I-24 against `positions.base_cost_basis`. Keeping the default there means Phase 6.11 adds a
view without disturbing a single existing assertion.

### What this does *not* mean

- **Market value is not second-class.** It is fully implemented, fully reconciled, has its own
  invariants (I-41 … I-49) and its own golden scenarios. "Not the default" is not "not supported".
- **It is not a deferral.** Nothing about market value is postponed by this decision; only the
  question of which figure appears unbidden.
- **Neither basis replaces the other**, and no document may imply otherwise. They answer different
  questions: *what did I put in* versus *what is it worth now*.

### Revisiting

A future change of default is a **product** decision, to be taken on actual usage — whether the user
routinely switches to market, and whether coverage is reliably `complete` in practice. It is not an
engineering decision and should not be made by whoever next touches this code. Any such change must
ship with the release note ADR-23 already requires, because the FX rebasis is real either way.

**Rejected.** *`market` as the default*, as ADR-23 anticipated — the four reasons above, of which (1)
is decisive for a single-user application whose whole value is a continuous record. *A remembered
per-user preference* — a stored default is still a default, and adds a settings row, a migration and a
new way for two screens to disagree, to solve a problem nobody has reported. *Showing both as
co-equal headlines* — two headline numbers is no headline at all, and forces the reader to decide
which one is their net worth.

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

## ADR-33 — The transaction opener is a capability carried on the context, not an ambient import

**Decision.** Approved 2026-08-30 (**OD-17**), resolving finding **F-1** of the Phase 7 review.

> **`withWriteCtx` takes a `RequestCtx` — a `ReadCtx` that additionally carries `beginTransaction`. The capability is granted by `createReadCtx` and by nothing else. A holder of read access cannot open a write transaction, because the argument does not type-check.**

`AI-SYSTEM.md` §1 has claimed since Phase 1 that *"the AI layer holds only a `ReadCtx`, and every command requires a `WriteCtx`, so a write from AI code does not compile"*. Against the code as Phases 3 – 6.11 built it, that was **false**, and in two independent ways:

| | The hole | Why it existed |
|---|---|---|
| **Escalation** | `withWriteCtx(readCtx, (w) => createTransaction(w, …))` compiled clean | `withWriteCtx` took a `ReadCtx` and opened the transaction itself by calling `db()`, an ambient import. The context was never the thing that authorised the write |
| **Raw write** | `readCtx.db.execute(sql…update accounts…)` compiled clean | `ReadCtx.db` is `DbExecutor`, a union of two drizzle handles that both expose `.insert`, `.update`, `.delete`, `.execute` and `.transaction` |

The first is closed here. A capability that must be *given* cannot be *reached*, and the type system enforces it: `tsc` reported the escalation at every site the moment the signature changed — three test harnesses, all of them legitimately standing in for a user request, and no production code at all.

**`beginTransaction` is a real field, not a phantom brand.** `withWriteCtx` calls it. A brand exists only to be checked, and is exactly the kind of property a future tidy-up deletes as unused; a field the function actually invokes cannot be removed without the code stopping working. That is deliberate, and it is why this is not a `unique symbol`.

The second hole is closed by [ADR-34](#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths): the AI layer holds an `AiReadCtx`, which has no `db` at all, so there is no handle to write through. `ai.db` is a compile error, not a lint finding.

**Enforcement is mechanical.** Invariant **I-50** is a *compile* test — `tests/unit/ai-write-boundary.test.ts` type-checks probe sources against the project's own `tsconfig.json` and asserts the exact diagnostic codes. A test that ran `withWriteCtx(aiCtx, …)` and expected a throw would assert the weaker runtime property while the compile-time one rotted.

**Rejected.** *A lint rule banning `withWriteCtx` in the AI zone* — necessary but not sufficient, and it was the status quo that produced the finding; a rule that names only one import style is defeated by another. *A phantom `unique symbol` brand* — invisible at runtime, deletable by refactor, and it would have made `createReadCtx` return a cast. *Removing `db` from `ReadCtx` outright* — 26 read paths legitimately call `ctx.db.execute` for `select`; breaking them to close an AI hole would be a large change to working financial code for no gain, since the AI layer no longer holds a `ReadCtx` at all.

---

## ADR-34 — The AI import boundary is enforced three ways, and covers relative paths

**Decision.** Approved 2026-08-30 (**OD-17**), resolving finding **F-2** of the Phase 7 review.

> **`src/server/ai/**` reads through exactly one capability, `@/server/ai-read`. Its isolation is enforced by the type system, by ESLint, and by a source scan — three mechanisms with three different failure modes, because no one of them is sufficient.**

`AI-SYSTEM.md` §3 said *"nothing inside it imports `src/server/db/`"*. The ESLint rule meant to guarantee that listed only `@/`-aliased specifiers. `no-restricted-imports` matches the **raw specifier string** with gitignore semantics — via the `ignore` package, never a resolved path — so this linted clean and handed AI code a full database handle:

```ts
import { db } from '../../db/client';   // no error, before this ADR
```

Adding the engine zone's `**/server/db/*` would **not** have closed it: that pattern still requires a literal `server` segment, which the specifier does not contain. Dropping `server/` from the relative forms is what closes it, and the empirical matrix is recorded in `tests/unit/ai-boundary-source-scan.test.ts` rather than asserted from memory.

| Mechanism | Closes | Cannot close |
|---|---|---|
| **Types** — `AiReadCtx` has no `db`, no `fx`, no `beginTransaction`, and is not a `ReadCtx` | the escalation and the raw write, at compile time (**I-50**) | an import that never touches a context |
| **ESLint AI zone** — aliased *and* relative patterns, plus `drizzle-orm` and `pg` outright | the ordinary static import, at authoring time (**I-51**) | **dynamic `import()` and `require()` — the rule registers no `ImportExpression` listener, in any version** |
| **Source scan** — `tests/unit/ai-boundary-source-scan.test.ts` | dynamic imports, `require`, `ctx.db` DML, and any mention of a write-boundary symbol (**I-51**, **I-52**) | nothing an import graph cannot see |

Both gaps are verified rather than assumed: a probe importing `'../../db/client'` relatively is rejected by ESLint *and* by the scan; the same import written as `await import('../../db/client')` passes ESLint with exit 0 and is caught only by the scan.

**The capability is where the read surface will live.** `src/server/ai-read/index.ts` exports `AiReadCtx` and nothing else today, because Phase 7 has not started; step 7.3 adds the enumerated, projected read functions there, one per tool. `internal.ts` holds the single bridge back to a `ReadCtx`, binds it in a module-private `WeakMap` so that no value of type `AiReadCtx` can reach it, and is itself banned from the AI zone. That is OD-17's recommended option — *"give the AI layer a narrowed context"* — implemented rather than deferred.

**Rejected.** *ESLint alone* — the finding. *A negation pattern carving `ai-read` out of a `services` ban* — expressible, but it puts the boundary's correctness inside a gitignore-negation subtlety; a sibling directory needs no carve-out. *Trusting `import type`* — `allowTypeImports` is undefined in every zone, so type imports are restricted too, and a type import is how a `WriteCtx` signature would first appear in AI code.

---

## ADR-35 — AI infrastructure is strictly read-only; a mutation needs a separate, approved proposal workflow

**Decision.** Approved 2026-08-30, resolving **OD-17** in full.

> **For Phase 7 and Phase 8, the AI layer reads and never writes. There is no write tool, no write capability, and no code path from a model's output to a financial record. An AI-assisted mutation is a *future* workflow requiring explicit approval, and it is out of scope for the Phase 7 infrastructure task.**

Concretely, and each of these is asserted rather than intended:

- AI tool handlers read financial information through `@/server/ai-read` (**I-51**, **I-52**).
- AI code cannot obtain a `WriteCtx`; the escalation does not compile (**I-50**, [ADR-33](#adr-33--the-transaction-opener-is-a-capability-carried-on-the-context-not-an-ambient-import)).
- AI code cannot execute SQL: it has no handle, and no import path to one (**I-51**, [ADR-34](#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths)).
- AI code cannot mutate a financial record by any route, including the `ai_proposals` row itself.

**When a mutation workflow is eventually built**, [ADR-08](#adr-08--ai-proposes-application-code-mutates) already sets its shape and is unchanged: the model emits a structured *proposal*, the server validates it, the **user confirms it**, and an **application service** — not AI code — performs the write. Building that workflow is a separate, explicitly approved piece of work. Phase 7 ships the read infrastructure and the boundary that will contain it.

**Why say this now, before any AI code exists.** Because the boundary is cheapest to build when there is nothing on the other side of it, and because the Phase 7 review found three documented guarantees that had quietly become false while the system grew underneath them. A guarantee asserted by a test at the moment it is written stays true; one asserted by a sentence does not.

**Rejected.** *Deferring the decision until a write tool is wanted* — the write barrier is load-bearing for every other AI security claim, including `SECURITY.md`'s accepted-risk table, and a barrier retrofitted around existing code is a different and worse exercise. *Allowing AI code to persist the proposal row* — it is still a database write by the AI layer, and it would need the very capability this ADR withholds; `services/aiProposals.ts` persists it, per `AI-SYSTEM.md` §9.

---

## ADR-36 — Exact values cross a JSON boundary as a tagged string projection, never as a JSON number

**Decision.** Approved 2026-08-30, resolving the numeric-serialisation gap the Phase 7 review recorded in §6.2.

> **`Money`, `Quantity`, `UnitPrice` and `Rate` cross a JSON boundary as `{ kind, digits…, scale }` — exact decimal digits as a string, tagged with what they are. The domain types are unchanged and gain no `toJSON`; the projection lives at the boundary and depends on the domain, never the reverse.**

All four are `bigint` at a declared scale ([ADR-04](#adr-04--money-is-an-exact-scaled-integer-never-a-float)). `JSON.stringify` **throws** on every one of them by specification, so nothing the engine returns can leave the process as JSON at all — and the first person to need it has two obvious wrong answers:

| Tempting | Why not |
|---|---|
| `Number(m.minor)` | loses precision above 2^53. It is exactly the float path ADR-04 exists to exclude, and it fails silently, on large figures, in a financial answer |
| `m.minor.toString()` | lossless but scale-less. A price of ₹1,121 prints as `112100000000`, which invites comparison against a real price |

A third, subtler wrong answer is a bare decimal string: correct digits, no way to know whether they are rupees or dollars, a price or a quantity, scale 8 or scale 10. `UnitPrice` and `Quantity` are the *same shape* — `{ units: bigint }` at the same scale — and are distinguishable only by where they came from, which is why the projection is a set of explicit per-type functions and **not** a structural walker.

`src/lib/format/diagnostic-json.ts` stays what it is: a blind recursive walker for logs and smoke tests. It is the right shape there and the wrong shape at a tool boundary, because it emits every enumerable property of whatever it is handed — the opposite of field projection.

**Enforcement.** Invariant **I-53**, `tests/unit/json-projection.test.ts`: property tests over generated values past `MAX_SAFE_INTEGER` assert the projection agrees with `toDbString` and round-trips through `fromDbString`, and a structural assertion proves no figure is ever a JSON number.

**Rejected.** *`toJSON` on the domain types* — it would make `Money` depend on a serialisation concern, and it would fire implicitly wherever anything was stringified, including logs that deliberately redact figures. *A single `toExact(value)` helper* — cannot tell a price from a quantity. *Numbers with a documented scale* — the precision is lost before the documentation is read.

---

## ADR-37 — A breakdown declares whether its rows partition its total

**Decision.** Approved 2026-08-30, resolving finding **F-3** of the Phase 7 review.

> **`breakdown()` returns a structure, not an array: an authoritative `total`, an `additivity` tag, and rows that either partition that total exactly or say plainly that they do not. There is no response shape in which summing every row silently double-counts.**

The old signature returned `BreakdownRow[]` holding **every node** of the category tree — `Food` *and* `Food › Groceries` *and* `Food › Dining` — each carrying its **rolled-up** total. Summing that array double-counts every parent/child pair. Nothing in the type said so, and the project's own golden test worked around it by filtering on the `›` in a label:

```ts
const topLevel = rows.filter((r) => !r.label.includes('›'));  // so children are not counted twice
```

A string test standing in for a structural guarantee is how the defect stayed invisible for three phases. It would have mattered most at the AI tool boundary, where that row set reaches a model with no way to tell which rows are safe to add — and a model doing financial arithmetic is forbidden outright by `CLAUDE.md`.

The contract, now:

| Field | Guarantee |
|---|---|
| `total` | The period figure for `kind`, computed by the engine over the **same entries** `periodSummary` reduces. Always authoritative, whatever the rows do |
| `additivity: 'partition'` | `Σ rows[].total === total`, exactly, with no tolerance. Category and account breakdowns |
| `additivity: 'overlapping'` | The rows do **not** sum to `total` and must never be presented as if they did. Tag breakdowns: one transaction can carry several tags, and an untagged one carries none |
| `depth: 'rollup'` | One row per top-level category, children folded in. `isRollup` and `childCount` say so per row |
| `depth: 'detail'` | One row per category with spending **of its own**, carrying only that. A parent with direct entries appears beside its children without double-counting them |

Both depths partition. That is the point: the caller chooses a level of detail, never a level of correctness.

**The arithmetic did not change.** `rollup()` is untouched and still answers *"what does Food come to?"* — the right question for a budget and for a single category. What changed is the **row set**: `foldToRoots()` assigns every direct amount to exactly one root, so `Σ rows === total` holds *by construction* rather than by assertion. `CLAUDE.md`'s worked example — *"how much did I spend on food in July?"* — is answered by the `Food` row, not by adding two others.

**Tag breakdowns were always non-additive, and now say so.** This was not in the original finding and was discovered while fixing it: `tagBreakdown` inner-joins `transaction_tags`, so a two-tag transaction contributes its full amount twice and an untagged one is absent entirely. The old bare array gave a consumer no way to know.

**Enforcement.** Invariant **I-54**: property tests over generated two-level trees assert `Σ folded === Σ direct` exactly (`tests/unit/breakdown-contract.test.ts`), and `tests/integration/golden-g1.test.ts` asserts the partition at **both** depths against the golden figures — with the label filter deleted, because it is no longer needed.

**Rejected.** *Changing `rollup()`* — it is correct for what it does, and `CLAUDE.md` forbids changing a correct financial calculation to suit AI formatting. *Returning leaves only* — loses a parent's own direct spending, so the rows would not sum to the total either. *Documenting the hazard and keeping the array* — the review found the existing documentation already claiming the opposite of what the code did; another sentence was not the fix.

---

## ADR-38 — The AI zone is an allowlist; a new directory is closed on the day it is created

**Decision.** Approved 2026-08-30, resolving findings **S-1 … S-4** of the adversarial security review of step 7.0.

> **`src/server/ai/**` may import `@/server/ai-read`, `@/server/log` and `@/lib/**` (except `@/lib/env`), and nothing else under `src/server/`, `app/` or the environment. The rule denies `@/server/**` and re-admits by exception — so a directory added tomorrow is closed without anyone editing this list.**

[ADR-34](#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths) closed the relative-path hole but kept the rule's original **shape**: a denylist naming `db`, `domain` and `services`. That shape is the defect. It answers "is this one of the three modules we thought of?" when the question is "is this one of the two modules the AI layer is supposed to reach?" The review attacked it with fourteen probes; **seven passed both ESLint and the source scan**, and two were outright defeats of the write boundary:

| # | Route | What it granted | Severity |
|---|---|---|---|
| **S-1** | `@app/(app)/money/actions` — or the same file by relative path | `'use server'` actions take a **form, not a context**. Each calls `requireSession()`, then `createReadCtx()`, then `withWriteCtx()` internally. Calling one mutates the ledger with the session's own authority, and **no write capability ever passes through AI code** — so every type-level guarantee in ADR-33 is bypassed rather than broken | **CRITICAL** |
| **S-2** | `@/server/jobs` | `enqueue`, `runDueJobs`, `scheduleRecurringPost`, `scheduleMarketDataRefresh`. The handlers call `withWriteCtx`: recurring postings, price writes, corporate-action detections. The same defeat, one indirection further away | **CRITICAL** |
| **S-3** | `@/lib/env` | `env()` returns `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `SESSION_COOKIE_SECRET`, `TWELVE_DATA_API_KEY` — and, by design, `NVIDIA_API_KEY`. A layer whose whole purpose is sending text to an external provider had unrestricted access to every credential | **HIGH** |
| **S-4** | `@/server/auth/**` | `session-store` (read, create, delete sessions), `crypto` (decrypt under `APP_ENCRYPTION_KEY` — TOTP secrets and recovery codes), `password`, `account.ts` (which opens its own `db().transaction`) | **HIGH** |
| | `@/server/market-data/http` | Arbitrary outbound HTTP with provider credentials — an exfiltration channel | MEDIUM |
| | `@/server/health` | Executes SQL, even if only a fixed probe | LOW |

**A fifth finding was the exemption itself.** `ignores: ['src/server/ai/provider/nvidia-build.ts']` removes the config object *entirely* for that file — rules and all — so the single exemption intended to permit `openai` also handed the wire client the database, the services and the engine. The bans and the `openai` allowance are now two config objects sharing one pattern array, which makes the exemption exactly one import wide.

**Why an allowlist is the right shape here specifically.** The AI layer is the one part of this system that processes untrusted natural language and sends data to a third party. Its correct import surface is *two modules*, and it will not grow much: Phase 7.3 adds projections **inside** `ai-read`, not new dependencies. When the safe set is small, closed and stable, and the unsafe set is open-ended and grows with the codebase, enumerating the unsafe set is the wrong way round.

**`@/server/log` is deliberately re-admitted.** `AI-SYSTEM.md` §15 wants Phase 7 to reuse its redactor rather than build a parallel one. It exports `redact`, `log` and `newCorrelationId`; it reads `LOG_LEVEL` but re-exports nothing from the environment, so admitting it does not re-open **S-3**.

**`src/server/ai-read/**` gains its own zone.** It is the one module outside the AI zone that holds a real `ReadCtx` on the layer's behalf, so it may call services — that is its job — but `importNames` bans `withWriteCtx`, `withWriteCtxResult`, `WriteCtx`, `RequestCtx` and `createReadCtx` by name while leaving queries importable, which a path-only rule cannot express. Belt to the type system's braces: a `ReadCtx` is not a `RequestCtx`, so a write there would not compile either.

**Enforcement.** Invariant **I-51**, extended. The source scan now reads its pattern list **out of `eslint.config.mjs`** rather than keeping a copy — the copy had already drifted, which is how five of these routes stayed open in both mechanisms at once. `tests/unit/ai-boundary-source-scan.test.ts` asserts the allowlist shape, the ordering the negation depends on, every route above, that an invented directory (`@/server/whatever-comes-next`) is closed, and that the provider file is still governed.

**Rejected.** *Adding the six missing directories to the denylist* — it would have closed these seven routes and left the shape that produced them, so the next directory would be open again. *Banning `@/lib/**` wholesale* — the AI layer legitimately needs `Money`, `IsoDate` and the JSON projection; `@/lib/env` is the one module there that carries secrets, and naming it is precise rather than broad. *Relying on the type system alone for S-1* — a server action takes a `FormData`, so there is no context in its signature for a capability type to constrain; only an import ban can reach it.

---

## ADR-39 — The AI read capability is frozen

**Decision.** Approved 2026-08-30, resolving finding **S-5**.

> **`createAiReadCtx` returns a frozen object.**

`readonly` is a compile-time annotation and is erased at runtime, so `(ai as { userId: string }).userId = 'attacker'` succeeded. It could never redirect a **read**: `withFinanceReads` keys its `WeakMap` on object *identity*, so the bound `ReadCtx` is whatever the capability was minted with, and every service still filters on that context's `userId`. The exposure is narrower and quieter — a projection that rendered `ai.userId` instead of `read.userId` would label one user's figures with another's name, and nothing would report an error.

Freezing removes the divergence rather than documenting it, and matches what `src/lib/decimal` already does with every `Money`. **LOW** severity, fixed because it is three characters and the alternative is a comment asking future readers to remember.

**Rejected.** *A `Proxy` that throws on write* — heavier, and freezing already throws in strict mode, which every ES module is.

---

## ADR-40 — The NVIDIA adapter is written over `fetch`; the `openai` client is deferred to the phase that needs streaming

**Decision.** Approved 2026-08-30, during Phase 7 step 7.1. **Refines [ADR-09](#adr-09--nvidia-build-as-the-model-provider-behind-a-provider-abstraction); does not replace it.**

> **`src/server/ai/provider/nvidia-build.ts` speaks the OpenAI-compatible wire format over injected `fetch`. No new dependency is added. The ESLint ban on importing `openai` outside that one file stays exactly as it is.**

`AI-SYSTEM.md` §2.2 chose the `openai` npm client, and gave two reasons: *"it handles SSE parsing and retries"*. Phase 7 needs neither.

| Stated reason | Phase 7 reality |
|---|---|
| SSE parsing | There is no streaming caller. Streaming belongs to a chat UI, which is Phase 9 — and this phase deliberately ships no user-facing AI feature |
| Retries | Retry policy is the **orchestrator's**, deliberately, so that two providers cannot grow two policies. `errors.ts` owns the disposition of every failure class, and `fallback.ts` owns the chain. A client retrying underneath that would retry inside an attempt the orchestrator believes is a single try — and the attempt ceiling would stop meaning what it says |

What would remain is a dependency carried for a caller that does not exist. The repository already has a proven injected-`fetch` adapter in `market-data/http.ts` — timeout by `AbortController`, per-status classification, no credential in the shared layer — and the AI adapter follows it line for line. Tests replay fixtures through the injected `fetch`, so no test touches the network, which is the same property the market-data adapter tests rely on.

**This is a deviation from a canonical document, and it is recorded as one rather than quietly taken.** `AI-SYSTEM.md` §2.2 has been amended to say what was built and why, so no statement there claims a client that is not installed.

**Adopting the client later is contained.** The `openai` ban stays in `eslint.config.mjs`, so if streaming in Phase 9 makes the client worth its weight, it can only be imported into `nvidia-build.ts` — the same file, behind the same `AiProvider` interface, with the same tests. That is precisely what the provider abstraction exists to make cheap.

**Rejected.** *Installing it now and using it for non-streaming calls* — a dependency whose stated benefits are both unused, in the one layer that talks to a third party. *Writing a streaming path speculatively* — Phase 7 ships no UI that could consume it, and an untested streaming implementation is worse than none.

---

## ADR-41 — A catalogue drift is reported, never silently re-routed

**Decision.** Approved 2026-09-03, during Phase 7 final verification. **Refines [ADR-17](#adr-17--model-identifiers-are-configuration-not-code) and [ADR-18](#adr-18--a-measured-capability-matrix-gates-routing-and-fallback).**

> **When an identifier this project routes to disappears from the authenticated catalogue, the routing table is left alone and the drift is recorded. A replacement is chosen only by evaluation, never by resemblance.**

The provider's catalogue has now moved three times in five weeks: `deepseek-v4-flash` gained a `-0731` suffix; `zai-org/glm-5.2` turned out never to have existed under any prefix; and on 2026-09-03 `nvidia/nemotron-3-nano-30b-a3b` — **Tier 1's first candidate** — vanished from an 82-model read that had listed it a fortnight earlier. In its place sat `nvidia/nemotron-nano-3-30b-a3b`: the same words, the version segment transposed.

The tempting move is to treat that as a rename and edit one line. It is refused, for three reasons.

| | |
|---|---|
| **Resemblance is not identity** | A transposed identifier is a plausible rename and equally plausibly a different model with a similar name. Nothing in the catalogue response asserts continuity of weights, and the project has already been burned once by a confidently-recorded identifier (`z-ai/glm-5.2`) that an authenticated read disproved |
| **It would bypass the gate that exists for this** | ADR-18 forbids routing to a model with no measured capability entry. A renamed model is a *new* model to that gate. Editing the tier list while leaving the matrix untouched would either route blind or fail-closed anyway — the second is what already happens, without the edit |
| **`CLAUDE.md` requires evaluation before routing** | "Do not select models solely from generic benchmark rankings" and the mandate to evaluate against real workloads both apply. Phase 8 owns this; Phase 7's job is to notice and record |

**Leaving a dead identifier in place is bounded and self-limiting, which is what makes the refusal affordable.** `transport` carries the `next_candidate` disposition, so the failed call falls through to the next candidate *within the same tier* — never down a tier — and the circuit breaker then opens on the dead model and stops attempting it. The observable cost is one failed request and round-trip per breaker window, on one tier, with the tier still serving. That is strictly better than a wrong route that answers.

**The consequence to accept:** a tier's first candidate can be dead for as long as it takes evaluation to run, and nothing fails loudly at startup to say so. The catalogue is not read at boot, and ADR-18's gate is a *request-time* gate. Making it a startup check would mean a network call on boot and an application that refuses to start because a third party renamed something — a worse failure than a degraded tier. The mitigation is that `npm run ai:catalogue` exists, is cheap, and is now part of the verification matrix.

**Rejected.** *Substituting the look-alike identifier* — the whole failure mode this project keeps catching. *Removing the dead entry* — it would erase the evidence that a candidate `CLAUDE.md` names is no longer routable, which is exactly what `config/models.ts`'s `catalogue: null` rows exist to preserve. *Failing the build on drift* — couples a local build to a third party's naming.

---

## ADR-42 — The high-severity audit gate covers production dependencies

**Decision.** Approved by the user 2026-10-17, during the post-disk-failure recovery. **Amends [SECURITY.md §11](SECURITY.md#11-dependency-and-supply-chain).**

> **CI fails on a high or critical advisory in any production dependency, and on a critical advisory in any dependency at all. A high advisory confined to development tooling does not fail the build; it is recorded in [SECURITY.md §12](SECURITY.md#12-known-accepted-risks) with its path and its removal condition.**

On 2026-09-18 GHSA-vfj7-8cjw-p6xm (stack-exhaustion denial of service, **high**) was published against **every** released version of `braces`; 3.0.3, the newest, is affected and no fixed release exists. It reaches this project only through `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`, five times over in `npm audit`'s count. The previous gate (`npm audit --audit-level=high` across all dependencies) therefore could not pass, and nothing in this repository could make it pass.

| | |
|---|---|
| **The exposure is not reachable** | The vulnerable code runs only inside ESLint, on glob patterns taken from this repository's own `eslint.config.mjs`. It is never bundled, never runs in the server, and never receives input from a user or a third party |
| **Production stays at the full bar** | `npm audit --omit=dev --audit-level=high` exits 0 today. Everything that runs with the user's financial data is held to the unchanged threshold |
| **Critical stays global** | A critical advisory in development tooling can mean code execution at install or build time — a supply-chain risk to the machine that holds the secrets. That still fails the build, wherever it sits |
| **Nothing is hidden** | `npm audit` prints every advisory whatever `--audit-level` is, so the full report remains in every CI log, and §12 must explain each dev-only high |

**Rejected.** *`npm audit fix --force`* — it installs `eslint-config-next` 14.2.35, two majors behind the Next 16 codebase it lints. *An npm `overrides` pin* — there is no fixed `braces` version to pin to. *Leaving the gate red until upstream ships* — a step that always fails teaches everyone, human or agent, to ignore CI, which is worse than a scoped and recorded gate. *Dropping the audit step* — no.

**Consequence to accept:** a **new** high advisory in development tooling will not fail CI on its own. The mitigation is the §12 rule — every dev-only high is recorded with the condition that removes it — and the re-check §11 now requires whenever the lockfile changes.

---

## ADR-43 — The daily AI budget is kept in a table

**Decision.** Approved by the user 2026-10-26, resolving entry-gate finding **B-3a**. Implemented in PR #10.

> **The daily AI budget is read from `ai_usage_daily` before a request is built, and every request that reached the provider is added to it. The limits are `AI_DAILY_REQUEST_LIMIT` and `AI_DAILY_TOKEN_LIMIT`, per user per calendar day in `settings.timezone`; the first one reached refuses the rest of the day with `daily_budget`.**

| | |
|---|---|
| **A table, not memory** | The per-minute rate limiter is in memory, and that is right for it: a restart that clears a one-minute window loses nothing. A budget that a restart clears is not a budget |
| **The table was already designed** | `ai_usage_daily` is in SCHEMA.md as the source for Settings → AI's usage view, so the budget adds no new storage concept |
| **Fail closed** | A budget that cannot be read is not known to have room, so the request is refused |

**Rejected.** *An in-memory counter*, for the reason above. *Counting refused requests*: they never reached the provider and cost nothing.

**Consequences to accept:** the check and the write are separate statements, so two requests racing at the limit can both pass — at most one request over, for one user. Tokens are taken from the final response, so tokens spent on fallback attempts that failed are not counted.

---

## ADR-44 — The capability matrix stays `capabilities.ts`, checked at startup

**Decision.** Approved by the user 2026-10-26, resolving entry-gate finding **B-3b**. Implemented in PR #11. **Amends** the ROADMAP's references to `capabilities.json`.

> **The declared capability matrix stays a TypeScript module. Measured results from Phase 8 are stored in `ai_model_evaluations` and layered over it through `createCapabilityMatrix(measured)`. When the server starts, every model named in a tier list must have an entry, or the server refuses to start and names each one that does not.**

A JSON file would add a parse-and-validate step to obtain what the type checker already guarantees for the `.ts` file. The startup check is local: it compares the configured tier lists with the matrix, needs no key and reads no catalogue, so it does not conflict with [ADR-41](#adr-41--a-catalogue-drift-is-reported-never-silently-re-routed), which rejects a *network* check at boot. The per-request refusal (`no_capability_entry`) remains as a second line.

---

## ADR-45 — The Tier 1 catalogue drift is deferred to Phase 8

**Decision.** Approved by the user 2026-10-26, resolving entry-gate finding **B-3e**. **Applies [ADR-41](#adr-41--a-catalogue-drift-is-reported-never-silently-re-routed).**

> **The ROADMAP box "every candidate model is confirmed, corrected, or removed against the authenticated catalogue" is ticked on the 2026-08-31 confirmation. The Tier 1 primary's disappearance from the 2026-09-03 catalogue (`nvidia/nemotron-3-nano-30b-a3b`, apparently renamed `nvidia/nemotron-nano-3-30b-a3b`) is Phase 8 input, not a Phase 7 blocker.**

Tier 1 keeps serving through its fallback, `openai/gpt-oss-20b`, and the circuit breaker limits the cost of the dead identifier to one failed attempt per breaker window. Phase 8 begins by running `npm run ai:catalogue` and evaluates both identifiers before any routing change.

---

## ADR-46 — Database errors are not translated; the unwired translator is deleted

**Decision.** Approved by the user 2026-10-26, resolving **R-4** (docs/RECOVERY-2026-10.md). Implemented in PR #12.

> **Services pre-check every case a user can trip and return a typed error for it. A database constraint that still fires is a defect and surfaces as a fault with a correlation id. `src/server/services/_errors.ts`, a translator that was never wired in, is deleted.**

Wiring the translator in would have changed the error contract of every write, to turn into user messages cases that a single user cannot trigger and that, when they occur, are bugs to fix rather than messages to show. It also kept PostgreSQL 18's `23001` (R-3) out of application code entirely.

---

## Open decisions requiring the user

| # | Decision | Why it cannot be defaulted | Blocks |
|---|---|---|---|
| **OD-2** | **`AGENTS.md` duplication** | `AGENTS.md` is byte-identical to `Claude.md` (46,058 bytes each). Two copies of a 2,181-line specification will drift, and drift in the spec is worse than drift in code. Recommendation: reduce `AGENTS.md` to a one-line pointer. Not done unilaterally — the file may exist because another tool requires full content at that path. | Nothing technically; it is a correctness-of-instructions risk |
| **OD-3** | **Equity/ETF market-data provider terms** | Free sources cover Indian mutual funds (AMFI) and FX; listed equities need a paid API whose terms are a commercial choice, not an engineering one. **Direction set 2026-08-18: Twelve Data**, integrated at a later Phase 6 step behind the provider credential/configuration step. Kite Connect is explicitly **not** to be integrated. No commercial SDK is installed in advance. | The equity adapter only. The abstraction, the registry, AMFI, FX and Manual are all built without it |
| **OD-11** | **Crypto market data** | **Deferred 2026-08-18.** No crypto provider is implemented. The domain stays extensible — `cadence: 'continuous'` and the wall-clock branch of [ADR-28](#adr-28--staleness-is-measured-in-trading-sessions-not-wall-clock-hours) exist and are tested — but no adapter ships. | Nothing |
| **OD-12** | **Dedicated gold market data** | **Deferred 2026-08-18.** Gold is represented through supported instruments (gold ETFs and gold mutual funds price through the ordinary adapters) or through a `manual_assets` valuation series. No bullion adapter, no purity/unit-conversion model. | Nothing |
| **OD-18** | **Where the missing deterministic financial capabilities belong** | **Deferred 2026-08-30, and removed from the Phase 7 tool registry.** Three tools the conceptual list names have no deterministic backing: `run_financial_scenario` (no projection function, no contribution model, no service, no schema — nothing at all), `calculate_financial_metrics` (savings rate exists; expense ratio, runway and commitment coverage do not), and `get_portfolio_performance`'s TWR (`twr()` and `growthSeries()` are implemented and unit-tested but have **no production caller** — `portfolio.ts` hardcodes `twr: unavailable('insufficient_price_history')`). All three are **financial-engine work, not AI work**: shipping them as AI features would put projection arithmetic inside a model, which `CLAUDE.md` forbids outright. The governing rule is now normative — see [ADR-35](#adr-35--ai-infrastructure-is-strictly-read-only-a-mutation-needs-a-separate-approved-proposal-workflow) and `AI-SYSTEM.md` §8: **an AI capability exists only where a deterministic application capability already exists or has an explicitly approved implementation path.** | Nothing in Phase 7. The tools are absent from the registry rather than stubbed |
| **OD-19** | **The Overview page is still a Phase-2 placeholder** | **Deferred 2026-08-30 as a product/UI work item.** Out of AI scope and explicitly **not** a Phase 7 blocker. It matters because it is the screen the AI's answers will be compared against, and `CLAUDE.md <overview>` makes it a MUST-BUILD; every figure it describes is now computable from Phases 3 – 6.11. Scheduled with the Phase 9 UX work, not before. | Nothing. Phase 7 proceeds without it |
| **OD-13** | **AMFI reuse terms** | **Open, and documented rather than assumed.** AMFI publishes `NAVAll.txt` and the NAV-history report publicly and without authentication, and the Indian fintech industry consumes both; **no machine-readable licence or explicit reuse grant was located**, so none is asserted. The adapter is built for personal, non-redistributing use and says so in its header. Confirm with AMFI before any non-personal use or redistribution. | Nothing for personal use; would block redistribution |

### Resolved

| # | Decision | Outcome |
|---|---|---|
| **OD-1** | `NVIDIA_API_KEY` | ✅ **Resolved: the key was configured, the authenticated catalogue was read (2026-08-31) and the 7.7 live smoke test ran.** The 2026-09-03 Tier 1 drift is deferred to Phase 8 by [ADR-45](#adr-45--the-tier-1-catalogue-drift-is-deferred-to-phase-8) |
| **OD-17** | How to close the AI write boundary (Phase 7 review, **F-1**/**F-2**) | ✅ **Resolved 2026-08-30 by the recommended option: narrow the context the AI layer receives.** The AI layer holds an `AiReadCtx` — no `db`, no `fx`, no transaction capability, and not a `ReadCtx` — so both the escalation and the raw write are compile errors. `withWriteCtx` now requires a `RequestCtx` carrying `beginTransaction`, granted only by `createReadCtx`. Normative record: [ADR-33](#adr-33--the-transaction-opener-is-a-capability-carried-on-the-context-not-an-ambient-import), [ADR-34](#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths), [ADR-35](#adr-35--ai-infrastructure-is-strictly-read-only-a-mutation-needs-a-separate-approved-proposal-workflow). Invariants **I-50 … I-52**. No AI infrastructure was implemented |
| **OD-4** | Amend the approved baseline with the Phase 4 review's D1–D15 | ✅ Approved and applied 2026-08-11 |
| **OD-5** | `investment_transactions.net_amount` currency | ✅ Approved 2026-08-11: the **account's** currency ([ADR-12](#adr-12--base-currency-with-dated-fx-stored-alongside-native-amounts)) |
| **OD-6** | `settlement_date` semantics | ✅ Resolved 2026-08-11: recognition is trade-dated ([ADR-22](#adr-22--financial-recognition-is-trade-dated-settlement_date-is-informational-metadata)) |
| **OD-7** | Net-worth valuation basis before market data exists | ✅ Approved 2026-08-12: **Net Worth at Cost** in Phase 5; market value is a distinct Phase 6 calculation; the two are never mixed in one figure ([ADR-23](#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost)) |
| **OD-8** | `net_worth_snapshots` and the `networth.snapshot` job | ✅ Approved 2026-08-12: **moved to Phase 6.** Phase 5 derives every figure; snapshots remain available to Phase 6 under four stated rules ([ADR-24](#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6)) |
| **OD-14** | Apply the Phase 6.11 design review to the canonical documents | ✅ **Approved and applied 2026-08-21.** Reconciled, not appended: [ADR-31](#adr-31--cost-to-market-is-a-restatement-at-an-instant-not-a-bridge-over-time) (restatement, not bridge) and [ADR-32](#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view) (default stays `cost`) carry the architectural findings; the methodology went into [FINANCIAL-DOMAIN.md §9.3](FINANCIAL-DOMAIN.md#93-calculation), [INVESTMENT-DOMAIN.md §5.1](INVESTMENT-DOMAIN.md#51-market-value-of-a-position-as-of-a-date), `SCHEMA.md` §12 (**I-41 … I-49**, I-38/I-39 promoted) and `TESTING.md` §11. **The Phase 5 cost methodology is untouched** |
| **OD-15** | `net_worth_snapshots` and the snapshot job | ✅ **Closed 2026-08-21 — not built, on measurement.** A 365-point market-value series over a portfolio larger than the target user's runs in **123 ms** with an indexed price lookup; the naive 1,156 ms was a linear scan, not a missing cache. No table, no job, no snapshot-based figure. [ADR-24](#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6)'s four rules are retained on the shelf, and only a **real production measurement** reopens this |
| **OD-16** | Default valuation basis | ✅ **Resolved 2026-08-21: the default remains `cost`.** `market` is a fully supported, explicitly requested alternate view. Historical continuity is preserved and the headline does not move because a price or a rate changed. Normative record: [ADR-32](#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view), which **supersedes ADR-23's default-flip consequence** |
| **OD-10** | Apply the Market Data review's M1–M13 to the canonical documents | ✅ **Approved and applied 2026-08-18.** Reconciled, not appended: four findings became [ADR-27](#adr-27--market-data-adapters-return-observations-the-registry-classifies-freshness), [ADR-28](#adr-28--staleness-is-measured-in-trading-sessions-not-wall-clock-hours), [ADR-29](#adr-29--provider-corporate-actions-are-detections-never-ledger-writes) and [ADR-30](#adr-30--one-provider-per-instrument-price-series-the-only-price-fallback-is-manual); the rest were folded into `FINANCIAL-DOMAIN.md` §2, `INVESTMENT-DOMAIN.md` §5/§8.1/§10, `SCHEMA.md` §5/§5.1/§12 and `TESTING.md`. Invariants **I-33 … I-40** added. Per-finding disposition: [MARKET-DATA-DESIGN.md §21](MARKET-DATA-DESIGN.md#21-defects-found-in-the-baseline-m1m13) |
| **OD-9** | Apply the Net Worth review's N1–N19 to the canonical documents | ✅ Approved and applied 2026-08-12. The normative rules were **reconciled**, not appended to: [ADR-23](#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost), [ADR-25](#adr-25--net-worth-classification-is-by-the-economic-sign-of-the-balance-not-by-account-kind) and [ADR-26](#adr-26--an-as-of-financial-figure-is-computed-from-dated-facts-only-no-current-state-flag-participates) carry the four architectural findings; the rest are folded into `FINANCIAL-DOMAIN.md`, `SCHEMA.md`, `INVESTMENT-DOMAIN.md` and `TESTING.md`. Disposition table in [NET-WORTH-DESIGN.md §14](NET-WORTH-DESIGN.md#14-defects-found-in-the-baseline-n1n19) |

