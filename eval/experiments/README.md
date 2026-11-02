# Experimental evaluation profiles

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
