# Groq measurements — 2026-11-02

<!-- project-doc-status:start -->
> **Status reviewed 12 November 2026:** Phase 8 quality/release review open; Phase 9 live AI disabled; Overview, Scenarios, metrics and TWR built; Phase 10 partial. OD-21/22/23 remain open. DeepInfra direct is selected.
> **Current references:** [Project state](../../../PROJECT-STATE.md) · [Roadmap](../../../docs/ROADMAP.md) · [Maintained deadline forecast](../../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence; original score and finding body retained, source contracts may be historical.
<!-- project-doc-status:end -->

Provider: `https://api.groq.com/openai/v1`. Base: merged PR #37 (`faa20f9`). All live commands use `--no-record`. No tier order, gate, prompt, scorer or golden suite was changed.

## Completed access evidence

`npm run ai:reachability` exited 0. Both configured GPT-OSS models answered. The five retained NVIDIA evaluation candidates returned transport failures on the Groq endpoint; these are not quality scores. See `reachability.txt` and `catalogue.json`.

Groq's [vision documentation](https://console.groq.com/docs/vision) identifies `qwen/qwen3.8-27b` as a multimodal model; the authenticated catalogue includes it. It accepted image requests in the unchanged Tier 4 document suite: 3 HTTP 200 responses in the interrupted attempt. Eight other cases returned HTTP 400 `json_validate_failed`. No prompt or schema adjustment was attempted. A successful HTTP response alone establishes neither correct extraction nor production eligibility.

## Completed suite checkpoint — still partial Tier 1 coverage

[`2026-11-02T13-20-02-tier1.md`](../2026-11-02T13-20-02-tier1.md) and its JSON contain the full 40-case **parse v2** suite for `openai/gpt-oss-120b`: **35/40 correct**, **40/40 schema-valid**, **0 unanswered**, and **40 stop finishes** at the unchanged 1,024-token production budget/default profile. Failures: `parse-021`, `parse-025`, `parse-029`, `parse-032`, `parse-035`. Command: `npm run ai:eval -- --tier 1 --suite parse --model openai/gpt-oss-120b --interval-ms 3000 --no-record`.

The report proposes nothing because classify, tool-select, grounding, robustness and injection are missing. 35/40 is extraction accuracy; it must not be conflated with the schema gate. The latency caveat below applies. `daily-usage-summary.json` separately preserves provider-reported server latency and final conservative token accounting. Do not repeat this completed parse suite merely to finish the remaining Tier 1 suites.

## Interrupted attempts — never use for routing

- Requested full Tier 1 command: `npm run ai:eval -- --tier 1 --model openai/gpt-oss-120b,openai/gpt-oss-20b --interval-ms 3000 --no-record`. Seven completed 120B requests appear in the journal. Paused and terminated before completing `parse`, when response headers showed only 110 tokens remaining in the minute bucket. No suite score/report was produced. The 20B run did not begin.
- Tier 4: `npm run ai:eval -- --tier 4 --model qwen/qwen3.8-27b --interval-ms 3000 --no-record`. Eleven requests completed before the conservative quota guard stopped the run. No completed document-suite report or quality score was produced.
- Tiers 2 and 3 have not yet run. They must measure 120B on their own suites. Its current declared entry is Tier 1 only; do not treat a cross-tier report as permission to route it at another tier.

The journal records statuses, usage when returned, limit headers and sanitized error metadata; it contains no model output or credential. It is not an evaluation report. No request was retried after a 429; none was observed.

## Quota accounting and latency limitations

The stated limits are 30 requests/minute, 1,000 requests/day and 200,000 tokens/day. Observed response headers additionally report **8,000 tokens/minute**, so three-second request spacing alone is insufficient. The temporary guard waited for token-bucket recovery and stopped before its conservative daily reserve would be exceeded.

The first guard overestimated failed image requests by counting base64 bytes as tokens. Its stop value of 193,427 is **not actual provider usage**. For subsequent accounting, each of the eight errors was bounded at 8,192 tokens: less than 4,096 bytes of prompt/schema text, 2,048 image tokens per the vision documentation, and the unchanged 2,048 output-token budget. Successful calls retain provider-reported usage; reachability retains a 2,048-token reserve. This yields an 84,131-token starting reserve before the later parse checkpoint. Unknown error usage remains an estimate, never a measured token count.

The temporary fetch guard's waits are inside the adapter's latency timer. Any resulting report latency includes quota waits and **must not be used to rank model speed**. Future pacing belongs outside the adapter's timer. No prompts, suites or scores were modified by the guard.

## Routing proposal status

| Tier | Proposed accepted order now | Reason / remaining measurement |
|---|---|---|
| 1 | None yet | 120B parse is complete; finish its other five suites and all six 20B suites before comparing or approving an order. Existing declared defaults are unchanged. |
| 2 | `[]` | Keep closed; 120B needs its own five suites and tier-specific eligibility before acceptance. |
| 3 | `[]` | Keep closed; independently measure its five suites at Tier 3 budgets. |
| 4 | `[]` | Keep closed; complete the Qwen document suite and verify its declared support before any proposal. |

This is an incomplete measurement checkpoint, not a final lineup recommendation. Preserve completed suite reports between days; never treat missing suites as passed. After all measurements, propose the order using the unchanged gates and bring it to the owner for approval. Do not set orders or run `--record` until that approval.

## Provider provenance fix

New reports carry a normalized endpoint identity (scheme, host, port and base path; no user information, query or fragment). Recording refuses missing or mismatched provenance. `latestEvaluations()` filters by active endpoint before choosing latest rows; the pure capability loader also filters and fails closed without a provider identity. Rows lacking provider identity are ineligible. Existing JSON detail carries the field, so no schema migration is needed. This closes #37's P1 before any live measurement is stored.

## Validation and continuation

Provider provenance: 1,949 unit tests and 8 targeted PostgreSQL 17 integration tests pass; typecheck, lint, production build, client-secret scan and diff whitespace checks pass. The config, capability declarations, prompts, golden tasks, score module and harness are unchanged from merged #37.

The earlier daily automation (14-occurrence cap) is **paused as of 2026-11-02 15:22 UTC**. No automatic runs occur while paused. Completed evidence is retained independently of the schedule. See the [finite remaining-work checklist](remaining-work.md): 610 planned cases, 48 retained results, 562 not yet attempted in usable evidence. No passing outcome is required from an unsuitable model; report its failure and exclude it under the unchanged gates.

Final daily checkpoint: 65 chat requests including reachability; 148,382 conservative reserved tokens (not billed usage). Future quota windows must retain the completed parse report.

## Continuation — 2026-11-02, 15:06–15:09 UTC

20B's unchanged **robustness v2** suite now has [8/10 case checkpoints](../checkpoint-tier1-robustness-openai-gpt-oss-20b.json): 3 passed, 4 failed the existing scorer, and 1 received HTTP 400 (classified as `transport` by the unchanged adapter). Cases 009 and 010 remain unattempted. This is partial evidence, **not** a full-suite score or routing recommendation. Cases 002 and 007 returned tool calls marked invalid by the existing scorer. No output text was saved, and the HTTP 400 was not retried.

The [current daily ledger](../groq-budget-2026-11-02.json) supersedes the earlier stopping point: **73 chat requests / 183,316 conservative reserved tokens**, including the prior 148,382 baseline. Seven new answered requests reported 17,518 tokens; the unanswered request retains its 17,416-token upper reservation. This reservation is not billed usage. The next case's bound does not fit under the 190K stop point, so no more provider calls were made.

### Resume without repeating completed cases

```sh
AI_API_KEY="$Authorization_Groq" NODE_USE_ENV_PROXY=1 \
  npm run ai:eval:budgeted -- \
  --tier 1 --suite robustness --model openai/gpt-oss-20b \
  --interval-ms 3000 --no-record
```

Use the configured secret binding; never print it. The CLI requires one model/suite, `--no-record`, and no `--limit`; it never writes evaluation rows or tier orders. It saves scored case results after each request and resumes only when the provider, source files, request profile, suite version and production budget fingerprint match. Source-only changes invalidate checkpoints; report-only commits do not. Do not edit fingerprints to force a resume. The score checkpoint contains no model output.

Quota waits now occur **before** entering the production adapter. The new case latencies exclude those waits. Earlier parse timings retain their documented fetch-guard caveat. The existing harness's aggregation was extracted unchanged into `reportFromCases`; the runner's existing count/summary helpers are reused. No gate, scorer, prompt, suite or request profile changed.

The CLI reserves UTF-8 text bytes, tool-envelope overhead, image tokens and the production output budget before a request; it reconciles only when the provider reports usage. It stops without a retry on HTTP 429 and stops before issuing an unaffordable request. Its ledger counters are UTC-day scoped: before starting a fresh day's ledger, also conservatively account for any preceding-24-hour activity; a date change alone does not prove provider quota reset. A lock prevents overlapping measurements; inspect its PID before removing any stale lock.

Verified a second invocation at the reserve stop issued **zero requests** and left both ledger and score-checkpoint SHA-256 hashes unchanged. Tests confirm batch and checkpoint aggregation agree and that image base64 bytes are not counted as tokens. All **1,952 unit tests**, typecheck, lint, production build and client-secret scan pass. The prior eight targeted integration tests and PostgreSQL 17/18 CI were green before this continuation; latest-push CI is reported separately by GitHub.

The automation is paused. Its retained resume instructions cover only cases 009/010 next, preserve the completed 120B parse report, and require quota accounting before any additional suite. No accepted tier order is proposed yet.

The finite checklist was generated and validated offline against the current suite versions and retained case IDs. No source file, scored checkpoint, prompt or gate changed, and no additional provider request was made when pausing the automation.

## Development continuation — rolling-window preflight

Use **`npm run ai:eval:budgeted -- <existing evaluation arguments>`** for subsequent measurements. `scripts/ai-eval-budgeted-run.ts` first locks the quota ledger, imports native usage from the preceding 24 hours, and only then launches the existing checkpointed evaluator. `npm run ai:eval:budgeted -- --check-only` performs the offline accounting without launching any provider call. The original direct CLI's UTC-day counter alone does not provide this rollover protection.

Carry is kept separately from native usage, so it cannot be imported again as fresh usage on later days. Refreshing carry preserves today's calls and crash reservations. Unknown older timestamps are bounded conservatively; the first locked preflight can seal existing un-timed reservations with the current time as an upper bound. Repeated checks do not extend that time. Today's original 65-request / 148,382-token baseline was sealed at `2026-11-02T15:39:14.511Z`, so that conservative baseline can remain reserved until 24 hours after that timestamp even though the actual calls were earlier. The total remains **73 requests / 183,316 reserved tokens**, not billed usage.

The existing evaluator, budget helper and all AI source files were left unchanged, and the saved 8-case robustness fingerprint was recomputed successfully. New code lives outside those fingerprint inputs. Tests cover midnight rollover, 24-hour expiry, double-count prevention, preservation of current usage, unknown/crash reservations, malformed ledgers and a two-invocation offline CLI test with fetch denied. Automation remains paused; no new live results were recorded or tier orders changed.

Validation for the rolling-window wrapper: **1,958 unit tests**, typecheck, lint, production build and client-secret scan pass. On a fresh day with imported calls, the wrapper also allows the preceding minute bucket to refill before invoking the evaluator; check-only performs no wait or provider call.

## Finite batch coordinator

The primary entry point is now **`npm run ai:measure:groq`**. It reads the fixed [23-entry plan](../groq-measurement-plan.json), validates the retained evidence and generates a [consolidated progress/readiness report](../groq-workflow-progress.md) plus [JSON](../groq-workflow-progress.json).

```sh
# Offline: validate evidence and refresh current progress/readiness.
npm run ai:measure:groq -- --status

# Offline: recover reports after all cases were checkpointed but report writing failed.
npm run ai:measure:groq -- --finalize

# Live, only when quota permits: execute the complete remaining queue.
AI_API_KEY="$Authorization_Groq" NODE_USE_ENV_PROXY=1 \
  npm run ai:measure:groq -- --run
```

The batch command finalizes completed reports first, resumes partial suites next, then starts pending suites. It keeps going after each successful suite, skipping completed coverage. A partial/no-progress stop, child failure or provider quota/auth/server failure stops the queue without retrying or discarding evidence. The queue has a finite bound: at most one successful completion per planned suite entry in an invocation. A second workflow lock prevents overlapping coordinators; signals are forwarded through the wrapper to the evaluator. Inspect a lock's PID before any stale-lock cleanup.

Evidence validation checks endpoint, source fingerprint, model, tier, profile, suite version, production budget, exact case IDs, duplicate IDs, full report coverage and agreement between reports and retained scores. Unreferenced loose reports, partial `--limit` runs and stale/foreign evidence cannot silently satisfy the plan. The original 120B parse report is an explicit legacy reference in the fixed plan. Source-bound checkpoints are required for subsequent evidence.

Offline finalization uses the original harness aggregation and proposal helpers without a provider call or rescoring. A regression test compares recovered model summaries/exclusions directly with the ordinary live runner fed a fake provider. Other tests cover positive and negative evidence validation, full-queue completion, partial/no-progress stops, HTTP 429, child failure, lost evidence, exact-count quality aggregation and declaration gaps. Quality failures remain visible; coverage completion is not a passing quality claim.

The consolidated JSON separates per-candidate missing suites, unchanged numeric gate failures and declaration/tier support gaps. It does not pool or rank the earlier contaminated latency measurements. It never records live results or accepts tier orders. The static `remaining-work.json`/`.md` files are historical snapshots; the generated workflow progress files are the current overview.

Both offline modes were executed with fetch blocked. They retained **48/610** case results and left the real quota ledger and 8-case checkpoint SHA-256 hashes unchanged. No live model call was made during this development. The one-time continuation on **3 November at approximately 21:30 IST** now uses the batch coordinator; the former recurring schedule remains paused.

Full coordinator validation: **1,989 unit tests** (31 workflow cases), typecheck, lint, production build, client-secret scan and whitespace checks pass. The complete measurement suite has not run yet; live model evidence remains quota-limited and must be completed before accepting a lineup.
