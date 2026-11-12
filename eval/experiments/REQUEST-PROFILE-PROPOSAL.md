# Proposed request-profile contract

<!-- project-doc-status:start -->
> **Status reviewed 12 November 2026:** Phase 8 quality/release review open; Phase 9 live AI disabled; Overview, Scenarios, metrics and TWR built; Phase 10 partial. OD-21/22/23 remain open. DeepInfra direct is selected.
> **Current references:** [Project state](../../PROJECT-STATE.md) · [Roadmap](../../docs/ROADMAP.md) · [Maintained deadline forecast](../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence; original score and finding body retained, source contracts may be historical.
<!-- project-doc-status:end -->

**Implementation scope approved 2026-11-02; recorded in [ADR-51](../../docs/DECISIONS.md#adr-51--request-profiles-are-application-controlled-and-measurements-must-match-them).** The owner instructed work to continue after the explicit approval question. This document preserves the reviewed proposal; its implementation does not accept a production model order or reinterpret the experimental artifacts.

The default Lightning request failed the parse/classify v2 schema gate. NVIDIA documents `chat_template_kwargs.enable_thinking=false`, and the separate experiment in this directory tests it without changing prompts, scorers or production token budgets. Its results cannot certify today's production requests: the application never sends that flag, and measurements currently identify model and suite rather than a request profile.

## Recommended implementation scope

1. Define application-controlled, versioned request profiles in AI configuration. Preserve today's request body as the default. Add an opt-in Lightning thinking-disabled profile whose sole provider override is the documented flag. Do not accept arbitrary wire overrides from a user message or tool call.
2. Resolve a profile from application configuration before requesting a model. Keep NVIDIA-specific serialization in the provider adapter. Use the same resolver and profile in production and evaluation; retain the existing prompts, capability requirements, budgets and tier controls.
3. Include a stable profile identity/fingerprint in reports and stored evaluation detail. When loading a measured entry, require all current suites to match the active profile and existing coverage/version requirements. Treat legacy rows as default-profile measurements only; changing a profile must invalidate incompatible scores.
4. Add offline regression coverage for the exact wire body, unchanged default requests, unsupported model/profile rejection, and rejection of missing or mismatched measurement provenance. No new runtime dependency is needed.
5. Run fresh, paced full evaluations under the represented profile. Keep experimental artifacts outside `ai_model_evaluations`; do not import them retrospectively or combine unanswered requests with a different run to claim complete coverage.

**Acceptance of this implementation scope would not accept a production model order.** Lightning remains an evaluation candidate until verified declared capabilities, complete current-profile measurements and the separate human routing decision satisfy AI-SYSTEM.md §14. The full experiment also needs to be assessed on exact task accuracy and grounding, not schema validity alone.

## Approval boundary

This changes the approved request/measurement contract and model strategy, rather than merely running another default-profile benchmark. The owner approved implementing the scope above after the explicit approval question, as PROJECT-STATE.md's working protocol requires. ADR-51 now governs the implementation. Production model-order acceptance remains separate; none of the exploratory artifacts in this directory qualifies it.

OD-18 remains separate: scenario arithmetic, the missing metrics and TWR wiring still need their scheduling decision. This proposal does not move them into Phase 8 or advance to Phase 9.
