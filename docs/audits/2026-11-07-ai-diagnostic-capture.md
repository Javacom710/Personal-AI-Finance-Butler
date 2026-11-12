# Diagnostic capture and layout comparisons — 7 November 2026

<!-- project-doc-status:start -->
> **Status reviewed 12 November 2026:** Phase 8 quality/release review open; Phase 9 live AI disabled; Overview, Scenarios, metrics and TWR built; Phase 10 partial. OD-21/22/23 remain open. DeepInfra direct is selected.
> **Current references:** [Project state](../../PROJECT-STATE.md) · [Roadmap](../ROADMAP.md) · [Maintained deadline forecast](../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence; original score and finding body retained, source contracts may be historical.
<!-- project-doc-status:end -->

Phase 8's saved reason counts did not distinguish layout-sensitive matching from other failures. Added bounded comparisons and automatic diagnostic capture to make future full campaigns explainable without retaining model responses or making extra provider calls.

## Implementation

- Analysis diagnostics compare the original answer with whitespace joined, paired inline Markdown removed, and both transformations combined. Only boolean verdicts and fixed counts are retained. The original scorer remains authoritative. Joining layout can associate different claims, so a comparison pass is a hypothesis to investigate, never an accepted answer or proof that a model was correct.
- Future DeepInfra full campaigns capture analysis/document diagnostics during the existing request, keyed to the retained case. Tier JSON reports summarize authoritative passes/failures and reason counts; failed cases that pass a layout comparison are counted separately. No comparison enters a score, routing proposal or database measurement.
- Strict metadata validation permits fixed count/reason keys only. Resume refuses unknown fields, strings in counts, unsupported suites, missing/foreign cases, provider-error cases and verdicts inconsistent with the retained score. Invalid checkpoint metadata produces a fixed error without echoing attacker-supplied field names into CLI logs.
- The coordinator's source fingerprint now includes the diagnostic helper. Resume preserves captured metadata and makes no additional request; historical source-bound checkpoints are not relabeled. No prompt, suite version, rubric, threshold, provider control or production order changed in this step.

## Verification and fresh observations

**2,120 unit tests**, typecheck, lint, production build, client-secret scan and whitespace checks pass.

The current full fake-provider queue tests cover all 420 Qwen-plan cases, capture diagnostics for 15 Tier 2 analysis, 15 Tier 3 analysis and 20 document answers, verify output/reasoning sentinels are absent, and resume with byte-identical checkpoints and no fetch. Unit tests also reproduce layout sensitivity with controlled supported answers and verify wrong figures and unwanted calls still fail the comparison. These controlled examples do not explain every historical failure.

Three fresh DeepInfra GPT-OSS-120B analysis probes answered normally and **all failed both the authoritative score and every layout comparison**:

| Case | Existing rubric observations |
|---|---|
| analysis-001 | 29 untraceable occurrences; three required figure groups, one finding pattern and two metric bindings missing. |
| analysis-006 | Eight untraceable occurrences; three required figure groups and three metric bindings missing. |
| analysis-015 | Required figures and bindings present; three required finding patterns unmatched. |

These samples do not support line wrapping or the tested inline Markdown as the explanation for their failures. Reason counts remain observations under the strict rubric; general prose quality and semantic paraphrases are not judged. Raw responses were not retained. No scorer relaxation follows from these probes. A separate current-contract Qwen candidate campaign follows because the GPT-OSS/smaller-vision candidates remain unqualified. Candidate quality/current full-tier evidence and owner acceptance remain unresolved.

Added accounting is **$0.000800277**; combined known DeepInfra accounting is **$0.191850960**, including unknown-usage reservations. This is not a billing statement. The shared $4.50 account ceiling and $0.25 diagnostic ceiling remain unchanged, and the account lock is released.

All 34 original measurement artifacts, 35 format-v3 artifacts and five earlier diagnostic/verification JSON artifacts remain byte-identical. Nothing was recorded or promoted; Phase 8 stays open.

[Diagnostic report](../../eval/reports/deepinfra-2026-11-07/diagnostics/2026-11-07T10-11-36-657Z.json) · [Verification JSON](2026-11-07-ai-diagnostic-capture-verification.json)
