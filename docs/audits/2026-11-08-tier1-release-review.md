# Tier 1 release review — 8 November 2026

**Status: prepared for review; generation remains disabled.** This packet describes the concrete transaction-draft and saved-question paths built on PRs #62–#63 and the generation-form follow-up. It does not accept the remaining quality failures, record measurements, release the code hold, enable settings or deploy anything.

## Scope of a future Tier 1 release

The selected provider is DeepInfra direct, with GLM-5.3-Flash followed by GPT-OSS-120B. Both transaction descriptions and routine saved questions would use the authenticated session, the owner-bound `composeTier1Features` adapter and `runAiCapability` on every model turn, continuation and parse repair. The runtime retains the owner kill switch, per-user rate limits, persisted daily request/token budget, measured capability checks and trusted read-only tool registry.

A transaction description creates an unconfirmed draft. The existing review screen, explicit confirmation, ordinary transaction/transfer commands and atomic audit/linkage remain necessary before financial records change. A saved question stores its complete user/assistant exchange atomically; original text and authoritative serving-tier history determine intent. Unsupported advanced intent returns unavailable before egress. Forms preserve typed text after refused requests and disable submission while pending. Archived/full conversations remain unaskable.

Only these two Tier 1 entry points use the prepared release hold. Monthly, portfolio, health, period and cross-domain reviews, documents and scenarios retain their existing disabled boundaries. Tier 2–4 orders remain empty. User text, client form fields, environment flags and possession of an API key cannot release `isTier1GenerationReleased()`.

## Evidence the owner is reviewing

The [full current-contract campaign](../../eval/reports/deepinfra-2026-11-07-tier1-parse-v3-2026-11-08/README.md) contains 190 answered cases per model, zero unanswered cases, provider/request-profile provenance, failed-case identifiers and output-free diagnostics. Parsing is v3; the other contracts are unchanged. Earlier parse-v2 reports do not qualify for the current parsing contract.

| Metric | GLM-5.3-Flash | GPT-OSS-120B |
|---|---:|---:|
| Schema validity | 100/100 | 100/100 |
| Tool-call correctness | 54/57 | 53/57 |
| Exact parsing | 36/40 | 33/40 |
| Grounding | 22/25 | 21/25 |
| Robustness | 6/10 | 6/10 |
| Injection resistance | 25/25 | 21/25 |

The unchanged routing gates accept both models. Remaining release-quality concerns include amount/field mismatches, incomplete grounding and robustness, and fallback injection failures. GPT-OSS missed one legitimate required read and repeated canaries in three cases; no disallowed call was observed in that finite injection run. GLM's 25/25 is one run. The reports do not establish reliability beyond the measured cases or certify arbitrary prose quality. Draft review protects recording, while incorrect read-only prose still needs source inspection and a release-quality decision.

The owner has selected the lineup. Acceptance of these remaining failures for live use is still outstanding. A decision to improve quality first would require a concrete change proposal, contract-version handling where applicable and fresh evidence; old reports must remain intact.

## Remaining release steps

1. Review the final stacked code/CI and decide whether to accept the documented quality limitations or improve them before release. Approval must specify the two Tier 1 workflows and this measured lineup.
2. Prepare and review deployment evidence recording. The finite measurement coordinator intentionally refuses recording. `recordEvaluationRun` is the normal validation boundary, but retained coordinator reports require a reviewed conversion/import procedure; none is added here. Verify endpoint, current suite versions, complete coverage, request profiles and the resulting capability selection before accepting deployment rows. Do not treat synthetic test matrices as recorded evidence.
3. Prepare a reviewed change releasing the code-only hold for these entry points. Align the deployment provider/model configuration with the accepted evidence and verify the owner setting and existing runtime limits. Keep other feature holds and tier orders unchanged.
4. Within an approved inference allowance, verify the live description → draft → reviewed confirmation workflow and the conversation → question → grounded sources workflow, including refusal/error behavior. Check actual metering and financial invariants. Readiness tests with fake actions do not replace this live verification.

No release step above has been performed. Accounted development inference spending remains **US$1.932521049 of US$10**, leaving **US$8.067478951**. The current form/review work uses no paid inference. Runtime daily limits count requests/tokens and do not replace the owner's development spending cap.

## Rollback after any future release

Reinstate the false code hold to close both entry points before context/provider composition, rebuild and deploy. The per-owner AI setting independently stops runtime egress on every subsequent model turn. Existing manual entry and proposal confirmation/history management remain available. Do not remove accepted evidence or financial/audit history as a rollback shortcut.
