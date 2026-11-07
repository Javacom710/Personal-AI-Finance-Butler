# DeepInfra measurements — 2026-11-07

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
