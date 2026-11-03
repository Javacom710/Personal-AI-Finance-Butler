# Finite OpenRouter measurement campaign

This is the owner's one-session Phase 8 workload, with durable progress if interrupted. It builds on PR #41's request privacy and host-qualified evidence. It does not activate Phase 9, write runtime capability records, select tier orders, route hosts or schedule future runs. All development tests use fake providers.

## Before live mode

Follow [OpenRouter readiness](OPENROUTER-MEASUREMENTS.md): funded account, an explicitly configured OpenRouter key/canonical endpoint, **ZDR only** with Safety Retention excluded, and training/data collection off. Verify the exact Qwen vision catalogue ID and support before selecting it. A key alone does not prove funding or strict account privacy, and this tool cannot certify account settings.

The live commands must run from committed measurement inputs. The source fingerprint covers measurement code, prompts/schemas, corpora/scorers, configuration, dependencies and TypeScript configuration. Unrelated assistant feature implementation and documentation/report commits are excluded. Profiles, budgets, timeouts, request policy and every case's input fingerprint also bind the campaign. Do not edit a checkpoint, delete failed rows, or claim another provider/host completed missing work.

## Modes

```sh
# Offline; no key, database connection or HTTP needed
npm run ai:measure:openrouter
npm run ai:measure:openrouter -- --status --vision-model VERIFIED_QWEN_ID

# Only after account/key/privacy readiness is confirmed
npm run ai:measure:openrouter -- --run --vision-model VERIFIED_QWEN_ID

# Offline recovery of reports from the stored scores, without inference/rescoring
npm run ai:measure:openrouter -- --finalize --vision-model VERIFIED_QWEN_ID
```

The vision value must be the verified `qwen/...` catalogue ID, not the placeholder. One mode per invocation; recording, tier-order and automatic-retry flags do not exist. Status writes nothing. Live mode uses only `AI_API_KEY` with the canonical OpenRouter `AI_BASE_URL`; it never borrows a NVIDIA/Groq key.

The queue is the approved GPT-OSS pair on Tier 1, GPT-OSS-120B on Tiers 2 and 3, and the chosen Qwen vision model on Tier 4. Every existing suite/case runs with its production output budget and configured request profile. Pacing is three seconds between requests, separate from measured latency. Scenarios remain blocked by OD-18; none is added to the queue.

## Durable progress and bounded stops

Files live under `eval/reports/openrouter/<campaign-identity>/`. `checkpoint.json` preserves the manifest, original Git revision and ordered case attempts. Before HTTP, a case reservation is atomically committed to disk; only then is the model called. The scored result is saved before the next case. No raw response, reasoning trace, prompt text or tool payload is stored. Generated files request POSIX mode 0600 and directories 0700; Windows uses the workspace ACLs. Case/input hashes bind the existing synthetic corpus.

An ordinary resume skips every prior reservation. A process killed after HTTP but before saving a result leaves an ambiguous attempt, which may already have been billed. The tool never silently resends it. Repeated invocations of completed work cost no more calls.

The first provider error or content filter stops the invocation and retains its result. A genuine wrong answer is retained and does not stop the remaining quality measurement. Provider Retry-After is preserved across invocations. A cooldown longer than one minute returns a paused status instead of waiting indefinitely. There is no polling, automatic retry, recurring schedule or automatic rescheduling.

The file lock excludes concurrent writers. Catchable SIGINT/SIGTERM events abort the active request or pacing wait and release the lock on a graceful exit. A hard kill can leave a stale `.measurement.lock`; inspect its PID and confirm the process has stopped before manually removing that lock. Status remains read-only and usable while locked. Never remove a live writer's lock.

## One deliberate recovery of missing evidence

After resolving the provider/readiness issue, inspect `recoverableCases` in status. One explicit additional call is supported for a case with no answer or an interrupted, ambiguous reservation:

```sh
npm run ai:measure:openrouter -- --recover-case 'EXACT_KEY_FROM_STATUS' --vision-model VERIFIED_QWEN_ID
```

The key is the JSON tuple printed by status; quote it as one shell argument. This command makes at most one new call and then exits. It is not combined with `--run`. It may incur another charge even if the original outcome was unknown. The original attempt remains in the checkpoint. A second recovery of the same case is refused, including after an interrupted recovery. A normal resume never invokes recovery by itself.

Scored correct/wrong answers and content-filter responses cannot be retried. If recovery produces a result, it becomes that case's final evidence—including an incorrect answer or protocol failure. The original provider error and potential charge remain visible in attempt diagnostics. It cannot be used to cherry-pick a better scored answer. Model, case, budget, profile and provider policy stay fixed; OpenRouter still chooses the host. A response served by another host counts only for that host.

If an answered fallback leaves host-specific coverage incomplete, report the gap honestly. Do not automatically re-send answered cases until a desired host appears. Any further controlled measurement needs a deliberate plan consistent with the owner's restrictions.

## Reports and approval boundary

`progress.json` distinguishes retained results, provider errors, ambiguous reservations, explicit recoveries, unattempted cases and complete coverage. Coverage is not qualification. `tier-1` through `tier-4` JSON/Markdown reports retain case-level host provenance and use the existing host-qualified summaries/gates. Different hosts never fill each other's coverage gaps. `overview.md` records the stop reason and links the evidence conceptually; no provider-wide order is set.

`--finalize` regenerates reports from the same checkpoint without calling scorers or models. If measurement inputs have changed, restore the recorded source revision/configuration before recovery; incompatible evidence is never silently resumed. Report/documentation commits alone do not change the campaign identity.

Commit the generated evidence and bring the model+host lineup to the owner. Recording/loading approved host-scoped capability rows and activation remain separate reviewed work after the owner's lineup approval. Neither this command nor any of its modes supports `--record` or mutates tier orders.
