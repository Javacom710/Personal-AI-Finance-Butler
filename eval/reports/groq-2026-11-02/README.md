# Groq measurements — 2026-11-02

Provider: `https://api.groq.com/openai/v1`. Base: merged PR #37 (`faa20f9`). All live commands use `--no-record`. No tier order, gate, prompt, scorer or golden suite was changed.

## Completed access evidence

`npm run ai:reachability` exited 0. Both configured GPT-OSS models answered. The five retained NVIDIA evaluation candidates returned transport failures on the Groq endpoint; these are not quality scores. See `reachability.txt` and `catalogue.json`.

Groq's [vision documentation](https://console.groq.com/docs/vision) identifies `qwen/qwen3.8-27b` as a multimodal model; the authenticated catalogue includes it. It accepted image requests in the unchanged Tier 4 document suite: 3 HTTP 200 responses in the interrupted attempt. Eight other cases returned HTTP 400 `json_validate_failed`. No prompt or schema adjustment was attempted. A successful HTTP response alone establishes neither correct extraction nor production eligibility.

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
| 1 | None yet | Complete all six suites for both 120B and 20B before comparing or approving an order. Existing declared defaults are unchanged. |
| 2 | `[]` | Keep closed; 120B needs its own five suites and tier-specific eligibility before acceptance. |
| 3 | `[]` | Keep closed; independently measure its five suites at Tier 3 budgets. |
| 4 | `[]` | Keep closed; complete the Qwen document suite and verify its declared support before any proposal. |

This is an incomplete measurement checkpoint, not a final lineup recommendation. Preserve completed suite reports between days; never treat missing suites as passed. After all measurements, propose the order using the unchanged gates and bring it to the owner for approval. Do not set orders or run `--record` until that approval.

## Provider provenance fix

New reports carry a normalized endpoint identity (scheme, host, port and base path; no user information, query or fragment). Recording refuses missing or mismatched provenance. `latestEvaluations()` filters by active endpoint before choosing latest rows; the pure capability loader also filters and fails closed without a provider identity. Rows lacking provider identity are ineligible. Existing JSON detail carries the field, so no schema migration is needed. This closes #37's P1 before any live measurement is stored.
