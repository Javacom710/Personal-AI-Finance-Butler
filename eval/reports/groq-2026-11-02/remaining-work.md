# Remaining Groq measurements

The recurring automation is paused. This is a finite measurement task: **610 cases across 23 model/tier/suite entries**. There are **48 retained results (47 answered, 1 unanswered)** and **562 cases not yet attempted in usable reports/checkpoints**. Interrupted requests without scored results are excluded.

| Tier | Model | Suite | Retained / planned | Coverage |
|---|---|---|---|---|
| 1 | `openai/gpt-oss-120b` | parse v2 | 40/40 | complete |
| 1 | `openai/gpt-oss-120b` | classify v2 | 0/60 | pending |
| 1 | `openai/gpt-oss-120b` | tool-select v2 | 0/30 | pending |
| 1 | `openai/gpt-oss-120b` | grounding v2 | 0/25 | pending |
| 1 | `openai/gpt-oss-120b` | robustness v2 | 0/10 | pending |
| 1 | `openai/gpt-oss-120b` | injection v2 | 0/25 | pending |
| 1 | `openai/gpt-oss-20b` | parse v2 | 0/40 | pending |
| 1 | `openai/gpt-oss-20b` | classify v2 | 0/60 | pending |
| 1 | `openai/gpt-oss-20b` | tool-select v2 | 0/30 | pending |
| 1 | `openai/gpt-oss-20b` | grounding v2 | 0/25 | pending |
| 1 | `openai/gpt-oss-20b` | robustness v2 | 8/10 | partial |
| 1 | `openai/gpt-oss-20b` | injection v2 | 0/25 | pending |
| 2 | `openai/gpt-oss-120b` | tool-select v2 | 0/30 | pending |
| 2 | `openai/gpt-oss-120b` | grounding v2 | 0/25 | pending |
| 2 | `openai/gpt-oss-120b` | robustness v2 | 0/10 | pending |
| 2 | `openai/gpt-oss-120b` | injection v2 | 0/25 | pending |
| 2 | `openai/gpt-oss-120b` | analysis v2 | 0/15 | pending |
| 3 | `openai/gpt-oss-120b` | tool-select v2 | 0/30 | pending |
| 3 | `openai/gpt-oss-120b` | grounding v2 | 0/25 | pending |
| 3 | `openai/gpt-oss-120b` | robustness v2 | 0/10 | pending |
| 3 | `openai/gpt-oss-120b` | injection v2 | 0/25 | pending |
| 3 | `openai/gpt-oss-120b` | analysis v2 | 0/15 | pending |
| 4 | `qwen/qwen3.8-27b` | document v1 | 0/20 | pending |

Next: resume only 20B robustness cases **009 and 010** after quota permits. Keep its failed/unanswered cases in the evidence; do not retry them automatically.

Completion means all 23 suite entries have complete coverage and reports, followed by a gate-based lineup proposal for owner review. An unsuitable model can fail its gates and be excluded; it does not require endless tuning or reruns. Live results remain unrecorded and tier orders unchanged.

The current conservative reserve is 183,316 tokens. Budget depends on usage and reservations, not the number of calendar days. A conservative next check is **3 November after 9 PM IST**, more than 24 hours after the latest recorded request; this is not proof of account-wide reset. No automatic run is scheduled while the automation is paused.
