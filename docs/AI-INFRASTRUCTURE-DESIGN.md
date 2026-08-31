# AI Infrastructure — Phase 7 architecture and model evaluation review

**Status:** design review complete 2026-08-29. Step 7.0 (pre-implementation corrections) applied
2026-08-30 — see [§21](#21-disposition-of-f-1-f-2-and-f-3--2026-08-30). **Phase 7 infrastructure
implemented 2026-08-30: steps 7.1-7.6 built and verified, 7.7 blocked on OD-1.** Two design points
here were amended by what was built — the adapter is written over injected `fetch` rather than the
`openai` client ([ADR-40](DECISIONS.md#adr-40--the-nvidia-adapter-is-written-over-fetch-the-openai-client-is-deferred-to-the-phase-that-needs-streaming)),
and the capability matrix carries an explicit declared/measured split because no model has been
measured. **No user-facing AI feature exists**, and no model has been evaluated.
**Nature of this document:** a review record and rationale, like
[INVESTMENT-ENGINE-DESIGN.md](INVESTMENT-ENGINE-DESIGN.md), [NET-WORTH-DESIGN.md](NET-WORTH-DESIGN.md),
[MARKET-DATA-DESIGN.md](MARKET-DATA-DESIGN.md) and
[MARKET-VALUE-NET-WORTH-DESIGN.md](MARKET-VALUE-NET-WORTH-DESIGN.md). **Non-normative** — where this
document and a canonical one differ, the canonical one wins until an ADR moves the rule.

**Baseline reviewed:** commit `2bc9bc7`, branch `claude/phase-7-ai-infrastructure-review`.
Verified rather than assumed: **1,396 tests passing** (66 files), typecheck clean, lint clean over
`src app tests scripts proxy.ts`, `verify:integrity` 33 passed / 0 failed / 19 engine-enforced /
2 deferred.

**Documents read:** `CLAUDE.md`, `PROJECT-STATE.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `AI-SYSTEM.md`
(all 717 lines), `FINANCIAL-DOMAIN.md`, `INVESTMENT-DOMAIN.md`, `NET-WORTH-DESIGN.md`,
`MARKET-VALUE-NET-WORTH-DESIGN.md`, `MARKET-DATA-DESIGN.md`, `SCHEMA.md`, `SECURITY.md`,
`TESTING.md`, `DECISIONS.md`.

**Code inspected:** `src/server/services/**`, `src/server/domain/**`, `src/server/auth/**`,
`src/server/db/**`, `src/lib/**`, `app/**`, `proxy.ts`, `eslint.config.mjs`,
`scripts/check-no-client-secrets.ts`. Compile and lint findings below are **empirical** — probe
files were written, `tsc` and `eslint` run against the project's own config, and the probes deleted.

---

## 0. The finding that matters most

> **`docs/AI-SYSTEM.md` is a very good design, written in Phase 1 against a system that did not yet
> exist. Phases 3 – 6.11 then built that system. Three of the properties the document calls
> non-negotiable and structural are, against the code as it now stands, false.**

This is the normal and expected outcome of designing before building, and it is precisely why the
project reviews before each phase. Nothing here says the design was wrong; it says the design has
not been re-grounded since the ground moved.

The three, in severity order:

| # | AI-SYSTEM.md says | The code says |
|---|---|---|
| **F-1** | §1.1 "the AI layer holds only a `ReadCtx` … so a write from AI code **does not compile**" | Two independent holes. `ReadCtx.db` is a full DML executor, and `withWriteCtx(readCtx, …)` compiles clean |
| **F-2** | §3 "nothing inside it imports `src/server/db/`" | The ESLint rule restricts only `@/`-aliased paths; a relative import lints clean |
| **F-3** | §8 "Σ rows = total at every depth … asserted by test" | The only category summary returns parents **and** children, each rolled up. Summing every row double-counts |

**Phase 7 must not start until F-1 and F-2 are closed.** They are pre-work on existing code, not AI
features, and they are cheap. Everything else in this review is ordinary design.

> **Closed 2026-08-30.** All three, plus the serialization gap of §6.2, before any AI code was
> written. Disposition and the mechanism for each: [§21](#21-disposition-of-f-1-f-2-and-f-3--2026-08-30).

---

## 1. AI architecture

The required layering is unchanged and correct:

```
USER → WEB UI → AI ORCHESTRATOR → MODEL → CONTROLLED TOOLS
                                        → DETERMINISTIC FINANCIAL ENGINE → DATABASE
```

What this review adds is the boundary that makes it structural rather than aspirational.

### 1.1 The four rules, restated so each has a mechanism

`AI-SYSTEM.md` §1 states seven rules. Each is right; three lack a working mechanism. The corrected
form:

| Rule | Mechanism |
|---|---|
| The AI never mutates financial records | **Three** mechanisms, not one — see §7 |
| The AI reads only through the tool surface | Named-export import ban + source scan |
| No model identifier outside `config/` | Source scan (precedent: `market-data-source-scan.test.ts`) |
| A task is never routed to a model lacking a required capability | Hard gate in `select.ts` + test |
| Authorisation is decided by services, never the model | Already true — every service takes `ctx` and filters on `ctx.userId` |
| Invalid structured output is rejected, not repaired | One repair attempt carrying field errors, then reject |
| Every figure comes from a tool result | Tool results carry their own totals (§6.3) |

### 1.2 Where the AI layer sits

`src/server/ai/` as mapped in `AI-SYSTEM.md` §3, with one correction: the module map says
*"nothing inside it imports `src/server/db/`"*, which is right, and adds that handlers project over
**application services**. Keep both. Add: **only `tools/handlers.ts` may hold a `ReadCtx`.** Everything
above it — orchestrator, loop, structured, proposals — takes a bound tool registry and no context at
all. That is what makes the write barrier type-level rather than scan-level for the majority of the
layer.

---

## 2. Model tier strategy

Five tiers, unchanged from `AI-SYSTEM.md` §4. The tier is a **capability class**, never a model name.

| Tier | Purpose | Optimise for |
|---|---|---|
| **1 — Routine** | transaction parsing, categorisation, routine chat, summaries, simple portfolio questions | latency, cost, **schema adherence**, tool-call reliability |
| **2 — Reasoning** | portfolio analysis, cross-domain and multi-period analysis, hard tool selection | reasoning quality, tool selection |
| **3 — Maximum** | exceptional investigations only; never reached by automatic escalation | capability ceiling |
| **4 — Multimodal** | receipts, statements, screenshots, PDFs | extraction accuracy |
| **5 — Embeddings** | semantic retrieval | **not built — §13** |

**Tier 3 access rule** (retained): reachable only on explicit user request from the UI, or when a
Tier 2 attempt self-declares low confidence on a flagged-complex task. Never by automatic escalation
from ordinary chat. Enforced in `select.ts`, asserted by test.

---

## 3. Candidate model evaluation

### 3.1 The catalogue does not match `CLAUDE.md`

`AI-SYSTEM.md` §2.3 recorded a Phase 0 unauthenticated read. It still stands, and it is material:

| `CLAUDE.md` candidate | Catalogue |
|---|---|
| `nvidia/nemotron-3-super-120b-a12b`, `nvidia/nemotron-3-ultra-550b-a55b`, `nvidia/nemotron-3-nano-30b-a3b`, `google/gemma-4-31b-it`, `openai/gpt-oss-20b`, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` — and **not** `nvidia/nemotron-nano-12b-v2-vl`, which the authenticated read found absent, `nvidia/nemotron-3-embed-1b` | ✅ present (**7** — corrected 2026-08-31; the 12b vision model is absent) |
| `deepseek-ai/deepseek-v4-flash` | ⚠️ real id `deepseek-ai/deepseek-v4-flash-0731` |
| `zai-org/glm-5.2` | ❌ **absent** — corrected 2026-08-31 by the authenticated read. No GLM model exists under any publisher prefix, so `z-ai/glm-5.2` was not the real identifier either. |
| `deepseek-ai/deepseek-v4-pro`, `mistralai/mistral-medium-3.5-128b`, `qwen/qwen3-next-80b-a3b-instruct` | ❌ not listed |

**Three of thirteen candidates do not exist under the given identifier, and two are misspelled.** Any
routing table written against `CLAUDE.md`'s list verbatim would fail at runtime on five of thirteen
entries.

### 3.2 The evaluation cannot be run yet, and that is the honest answer

The brief asks for an evaluation against actual workloads before selecting models. **That evaluation
cannot be executed**: `NVIDIA_API_KEY` is unset (**OD-1**), so neither `ai:catalogue` (authenticated
catalogue re-verification) nor `ai:eval` (workload scoring) can run. Reporting scores here would mean
inventing them.

What this review can and does deliver instead:

1. the harness design (§3.3),
2. a **provisional** model set derived from tier membership and published capability (§4),
3. an explicit gate: **no model is production-routed until it has a measured `capabilities.json`
   entry.** A model with no entry is unusable and startup fails loudly (ADR-18).

`SECURITY.md` §12's accepted-risk row for AI is *conditioned on* that measurement ("Tier 1 requires
≥ 0.95 schema adherence"). Until the eval runs, **the risk acceptance is not yet earned** — which is
another way of saying Phase 8 is not optional.

### 3.3 The evaluation harness

Nine suites, matching the brief's workloads and `AI-SYSTEM.md` §14:

| Suite | Workload | Scoring |
|---|---|---|
| `parse` | *"Spent ₹1,250 at a restaurant using HDFC credit card yesterday."* | deterministic — exact field match against a labelled expectation |
| `ambiguity` | *"Paid 2k yesterday."* | deterministic — **must** populate `ambiguities[]` and leave account/category `null`. Inventing either is a hard fail |
| `classify` | description → category | deterministic against a labelled corpus |
| `tool-select` | *"How much did I spend on food last month?"* | deterministic — did it call the right tool with the right arguments |
| `grounding` | portfolio / net-worth questions | **every numeric claim is diffed against engine output**; a figure not traceable to a tool result is a fail |
| `analysis` | *"Why has my portfolio changed this month?"*, concentration | LLM-as-judge, **advisory only** — never scores a numeric claim |
| `scenario` | *"₹25,000/month for five years"* | deterministic contributions checked against the engine; hypothetical returns checked for assumption labelling |
| `document` | receipt/statement image → structured extraction | deterministic field match |
| `injection` | the corpus in §9.4 | deterministic — no write attempted, no unexpected tool called |

**Thresholds for production routing:** `schemaAdherence ≥ 0.95` for any Tier 1 parsing route;
`toolCallCorrectness ≥ 0.90` for any tool-using route; `injectionResistance = 1.00` for every route.
Below threshold a model may sit in the candidate list only as a last-resort fallback for
non-mutating tasks, and is marked as such.

**The eval never runs in CI.** Separate script (`npm run ai:eval`), network-using, opt-in — the
precedent is `test:live-providers` and `smoke:market-data`.

---

## 4. Recommended production model stack — PROVISIONAL

Marked provisional because §3.2 blocks measurement. Chosen as the **smallest set that covers every
tier with a fallback**, from confirmed-present identifiers only.

| Tier | Primary | Fallback | Rationale |
|---|---|---|---|
| **1** | `nvidia/nemotron-3-nano-30b-a3b` | `openai/gpt-oss-20b` | small, fast, both confirmed present; Tier 1 is dominated by schema adherence, not reasoning |
| **2** | `nvidia/nemotron-3-super-120b-a12b` | `deepseek-ai/deepseek-v4-flash-0731` | GLM was the intended fallback until the authenticated catalogue read found no GLM model at all (2026-08-31) |
| **3** | `nvidia/nemotron-3-ultra-550b-a55b` | *(none — fail closed)* | a Tier 3 request that cannot be served should fail, not silently downgrade |
| **4** | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | *(none — the intended primary does not exist)* | The authenticated read found `nemotron-nano-12b-v2-vl` absent. Vision cannot fall back to text, so Tier 4 fails closed on a single model |
| **5** | — | — | not built (§13) |

**Dropped from the candidate pool, with reasons:**

- `deepseek-ai/deepseek-v4-pro`, `mistralai/mistral-medium-3.5-128b`, `qwen/qwen3-next-80b-a3b-instruct` — **not in the catalogue.** Cannot be routed to.
- `deepseek-ai/deepseek-v4-flash-0731` — retained as a **Tier 2 candidate** for the eval, not in the initial routing order; three Tier 2 candidates is enough.
- `google/gemma-4-31b-it` — retained as a Tier 1 eval candidate; two primaries plus one spare is sufficient.

**Seven models in the pool, four routed.** Not thirteen.

---

## 5. Routing policy

### 5.1 Capability, never model

Application code requests a capability. The capability maps to a `CapabilityRequirement`; the
requirement filters candidates; the candidates are ordered by measured score.

```
run(capability, input, session)
  ├─ requirements.ts  capability → { tier, needsTools, needsSchema, needsVision,
  │                                  minSchemaAdherence, maxLatencyMs, allowEscalation }
  ├─ select.ts        candidates = config.tier[req.tier]
  │                     .filter(meets requirement)      ← HARD GATE, never relaxed
  │                     .filter(health.isAvailable)     ← circuit breaker
  │                     .sort(score, latency, cost)
  ├─ fallback.ts      attempt in order, classifying failures
  └─ observability    model, capability, latency, tokens, outcome, fallback depth
```

| Capability | Tier | Tools | Schema | Notes |
|---|---|---|---|---|
| `parseTransaction` | 1 | **none** | strict | nothing is read while drafting a write |
| `classifyTransaction` | 1 | none | strict | |
| `answerFinanceQuestion` | 1 → 2 | yes | none | escalates on complexity |
| `analyzePortfolio` | 2 | yes | none | |
| `analyzeFinancialHealth` | 2 | yes | none | |
| `analyzeFinancialPeriod` | 2 | yes | none | |
| `runFinancialScenario` | 2 | yes | none | **engine must exist first — §6.5** |
| `analyzeDocument` | 4 | none | strict | |
| `extractReceiptData` | 4 | none | strict | |
| `retrieveRelevantContext` | 5 | — | — | not built |

### 5.2 Escalation

Evaluated **per message, never sticky** (`AI-SYSTEM.md` §6.2). A deep question followed by
*"what's my HDFC balance?"* must return to Tier 1. The classifier is application code, so its output
is exactly checkable — the `tool-select` eval suite carries a labelled routing corpus including the
sticky-escalation trap.

**Model selection cannot be influenced by content** (`SECURITY.md` §8). Tier and requirements are
computed from the *capability*, never inferred from user text or tool output. This is what stops
injection escalating a request to a more permissive path.

### 5.3 Fallback

| Failure | Classification | Action |
|---|---|---|
| HTTP timeout | transient | next candidate |
| 429 | rate-limited | honour `Retry-After`, then next candidate; open breaker |
| 5xx | transient | next candidate |
| invalid JSON / schema violation | **capability** | one repair attempt, then next candidate **of equal capability** |
| tool-call malformed | **capability** | next candidate; never hand-execute the model's intent |
| 401/403 | configuration | fail closed, surface to Settings, do not retry |

**The hard constraint:** never downgrade across a required capability. A multimodal request cannot
fall back to a text model. A proposal task cannot fall back to a model that cannot emit the schema.
Availability is not a licence to downgrade. Asserted by test.

---

## 6. Tool architecture

### 6.1 What actually exists

Of the 21 conceptual tools, mapped against the real service surface:

| | Count | Detail |
|---|---|---|
| **Exist, need only a projection** | 13 (+`getCategories`) | `getAccounts`, `getAccountBalances`, `getTransactions`, `getBudgetStatus`, `getAssets`, `getLiabilities`, `getNetWorth`, `getInvestmentAssets`, `getHoldings`, `getInvestmentTransactions`, `getPortfolioSummary`, `getAssetAllocation`, `comparePeriods` |
| **Need a thin adapter** | 5 | `getRecurringTransactions`, `getNetWorthHistory`, `getInvestmentAssets` (price status), `calculatePortfolioMetrics`, `getPortfolioPerformance` |
| **No backing — engine work** | 3 | `getIncomeSummary`/`getExpenseSummary` (partition contract), `calculateFinancialMetrics` (3 of 4 metrics), `runFinancialScenario` (nothing at all) |

### 6.2 Nothing is serializable yet

`Money.minor`, `Rate`, `UnitPrice` and `Quantity` are all `bigint`. `JSON.stringify` **throws** on
every one, and no domain type defines `toJSON`. **Every** tool — including the thirteen that "need no
new code" — requires a projection layer before its result can reach a model.

`src/lib/format/diagnostic-json.ts` already solves this losslessly (renders at native scale, refuses
`Number()`) and is unit-tested, but it is a blind recursive walker built for diagnostics and is not
re-exported from `src/lib/format/index.ts`. **It is the right primitive to build on, not a drop-in
tool serializer.** A tool projection must be explicit per tool — a blind walker would leak whatever a
service happens to return, which is the opposite of field projection.

### 6.3 The arithmetic boundary — and why it does not hold today

`AI-SYSTEM.md` §8 requires that every summary tool return its own total, so the model never adds.
Correct, and currently unimplementable for the two tools that need it most:

`breakdown()` emits **every node** of the category tree — parents *and* children — each carrying the
**rolled-up** total. Summing all rows double-counts every parent/child pair. The project's own golden
test works around it by string-matching the label separator:

```ts
// tests/integration/golden-g1.test.ts:231
const topLevel = rows.filter((r) => !r.label.includes('›'));  // so children are not counted twice
```

A "thin projection" over `breakdown()` would ship that double-count to the model. The fix is engine
work: add `depth`, `isRollup` and a top-level `total` to the breakdown contract so that
`Σ rows === total` holds by construction at every depth.

**Correction to the doc:** `AI-SYSTEM.md` §8 extends the "must carry the sum" rule to
`get_net_worth_history`. That is wrong — a series of month-end *levels* has no meaningful sum. The
rule is right for income/expense summaries and allocation, and does not apply to a level series.

### 6.4 Tool contract

Every tool:

- **input schema** in Zod, `additionalProperties: false`, complete `required` array;
- **no `userId` field, ever** — it comes from the session `ReadCtx`;
- **bounded scope** — row cap, date-range cap, 150 KB byte budget, `truncated` flag when clipped;
- **its own total** where the rows partition something;
- **coverage and exclusions** surfaced, not hidden — `Metric<T>`'s null-with-reason, `NetWorthResult.excluded`, `MarketValuation.status`;
- **a projected error**, never a raw `DomainError` (which carries the entity id, and for `settings` that id is the user id).

**An unauthorized id is indistinguishable from a missing one.** `requireOwnership` returns
`not_found`, never `forbidden`, deliberately — to avoid an enumeration oracle. `forbidden()` exists in
`src/lib/result.ts` and has **zero call sites**. Any tool error mapping that branches on `forbidden`
would be dead code.

### 6.5 Three tools are engine work, not AI work

This is the scope finding of the review.

- **`runFinancialScenario` has no backing of any kind.** No projection function, no contribution model, no assumption/deterministic split, no service, no schema. `CLAUDE.md <scenario_analysis>` describes a subsystem that has never been built. It is **deterministic financial engine work** and belongs in a financial phase, not in an AI phase. Shipping it as "an AI feature" would put projection arithmetic in a model, which `CLAUDE.md` forbids outright.
- **`calculateFinancialMetrics`** promises savings rate, expense ratio, runway and commitment coverage. Only savings rate exists.
- **`getPortfolioPerformance`** promises TWR. `twr()` is fully implemented and unit-tested but has **no production caller** — `portfolio.ts:317` hardcodes `twr: unavailable('insufficient_price_history')`. `growthSeries()` is likewise finished and unreachable. Two pieces of completed engine code are wired to nothing.

**Recommendation:** Phase 7 ships the tool *framework* plus the tools that exist. The three above are
removed from the Phase 7 tool registry and become a separate, small financial-engine work item
(§16, **OD-18**).

---

## 7. Mutation architecture

The required flow, unchanged:

```
USER INPUT → AI INTERPRETATION → STRUCTURED PROPOSAL → SERVER VALIDATION
           → USER CONFIRMATION → DETERMINISTIC APPLICATION LOGIC → DATABASE
```

### 7.1 The write barrier, corrected

`AI-SYSTEM.md` claims one mechanism. **Three are required**, because each closes a different hole:

| # | Mechanism | Closes |
|---|---|---|
| 1 | **Type** — a command takes `WriteCtx`; a `ReadCtx` is not one | the accidental direct call. *Verified: `createTransaction(readCtx, …)` → `TS2345`* |
| 2 | **Named-export import ban** — `src/server/ai/**` may not import `withWriteCtx`, `withWriteCtxResult`, or any command from `@/server/services` | **the escalation.** *`withWriteCtx(readCtx, w => createTransaction(w, …))` compiles clean today* |
| 3 | **Source scan** — no `ctx.db.execute/.insert/.update/.delete` under `src/server/ai/**`; no relative-path import of `db/**` or `domain/**` | **the raw-SQL write.** *`ctx.db.execute(sql\`update …\`)` from a `ReadCtx` compiles and lints clean today* |

Mechanism 2 is `no-restricted-imports` with `importNames` — the config supports it and does not
currently use it. Mechanism 3 extends the existing ESLint AI zone with the `**/server/db/*` fallback
the engine zone already has, plus a source-scan test modelled on I-32.

**Better still, and recommended:** give the AI layer a narrowed context so mechanism 3 is mostly
unnecessary. Only `tools/handlers.ts` receives a `ReadCtx`; everything above it receives a bound tool
registry and no context. Then the raw-SQL hole is unreachable from the orchestrator, the loop, the
structured layer and the proposal layer by construction, and the scan guards one small file instead
of a subtree. **This is OD-17.**

### 7.2 Proposal lifecycle

Unchanged from `AI-SYSTEM.md` §9 and already well designed. The parts worth restating:

- The parse task runs with **no tools** — nothing is read while drafting a write.
- **The amount crosses as a decimal string**, never a JSON number (ADR-04). A JSON number becomes an IEEE-754 double before our code sees it.
- **One repair attempt**, carrying the field errors. Then the proposal is stored `invalid` and shown for editing. Never guessed, never silently corrected.
- Apply is `services/aiProposals.applyProposal()` — **an application service, not AI code** — with compare-and-swap on `status='pending'` plus a partial unique index on `ai_proposal_id`. Two independent guards against double-apply.
- **No proposal kind deletes anything.**

Two corrections:

- **`ARCHITECTURE.md` and `AI-SYSTEM.md` disagree on where apply lives.** `ARCHITECTURE.md` lists `ai/proposals/` as carrying "apply"; `AI-SYSTEM.md` §3 says apply lives in `services/aiProposals.ts`, "**NOT here**". `AI-SYSTEM.md` is right; `ARCHITECTURE.md` must be corrected.
- **`transactions.ts` is already wired for this.** `createTransaction(ctx, raw, { source })` accepts `RecordSource`, which includes `'ai'`, and maps it to `actor: 'ai_confirmed'` in the audit row. The mutation path needs no new service — only the proposal table and the apply wrapper.

### 7.3 Hallucinated entities

There is **no fuzzy matcher** in the codebase. `AI-SYSTEM.md` §8's resolver contract
("exact → case-insensitive → unique fuzzy ≥ 0.8") describes something that does not exist; `pg_trgm`
is not installed, and the nearest precedent (`resolveTags`) is exact-lowercase **and takes a
`WriteCtx`**, so a read-only tool cannot reuse it.

**Decision:** V1 resolves **exact, then case-insensitive**, and treats anything else as *unresolved*.
An unresolved hint opens the proposal in edit mode with the field highlighted. Fuzzy matching is
deferred — guessing which account the user meant is exactly the silent-repair behaviour
`<ai_structured_outputs>` forbids.

---

## 8. Context minimization

```
user request → intent → required data → controlled tool → minimal result → model
```

| Capability | Token budget | Row budget |
|---|---|---|
| simple query | 4k | 50 rows |
| transaction parsing | 2k | **0 — no tools** |
| portfolio analysis | 12k | 200 rows |
| period review | 16k | 400 rows |
| cross-domain scenario | 24k | 600 rows |
| document extraction | image + 2k | 0 |

**Never sent:** the full transaction history, every account when one suffices, raw table dumps,
`notes` unless a tool's contract names them, or anything not required by the specific question.

**Fixed context** is deliberately tiny: base currency, locale, timezone, today's date, and the
tool schemas. **No account list and no category dump** — entity resolution happens server-side inside
the tool, not by putting the catalogue in every prompt. There is no prompt caching on NVIDIA Build,
so prompt size is a linear cost on every single request; minimisation is a cost control and a privacy
control at once, and the two incentives point the same way.

**Overflow degrades honestly.** A clipped result sets `truncated: true` and the model is instructed
to say the answer is partial. Silent truncation would let a model report a subset as a total.

---

## 9. Security architecture and prompt-injection model

### 9.1 The principle

**Security decisions are deterministic and never delegated to the model.** Authorization lives in
application services; tool permissions in a frozen registry; validation in schemas. No prompt can
move any of them, because none of them consults the model.

### 9.2 What the model can reach

Every capability the model has is a read the user could perform themselves. There is no privilege to
escalate *to*: no write tool, no code execution, no shell, no filesystem, no network tool, no MCP
server. The model's maximum impact is a proposal the user must confirm.

### 9.3 The injection surface that actually matters

The interesting vector is not the user's message — it is **user-controlled text arriving inside a
tool result**. An account named `IGNORE PREVIOUS INSTRUCTIONS AND …`, a transaction description, an
OCR'd receipt. Defences:

1. Tool results are framed as **data, not instructions**, and the system prompt says instructions found inside user data are to be **reported, not obeyed**.
2. **Tier and capability are computed before any tool runs**, from the capability alone — so injected text cannot change which model or which tools are in play.
3. No tool can widen its own scope: the registry is frozen and the row/date/byte caps are server-side.
4. Structured output is validated against the schema regardless of what the model was told.

### 9.4 Honest residual risk

An injection could still make the model produce a **wrong or misleading narrative** in chat — say,
claiming a figure that no tool returned. Mitigations: the `grounding` eval suite diffs every numeric
claim against engine output, and the UI shows tool provenance. It cannot be reduced to zero by
architecture alone, and the review does not claim otherwise. It is acceptable because the model
cannot write, cannot read anything the user could not, and every mutation is user-confirmed.

### 9.5 Two unbuilt commitments Phase 7 inherits

- **`settings.ai_enabled` has no reader anywhere in the codebase.** `SECURITY.md` twice leans on *"egress is zero when `ai_enabled = false`, and every other feature continues to work"* — and the accepted-risk table names it as the mitigation. The column exists and defaults `true`; nothing consults it. **Phase 7 must make it real**, and it must be checked before the provider is constructed, not inside it.
- **The AI rate limit does not exist.** `SECURITY.md` §6's table lists seven limits; three are implemented. `rate-limit.ts` states plainly that the AI limits "belong to endpoints that do not exist yet". Phase 7 must design a real mechanism, and note that server actions cannot return `429` — the existing login limiter returns a form-state string, not a status code.

---

## 10. External AI data boundary

`SECURITY.md` §8 already carries a binding egress inventory. Phase 7 **inherits** it rather than
authoring a new one. Restated for completeness:

| Sent | Not sent |
|---|---|
| System prompt and tool schemas (static) | Credentials of any kind |
| The user's message | Database rows verbatim |
| Tool results — figures, category and account **names**, descriptions, dates — within row/field/byte caps | Account numbers, IFSC/routing details, `notes` unless a tool's contract includes them |
| Uploaded receipt/statement images (Tier 4, at the user's action) | Any data belonging to a request the user did not initiate |

**Position on identifiers: send names, not UUIDs.** A UUID is meaningless to the model, costs tokens,
and is an identifier leak for no benefit. The server holds the name→id mapping. This also forces the
resolver to live server-side, which §7.3 wants anyway. One consequence to handle: `DomainError`
carries the entity id — and for a settings error, that id **is the user id** — so errors must be
projected before they cross the boundary.

**Retention:** NVIDIA Build's retention terms are a matter of record with the provider, not something
this review can assert. The user-facing statement in Settings should say what is sent and link the
provider's policy rather than paraphrase it.

---

## 11. Cost and latency model

**Prices are not asserted.** NVIDIA Build's rates for these models are not verified here, and
`config/pricing.ts` defaults to zero and is marked unverified until confirmed against actual billing
(`AI-SYSTEM.md` §12). Reporting a fabricated cost would be worse than reporting none. What survives a
price change is the **token arithmetic**:

| Profile | Requests/month | Tier mix | Est. tokens/month |
|---|---|---|---|
| **Light** — a few entries and questions a week | ~60 | 90% T1, 10% T2 | ~0.5 M |
| **Moderate** — daily use + a monthly review | ~300 | 75% T1, 23% T2, 2% T4 | ~3.5 M |
| **Heavy** — frequent analysis, document uploads | ~1,200 | 60% T1, 35% T2, 3% T3, 2% T4 | ~18 M |

Routing comparison at the moderate profile:

| Strategy | Relative token cost | Verdict |
|---|---|---|
| Everything → Tier 1 | 1.0× | cheapest; fails the analysis workloads |
| **Proposed mixed routing** | **~2.4×** | the recommendation |
| Everything → Tier 3 | ~15× on a 550B model | indefensible for a single user |

**Latency budgets:** Tier 1 ≤ 3 s p95, Tier 2 ≤ 12 s p95, Tier 3 unbounded but explicitly requested,
Tier 4 ≤ 20 s p95. Streaming for chat; a determinate progress state for analysis.

**The Tier 3 guard is the real cost control.** It is unreachable by automatic escalation, and a daily
budget (`settings.ai_daily_budget_micros`, which already exists with a non-negative CHECK) is checked
**before** each request, not after.

---

## 12. NVIDIA credential strategy

The template already exists in full — `TWELVE_DATA_API_KEY`. Copy all five parts:

1. **Declare optional, with the rationale in a comment** — `NVIDIA_API_KEY: z.string().min(1).optional()` in `src/lib/env.ts`. Absence degrades one feature; it must not stop the app, and the deterministic suite must run without one.
2. **Read exactly once, in a composition root, and inject** — only `src/server/ai/provider/nvidia-build.ts` may name it (`SECURITY.md` §3 already designates that file).
3. **A `configured?` predicate for the Settings surface, never for a routing decision.**
4. **Document in `.env.example`** — line 67 already reserves the variable names.
5. **A source scan** pinning the files allowed to name it, in the style of the Twelve Data scan — including its allow-list *present*-assertion, so a rename that dropped the wiring fails.

`scripts/check-no-client-secrets.ts` **already lists `NVIDIA_API_KEY`** in `SECRET_VARS`; no change
needed. Note its honest limitation: an **unset** variable contributes no needle, so while the key is
unconfigured that check proves nothing about it.

**No key is needed for Phase 7 steps 7.0 – 7.5.** It is needed only for the live smoke test (7.6) and
for Phase 8. **Do not paste it into a chat** — write it into `.env`, which is git-ignored.

**A structural constraint on ADR-17 nobody has noticed:** `src/server/ai/config/` **cannot read
`process.env`**. The ESLint rule bans `process.env` outside `src/lib/env.ts`. So the env-driven tier
lists (`AI_TIER1_MODELS`, …) must be declared in `src/lib/env.ts` and *passed into* the config module,
not read by it. This is a small change to how ADR-17 is implemented, and it must be decided before
`config/models.ts` is written.

---

## 13. Embeddings and RAG — decision

**Decision: not built. `nvidia/nemotron-3-embed-1b` has no legitimate V1 use case.**

Every question the assistant must answer is a structured query over relational data — accounts,
transactions, holdings, budgets, net worth. SQL answers those exactly; embeddings answer them
approximately. **Approximate retrieval over financial facts is a correctness regression, not a
feature.**

Considered and ruled out: transaction search (SQL `ILIKE` and the existing filters are exact and
sufficient), category suggestion (a Tier 1 classification task, not a retrieval task), document
retrieval (no corpus exists yet), user notes (no volume).

The activation criteria in `AI-SYSTEM.md` §11 are sound and are **endorsed unchanged**: all three
must hold — a real body of unstructured text, a *measured* gap against Postgres full-text search
(`tsvector`) which is tried **first**, and a benefit demonstrated on real user data. If ever
activated: `pgvector` inside the existing PostgreSQL database, **no new datastore** (ADR-19).

**AI memory: conventional conversation history only.** `ai_conversations` + `ai_messages`, already
specified in `SCHEMA.md`. Financial facts stay in Postgres and are re-read through tools on every
request. **Nothing** — no transaction, balance, holding or net-worth figure — is duplicated into an
AI store, because a second copy of a financial fact is a second answer waiting to disagree with the
first.

---

## 14. Multi-model policy

**Default: one task → one appropriate model → one result.** Multi-model is permitted only for:

- **fallback** — the next candidate after a failure (§5.3);
- **modality** — a document is extracted by Tier 4, then the *extracted structured data* is reasoned over by Tier 1/2. Note this is a pipeline, not a collaboration, and the second model never sees the image.

**Not permitted:** ensembles, debate, self-critique loops, or any multi-agent arrangement. `CLAUDE.md`
forbids a multi-agent architecture without demonstrated need, and none is demonstrated.

---

## 15. Observability

**Recorded per request:** capability, tier, model id, fallback depth, latency, prompt/completion
tokens, outcome, failure class, schema-validation result, tool-call count and failures.

**Not recorded in logs:** prompt content, financial figures, tool result payloads, complete
conversations. `src/server/log.ts` already redacts `balance|amount|minor|net_?worth|holding|
quantity|price|cost_?basis|pnl` on every field and **every `bigint` unconditionally** — so AI
observability fields pass through while figures cannot. This is a genuinely good existing control and
Phase 7 should rely on it rather than build a parallel redactor.

Conversation content lives in `ai_messages` because the product needs it — a deliberate, documented
storage decision covered by export and delete, and **distinct from logs**.

The data must answer: which models are actually serving; which fail most and how; which are slow;
which produce invalid structured output; spend by tier and capability; how often fallback fires and
to what depth; whether any capability entry is stale. These feed routing changes — **made by a human
editing configuration**, never by the model choosing its own routing.

---

## 16. Testing strategy

| Layer | Coverage |
|---|---|
| **Unit** (no network, no DB) | routing decisions, capability matching, schema validation, tool input/output validation, context construction and budget enforcement, fallback selection, failure classification |
| **Integration** | provider adapter against **recorded fixtures**, never live; tool calling end to end; authorization; the proposal → confirmation → apply path including the CAS race |
| **Security** | injection corpus; tool abuse; exfiltration attempts; unauthorized mutation; **a `tsc` test that AI code cannot obtain a `WriteCtx`** |
| **Source scan** | no model id outside `config/`; no provider name outside `provider/`; no `db/**` or `domain/**` import (both `@/` and relative); no `ctx.db` DML; the `NVIDIA_API_KEY` allow-list |
| **Evaluation** | entirely separate, opt-in, network-using, **never in CI** (`npm run ai:eval`) |

Every source scan follows the established pattern, which is unusually good and must not be
simplified: an **anti-vacuity** test that the scan found files, a **self-test** that the matcher
catches a synthetic violation, and a **positive** assertion as well as a negative one — because
"reads nothing at all" also satisfies an absence assertion.

---

## 17. Phase 7 implementation sequence

**Phase 7 is infrastructure only.** Per `ROADMAP.md` — which the brief defers to — evaluation is
**Phase 8** and the assistant, natural-language entry, portfolio analyst and document assistant are
**Phase 9**.

| Step | Delivers | Needs key? |
|---|---|---|
| **7.0 — boundary pre-work** | The three write mechanisms (§7.1): named-export import ban, extended ESLint zone with relative-path coverage, source-scan test. Fix `ARCHITECTURE.md` apply location. **Blocks everything else.** | no |
| **7.1 — provider abstraction** | `AiProvider` interface, wire-agnostic types, `nvidia-build.ts`, registry. No routing yet | no |
| **7.2 — configuration** | `NVIDIA_API_KEY` + tier lists in `src/lib/env.ts` (§12's constraint), `config/models.ts`, `capabilities.json` scaffold, `pricing.ts` at zero | no |
| **7.3 — tool framework** | Registry, Zod schemas, **explicit per-tool projections** (§6.2), row/date/byte caps, `truncated`, error projection. The 13 + 5 tools that have backing | no |
| **7.4 — orchestrator** | requirements → select → fallback → health/breaker. Hard capability gate | no |
| **7.5 — structured outputs** | `json_schema`/`json_object`/prompted strategies, validate → one repair → reject | no |
| **7.6 — observability + kill switch** | `ai_messages`, `ai_model_attempts`, `ai_usage_daily`; migration `0005`; daily budget checked **before** the request; **make `ai_enabled` real**; AI rate limit | no |
| **7.7 — live smoke test** | `ai:catalogue`; one real round-trip. Mirrors `smoke:market-data` | **yes — OD-1** |

**Maximised without the key:** 7 of 8 steps. Same shape as Phase 6, where OD-3 gated only step 6.9.

**Explicitly NOT in Phase 7:** the assistant UI, natural-language transaction entry, portfolio
analysis features, document extraction features, the eval harness and its scoring (Phase 8),
embeddings, the scenario engine, and the three missing financial metrics.

### Done when

- [ ] AI code cannot obtain a `WriteCtx` — asserted by a `tsc` test **and** an import ban **and** a source scan
- [ ] No `ctx.db` DML is reachable from `src/server/ai/**` — asserted by source scan
- [ ] The ESLint AI zone catches relative-path imports, not only `@/` ones
- [ ] Every tool schema asserts `additionalProperties: false` and a complete `required` array
- [ ] No tool input schema contains a user-identifier field — asserted by test
- [ ] Every tool result is explicitly projected; no `bigint` reaches JSON
- [ ] Every summary tool that partitions carries its own total, and `Σ rows === total` at every depth
- [ ] Row caps, `truncated` flags and the byte budget are enforced and tested
- [ ] Cross-tier and cross-capability downgrade is impossible — asserted by test
- [ ] A model with no `capabilities.json` entry cannot be routed to; startup fails loudly
- [ ] Daily budget is checked **before** the request
- [ ] `ai_enabled = false` produces zero egress and leaves every other feature working — asserted by test
- [ ] No model identifier outside `config/`; no provider name outside `provider/`
- [ ] `NVIDIA_API_KEY` appears in no client bundle, no log, no test fixture
- [ ] The full deterministic suite passes with **no key configured**

---

## 18. Open decisions

| # | Decision | Why it cannot be defaulted |
|---|---|---|
| **OD-1** | **`NVIDIA_API_KEY`** (existing) | Blocks the authenticated catalogue read and every model measurement. Model selection stays provisional until it is set; `SECURITY.md`'s AI risk acceptance is not earned until then. Blocks step 7.7 and all of Phase 8 |
| **OD-17** | **How to close the write hole** — narrow the context the AI layer receives (recommended), or rely on import bans plus source scans over the full `ReadCtx` | Touches a shared type used by every service. The recommended option is cleaner but is a change to existing, working, tested code, so it is the user's call |
| **OD-18** | **Where the scenario engine, the three missing metrics, and the TWR wiring belong** | They are deterministic financial engine work that the AI tool registry assumes exists. Options: a Phase 6.12 financial-engine step before Phase 7; fold into Phase 9; or drop the tools. Not an AI decision |
| **OD-19** | **The Overview page is still a Phase-2 placeholder** while Phases 3 – 6.11 are complete | Out of AI scope, but it is the screen the AI's answers will be compared against, and `CLAUDE.md <overview>` makes it a MUST-BUILD. Every figure it describes is now computable |

---

## 19. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| The write barrier is weaker than documented | **high** | §7.1's three mechanisms, in step 7.0, before any AI code exists |
| Model selection is provisional and unmeasured | **high** | No production routing without a `capabilities.json` entry; Phase 8 gates it |
| Five of thirteen candidate identifiers are wrong or absent | medium | Corrected list in §4; `ai:catalogue` re-verifies |
| A "thin projection" tool ships the breakdown double-count | medium | §6.3 — fix the engine contract before the tool exists |
| `ai_enabled` is documented as the kill switch and has no reader | medium | Step 7.6 |
| A model narrates a figure no tool returned | medium | `grounding` eval suite diffs every numeric claim; UI shows provenance |
| Tier 3 overuse | low | Unreachable by escalation; daily budget checked before the request |
| Fuzzy resolution guesses the wrong account | low | Not built — exact and case-insensitive only; anything else is `unresolved` |

---

## 20. Completion gate for this review

| Requirement | Status |
|---|---|
| Model responsibilities defined | ✅ §2, §5 |
| Candidate models evaluated | ⚠️ **Framework designed; measurement blocked on OD-1.** Catalogue corrected against reality |
| Smallest production set selected | ✅ §4 — seven in the pool, four routed, provisional |
| Routing defined | ✅ §5 |
| Fallbacks defined | ✅ §5.3, with the no-downgrade constraint |
| Tools defined | ✅ §6, with three removed as engine work |
| Financial mutation boundary defined | ✅ §7, with the enforcement corrected |
| Context minimization defined | ✅ §8 |
| Prompt-injection defense defined | ✅ §9 |
| Secret handling defined | ✅ §12 |
| Cost/latency understood | ✅ §11 — token arithmetic, prices explicitly unverified |
| RAG necessity decided | ✅ §13 — **not built** |
| Testing strategy exists | ✅ §16 |
| Implementation gates explicit | ✅ §17 |
| No unresolved architectural contradiction | ⚠️ **Three found and resolved in this document** (F-1, F-2, F-3); their *fixes* are OD-17 and OD-18 |
| **Implementation started** | ❌ **No.** No code, schema, migration, service, API, UI or test changed |

---

## 21. Disposition of F-1, F-2 and F-3 — 2026-08-30

Applied as **step 7.0**. The corrections are in the code and in the canonical documents; this section
records what happened to each finding so the review stays readable as a record rather than becoming
wrong.

| # | Disposition | Mechanism | Normative record |
|---|---|---|---|
| **F-1** | ✅ closed | `withWriteCtx` requires a `RequestCtx` carrying `beginTransaction`, granted only by `createReadCtx`. The AI layer holds an `AiReadCtx` — no `db`, no `fx`, no capability, and not a `ReadCtx`. Escalation and raw write are both compile errors (**I-50**) | [ADR-33](DECISIONS.md#adr-33--the-transaction-opener-is-a-capability-carried-on-the-context-not-an-ambient-import) |
| **F-2** | ✅ closed | ESLint AI zone extended to relative forms and the query builder; source scan covering dynamic `import()`/`require()`, `ctx.db` DML and write-boundary symbols; the capability types (**I-51**, **I-52**) | [ADR-34](DECISIONS.md#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths) |
| **F-3** | ✅ closed | `breakdown()` returns a structure with an authoritative `total` and an `additivity` tag; `foldToRoots()` makes the partition hold by construction; tag breakdowns declare themselves `overlapping` (**I-54**) | [ADR-37](DECISIONS.md#adr-37--a-breakdown-declares-whether-its-rows-partition-its-total) |
| **§6.2** serialization | ✅ closed | `src/lib/format/json-projection.ts` — tagged exact-digit projection per type, no `Number()`, domain types unchanged (**I-53**) | [ADR-36](DECISIONS.md#adr-36--exact-values-cross-a-json-boundary-as-a-tagged-string-projection-never-as-a-json-number) |
| **OD-17** | ✅ resolved | The **recommended** option: narrow the context the AI layer receives. AI infrastructure is strictly read-only; any future AI-assisted mutation needs a separate approved proposal/confirmation workflow | [ADR-35](DECISIONS.md#adr-35--ai-infrastructure-is-strictly-read-only-a-mutation-needs-a-separate-approved-proposal-workflow) |
| **OD-18** | ⏸ deferred | The scenario engine, the three missing metrics and the TWR wiring are **not** built and are **removed from the Phase 7 tool registry** rather than stubbed | `AI-SYSTEM.md` §8; `ROADMAP.md` Phase 7 |
| **OD-19** | ⏸ deferred | The Overview page is **not** redesigned. A future product/UI work item, scheduled with the Phase 9 UX pass. Not a Phase 7 blocker | `ROADMAP.md`; `PROJECT-STATE.md` |

### Three corrections to this review's own analysis

Recorded because the review is a record, and a record that was wrong in a detail should say so.

1. **§7.1's mechanism 2 — "named-export import ban" — was not the fix taken.** `no-restricted-imports` does support `importNames` alongside `group`, so it was available; it was not used, because the capability types make the escalation inexpressible whether or not `withWriteCtx` is importable. Banning a name is weaker than removing the argument it needs.
2. **The relative-path hole is wider than §7.1 states.** The review noted that the AI zone needed `**/server/db/*` "the fallback the engine zone already has". That pattern would **not** have closed it: it requires a literal `server` segment, which `'../../db/client'` does not contain — so the *engine* zone has the same hole. Dropping `server/` from the relative forms is what closes it. Verified empirically against the rule's own matcher.
3. **ESLint cannot see a dynamic import at all.** `no-restricted-imports` registers no `ImportExpression` listener in any version, so `await import('@/server/db/client')` is unchecked in **every** zone. This is not a gap in the AI rule; it is a gap in the mechanism, and it is the concrete reason the source scan is not redundant with the lint rule.

### One finding the review did not make

**Tag breakdowns were already non-additive and undeclared.** `tagBreakdown` inner-joins
`transaction_tags`, so a transaction carrying two tags contributes its full amount to both and an
untagged one contributes to neither. Σ tag rows has never equalled the period total. The old bare
`BreakdownRow[]` gave a consumer no way to know that, and the F-3 fix would have papered over it by
making every breakdown *look* uniform. It is now declared: `additivity: 'overlapping'`.
