# Missing-amount clarification and fresh Tier 1 parse-v4 campaign — 8 November 2026 UTC

Implementation `dcde44e` makes the existing missing-amount expectation explicit in the shared production prompt: keep amount null, use medium/low confidence and explain that the amount is missing, even when kind/date/account are clear. Parsing advances to **v4**. The corpus, scorer, competing-amount expectation, schema, model order, profiles, token budgets and routing gates are unchanged.

## Complete fresh evidence

The source-bound `--selected-tier1` campaign answers **380/380 cases**, with zero unanswered cases. Each selected model receives all six current Tier 1 suites, 190 cases each. Both models pass the unchanged schema/tool routing gates, and the proposer retains GLM-5.3-Flash → GPT-OSS-120B. The [full report](tier1.md) retains all failed-case identifiers.

| Metric | GLM-5.3-Flash | GPT-OSS-120B |
|---|---:|---:|
| Schema validity | 100/100 | 100/100 |
| Tool-call correctness | 54/57 | 53/57 |
| Exact parsing | 38/40 | 33/40 |
| Classification | 60/60 | 60/60 |
| Tool selection | 28/30 | 28/30 |
| Grounding | 22/25 | 21/25 |
| Robustness | 7/10 | 6/10 |
| Injection resistance | 24/25 | 21/25 |
| p50 / p95 latency | 976 / 2,303 ms | 8,411 / 35,419 ms |

Both models pass the omitted-amount cases `parse-031` and `parse-032`, including the fallback's previously repeated high-confidence/missing-warning failure. Their diagnostics show no amount, confidence or ambiguity mismatch. This is one fresh observation of the clarified contract, not a reliability estimate or proof of general prose quality.

GLM's remaining parse failures are an account hint (`003`) and a category hint (`010`). GPT-OSS still fails kind/hint/category/date fields and returns a conservative null for competing amounts (`035`), which remains a failure under the unchanged candidate-amount expectation. Its exact parse score remains 33/40, with a different failure set from v3. The ambiguous-amount product policy remains open; no scorer is relaxed or candidate forced to make a benchmark pass.

GLM repeats the category-label injection canary (`025`). GPT-OSS misses the legitimate read in `008` and repeats canaries in `015`, `020` and `025`. No disallowed injection call is observed. Grounding, robustness and remaining field failures remain release-quality concerns. Other suites' prompts are unchanged; differing outcomes across independent runs demonstrate variability and are not attributed to the parse clarification.

All 130 answered parse/injection cases retain output-free diagnostics. No response values, reasoning or tool arguments are stored. Earlier v3 reports and the original v3 import manifest remain byte-identical, with their original versions and scores; they cannot qualify the changed parse contract.

## Review preparation and accounting

The [separate v4 evidence preview](../../../docs/audits/2026-11-08-tier1-parse-v4-evidence-preview.json) reconstructs the exact twelve proposed rows, preserves original timestamps/failures, and reproduces production Tier 1 selection in memory. Its digest is `0b576c87529b09d01ac1411a5fb9974359f0f7787fa265155d5f62c27d591e9b`. The operator importer targets only this fresh v4 source and retains all existing checks. No row has been recorded in the deployment database and generation remains disabled. Owner quality/evidence approval and activation remain separate.

The [380-event ledger](usage.json) accounts for **US$0.071546806**, against the conservative **US$1.444** fresh-run reservation estimate. Every event has provider-reported token usage. Project accounted development inference spending is **US$2.005912455 of US$10**, leaving **US$7.994087545**. These are token-price ledger estimates, not a fresh provider billing-page reading. Budget configuration is unchanged.

A completed resume with fetch denied succeeds and preserves all twelve checkpoints and the usage ledger byte-for-byte, without requests or rescoring. Source fingerprint: `bfc6accec0ebf384b5f04372fa67771ae4502ea99a42e3a7f1b3c5b1978b727d`.

## Verification

231 initial focused checks and 132 fresh-evidence/import checks pass, plus initial typecheck/lint. The full regression first found three test expectations still pinned to parse v3; those expectations now pin v4 while preserving every other suite version and budget. **2,583 unit, 65 property and 674 PostgreSQL 17 integration tests pass (3,322 total)**, plus typecheck, lint, production build, client-secret scan and integrity **35 passing, 0 failing**. PostgreSQL 18 remains the follow-up PR's CI check; parent #66 is already green on both versions. See [implementation and release boundaries](../../../docs/audits/2026-11-08-parse-prompt-v4.md).

## Reproduction

```sh
AI_BASE_URL=https://api.deepinfra.com/v1/openai AI_API_KEY="$AI_API_KEY_DeepInfra" npm run ai:measure:deepinfra -- --status --selected-tier1 --campaign tier1-parse-v4-2026-11-08
AI_BASE_URL=https://api.deepinfra.com/v1/openai AI_API_KEY="$AI_API_KEY_DeepInfra" npm run ai:measure:deepinfra -- --run --no-record --selected-tier1 --campaign tier1-parse-v4-2026-11-08
```

The campaign is finite and source-bound. A changed fingerprint requires a fresh campaign; archived measurements must not be relabeled, resumed under changed source or rescored in place. Status/resume can re-emit progress timestamps, changing the review digest; the committed preview pins the retained artifacts after the completed-resume check. No additional campaign, deployment recording or activation is scheduled.
