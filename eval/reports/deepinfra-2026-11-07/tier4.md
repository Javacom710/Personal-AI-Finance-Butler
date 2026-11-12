# Model evaluation — Tier 4

<!-- project-doc-status:start -->
> **Project status reviewed 12 November 2026:** Phases 0–7 complete; Phase 8 quality/release review open; Phase 9 built but live AI disabled. Selected provider: DeepInfra direct.
> **Current references:** [Project state](../../../PROJECT-STATE.md) · [Roadmap](../../../docs/ROADMAP.md) · [Maintained deadline forecast](../../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence below retains its original findings and scores; this annotation is a current navigation update.
<!-- project-doc-status:end -->

Run 2026-11-07T05:52:27.090Z. Suites: document v1.

Provider endpoint: https://api.deepinfra.com/v1/openai.

Request timeout: 60000 ms. Output-token budgets: document: 2048.

Minimum request interval: 0 ms (evaluation scheduling only).

Request profiles:
- Qwen/Qwen3-VL-30B-A3B-Instruct: default-v1; fingerprint `{"id":"default-v1","reasoning":"provider_default"}`

## Scores

Scores count only the cases the provider answered; unanswered cases (transport, timeout …) are listed, not scored.

| Model | Schema adherence | Tool-call correctness | Retrieval grounding | Analysis accuracy | Injection resistance | p50 ms | p95 ms | Unanswered |
|---|---|---|---|---|---|---|---|---|
| Qwen/Qwen3-VL-30B-A3B-Instruct | 0.83 | not measured | not measured | not measured | not measured | 13155 | 58379 | 2 |

## Pass rate by suite

| Model | document |
|---|---|
| Qwen/Qwen3-VL-30B-A3B-Instruct | 1/20 |

## Proposed order

**Nothing is proposed.** The tier keeps its current configuration; see "Not proposed" for why.

Proposed only. A human accepts it into the environment; this run changed no configuration.

### Not proposed

- `Qwen/Qwen3-VL-30B-A3B-Instruct`: 2 case(s) unanswered by the provider: re-run before proposing

## Completion reasons

Counts describe provider responses, not pass/fail scores. Legacy reports may not have recorded them.

- Qwen/Qwen3-VL-30B-A3B-Instruct document: length ×3, stop ×15

## Failures

- `Qwen/Qwen3-VL-30B-A3B-Instruct` document: doc-001, doc-002, doc-003, doc-004, doc-005, doc-006, doc-007, doc-008, doc-009, doc-010, doc-011, doc-012, doc-013, doc-014, doc-015, doc-016, doc-017, doc-019, doc-020 — provider errors: timeout ×2
