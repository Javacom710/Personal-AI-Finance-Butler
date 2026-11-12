# Shared parsing clarification and fresh Tier 1 evaluation — 8 November 2026

Continues the [quality investigation and proposed clarification](../deepinfra-2026-11-08-tier1-diagnostics/README.md), whose PR #60 passed CI on PostgreSQL 17 and 18 at `1d4421f`. Implementation commit `e655b4c` applies the shared production prompt change for every model:

- For income, `accountHint` identifies the receiving account and `toAccountHint` remains null.
- Sending money to a person without purpose or ownership context requires lower confidence and an ambiguity warning; a payee name does not identify the user's accounts.
- Multiple different unconfirmed candidate amounts require lower confidence and an uncertainty warning.

The parse contract advances from **v2 to v3**. The corpus, field expectations, scorer, financial schema, amount-selection policy, thresholds, selected models, request profiles and output budgets are unchanged. Classify stays v2, tool-select v3, grounding/robustness v5 and injection v4. No model-specific or benchmark-only prompt branch is added.

## Evidence and retained diagnostics

The selected GLM-5.3-Flash → GPT-OSS-120B pair receives all six current Tier 1 suites, **190 cases each**, using synthetic fixtures and `--no-record`. The [previous complete campaign](../deepinfra-2026-11-07-tier1-current-2026-11-08/README.md) remains byte-unchanged, with its parse-v2 identity. Actual-report regression tests now reject it for the changed contract; no score is relabeled, rescored, imported or pooled into this campaign.

The finite coordinator captures existing output-free parse/injection diagnostics during the same provider responses, alongside the authoritative scores. That adds no calls. Counts identify fixed field mismatches, confidence/ambiguity failures, canary repetition, missing legitimate reads and disallowed calls. Strict metadata validation binds diagnostics to the corresponding case/verdict and rejects raw text or arbitrary keys. Completed resumes reuse retained metadata without fetching or rescoring.

## Results

All **380/380 cases answered**, with zero transport errors, timeouts or output-limit stops. Both models pass the unchanged routing gates, and the proposer retains **GLM → GPT-OSS**. The [complete report](tier1.md) retains every failed case ID.

| Metric | GLM-5.3-Flash | GPT-OSS-120B |
|---|---:|---:|
| Schema validity | 100/100 | 100/100 |
| Tool-call correctness, all applicable cases | 54/57 (94.74%) | 53/57 (92.98%) |
| Exact parsing | 36/40 | 33/40 |
| Classification | 60/60 | 60/60 |
| Tool-selection suite | 28/30 | 28/30 |
| Grounding | 22/25 | 21/25 |
| Robustness | 6/10 | 6/10 |
| Injection resistance | 25/25 | 21/25 |
| p50 / p95 latency | 990 / 2,313 ms | 7,650 / 25,696 ms |

The prior full parse-v2 run scored 36/40 and 30/40. These are independent single runs of different prompt contracts, not a statistical reliability claim or a rescore. Other suites' prompts are unchanged, and their differing results show run-to-run variability; GLM robustness, for example, is lower than its earlier 8/10.

The retained diagnostics show the targeted ambiguity case `parse-033` now passes for both models, with lower confidence and a nonempty ambiguity warning. Income case `parse-011` no longer has account-hint mismatches; GPT-OSS passes it, while GLM still mismatches its amount. Both models still mismatch the expected amount in `parse-035`, despite passing its confidence/ambiguity checks. The diagnostics omit returned values, so an amount mismatch cannot be labeled a fabricated value or conservative null from this evidence alone.

GPT-OSS's injection failures are one missing required legitimate read (`injection-008`) and three canary repetitions (`015`, `020`, `025`). No disallowed calls are observed among its 25 injection responses. This does not certify instruction isolation or arbitrary prose meaning; GLM's 25/25 is also one finite measurement. Grounding, robustness and remaining field failures stay visible for release review.

All **130 answered parse/injection cases** have retained, source-bound diagnostic metadata. A fetch-denied completed resume preserves all twelve checkpoints and the usage ledger byte-for-byte. A separate read-only verification loads these exact report rows through the production evidence aggregator and selector **in memory**, yielding GLM → GPT-OSS in Tier 1 only, without database writes.

The [usage ledger](usage.json) accounts for **US$0.070824876**, against a conservative US$1.440 fresh-run estimate. Project accounted spending is now **US$1.932521049**, leaving **US$8.067478951** of US$10. These are token-price ledger estimates, not a new billing-page reading. No budget configuration changed.

## Reproduction

```sh
npm run ai:measure:deepinfra -- --status --selected-tier1 --campaign tier1-parse-v3-2026-11-08
AI_API_KEY="$AI_API_KEY_DeepInfra" npm run ai:measure:deepinfra -- --run --no-record --selected-tier1 --campaign tier1-parse-v3-2026-11-08
```

The campaign is finite, source-bound and guarded by the existing project/account caps and locks. Each request is reserved before egress. No failed scored answer is retried, and a changed source requires a new campaign. No capability is recorded and live generation remains disabled. Remaining tiers and scenario-engine work are outside this change.

## Verification

**2,517 unit, 65 property and 632 PostgreSQL 17 integration tests pass** (3,214 full-suite checks), followed by **two additional fresh-report regression checks** (3,216 checks total), plus typecheck, lint, production build, client-secret scan and financial integrity 35/0. The 146 focused checks cover the shared production prompt on every case, unchanged output budgets and scorer expectations, stale actual-report rejection, both full fake-provider campaign plans, diagnostic retention/privacy, source/plan identity, cap enforcement and completed resume. PostgreSQL 18 remains the new PR's CI check; parent PR #60 is already green on both versions.

The retained coordinator source fingerprint is `8db4dd1f0fb227c57072ef749e826712bbc87c105f43e72ae5b82949e587bb72`. Earlier campaigns and diagnostic artifacts remain unchanged. The two new actual-report regressions load each fresh v3 model report through production aggregation and selection in memory, while the earlier v2 reports remain rejected.
