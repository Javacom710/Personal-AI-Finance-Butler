# Original Claude Tier 1 decision record

<!-- project-doc-status:start -->
> **Project status reviewed 12 November 2026:** Phases 0–7 complete; Phase 8 quality/release review open; Phase 9 built but live AI disabled. Selected provider: DeepInfra direct.
> **Current references:** [Project state](../../PROJECT-STATE.md) · [Roadmap](../ROADMAP.md) · [Maintained deadline forecast](../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence below retains its original findings and scores; this annotation is a current navigation update.
<!-- project-doc-status:end -->

Verbatim section from PR #54 at `cd5e65e0d3d03035ce97e301a03fcae1696ec075`. Its ADR-53 number belongs to that branch; the reconciled decision is ADR-55 because ADR-53 already names independent tier eligibility here. Original relative links below retain their original context.

Source: https://github.com/Javacom710/Personal-AI-Finance-Butler/blob/cd5e65e0d3d03035ce97e301a03fcae1696ec075/docs/DECISIONS.md

```markdown
## ADR-53 — Tier 1 is GLM-5.3-Flash with GPT-OSS-120B as fallback, measured on DeepInfra

**Decision.** Owner, 2026-11-07, by pop-up after three measured rounds ([DeepInfra measurements](../eval/reports/deepinfra-2026-11-07/README.md)).

> **Tier 1 order: `zai-org/GLM-5.3-Flash`, then `openai/gpt-oss-120b`. The lineup is qualified on DeepInfra (`AI_BASE_URL=https://api.deepinfra.com/v1/openai`); GLM-5.3-Flash is not served by Groq. Tiers 2–4 stay empty and fail closed. Live generation stays disabled until the owner switches it on.**

**Evidence (suites v3, unchanged 0.95 schema / 0.90 tool-call gates).**
- GLM-5.3-Flash: schema 1.00, tool-call 0.95, injection resistance 0.96, grounding 0.84, 0 unanswered, p50 0.9 s.
- GPT-OSS-120B: schema 1.00, tool-call 0.96, 2 cases unanswered (the cloud session's ~30 s egress cut), p50 5.3 s.
- GPT-OSS-20B failed both gates in round 1 and is removed from the order.

**Scorer corrections that made the gates meaningful (owner-approved, same day).**
- `grounding`, `robustness`, `analysis` v3: typeset digit grouping (U+202F) and Unicode hyphens are read as ASCII before scoring. No rule was loosened.
- `injection` v3: `basis` and `dimension` are accepted on an otherwise allowed read. `get_net_worth`'s own description tells the model to state the basis; every failure the audit traced had ignored the attack. Changed dates, foreign ids and other arguments still fail.

**Still open.**
- Tier 2: only GPT-OSS-120B cleared tool-call (0.96), with 5 cases cut off. The owner chose to re-run it from the PC before deciding.
- `analysis` remains near zero for every model because derived figures and tables fail deliberate rules; that is a separate owner decision.
- Measured rows are stored with `ai:eval --record` against the deployment database; until then the entry is `declared`.

---

```
