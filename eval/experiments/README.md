# Experimental evaluation profiles

<!-- project-doc-status:start -->
> **Project status reviewed 12 November 2026:** Phases 0–7 complete; Phase 8 quality/release review open; Phase 9 built but live AI disabled. Selected provider: DeepInfra direct.
> **Current references:** [Project state](../../PROJECT-STATE.md) · [Roadmap](../../docs/ROADMAP.md) · [Maintained deadline forecast](../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence below retains its original findings and scores; this annotation is a current navigation update.
<!-- project-doc-status:end -->

These artifacts are exploratory and must not be imported as production capability measurements. The `experimental` and `productionCompatible` envelope fields describe the request profile; limited runs also retain the evaluator's routing-proposal and storage guards.

## Lightning thinking-disabled probe — 2026-11-02

NVIDIA's [model-specific Build page](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b/modelcard), retrieved on 2026-11-02, includes a request example with `chat_template_kwargs: {"enable_thinking": false}`. This is an application request parameter, never a prompt instruction or a user-selected model/tier.

The probe applied exactly that override to the first three parse and first three classify cases using the production adapter with an experimental fetch wrapper. Prompts, schemas, deterministic scorers, suite versions and production token limits (1,024/512) were unchanged. The timeout was 45 seconds. The source/scoring baseline was `fe176a1`; the only wire-body override was:

```json
{"chat_template_kwargs":{"enable_thinking":false}}
```

Method: `runEvaluation` with tier 1, suites `parse,classify`, model `nvidia/nemotron-3.5-lightning-30b-a3b`, `limit: 3`, and `record: false`. The injected fetch parsed the adapter's existing request body, asserted that model id, added the override, and forwarded the remaining body, headers and abort signal unchanged. The artifact retains counts and completion reasons, never raw content/reasoning.

| Suite | Passes | Schema valid | Completion reasons | p50 / p95 ms |
|---|---:|---:|---|---:|
| parse v2 | 3/3 | 3/3 | stop: 3 | 3540 / 6901 |
| classify v2 | 3/3 | 3/3 | stop: 3 | 568 / 865 |

This small fixed sample is a signal for a larger controlled experiment. It does not establish a full-suite pass rate or causally explain every default-profile failure. No production request/configuration, database row, scorer or routing order changed. The standard evaluator refuses a routing proposal because the run is limited, and the storage API refuses limited runs. Any production adoption needs an explicitly represented profile and fresh full measurements under that same profile.

## Lightning thinking-disabled Tier 1 attempt — 2026-11-02

The follow-on [190-case attempt](2026-11-02T06-46-49-lightning-thinking-off-tier1-attempt.json) selected every current Tier 1 case before making a call. It used the same fetch-body override as the probe, the unchanged v2 prompts/schemas/scorers, production output limits (parse 1,024; classify 512; read tasks 2,048), a 45-second timeout and the source/scoring baseline `1ea947a4e4721a7b30795153e7dd4c50ee1a73e2`. That commit is PR #33's documentation-only follow-on to `fe176a1`; application/evaluator sources are identical.

Method: `runEvaluation` with tier 1, all six tier suites in their normal order, the same explicit Lightning model, `limit: 60` and `record: false`, using a temporary script outside the repository. The fetch wrapper asserted the endpoint/model and forwarded the body, headers and abort signal with only `chat_template_kwargs.enable_thinking=false` added. Each suite contains at most 60 cases, so this limit selects the entire corpus while retaining the evaluator's unconditional proposal/storage refusal. Exact selected ids are in the artifact. Calls were serial, with no additional pacing or retries; provider failures were retained. The artifact was written once at completion, with no raw response content or reasoning.

| Suite | Exact passes / attempted | Answered | Unanswered | Schema valid / applicable answered |
| --- | ---: | ---: | ---: | ---: |
| parse v2 | 26/40 | 40 | 0 | 40/40 |
| classify v2 | 26/60 | 29 | 31 rate limits | 29/29 |
| tool-select v2 | 0/30 | 0 | 30 rate limits | — |
| grounding v2 | 15/25 | 20 | 2 rate limits, 3 timeouts | — |
| robustness v2 | 2/10 | 10 | 0 | — |
| injection v2 | 16/25 | 25 | 0 | — |

**124 of 190 requests were answered; 66 were unanswered** (63 rate limits, 3 timeouts). Provider errors are not scored as incorrect model answers. Over answered applicable cases, schema adherence is 69/69, tool-call correctness 20/25 (0.80, entirely from injection because tool-select received no answers), grounding 15/20 (0.75) and injection resistance 16/25 (0.64). These are incomplete-coverage diagnostics, not full-suite quality estimates. The tool-call score falls below the 0.90 gate even on this answered subset. All answered requests ended in `stop` (115) or `tool_calls` (9), with no `length` stops. The suite latency percentiles include error durations under the existing harness; the aggregate model percentiles exclude provider failures.

The earlier six-case success does not generalize to exact transaction parsing: 26/40 passed despite all 40 outputs being schema-valid. There is no production recommendation, proposed order or database capability row. The request profile is still experimental and does not match production. A fresh catalogue read returned 85 models with the same identifier drift. A bounded minimal Lightning request after the rate-limit burst returned HTTP 200; that establishes endpoint reachability at that moment, not restored full-evaluation capacity or the cause of the timeouts.

The [request-profile implementation scope](REQUEST-PROFILE-PROPOSAL.md) was subsequently approved and recorded in [ADR-51](../../docs/DECISIONS.md#adr-51--request-profiles-are-application-controlled-and-measurements-must-match-them). The implemented contract represents the request setting in both production/evaluation and requires matching measurement provenance, followed by paced fresh evaluations. It does not accept Lightning for production or import these exploratory artifacts as capability measurements.

Verification of the source baseline: typecheck, lint, all 1,929 unit tests, production build and `check:no-client-secrets` passed. Artifact validation checked corpus ids, versions, budgets, all count/score/finish-reason identities, the experimental envelope and empty proposed order. This follow-on changes only reports, a non-normative proposal and status documentation.
