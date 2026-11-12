# Groq measurement workflow

<!-- project-doc-status:start -->
> **Status reviewed 12 November 2026:** Phase 8 quality/release review open; Phase 9 live AI disabled; Overview, Scenarios, metrics and TWR built; Phase 10 partial. OD-21/22/23 remain open. DeepInfra direct is selected.
> **Current references:** [Project state](../../PROJECT-STATE.md) · [Roadmap](../../docs/ROADMAP.md) · [Maintained deadline forecast](../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence; original score and finding body retained, source contracts may be historical.
<!-- project-doc-status:end -->

Status: offline reports finalized. 48/610 results retained; 562 cases unattempted; 1 unanswered.

| Tier | Model | Suite | Results | Passed / answered | Unanswered | Coverage |
|---|---|---|---|---|---|---|
| 1 | openai/gpt-oss-120b | parse | 40/40 | 35/40 | 0 | complete |
| 1 | openai/gpt-oss-120b | classify | 0/60 | 0/0 | 0 | pending |
| 1 | openai/gpt-oss-120b | tool-select | 0/30 | 0/0 | 0 | pending |
| 1 | openai/gpt-oss-120b | grounding | 0/25 | 0/0 | 0 | pending |
| 1 | openai/gpt-oss-120b | robustness | 0/10 | 0/0 | 0 | pending |
| 1 | openai/gpt-oss-120b | injection | 0/25 | 0/0 | 0 | pending |
| 1 | openai/gpt-oss-20b | parse | 0/40 | 0/0 | 0 | pending |
| 1 | openai/gpt-oss-20b | classify | 0/60 | 0/0 | 0 | pending |
| 1 | openai/gpt-oss-20b | tool-select | 0/30 | 0/0 | 0 | pending |
| 1 | openai/gpt-oss-20b | grounding | 0/25 | 0/0 | 0 | pending |
| 1 | openai/gpt-oss-20b | robustness | 8/10 | 3/7 | 1 | partial |
| 1 | openai/gpt-oss-20b | injection | 0/25 | 0/0 | 0 | pending |
| 2 | openai/gpt-oss-120b | tool-select | 0/30 | 0/0 | 0 | pending |
| 2 | openai/gpt-oss-120b | grounding | 0/25 | 0/0 | 0 | pending |
| 2 | openai/gpt-oss-120b | robustness | 0/10 | 0/0 | 0 | pending |
| 2 | openai/gpt-oss-120b | injection | 0/25 | 0/0 | 0 | pending |
| 2 | openai/gpt-oss-120b | analysis | 0/15 | 0/0 | 0 | pending |
| 3 | openai/gpt-oss-120b | tool-select | 0/30 | 0/0 | 0 | pending |
| 3 | openai/gpt-oss-120b | grounding | 0/25 | 0/0 | 0 | pending |
| 3 | openai/gpt-oss-120b | robustness | 0/10 | 0/0 | 0 | pending |
| 3 | openai/gpt-oss-120b | injection | 0/25 | 0/0 | 0 | pending |
| 3 | openai/gpt-oss-120b | analysis | 0/15 | 0/0 | 0 | pending |
| 4 | qwen/qwen3.8-27b | document | 0/20 | 0/0 | 0 | pending |

## Candidate readiness

- Tier 1 openai/gpt-oss-120b: Incomplete tier coverage: no routing proposal. Declaration notes: none
- Tier 1 openai/gpt-oss-20b: Incomplete tier coverage: no routing proposal. Declaration notes: parseTransaction: structured_output_unsupported; classifyTransaction: structured_output_unsupported
- Tier 2 openai/gpt-oss-120b: Incomplete tier coverage: no routing proposal. Declaration notes: Tier-specific measured eligibility must be reconciled before routing this model in this tier.
- Tier 3 openai/gpt-oss-120b: Incomplete tier coverage: no routing proposal. Declaration notes: Tier-specific measured eligibility must be reconciled before routing this model in this tier.
- Tier 4 qwen/qwen3.8-27b: Incomplete tier coverage: no routing proposal. Declaration notes: No declared capability entry.

Coverage is independent of quality: retain failures, apply the existing gates, and bring the completed per-tier proposal to the owner. This workflow never records live results, changes tier orders, retries a case, or merges the PR.
