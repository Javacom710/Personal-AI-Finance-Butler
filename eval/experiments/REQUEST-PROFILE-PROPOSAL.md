# Proposed request-profile contract

**Implementation scope approved 2026-11-02; recorded in [ADR-51](../../docs/DECISIONS.md#adr-51--request-profiles-are-application-controlled-and-measurements-must-match-them).** The owner instructed work to continue after the explicit approval question. This document preserves the reviewed proposal; its implementation does not accept a production model order or reinterpret the experimental artifacts.

The default Lightning request failed the parse/classify v2 schema gate. NVIDIA documents `chat_template_kwargs.enable_thinking=false`, and the separate experiment in this directory tests it without changing prompts, scorers or production token budgets. Its results cannot certify today's production requests: the application never sends that flag, and measurements currently identify model and suite rather than a request profile.

## Recommended implementation scope

1. Define application-controlled, versioned request profiles in AI configuration. Preserve today's request body as the default. Add an opt-in Lightning thinking-disabled profile whose sole provider override is the documented flag. Do not accept arbitrary wire overrides from a user message or tool call.
2. Resolve a profile from application configuration before requesting a model. Keep NVIDIA-specific serialization in the provider adapter. Use the same resolver and profile in production and evaluation; retain the existing prompts, capability requirements, budgets and tier controls.
3. Include a stable profile identity/fingerprint in reports and stored evaluation detail. When loading a measured entry, require all current suites to match the active profile and existing coverage/version requirements. Treat legacy rows as default-profile measurements only; changing a profile must invalidate incompatible scores.
4. Add offline regression coverage for the exact wire body, unchanged default requests, unsupported model/profile rejection, and rejection of missing or mismatched measurement provenance. No new runtime dependency is needed.
5. Run fresh, paced full evaluations under the represented profile. Keep experimental artifacts outside `ai_model_evaluations`; do not import them retrospectively or combine unanswered requests with a different run to claim complete coverage.

**Acceptance of this implementation scope would not accept a production model order.** Lightning remains an evaluation candidate until verified declared capabilities, complete current-profile measurements and the separate human routing decision satisfy AI-SYSTEM.md §14. The full experiment also needs to be assessed on exact task accuracy and grounding, not schema validity alone.

## Why a decision is needed

This changes the approved request/measurement contract and model strategy, rather than merely running another default-profile benchmark. PROJECT-STATE.md's working protocol requires stopping before a major architectural correction, and the earlier probe explicitly leaves production-profile adoption unapproved. The requested decision is whether to implement the scope above; no implementation or production adoption has been made here.

OD-18 remains separate: scenario arithmetic, the missing metrics and TWR wiring still need their scheduling decision. This proposal does not move them into Phase 8 or advance to Phase 9.
