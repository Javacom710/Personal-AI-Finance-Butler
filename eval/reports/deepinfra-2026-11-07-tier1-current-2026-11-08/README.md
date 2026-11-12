# Current-contract Tier 1 qualification — 8 November 2026

<!-- project-doc-status:start -->
> **Status reviewed 12 November 2026:** Phase 8 quality/release review open; Phase 9 live AI disabled; Overview, Scenarios, metrics and TWR built; Phase 10 partial. OD-21/22/23 remain open. DeepInfra direct is selected.
> **Current references:** [Project state](../../../PROJECT-STATE.md) · [Roadmap](../../../docs/ROADMAP.md) · [Maintained deadline forecast](../../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence; original score and finding body retained, source contracts may be historical.
<!-- project-doc-status:end -->

This campaign measures the selected **GLM-5.3-Flash → GPT-OSS-120B** pair on DeepInfra direct, using the reconciled ADR-55 contracts: parse/classify v2, tool-select v3, grounding/robustness v5 and injection v4. Each model receives all six suites (190 cases), with the existing production request profiles and output budgets. Only synthetic evaluation fixtures are sent. Historical reports remain unchanged; no scores are imported or rescored.

The runner now supports an explicit `--selected-tier1` plan, requiring a named campaign. Its default Qwen candidate plan is preserved. The plan and its entries participate in the source fingerprint, so changing plans cannot overwrite or resume another campaign. Reports cover only the selected tier; no advanced or vision eligibility is implied.

## Results

All **380 cases answered**, with zero transport errors, timeouts or output-limit stops. Both models pass the existing schema ≥95% and tool-call ≥90% routing thresholds. The unchanged proposer returns the selected GLM → GPT-OSS order.

| Metric | GLM-5.3-Flash | GPT-OSS-120B |
|---|---:|---:|
| Schema validity | 100/100 | 100/100 |
| Tool-call correctness, all applicable cases | 53/57 (92.98%) | 53/57 (92.98%) |
| Exact transaction parsing | 36/40 | 30/40 |
| Classification | 60/60 | 60/60 |
| Tool-selection suite | 27/30 | 29/30 |
| Grounding | 21/25 | 20/25 |
| Robustness | 8/10 | 4/10 |
| Injection resistance | 24/25 | 19/25 |
| p50 / p95 request latency | 855 / 2,144 ms | 4,881 / 20,084 ms |

The tool-call denominator also includes unexpected calls in grounding/robustness; it is distinct from the tool-selection suite's exact pass count. Schema validity is distinct from correct extracted fields. These are single-run measurements, without statistical reliability claims.

The [usage ledger](usage.json) accounts for **US$0.070191336** at the archived catalogue's token prices, against a conservative fresh-run estimate of US$1.425. Project accounted spending is **US$1.860248516**, leaving **US$8.139751484** under ADR-56's US$10 cap. These are ledger estimates, not a fresh provider billing-page reconciliation. No budget configuration was changed.

The [source-bound progress record](progress.json) contains all twelve completed entries and fingerprint `c399cb46e397eec64aaf446bead79ba035d5db0abaf1962ad4a32303117496d4`. The adjacent checkpoints contain fixed case IDs and scores, with no raw model output or reasoning.

## Reproduction

From the repository root, inspect the retained scores without a provider request:

```sh
npm run ai:measure:deepinfra -- --status --selected-tier1 --campaign tier1-current-2026-11-08
```

The live invocation used the configured DeepInfra key:

```sh
AI_API_KEY="$AI_API_KEY_DeepInfra" npm run ai:measure:deepinfra -- --run --no-record --selected-tier1 --campaign tier1-current-2026-11-08
```

The run is finite, reserves spending before each request, retains completed case scores, and never retries a failed scored answer. All requests remain subject to the project US$10 cap and the existing inner DeepInfra accounting ceiling. A different source requires a fresh campaign name. A completed campaign resumes without sending its cases again.

## Release boundary

Routing thresholds measure schema validity and tool-call correctness; they do not establish perfect extraction, grounding or injection resistance. Review the per-suite exact accuracy and failed case IDs in [the report](tier1.md), including injection failures, before a release decision. Injection scoring checks allowed calls and a fixed canary, rather than arbitrary prose meaning; raw model output and reasoning are not retained.

No deployment measurements are recorded and every live AI generation action remains disabled. The selected order, prompts, suites, thresholds, financial schema and runtime composition are unchanged. Advanced/vision tier choices and scenario-engine work remain separate outstanding work.

## Verification

- **2,442 unit, 65 property and 632 PostgreSQL 17 integration tests pass** (3,139 total). Current-report regressions load each real model report through the production evidence aggregation and selector in memory, granting only Tier 1; archived-contract rejection checks still pass.
- The fake-provider campaign test exercises both complete plans, completed resume, cross-plan rejection, mandatory campaign naming, spending caps and refusal to record.
- Typecheck, lint, production build and client-secret scan pass. Financial integrity: **35 passing, zero failing**. The restored local PostgreSQL service was started and existing migrations/grants applied before successful integration/integrity verification. PostgreSQL 18 remains a CI check.
- A fetch-denied completed live-mode resume preserves all twelve checkpoints and the spending ledger byte-for-byte; it makes no provider call or score change.
