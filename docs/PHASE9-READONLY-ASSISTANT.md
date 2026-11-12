# Phase 9 read-only financial assistant

> **Status 2026-11-07:** merged into `main` (PRs #39–#48). Live generation stays hard-disabled. The owner has selected a Tier 1 lineup ([ADR-55](DECISIONS.md#adr-55--retain-the-tier-1-selection-recorded-in-claude-pr-54-current-contract-eligibility-remains-independent)), but activation still needs complete current-contract measurements and a reviewed release; features that need Tiers 2–4 also need those tiers selected ([OD-20](DECISIONS.md#open-decisions-requiring-the-user)). The PR-stacking notes below are the original build record.

The owner authorized this work on 3 November 2026 while OpenRouter funding delayed Phase 8. PR #40 is stacked on transaction-entry PR #39 so conversation migration `0008` follows proposal migration `0007`. Neither feature enables a live model. Tests use fake providers only. No model order, capability gate, existing prompt, scorer or evaluation suite changes.

## Bounded reads and follow-ups

`answerReadOnlyQuestion` receives a bound `AiReadCtx` and an injected orchestrator. It reuses the production finance-question prompt, capability and frozen tool registry. User identity is never a tool argument. The existing dispatcher validates names and strict arguments before invoking an owner-bound application-service projection. Model code has no database or write capability.

Each question permits at most four model turns, eight dispatched calls and 64 KiB of accumulated tool outcomes. Oversized batches and duplicate/empty call IDs are refused before dispatch. Failures return as generic data for bounded follow-up. Empty, incomplete or oversized final answers are refused. There is no outer retry loop or payload logging.

Follow-up context contains at most eight complete prior exchanges and 16,000 characters. It includes prior questions and interpretation text, never a substituted system role or replayed historical tool results. New questions retain the same system prompt and read tools. Historical interpretations can be stale; actual approved-model follow-up grounding must be verified before activation.

The answer view separates **Interpretation** from source facts and deterministic calculations. It preserves exact decimal projections, null/unavailable reasons, dates, currency and clipping metadata, escapes all text, performs no financial arithmetic and never coerces missing data to zero. No scenario engine/tool is introduced.

## Persistence and concurrency

`ai_conversations` and `ai_messages` are owner-scoped. An exchange revision and unique message positions keep chronology independent of equal timestamps. Conversations hold at most 100 complete question/answer pairs. Assistant messages preserve interpretation, projected source evidence, serving model and response-usage metadata. Cost stays null until billing is verified. Transcript content is stored here because the product needs it; it never enters application logs. Model-attempt/tool-call tables remain deferred.

`askConversation` loads the owner’s active conversation and bounded recent context, runs the question **outside any database transaction**, then claims the same owner/revision/active conversation and saves both messages in one transaction. The claim also matches PostgreSQL's `xmin` row version captured before generation. This token exists only for the in-flight request; it is never persisted, exported or used as a long-term identifier. A committed edit invalidates the pending answer even if an archive/restore or rename/revert returns every visible field to its original value. Rolled-back edits and changes to other conversations do not invalidate it. The exchange revision remains the count of saved question/answer pairs. Concurrent completions cannot both append from the same revision. Archive/delete during generation refuses the completed exchange. Failed output saves neither message. A failed final insert rolls back the question and revision as well.

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

The archive/restore race was reproduced by two failing PostgreSQL tests before the row-version fix. Afterward, **24 focused integration tests and 64 assistant unit tests pass**, including rejection after equal-timestamp archive/restore and rename/revert, acceptance after a rolled-back edit or a change to a different conversation, and a fresh successful question after the rejected answer. Typecheck, lint, production build and client-secret scan pass. No migration or model/prompt/gate change is needed.

## Workload evidence and clipped-source presentation — 2026-11-07

A clipped financial source now shows **partial results** in its collapsed summary, plus an explanation beside the evidence: omitted rows can affect comparisons or rankings, while authoritative totals supplied by the engine still apply. Failed sources keep the unavailable label; complete and unmarked sources are not labeled partial. This is presentation of existing `meta.truncated`, not a new response field, read policy or model gate. Saved conversations use the same component, and exported evidence stays unchanged.

Twelve real-engine workload regressions now exercise scripted fake-provider calls through the orchestrator and real dispatcher into source rendering: previous-month spending, category totals, a bounded transaction list, month comparison, savings rate, an unavailable savings rate, balances, cost net worth, history levels, portfolio performance gaps, holdings and allocation. The bounded list deliberately excludes the largest expense, proving why its three recent rows cannot establish a complete ranking. Exact money/rate strings, source dates, missing-price/metric reasons, transfer exclusion and another owner's isolation survive the full path. A thirteenth case compares the entire money ledger, investment ledger and audit history before/after the corpus.

This verifies data flow and source presentation, **not a real model's understanding, arithmetic, prose quality or answers to every roadmap question**. The scripted final explanation does not pretend to derive figures. Unsupported annual contributions, scenarios and other missing deterministic capabilities remain outside this check. No live provider call, prompt/scorer/gate change or feature activation occurred. See the [continuation audit](audits/2026-11-07-assistant-workload-evidence.md) for exact verification and release boundaries.

## Guarded runtime adapter preparation — 2026-11-08

The [Tier 1 composition follow-up](audits/2026-11-08-tier1-runtime-composition.md) prepares an owner-bound application adapter that sends each model turn, including parsing repairs, through `runAiCapability`. It preserves the existing feature services and release hold: no action/UI invokes it, no model is activated and no measurement is recorded. Fake HTTP/real-runtime integration checks cover budgets, rate limits, the kill switch, metering, ownership and financial immutability. Existing intent routing and reviewed action composition remain release prerequisites.

## Intent routing and authenticated action preparation — 2026-11-08

The [intent/action follow-up](audits/2026-11-08-tier1-intent-actions.md) connects the existing question classifier to original user text and authoritative previous serving-tier metadata. Advanced questions are refused before egress in this Tier 1 composition; self-contained routine questions reset independently. Saved model-choice notices derive from the original question.

Both authenticated generation actions now have session-bound adapter wiring and trusted redirects behind a centralized code-only hold that remains **false before context creation**. Generation controls stay disabled. Test-only release mocks verify the prepared actions through real services/runtime with fake HTTP, including owner isolation, unsupported intent, malformed arguments and draft-only financial immutability. Active form wiring, concrete owner release review, evidence recording and activation remain ahead.

## Generation forms and concrete release review — 2026-11-08

The [form follow-up](audits/2026-11-08-tier1-generation-forms.md) wires transaction descriptions and questions inside saved conversations, with controlled text retained after failed actions, pending states and accessible errors. Archived/full conversations cannot submit questions. Page and action release checks share the same code-only hold, which remains **false**; client flags cannot release server generation.

All 2,544 unit/65 property tests and build/static/integrity checks pass. Chromium verifies actual component hooks with fake actions and authenticated production held workflows, including forced client submission refusal, with zero generated records and synthetic fixture cleanup. Base PR #63 is CI-green on PostgreSQL 17/18. The [concrete release-review packet](audits/2026-11-08-tier1-release-review.md) lists the measured quality concerns and reviewed evidence-recording work still needed before separately approved activation. No model is called or activated by this follow-up.
