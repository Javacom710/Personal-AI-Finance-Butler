# DeepInfra Phase 8 approval report — current v3 campaign

<!-- project-doc-status:start -->
> **Project status reviewed 12 November 2026:** Phases 0–7 complete; Phase 8 quality/release review open; Phase 9 built but live AI disabled. Selected provider: DeepInfra direct.
> **Current references:** [Project state](../../../PROJECT-STATE.md) · [Roadmap](../../../docs/ROADMAP.md) · [Maintained deadline forecast](../../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence below retains its original findings and scores; this annotation is a current navigation update.
<!-- project-doc-status:end -->

All **23 model/tier/suite entries and 610 cases** were attempted on 7 November 2026: **603 answered, seven timed out** (one Tier 2 analysis case, six Tier 4 document cases). Coverage completion is not a quality pass. **No candidate is proposed for promotion.** Nothing was recorded in the production database or added to a routing order.

| Tier | Candidate | Answered / attempted | Schema | Tools | Other evidence | Recommendation |
|---|---|---:|---:|---:|---|---|
| 1 | `openai/gpt-oss-120b` | 190/190 | 100/100 (100%) | 49/57 (85.96%) | Parse 32/40; grounding 20/25; injection 14/25 | Hold: tools below 90%. |
| 1 | `openai/gpt-oss-20b` | 190/190 | 94/100 (94%) | 47/59 (79.66%) | Parse 28/40; grounding 17/25; injection 18/25 | Hold: schema below 95%, tools below 90%; structured routes also lack declared schema support. |
| 2 | `openai/gpt-oss-120b` | 104/105 | — | 50/57 (87.72%) | Analysis 1/15 attempted (1/14 answered); grounding 19/25; injection 14/25 | Hold: unanswered analysis case and tools below 90%. |
| 3 | `openai/gpt-oss-120b` | 105/105 | — | 52/58 (89.66%) | Analysis 1/15; grounding 21/25; injection 16/25 | Hold: tools below 90%. |
| 4 | `Qwen/Qwen3-VL-30B-A3B-Instruct` | 14/20 | 11/14 (78.57%) | — | Exact extraction 0/20 attempted; six timeouts | Hold: unanswered cases and schema below 95%. |
| 5 | Deferred under ADR-19 | — | — | — | No embedding calls | Keep deferred. |

Schema/tool ratios use answered applicable cases; extraction and the first analysis fractions use attempted cases. The generated Tier 3 exclusion text rounds its tool score to `0.90`; the exact score is **0.8965517241**, below the unchanged `0.9` threshold. The harness's proposed orders are empty for all measured tiers. Low strict analysis/extraction pass counts reinforce the hold; no new numeric gate was introduced.

## Provenance and interpretation

The provider is **DeepInfra direct**, `https://api.deepinfra.com/v1/openai`. Authenticated catalogue/reachability evidence is preserved in the [original campaign](../deepinfra-2026-11-07/README.md); both GPT-OSS identifiers and the Qwen vision identifier match that catalogue. No Google or Anthropic model was called and no Groq or OpenRouter measurement was reused.

Grounding, robustness and analysis use the corrected v3 numeric-presentation scorer. Other suite versions, production output budgets, prompts, profiles and thresholds are unchanged. The v3 formatting correction fixes a reproduced presentation false negative; these fresh results do not establish it as the cause of historical model failures. Historical v2 artifacts remain unchanged and are not pooled with this campaign.

The [independent-tier implementation](../../../docs/audits/2026-11-07-ai-tiered-eligibility.md) now represents separately measured model/tier entries. Each needs its own full current corpus and exact production-budget evidence; one tier cannot certify another. The earlier structural limitation is resolved, but these candidates still fail quality/completeness gates. Default production orders remain unchanged and approval is required before recording or accepting a lineup.

Execution used six concurrent requests, serial cases within each suite, the default request profile and a 60-second timeout. Failed cases were retained without retry. Reports retain scores, counts, case ids and timing only; raw model outputs, reasoning and tool arguments were not stored.

## Accounting and verification

- This campaign accounted **$0.094323145**; prior campaigns, diagnostics and serial-start reservations accounted **$0.083545001**; combined known accounting is **$0.177868146**. These are catalogue-price estimates and conservative unknown-usage reservations, not a billing statement. Reachability probes are outside the token ledgers and covered by the margin below the $5 allocation.
- The shared DeepInfra account lock and **$4.50 account accounting ceiling** cover all campaigns and diagnostics. This finite coordinator cannot record measurements or promote models.
- **2,097 unit tests and 12 PostgreSQL 17 integration tests** pass, plus typecheck, lint, production build, client-secret scan and whitespace checks.
- A final offline status run validates the source-bound checkpoints without provider requests. All 23 checkpoint hashes and the usage hash are unchanged; all 34 original measurement artifacts are unchanged.
- The `scenario` suite remains separately deferred by OD-18. **Phase 8 remains open** because no production lineup is qualified or approved. Do not advance to Phase 9 on the basis of coverage alone.

[Approval JSON](approval.json) · [Progress/readiness](progress.json) · [Tier 1](tier1.md) · [Tier 2](tier2.md) · [Tier 3](tier3.md) · [Tier 4](tier4.md) · [Usage](usage.json) · [Original catalogue](../deepinfra-2026-11-07/catalogue.json) · [Reachability](../deepinfra-2026-11-07/reachability.txt)

```sh
# Offline verification only; no provider request or recording.
AI_API_KEY="$AI_API_KEY_DeepInfra" npm run ai:measure:deepinfra -- --status --campaign format-v3
```

Production acceptance and any recording remain pending the owner's decision. A future provider switch requires fresh suites there.
