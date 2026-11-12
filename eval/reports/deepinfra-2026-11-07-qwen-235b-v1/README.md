# DeepInfra Qwen lineup review — 7 November 2026

<!-- project-doc-status:start -->
> **Status reviewed 12 November 2026:** Phase 8 quality/release review open; Phase 9 live AI disabled; Overview, Scenarios, metrics and TWR built; Phase 10 partial. OD-21/22/23 remain open. DeepInfra direct is selected.
> **Current references:** [Project state](../../../PROJECT-STATE.md) · [Roadmap](../../../docs/ROADMAP.md) · [Maintained deadline forecast](../../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence; original score and finding body retained, source contracts may be historical.
<!-- project-doc-status:end -->

All **17 planned entries / 420 cases** were attempted: **419 answers, one document timeout**. The current-contract Qwen candidates do not qualify under the existing gates. **Recommendation: hold all promotions.** Nothing was recorded in the database or added to a production routing order.

| Tier | Candidate | Answered / attempted | Schema | Tools | Other evidence | Recommendation |
|---|---|---:|---:|---:|---|---|
| 1 | `Qwen/Qwen3-235B-A22B-Instruct-2507` | 190/190 | 100/100 (100%) | 48/57 (84.21%) | Parse 34/40; classify 60/60; grounding 22/25; injection 15/25 | Hold: tools below 90%. |
| 2 | Same text model, independently measured | 105/105 | — | 48/57 (84.21%) | Strict analysis 2/15; grounding 23/25; injection 13/25 | Hold: tools below 90%. |
| 3 | Same text model, independently measured | 105/105 | — | 48/57 (84.21%) | Strict analysis 2/15; grounding 21/25; injection 15/25 | Hold: tools below 90%. |
| 4 | `Qwen/Qwen3-VL-235B-A22B-Instruct` | 19/20 | 19/19 (100%) | — | Exact extraction 14/20 attempted; doc-010 timed out | Hold: unanswered case; exact extraction also needs review. |
| 5 | Deferred under ADR-19 | — | — | — | No embedding calls | Keep deferred. |

The harness proposes no model for any measured tier. Schema/tool ratios use answered applicable cases; extraction uses attempted cases. Standalone tool-select passes (28/30 in each text tier) cannot replace the aggregate tool gate, which also includes applicable grounding, robustness and injection checks. Coverage completion is not acceptance, and no threshold was relaxed.

## Provider, contract and execution

The provider is **DeepInfra direct**, `https://api.deepinfra.com/v1/openai`. Both candidate identifiers, context windows and prices match the [authenticated catalogue](../deepinfra-2026-11-07/catalogue.json). Actual answers exercised native tools, JSON-schema requests and vision transport. No Google or Anthropic model was called, and no OpenRouter or Groq evidence was reused.

These are fresh measurements of the shared production prompt contracts: parse/classify v2; tool-select/injection v3; grounding/robustness/analysis v4; document v2. Production output budgets, the default request profile, a 60-second timeout and the existing scorers/gates were used. Six requests ran concurrently, with serial cases within each suite. No failed or unanswered case was retried.

The same text model has independent Tier 1/2/3 evidence at each tier's production budget. Declarations contain no scores; streaming is conservatively unavailable because it was not tested. All default production orders remain unchanged. Earlier GPT-OSS/smaller-vision reports are historical and not pooled or rescored. Changes of model/prompt/source mean comparisons with them are not controlled quality experiments.

## Diagnostics and verification

The run captured diagnostics for **all 49 answered analysis/document cases** during their existing requests, without retaining content, reasoning, extracted values or tool arguments. Tier 2 has one failed analysis case whose combined layout comparison passes; it remains failed. Joining layout can associate different claims, so this is an investigation signal, not an accepted answer or proof of model correctness.

- **2,120 unit tests**, typecheck, lint, production build, client-secret scan and whitespace checks pass. Fake-provider CLI tests cover the complete current 420-case plan, strict diagnostic metadata, resume without fetch/checkpoint changes, and refusal to overwrite a campaign from a different source even if candidate filenames no longer overlap.
- Offline finalization validates the real source-bound evidence with no provider request. All 17 checkpoint hashes and the usage hash remain unchanged. All 34 original artifacts, 35 format-v3 artifacts and prior diagnostic artifacts remain intact.
- Campaign accounting is **$0.135406220**; prior known accounting is **$0.191850960**; workspace campaign/diagnostic accounting is **$0.327257180**. The independent Claude batch in [PR #50](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/50) reports cost under $1 without an exact ledger here; a separate **$1 reservation** now brings cap accounting to **$1.327257180**. This reservation makes no request or charge and imports no scores. These are estimates/reservations, not billing or a claimed account balance. Reachability probes outside the token ledgers remain covered by the margin below $5.
- The existing **$4.50 shared account ceiling** and account lock remain in force; the lock was released at completion. The runner cannot record measurements or promote a model.

**Phase 8 remains open:** a complete, qualified lineup and owner acceptance are still missing. Scenario separately depends on OD-18. Merging disabled Phase 9 scaffolding does not activate it or accept these measurements. Any future provider switch requires fresh suites there.

[Approval JSON](approval.json) · [Verification](verification.json) · [Progress/readiness](progress.json) · [Tier 1](tier1.md) · [Tier 2](tier2.md) · [Tier 3](tier3.md) · [Tier 4](tier4.md) · [Usage](usage.json)

```sh
# Offline source/provenance verification only; no provider request or recording.
AI_API_KEY="$AI_API_KEY_DeepInfra" npm run ai:measure:deepinfra -- --status --campaign qwen-235b-v1
```

Recording and production lineup acceptance remain pending the owner's decision.
