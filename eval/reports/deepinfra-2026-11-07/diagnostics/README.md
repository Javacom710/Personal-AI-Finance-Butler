# Phase 8 failure diagnostics — 7 November 2026

<!-- project-doc-status:start -->
> **Status reviewed 12 November 2026:** Phase 8 quality/release review open; Phase 9 live AI disabled; Overview, Scenarios, metrics and TWR built; Phase 10 partial. OD-21/22/23 remain open. DeepInfra direct is selected.
> **Current references:** [Project state](../../../../PROJECT-STATE.md) · [Roadmap](../../../../docs/ROADMAP.md) · [Maintained deadline forecast](../../../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence; original score and finding body retained, source contracts may be historical.
<!-- project-doc-status:end -->

**Follow-up:** [numeric presentation correction and fresh campaigns](numeric-presentation.md). The preservation checks below describe the original diagnostics at their recorded time; the subsequent scorer fix deliberately changes the active source fingerprint and versions three suites. Historical artifacts remain unchanged.

Built `npm run ai:diagnose:deepinfra` to explain failed analysis and document cases without retaining response text, reasoning, tool arguments, extracted values or validation-error messages. It reuses the existing suites, provider adapter, production output limits and authoritative scorers. Fixed reason codes and numeric counts provide observations, not an alternative scoring policy.

The six fresh synthetic probes completed with **four answered requests and two timeouts**, all on DeepInfra direct. They are **diagnostic only**, cannot authorize production, and were not recorded in the database or combined with the completed 610-case measurement.

| Case | Observed result |
|---|---|
| `analysis-001` | Normal stop; 24 untraceable figure occurrences, three missing required figure groups, one missing finding, two missing metric bindings. |
| `analysis-006` | Normal stop; eight untraceable figure occurrences, three missing required figure groups and three missing metric bindings. |
| `analysis-015` | Normal stop; 53 untraceable figure occurrences, four missing required figure groups, three missing findings and four missing metric bindings. |
| `doc-001` | 60-second timeout; no answer to diagnose. |
| `doc-002` | Valid schema and correct transaction count, but both transactions failed account-hint and notes checks. Other compared extraction fields matched. |
| `doc-018` | 60-second timeout; no answer to diagnose. This case passed in the earlier full run, so that result was not reproduced here. |

All three analysis answers had nonempty content, no further tool calls and normal stops. Their failures therefore cannot be explained solely by timeout, truncation or an unwanted tool call in these probes. The counts flag failures under the existing parser/rubric; they do **not** by themselves prove whether the underlying cause is answer content or formatting. Occurrence counts are not counts of unique invented facts. Historical raw outputs were not saved, so these new observations cannot be attributed retrospectively to every historical failure.

## Guardrails and verification

- The fixed six-case plan selects the already declared GPT-OSS-120B and Qwen vision candidates from configuration. No Google/Anthropic model, new provider, prompt, scorer, threshold or production route was introduced.
- The runner requires `--run --no-record`, refuses arbitrary overrides and recording, shares the measurement lock, reserves spend before each request, retains unknown-usage reservations, and stops without retry on HTTP errors. Diagnostics have a cumulative $0.25 cap and a combined known-accounting ceiling of $4.50, leaving room for earlier unmetered probes within the $5 allocation.
- Diagnostic accounting is **$0.012614377**, including conservative reservations for the two timeouts. This is an estimate, not a provider billing statement.
- **All 34 original measurement artifacts and their source fingerprint are unchanged.** No previous checkpoint was edited, rescored, resumed or replaced. The original promotion hold remains in force.
- **2,032 unit tests pass**, including 41 new tests for scorer parity, output privacy, complete finite execution, budget/provider checks, HTTP 429 without retry, and refusal of recording. Typecheck, lint, production build, client-secret scan and whitespace checks pass.

[Diagnostic results](2026-11-07T06-09-18-265Z.json) · [Usage and reservations](usage.json) · [Baseline preservation verification](verification.json) · [Original approval report](../README.md)

```sh
# Offline plan; no provider calls.
AI_API_KEY="$AI_API_KEY_DeepInfra" npm run ai:diagnose:deepinfra -- --plan

# Six fresh probes, separate from full measurements; never records or promotes.
AI_API_KEY="$AI_API_KEY_DeepInfra" npm run ai:diagnose:deepinfra -- --run --no-record
```

Request compliance and scorer-format compatibility remain the next investigation targets. Tier-specific eligibility is still unresolved; recording or promoting a lineup still requires the owner's approval.
