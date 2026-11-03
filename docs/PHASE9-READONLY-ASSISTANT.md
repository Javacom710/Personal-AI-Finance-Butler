# Phase 9 read-only financial assistant

The owner authorized this work on 3 November 2026 while OpenRouter funding delayed Phase 8. PR #40 is stacked on transaction-entry PR #39 so conversation migration `0008` follows proposal migration `0007`. Neither feature enables a live model. Tests use fake providers only. No model order, capability gate, existing prompt, scorer or evaluation suite changes.

## Bounded reads and follow-ups

`answerReadOnlyQuestion` receives a bound `AiReadCtx` and an injected orchestrator. It reuses the production finance-question prompt, capability and frozen tool registry. User identity is never a tool argument. The existing dispatcher validates names and strict arguments before invoking an owner-bound application-service projection. Model code has no database or write capability.

Each question permits at most four model turns, eight dispatched calls and 64 KiB of accumulated tool outcomes. Oversized batches and duplicate/empty call IDs are refused before dispatch. Failures return as generic data for bounded follow-up. Empty, incomplete or oversized final answers are refused. There is no outer retry loop or payload logging.

Follow-up context contains at most eight complete prior exchanges and 16,000 characters. It includes prior questions and interpretation text, never a substituted system role or replayed historical tool results. New questions retain the same system prompt and read tools. Historical interpretations can be stale; actual approved-model follow-up grounding must be verified before activation.

The answer view separates **Interpretation** from source facts and deterministic calculations. It preserves exact decimal projections, null/unavailable reasons, dates, currency and clipping metadata, escapes all text, performs no financial arithmetic and never coerces missing data to zero. No scenario engine/tool is introduced.

## Persistence and concurrency

`ai_conversations` and `ai_messages` are owner-scoped. An exchange revision and unique message positions keep chronology independent of equal timestamps. Conversations hold at most 100 complete question/answer pairs. Assistant messages preserve interpretation, projected source evidence, serving model and response-usage metadata. Cost stays null until billing is verified. Transcript content is stored here because the product needs it; it never enters application logs. Model-attempt/tool-call tables remain deferred.

`askConversation` loads the owner’s active conversation and bounded recent context, runs the question **outside any database transaction**, then claims the same owner/revision/active conversation and saves both messages in one transaction. Concurrent completions cannot both append from the same revision. Archive/delete during generation refuses the completed exchange. Failed output saves neither message. A failed final insert rolls back the question and revision as well.

The service does not accept a client-supplied answer. Its orchestrator is injected by application code/tests. Only the future reviewed composition root may supply a live implementation.

## History management and privacy

`/ai` browses active or archived conversations in pages of 50, with newer/older links. History stays owner-scoped on every page, ordered by latest update and UUID to resolve equal timestamps. Page input is validated before database access; repeated, fractional and unsafe values are refused. Pages reflect current history, so title/archive changes can reorder it. Authenticated services/actions create titles, rename, archive/restore, and explicitly delete conversations. These are content-management operations and do not call a model or change financial records. Detail pages show saved questions, answer sources and localized dates. Empty conversations contain no fake financial content.

Per-conversation JSON export checks ownership and reads the conversation/messages in one SQL statement for a consistent snapshot. It preserves decimal strings and returns a private, no-store attachment with a UUID-based filename. Confirmed deletion cascades all messages. The users→conversations→messages foreign keys also cover future account deletion. Global Settings data export/delete remains in its scheduled phase; these routes do not claim to implement it.

## Release boundary

Question controls are disabled. `askFinanceQuestionAction` authenticates direct calls and returns unavailable without composing a runtime or opening a read capability. An environment key/flag cannot enable it. There is no fake-provider production route. History management remains usable independently of model readiness.

Activation requires owner approval of the Phase 8 lineup and a reviewed composition root that uses `runAiCapability` on **every model turn**, preserving the kill switch, usage budget, rate limits and measured capability gates. Do not compose a raw provider/orchestrator in a page or action. Fake-provider exchanges do not certify real-model semantic grounding, recommendation quality or completion of the roadmap question gate. Scenarios remain blocked by OD-18.

## Verification

Tests exercise the real frozen dispatcher with fake providers; unchanged baseline prompts/gates; bounds and invalid history; owner isolation; source rendering; release blocking; direct action/export authentication; exact strings and private export headers; atomic message pairs and chronology; competing questions; archive/delete during generation; forced final-insert rollback; bounded follow-ups; and conversation/user deletion cascades. Migration `0008` includes its reverse and is checked with the repository's all-down/all-up schema fingerprint test.

The complete local regression at `f458cc0` passed **2,750 tests across 109 files**, including all property and PostgreSQL 17 integration tests. After the final title-error/deletion-redirect UI changes (`4fa27ef`), all **60 focused assistant unit tests**, typecheck, lint, production build and client-secret scan passed. Authenticated production HTTP verification covered history/detail, exact-string private export, disabled question controls, actual rename/archive/restore/delete form submissions, deletion redirect and deleted-resource 404s. The synthetic user/session were removed afterward. CI checks PostgreSQL 17 and 18 separately.

The history-pagination follow-up passed **68 focused unit tests and 21 PostgreSQL integration tests**, typecheck, lint, the default Turbopack production build and client-secret scan. Authenticated production HTTP checks reached all 103 synthetic conversations across active/archive pages, rejected invalid page input, handled an empty later page, and verified the draft-review link with and without Money accounts. The temporary synthetic user, session, accounts and conversations were removed. No inference request was made.
