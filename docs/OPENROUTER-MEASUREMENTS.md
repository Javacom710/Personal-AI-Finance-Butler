# OpenRouter measurement handover

<!-- project-doc-status:start -->
> **Status reviewed 12 November 2026:** Phase 8 quality/release review open; Phase 9 live AI disabled; Overview, Scenarios, metrics and TWR built; Phase 10 partial. OD-21/22/23 remain open. DeepInfra direct is selected.
> **Current references:** [Project state](../PROJECT-STATE.md) · [Roadmap](ROADMAP.md) · [Maintained deadline forecast](../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Unselected provider reference; DeepInfra remains selected.
<!-- project-doc-status:end -->

> **Status 2026-11-07:** merged into `main` (PRs #41, #42) and tested with fake providers. OpenRouter is **not** the selected provider: Phase 8 uses DeepInfra direct ([ADR-54](DECISIONS.md#adr-54--deepinfra-direct-is-the-phase-8-provider-google-and-anthropic-models-are-excluded)). Keep this runbook for a future switch.

The owner authorized OpenRouter setup and measurement on 3 November 2026, with ZDR, no data collection, price ordering and DeepInfra first. The implementation here prepares those controls with fake HTTP tests. It does not configure a live credential, select a lineup, record results or activate either Phase 9 feature. Groq remains the repository default until the authorized provider switch is configured.

## Readiness before live inference

Confirm funding and a ready `AI_API_KEY` binding for `AI_BASE_URL=https://openrouter.ai/api/v1`. Do not send a legacy NVIDIA/Groq credential to OpenRouter; the existing environment resolver keeps a legacy key paired with its original URL.

Configure OpenRouter privacy/guardrails as **ZDR only**, excluding Safety Retention endpoints, and keep training/data collection off. The current [provider-routing documentation](https://openrouter.ai/docs/guides/routing/provider-selection) says request-level `zdr:true` may also admit Safety Retention endpoints depending on account settings. Per-request preferences cannot certify those settings. Confirm this readiness before the first funded run; do not treat possession of a key as confirmation of strict account privacy.

Use the catalogue to verify the exact GPT-OSS IDs and choose the owner's Qwen vision candidate. Verify advertised modalities/structured-output support and reconcile declarations without changing orders or relaxing gates. The catalogue is not proof that an endpoint answers: a first live check must be bounded and never retried in a loop. Use the existing evaluator with `--limit 1 --no-record` for one wire check per chosen model; retain it as partial evidence and stop on unavailable/unauthorized/quota errors or missing host attribution before launching full suites. A successful wire check never substitutes for full coverage. Do not use Groq's coordinator/ledger for OpenRouter; it intentionally refuses another endpoint.

## Request policy

The existing provider adapter detects only the canonical HTTPS OpenRouter API. Every chat completion has:

```json
{
  "provider": {
    "zdr": true,
    "data_collection": "deny",
    "order": ["deepinfra"],
    "sort": "price",
    "allow_fallbacks": true
  }
}
```

OpenRouter tries the named provider first and handles eligible fallback ordering itself. Application code does not enumerate, score or select hosts. All fallback hosts remain subject to the request privacy filters and the account's ZDR-only setting. No model/content input can override this object. The adapter rejects noncanonical OpenRouter URLs and disables HTTP redirects. Other providers keep their existing requests.

A versioned semantic fingerprint describes these request preferences. It is distinct from the existing model request-profile identity (for example reasoning controls); both remain visible in measurement evidence.

## Measurement provenance and qualification

Every normalized OpenRouter response must identify its serving host using the returned `provider` label. The adapter does not infer it from `order`. A filtered response retains content-filter semantics even if attribution is absent, so the existing orchestrator cannot retry a filter on another model.

Each case records canonical provider endpoint, request-policy fingerprint, actual host label and actual response model ID. Transport/unattributed failures retain null attribution. The harness validates response provenance against the actual adapter's policy before scoring. No model output text is retained. The regular CLI's JSON suite summaries retain these case-level fields even though full report objects are omitted.

Scores and latency are summarized independently per host. Qualification requires every golden case of every required tier suite for that host under that policy. Different hosts cannot fill missing cases for each other. `--limit` and subset suites remain partial. Existing schema/tool thresholds and declared-capability caveats are unchanged. Provider-wide totals are diagnostic only; the report proposes no provider-wide order. Host-qualified proposals are for owner review, not routing configuration.

A `provider` label identifies only what OpenRouter returned. Do not claim it proves a particular region, quantization variant or physical endpoint if the response does not expose those fields. Different returned labels stay separate rather than being guessed equivalent.

## Funded run, after readiness is confirmed

Run the remaining suites in one sustained session with the existing production budgets, prompts and scorers. The commands below are finite, never recording, and do not change tier orders:

```sh
npm run ai:eval -- --tier 1 --model openai/gpt-oss-120b,openai/gpt-oss-20b --interval-ms 3000 --no-record
npm run ai:eval -- --tier 2 --model openai/gpt-oss-120b --interval-ms 3000 --no-record
npm run ai:eval -- --tier 3 --model openai/gpt-oss-120b --interval-ms 3000 --no-record
npm run ai:eval -- --tier 4 --model VERIFIED_QWEN_VISION_ID --interval-ms 3000 --no-record
```

Replace the vision placeholder with the verified catalogue ID before execution. Do not run these commands while funding/key/ZDR-only readiness is missing. Preserve previous Groq reports as Groq evidence; none authorizes OpenRouter. Do not manufacture missing host coverage or retry failures in a loop. A fallback can leave several hosts with incomplete coverage; report that honestly and identify exact missing case IDs. Scenarios remain blocked by OD-18 and are not added to the suites.

Commit generated reports and update `PROJECT-STATE.md`. Bring the owner a per-tier **model + host** lineup with scores, latency, coverage and capability limitations. Owner approval is required before accepting orders, recording or activating Phase 9.

## Recording stays closed

The CLI rejects OpenRouter recording before a request can be sent. The database recorder independently rejects it; the existing runtime loader returns no OpenRouter measured capabilities, including for manually inserted endpoint-only rows. This prevents the old model/endpoint-only representation from approving another host.

After the owner chooses the lineup, implement and review host-qualified storage/loading and approved-host enforcement inside the provider/configuration boundary before enabling recording. OpenRouter must still do the routing. Do not add an application multi-host/AI host router or reduce any existing capability gate. This follow-up is deliberately not guessed before the measurements and approval exist.

## Verification

All inference responses in tests are fake. Tests cover every request shape, immutable privacy controls, actual fallback attribution, hostless/malformed responses, unsafe URLs, redirect refusal, content-filter semantics, mixed-host separation, complete/partial host coverage, unchanged gates, CLI preflight with HTTP denied, recording refusal and unchanged legacy provider storage. No live model was called by this preparation work.

Local verification: **2,633 tests across 103 files pass**, including all unit/property/PostgreSQL 17 integration tests; focused checks comprise 71 unit tests and 10 PostgreSQL checks. Typecheck, lint, `npm run build -- --webpack` and the client-secret scan pass. The local default Turbopack build cannot resolve this workspace’s shared dependency symlink; CI uses a normal install and the repository's default build. No dependency or Next configuration change was made.
