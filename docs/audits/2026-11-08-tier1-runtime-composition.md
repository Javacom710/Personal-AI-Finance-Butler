# Tier 1 runtime composition preparation — 8 November 2026

PR #61 at `0c4e0ab` passes CI on PostgreSQL 17 and 18 and provides complete parse-v3 evidence. This separate follow-up prepares the application-side adapter needed to use the existing feature services through the guarded runtime. It does not activate generation or record capability measurements.

## What changed

`src/server/ai-tier1-features.ts` binds transaction drafting and saved-conversation questions to an authenticated action's `RequestCtx`. Its public surface exposes only `draftTransaction` and `askConversation`; confirmation remains the separate, existing user-reviewed command.

Each helper receives only a `run` interface. Every initial model call, assistant continuation and structured-output repair calls `runAiCapability`, preserving its per-user kill switch, rate limit, request/token daily budgets, measured-capability selection, cached circuit breaker and provider metering. The adapter refuses another capability and removes caller-supplied tool definitions: the runtime supplies its trusted registry for questions, while transaction drafting has no tools. Construction is lazy and performs no service read, provider construction or request.

The pure AI helpers' parameter types narrow from the full orchestrator to `Pick<Orchestrator, 'run'>`; their behavior, prompts, bounds and validation remain unchanged. The application context and transaction opener stay outside the AI zone. The new server module is denied to AI-zone imports by the existing default-closed boundary, without a new allowlist exception.

Existing services still resolve and stage unconfirmed proposals, enforce ownership and conversation revision claims, and save complete question/answer pairs only after successful generation. No database transaction spans a model call. Model output gains no financial write authority.

## Verification

Tests use synthetic owners and financial records, fake HTTP responses, the real provider adapter/orchestrator/runtime/dispatcher, PostgreSQL and the application role. Current measured capabilities are loaded from the actual v3 report into memory only; no measurement row is imported into a deployment database. A fixed test clock avoids day-boundary artifacts.

The checks cover lazy construction and owner binding; trusted/no-tool request composition; per-turn and repair guards; exact metering of requests and tokens; stale/unmeasured refusal; another owner's conversation and source isolation; staged drafts without financial changes; complete saved question/answer exchanges; and no partial messages/drafts when generation is stopped. Financial verification compares full, ordered transaction, entry and audit rows, including a model-requested write rejected by the real dispatcher.

**2,524 unit, 65 property and 647 PostgreSQL 17 integration tests pass (3,236 total)**, plus typecheck, lint, production build, client-secret scan and integrity 35/0. The final 15-test adapter integration rerun passes after strengthening ledger checks to full ordered row snapshots. The 23 focused unit checks include all five new adapter tests and existing direct-action release tests. PostgreSQL 18 remains the new PR's CI check.

Existing direct-action tests continue to require authentication and return unavailable without composing any runtime. No action or UI imports the new adapter. Prompts, scorer contracts, profiles, model configuration, financial schema and historical report artifacts are unchanged.

## Release boundaries and remaining work

This is an adapter prepared for review, not a release-ready feature activation. The existing services choose fixed Tier 1 capabilities; wiring the existing deterministic intent classifier, dependent follow-ups and model-choice notices remains an explicit release prerequisite. Advanced/vision tiers remain unselected, and unsupported work must not silently become a Tier 1 answer. No classifier, prompt, scorer, threshold, global runtime gate, tool registry or financial schema changes here.

Before activation: review the remaining model-quality failures, prepare the question-intent routing and authenticated action/UI wiring, and obtain owner review of the concrete release. Recording the accepted evidence and activating generation remain separate steps. The adapter neither reads report files nor loads measurements itself, so merely importing it cannot qualify a model or bypass release approval.

All model responses in this follow-up are fabricated at the test HTTP boundary. No external inference request, production data disclosure or additional inference spend occurs. The project accounting total remains US$1.932521049 of US$10. Earlier source-bound reports remain unchanged; implementation-only type/composition changes do not relabel them or change their prompt/scorer contracts.
