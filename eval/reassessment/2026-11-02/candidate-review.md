# Fresh model discovery review

<!-- project-doc-status:start -->
> **Project status reviewed 12 November 2026:** Phases 0–7 complete; Phase 8 quality/release review open; Phase 9 built but live AI disabled. Selected provider: DeepInfra direct.
> **Current references:** [Project state](../../../PROJECT-STATE.md) · [Roadmap](../../../docs/ROADMAP.md) · [Maintained deadline forecast](../../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence below retains its original findings and scores; this annotation is a current navigation update.
<!-- project-doc-status:end -->

Discovery candidates only. These ids came from the fresh authenticated catalogue; no production model, tier order or request profile has been selected. Public metadata is a claim to verify through access/API-feature tests and unchanged workload scoring. No inference request was made during this documentation review.

| Candidate | Advertised context | Advertised tools / structured output | Advertised input | Next check |
| --- | ---: | --- | --- | --- |
| [nvidia/nemotron-3.5-bolt-e4b](https://build.nvidia.com/nvidia/nemotron-3.5-bolt-e4b/modelcard) | 65536 | true / true | Text | Inspect API schema, serving access and exact outputs |
| [moonshotai/kimi-k2.6](https://build.nvidia.com/moonshotai/kimi-k2.6/modelcard) | unconfirmed | unconfirmed / unconfirmed | unconfirmed | Resolve missing metadata; HTTP 200 page alone is insufficient |
| [minimaxai/minimax-m3.1-flash](https://build.nvidia.com/minimaxai/minimax-m3.1-flash/modelcard) | 262144 | true / true | Text, Image, Video | Inspect API schema, serving access and exact outputs |
| [nvidia/nemotron-3.5-super-vl-120b-a12b](https://build.nvidia.com/nvidia/nemotron-3.5-super-vl-120b-a12b/modelcard) | 262144 | true / true | Text, Image, Video | Inspect API schema, serving access and exact outputs |
| [mistralai/mistral-large-4-1t-a52b](https://build.nvidia.com/mistralai/mistral-large-4-1t-a52b/modelcard) | 262144 | true / true | Text, Image | Inspect API schema, serving access and exact outputs |

A `structuredOutput` claim is not proof of native `json_schema` support. Literal mentions of JSON modes in a page are recorded only as a documentation lead, not capability evidence. No declarations in the application have been changed.

Bolt is a lead for efficient text tasks; MiniMax and Mistral are leads for reasoning/multimodal review; Super VL is a vision lead. These are hypotheses to test, not selected roles or rankings. Kimi needs additional documentation verification before promotion to a test shortlist.

Registry compatibility remains a separate check: these discovery ids do not receive runtime permission merely by appearing in the catalogue. Any required capability/profile metadata entry will be surfaced explicitly while source remains frozen.
