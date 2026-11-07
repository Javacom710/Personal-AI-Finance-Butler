# Monthly financial reviews

Authorized on 3 November 2026 as the next Phase 9 slice. This PR is stacked on #40. The standing approval also permits the remaining non-scenario Phase 9 features, each in a separate PR. OD-18 still blocks scenarios. All development providers are fake; production generation stays hard-disabled until the owner approves the Phase 8 lineup and a reviewed runtime composition.

## Read and interpretation flow

`monthlyFinancialReview` validates a calendar month, rejects future months, and uses the engine's calendar boundaries. It plans five existing owner-bound tools: cash flow, previous-period comparison, income and expense category summaries, and budget status. All use the selected month's first day. Current-month scope explicitly includes recorded future-dated entries in that month; budget rows retain their own periods. No period or financial amount is calculated by AI.

The shared review runner first makes a normal gated `analyzeFinancialPeriod` tool-calling request before reading. It validates the entire returned batch against the application-owned read plan, including names, exact arguments and unique native call IDs. It then executes only the application-owned arguments and makes a final gated interpretation request. Routing diagnostics are never used as authorization, so a half-open circuit-breaker probe belongs to the real request. It retains the existing finance-question system prompt and frozen tool definitions. Actual tool results are replayed as tool messages. The model cannot add reads: missing/extra/malformed initial reads and unexpected final tool requests, filtering, truncation, malformed sections and oversized replies are rejected without repair or an outer retry loop. Failed individual sources remain unavailable evidence; if all fail, the interpretation request is skipped.

Figures appear only in source panels, with exact tagged decimal values. New review prose is requested in qualitative English, in separately validated Interpretation and Recommendations sections. Obvious numerical claims, digits, currency symbols and percentage syntax in prose are refused. Format/numerical checks do not establish semantic truth; real-model grounding and recommendation quality remain release requirements.

## Presentation and release boundary

The result component separates facts (including source scope, dates, currencies and clipping metadata), deterministic calculations, interpretation and recommendation. Missing values remain unavailable, with their projected reasons, rather than becoming zero. Rendering performs no financial arithmetic or precision conversion. Model/source text is escaped as ordinary React text. Failed sources make the incomplete review explicit.

The authenticated `/ai/reviews/monthly` page is discoverable from AI and shows disabled controls. Its direct server action independently authenticates and returns unavailable without creating an orchestrator or financial read context. There is no environment flag or fake-provider production endpoint. Reviews are in-memory results only; there is no new database schema, transcript storage or financial mutation.

Activation needs an approved measured lineup plus a reviewed composition using the existing runtime kill switch, budget and rate guards before financial data/model use. The injected orchestrator in these feature tests is not a production composition.

## Verification

47 focused unit checks and three PostgreSQL integration checks pass, including real read-dispatcher/engine results through a fake provider into the rendered review; transfers excluded from cash flow; owner isolation; exact decimal precision; null/unavailable metrics; scope validation; unmeasured-route refusal before reads; response bounds; no added tool execution; escaped source/model text; direct-action authentication; and disabled release controls. Typecheck, lint, local Webpack production build and client-secret scan pass. CI uses the ordinary installation/default build on PostgreSQL 17 and 18.

No model order, existing capability requirement, database/tool schema, baseline prompt, scorer or golden suite changed. A separate owner question is pending for a bounded read-only period-summary tool: existing tools cover monthly summaries, while quarterly/yearly aggregation must remain in the deterministic engine.

Additional review-flow validation: **87 AI-boundary source-scan checks pass** alongside the 47 review/assistant unit checks (134 total). The implementation stays inside the existing AI import allowlist; no boundary rule was relaxed.
