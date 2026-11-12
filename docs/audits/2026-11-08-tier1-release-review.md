# Tier 1 release review — 8 November 2026

<!-- project-doc-status:start -->
> **Status reviewed 12 November 2026:** Phase 8 quality/release review open; Phase 9 live AI disabled; Overview, Scenarios, metrics and TWR built; Phase 10 partial. OD-21/22/23 remain open. DeepInfra direct is selected.
> **Current references:** [Project state](../../PROJECT-STATE.md) · [Roadmap](../ROADMAP.md) · [Maintained deadline forecast](../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence; original score and finding body retained, source contracts may be historical.
<!-- project-doc-status:end -->

**Status: prepared for review; generation remains disabled.** This packet describes the concrete transaction-draft and saved-question paths built on PRs #62–#63 and the generation-form follow-up. It does not accept the remaining quality failures, record measurements, release the code hold, enable settings or deploy anything.

## Scope of a future Tier 1 release

The selected provider is DeepInfra direct, with GLM-5.3-Flash followed by GPT-OSS-120B. Both transaction descriptions and routine saved questions would use the authenticated session, the owner-bound `composeTier1Features` adapter and `runAiCapability` on every model turn, continuation and parse repair. The runtime retains the owner kill switch, per-user rate limits, persisted daily request/token budget, measured capability checks and trusted read-only tool registry.

A transaction description creates an unconfirmed draft. The existing review screen, explicit confirmation, ordinary transaction/transfer commands and atomic audit/linkage remain necessary before financial records change. A saved question stores its complete user/assistant exchange atomically; original text and authoritative serving-tier history determine intent. Unsupported advanced intent returns unavailable before egress. Forms preserve typed text after refused requests and disable submission while pending. Archived/full conversations remain unaskable.

Only these two Tier 1 entry points use the prepared release hold. Monthly, portfolio, health, period and cross-domain reviews, documents and scenarios retain their existing disabled boundaries. Tier 2–4 orders remain empty. User text, client form fields, environment flags and possession of an API key cannot release `isTier1GenerationReleased()`.

## Evidence the owner is reviewing

The [full current-contract campaign](../../eval/reports/deepinfra-2026-11-07-tier1-parse-v4-2026-11-08/README.md) contains 190 answered cases per model, zero unanswered cases, provider/request-profile provenance, failed-case identifiers and output-free diagnostics. Parsing is v4; the other contracts are unchanged. Earlier parse-v2/v3 reports do not qualify for the current parsing contract.

| Metric | GLM-5.3-Flash | GPT-OSS-120B |
|---|---:|---:|
| Schema validity | 100/100 | 100/100 |
| Tool-call correctness | 54/57 | 53/57 |
| Exact parsing | 38/40 | 33/40 |
| Grounding | 22/25 | 21/25 |
| Robustness | 7/10 | 6/10 |
| Injection resistance | 24/25 | 21/25 |

The unchanged routing gates accept both models. Remaining release-quality concerns include amount/field mismatches, incomplete grounding and robustness, and fallback injection failures. GPT-OSS missed one legitimate required read and repeated canaries in three cases; no disallowed call was observed in that finite injection run. GLM also repeats a category-label canary in this run. These are finite observations. The reports do not establish reliability beyond the measured cases or certify arbitrary prose quality. Draft review protects recording, while incorrect read-only prose still needs source inspection and a release-quality decision.

The owner has selected the lineup. Acceptance of these remaining failures for live use is still outstanding. A decision to improve quality first would require a concrete change proposal, contract-version handling where applicable and fresh evidence; old reports must remain intact.

## Targeted current-contract follow-up

The [fifteen-case failure investigation](../../eval/reports/deepinfra-2026-11-08-tier1-v3-failures/README.md) answered all probes: five earlier failures did not recur and ten repeated. Both models returned null, with uncertainty flagged, for two unconfirmed amounts. This still fails the frozen expectation accepting either stated candidate; it exposes a product-policy decision before any prompt/scorer change. The existing draft-review path handles null amounts without recording them. GPT-OSS again repeated canaries in two tool-result probes; a later passing observation in the other two cases does not replace the full campaign's injection result. All original scores and the import manifest/digest remain unchanged. Deployment recording and generation remain off.

## Current missing-amount clarification and v4 evidence

The [v4 prompt/evidence update](2026-11-08-parse-prompt-v4.md) makes the existing omitted-amount confidence/warning expectation explicit, with no corpus/scorer change. All 380 cases answer, both models pass `parse-031`/`032`, and the unchanged routing gates retain the selected pair. Remaining field/injection/grounding/robustness failures stay visible in the table above. The fallback's 33/40 parsing score is unchanged despite a different failure set. Independent run differences do not establish a general reliability improvement.

The prepared operator import now targets the fresh v4 source and [separate current manifest](2026-11-08-tier1-parse-v4-evidence-preview.json), digest `0b576c87529b09d01ac1411a5fb9974359f0f7787fa265155d5f62c27d591e9b`. The original v3 preview remains archived and unchanged; its digest is stale for this prompt. No deployment recording or activation has occurred. Review update: 9 November 2026 (Asia/Calcutta).

## Remaining release steps

1. Review the final stacked code/CI and decide whether to accept the documented quality limitations or improve them before release. Approval must specify the two Tier 1 workflows and this measured lineup.
2. Prepare and review deployment evidence recording. The finite measurement coordinator intentionally refuses recording. `recordEvaluationRun` remains the normal validation boundary. The [current v4 import preparation](2026-11-08-parse-prompt-v4.md) and its [exact twelve-row v4 preview](2026-11-08-tier1-parse-v4-evidence-preview.json) are now prepared for review; its write mode has not been run against the deployment database. Verify endpoint, current suite versions, complete coverage, request profiles and the resulting capability selection before accepting deployment rows. Do not treat synthetic test matrices as recorded evidence.
3. Prepare a reviewed change releasing the code-only hold for these entry points. Align the deployment provider/model configuration with the accepted evidence and verify the owner setting and existing runtime limits. Keep other feature holds and tier orders unchanged.
4. Within an approved inference allowance, verify the live description → draft → reviewed confirmation workflow and the conversation → question → grounded sources workflow, including refusal/error behavior. Check actual metering and financial invariants. Readiness tests with fake actions do not replace this live verification.

No deployment evidence recording, release-hold change, settings change, deployment or live verification has been performed. Import code and its pinned preview are prepared for review. Accounted development inference spending remains **US$2.005912455 of US$10**, leaving **US$7.994087545** after the targeted follow-up and complete v4 campaign. The v4 campaign accounts for US$0.071546806; form/import preparation itself uses no paid inference. Runtime daily limits count requests/tokens and do not replace the owner's development spending cap.

## Rollback after any future release

Reinstate the false code hold to close both entry points before context/provider composition, rebuild and deploy. The per-owner AI setting independently stops runtime egress on every subsequent model turn. Existing manual entry and proposal confirmation/history management remain available. Do not remove accepted evidence or financial/audit history as a rollback shortcut.
