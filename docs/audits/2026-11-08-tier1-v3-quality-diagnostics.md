# Tier 1 parse-v3 failure investigation — 8 November 2026

<!-- project-doc-status:start -->
> **Status reviewed 12 November 2026:** Phase 8 quality/release review open; Phase 9 live AI disabled; Overview, Scenarios, metrics and TWR built; Phase 10 partial. OD-21/22/23 remain open. DeepInfra direct is selected.
> **Current references:** [Project state](../../PROJECT-STATE.md) · [Roadmap](../ROADMAP.md) · [Maintained deadline forecast](../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence; original score and finding body retained, source contracts may be historical.
<!-- project-doc-status:end -->

Continues CI-green PR #65 (`17904bc`, PostgreSQL 17/18) without accepting model-quality failures, recording deployment evidence or releasing generation. The importer and the twelve-row manifest remain ready for owner review. This follow-up investigates the remaining parse/injection failures in the current full campaign.

## Fixed probe plan

`ai:diagnose:deepinfra --tier1-v3-failures` selects fifteen existing synthetic golden cases: the primary's four parse failures, the fallback's seven parse failures and four injection failures. It follows the reviewed default Tier 1 pair, ignoring environment lineup overrides. The default advanced/document and earlier nine-case Tier 1 plans are preserved. Duplicate/conflicting plan flags and arbitrary case/model overrides are refused.

All probes use the unchanged production prompts, suite versions, request profiles, scorers and token budgets. The diagnostic report names the selected plan and its source fingerprint binds the fixed probe list. Reports and usage accounting have a new directory; no earlier campaign or diagnostic artifact is rewritten. The maximum conservative request reservation for the fifteen cases is **US$0.03407811**, within the existing project, account and diagnostic caps. Each request is reserved before egress; errors are not retried.

## Amount diagnostics

The existing `amount` mismatch count remains unchanged. Three fixed counters distinguish its shape: `amount_missing` for a null where a stated amount is expected, `amount_unexpected` for a value where no amount was stated, and `amount_different` for a non-null value outside the expected alternatives. The counters contain no returned digits or text. Equivalent decimal strings and either permitted amount alternative remain accepted by the unchanged scorer.

The diagnostic verdict still comes directly from the authoritative scorer. New counters explain a failure; they cannot turn one into a pass or change a production rule. Strict metadata validation continues to reject arbitrary keys or values. Earlier retained diagnostics and the evidence-import manifest remain byte-identical and valid.

## Verification and outcome

Focused typecheck/lint and 191 unit checks pass, including six new amount-shape cases, all existing parse/injection scorer agreement/privacy checks, every diagnostic CLI plan and the committed evidence-manifest pin. The finite probe answers all fifteen requests: five earlier failures do not recur and ten repeat. Both models return conservative nulls for competing amounts; this still fails the frozen expectation. Two fallback canary failures and a missing-amount confidence/ambiguity failure recur. Probe accounting is US$0.0018446, bringing project total to US$1.934365649 (US$8.065634351 remaining). **2,578 unit and 65 property tests, 13 PostgreSQL 17 import regression checks, typecheck, lint, production build, client-secret scan and integrity (35 passing, 0 failing) pass.** The base PR #65's full 674-test integration suite is CI-green on PostgreSQL 17/18; no production/runtime/financial-engine code changes here. The follow-up retains the normal full CI matrix.

The [probe results](../../eval/reports/deepinfra-2026-11-08-tier1-v3-failures/README.md) are targeted observations, not a full measurement or a reliability estimate. They do not replace the earlier 380-case qualification campaign or make any model production-eligible. Remaining grounding/robustness failures and unselected advanced/vision tiers remain outside this probe. Live generation stays disabled.
