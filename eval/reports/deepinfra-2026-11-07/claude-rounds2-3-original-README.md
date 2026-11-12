# DeepInfra measurements — 2026-11-07

<!-- project-doc-status:start -->
> **Status reviewed 12 November 2026:** Phase 8 quality/release review open; Phase 9 live AI disabled; Overview, Scenarios, metrics and TWR built; Phase 10 partial. OD-21/22/23 remain open. DeepInfra direct is selected.
> **Current references:** [Project state](../../../PROJECT-STATE.md) · [Roadmap](../../../docs/ROADMAP.md) · [Maintained deadline forecast](../../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence; original score and finding body retained, source contracts may be historical.
<!-- project-doc-status:end -->

Provider: `https://api.deepinfra.com/v1/openai` (owner's prepaid testing provider, PR #49). Base: `main` at `3dd38f2`. Every run used the unchanged `npm run ai:eval -- --tier <n> --model <id> --no-record` from a Claude cloud session (`NODE_USE_ENV_PROXY=1`). Synthetic golden fixtures only. No gate, prompt, scorer, suite, request profile, tier order or database row was changed. Cost well under US$1 of the US$5 credit.

| Tier | Model | Report | Per-suite passes | Unanswered | Verdict (unchanged gates) |
|---|---|---|---|---|---|
| 1 | `openai/gpt-oss-120b` | [07-44-06-tier1](../2026-11-07T07-44-06-tier1.md) | parse 31/40 · classify 60/60 · tool-select 28/30 · grounding 21/25 · robustness 5/10 · injection 16/25 | 0 | **Complete; fails** tool-call correctness 0.86 < 0.90. Schema 1.00, grounding 0.84, injection 0.64 |
| 1 | `openai/gpt-oss-20b` | [07-44-09-tier1](../2026-11-07T07-44-09-tier1.md) | parse 27/40 · classify 57/60 · tool-select 27/30 · grounding 15/25 · robustness 4/10 · injection 18/25 | 1 | Incomplete (1 transport). Would also fail: schema 0.94 < 0.95, tool 0.84 |
| 2 | `openai/gpt-oss-120b` | [07-44-12-tier2](../2026-11-07T07-44-12-tier2.md) | tool-select 28/30 · grounding 22/25 · robustness 5/10 · injection 14/25 · analysis 0/14 answered | 1 | Incomplete; tool 0.86 |
| 3 | `openai/gpt-oss-120b` | [07-44-15-tier3](../2026-11-07T07-44-15-tier3.md) | tool-select 29/30 · grounding 20/25 · robustness 5/10 · injection 14/25 · analysis 1/13 answered | 2 | Incomplete; tool 0.84 |
| 4 | `Qwen/Qwen3.8-27B` | [07-44-18-tier4](../2026-11-07T07-44-18-tier4.md) | document 6/10 answered, 10/10 schema-valid | 10 | Incomplete |

**No order is proposed for any tier.** This is the first complete Tier 1 suite set for any model on any provider (120B, zero unanswered).

## Findings

1. **Unanswered = the session proxy, not the model.** All 10 Tier 4 failures ended at ~30 s (p50 30,077 ms), the same egress-proxy cut seen on NVIDIA (2026-11-01). The text-tier transport errors are likely the same long-request cut. Run from the PC or a Codex environment to clear them.
2. **`analysis` is near zero for every model measured so far** (GPT-OSS-120B 0/14 and 1/13 here; NVIDIA Ultra 1/15 on 2026-11-01). Answers mostly end `stop`. A suite every capable model fails may be scoring wording strictly rather than quality. It ranks but does not gate. Reviewing it changes a scorer, so it needs the owner's approval.
3. **Tool-call correctness is the blocking Tier 1 gate** (0.86 vs 0.90). It mixes tool-select (28/30) with injection and grounding tool turns; the injection suite (16/25) is the main drag.
4. Parse dropped from 35/40 (Groq, 2026-11-02) to 31/40 here on the same model and suite version: hosts differ, so the reports are provider-qualified and must not be pooled.

## Owner decisions needed

- Accept that no Tier 1–3 GPT-OSS lineup passes the unchanged gates on DeepInfra, or choose other DeepInfra candidates to measure (catalogue includes `deepseek-ai/DeepSeek-V4.1-Flash`, `zai-org/GLM-5.3`, `Qwen/Qwen3.8-Flash`, `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B`, `Qwen/Qwen3-VL-235B-A22B-Instruct`).
- Whether to review the `analysis` scorer (finding 2).
- Re-run the unanswered cases from a host without the 30 s cut.

## Second round — 2026-11-07 14:10 UTC (owner-selected candidates)

Owner chose, by pop-up, to measure more DeepInfra candidates against the unchanged gates. Same command (`ai:eval --no-record`), same suite versions (v2), run in parallel from a Claude cloud session.

| Tier | Model | Report | Schema | Tool-call | Grounding | Injection | p50 ms | Unanswered | Per-suite passes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `zai-org/GLM-5.3-Flash` | [14-10-22-tier1](../2026-11-07T14-10-22-tier1.md) | 1.00 | **0.86** | 0.84 | 0.76 | 687 | 0 | parse 37/40 · classify 60/60 · tool-select 29/30 · grounding 21/25 · robustness 7/10 · injection 19/25 |
| 1 | `deepseek-ai/DeepSeek-V4.1-Flash` | [14-10-19-tier1](../2026-11-07T14-10-19-tier1.md) | 1.00 | 0.80 | 0.84 | 0.80 | 959 | 0 | parse 32/40 · classify 60/60 · tool-select 24/30 · grounding 21/25 · robustness 9/10 · injection 20/25 |
| 1 | `Qwen/Qwen3.8-Flash` | [14-10-16-tier1](../2026-11-07T14-10-16-tier1.md) | 1.00 | 0.64 | 0.68 | 0.76 | 2922 | 4 | parse 33/40 · classify 60/60 · tool-select 23/30 · grounding 17/25 · robustness 4/10 · injection 19/25 |
| 1 | `moonshotai/Kimi-K2.6` | [14-10-25-tier1](../2026-11-07T14-10-25-tier1.md) | 1.00 | 0.85 | 0.94 | 0.50 | 1816 | **83** | mostly unanswered (proxy cut) |
| 2 | `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B` | [14-10-35-tier2](../2026-11-07T14-10-35-tier2.md) | — | 0.81 | 0.76 | 0.52 | 1902 | 0 | tool-select 28/30 · grounding 19/25 · robustness 5/10 · injection 13/25 · analysis 2/15 |
| 2 | `deepseek-ai/DeepSeek-V4-Pro` | [14-10-28-tier2](../2026-11-07T14-10-28-tier2.md) | — | 0.77 | 0.84 | 0.68 | 1994 | 0 | tool-select 24/30 · grounding 21/25 · robustness 6/10 · injection 17/25 · analysis 2/15 |
| 2 | `zai-org/GLM-5.3` | [14-10-31-tier2](../2026-11-07T14-10-31-tier2.md) | — | 0.74 | 0.79 | 0.72 | 3689 | 3 | tool-select 26/30 · grounding 19/25 · robustness 6/10 · injection 18/25 · analysis 3/15 |
| 3 | `moonshotai/Kimi-K3.1-Pro` | [14-10-38-tier3](../2026-11-07T14-10-38-tier3.md) | — | 0.86 | **1.00** | 0.76 | 6547 | 24 | tool-select 22/30 · grounding 24/25 · robustness 9/10 · injection 19/25 · analysis 0/15 |

**Still nothing passes the 0.90 tool-call gate; nothing is proposed or recorded.** Best Tier 1: GLM-5.3-Flash (ties GPT-OSS-120B at 0.86, with better parse 37/40 and ~7× lower latency). Kimi models are heavily unanswered: their long responses hit the session's ~30 s egress cut, so their scores are not comparable.

### `analysis` scorer finding (proposed fix in this PR, suite versions bumped to v3)

Captured GPT-OSS-120B answers show it typesets numbers with U+202F narrow no-break spaces (`120 812.37`) and U+2011 non-breaking hyphens (`‑₹24,220`, `time‑weighted`). The figure parser read one correct figure as two untraceable fragments. `normaliseAnswer()` now maps digit-group spacing to commas and Unicode hyphens/minus to `-` before the `grounding`, `robustness` and `analysis` checks. Re-scoring the captured answers: analysis 2/13 → 4/13. No rule was loosened; wrong-metric figures are still rejected (tested).

The remaining analysis failures are deliberate rules, left for the owner: answers compute their own derived figures (month-over-month changes, utilisation %, "100 %" totals), which the "every figure must trace" rule rejects; and markdown tables put the budget beside the actual figure, which the metric-binding check reads as the wrong figure.

## Third round — 2026-11-07 15:26 UTC (suites v3, after the two owner-approved scorer fixes)

A tool-call audit found that most Tier 1 tool-call failures were injection cases where the model ignored the attack but passed `basis` to `get_net_worth`, which the tool's own description tells it to do. The owner approved accepting `basis`/`dimension` only (injection v3). Re-measured with `ai:eval --no-record`:

| Tier | Model | Report | Schema | Tool-call | Grounding | Injection | p50 ms | Unanswered | Gate verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `zai-org/GLM-5.3-Flash` | [15-26-03-tier1](../2026-11-07T15-26-03-tier1.md) | 1.00 | **0.95** | 0.84 | 0.96 | 906 | 0 | **Passes both gates**; not proposed only because it has no `config/capabilities.ts` entry |
| 1 | `openai/gpt-oss-120b` | [15-26-06-tier1](../2026-11-07T15-26-06-tier1.md) | 1.00 | **0.96** | 0.88 | 0.79 | 5321 | 2 | Passes both gates on answered cases; 2 unanswered (proxy) |
| 1 | `deepseek-ai/DeepSeek-V4.1-Flash` | [15-26-08-tier1](../2026-11-07T15-26-08-tier1.md) | 1.00 | 0.88 | 0.88 | 0.96 | 978 | 0 | Fails tool-call |
| 2 | `openai/gpt-oss-120b` | [15-26-18-tier2](../2026-11-07T15-26-18-tier2.md) | — | **0.96** | 0.88 | 0.80 | 4853 | 5 | Passes tool-call on answered cases; 5 unanswered (proxy) |
| 2 | `zai-org/GLM-5.3` | [15-26-21-tier2](../2026-11-07T15-26-21-tier2.md) | — | 0.84 | 0.92 | 0.96 | 2387 | 0 | Fails tool-call |
| 2 | `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B` | [15-26-12-tier2](../2026-11-07T15-26-12-tier2.md) | — | 0.88 | 0.88 | 0.64 | 2005 | 0 | Fails tool-call |
| 2 | `deepseek-ai/DeepSeek-V4-Pro` | [15-26-15-tier2](../2026-11-07T15-26-15-tier2.md) | — | 0.79 | 0.68 | 0.84 | 1864 | 0 | Fails tool-call |

Nothing is recorded or activated; the lineup awaits owner approval.
