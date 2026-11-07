# Read-only assistant workload evidence — 7 November 2026

Status inspection confirmed that reconciliation PR #51 remains open and mergeable without outstanding review threads, and final-head CI run [42385230550](https://github.com/Javacom710/Personal-AI-Finance-Butler/actions/runs/42385230550) passes on PostgreSQL 17 and 18. Phase 8 remains unqualified; the owner has not approved recording or activation. This continuation is limited to the already-approved Phase 9 assistant slice and is stacked on #51.

## Change

Clipped source evidence previously showed its limit only as `truncated: true` inside the source details. An answer displaying three recent transactions could be mistaken for a complete ranking even when the largest expense was omitted. A regression reproduced the missing visible label before the change.

Assistant source summaries now display **partial results** when the existing source metadata says rows were clipped. The expanded evidence explains that omitted rows can affect comparisons/rankings and that authoritative totals, where supplied, still apply. Failed reads retain their unavailable state; complete/unmarked results retain their normal summary. Exact source values, metadata and export payloads are preserved. This affects saved conversation rendering as well as in-memory answers. There is no new read, schema, provider, prompt, rubric, threshold, authorization rule or capability gate.

Twelve workload regressions use synthetic financial records with the real owner-bound dispatcher and engine. They check prior/current month spending, category totals, a limited list that omits the largest expense, month differences, exact savings rates, unavailable zero-denominator metrics, transfer/balance behavior, cost net worth, history levels, partially priced portfolios, holdings and allocation. The final provider request receives the exact retained projected result, and the UI renders its expected digits and scope. Another owner's records stay absent. A thirteenth check confirms that the complete money/investment ledgers and audit rows are unchanged across the corpus.

The fake provider supplies calls and a generic explanation; it does not prove model intent recognition, reasoning, arithmetic or prose quality. The roadmap's real-model question gate remains unchecked. No source-bound measurement archive is relabeled and no live campaign is rerun.

## Verification

- **68 focused unit checks** pass across the assistant, answer/release presentation and conversation actions. The final presentation assertions pass separately in all **14 cases**, including unavailable-over-partial precedence, complete/unmarked source handling, escaping and disabled controls.
- **16 focused integration checks** pass on PostgreSQL 17/18 across the workload and existing assistant files. The final tightened 13-case workload file was rerun on 17; the 18 run includes the tightened assertions. Distinct app/migrator roles and disposable databases were used.
- Typecheck, lint, the default production build, client-secret scan and whitespace checks pass. No dependency changed.
- A production HTTP smoke creates a synthetic saved exchange with one of two matching transaction rows, using an injected fake provider. The authenticated conversation page shows the partial summary/warning and exact `20.5000` value; signed-out access redirects to login. Its private, no-store JSON export preserves clipping metadata and the exact amount. The assistant's question controls remain disabled. This is an HTTP check, not browser automation or live-model evaluation.
- An initial disposable-PostgreSQL startup race was corrected in the temporary test driver by waiting for TCP readiness rather than the entrypoint's temporary Unix-socket server. No repository/database-runtime configuration changed.

No live AI requests, live-measurement recording or activation occurred. The selected provider remains DeepInfra direct, Google/Anthropic remain excluded, and OpenRouter remains unactivated. [Machine-readable verification](2026-11-07-assistant-workload-evidence-verification.json) retains the reproduction and result hashes.
