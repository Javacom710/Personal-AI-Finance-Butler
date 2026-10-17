> **Historical record — recovered 2026-10-17.** Written 2026-09-24 against `H:\Claude\AI Enabled Personal Finance`, outside the repository, and rebuilt byte-for-byte from the session transcript after that drive failed. Commit ids and line numbers refer to the H: copy: the authoritative line then was `a6d0d20`. Since then `1515eb1` added 73 lines to `PROJECT-STATE.md` and moved `docs/ROADMAP.md` (Phase 7 "Done when" now starts at L377), so look items up by their text. Current status of each blocker: [RECOVERY-2026-10.md](../RECOVERY-2026-10.md#blocker-status).

# Phase 8 Entry-Gate Audit

Repository `H:\Claude\AI Enabled Personal Finance` · Git `C:\Program Files\Git\cmd\git.exe` 2.55.0.windows.5
Audit window 2026-09-24 19:07:48 → 19:24:20. Every execution ran in scratch trees extracted with `git archive`
(on C:, outside the repository); the canonical repository was only read.

---

## 1. Executive Conclusion

**Phase 8 cannot legitimately begin.** Four BLOCKING items remain, in dependency order:

1. **B-1 — Reconciliation not done.** HEAD is `cf91bc6`; the authoritative Phase 7 tip `a6d0d20` does not contain it; no
   commit has the verified reconciled tree `2092347219ae339d875d06cb24c14f234c026d5a` (the tree object is absent).
2. **B-2 — The AI boundary has a relative-import escape.** From `src/server/ai/**`, `../ai-runtime` and `../<new sibling>`
   pass both ESLint and the source scan (probed). `ai-runtime.ts` hands out the credentialed provider, which would bypass
   the kill switch and rate limiter. ROADMAP L370 ticks this criterion as met.
3. **B-3 — Phase 7 exit criteria unmet:** no daily budget; no startup capability validation; row caps / truncation /
   byte budget untested; `required`-array completeness asserted on one sample only; catalogue confirmation stale for one
   candidate.
4. **B-4 — Phase 7 not recorded complete.** 12 of 16 ROADMAP "Done when" boxes are unticked; the project protocol
   (PROJECT-STATE L65) makes every tick a precondition; status lines still say "not started".

Proven: the Phase 7 implementation exists and its read-only boundary holds on every route tested except the relative
one. The reconciled tree passes every gate: **1,559/1,559 tests with and without an NVIDIA key**, typecheck, lint, build,
`npm audit --audit-level=high` exit 0, secret scan, `verify:integrity` 33/0/0 with I-50…I-58.

**Canonical Phase 8 = Model Evaluation** (`Workflow Setup.txt`, ROADMAP L387, ADR-20). **NOT STARTED** under both competing
definitions. As shipped, every AI capability routes to **zero** models — all 7 capability entries are `declared` and
routing requires `measured` — by design; producing the measurements is Phase 8.

**Single next operation:** reconcile `cf91bc6` onto `a6d0d20` on a new branch; the result must have tree `2092347…`.

---

## 2. Current Git State

| Item | Value | Evidence |
|---|---|---|
| Branch | `claude/phase-7-ai-infrastructure-review` | `symbolic-ref` |
| HEAD | `cf91bc6732345b5be40e2cad8de79112e534f9a2` | `rev-parse HEAD` |
| HEAD tree | `74497ac908acf0bc46eac95a09f318d35b7ad9f6` | `rev-parse HEAD^{tree}` |
| Working tree / staged | clean (0) / 0 | `status --porcelain=v1 -uall`, `diff --cached` |
| Objects / packs / commits | 981 / 0 / 30 | `count-objects -v`, `rev-list --all --count` |
| Stash / tags / remotes | 0 / 0 / 0 | |

| Tip | Tree | Branch |
|---|---|---|
| `1d560ab` | `c2e451a856bb` | master |
| `f9fb927` | `d6d121f3505c` | claude/financial-core-money-management-4d575e |
| `2febe14` | `5e571538aed9` | claude/investment-engine-review-3ed9bd |
| `8b60a6d` | `5e331ed17c90` | claude/phase-4-investment-engine-4552c9 |
| `ad18949` | `bbf322596d27` | claude/net-worth-architecture-review-7b1dc5 |
| `a1cf942` | `27d5cb3e7dcd` | claude/phase-6-market-data-review-2fc982 |
| `2bc9bc7` | `5e244a104613` | claude/market-value-net-worth-50cef4 |
| `cf91bc6` | `74497ac908ac` | claude/phase-7-ai-infrastructure-review **(HEAD)** |
| `cbc0637` | `cb452b84deda` | claude/phase-7-pre-impl-findings-033f02 |
| `a6d0d20` | `1a6f135e6c8a` | claude/phase-7-env-health-verify-120b90 |

Worktrees: 8, each clean with 0 staged — main (`cf91bc6`) and seven under `.claude/worktrees/` on `2febe14`, `a1cf942`,
`ad18949`, `2bc9bc7`, `8b60a6d`, `a6d0d20`, `cbc0637`.

```
1d560ab … 2bc9bc7 ─ 12bb254  (Phase 7 design review)
                      ├─ cf91bc6                                               [phase-7-ai-infrastructure-review] HEAD
                      └─ c773551 ─ 1483166 ─ c9fe823 ─ cbc0637 ─ a6d0d20
                                                       [pre-impl]  [env-health-verify]
```

- `merge-base --all cf91bc6 a6d0d20` = `12bb254` (single). Parents: `cf91bc6`→`12bb254`, `c773551`→`12bb254`.
- `rev-list --left-right --count cf91bc6...a6d0d20` = **1 / 5**. The other 7 branches are ancestors of `12bb254`.
- Commits not on the authoritative line (`log --all --not a6d0d20`): **exactly one — `cf91bc6`.**
- **Reconciled: NO.** 0 commits carry tree `2092347…`; `cat-file -e 2092347…` exits 1. State: **pre-reconciliation**.

---

## 3. Phase 7 Reconciliation Status

**Not reconciled.** Per file — current HEAD vs the Phase 7 tip vs the intended result:

| File | HEAD `cf91bc6` | `a6d0d20` | Intended `2092347` |
|---|---|---|---|
| `eslint.config.mjs` | pre-Phase-7 AI rule + `'.claude/worktrees/**'` | Phase 7 allowlist + `'.claude/**'` | **= a6d0d20** |
| `package-lock.json` | `e8aaf01` (patched) | = `12bb254` (`next` 16.3.0) | = cf91bc6 |
| `src/server/jobs/index.ts` | `2c1140d` (4 × `{ now }`) | = `12bb254` (4 bare) | = cf91bc6 |
| `src/server/jobs/runner.ts` | `cf7b969` | = `12bb254` | = cf91bc6 |
| `tests/integration/jobs.test.ts` | `3717a04` | = `12bb254` | = cf91bc6 |

HEAD additionally lacks all 63 files the Phase 7 line changed. Both differences are expected: they are the reconciliation
itself.

**Phase 7 AI security configuration** is intact at `a6d0d20` and unchanged in `2092347` (same `eslint.config.mjs` blob):
`aiZonePatterns` (23 entries, L20-66), AI-zone object (L259-267), provider object (L279-283), `ai-read` zone (L296-333).
The source scan reads `aiZonePatterns` out of this file (test L65-69) and asserts `'.claude/**'` (test L313). **The
current HEAD does not contain this configuration** — it is a sibling of the Phase 7 line.

---

## 4. Phase 7 Implementation & Security Status

Inspected at `a6d0d20`; `2092347` differs only in the four stabilization files.

### Architecture

| Item | State | Evidence |
|---|---|---|
| `AiProvider` | present | `provider/types.ts:122` |
| NVIDIA Build provider | present | `createNvidiaProvider` over injected `fetch` (`nvidia-build.ts:152`), Bearer header only (L173), abort timeout (L164), 429 + `retry-after` (L186, L299), `/models` (L277) |
| Model catalogue | present | `CANDIDATE_POOL` declared → catalogue ids (`models.ts:48-100`); 5 candidates `null` (GLM-5.2, nemotron-nano-12b-v2-vl, DeepSeek-v4-pro, Mistral-medium-3.5, Qwen3-next); tier order L122-138; env overrides L173 |
| Capability-first routing | present | `selectCandidates` (`select.ts:103`); tool/schema/vision gates (L72-81); **unmeasured score excluded** (L91) |
| Fallback | present | `runChain`, `MAX_ATTEMPTS = 3`, stop on `fail_closed` (`fallback.ts:27, 105`) |
| Circuit breaker | present | 3 failures → open 5 min, doubling to 60 min, half-open probe (`breaker.ts:28-30, 112-118`) |
| Measured model availability | **catalogue only** | ids confirmed by authenticated read (2026-08-31); **capability quality unmeasured**: all 7 `DECLARED_CAPABILITIES` are `source: 'declared'` (`capabilities.ts:85-163`); runtime passes no measurements (`ai-runtime.ts:156`) |
| Strict schemas | present | Zod `safeParse`, one repair then reject (`validate.ts:91-143`) |
| AI tools | present | 18 read-only tools, inputs `.strict()`, handler `(ai: AiReadCtx, input)` (`registry.ts:52-220`) |
| `AiReadCtx` | present | 7 readonly data fields, no `db`/`fx`/`tx` (`ai-read/index.ts:66-77`) |
| Rate limiter | present | per-user 60 s window, in-process memory (`ai-runtime.ts:92-115`), enforced at L235; `AI_RATE_LIMIT_PER_MINUTE` default 10 |
| Kill switch | present | `settings.aiEnabled` read first, fail-closed, "No request was sent" (`ai-runtime.ts:61-64, 228-229`) |
| Observability | present | outcome, latency, fallback depth, tokens; no prompt/content fields (`usage.ts:35-104`) |
| Eval harness | present (infrastructure) | `evaluateModel`, 10 suites (`eval/harness.ts:27-96`); **no corpora** |

**Routing consequence:** thresholds are schema 0.95 / tools 0.90 (`requirements.ts:83-84`) and every capability carries
one; unmeasured candidates are excluded (`select.ts:91`; asserted by `ai-routing.test.ts` L181, L221). **No capability
can execute end-to-end today.** The 2026-08-31 live smoke test called the provider directly (`ai-smoke.ts:61-140`),
bypassing the router.

### Security boundary

| Requirement | Result | Evidence |
|---|---|---|
| AI code cannot obtain `RequestCtx`/`WriteCtx` | **HOLDS** | `AiReadCtx` has no handles; `withWriteCtx(ctx: RequestCtx)` (`_ctx.ts:187-188`; accepted `ReadCtx` at `12bb254`); AI zone denied services and `ai-read/internal`; `tsc` probes `ai-write-boundary.test.ts` L134-246 |
| No arbitrary `@/server/**` (aliased) | **HOLDS** | deny `@/server/**`, re-admit only `ai-read` and `log` (eslint L24-31); probe: `@/server/db/client`, `@/server/ai-runtime`, `@/server/evaluation/store` → FORBIDDEN |
| Only allowed server modules reachable | **FAILS for relative specifiers** | probe (same `ignore` 5.3.2, same 23 patterns): `../ai-runtime`, `../../ai-runtime`, `../evaluation/store` → **ALLOWED**; ESLint on `src/server/ai/tools/_probe.ts` importing `../../ai-runtime` → exit 0, rule silent; control `../../services` → rule fires |
| Relative escapes blocked | **PARTIAL** — 10 named siblings only | eslint L33-56; test L278-289 names the same 10; `ai-runtime` and future siblings absent. Test L197-198 promises "whatever Phase 8 adds under src/server/ is shut on the day it is created" — true only for aliased imports |
| Dynamic `import()` / `require()` | **HOLDS** | extracted by `specifiersIn` (test L93-98); proven L223-239 |
| Provider exemption scoped | **HOLDS** | `nvidia-build.ts` removed only from the AI-zone object (L260) and re-bound to `aiZonePatterns` (L279-282); test L299-308 |
| Scan and ESLint compatible | **HOLDS** | single source — the scan reads `aiZonePatterns` from the config; both share the relative gap |
| `AiReadCtx` immutable, unforgeable | **HOLDS** | `Object.freeze` (`internal.ts:52-60`), module-private `WeakMap` (L36, L61), unminted copy refused (L78-85); `ai-read-capability.test.ts` L55-134 |
| AI tools cannot write | **HOLDS in present code** | tools take `AiReadCtx`; `ai-read/queries.ts` imports 17 read services only; 0 DML or `.db` uses in `ai-read` |

**Exposure of the relative gap:** `ai-runtime.ts` exports `aiRuntime()` → `{ provider, orchestrator, isConfigured }`,
with the provider built from `NVIDIA_API_KEY` (L140); `resetAiRateLimits()`; `isAiEnabled()`; `runAiCapability()`. The
kill switch (L228) and rate limit (L235) live inside `runAiCapability`, so a direct `provider.chat()` bypasses I-58.
Current imports of `ai-runtime` from `src/server/ai/**`: **0**.

**Latent write path (no present violation):** `ReadCtx.db` is the full drizzle executor (`DbExecutor = Database |
DbTransaction`, `db/client.ts:31`); drizzle 0.45.2 `execute(query: SQLWrapper | string)` accepts a bare string; the
`CTX_DML` scan covers `src/server/ai/**` only and matches the receiver `ctx.db` only.

---

## 5. Phase 7 Verification Results

Scratch trees: **P7** = `git archive a6d0d20` (343 files); **RECONCILED** = `a6d0d20` + `cf91bc6`'s four blobs, equal to tree
`2092347` on all 343 paths. Fresh `npm ci` in each. Runs on 2026-09-24; audits at 19:16.

| Check | P7 `a6d0d20` | RECONCILED (key set) | RECONCILED (no key) |
|---|---|---|---|
| `npm ci` | exit 0 | exit 0 | — |
| typecheck | exit 0 | exit 0 | — |
| lint | exit 0 | exit 0 | — |
| unit | 994/994 (45 files) | 994/994 | 994/994 |
| property | 65/65 (6 files) | 65/65 | 65/65 |
| integration | **496/499 (24 files), exit 1** — 3 × `jobs.test.ts` `expected 3 to be 2` | **500/500** | **500/500** |
| **Total** | **1,555 / 1,558** | **1,559 / 1,559** | **1,559 / 1,559** |
| build | exit 0 | exit 0 | — |
| `npm audit --audit-level=high` | **exit 1** — `next` critical (GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4), high `js-yaml` (GHSA-2883-xcg3-v3hh), high `sharp` (GHSA-rgj7-g3m4-5g8c), 6 moderate | **exit 0** — 4 moderate, GHSA-67mh-4wv8-2f99 only | = |
| `check:no-client-secrets` | exit 0 — 21 files, 7 values | exit 0 — 21 files, 7 values | — |
| `verify:integrity` (read-only role) | exit 0 — 33 passed, 0 failed, 0 warning, 28 engine, 2 N/A | same | — |
| I-50 … I-58 | reported engine-enforced; their tests pass | same | same |

P7 reproduces its branch's own 2026-09-03 record exactly (PROJECT-STATE L1109, L1113-1114). Canonical HEAD `cf91bc6`:
audit exit 0 (4 moderate, today); suite 1,397/1,397 on 2026-09-23, not re-run because HEAD has not changed.

**Stabilization issues:**
- **A. Job clock** — fixed on `cf91bc6` and in `2092347`; **present on `a6d0d20`** (4 bare `createReadCtx(userId)` at
  `jobs/index.ts:50, 126, 144, 165`; 3 failures reproduced). Phase 7 adds no job handler and no `runDueJobs` caller; the
  other bare `createReadCtx` calls are the 5 request boundaries in `app/`. The full suite shows 0 date-dependent failures
  today. **Not established:** that no other test has a latent wall-clock dependency — not audited test by test.
- **B. ESLint worktrees** — `a6d0d20` has `'.claude/**'` since `c773551` (`git log -S`), asserted by test L313, AI rules
  intact. `cf91bc6` has `'.claude/worktrees/**'` without the Phase 7 AI rules.
- **C. Audit** — as tabled; the drizzle-kit chain is the only issue left once reconciled.
- **D. Tests** — as tabled.

---

## 6. Canonical Phase 8 Definition

1. **Official meaning:** Model Evaluation — `Workflow Setup.txt` ("PHASE 8: Model Evaluation"); ROADMAP L387-400: golden
   suites, runner, deterministic scoring, **populate `capabilities.json` and `ai_model_evaluations`**, select routing order
   per tier.
2. **Authority when documents disagree:** ADR-20 (`DECISIONS.md`) — "`Workflow Setup.txt` is the canonical phase map …
   Where it differs from `CLAUDE.md <development_method>`, the workflow file wins."
3. **Competing definitions:** yes. `CLAUDE.md` and `AGENTS.md` `development_method`: PHASE 6 = AI Foundation, PHASE 7 =
   Model Evaluation, **PHASE 8 = AI Features**.
4. **Governing definition:** Model Evaluation. ADR-20 decides it; the code enforces it — `ai-runtime.ts:156` supplies no
   measurements, so `select.ts:91` excludes every candidate and no feature can run until evaluation produces them;
   `harness.ts:14` — "Phase 8 supplies the task corpora and executes this"; PROJECT-STATE L1101 hands catalogue drift to
   "Phase 8 … with the eval harness"; ROADMAP L308 — "Phase 8 (model evaluation) and Phase 9 (AI features) have NOT started".
5. **Actual Phase 8 implementation:** none (§7).
6. **Only references:** 33 "Phase 8" mentions in 13 files — documents, `harness.ts` (2), `ai-boundary-source-scan.test.ts`
   (1). The harness scaffolding is Phase 7 infrastructure by its own header.
7. **`ai-proposals` or equivalent:** none. No table — `schema.test.ts` L66-72 asserts `ai_proposals` and `ai_conversations`
   do not exist, and passes. No route — `app/(app)/ai/page.tsx` is the "Not connected" placeholder, unchanged since Phase 2.
   No service. `ai_confirmed` is Phase 2 groundwork: an `audit_actor` enum value (`enums.ts:24`) set when a service call
   passes `source === 'ai'` (`transactions.ts:447`, `investments.ts:344`).
8. **Commits claiming Phase 8 work:** none. The only commit matching "phase 8", `c9fe823`, says those features are *not*
   included.

---

## 7. Phase 8 Implementation Status

**Phase 8 status: NOT STARTED** — under the canonical definition and under CLAUDE.md's.

| Evidence | Result |
|---|---|
| Eval corpora (`EvalCase` data) | 0 files — `harness.ts` only defines the type |
| `capabilities.json` | 0 tracked files; 0 non-doc references |
| `ai_model_evaluations` | no table, no migration; 0 non-doc references; no migration changed on the Phase 7 line |
| Measured capabilities | 0 — all 7 entries `declared` |
| Production routing order | still `DEFAULT_ORDER` (`models.ts:122-138`) |
| "CI fails on missing/stale entry" | absent (`.github/workflows/ci.yml` has no such step) |
| Features (Phase 9 / CLAUDE.md's Phase 8) | none — no proposal table, route, service or UI |

---

## 8. Phase 8 Blocker Register

Ordered by dependency.

### BLOCKING

**B-1 — Stabilization not on the authoritative Phase 7 line**
- Path: branch `claude/phase-7-env-health-verify-120b90` @ `a6d0d20`; `jobs/index.ts`, `jobs/runner.ts`,
  `tests/integration/jobs.test.ts`, `package-lock.json`.
- Git: `cf91bc6` is not an ancestor of `a6d0d20`; no commit has tree `2092347`.
- Reason: on `a6d0d20` the suite fails (1,555/1,558) and `npm audit --audit-level=high` exits 1, including a critical
  RCE on Windows-hosted servers; both violate the project's gates (ROADMAP "Done when"; SECURITY.md §11).
- Evidence: §5 P7 column.
- Depends on: nothing.
- Minimum resolution: apply `cf91bc6`'s four non-conflicting files to `a6d0d20`, keeping `a6d0d20`'s `eslint.config.mjs`;
  result tree `2092347`.
- Type: Git.
- Risk if ignored: Phase 8 is built on a red suite and a lockfile with a critical Windows RCE; CI's audit step fails.

**B-2 — Relative-import escape from the AI zone**
- Path: `eslint.config.mjs` L20-66; `tests/unit/ai-boundary-source-scan.test.ts` L76-77, L274-292;
  `src/server/ai-runtime.ts`.
- Git: present since `1483166`; unchanged at `a6d0d20`.
- Reason: ADR-38 limits the AI zone to `@/server/ai-read` and `@/lib/**`. The relative path is a denylist of 10 names,
  not an allowlist. `ai-runtime.ts` exposes the credentialed provider and `resetAiRateLimits()`. ROADMAP L370 ticks the
  criterion as met.
- Evidence: probe in §4; 0 current violating imports.
- Depends on: B-1, since it edits `eslint.config.mjs` and the scan on the reconciled line.
- Minimum resolution: make relative specifiers deny-by-default — resolve each against the importing file and forbid any
  target under `src/server/` other than `src/server/ai/**`, `src/server/ai-read` (index) and `src/server/log`. Mirror the
  rule in ESLint and add tests for `../ai-runtime`, `../../ai-runtime` and a not-yet-existing sibling. Intra-zone
  relative imports must stay allowed, which is why this needs path resolution rather than string patterns.
- Type: code + tests.
- Risk if ignored: I-58's zero-egress guarantee and the rate limiter hold only by convention for any code Phase 8 adds.

**B-3 — Phase 7 exit criteria unmet**

Depends on B-1. Type: code / tests, or a recorded user decision (protocol L60 makes an architecture change a
stop-and-explain event).

| # | ROADMAP line | Finding | Evidence | Minimum resolution | Risk if ignored |
|---|---|---|---|---|---|
| a | L380 daily budget | **not implemented** | `'daily_budget'` only as a `RefusalReason` literal (`errors.ts:61`); no environment variable (`env.ts`: `NVIDIA_API_KEY`, `NVIDIA_BASE_URL`, `AI_RATE_LIMIT_PER_MINUTE`, `AI_REQUEST_TIMEOUT_MS`); no check in `ai-runtime.ts` | implement a per-user daily budget checked before egress, with a test — or record a deferral decision | usage bounded only by 10/min/user |
| b | L379 startup fails loudly | **not implemented** | no startup validation found; only routing-time `no_capability_entry` (`select.ts:117-118`); the criterion names `capabilities.json`, the code uses `capabilities.ts` | decide `.json` vs `.ts` (an architecture decision), then implement and test, or move it to Phase 8's CI gate | misconfigured tier lists are discovered per request |
| c | L376 caps / truncation / byte budget | **implemented, untested** | `DEFAULT_ROW_CAP = 50`, `MAX_ROW_CAP = 200`, `MAX_RESULT_BYTES = 150 * 1024` (`projections.ts:138-162`), applied at `queries.ts:132, 412, 514`; 0 tests. `withinByteBudget` counts `JSON.stringify(row).length` (UTF-16 units, not bytes) | add tests | regressions silently remove the caps |
| d | L372 complete `required` | **partial** | `ai-tools.test.ts` L206-211 checks one sample schema with `arrayContaining`; L65 covers strictness per tool | assert on every tool schema | an incomplete `required` goes undetected |
| e | L371 catalogue confirmed | **stale for 1 candidate** | met 2026-08-31 (`models.ts`; `ai-routing.test.ts` L59-97); Tier 1 primary absent 2026-09-03 (PROJECT-STATE L1097-1103), explicitly deferred to Phase 8 (L1101) | a recorded decision to tick it with that deferral | the Tier 1 primary fails over on every breaker window |

**B-4 — Phase 7 not recorded complete** (documentation, but a protocol gate)
- Path: `docs/ROADMAP.md` L67, L355, L367-383; `PROJECT-STATE.md` L5, L91, L1138, L1285.
- Reason: PROJECT-STATE L65 — "A phase is complete only when every box in its ROADMAP.md 'Done when' list is ticked".
- Evidence — boxes already satisfied by passing tests, awaiting only their tick:
  - L373 no user identifier — `ai-tools` L53, `ai-infrastructure` L179;
  - L374 projection, no `bigint` — `ai-infrastructure` L211-248;
  - L377 fallback and breaker — `ai-routing` L279-385, `ai-provider` L172-238;
  - L378 no downgrade — `ai-routing` L240-270;
  - L381 kill switch — `ai-infrastructure` L100, L122;
  - L382 no key leakage — 7-value secret scan, `ai-provider` L77 and L187, 0 key references in tests;
  - L383 no-key suite — 1,559/1,559 on the reconciled tree, so tickable after B-1.
- Evidence — stale status lines:
  - PROJECT-STATE L5, L91 and L1285 still say "not started" / "start at step 7.0";
  - PROJECT-STATE L1138 still lists OD-1 as open;
  - ROADMAP L67 still reads "blocked by OD-1";
  - ROADMAP L355 still says step 7.7 was "not run", contradicting L308 and PROJECT-STATE L934, L1118.
- Evidence — nothing records the reconciliation, the move to H:, or today's re-verification off E:, which meets the
  PROJECT-STATE L1070 condition ("repository re-verified afterwards").
- Depends on: B-1, B-2, B-3.
- Type: documentation.
- Risk if ignored: the protocol is unmet; CLAUDE.md `<context_management>` requires verifying against these documents
  after context restoration, and L1285 would send a future session back to step 7.0.

### NON-BLOCKING

- **N-1** Latent write path in `ai-read` (§4): no present write; the `CTX_DML` scan could be extended to `ai-read` and to
  any receiver.
- **N-2** 4 moderate advisories, GHSA-67mh-4wv8-2f99 (esbuild → `@esbuild-kit/*` → drizzle-kit). Dev-only, below the
  high threshold; the fix is a semver-major drizzle-kit downgrade; documented accepted risk.
- **N-3** `npm ls` reports `vite@8.3.0` → `esbuild@0.25.12` as an invalid **optional** peer in the reconciled lockfile,
  plus a pre-existing invalid `@napi-rs/wasm-runtime`. Inert: `cssMinify` is unset, and 0 `transformWithEsbuild`
  warnings appeared across full runs (checked 2026-09-23 on the same lockfile).
- **N-4** The rate limiter is in-process memory — it resets on restart and is per process. Adequate for a single user
  and a single process.
- **N-5** Environment: machine PATH lists `E:\Git\cmd` before `C:\Program Files\Git\cmd`, and the faulty E: disk is
  still attached. Use the absolute C: Git.
- **N-6** The `cf91bc6` branch keeps 4 mojibake files inherited from `ddbaf86` (repaired on `a6d0d20`) and an inaccurate
  ESLint comment ("every glob in this file is anchored at the repository root" — false because of the base object's
  `'**/*.{js,…}'` glob). Neither reaches the authoritative line under the recommended resolution. The branch's future is
  a user decision.

### DOCUMENTATION-ONLY

- **D-1** `CLAUDE.md` and `AGENTS.md` are not byte-identical (CLAUDE.md has 27 extra lines of `<context_management>`),
  contrary to PROJECT-STATE "What exists".
- **D-2** CLAUDE.md and AGENTS.md phase numbering (Phase 8 = AI Features) is superseded by ADR-20 but not marked as such
  in either file.
- **D-3** `AI-INFRASTRUCTURE-DESIGN.md` L3 status line and the §3.2 rationale ("cannot be run yet", no key) are stale.
- **D-4** PROJECT-STATE L1066 says Disk 0 hosts `E:\` "and therefore the repository". The repository has moved to H:,
  and E: now enumerates as Disk 1. This is a dated historical record.
- **D-5** Stale comments in tests: `schema.test.ts` L59 labels later-phase tables "Phase 6+";
  `ai-boundary-source-scan.test.ts` L321 says "Phase 7 has not started".
- **D-6** The E: → H: relocation is recorded nowhere in the repository.

### UNKNOWN

- **U-1** Current contents of the authenticated NVIDIA catalogue — not queried, per instruction. The last record
  (2026-09-03) is 82 models with the Tier 1 primary absent. This is Phase 8 input.

---

## 9. Phase 8 Entry Contract

**Git**
- Authoritative branch: the Phase 7 line, advanced from `a6d0d20` by the reconciliation commit (parent `a6d0d20`, tree
  `2092347219ae339d875d06cb24c14f234c026d5a`), then by the B-2 / B-3 / B-4 commits.
- `cf91bc6`'s four blobs present; `eslint.config.mjs` equal to `a6d0d20`'s plus only the B-2 change.
- Working tree clean, 0 staged, every worktree clean; `git fsck --full --strict` exit 0.

**Phase 7 gates** — on the final pre-Phase-8 commit, run on a disk other than E:
- typecheck exit 0; lint exit 0.
- Tests: unit, property and integration with 0 failures and 0 skips, at least 1,559 tests, with **and** without
  `NVIDIA_API_KEY`.
- build exit 0; `npm audit --audit-level=high` exit 0 (only GHSA-67mh-4wv8-2f99 remaining).
- `check:no-client-secrets` exit 0 (7 values).
- `verify:integrity` 33 passed / 0 failed / 0 warning, with I-50 … I-58 engine-enforced.
- Every ROADMAP Phase 7 "Done when" box ticked, or re-scoped by a recorded user decision.

**Architecture**
- Provider and routing as implemented.
- The unmeasured-routing refusal remains in place — it is the gate Phase 8 satisfies.
- Catalogue drift recorded as Phase 8 input.
- Read-only boundary holds for aliased, relative (after B-2) and dynamic routes.
- Kill switch, rate limiter and daily budget (or its recorded deferral) in force.
- Observability records carry no content.

**Documentation**
- Authoritative:
  - `Workflow Setup.txt` for phase order (ADR-20);
  - `docs/ROADMAP.md` for phase scope and "Done when";
  - `PROJECT-STATE.md` for status;
  - `docs/DECISIONS.md` for ADRs;
  - `CLAUDE.md` for the product specification (its `development_method` numbering superseded).
- May remain: dated historical records — PROJECT-STATE L883-933 (step 7.0), L1050-1130 (2026-09-03 verification,
  including L1066 and L1181).
- Must be corrected before Phase 8: everything listed in B-4.

**Phase 8**
- Canonical definition: Model Evaluation.
- Status: not started.
- Prerequisites present: eval harness, provider, `createCapabilityMatrix(measured)` merge point, `NVIDIA_API_KEY` (in the
  Phase 7 worktree's `.env`).
- Absent (Phase 8 builds them): corpora, persistence of measurements (`capabilities.json` / `ai_model_evaluations`),
  loading of measurements into `ai-runtime`.
- **First implementation dependency:** golden task corpora for the harness suites (`harness.ts:14`).

---

## 10. Single Next Operation

**Operation 1 — reconcile `cf91bc6` onto `a6d0d20` as a new branch, in the main worktree.**

- **Why:** B-1 is the first dependency, and B-2, B-3 and B-4 must be built on the reconciled line. A new branch moves no
  existing ref.
- **Why the main worktree:** its `node_modules` was installed from lockfile `e8aaf01` (2026-09-16), which is the
  reconciled lockfile.

```powershell
$git = 'C:\Program Files\Git\cmd\git.exe'; $R = 'H:\Claude\AI Enabled Personal Finance'
& $git -C $R switch -c claude/phase-7-reconciled a6d0d20bce36e9057e131525b614715acbe159cc
& $git -C $R cherry-pick -x cf91bc6732345b5be40e2cad8de79112e534f9a2     # stops: CONFLICT in eslint.config.mjs
& $git -C $R checkout --ours -- eslint.config.mjs                         # keep a6d0d20's file whole — NEVER --theirs
& $git -C $R add -- eslint.config.mjs
& $git -C $R write-tree                                                   # must print 2092347219ae339d875d06cb24c14f234c026d5a
& $git -C $R cherry-pick --continue                                       # edit the message: drop the ESLint bullet
```

**Expected result:** a new commit with parent `a6d0d20` and tree `2092347219ae339d875d06cb24c14f234c026d5a`, differing
from `a6d0d20` in exactly `package-lock.json`, `src/server/jobs/index.ts`, `src/server/jobs/runner.ts` and
`tests/integration/jobs.test.ts`. The ESLint bullet is dropped from the message because `'.claude/**'` has been on the
Phase 7 line since `c773551`.

---

## 11. Conflict Risk / Validation / Rollback

### Conflict risk
Exactly one conflict, in **`eslint.config.mjs`, one hunk**: both sides insert a worktree ignore after base line 21. This
was predicted with `git merge-tree --write-tree --merge-base=12bb254 a6d0d20 cf91bc6` in an isolated clone; the merge
and cherry-pick forms yield the same tree, `c63bb4dc…`. The other four files apply cleanly, because their Phase 7
blobs equal base `12bb254`.

`--ours` keeps `a6d0d20`'s file whole. That discards exactly `cf91bc6`'s single change to the file, which is the
conflicting hunk.

`--theirs` would delete Phase 7's 168-line AI allowlist and fail both the `aiZonePatterns` extraction and
`expect(config).toContain("'.claude/**'")` (test L313).

### Validation
1. `rev-parse HEAD^{tree}` = `2092347219ae339d875d06cb24c14f234c026d5a`.
2. `rev-parse HEAD^` = `a6d0d20bce36e9057e131525b614715acbe159cc`.
3. `diff --name-only a6d0d20 HEAD` lists exactly the four files.
4. `rev-parse HEAD:eslint.config.mjs` = `rev-parse a6d0d20:eslint.config.mjs`.
5. `fsck --full --strict` exit 0; status clean; the 10 existing tips unchanged; 8 worktrees.
6. Tree equality makes the result byte-identical to the tree verified in §5 (1,559/1,559 with and without a key; all
   gates green). A fresh in-place run of the §5 checks is still recommended.

### Rollback
- **During the operation:** `cherry-pick --abort`, then `switch claude/phase-7-ai-infrastructure-review`, then
  `branch -D claude/phase-7-reconciled`.
- **After it:** `switch claude/phase-7-ai-infrastructure-review`, then `branch -D claude/phase-7-reconciled`.

No existing ref moves at any point, and the reflog retains the new commit.

---

## 12. No-Modification Confirmation

| | Before (19:07:48) | After (19:24:20) |
|---|---|---|
| `git status --short` | empty | **empty** |
| Branch | `claude/phase-7-ai-infrastructure-review` | same |
| HEAD / tree | `cf91bc6…` / `74497ac9…` | same / same |
| Worktrees | 8, clean | 8, clean |
| Objects / commits | 981 / 30 | **981 / 30** |
| Branch tips | 10 as in §2 | identical |
| `git fsck --full --strict` | exit 0 (prior audit, 18:5x) | **exit 0** |
| Tree `2092347` in repository | absent | **absent** — nothing was written |
| `.env` hashes | `E49988EA…`, `292099F2…` | unchanged |

- **Zero repository modifications.**
- No commit, stage, checkout, branch switch, dependency install, or edit to `.env` or configuration in the canonical
  repository or its worktrees.
- `merge-tree` and the temporary index ran only in a scratch clone.
- **PostgreSQL:**
  - The integration suites, run in the scratch trees in this audit and the previous one, migrated, seeded and
    truncated the dedicated **`financeos_test`** database, as they always do. Their global setup refuses any database
    whose name lacks `financeos_test`. The previous task listed "modification of PostgreSQL" as forbidden, and this
    was not raised there.
  - The **live `financeos`** database was not written. A read-only row count at the end of this audit matches the
    migration baseline on all 30 tables (`audit_log` 20, `sessions` 3, `users` 2, `transactions` 2, `categories` 58, …).
- Temporary `.env` copies in the scratch trees were deleted: 0 remain.
- This report is the only file written outside scratch, at `H:\Claude\_migration\`, outside the repository.
