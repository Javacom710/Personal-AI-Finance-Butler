# Phase 9: transaction proposal entry

> **Status 2026-11-07:** merged into `main` (PRs #39–#48). Live generation stays hard-disabled. The owner has selected a Tier 1 lineup ([ADR-55](DECISIONS.md#adr-55--retain-the-tier-1-selection-recorded-in-claude-pr-54-current-contract-eligibility-remains-independent)), but activation still needs complete current-contract measurements and a reviewed release; features that need Tiers 2–4 also need those tiers selected ([OD-20](DECISIONS.md#open-decisions-requiring-the-user)). The PR-stacking notes below are the original build record.

The owner authorized this slice on 2026-11-02 **in parallel with unfinished Phase 8** so application development can proceed while provider funding/evaluation waits. It includes natural-language money entry and human confirmation only. Assistant chat, analysis, scenarios, investments and documents are not implemented by this change; OD-18 remains blocked.

## Release boundary

Live generation is **hard-disabled** in `app/(app)/money/proposals/actions.ts`. The draft action authenticates and returns an unavailable message; it does not compose a runtime/provider or write a draft. The textarea and create button are disabled. An API key, `AI_ENABLED`, or a direct authenticated POST cannot enable it. There is no fake-provider production endpoint or development bypass. Tests alone supply in-memory fake providers and synthetic measured capabilities; no capability row is stored.

After the owner approves the Phase 8 lineup, activation needs a reviewed composition-root change using `runAiCapability` (the existing per-user kill switch, budget, rate limits and capability gates). This PR does not activate generation, change an order, lower a threshold or choose a model.

## Interpretation and storage

`ai/proposals/transaction-entry.ts` uses the existing parse prompt and strict schema through a supplied orchestrator. It sends only the sentence, local date/base currency and schema, with no tools or account/category lists. JSON-number amounts and extra fields are rejected. Schema errors permit exactly one bounded repair using the existing repair instruction. Returned tool calls are rejected, never dispatched. No AI code has a database/write context.

`services/aiProposals.ts` resolves hints only after interpretation, scoped to the owner. Exact unique names/paths take precedence; otherwise a unique fuzzy match of at least 0.8 is allowed. Missing, duplicate, closed or unresolved choices become field issues. Amounts remain decimal strings; null, nonpositive, excessive precision and overflow amounts cannot be applied. Currency/date/category mismatches, low confidence and ambiguities stay visible. Invalid structured output is stored as `invalid`, with field errors, for explicit correction rather than silent repair.

Every row preserves the exact final model response as a JSONB string, normalized editable fields and validation issues. This first schema slice supports `kind='transaction'` only. Conversations, other proposal kinds and investment proposal linkage are deferred, despite their future shapes in SCHEMA.md. No unrelated Phase 9 schema is created.

## Confirmation

The review screen at `/money/proposals` shows resolved names and formatted amounts, editable fields and issues. The user must confirm the exact submitted transaction and acknowledge existing issues. FormData preserves amounts as text. An invalid proposal can be confirmed only after the submitted fields satisfy the same strict reviewed-value boundary and the user acknowledges the correction. A changed account/category is rechecked at confirmation; foreign or inactive accounts, wrong category kinds and missing FX data are refused.

Confirmation runs inside `withWriteCtxResult`:

1. Lock/claim the owner-scoped pending or invalid row with an eligible no-op CAS, requiring `expires_at > ctx.now`.
2. Revalidate the edited values and current referenced entities.
3. Call **the same** `createTransaction` or `createTransfer` service as manual entry, with source `ai` and the proposal link. No ledger calculation is duplicated.
4. CAS the proposal to applied with its transaction ID and confirmation time, and append its `ai_confirmed` audit entry.
5. Commit together; errors roll back header, entries, tags, audits, proposal state and ledger-version changes.

The row claim serializes competing confirmations. A partial unique index independently prevents two transaction rows referencing one proposal. Deferred database triggers check owner/source/entity linkage and require both proposal confirmation and ordinary transaction-create `ai_confirmed` audits at commit (I-10). The existing transaction audit records the proposal ID. I-10 proof remains after a later ordinary deletion because audit history remains.

Creation time and expiry differ by exactly 24 hours. Confirmation at the expiry boundary is refused. Editing never refreshes expiry. Expired drafts remain visibly unconfirmable and may be dismissed. Rejection writes no financial record. Cross-currency transfers require the user to enter the credited amount; the parser cannot invent an exchange amount.

## Migration and verification

Migration `0007_phase9_transaction_proposals` adds the transaction-only proposal table, transaction foreign key/partial unique index and deferred checks. Its down migration removes the triggers/functions, link and table. Existing manual and recurring entry continue through their original paths. The integrity command now checks I-10/I-14 rather than marking them deferred.

Tests cover a 40-case proposal corpus, fake-provider generation and bounded repair, unchanged unmeasured gates, production release blocking, SSR field errors/exact text/escaping, expiry boundaries, ownership and stale references, transfer handling, concurrent/double confirmation, database guard enforcement and complete rollback on a forced final audit failure. End-to-end database tests use synthetic users/data and a disposable local PostgreSQL instance; no live provider is called.

The complete CI pipeline passed on PostgreSQL 17 and 18 at code commit `0e3855f` ([run](https://github.com/Javacom710/Personal-AI-Finance-Butler/actions/runs/41487036592)): all unit/property/integration suites, migration/seed, financial invariants, typecheck, lint, production build, client-secret scan and dependency audits. This validates the disabled transaction-proposal slice; it does not authorize live activation or complete the remaining Phase 9 scope.

Rejected confirmations retain the exact raw user edits and remount a fresh review form, requiring confirmation again. The page passes an absolute expiry instant to a client timer so an open draft visibly expires without refresh. PostgreSQL still enforces the expiry boundary independently of browser time. A local headless Chromium interaction check with fake actions verified preservation of amount precision, account, description and notes after rejection, then deadline disabling.

## Guarded runtime adapter preparation — 2026-11-08

The [Tier 1 composition follow-up](audits/2026-11-08-tier1-runtime-composition.md) prepares an owner-bound application adapter that sends each model turn, including parsing repairs, through `runAiCapability`. It preserves the existing feature services and release hold: no action/UI invokes it, no model is activated and no measurement is recorded. Fake HTTP/real-runtime integration checks cover budgets, rate limits, the kill switch, metering, ownership and financial immutability. Existing intent routing and reviewed action composition remain release prerequisites.
