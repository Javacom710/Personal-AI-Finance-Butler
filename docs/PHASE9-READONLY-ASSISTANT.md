# Phase 9 read-only financial assistant: first slice

The owner authorized this work on 3 November 2026 while OpenRouter funding delayed Phase 8. It is separate from transaction proposals in PR #39 and builds on main after PR #38. Tests use fake providers only. No provider configuration, model order, capability gate, existing prompt, scorer or evaluation suite changes.

## Implemented boundary

`answerReadOnlyQuestion` receives an already bound `AiReadCtx` and an injected orchestrator. It reuses the production finance-question prompt, capability and read-only tool registry. User identity is never a tool argument. The existing dispatcher validates names and strict arguments before invoking an owner-bound application-service projection; model text cannot obtain a write context. Financial facts use the same services as the UI.

A question has at most four model turns, eight dispatched calls and 64 KiB of accumulated tool outcomes. The last turn must answer without another read. Entire oversized batches and duplicate/empty call identifiers are refused before dispatch. Tool failures return as generic data for bounded follow-up. Empty, incomplete or excessively long final answers are refused. There is no outer retry loop or payload logging.

The answer view renders model prose as **Interpretation**, separately from source facts and deterministic calculations. It preserves exact decimal projections, null/unavailable reasons, dates, currencies and clipping metadata. It escapes all text. It performs no financial arithmetic and never substitutes zero for missing data. No scenario engine or tool is introduced.

## Release boundary and unfinished scope

The `/ai` controls are disabled. `askFinanceQuestionAction` authenticates direct calls and returns unavailable without importing a runtime or financial service. A key or environment flag cannot enable the feature. There is no fake-provider production route. The answer component is exercised by tests and is not populated with fake financial data on the production page.

This is the bounded single-question loop, including tool follow-ups. It is not persistent conversational memory: no `ai_messages`/conversation tables or retention policy are created here. Conversation persistence and its export/delete integration remain future work. Model prose is not a deterministic proof of semantic grounding; fake-provider transport tests do not certify actual model answer quality or complete the roadmap's question gate.

After owner approval, activation must use a reviewed composition root with `runAiCapability` on every model turn, so the kill switch, usage budgets, rate limits and measured capability gates apply to every call. Do not simply compose a raw provider/orchestrator from the UI. Actual-model grounding and quality evidence must accompany activation. All other Phase 9 surfaces remain outside this PR.

## Verification

Focused tests use fake providers with synthetic in-memory measured capabilities, never saved measurements. They exercise twelve question-shaped tool exchanges; concepts without data reads; existing unmeasured-gate refusal; invalid inputs; unknown/write/scenario tools; cross-user arguments; malformed arguments; handler failures; metric reasons and clipping; duplicate IDs; read/turn/context caps; incomplete answers; authenticated release blocking; source rendering and escaping. Three PostgreSQL integration tests exercise real owner isolation, an exact spending total and absence of ledger/audit changes after a write attempt.
