# DeepInfra Phase 8 approval report — 7 November 2026

<!-- project-doc-status:start -->
> **Project status reviewed 12 November 2026:** Phases 0–7 complete; Phase 8 quality/release review open; Phase 9 built but live AI disabled. Selected provider: DeepInfra direct.
> **Current references:** [Project state](../../../PROJECT-STATE.md) · [Roadmap](../../../docs/ROADMAP.md) · [Maintained deadline forecast](../../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence below retains its original findings and scores; this annotation is a current navigation update.
<!-- project-doc-status:end -->

**Historical scorer:** these results used grounding/robustness/analysis v2. The later [numeric presentation correction](diagnostics/numeric-presentation.md) moves those three suites to v3. No historical score was rewritten; a fresh named campaign is required for current-version measurements. The promotion hold remains in force.

All **23 planned model/tier/suite entries and 610 case measurements** were attempted in the complete batch: **607 answered, 3 timed out**. Coverage completion is not a quality pass. No database measurement was recorded, no production order was changed, and no model was promoted.

**Recommendation: hold all production promotions.** The harness proposes GPT-OSS-120B only for Tier 2 under its unchanged numeric gates. Its **0/15 strict financial-analysis passes** and unresolved tier-specific eligibility make that proposal unsuitable for acceptance now. This recommendation does not change a scorer or add a new numeric gate.

| Tier | Candidate | Answered / attempted | Schema | Tools | Additional evidence | Harness proposal / recommendation |
|---|---|---:|---:|---:|---|---|
| 1 | `openai/gpt-oss-120b` | 190/190 | 100/100 (100%) | 48/58 (82.76%) | Parse 32/40; grounding 21/25; injection 15/25 | Excluded; tools below 90%. Hold. |
| 1 | `openai/gpt-oss-20b` | 189/190 | 92/99 (92.93%) | 50/58 (86.21%) | Parse 25/40; one parse timeout; declared output mode also excludes structured routes | Excluded; incomplete answers and both numeric thresholds missed. Hold. |
| 2 | `openai/gpt-oss-120b` | 105/105 | Not applicable | 53/58 (91.38%) | Analysis 0/15; grounding 21/25; injection 20/25 | **Numeric-gate proposal only. Hold** for analysis failure and tier eligibility. |
| 3 | `openai/gpt-oss-120b` | 105/105 | Not applicable | 52/59 (88.14%) | Analysis 0/15; grounding 22/25; injection 17/25 | Excluded; tools below 90%. Hold. |
| 4 | `Qwen/Qwen3-VL-30B-A3B-Instruct` | 18/20 | 15/18 (83.33%) | Not applicable | Exact extraction 1/20 attempted; two timeouts; three length stops | Excluded; unanswered cases and schema below 95%. Hold. |
| 5 | Deferred | — | — | — | Embeddings remain deferred under ADR-19 | No model proposed. |

Schema and tool ratios use answered applicable cases, as the harness requires. Extraction pass counts include unsuccessful attempts. Analysis scoring checks required figures, metric bindings, case-specific findings and unsupported claims; it does not score general prose quality. The zero analysis pass rate is a strict benchmark result, not a diagnosis of every response. Raw model outputs were not stored.

## Provider and execution provenance

The direct provider is **DeepInfra**, `https://api.deepinfra.com/v1/openai`. Both GPT-OSS identifiers match the authenticated catalogue and answered reachability probes. The Qwen vision identifier was newly added as a declared evaluation candidate; Tier 4's production order remains empty. No Google or Anthropic model was called, and OpenRouter was not used.

All evidence is fresh for this endpoint. **No Groq parse result, checkpoint, latency, score or quota ledger was reused.** Reports carry the provider name and normalized endpoint. Checkpoints additionally bind source, model, tier, suite version, production token budget and request profile. Existing storage/loading filters exclude missing or mismatched provider provenance; a new regression test specifically covers identical model IDs across Groq and DeepInfra.

The complete run used six concurrent provider requests, serial cases within each suite, the existing default request profile, a 60-second timeout, unchanged production output budgets, and unchanged prompts/scorers/gates. Failed cases were not retried. A four-result serial start was stopped to improve concurrency; its separate `serial-start/` archive contains five reserved requests, including one without a retained answer. It contributes no score or coverage to the complete run.

## Cost and verification

- Complete queue accounting: **$0.06847073**; serial-start accounting: **$0.001691837**. These are catalogue-price estimates and conservative unknown-usage reservations, not a provider billing statement. Cache discounts are not assumed. Reachability probes are outside this token ledger and covered by the $0.25 margin below the $5 allocation. The coordinator's cap is $4.75.
- All **1,991 unit tests** pass, including full fake-provider queue execution, resume without calls, foreign-provenance rejection, spend-cap rejection, HTTP 429 retention without retry, and refusal of `--record`. Typecheck, lint, production build, client-secret scan and whitespace checks pass.
- A final offline status run validated the real source-bound evidence. All **23 checkpoint hashes and the usage-ledger hash remained unchanged**, with no new provider request.
- The separately deferred `scenario` suite still depends on OD-18's missing deterministic engine capability. This run completes the existing measurement plan, not Phase 8's production-acceptance gate.

## Evidence and commands

The [subsequent failure-diagnostics report](diagnostics/README.md) adds six separate probes with reason codes and counts. It does not alter the original scores or approval recommendation.

[Approval decision JSON](approval.json) · [Progress and readiness](progress.json) · [Tier 1](tier1.md) · [Tier 2](tier2.md) · [Tier 3](tier3.md) · [Tier 4](tier4.md) · [Catalogue](catalogue.json) · [Reachability](reachability.txt) · [Usage](usage.json)

```sh
# This environment exposes the DeepInfra secret under this binding.
AI_API_KEY="$AI_API_KEY_DeepInfra" npm run ai:measure:deepinfra -- --run --no-record

# Offline provenance validation and report reconstruction; no provider requests.
npm run ai:measure:deepinfra -- --status
```

The completed queue resumes without new calls; it does not retry the retained timeouts or tune failed models until they pass. Recording and routing acceptance remain pending the owner's decision.
