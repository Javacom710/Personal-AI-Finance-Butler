# NVIDIA reassessment — source frozen

<!-- project-doc-status:start -->
> **Status reviewed 12 November 2026:** Phase 8 quality/release review open; Phase 9 live AI disabled; Overview, Scenarios, metrics and TWR built; Phase 10 partial. OD-21/22/23 remain open. DeepInfra direct is selected.
> **Current references:** [Project state](../../../PROJECT-STATE.md) · [Roadmap](../../../docs/ROADMAP.md) · [Maintained deadline forecast](../../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence; original score and finding body retained, source contracts may be historical.
<!-- project-doc-status:end -->

The user requested a clean reassessment of NVIDIA accounts/API keys and model choices on 2026-11-02. Application source is frozen. This workspace is outside the application repository.

## Current state

- All previous NVIDIA evaluation processes have been stopped.
- Historical reports remain available. The long GPT-OSS run was interrupted before a complete suite/report was produced; it supplies no full capability score.
- `source-baseline.json` records SHA-256 hashes for 376 tracked application/configuration/test files at repository commit `968053e`. Every probe checks this manifest before and after network access.
- No application source, dependency, schema, routing order or production environment file has been changed for this reset. The earlier request-profile infrastructure remains in place.
- Previous model choices are historical evidence, not the new shortlist. No model or request control is preselected for the fresh round.

## Credential decision and replacement setup

The current credential was audited as a labelled baseline after the reset: an authenticated `/models` request returned HTTP 200 and 85 model ids, with all 376 source hashes unchanged. This does not establish access to every inference model. A new key is optional until the intended account, quotas and model access are confirmed; replacement is not assumed to repair provider/network failures.

Use an API key for NVIDIA Build's hosted API at `https://integrate.api.nvidia.com/v1`. Container-download credentials are a different use case. If replacing the key:

1. Create a replacement API key through [NVIDIA Build](https://build.nvidia.com) using the account intended for this application.
2. Configure it in this Codex cloud environment as a secret targeting **`NVIDIA_API_KEY`**, scoped to **`integrate.api.nvidia.com`**. The friendly secret name may differ from its target environment-variable name.
3. Keep `NODE_USE_ENV_PROXY=1` configured for the application's Node scripts. This standalone Python probe uses the inherited proxy and normal TLS verification.
4. Retain the current key until the replacement authenticates and intended models are reachable. Then revoke the superseded key through the NVIDIA account.
5. Tell the assistant when the replacement is configured. Never paste the key in chat or put it in this workspace/repository.

The existing cloud binding targets `Authorization_Nvidia`, which previously required a command-local mapping to the application's `NVIDIA_API_KEY`. The fresh setup should bind the expected variable directly. Existing successful calls show that the old credential is not proven invalid; a replacement is not assumed to cure model availability, account entitlement or network failures.

The connected tools can inspect readiness, but cannot create/revoke NVIDIA account keys or edit this environment's secret bindings. Those account/settings actions require the owner.

## Reassessment sequence

1. Verify fresh secret readiness without displaying its value, then authenticate to `/models` using the new setup.
2. Build a new shortlist from the authenticated catalogue and current official model/API documentation. Verify context limits, native tools, structured-output mode, vision and supported request controls separately from quality claims.
3. Check each candidate's inference access and API features with synthetic requests. Catalogue presence, HTTP reachability, a final answer and task correctness are separate observations.
4. Evaluate promising candidates against the unchanged application prompts, schemas, deterministic scorers and fixtures, using command-local configuration and `--no-record`. Record explicit request settings, latencies, rate limits, unanswered requests and exact task accuracy. Long evaluations should be divided into reviewable stages; old interrupted attempts are not merged into completed measurements.
5. Produce a proposed model/key configuration and capability compatibility report. App credentials remain in secret storage; the report contains only variable names, model ids and non-secret settings.
6. Activate only a compatible, accepted configuration. Existing `AI_TIER1_MODELS` … `AI_TIER4_MODELS`, `NVIDIA_API_KEY`, `NVIDIA_BASE_URL` and `AI_REQUEST_PROFILES` already support configuration changes.

An unregistered model or unsupported request control may require a capability/profile entry. Such a requirement will be reported as a bounded proposal for explicit approval; this reassessment will not edit source, weaken gates, or promise that every newly discovered model can serve through environment variables alone.

## Standalone checks

The helper imports no application module, loads no `.env`, accesses no database, and saves no raw model answer/reasoning or HTTP error body. It reads only the explicitly configured `NVIDIA_API_KEY` for authentication. It writes JSON results exclusively in this directory.

```bash
python /workspace/nvidia-reassessment/probe_nvidia.py --check-config
python /workspace/nvidia-reassessment/probe_nvidia.py --catalogue
python /workspace/nvidia-reassessment/probe_nvidia.py --model publisher/model-id
```

The first command makes no network request. The remaining commands require the fresh key. Minimal inference probes report reachability/completion metadata, not capability scores. All requests use the hosted NVIDIA endpoint with ordinary certificate verification.
