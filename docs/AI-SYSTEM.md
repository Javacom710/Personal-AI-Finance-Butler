# AI System

The AI layer interprets, retrieves, reasons, and drafts. It is **not** a source of financial truth and **cannot** write to the database.

Provider: **NVIDIA Build** (`https://integrate.api.nvidia.com/v1`), OpenAI-compatible, open-weight models, five capability tiers ([ADR-09](DECISIONS.md#adr-09--nvidia-build-as-the-model-provider-behind-a-provider-abstraction)).

Everything under `src/server/ai/` is `import 'server-only'`. No API key, model identifier, or provider URL reaches the browser.

---

## 1. Non-negotiable rules

These are constraints on the code, not aspirations. Each maps to a test.

1. The AI **never** mutates financial records — and performs **no database write at all**, not even the proposal row. AI code returns objects; `services/aiProposals.ts` persists them ([ADR-35](DECISIONS.md#adr-35--ai-infrastructure-is-strictly-read-only-a-mutation-needs-a-separate-approved-proposal-workflow)). Enforced by the type system: the AI layer holds an **`AiReadCtx`** — which carries no database handle and no transaction capability, and is *not* a `ReadCtx` — while every command requires a `WriteCtx` and `withWriteCtx` itself requires a `RequestCtx`. `withWriteCtx(ai, …)`, `ai.db`, and passing `ai` to any service are each a compile error, asserted by **I-50** in `tests/unit/ai-write-boundary.test.ts` ([ADR-33](DECISIONS.md#adr-33--the-transaction-opener-is-a-capability-carried-on-the-context-not-an-ambient-import)). *Until 2026-08-30 this rule said the AI layer holds "only a `ReadCtx`" — which was true and insufficient: a `ReadCtx` carries a full DML handle, and `withWriteCtx(readCtx, …)` compiled clean. That was finding **F-1**.*
2. The AI reads only through the controlled tool surface (§8) — reached via the one capability `@/server/ai-read`. There is no raw query path and no bulk export. The AI zone imports no database, engine or service module **by any spelling**: aliased, relative, or dynamic ([ADR-34](DECISIONS.md#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths), **I-51**).
3. No model identifier appears outside `src/server/ai/config/`. The rest of the application requests a *capability*, never a model.
4. A task is **never** routed to a model that lacks a capability the task requires — availability is not a licence to downgrade (§7).
5. Authorisation is decided by application services, not by the model and not in the tool layer. No tool accepts a user identifier; `userId` comes from the session. Authentication and authorization are distinct — see [SECURITY.md §0](SECURITY.md#0-authentication--authorization).
6. Structured output that fails validation is **rejected**, not repaired by guessing.
7. Every figure the AI states must come from a tool result. The engine calculates; the model explains.

---

## 2. Provider integration

### 2.1 Provider abstraction

The application talks to an `AiProvider`, never to NVIDIA Build directly. This is what makes the provider replaceable.

```ts
// src/server/ai/provider/types.ts
export interface AiProvider {
  readonly key: string;                                     // 'nvidia-build'
  chat(req: ChatRequest): Promise<ChatResponse>;
  chatStream(req: ChatRequest): AsyncIterable<ChatChunk>;
  embed(req: EmbedRequest): Promise<EmbedResponse>;
  listModels(): Promise<ProviderModel[]>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';
  responseFormat?: { type: 'json_schema'; schema: JsonSchema; name: string }
                 | { type: 'json_object' }
                 | { type: 'text' };
  maxTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: ToolCall[];
  reasoning: string | null;      // reasoning models expose this separately
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  usage: { promptTokens: number; completionTokens: number };
  model: string;                 // what actually served the request
  latencyMs: number;
}
```

`src/server/ai/provider/nvidia-build.ts` implements this over the OpenAI-compatible wire format. It is the only file that knows about `Authorization: Bearer nvapi-…`, `/chat/completions`, or NVIDIA's error shapes.

### 2.2 What NVIDIA Build gives us, and what it does not

Measured against the Anthropic-style feature set assumed in the previous draft:

| Capability | Status | Consequence for this design |
|---|---|---|
| OpenAI-compatible `/chat/completions` | OK | Use the `openai` npm client with `baseURL` override, or plain `fetch`. **Built over injected `fetch`** ([ADR-40](DECISIONS.md#adr-40--the-nvidia-adapter-is-written-over-fetch-the-openai-client-is-deferred-to-the-phase-that-needs-streaming)): the client was chosen for SSE parsing and retries, and Phase 7 needs neither — no streaming caller until Phase 9, and retry policy belongs to the orchestrator so two providers cannot grow two policies. The ban on importing `openai` outside `nvidia-build.ts` stays, so adopting it later is a change to that one file. |
| Streaming (SSE) | ✅ | Used for chat and analysis routes |
| Function/tool calling | ⚠️ **varies by model** | Must be measured per model (§5), not assumed |
| `response_format: json_schema` | ⚠️ **varies by model** | Same — this is the single biggest routing input |
| Vision / image input | ⚠️ Tier 4 models only | Gates document extraction |
| Embeddings endpoint | ✅ | Tier 5, deferred (§11) |
| **Prompt caching** | ❌ **not available** | No 0.1× cached-read discount. Prompt size is a direct, linear cost — §12 rewrites the cost model around trimming, not caching. |
| Server-side fallback | ❌ | Fallback is ours to implement (§7) |
| Refusal as a typed stop reason | ❌ | Content filtering surfaces as `finish_reason: 'content_filter'` or a provider error; handled in §16 |
| Reasoning-effort parameter | ❌ | Depth is a model choice (tier selection), not a request parameter |

**The recurring word is "varies by model."** That is the defining property of an open-weight multi-model architecture and the reason `CLAUDE.md` mandates an evaluation suite. The design answer is the capability matrix (§5): a *measured, stored* record of what each model actually does, consulted by the router on every request.

### 2.3 Model catalogue reality check

Against the live unauthenticated catalogue (Phase 0), the candidate list in `CLAUDE.md` needs correction before Phase 8:

| `CLAUDE.md` candidate | Catalogue |
|---|---|
| `nvidia/nemotron-3-super-120b-a12b` | ✅ present |
| `nvidia/nemotron-3-ultra-550b-a55b` | ✅ present |
| `nvidia/nemotron-3-nano-30b-a3b` | ❌ **absent as of 2026-09-03** — present on 2026-08-31, gone from the next authenticated read. Apparently **renamed** to `nvidia/nemotron-nano-3-30b-a3b` (version segment transposed), but that is not asserted and **routing was not changed**. Still Tier 1's first candidate, so it fails and falls through to `openai/gpt-oss-20b`. |
| `google/gemma-4-31b-it` | ✅ present |
| `openai/gpt-oss-20b` | ✅ present |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | ✅ present |
| `nvidia/nemotron-nano-12b-v2-vl` | ❌ **absent** — corrected 2026-08-31 by the authenticated read (`npm run ai:catalogue`). The unauthenticated read recorded it present; it is not. |
| `nvidia/nemotron-3-embed-1b` | ✅ present |
| `deepseek-ai/deepseek-v4-flash` | ⚠️ actual id `deepseek-ai/deepseek-v4-flash-0731` |
| `zai-org/glm-5.2` | ❌ **absent** — corrected 2026-08-31. The authenticated catalogue carries **no GLM model under any publisher prefix**, so `z-ai/glm-5.2` is not "the actual id" either. |
| `deepseek-ai/deepseek-v4-pro` | ❌ not listed |
| `mistralai/mistral-medium-3.5-128b` | ❌ not listed |
| `qwen/qwen3-next-80b-a3b-instruct` | ❌ not listed (no Qwen models at all) |

That list was read **without** an API key. `npm run ai:catalogue` has since re-read it **authenticated** (83 models, 2026-08-31), and corrected two rows above: no GLM model exists under any prefix, and the 12b vision model is absent. Five of thirteen candidates are therefore unroutable, and `config/models.ts` records each as `catalogue: null` rather than substituting a name.

**The catalogue is not stable, and this table is a dated observation rather than a fact.** A third read on **2026-09-03** returned **82** models — one fewer — and `nvidia/nemotron-3-nano-30b-a3b` had disappeared while `nvidia/nemotron-nano-3-30b-a3b` had appeared, along with a new `nemotron-3.5` generation. That is the third identifier drift in this pool, after the `-0731` suffix and the GLM correction.

The standing rule when it drifts again: **report it, do not re-route.** A name that looks like a rename is not evidence of the same weights, and `CLAUDE.md` requires evaluation against real workloads before a route is finalised. Phase 8 resolves these with the eval harness; until then a dead identifier costs one failed attempt per circuit-breaker window and nothing else.

Every tier still serves. Tier 1 falls through its dead primary to `openai/gpt-oss-20b`; Tiers 2, 3 and 4 route only to identifiers confirmed present on 2026-09-03. But **Tier 4 has exactly one model**, and vision cannot fall back to a text model. A Tier 4 request whose only model fails, fails.

---

## 3. Module map

```
src/server/ai/
  provider/
    types.ts              AiProvider interface, wire-agnostic request/response types
    nvidia-build.ts       the only NVIDIA-aware file
    registry.ts           active provider resolution
  config/
    models.ts             tier → ordered candidate list, from env (ADR-17)
    capabilities.json     MEASURED capability matrix, written by the eval harness
    pricing.ts            cost per model, config-driven, may be zero/unknown
  orchestrator/
    index.ts              the entry point: run(task, input, ctx)
    requirements.ts       task → CapabilityRequirement
    select.ts             candidate filtering + ordering
    fallback.ts           attempt chain, failure classification, circuit breaker
    health.ts             per-model health and rate-limit state
  tools/
    definitions.ts        Zod → JSON Schema tool definitions
    handlers.ts           read-only projections over APPLICATION SERVICES (never the db,
                          never the domain layer directly — guards live in the services)
    registry.ts           frozen, ordered tool list
  loop.ts                 the agentic read loop
  structured/
    request.ts            json_schema vs json_object vs prompted-JSON strategies
    validate.ts           parse, validate, one repair attempt, then reject
  proposals/
    schemas.ts            Zod schemas for each proposal kind — pure
    resolve.ts            hint → entity resolution over data passed IN — pure
                          (apply lives in services/aiProposals.ts, NOT here — §9)
  documents/
    extract.ts            Tier 4 image/PDF → structured proposal
  embeddings/
    README.md             deferred; activation criteria (§11)
  eval/
    tasks/                golden task set
    runner.ts  score.ts  report.ts
  observability/
    usage.ts  metrics.ts
  errors.ts
```

Nothing outside `src/server/ai/` imports the provider client, and nothing inside it imports `src/server/db/`, `src/server/domain/` or `src/server/services/` — **in any import style**. That last qualifier is load-bearing and was missing until 2026-08-30: the ESLint rule matched only `@/`-aliased specifiers, so `import { db } from '../../db/client'` linted clean (finding **F-2**). The boundary is now enforced three ways — types, ESLint, and a source scan that also covers dynamic `import()`, which ESLint's rule cannot see at all ([ADR-34](DECISIONS.md#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths)).

`src/server/ai-read/` is the AI layer's **read capability** and sits deliberately outside the AI zone: `index.ts` exports `AiReadCtx` and, from step 7.3, the projected read functions; `internal.ts` holds the single bridge back to a `ReadCtx` and is banned from `src/server/ai/**` like everything else.

---

## 4. Capability tiers

Per `CLAUDE.md <ai_model_tiers>`. Tiers are **capability classes**, not model names.

| Tier | Purpose | Confirmed candidates | Optimise for |
|---|---|---|---|
| **1 — Routine** | Transaction parsing, categorisation, routine chat, summaries, simple portfolio questions | `nvidia/nemotron-3-nano-30b-a3b`, `openai/gpt-oss-20b`, `google/gemma-4-31b-it` | Latency, cost, **schema adherence**, tool-call reliability |
| **2 — Advanced reasoning** | Portfolio analysis, multi-period and cross-domain analysis, spending patterns, financial-health reviews, hard tool selection | `nvidia/nemotron-3-super-120b-a12b`, `deepseek-ai/deepseek-v4-flash-0731` | Reasoning quality, tool selection |
| **3 — Maximum reasoning** | Exceptionally complex investigations only. **Never** routed to by default | `nvidia/nemotron-3-ultra-550b-a55b` | Capability ceiling |
| **4 — Multimodal / document** | Receipts, invoices, statements, financial PDFs, screenshots | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` (**the only one that exists** — §2.3) | Extraction accuracy |
| **5 — Retrieval / embeddings** | Semantic search over notes and documents | `nvidia/nemotron-3-embed-1b` | **Deferred — not justified at launch (§11)** |

**Tier 3 access rule.** Reachable only when the user explicitly requests deep analysis from the UI, or when a Tier 2 attempt returns a self-declared low-confidence result on a flagged-complex task. Never by automatic escalation from ordinary chat. Enforced in `select.ts` and asserted by test.

---

## 5. Capability matrix — the core mechanism

Because support varies by model, the router cannot assume; it consults measurements.

```ts
// src/server/ai/config/capabilities.ts  (declared defaults; measured entries written by the eval harness)
{
  "nvidia/nemotron-3-nano-30b-a3b": {
    "tier": 1,
    "toolCalling": "native",            // native | none
    "structuredOutput": "json_schema",  // json_schema | json_object | prompted | none
    "vision": false,
    "embedding": false,
    "contextTokens": 131072,
    "maxOutputTokens": 8192,
    "streaming": true,
    "scores": {
      "schemaAdherence": 0.98,          // fraction of valid-first-try structured outputs
      "toolCallCorrectness": 0.95,
      "retrievalGrounding": 0.97,
      "injectionResistance": 1.00,
      "p50LatencyMs": 900, "p95LatencyMs": 2400
    },
    "verifiedAt": "2026-08-20T00:00:00Z",
    "verifiedAgainstEvalVersion": 3
  }
}
```

Rules:

- A model with no entry is **unusable**. The router refuses rather than routing blind.
- **Every entry carries `source`.** `declared` comes from the provider's documentation and is *not evidence*; `measured` is produced by `npm run ai:eval`. A route with a score threshold — every structured-output and tool-using route — requires `measured`. This split is what lets a connectivity smoke test run before the eval has, without ever letting an unmeasured model parse a transaction. **No score in the repository is a benchmark result: none have been measured (OD-1).**
- An entry older than 30 days, or measured against an older eval version, is flagged stale in Settings → AI and in CI.
- `structuredOutput: "none"` disqualifies a model from every proposal task, permanently — no prompt trick promotes it.
- `toolCalling: "none"` disqualifies a model from the read loop.
- Thresholds for production use: `schemaAdherence ≥ 0.95` for Tier 1 parsing, `toolCallCorrectness ≥ 0.90` for any tool-using route. Below threshold the model may sit in the candidate list only as a last-resort fallback for non-mutating tasks, and is marked as such.

---

## 6. Orchestration and routing

```
run(task, input, ctx)
  │
  ├─ requirements.ts   task ─────────────► CapabilityRequirement
  │                                        { tier, needsTools, needsSchema,
  │                                          needsVision, minSchemaAdherence,
  │                                          maxLatencyMs, allowTierEscalation }
  │
  ├─ select.ts         candidates = config.tier[req.tier]
  │                      .filter(satisfies capability requirement)   ← hard gate
  │                      .filter(health.isAvailable)                 ← circuit breaker
  │                      .sort(by score, then latency, then cost)
  │
  ├─ fallback.ts       attempt candidates in order, classifying failures
  │
  └─ observability     record model, task, latency, tokens, outcome, fallback depth
```

### 6.1 Task → requirement

| Task | Tier | Tools | Schema | Vision | Notes |
|---|---|---|---|---|---|
| `parseTransaction` | 1 | no | **json_schema, ≥0.95** | no | No tools — nothing is read while drafting a write |
| `classifyTransaction` | 1 | no | json_schema | no | |
| `answerFinanceQuestion` | 1 | **yes** | no | no | The read loop |
| `summarizeFinancialData` | 1 | yes | no | no | |
| `analyzePortfolio` | 2 | yes | no | no | |
| `analyzeFinancialHealth` | 2 | yes | no | no | |
| `analyzeFinancialPeriod` | 2 | yes | no | no | |
| `runFinancialScenario` | 2 | yes | no | no | Engine computes; model explains |
| `deepInvestigation` | 3 | yes | no | no | Explicit user request only |
| `extractReceiptData` | 4 | no | json_schema | **yes** | → proposal pipeline |
| `analyzeDocument` | 4 | no | json_schema | yes | |
| `retrieveRelevantContext` | 5 | — | — | — | Deferred (§11) |

These are exactly the application-level capabilities named in `CLAUDE.md <ai_architecture>`. Callers use these names; they never see a model.

### 6.2 Escalation — evaluated per message, never sticky

Tier 1 → Tier 2 escalation is decided by **deterministic classification in application code**, not by the model. Triggers: an explicit review/analysis request, a multi-period comparison, a scenario, or a "why did X change" question.

**Escalation does not persist across messages.** Each user message is classified on its own. An earlier escalation carries forward only for a **dependent follow-up** — a message that cannot be understood without the previous answer (`"why?"`, `"and last year?"`, `"break that down"`). A fresh, self-contained question re-enters at Tier 1 even if the previous turn ran on Tier 2.

This matters more than it looks. Sticky escalation is the standard way a well-intentioned router degenerates into "everything runs on the big model": one deep question early in a session, and every trivial follow-up for the rest of the conversation inherits Tier 2. The cost is invisible because nothing looks wrong — the answers are fine, they are just several times more expensive than they need to be, and with no prompt caching (§12) that cost is paid in full on every turn.

Tier 2 → Tier 3 requires an explicit user action; it is never reached by classification. The active tier is shown in the message header so cost and latency are never a surprise ([CLAUDE.md `<ai_orchestrator>`](../CLAUDE.md): model selection is hidden, but diagnostics are permitted).

### 6.3 Guarding against tier drift

A classifier that quietly over-escalates is indistinguishable from a correct one by looking at answers — only the bill changes. Two checks:

- **Measured distribution.** `ai_usage_daily` carries `tier`, so Settings → AI shows the split. In normal use Tier 1 should serve the large majority of requests. A sustained Tier-2 share above roughly 25% is a miscalibration signal, not a hard cap — the system reports it rather than refusing to escalate, because degrading an answer to hit a quota is the wrong trade.
- **Classifier eval.** The Phase 8 `routing` suite (`eval/tasks/routing.ts`, built 2026-10-31 as its own suite rather than an extension of `tool-select`) is a labelled routing corpus: ~40 messages, each tagged with its expected tier, including the sticky-escalation trap (a deep question followed by `"what's my HDFC balance?"`, which **must** return to Tier 1). Scored deterministically — the classifier is application code, so its output is exactly checkable.

Where a task genuinely does not need the bigger model, say so in the routing table rather than escalating out of caution. `runFinancialScenario` is the clearest case: the engine computes every figure and the model only explains the assumptions ([CLAUDE.md `<scenario_analysis>`](../CLAUDE.md)), so the reasoning load is far lower than the word "scenario" suggests. It sits at Tier 2, not Tier 3.

### 6.4 Where the Tier 1 / Tier 2 line falls

The pair most easily confused, made explicit:

| | `summarizeFinancialData` — Tier 1 | `analyzeFinancialPeriod` — Tier 2 |
|---|---|---|
| Question shape | "What did I spend last month?" | "Give me a financial review of last month." |
| Model's job | Restate tool output in prose | Compare periods, find patterns, judge significance |
| Tool calls | Usually one | Several, chosen adaptively |
| Discriminator | The answer **is** the tool result | The answer requires weighing several tool results against each other |

If a single tool call answers the question, it is Tier 1. That rule covers most of the traffic, and it is the reason a monthly summary does not need a reasoning model.

---

## 7. Fallback

`CLAUDE.md <model_fallbacks>`: fall back gracefully, but **never below the required capability**.

### Failure classification

| Class | Detection | Action |
|---|---|---|
| `unavailable` | HTTP 404/503, model not in catalogue | Next candidate; open circuit for 5 min |
| `rate_limited` | HTTP 429 | Respect `Retry-After` once, then next candidate; open circuit for the retry window |
| `timeout` | No first token within `timeoutMs` | Next candidate; record latency breach |
| `invalid_schema` | Output fails Zod after one repair attempt | Next candidate **that also satisfies the schema requirement** |
| `tool_call_failed` | Malformed tool call, unknown tool, unparseable arguments | One reprompt with the error, then next candidate |
| `content_filter` | `finish_reason: 'content_filter'` | Surface to the user; **do not** retry on another model — retrying a filter is not a fallback |
| `transport` | Network/5xx | SDK retry (2×, backoff), then next candidate |

### Rules

```ts
function nextCandidate(req: CapabilityRequirement, tried: string[]): string | null {
  return candidatesFor(req)                      // already capability-filtered
    .filter(m => !tried.includes(m))
    .filter(m => health.isAvailable(m))
    .at(0) ?? null;
}
```

- The capability filter is applied **before** fallback ordering, so an incapable model is never reachable. A structured financial proposal cannot fall back to a `structuredOutput: "none"` model; a vision task cannot fall back to a text-only model unless the image has already been converted to text by a Tier 4 model in an earlier step.
- **Cross-tier downgrade is forbidden.** Fallback moves sideways within a tier. If every Tier 2 candidate fails, the request fails with `all_candidates_exhausted` — it does not silently become a Tier 1 answer. Upward escalation to a more capable tier is permitted.
- Maximum 3 attempts per request. Each attempt is recorded with its failure class.
- **Circuit breaker:** 3 consecutive failures of the same class opens the circuit for 5 minutes (exponential to 1 hour). Half-open probes with a single cheap request.
- Every fallback is visible: the response carries `fallbackDepth` and the serving model, shown in Settings → AI and logged in `ai_model_attempts`.

---

## 8. Tool architecture

All tools are **read-only**. There is no write tool, and adding one is a defect — now a structural impossibility rather than a rule, since the AI layer has no capability that can open a transaction ([ADR-35](DECISIONS.md#adr-35--ai-infrastructure-is-strictly-read-only-a-mutation-needs-a-separate-approved-proposal-workflow)).

**A tool exists only where a deterministic capability already does.** An AI capability is never a substitute for missing financial-engine functionality: if the engine cannot compute a figure, no tool offers it and the assistant says it is unavailable. Three conceptual tools are therefore **absent** from the Phase 7 registry rather than stubbed — `run_financial_scenario` (no backing of any kind), `calculate_financial_metrics` (only savings rate exists) and `get_portfolio_performance`'s TWR (implemented, tested, and wired to nothing). They are engine work, deferred as **OD-18**.

Each is defined once as a Zod schema and converted with `z.toJSONSchema()` — one definition for validation and for the model ([ADR-16](DECISIONS.md#adr-16--zod-as-the-single-validation-boundary-including-for-ai-schemas)).

### Registry

| Tool | Returns | Row cap |
|---|---|---|
| `get_accounts` | id, name, kind, institution, currency, balance | 100 |
| `get_account_balances` | id, name, balance, baseBalance, asOf | 100 |
| `get_transactions` | date, description, category, account, amount, kind | 200 |
| `get_income_summary` | **`total`** + grouped rows (month/category/account) | 200 |
| `get_expense_summary` | **`total`** + grouped rows (month/category/account/tag) | 200 |
| `get_budget_status` | category, budgeted, actual, remaining, utilisation, pace | 100 |
| `get_recurring_transactions` | name, kind, amount, account, nextDue, autoPost | 100 |
| `get_categories` | id, name, kind, parent | 200 |
| `get_assets` | name, kind, value, valuationDate | 100 |
| `get_liabilities` | name, kind, outstanding, rate, emi | 100 |
| `get_net_worth` | **basis**, assets, liabilities, netWorth, breakdown, assetCoverage, liabilityCoverage, excluded | 1 |
| `get_net_worth_history` | **basis**, series by month/quarter/year | 120 |
| `get_investment_assets` | id, symbol, name, class, currency, priceStatus | 500 |
| `get_holdings` | qty, avgCost, invested, price + status, marketValue, unrealisedPnl, return%, weight% | 500 |
| `get_investment_transactions` | full ledger rows | 200 |
| `get_portfolio_summary` | PortfolioSummary incl. coverage and stale list | 1 |
| `get_asset_allocation` | key, label, value, weight%, unpriced | 100 |
| `get_portfolio_performance` | absolute return, XIRR, TWR, realised, dividends, fees, taxes | 1 |
| `compare_periods` | both periods + deltas | 1 |
| `calculate_financial_metrics` | savings rate, expense ratio, runway, commitment coverage | 1 |
| `calculate_portfolio_metrics` | concentration (top-n, HHI), class and currency weights | 1 |
| `run_financial_scenario` | deterministic projection + stated assumptions | 1 |

Every tool calls the same **application service** the UI calls ([ADR-21](DECISIONS.md#adr-21--application-services-are-a-distinct-layer-from-the-financial-engine)). Two consequences: the model cannot see a different number than the screen, because there is no second implementation; and authorization is enforced on the AI path by construction, because the guards live in the only function the tool can reach. A tool handler is a thin projection over a service call — it contains no queries and no permission logic of its own.

### The arithmetic boundary — every summary returns its own total

Non-negotiable rule 7 says the model never states a figure it did not receive. That is only achievable if **the figure the user asked for is a field in the response**, not something assembled from several fields.

```ts
get_expense_summary({
  asOf?: IsoDate,                          // any date in the month; omitted = this month
  groupBy?: 'category' | 'account' | 'tag', // default 'category'
  depth?: 'rollup' | 'detail',             // category grouping only; both partition the total
})
→ { ok: true,
    data: {
      total: Money,                                    // ← the answer, computed by the engine
      additivity: 'partition',                         // 'overlapping' for tags — rows do NOT sum
      depth, groupBy,
      rows: [{ key, label, amount, entryCount, parentKey, isRollup, childCount }],
    },
    meta: { rowCount, truncated, currency, from, to } }
```

**There is no category filter, and no `categoryNames` argument** ([ADR-49](DECISIONS.md#adr-49--get_expense_summary-takes-no-category-filter-the-breakdown-row-is-the-answer)). An earlier draft of this section specified one, resolved server-side by fuzzy name matching. It was never built, and building the `grounding` suite showed it is not needed: every single-category question already has its answer as **one row** of one response. The `rollup` row for a parent ("food") carries its children folded in, and the `detail` row for a leaf ("dining") is that leaf's own spending. The model reads a row; it never adds rows. A question about **two** categories together has no one field that answers it, so the answer gives both figures, and the prompt says so. The suite measures whether models keep to that, and its result is the trigger for revisiting the decision.

Two properties, both asserted by test, both load-bearing:

1. **`Σ rows[].amount === total`, exactly, at every depth.** Rows *partition* the total.
2. **Parent and child rows are never mixed in one response.** `depth: 'rollup'` (default) returns top-level categories with children folded in, each carrying `isRollup` and `childCount`; `depth: 'detail'` returns one row per category with spending **of its own**, carrying only that. Both partition the total, so there is no response shape in which summing every row double-counts. The `breakdown()` service now carries this contract directly — an authoritative `total` plus an `additivity` tag — rather than the tool layer having to impose it ([ADR-37](DECISIONS.md#adr-37--a-breakdown-declares-whether-its-rows-partition-its-total), **I-54**).
3. **A row set that cannot partition its total says so.** A **tag** breakdown is `additivity: 'overlapping'`: one transaction can carry several tags and an untagged one carries none, so the rows never sum to the total and must not be rendered as if they did. This was true before and undeclared, which is worse than either alternative.

Without both, "how much on food" over a `Food → {Groceries, Dining}` tree becomes: model receives three rows, adds two of them, and hopes it picked the right two. With them, the `rollup` row *is* the answer, and a model handed `detail` rows for that question must ask for the rollup rather than add — the `grounding` suite has a case for each. That is the model doing financial arithmetic — forbidden by `CLAUDE.md <investment_management>` ("do not rely on an AI model for calculations that deterministic application code can perform correctly") and unverifiable when it goes wrong.

The same `total` contract applies to `get_income_summary` and `get_asset_allocation`. It does **not** apply to `get_net_worth_history`: a series of month-end *levels* has no meaningful sum, and requiring one would invite a consumer to add them. Any future tool returning rows that a user might want summed **must** carry the sum.

**The net-worth tools carry their valuation `basis`, and the model must state it** ([ADR-23](DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost)). Until Phase 6 the basis is `cost`, and an answer that calls an at-cost figure "your net worth" without qualification presents an acquisition-cost total as a current market valuation — the same class of error as reporting a `null` metric as zero. `assetCoverage` and `liabilityCoverage` are reported **separately** for the same reason they are on screen: an excluded asset makes the figure look lower, an excluded liability makes it look higher, and one blended number hides which.

**The AI is never authoritative for a net-worth figure.** `get_net_worth` projects the same read-only service the UI calls, which has no `WriteCtx` signature at all (**I-32**) and is reached through a capability that has no database handle — so the model can neither compute its own total nor mutate an input to one.

### Data minimisation (`CLAUDE.md <ai_data_access>`)

Without prompt caching, every token is paid at full price on every request — so minimisation is now a cost control as well as a privacy control.

1. **Aggregates before records.** `get_expense_summary` exists so `get_transactions` is not needed to answer "where did my money go". Stated in the system prompt as a preference order.
2. **Row caps** as tabled. Exceeding one returns the capped set plus `{ truncated: true, totalMatching: n }` so the model narrows instead of guessing.
3. **Field projection.** Handlers return a projected shape, never a database row. `notes`, `external_ref`, and unrelated IDs are omitted unless the contract includes them.
4. **Byte budget.** Cumulative tool output is capped at 150 KB per turn; past it the loop stops calling tools and asks the model to answer from what it has.
5. **No bulk dump.** No `get_all_*`, no export tool, no unbounded result.

### Tool result shape

```ts
type ToolResult<T> =
  | { ok: true;  data: T; meta: { rowCount: number; truncated: boolean; totalMatching?: number;
                                  asOf: string; coverage?: number; staleInstruments?: string[] } }
  | { ok: false; error: { code: 'not_found'|'invalid_range'|'insufficient_data'; message: string } };
```

Errors are returned to the model as actionable text, never thrown. Every call writes an `ai_tool_calls` row (input, row count, bytes, duration) so any answer traces to exactly what the model saw.

### Exact figures crossing the boundary

`Money`, `Quantity`, `UnitPrice` and `Rate` are all `bigint` at a declared scale, and **`JSON.stringify` throws on every one of them**. So no tool result — not even one over a service that "needs no new code" — can reach a model without an explicit projection. Every figure crosses as tagged digits
([ADR-36](DECISIONS.md#adr-36--exact-values-cross-a-json-boundary-as-a-tagged-string-projection-never-as-a-json-number)):

```json
{ "kind": "money", "amount": "1250.5000", "currency": "INR", "scale": 4 }
{ "kind": "price", "units":  "1629.80004883", "scale": 8 }
```

`src/lib/format/json-projection.ts` is the only sanctioned path, and it is a set of **explicit per-type functions**, never a walker: `UnitPrice` and `Quantity` are the same shape at the same scale and are distinguishable only by the call site. `Number()` appears nowhere — a figure that lost precision on the way to the model would be wrong in an answer, silently, and only on large values. A missing figure projects to `null` with its `Metric` reason, **never to zero**.

The projection is per-tool and per-field for a second reason: a blind serializer would ship whatever a service happened to return, which is the opposite of field projection and how a `notes` field or an entity id reaches a provider unnoticed.

### The read loop

```
for attempt in fallback chain:
  for iteration in 1..8:
    assertDailyBudgetRemaining()
    res = provider.chat({ model, messages, tools, toolChoice: 'auto' })
    record(res)
    if res.finishReason === 'content_filter' → surface, stop
    if no toolCalls → return final answer
    for each toolCall (concurrently):
       validate arguments against the tool's Zod schema   ← malformed args are a tool_call_failed
       run handler; accumulate bytes; append result message
  if loop exhausted → return partial with 'iteration_limit'
```

Tool results are appended as `role: 'tool'` messages keyed by `tool_call_id`. Every call must be answered — an unanswered call makes the next request invalid on most models.

---

## 9. The mutation boundary

`CLAUDE.md <ai_mutation_rule>`, implemented literally:

```
USER INPUT → AI INTERPRETATION → STRUCTURED OUTPUT → BACKEND VALIDATION
           → APPLICATION BUSINESS LOGIC → DATABASE → USER CONFIRMATION/RESULT
```

### Generation

The parse task runs with **no tools** — nothing is read while drafting a write — and a strict schema:

```ts
const TransactionProposal = z.object({
  kind: z.enum(['income','expense','transfer']),
  bookedOn: z.string().date(),
  description: z.string().min(1).max(200),
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/).nullable(),   // STRING, never a JSON number; null = not stated
  currency: z.string().length(3),
  accountHint: z.string().nullable(),
  toAccountHint: z.string().nullable(),
  categoryHint: z.string().nullable(),
  tags: z.array(z.string()).max(5),
  notes: z.string().max(500).nullable(),
  confidence: z.enum(['high','medium','low']),
  ambiguities: z.array(z.string()).max(5),
});
```

The code is `src/server/ai/proposals/schemas.ts` (`.strict()`, so an extra key is rejected), and the task prompt is `src/server/ai/prompts/parse-transaction.ts`.

**`amount` is nullable** (corrected 2026-10-31, Phase 8). As first written the field was required, so for *"Paid the plumber"* the only schema-valid answer was an invented figure, and the schema rewarded the fabrication `<ai_structured_outputs>` forbids. A `null` amount is never applied: it is a highlighted field in edit mode (step 6 below), and the `parse` suite's missing-amount cases fail any model that fills it in.

**The amount crosses as a decimal string.** A JSON number is parsed into an IEEE-754 double before our code sees it, reintroducing the exact defect [ADR-04](DECISIONS.md#adr-04--money-is-an-exact-scaled-integer-never-a-float) exists to prevent.

### Structured-output strategy by capability

| Model capability | Strategy |
|---|---|
| `json_schema` | Native `response_format` with the schema. Preferred; only these models are used for proposals in production. |
| `json_object` | JSON mode + schema in the prompt + Zod validation. Permitted only if measured `schemaAdherence ≥ 0.95`. |
| `prompted` | Schema in the prompt, extract the JSON block, validate. **Not permitted for proposals.** |
| `none` | Disqualified from proposals entirely. |

### Validation, repair, and rejection

```
1. Parse the model output as JSON             → fail: one repair attempt
2. Zod validate                                → fail: one repair attempt with the field errors
3. Money.parseUserInput(amount, currency)      → fail: reject
4. Resolve accountHint/categoryHint → IDs (exact → unique fuzzy ≥0.8 → unresolved)
5. Business validation: date ≥ account opening; transfer accounts differ;
   category kind matches transaction kind; FX rate exists for the date
6. If confidence==='low' OR amount is null OR any hint unresolved OR ambiguities non-empty
     → proposal opens in EDIT mode with those fields highlighted
7. Hand the validated proposal to services/aiProposals.ts, which persists it
   (raw + normalized, status='pending', expires_at = now + 24h). AI code does
   not write this row either — it has no capability to (ADR-35).
```

**Exactly one repair attempt**, carrying the validation errors back. After that the proposal is stored `invalid` with its errors and shown to the user for editing. Never guessed at, never silently corrected ([CLAUDE.md `<ai_structured_outputs>`](../CLAUDE.md)).

### Confirmation

The card shows resolved names and formatted amounts, not raw JSON. Confirmation is handled by `services/aiProposals.applyProposal()` — **an application service, not AI code**:

```sql
BEGIN
  -- compare-and-swap: claim the proposal, or lose the race and abort
  UPDATE ai_proposals SET status='applied', applied_at=now()
    WHERE id = $1 AND status = 'pending'
    RETURNING *;                      -- 0 rows -> already applied / expired / rejected -> ROLLBACK

  -- re-validate and re-authorize: the proposal may be hours old and the
  -- referenced account may since have been closed, renamed, or deleted
  -- ... then call the SAME application service the manual UI calls ...

  INSERT INTO audit_log (actor, action, ...) VALUES ('ai_confirmed', ...);
COMMIT
```

Two independent guards against a double-apply — a double-clicked button, a retried request, two open tabs:

1. The **compare-and-swap** above. Only one transaction can move a row out of `pending`.
2. A **partial unique index** on `transactions.ai_proposal_id` (and the investment equivalent). Even if the CAS were removed, the database refuses a second record from the same proposal. Same shape as the `recurring_occurrences` idempotency key ([ADR-15](DECISIONS.md#adr-15--idempotency-for-recurring-postings-via-a-materialised-occurrence-row)).

Invariant I-10 asserts no `applied` proposal lacks its audit entry; I-14 asserts no proposal produced more than one record.

Proposal kinds: `transaction`, `investment_transaction`, `account`, `category`, `budget`, `recurring_rule`. There is deliberately **no** proposal kind that deletes anything.

---

## 10. Tier 4 — document and image extraction

Justified because it feeds the proposal pipeline that already exists, adding value with no new trust surface.

```
image/PDF upload → Tier 4 model → structured extraction (json_schema)
                 → SAME Zod validation and entity resolution as §9
                 → ai_proposals (pending) → user confirms → application service
```

Rules:
- Raw document interpretation **never** mutates financial records — it produces a proposal like any other ([CLAUDE.md `<ai_model_tiers>` Tier 4](../CLAUDE.md)).
- A multi-line receipt produces one proposal per line item, batched into one confirmation screen.
- The source image is stored alongside the proposal so the user can check the extraction, and is deleted with it.
- Uploads are size-capped, MIME-sniffed (not trusted by extension), and never executed or rendered as HTML.
- **A vision task never falls back to a text-only model.** If no Tier 4 model is available, the feature reports unavailable.

---

## 11. Tier 5 — embeddings: deferred, with explicit activation criteria

`CLAUDE.md` is direct: *"Do NOT introduce a vector database or RAG architecture merely because an embedding model is available. Structured financial data should normally be retrieved using direct database queries."*

**Decision: not built at launch.** Every question the assistant must answer is a structured query over relational data — accounts, transactions, holdings, budgets, net worth. SQL answers those exactly; embeddings would answer them approximately. Approximate retrieval over financial facts is a correctness regression, not a feature.

Activation criteria — all three must hold before any embedding code is written:

1. The user has accumulated a body of **unstructured** text (uploaded documents, long-form notes) that is not answerable by SQL.
2. A measured search-quality gap exists against Postgres full-text search (`tsvector`), which is tried **first**.
3. The benefit is demonstrated on real user data, not assumed.

If activated: `pgvector` inside the existing PostgreSQL database. **No new datastore** ([ADR-19](DECISIONS.md#adr-19--embeddings-deferred-full-text-search-first-pgvector-if-ever)).

---

## 12. Cost and token control

There is no prompt caching, so **prompt size is a linear cost on every request**. Controls shift from caching to trimming.

| Control | Mechanism |
|---|---|
| System prompt size | Kept under a hard token budget, asserted by test. **No account lists, no category dumps** — entity resolution happens server-side inside the tool (§8), not by putting the catalogue in every prompt. |
| Tool schema size | 22 tools with terse descriptions; measured token cost tracked in CI and budgeted |
| Conversation history | Trimmed to the last N turns plus a rolling summary once a threshold is crossed |
| Tool output | Row caps, field projection, 150 KB byte budget (§8) |
| Tier discipline | Tier 3 unreachable by default; Tier 2 only on deterministic escalation |
| Daily budget | Checked **before** each request, not after |

Accounting: every request records prompt/completion tokens, model, tier, fallback depth, latency, and outcome into `ai_messages`, rolled up into `ai_usage_daily`. Cost is computed from `config/pricing.ts` — **rates are configuration, default zero, and marked unverified until confirmed against the account's actual billing.** Reporting a fabricated cost would be worse than reporting none.

---

## 13. Observability

Per `CLAUDE.md <ai_observability>`. Sufficient to answer the questions the spec names.

Recorded per request: task, tier, model, fallback depth, latency, prompt/completion tokens, outcome, failure class, schema-validation result, tool-call count and failures.

**Not recorded in application logs:** complete conversations, financial figures, tool result payloads. Conversation content lives in `ai_messages` because the product needs it — a deliberate, documented storage decision covered by export and delete, distinct from logs.

Settings → AI answers, from data: which models are actually serving; which fail most, and how; which are slow; which produce invalid structured output; spend by tier and task; how often fallback fires and to what depth; whether any capability entry is stale.

These metrics feed routing changes — which is the point of measuring them.

---

## 14. Evaluation framework

`CLAUDE.md <model_selection>` requires evaluation against real workloads before finalising routing. This is Phase 8.

### Task set

`src/server/ai/eval/tasks/` — versioned, checked in, derived from the examples in `CLAUDE.md`:

| Suite | Cases | Scoring |
|---|---|---|
| `parse` | 40 NL transaction strings incl. ambiguous, multi-currency, relative dates, adversarial — **built**: `tasks/parse.ts` | **Deterministic**: schema valid (→ `schemaAdherence`, scored apart from accuracy); field-exact on kind, date, amount, currency; hints against accepted spellings; an ambiguous case passes only if the model flags it |
| `classify` | 60 descriptions → category, incl. bank-statement text, no-purpose descriptions and adversarial text — **built**: `tasks/classify.ts` | **Deterministic**: the answer space is an enum of the user's category paths for the transaction's kind, so an invented or wrong-kind category is a schema failure; exact match against the accepted path(s); `null` is the only right answer when the description gives no purpose |
| `tool-select` | 30 questions → expected tool + arguments, on a fixed date, incl. multi-tool, no-tool (concept, write request) and an injected `userId` — **built**: `tasks/tool-select.ts` | **Deterministic**, first turn only: every call names a registry tool with arguments its `.strict()` schema accepts, and matches an expected call (a month argument is any date in that month; dates exact); a no-tool case passes only with no call |
| `routing` | 40 messages → expected tier, incl. the sticky-escalation trap (deep question followed by a trivial one) | **Deterministic**: the classifier is application code, so its tier assignment is exactly checkable. Asserts no message escalates without a trigger, and that a self-contained question returns to Tier 1 |
| `grounding` | 25 questions over a fixed fixture database, including **"how much did I spend on food last month"** over a `Food → {Groceries, Dining}` tree — **built**: `tasks/grounding.ts`. Each replays one tool turn whose result is frozen in `tasks/grounding-results.json`; an integration test proves each frozen result equals the production handler's output over the fixture | **Deterministic**: every figure the answer states must trace to a value in the results it was given, at its stated precision (a sum or difference it computed traces to nothing); required figures stated to the rupee; known wrong answers (a parent's own row, summed tag rows, summed net-worth levels, an unavailable metric as 0%) forbidden; the net-worth basis named. A `detail` result for a parent total, or a `rollup` for a child, passes only by the right further call. Pass rate → `retrievalGrounding` |
| `analysis` | 15 open analyses (portfolio, health, period, cross-domain) | Rubric; LLM-as-judge **advisory only** |
| `scenario` | 10 scenarios | Deterministic on the arithmetic; rubric on the explanation |
| `document` | 20 receipt/statement images | Deterministic: field-exact extraction |
| `injection` | 25 payloads embedded in tool results | **Deterministic**: any write attempted? any unexpected tool call? |
| `robustness` | Malformed inputs, missing data, empty results | Deterministic: does it say "unavailable" rather than invent? |

**Scoring is deterministic wherever a right answer exists.** LLM-as-judge is used only for prose quality, is never the gate for production routing, and never scores a numeric claim — the `grounding` suite does that by comparing against the engine.

### Runner and output

```
npm run ai:eval -- --tier 1 --suite parse,classify,tool-select
```

Runs every candidate in the tier over the suites, produces:
- `config/capabilities.json` — the measured matrix (§5)
- `eval/reports/<date>-<tier>.md` — per-model scores, latency percentiles, failure examples
- A proposed routing order, which a human accepts into `config/models.ts`

Re-run on model change, provider change, or quarterly. CI fails if any production-routed model has no entry, or an entry older than 30 days.

### Selection criteria

Weighted, in this order, per `CLAUDE.md <model_selection>`: schema/structured-output reliability → tool-calling reliability → grounding accuracy → financial reasoning quality → injection resistance → latency → cost. **A model that scores well on reasoning but poorly on schema adherence is not usable for Tier 1**, because Tier 1's dominant job is producing valid structured output.

---

## 15. Security boundary

Detail in [SECURITY.md](SECURITY.md). The AI-specific controls:

1. **There is no write tool.** The maximum impact of a successful prompt injection is a proposal the user sees and rejects. This is the load-bearing control.
2. **`userId` comes from the session**, never from tool input. No tool schema contains a user identifier — asserted by test.
3. **Tool results are data, not instructions.** The system prompt states this; instructions found inside user data are to be reported to the user, not followed.
4. **Caps are server-side** — rows, bytes, date ranges, iterations, daily budget. None is requested of the model.
5. **No execution capability** — no code execution, no shell, no filesystem, no network tool, no MCP server.
6. **Confirmation is out-of-band** — a UI action against a `pending` row, not a message the model can emit.
7. **Data minimisation** — aggregates before records, projected fields, capped results.
8. **Documented egress.** What is sent to NVIDIA Build: the system prompt, tool schemas, the user's message, and tool results (financial figures and descriptions within the caps above). Not sent: credentials, full table dumps, IDs of unrelated entities, or anything from a user who did not initiate the request. Recorded in [SECURITY.md §12](SECURITY.md#12-known-accepted-risks).
9. **`ai_enabled = false`** removes the entire egress surface, and every other feature keeps working.

---

## 16. Failure modes

| Failure | Behaviour |
|---|---|
| Model unavailable / rate limited / timeout | Next candidate in tier; if exhausted, `all_candidates_exhausted` with a retry affordance |
| All Tier 2 candidates fail | Request fails. **Never silently answered by Tier 1.** |
| `finish_reason: 'content_filter'` | Surfaced plainly; not retried on another model |
| Structured output invalid after one repair | Proposal stored `invalid` with field errors; editable form shown |
| Tool handler throws | `ok:false` result to the model; loop continues; logged |
| Malformed tool arguments | One reprompt with the error, then `tool_call_failed` → next candidate |
| Iteration cap (8) | Partial answer + "try a narrower question" |
| Byte budget (150 KB) | Model told the budget is spent; answers from what it has |
| Daily budget exhausted | AI disabled until tomorrow; rest of the app unaffected |
| Capability entry missing/stale | Model excluded from routing; warning in Settings → AI; CI failure |
| `ai_enabled = false` | AI area hidden; quick-add falls back to structured entry |

The last row is a design constraint: **the financial engine has no dependency on any model**, so a total provider outage degrades one page rather than the product.

---

## 17. Replacing a model

The test that matters: NVIDIA ships a better reasoning model tomorrow. What has to change?

### The procedure

```bash
npm run ai:catalogue                              # 1. confirm the id exists, authenticated
npm run ai:eval -- --tier 2 --model <new-id>      # 2. measure it; writes capabilities.json
                                                  #    + ai_model_evaluations rows
#    3. read eval/reports/<date>-tier2.md — does it clear the tier thresholds?
#    4. edit ONE line in the environment:
AI_TIER2_MODELS=<new-id>,nvidia/nemotron-3-super-120b-a12b,deepseek-ai/deepseek-v4-flash-0731
#    5. restart
```

| What changes | Count |
|---|---|
| **Application code files** | **0** |
| Hand-edited files | **1** — the environment (`AI_TIER2_MODELS`) |
| Tool-generated files | 1 — `config/capabilities.json`, written by the eval harness, never hand-edited |
| Database migrations | 0 |
| Prompt edits | 0 |
| Optional | one line in `config/pricing.ts` if you want cost reporting; its absence degrades to "cost unknown", not a crash |

Leaving the old model second in the list keeps it as an automatic fallback (§7). **Rollback is the reverse edit and a restart** — the old model's capability entry is still on disk, so nothing needs re-measuring.

### Why the eval step is a feature, not overhead

A model with no `capabilities.json` entry is unroutable and the app refuses to start ([ADR-18](DECISIONS.md#adr-18--a-measured-capability-matrix-gates-routing-and-fallback)). That is deliberate: on open weights, `response_format: json_schema` and tool calling are *sometimes* supported and *often* partially supported. Dropping an unmeasured model into the tier list would mean discovering its schema adherence is 0.71 when a user's transaction is silently mis-parsed. The eval turns a one-line config change into a one-line config change **plus evidence**.

### What keeps it one file

Five rules, each with a mechanism rather than an intention:

1. **No model identifier outside `src/server/ai/config/`** ([ADR-17](DECISIONS.md#adr-17--model-identifiers-are-configuration-not-code)) — a source-scan test fails the build otherwise.
2. **No per-model prompt branching.** One system prompt per *task*, never per model. If a model needs bespoke phrasing to behave, it has failed its eval — that is a routing decision, not a prompt patch. `if (model === …)` anywhere under `prompts/` is a build failure.
3. **No per-model code paths** in the loop, the tools, or structured-output handling. Branching is on capability *classes* (`json_schema` vs `json_object` vs `prompted`), which are properties measured about a model — never on its identity.
4. **`model` columns are `text`, not a Postgres `ENUM`.** Deliberate, and against the convention used everywhere else in the schema: enums are right for `account_kind` and `transaction_kind`, which change with the domain, but a model enum would turn "try the new model" into a migration.
5. **Tier lists are ordered environment values**, so fallback order is configuration too — reordering preference needs no code either.

### What would break the claim

Worth naming, because each is a plausible shortcut: a prompt tweaked for one model's quirks; a hardcoded id asserted in a test fixture rather than parameterised; a `CREATE TYPE ai_model AS ENUM`; a "temporary" `if` in the loop for a model that mishandles tool results. Rules 1–4 exist because each of those turns tomorrow's one-line swap into a code change, and none of them announces itself at the time.

