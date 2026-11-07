# Shared prompt clarification — 7 November 2026

The completed DeepInfra `format-v3` campaign qualified no model. Its strict analysis/extraction failures motivated a bounded prompt clarification, rather than a threshold change or another immediate 610-case run. Earlier output-free probes found missing/untraceable figures and missing findings, and a schema-valid receipt response with incorrect account hints and notes. Those observations do not establish a single cause for all failures.

## Implementation

The shared finance prompt now explains that serialized money amounts are already full currency units and that scale means precision; fractional rates may be presented as percentages. It asks for reported figures beside their metrics with currency/sign, preserves cost/market, stale/current and partial/unavailable distinctions, and explicitly continues the legitimate finance question after rejecting an injected instruction. It still prohibits derived financial calculations, arbitrary tools and writes.

The shared document prompt now requires verbatim printed source-account evidence, distinguishes merchants/payment networks/methods from account names, preserves description/order, and keeps unsupported hints/tags/notes empty. Extraction commentary is not a transaction note, and uncertainty belongs in ambiguities. Missing amounts/dates are still nullable and must enter review. No expected case value or model name was added to a prompt.

Suite versions bind the changed request contracts: tool-select/injection **v3**, grounding/robustness/analysis **v4**, document **v2**. Parse/classify remain v2. Scoring functions, golden inputs/expectations, production output budgets, timeouts, profiles, numeric gates and default routing orders are unchanged. Old measurements are not rescored or imported; they cannot certify these changed contracts.

## Verification

**2,110 unit tests** pass, plus typecheck, lint, production build and client-secret scan. Thirteen added tests verify every affected suite sends the shared production prompt, the version matrix covers every affected contract, and an otherwise complete tier cannot load even one prior-prompt suite. Existing factual, injection, exact extraction and proposal tests continue to pass.

Six fresh synthetic diagnostic probes use the fixed existing plan, current production prompts/budgets, the same DeepInfra endpoint and default profile. They retain fixed reason codes/counts only, never output text, reasoning, extracted values or tool arguments. These probes cannot record or promote models and do not substitute for full-tier qualification.

## Live observations and disposition

The six probes completed with **four answers, one pass, three answered failures and two timeouts**:

| Case | Observation |
|---|---|
| analysis-001 | 23 untraceable figure occurrences, three missing figure groups, one missing finding and two missing metric bindings. |
| analysis-006 | No untraceable figures, but one required figure group and metric binding missing. |
| analysis-015 | All required figures/bindings present and none untraceable; two required findings missing. |
| doc-001 | 60-second timeout. |
| doc-002 | Pass: valid schema, both transactions and every compared extraction field correct. |
| doc-018 | 60-second timeout. |

The receipt result is one fresh success, not proof of a general quality improvement or causal attribution to this change. The analysis reason counts describe the existing strict rubric; outputs were not retained to interpret prose after the fact. No injection-suite model result is claimed from these analysis/document probes. The deterministic injection tests still pass, but model injection quality needs full current measurement.

No additional full campaign was run: these candidates still have unresolved quality/completeness failures. The previous `format-v3` full campaign is historical for the newly versioned contracts. The production promotion hold remains; Phase 8 is open and no Phase 9 workflow is activated. Future qualification needs full current suites for the exact candidate/tier/provider/profile, followed by owner approval before recording or accepting orders.

Diagnostic accounting is **$0.013182537**, including reservations for unknown timeout usage; combined known DeepInfra accounting is **$0.191050683**. These are catalogue-price estimates/reservations, not a billing statement. The existing $4.50 shared account ceiling and $0.25 diagnostic ceiling remain in force.

All **34 original measurement artifacts and all 35 format-v3 campaign artifacts** are byte-identical. An attempted offline read of old source-bound checkpoints fails with `Checkpoint provenance differs from the active measurement`, without a provider request or historical rewrite. The shared account lock is released. No database evaluation, default order, request profile or promotion changed.

[Diagnostic report](../../eval/reports/deepinfra-2026-11-07/diagnostics/2026-11-07T09-54-35-719Z.json) · [Verification JSON](2026-11-07-ai-prompt-contracts-verification.json) · [Historical full campaign](../../eval/reports/deepinfra-2026-11-07-format-v3/README.md)
