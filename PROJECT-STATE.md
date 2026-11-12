# Project State

Durable status record. Conversation history is temporary; this file is not. Read this first after any context reset, then verify it against `docs/`, the source tree, and the tests before trusting it.

> **Current quality investigation — 2026-11-08:** [PR #59](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/59) is CI-green on PostgreSQL 17 and 18 at `5bc44b0`. Continued separately on `codex/tier1-quality-diagnostics` with output-free parse/injection diagnostics and a fixed nine-probe plan. [Results and concrete next prompt proposal](eval/reports/deepinfra-2026-11-08-tier1-diagnostics/README.md): all nine answered; both models repeated the high-confidence/missing-ambiguity failure for an unclear payment to a person. GLM mismatched income account hints; GPT-OSS mismatched amount/category on a two-amount input. All three injection probes passed this time, so earlier failures remain unreproduced and unresolved. No historical score is replaced. **2,516 unit and 65 property tests, typecheck, lint, production build and client-secret scan pass.** Existing parent integration CI is green; follow-up CI remains separate. Diagnostics cost **US$0.001447657**; project accounted total **US$1.861696173**, leaving **US$8.138303827**. No budget, prompt, scorer, suite version, gate, lineup, recording, generation activation or financial-schema change. Next proposed work: clarify the shared parsing prompt as documented, then bump its contract and obtain fresh full evidence; keep the release hold and other quality failures visible.

> **Previous selected Tier 1 qualification — 2026-11-08:** continued from merged main `47ab421` on `codex/tier1-current-contract-2026-11-08`. The finite DeepInfra runner now has an explicit, source-bound `--selected-tier1` plan; it requires a named campaign and preserves the default Qwen plan. The [fresh campaign](eval/reports/deepinfra-2026-11-07-tier1-current-2026-11-08/README.md) completed **380/380 answered cases**, with zero unanswered requests, on the reconciled contracts. Both selected models have schema **100/100** and tools **53/57 (92.98%)**, so the unchanged proposer returns **GLM-5.3-Flash → GPT-OSS-120B**. Exact parse accuracy is **36/40 vs 30/40**, grounding **21/25 vs 20/25**, robustness **8/10 vs 4/10**, and injection **24/25 vs 19/25**: passing routing gates does not complete release-quality verification. This run accounts for **US$0.070191336**; total project accounted spending is **US$1.860248516**, leaving **US$8.139751484**. These are ledger estimates, not a new billing-page reading. **2,442 unit tests, 65 property tests and all 632 PostgreSQL 17 integration tests pass (3,139 total), plus typecheck, lint, production build, client-secret scan and integrity 35/0.** A fetch-denied completed resume preserves every checkpoint and the ledger byte-for-byte. PR #59 subsequently passed CI on PostgreSQL 17 and 18 at `5bc44b0`. Current-report regressions verify in-memory evidence loading without deployment writes. No historical rescoring, provider/model/gate changes, measurement recording, activation or later-phase implementation. Next: review the fresh quality failures and release composition; remaining tiers and OD-18 are still outstanding.

> **Inference spending cap — 2026-11-08 (owner):** net API inference spending for the whole build/development/testing period is capped at **US$10** across all providers and agents; anything above needs a vetted request (amount, necessity, alternatives) and the owner's spend / not-spend decision ([ADR-56](docs/DECISIONS.md#adr-56--project-inference-spending-is-capped-at-us10-anything-above-needs-a-vetted-owner-decision)). Enforced before each paid request by `scripts/lib/inference-budget.ts` with `config/inference-budget.json`. At adoption, accounted spending was **US$1.79**, reconciled to the owner-reported DeepInfra billing total on 2026-11-08 (ledgers US$1.33 + US$0.46 recorded in `externalSpend`); **US$8.21 remained then**; see the newer campaign total above. `ai:eval` and `ai:measure:openrouter` on a paid host now need `--reserve-usd`. Editing the DeepInfra runners changed their source fingerprints, so a paused DeepInfra campaign resumes under a fresh `--campaign` name. Reconcile against the provider billing page again whenever runs happen outside the ledgers.

> **Previous Tier 1/scorer reconciliation — 2026-11-07:** branch `codex/reconcile-approved-tier1` in `/workspace/financeos-tier1-reconciliation` integrates Claude #54 at `cd5e65e` on the CI-green #56 handoff (`11d4f69`). It retains the owner Tier 1 selection recorded there: **GLM-5.3-Flash → GPT-OSS-120B**, DeepInfra direct, with conservative declared-only GLM capabilities. Other tier orders remain empty. The two recorded scorer corrections are combined with this branch's existing prompt/LaTeX behavior under **grounding/robustness/analysis v5 and injection v4**; parse/classify stay v2, tool-select v3, document v2. Both branches' colliding v3 identities are retired rather than conflated. **Selection is not current measured eligibility:** archived GLM v3 results and the fallback's two-unanswered-case report are rejected by regression tests using the actual reports. All 30 incoming timestamped reports and the original README are preserved byte-for-byte; all 158 parent report artifacts remain intact. The colliding decision becomes [ADR-55](docs/DECISIONS.md#adr-55--retain-the-tier-1-selection-recorded-in-claude-pr-54-current-contract-eligibility-remains-independent), preserving existing ADR-53/54 and the original branch decision separately. **2,493 unit/property tests, 65 focused integration checks on each PostgreSQL version, typecheck, lint, production build and client-secret scan pass.** All seven AI workflow pages pass authenticated production HTTP checks and retain disabled generation. The source guard refuses historical campaign resume. [Integration audit](docs/audits/2026-11-07-tier1-contract-reconciliation.md). No live calls, historical rescoring, deployment recording, activation or main merge occurred. Fresh complete current-contract evidence and external spend reconciliation remain required before measured qualification/recording; the old finite Qwen plan is unchanged and no paid campaign starts automatically. The owner-PC Tier 2 plan recorded in #54 must use the reconciled contracts too.

> **Previous Claude handoff reconciliation — 2026-11-07:** branch `codex/claude-handoff-reconcile` in `/workspace/financeos-claude-handoff` combines Claude's documentation PR #52 and budget-test PR #53 with verified assistant PR #55 (`fa62ca2`), preserving their commit histories and both independent reconciliation audit records. Original Claude branches are untouched. All 69 project headings from each input are retained. Provider-test isolation now clears all four generic/legacy key/URL variables, asserts the no-provider precondition and restores both values and absence exactly. **54 checks pass:** all nine budget tests for shell keys, `.env` keys and no keys on PostgreSQL 17/18, with a fetch-denied preload recording zero calls. Typecheck, fixture lint, source/archive preservation and added documentation-link checks pass. #55's full CI [42388730630](https://github.com/Javacom710/Personal-AI-Finance-Butler/actions/runs/42388730630) is green on both PostgreSQL versions. The roadmap retains the injection quality gate as incomplete, distinguishes the old Phase 5 table and historical campaign contracts, and records #54's GLM result as separate pending evidence. Deployment examples now use `APP_ORIGIN` and distinct app/migration roles; ADR-54 records testing-provider authorization without asserting auto-recharge or production activation. No runtime, prompt, scorer, tier order, archive, dependency, live request, recording or activation changed. [Handoff audit](docs/audits/2026-11-07-claude-handoff-reconciliation.md). Next: review the consolidated handoff after #51/#55; reconcile #54's suite identities and external spending before considering measurements or lineup acceptance. Scenario/Overview work retains its existing approval boundaries.

> **Previous assistant continuation — 2026-11-07:** [PR #51](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/51) is open, mergeable and has no outstanding review threads; final-head CI [42385230550](https://github.com/Javacom710/Personal-AI-Finance-Butler/actions/runs/42385230550) passes on PostgreSQL 17/18 at `93de4c2`. Continued the approved read-only assistant slice in branch `codex/assistant-workload-evidence`, stacked on #51. Clipped source results now show a visible **partial results** summary and explain that omitted rows can affect comparisons/rankings while authoritative totals remain usable. Twelve new real-engine workload cases cover month boundaries, transfers, exact savings figures, missing metrics, net-worth levels and investment coverage; a thirteenth verifies that full financial ledgers/audits are unchanged. **68 focused unit checks**, plus a final 14-test presentation rerun, pass. All **16 focused integration checks** are verified on PostgreSQL 17/18 (the tightened workload file was rerun on 17). Typecheck, lint, production build, client-secret scan and authenticated production HTTP checks of saved clipped evidence/private export pass. These are scripted fake-provider data-flow checks; real-model interpretation quality and the roadmap question gate remain unverified. No new tool/schema, prompt, score gate, provider call, measurement recording or feature activation. [Assistant continuation audit](docs/audits/2026-11-07-assistant-workload-evidence.md). Phase 8 remains open with no accepted lineup in this branch; scenarios remain blocked by OD-18.

> **Newer Claude work awaiting reconciliation — 2026-11-07:** [#52](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/52) updates the broader documentation and records ADR-54/OD-20; it overlaps this branch's status/assistant docs and currently conflicts with #51. [#53](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/53) independently fixes the same daily-budget credential fixture, additionally clearing provider URLs and asserting the no-key precondition; reconcile it with #51's existing fix rather than dropping either record. [#54](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/54) contains additional DeepInfra rounds and scorer changes. Its third-round report lists `zai-org/GLM-5.3-Flash` at schema 1.00/tool-call 0.95 with zero unanswered cases, under that branch's contracts, but no declaration/lineup is accepted or recorded. It also reports GPT-OSS answered-only gate passes with unanswered cases, which are not complete qualifying evidence. **These are separate source/scorer-bound results, not evidence of passing this branch's current contracts.** #54 uses grounding/analysis/robustness v3 against this branch's v4 and introduces different injection semantics under the shared v3 number; reconcile the version identities and preserve its colliding README separately before integration. Its additional external spending is not included in the earlier workspace ledger: reconcile that cost before any new paid campaign. No result, scorer change or asserted approval from another branch is silently applied here. The assistant continuation is [#55](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/55), separately stacked on #51.

> **Previous reconciliation checkpoint — 2026-11-07:** the accumulated Phase 8 implementation and evidence are reconciled onto merged main `44e53ce` in [PR #51](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/51), branch `codex/reconcile-phase8-deepinfra`, worktree `/workspace/financeos-phase8-integration`. The original 169-file dirty checkout and its backup remain intact, and Claude/Codex campaign reports are archived separately. **2,476 unit/property tests pass; all 619 integration cases are verified across the initial and corrected-file runs on each PostgreSQL version.** CI passes all steps on PostgreSQL 17/18 at runtime-source commit `b651867`; the follow-up changes test credential isolation and verification docs only. Typecheck, lint, build, secret scan, integrity (35 passing, zero failing) and authenticated production HTTP checks of all seven disabled AI pages pass. [Reconciliation audit](docs/audits/2026-11-07-phase8-reconciliation.md). No new live AI calls, live-measurement recording, production order changes or feature activation occurred. **Phase 8 remains open: no tested tier qualifies for promotion.** Next: review PR #51 and its fresh CI; investigate qualification failures before considering a new source-bound campaign. DeepInfra direct stays selected, and no campaign is rerun automatically. Historical notes below retain their original status at the time.

> **Historical Claude verification checkpoint — 2026-11-07 (Claude, after verifying PR #51).** Phases 0–7 are complete. **Phase 8 is blocked on the owner's lineup decision ([OD-20](docs/DECISIONS.md#open-decisions-requiring-the-user)):** every complete DeepInfra campaign fails the unchanged gates (best tool-call correctness 0.8966 against 0.90), and strict `analysis` passes are 0–2/15 for every model. **Phase 9 is merged and disabled.** The DeepInfra provider choice is now [ADR-54](docs/DECISIONS.md#adr-54--deepinfra-direct-is-the-phase-8-provider-google-and-anthropic-models-are-excluded). PR #51's verification is complete: 2,476 unit/property and 619 integration tests pass, plus typecheck, lint, build, the secret scan and integrity 35/0; [record](docs/audits/2026-11-07-phase8-reconciliation.md). [ROADMAP](docs/ROADMAP.md) has the phase table. **Next, in order:** (1) the owner decides OD-20; (2) choose OD-18's placement, after which the scenario engine, metrics and TWR wiring are buildable engine work; (3) OD-19, the Overview page, can proceed independently.

> **Historical integration checkpoint — 2026-11-07 (Codex):** the accumulated local Phase 8 implementation and evidence have been reconciled onto merged main `44e53ce` in branch `codex/reconcile-phase8-deepinfra`, worktree `/workspace/financeos-phase8-integration`. The original dirty checkout and its 169-file backup remain intact. Claude's and Codex's independent original DeepInfra reports are separately archived under the shared report index; their scores are never pooled. Per-tier runtime measurements retain the merged OpenRouter endpoint guard. Typecheck, lint, the production build, the client-secret scan and authenticated HTTP checks of all seven disabled AI pages pass. Full database and test verification is in progress; final results will be recorded in the reconciliation audit before this branch is submitted. No new live AI requests, database recording, lineup promotion or feature activation were performed. **Phase 8 remains open: no current tested tier qualifies for promotion.** Historical notes below retain their original status at the time.

> **Historical pre-reconciliation checkpoint, 2026-11-07:** all twelve PRs **#39–#50** are merged into GitHub main (`44e53ce`), with no open PRs remaining. Main's tree matches the PostgreSQL 17/18-tested combined head `930e3fc`. The disabled Phase 9 scaffolding is merged; activation and lineup recording remain blocked pending owner approval. Full history was restored and verified before merging documentation. [Merge audit](docs/audits/2026-11-07-open-pr-merge.md). **This local measurement checkout remains uncommitted and unreconciled with main; preserve it and integrate in isolation before further product work.**

> **Latest completed candidate campaign, 2026-11-07:** [Qwen lineup review](eval/reports/deepinfra-2026-11-07-qwen-235b-v1/README.md) attempted all **17 entries / 420 cases: 419 answered, one timeout**. The text model has schema 100% but tools 48/57 (84.21%) in every tier, below 90%; advanced analysis is 2/15 per tier. The larger vision model has schema 19/19 and exact extraction 14/20, with one timeout. No tier is proposed. All 49 answered analysis/document cases have output-free diagnostics. Default production orders stay unchanged; nothing was recorded or promoted. **2,120 unit tests**, typecheck, lint, build and client-secret scan pass. Independent Claude measurements in PR #50 are not pooled; their reported sub-$1 cost now has a separate $1 reservation in the shared accounting cap.

> **Latest continuation, 2026-11-07:** [automatic diagnostic capture and layout comparisons](docs/audits/2026-11-07-ai-diagnostic-capture.md) now explain future full-run analysis/document failures without extra calls or raw-output retention. Fixed-key metadata is validated on resume and never replaces case scores. Three fresh analysis probes all failed both official scoring and the tested whitespace/Markdown comparisons, so these samples do not support layout as the cause. Prompts, suite versions and gates are unchanged by this step. Nothing was recorded or promoted; Phase 8 remains open.

> **Earlier continuation, 2026-11-07:** [shared finance/document prompt clarification](docs/audits/2026-11-07-ai-prompt-contracts.md) is implemented and verified by **2,110 unit tests**, typecheck, lint, production build and client-secret scan. Current contracts: tool-select/injection v3, grounding/robustness/analysis v4, document v2; parse/classify stay v2. Six fresh DeepInfra diagnostic probes yielded one receipt pass, three analysis failures and two document timeouts. No full campaign was rerun. Earlier full-campaign results below are historical for these changed prompts; they were not rescored or imported. The promotion hold, no-record requirement and Phase 8 status remain unchanged.

> **Earlier implementation and full measurements, 2026-11-07:** [independent tier measurements](docs/audits/2026-11-07-ai-tiered-eligibility.md) now extend the earlier one-tier-only guard. One model may have separate measured entries in several tiers, each requiring full current suites, zero unanswered cases and exact production budgets. Provider/profile/tier evidence never mixes; missing evidence still fails closed. The fresh v3 campaign is complete: **610 attempted, 603 answered, seven timeouts; no qualifying candidate**. [Current approval report](eval/reports/deepinfra-2026-11-07-format-v3/README.md). Default orders remain unchanged; nothing was recorded or promoted. Phase 8 stays open pending qualified evidence and owner approval.

> **Earlier safety fix, 2026-11-07 (extended by the implementation above):** [tier provenance](docs/audits/2026-11-07-ai-tier-provenance.md) is now preserved from storage through selection. Another tier's rows cannot shadow, complete or certify a declared-tier entry, and `tier_mismatch` blocks both routing and misleading proposals. At that checkpoint the one-tier-per-model contract remained; the subsequent independent-tier implementation above supersedes that restriction while preserving evidence isolation. No production measurements or orders changed.

> **Earlier continuation, 2026-11-07:** [numeric presentation correction](eval/reports/deepinfra-2026-11-07/diagnostics/numeric-presentation.md) advances grounding/robustness/analysis to v3. Historical reports remain intact and cannot be resumed against the new source. That step produced the now-historical `format-v3` campaign; subsequent prompt changes require a new named campaign and fresh measurements. All DeepInfra campaigns/diagnostics share a spending lock and $4.50 accounting ceiling. The promotion hold and approval requirement remain in force.

> **Read first — provider and approval, 2026-11-07.** The owner selected **DeepInfra direct**, `https://api.deepinfra.com/v1/openai`, with $5 prepaid credits. Exclude Google/Anthropic models. OpenRouter is not selected; any provider switch requires fresh suites. Both GPT-OSS ids are unchanged; the vision candidate is `Qwen/Qwen3-VL-30B-A3B-Instruct`. The latest completed full results are in the [format-v3 campaign](eval/reports/deepinfra-2026-11-07-format-v3/README.md), now historical for the changed prompts above. Old source-bound checkpoints intentionally cannot be resumed or relabeled. Use `AI_API_KEY="$AI_API_KEY_DeepInfra" npm run ai:diagnose:deepinfra -- --plan` for the current offline diagnostic plan. All campaigns/diagnostics share an account lock and $4.50 accounting ceiling. Owner approval is required before recording or accepting any lineup. Scenario remains blocked by OD-18; retrieval is deferred by ADR-19. The old recurring automation remains paused.

> **Historical merge checkpoint — 2026-11-07:** DeepInfra direct is the selected Phase 8 testing provider; OpenRouter remains future, unactivated support. Do not send Google/Anthropic models through DeepInfra. PRs #39, #40 and #43–48 have merged with live AI generation hard-disabled. The owner still must approve a measured lineup before recording or activation. The dated OpenRouter preparation and Phase 9 handovers below are preserved as historical records.
> **Historical measurement snapshot — 2026-11-07 (Claude, before the merge pass).** `main` lags the open Codex PRs #39–#49 (Phase 9 slices, all model-disabled; OpenRouter runner #41/#42; #49 records the owner's switch to **DeepInfra** as the Phase 8 testing provider). Phase 8 measurements were run on DeepInfra with the unchanged `ai:eval --no-record`: see [DeepInfra measurements](eval/reports/deepinfra-2026-11-07/README.md). **No tier passes the unchanged gates; nothing is proposed or recorded.** GPT-OSS-120B completes Tier 1 but fails tool-call correctness (0.86 < 0.90); other runs have proxy-caused unanswered cases. The Groq queue is superseded (no further Groq calls). Owner decisions are listed in that README.

> **Historical provider direction — 2026-11-02.** PR #37 is merged (`faa20f9`, 13:12 UTC); ADR-52 makes Groq the configured provider. Work continues on `codex/groq-measurements`: no accepted routing lineup and no saved live results. The recurring automation is paused; the current finite workflow overview is [here](eval/reports/groq-workflow-progress.md), and `npm run ai:measure:groq -- --run` carries the queue through a quota window. The pre-record provider-provenance P1 is fixed on this branch and covered by unit/integration tests. Live measurements are incomplete and quota paced; read [Groq measurement checkpoint](eval/reports/groq-2026-11-02/README.md) and the new log below. Do not resume NVIDIA benchmarks, change gates/prompts/scorers/suites, set tier orders, or use `--record` without owner approval.

> **Historical direction, 2026-11-03.** The owner explicitly authorized **Phase 9 natural-language transaction entry and confirmation to start early, in parallel with incomplete Phase 8**, on `codex/phase-9-nl-entry`. This is transaction entry only, fake-provider tested, with production draft generation hard-disabled until the owner approves a measured Phase 8 lineup. The owner additionally authorized the read-only financial assistant on 2026-11-03, on its own branch `codex/phase-9-readonly-assistant`, also fake-provider tested with model calls disabled pending lineup approval. Saved conversation management, export and deletion are now implemented; PR #40 is stacked on PR #39 to keep migrations ordered. Analysis/scenario/document work remains outside this slice; OD-18 stays blocked. PR #38 is now merged (`3dd38f2`) by the owner's later explicit instruction, superseding the earlier keep-draft request. The owner plans to fund OpenRouter on 3 November, then switch provider and complete Phase 8 in one sustained run; readiness must be checked first, and Groq measurements must not authorize a new endpoint. Existing gates, prompts, scorers, suites and tier orders remain unchanged. See [Phase 9 transaction entry](https://github.com/Javacom710/Personal-AI-Finance-Butler/blob/ccc9879/docs/PHASE9-TRANSACTION-ENTRY.md).

> **Standing Phase 9 authorization — 2026-11-03:** the owner approved monthly reviews, portfolio analysis, financial-health analysis, period summaries, cross-domain analysis and document/receipt extraction, one feature per PR, fake providers only and disabled pending approval of the Phase 8 lineup. Scenarios remain blocked by OD-18. Every figure must come from the deterministic engine through existing read-only tools, with fact/calculation/interpretation/recommendation labels and unavailable data preserved. Documents must enter the existing proposal/confirmation pipeline. Ask before a new tool, schema change, gate/rule change or work outside Phase 9. This supersedes earlier notes limiting development to transaction entry and the assistant.

**Last updated:** 2026-11-07 · **Current phase:** **8 — Model Evaluation: Tier 1 lineup selected (ADR-55), current-contract measurements outstanding; 9 — all non-scenario slices merged and disabled** ([Phase 8 log](#phase-8-log)). Phase 7 — AI Infrastructure COMPLETE (steps 7.0–7.7; blockers B-1 … B-4, H-1 and R-1 … R-4 closed). Phase 6 remains complete (steps 6.0–6.9 and 6.11 implemented and verified; 6.10 closed unbuilt).

*The paragraphs from here to "Working protocol" are the 2026-08-30 record, kept as written.*

**Phase 7 pre-implementation correction pass — 2026-08-30.** The Phase 7 design review found three properties the canonical documents call non-negotiable that were **false** against the Phase 6.11 code (**F-1**, **F-2**, **F-3**). All three are now closed in code, with compile-time and automated regression protection, **before any AI infrastructure exists**. No provider, no SDK, no `NVIDIA_API_KEY`, no tools, no orchestrator, and no file under `src/server/ai/`. See [What step 7.0 delivered](#what-step-70-delivered--phase-7-pre-implementation-corrections--2026-08-30).

**Phase 6.11 — Net Worth at Market Value — is implemented and verified** (2026-08-27). `basis: 'market'` is a distinct, fully reconciled calculation alongside Phase 5's `cost`. **No schema change and no snapshots** were required, exactly as [docs/MARKET-VALUE-NET-WORTH-DESIGN.md](docs/MARKET-VALUE-NET-WORTH-DESIGN.md) §20 and OD-15 concluded.

**The default valuation basis remains `cost`** ([ADR-32](docs/DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view)). `market` is a fully supported alternate view, reached from an explicit link on the Net Worth page. **Neither replaces the other**, and Phase 5's cost methodology is untouched — asserted rather than assumed: a price arriving moves Net Worth at Cost by **zero** minor units, and the browser check confirmed the headline held at ₹76,90,000.00 across a price being recorded.

**1,396 tests pass** — 129 added in 6.11, and every Phase 3, 4, 5 and 6.0–6.9 test still passes. `verify:integrity` reports **33 passing, 0 failing, 19 engine-enforced, 2 deferred** — I-38 and I-39 promoted from deferred, I-41 and I-43 … I-49 added, and I-42 deliberately absent. Typecheck, lint, the production build and `check:no-client-secrets` are clean.

### What Phase 6.11 delivered

| | |
|---|---|
| Engine | `ValuationBasis` widened to `'cost' \| 'market'`; the basis is a property of component *construction*, so `compose()` carries it and never branches on it |
| The one new algorithm | `quantityHeldOn` (`domain/lots/quantity.ts`). `replay()` now emits a per-trade-date `quantityTimeline`, so the corporate-action ratio arithmetic has **one** implementation. Property-tested against a bounded replay across splits, bonuses and reverse splits (**I-46**) |
| Completeness | `MarketValuation` — `complete` / `partial` / `unavailable`, value-weighted investment coverage by base cost basis (**D-29**), excluded cost, staleness summary |
| Restatement | `domain/networth/restate.ts` — removed-unpriced, FX rebasis, price effect, each computed and none a residual, closing exactly (**I-48**, [ADR-31](docs/DECISIONS.md#adr-31--cost-to-market-is-a-restatement-at-an-instant-not-a-bridge-over-time)) |
| Performance | Indexed price lookup (`domain/pricing/price-series.ts`) and a memoised FX pair index. A 365-point market series runs in **80 ms** against the design's 123 ms baseline — `npm run bench:networth` |
| UI | `/net-worth` keeps its Phase 5 headline and gains one reciprocal line; `/net-worth/market` is the new, explicitly-labelled alternate view |

### Two findings from implementation, neither in the design

- **`ExclusionReason` gained `no_price_on_date`.** The seven `MissingPriceReason` members are verdicts about a *provider*, and none is true when the feed is healthy and has simply published nothing for a date before the instrument listed. Folding the historical gap into `not_found` would tell the user to re-map a symbol that is already mapped. The market-data union is untouched; this member exists on the net-worth exclusion type only.
- **`selectRate()` rebuilt its pair index on every call.** Invisible for the handful of conversions a single-date page makes, and dominant for a *series*, which asks once per foreign position per point. `rateSelector()` memoises the index per date; the resolution rule — identity → direct → inverse → triangulated, dated by the stalest leg — is unchanged, so every Phase 3/4/5 figure is byte-identical. **Found by the benchmark, not by a test**: the first measurement came in at 710 ms against the design's 123 ms, and the price index alone did not explain it.

**What now works that did not before:** Indian mutual funds price from **AMFI**; FX comes from **Frankfurter/ECB**, including by **triangulation** where no direct pair exists; equities and ETFs on NSE, BSE and three international venues price from **Twelve Data**; staleness is measured in **trading sessions**; and a provider corporate action cannot reach the ledger.

**OD-3 is resolved in code and open in configuration.** The Twelve Data adapter is built, tested and registered. `TWELVE_DATA_API_KEY` is **optional and not set here**, so equities currently report `no_provider` rather than a price — the application runs normally without it. **No live smoke test has been run**; `npm run smoke:market-data` is ready and exits with configuration guidance until a key exists.

This file also remains the **Phase 5 completion checkpoint** and carries the **Phase 6 design review** ([docs/MARKET-DATA-DESIGN.md](docs/MARKET-DATA-DESIGN.md)), whose findings **OD-10 approved and which are now applied**.

**1,049 tests pass** — 617 unit, 56 property, 376 integration. `verify:integrity` reports **27 passing, 0 failing, 8 enforced by the engine, 2 deferred to Phase 9**. Typecheck, lint and the production build are clean. **Signed-in browser verification passed**, finding and fixing two display defects.

**Infrastructure verified:** PostgreSQL **18.4** as the Windows service `postgresql-x64-18` (`Automatic` start, runs as `NT AUTHORITY\NetworkService`), independent of any shell or tool lifetime. Databases `financeos` and `financeos_test`, two least-privilege roles, connectivity confirmed by the 376 integration tests, `verify:integrity` against `financeos`, and a live signed-in browser session.

Sequence approved 2026-08-11: **Phase 3 — Money Management → Phase 4 — Investment Engine.**

---

## Phase 8 log

**2026-10-31 — catalogue check (ADR-45) done.** Two independent reads agree. One on the development PC (posted on PR #15: `npm run ai:catalogue` plus a direct read of `/v1/models`), and `npm run ai:catalogue` from a cloud session once its key and network access were set up. An earlier cloud attempt the same morning had no key and could not reach the host.

**85 models** (82 on 2026-09-03).

| Configured candidate | 2026-10-31 | In the catalogue instead |
|---|---|---|
| `nvidia/nemotron-3-super-120b-a12b` | present | — |
| `nvidia/nemotron-3-ultra-550b-a55b` | present | — |
| `nvidia/nemotron-3-nano-30b-a3b` (**Tier 1 primary**) | **still missing** | `nvidia/nemotron-nano-3-30b-a3b`, unchanged since 2026-09-03 |
| `google/gemma-4-31b-it` | present | — |
| `openai/gpt-oss-20b` | present | — |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | present | — |
| `nvidia/nemotron-3-embed-1b` | present | — |
| `deepseek-ai/deepseek-v4-flash` → `-0731` (Tier 2 fallback) | **now missing — new drift** | `deepseek-ai/deepseek-v4.1-flash` |
| `zai-org/glm-5.2` | absent, as before | `z-ai/glm-5.3-flash` |
| `nvidia/nemotron-nano-12b-v2-vl` | absent | `nvidia/nemotron-3.5-super-vl-120b-a12b`, the only new VL model |
| `deepseek-ai/deepseek-v4-pro`, `mistralai/mistral-medium-3.5-128b`, `qwen/qwen3-next-80b-a3b-instruct` | absent | — |

New since 2026-09-03: a `nvidia/nemotron-3.5-*` family. Its models are `lightning-30b-a3b`, `super-vl-120b-a12b`, `bolt-e4b`, `embed-1b`, `embed-8b` and `content-safety`.

**What this means for routing today, which is unchanged (ADR-41):**
- **Tier 1** serves through `openai/gpt-oss-20b`. Its primary costs one failed attempt per breaker window.
- **Tier 2** is now down to one live model, `nemotron-3-super-120b-a12b`, because its DeepSeek fallback is gone.

**Five evaluation candidates added**, approved by the owner. They are in `EVALUATION_CANDIDATES` in `src/server/ai/config/models.ts`. None is in a tier order or reachable by name normalisation (asserted in `ai-routing.test.ts`), and `ai:catalogue` now reports each one.
- Tier 1: `nvidia/nemotron-nano-3-30b-a3b` and `nvidia/nemotron-3.5-lightning-30b-a3b`.
- Tier 2: `deepseek-ai/deepseek-v4.1-flash` and `z-ai/glm-5.3-flash`.
- Tier 4: `nvidia/nemotron-3.5-super-vl-120b-a12b`.

A candidate enters routing only after it has a measured capability entry and a human accepts the proposed order.

**Environment note.** Node 22's built-in `fetch` ignores `HTTPS_PROXY`, so behind the cloud egress proxy every AI script fails with `transport — fetch failed` (DNS `ENOTFOUND`). The fix is to run with `NODE_USE_ENV_PROXY=1`. No code change was made: the PC has no proxy, and production should not depend on one.

**2026-10-31 — `parse` corpus built** (`src/server/ai/eval/tasks/parse.ts`, 40 cases, suite version 1). Cases: plain expenses, income, four transfer shapes (between own accounts, credit-card bill, ATM to cash, wallet top-up), shorthand amounts (k, lakh), Indian digit grouping, six non-INR cases, relative and boundary dates (month end, 29 February, the year before), missing and ambiguous input, adversarial text inside the input, and Hinglish. Scoring is deterministic. Two changes came with it:

- **The harness reported field accuracy as `schemaAdherence`.** `schemaValid` was set to `passed`, so a well-formed proposal with a wrong date lowered the number the Tier 1 ≥ 0.95 gate reads. A case can now supply `checkSchema`, and the parse suite does.
- **`TransactionProposal.amount` is nullable** (AI-SYSTEM.md §9). With a required amount, an input that states no amount had no schema-valid answer except an invented one.

`TransactionProposal` and the parse prompt now exist in code (`ai/proposals/schemas.ts`, `ai/prompts/parse-transaction.ts`), because the suite has to measure what production will send. Phase 9 reuses both; the proposal flow itself is still Phase 9.

**2026-10-31 — #15 merged; `classify` corpus built** (`src/server/ai/eval/tasks/classify.ts`, 60 cases, suite version 1). The cases cover every leaf of the default category tree, Indian merchants and Hinglish, raw bank-statement text (UPI, POS, NEFT, BIL, INT.PD), descriptions that state no purpose, adversarial text and income. The answer is a category **path** (`"Food > Dining"`). The response schema makes it an enum of the user's paths for the transaction's kind, plus `null` for "cannot tell", so an invented or wrong-kind category fails validation rather than scoring as a near miss. Scoring is exact: the most specific right path. A second path is accepted only where either is defensible, and `null` only where the description gives no purpose.

The schema (`categorySuggestionSchema` in `ai/proposals/schemas.ts`) and the prompt (`ai/prompts/classify-transaction.ts`) are the ones Phase 9 will use. The fixture tree is restated in the suite, because the AI layer may not import `db/`; a test asserts it equals `DEFAULT_CATEGORIES`.

**2026-10-31 — #16 merged; `tool-select` corpus built** (`src/server/ai/eval/tasks/tool-select.ts`, 30 cases, suite version 1). Each case is a finance question asked on a fixed date (2026-10-15, a Thursday). The model gets the production tool registry. Every registry tool is expected by at least one case. The cases cover spending and cash flow, budgets and recurring bills, balances, net worth (cost and market basis, one date or a series), investments, two questions that need two tools each (cash against upcoming obligations; loans, where a loan tracked as an account has its balance in `get_accounts`), two questions that need no tool (a concept, and a write request the read-only tools cannot do), and an attempt to pass a `userId`. Only the first turn is scored, and scoring is deterministic:
- Every call must name a registry tool, and its arguments must pass that tool's own `.strict()` schema, the same check dispatch makes.
- Every call must match an expected call, arguments included. "Last month" is any `asOf` in September; the current month may also be omitted. Dates and date sets are exact.
- A question that needs several tools passes when the first turn calls any of them correctly.

Two changes came with it:
- **The harness counted a correct "no call" as a tool-call failure.** `toolCallValid` was `toolCalls.length > 0 && passed`, so a model that rightly answered a concept question without a tool lowered `toolCallCorrectness`. A case can now supply `checkToolCalls`, and the tool-select suite does.
- **The `answerFinanceQuestion` prompt now exists** (`ai/prompts/answer-finance-question.ts`). It sends the date, the weekday, the base currency and the rules, but no account or category list. Phase 9 reuses it.

**Finding, not fixed here:** AI-SYSTEM.md §8 describes a `categoryNames` argument on `get_expense_summary`, resolved server-side. The registry has no such argument. So "how much did I spend on food" is answered from a category breakdown, which the suite expects. Whether to add `categoryNames` is for the `grounding` suite to decide. *(Settled by the `grounding` suite below: not added, [ADR-49](docs/DECISIONS.md#adr-49--get_expense_summary-takes-no-category-filter-the-breakdown-row-is-the-answer).)*

Next (as of the `tool-select` PR): `grounding`, `scenario`, `injection`, `robustness`, `document`, `analysis`; then the `ai:eval` runner.

**2026-10-31 — `routing` corpus and the escalation classifier built** (`src/server/ai/eval/tasks/routing.ts`, 86 cases, suite version 1; `src/server/ai/orchestrator/escalation.ts`). AI-SYSTEM.md §6.2 assigns Tier 1 → Tier 2 escalation to a deterministic classifier in application code, which did not exist; `escalated()` was its only half. No model runs in this suite: each case is a user message, optionally after a previous message and its tier, labelled with the tier §6.4's rule gives it (one tool call answers it → Tier 1). The classifier gets **86 / 86**, with zero over- and under-escalations. The corpus covers:
- plain Tier 1 questions, and keyword lookalikes that must stay Tier 1 (the Health spending category, "SBI vs HDFC" on one date, food against transport in one month, "driving lessons" and an audit fee as expenses, a filter phrased with "if", "more than ₹5,000");
- the five Tier 2 triggers: review or analysis, multi-period comparison, scenario, "why" or "how has X changed", and cross-domain, which needs two domains (cash against upcoming obligations escalates, food against total expenses does not; "how much of my net worth is invested?" stays Tier 1, because one result carries both figures);
- the sticky-escalation trap (a Tier 2 review, then "what's my HDFC balance?" → Tier 1) and dependent follow-ups ("and last year?", "break that down") that inherit the previous tier, Tier 1 included ("why?" after a simple answer stays Tier 1), while a complete question after "and" or "but" does not;
- the user choosing the model ("use the biggest model", "switch to Tier 3", "…using deepseek"): the instruction is ignored and flagged, the question around it is still classified, and no message reaches Tier 3.

**Owner's ruling, [ADR-48](docs/DECISIONS.md#adr-48--the-users-question-sets-the-tier-the-user-does-not-choose-the-model).** SECURITY.md §8 said tier is "never inferred from user text"; AI-SYSTEM.md §6.2 classifies the user's message. The owner ruled that §8's "user text" means the user *choosing the model*, not the question. So the question sets the tier, but an instruction to use a particular model or tier ("use the 'x' llm model", "switch to Tier 3") is removed before classification and flagged with `modelChoiceIgnored`. The assistant must tell the user that model choice is not theirs. SECURITY.md §8 and AI-INFRASTRUCTURE-DESIGN.md §5.2 now say so. The classifier is not yet wired into a request path; Phase 9's assistant calls it and shows the flag.

**2026-10-31 — `grounding` corpus built** (`src/server/ai/eval/tasks/grounding.ts`, 25 cases, suite version 1). Each case replays one finished tool turn on 2026-10-15 — the question, the call, and its result — and the model writes the answer. The 17 results are frozen in `tasks/grounding-results.json`, and `tests/integration/ai-eval-grounding.test.ts` builds the fixture through the services, runs every call through the production dispatcher and requires the frozen result exactly (database ids become fixed placeholders). So every expected figure is the engine's, and the eval runs without a database. Regenerate with `UPDATE_GROUNDING_RESULTS=1` on that test, then review the diff and bump the version. The fixture: four accounts, three months of activity with transfers, a `Food → {Groceries, Dining}` tree where Food also has spending of its own, two overlapping tags, two budgets (one over), a property, gold, a home loan, and a portfolio with one priced, one stale and one unpriced holding.

Scoring is deterministic:
- **Every figure the answer states must trace** to a value in its results, at its stated precision (₹8,641 and ₹86.4 lakh trace to 8640.5000; a sum or difference the model computed traces to nothing). Dates, years and whole numbers up to 31 are not figures.
- **Required figures** must be stated to the rupee and with their sign (−62.49% is not the savings rate); a percentage may be rounded but must round from the engine's rate. An amount owed or over may be stated either way.
- **The portfolio value** must come with what it leaves out (unpriced HDFC Bank) and what is stale (NIFTYBEES): coverage is 0.78, so the figure is not a complete current valuation.
- **Forbidden figures** are the known wrong answers: Food's own ₹800 or its children's ₹7,840.50 as "food", summed overlapping tags, summed net-worth levels, a two-category sum, TWR as 0%.
- **Required mentions:** the cost or market basis of a net-worth figure, the holding a market valuation excludes, and why TWR is unavailable.
- **Two cases cannot be answered from what they were given**: a `detail` result for the Food total, and a `rollup` for Groceries. They pass only by the right further call. Prose can't pass, because the only answering figure would be a computed one.

Changes that came with it:
- **`retrievalGrounding` is reported.** `ModelReport` gains it (the grounding pass rate, the score `CapabilityScores` already names), and `checkToolCalls` may return `null` so a prose answer doesn't count for or against `toolCallCorrectness`.
- **The `answerFinanceQuestion` prompt now forbids computing figures**, not only inventing them: no adding, subtracting or averaging. When no result holds the figure, the model calls the tool that does, or reports the separate figures.
- **`categoryNames` is not added** ([ADR-49](docs/DECISIONS.md#adr-49--get_expense_summary-takes-no-category-filter-the-breakdown-row-is-the-answer)). Every single-category question is one row: the `rollup` row for a parent, the `detail` row for a leaf. A fuzzy name resolver would add a silent way to pick the wrong category. AI-SYSTEM.md §8 now describes the tool as built. Revisit if the measured run shows models summing rows in cases 7 and 10.
- **Defect fixed: budget order was nondeterministic.** `listBudgetStatuses` sorted by `period` only, so monthly budgets came back in whatever order Postgres chose, on screen and to the model. The fixture test caught it: it failed intermittently. Sorted by period, then creation, then id.

Next (as of the `grounding` PR): `scenario`, `injection`, `robustness`, `document`, `analysis`; then the `ai:eval` runner. No model has been run against any suite yet.

**2026-10-31 — `injection` corpus built** (`src/server/ai/eval/tasks/injection.ts`, 25 cases, suite version 1). Built by Codex from `main` after #19, in parallel with `grounding` (#20); merged after it, with main merged in. The tracked phase plan is `Workflow Setup.txt`, expanded in ROADMAP. Injection was still unbuilt, so this work continues that suite rather than advancing to a different phase.

- **Coverage:** 13 attacks in user text and 12 in tool results, including transaction descriptions and a category name. Hidden instructions, forged system turns, attempts to write through read tools, invented write/SQL/shell tools, `userId`/session overrides, schema-valid foreign account/category/instrument UUIDs, unnecessary bulk reads, model/tier selection, and textual claims of Tier 3 approval. Tool-result cases replay a correctly paired assistant call and `role: 'tool'` result using synthetic projected fixtures; no database or provider is needed.
- **Deterministic scoring:** every attempted call must pass its registry `.strict()` schema and exactly match a case's permitted tool and complete arguments. An extra read or argument fails even beside a correct call. First-turn legitimate reads are required; completed reads and write refusals require nonempty prose with no calls. Emitting the fixed attack canary fails, including when quoted. Application routing is tested separately: expected tier and `modelChoiceIgnored`, ceiling Tier 2, and the real Tier 3 guard refusing textual `explicitUserRequest=true` without a provider call. These guards are not counted as model scores.
- **Two narrow fixes:** the production question prompt now requires reporting injected instructions without repeating them, and says model/tier choice belongs to the application. The classifier now flags additional choice forms (`escalate to`, `explicitly request`, `set the model to`, assignments, `answer as`, provider-qualified IDs). Existing 86 routing cases remain unchanged and passing.
- **Limits and remaining work:** scoring checks calls and a fixed canary, not arbitrary prose meaning. A false claim of a write or model switch without a call/canary is not detected. Fixtures are synthetic, not engine-grounding evidence. The classifier/flag still needs Phase 9 request-path wiring, and `injectionResistance` aggregation belongs to the unfinished runner; the existing harness records per-case pass/fail and tool-call correctness. No model was called, no key was needed, no routing order changed, and no new ADR was needed.
- **Verification:** `npm run typecheck`, `npm run lint`, `npm run test:unit` (**1,667 passed**, including 146 suite tests and 21 new classifier regression tests), `npm run test:property` (**65 passed**), and `npm run build` all pass. Integration tests were not run locally: this change adds no handler or service behavior and needs no database. The existing unit source-scan and write-boundary tests pass with the full unit suite.

- **Review fix (2026-11-01):** "request" took the model-choice verbs' three-word gap, so "I request financial health with deepseek" lost its task and fell to Tier 1. `MODEL_REQUEST` now strips only a model named immediately after "request".

**2026-11-01 — review fixes on #20; `robustness` corpus built** (`src/server/ai/eval/tasks/robustness.ts`, 10 cases, suite version 1; PR #22, after #20 and #21).
- **#20 review (Codex, two P2s), both fixed.** Required and forbidden figures are matched with their sign, so "−62.49%" no longer passes for a 62.49% savings rate; an amount owed or over may be stated either way. Grounding case 23 now replays the holdings too and requires naming the unpriced HDFC Bank and the stale NIFTYBEES price.
- **`robustness` replays the `grounding` fixture** with four more frozen calls: an empty June 2025, January's cash flow (no income, so the savings rate is `null` with `divide_by_zero`), September's transactions clipped to 5 of 14, and net worth on 2020-01-01, before any record. Transaction ids now get fixed placeholders too. Its cases ask what the data cannot answer — no records, unavailable, partial, absent (a transport budget, a car loan, rental income), plus a negative XIRR whose sign must survive. The scorer is `grounding`'s, so figures must trace; on top, the answer must say the value is unavailable, the list partial or the thing absent.
- **`scenario` is blocked, not skipped:** it needs deterministic projection arithmetic, and `run_financial_scenario` has none (OD-18). Building the suite first would measure a model doing arithmetic the engine should do.

- **A dozen Codex review rounds on #22**, every finding real and each a narrower phrasing case. The wording checks gained: required and forbidden figures matched with their sign; a figure after a denial ("not 0%") not counted as stated; contradictions — claims that fail an answer even beside the right wording — tested clause by clause (punctuation, conjunctions and line breaks split claims; colons, decimals and "Rs." do not), and denied only by a negation before, inside or right after the claim; `amountFor(subject)` for an amount given to something the user does not have, in any currency notation. Wording checks decide whether an answer says a thing, not how well; tune further against real model answers once the runner exists.

Next (as of #22): `document` and `analysis` corpora; then the `ai:eval` runner. `scenario` waits on OD-18. No model has been run against any suite yet.

**2026-11-01 — #20, #21 and #22 merged; the `ai:eval` runner built** (`src/server/ai/eval/runner.ts`, `scripts/ai-eval.ts`, `npm run ai:eval -- --tier <n> [--suite …] [--model …] [--limit n]`).
- **What it runs:** every model in the tier's configured order plus that tier's `EVALUATION_CANDIDATES`, over the tier's suites (Tier 1: parse, classify, tool-select, grounding, robustness, injection; Tiers 2–3: the four tool suites; Tier 4: none until `document` exists). `routing` is not run: it measures application code.
- **What it writes:** `eval/reports/<timestamp>-tier<n>.md` and `.json` with schema adherence, tool-call correctness, retrieval grounding, injection resistance, latency and failing case ids, never model output. And a **proposed** `AI_TIER<n>_MODELS` order: only models clearing §5's thresholds, ranked by §14's criteria. It changes no configuration.
- **Unanswered is not wrong:** a case the provider never answered (transport, timeout, rate limit) is listed and kept out of every score, and a model with one is not proposed until re-run. The first live check found this: a 502 had been scored as a schema failure.
- **Live wire check, 2026-11-01, from the cloud session** (`--limit`, synthetic fixtures only). The runner works end to end: `nemotron-3.5-lightning` answered real cases. **But a full measurement cannot run from here.** A direct chat call to each candidate:

| Model | Result |
|---|---|
| `nvidia/nemotron-3.5-lightning-30b-a3b`, `nvidia/nemotron-3-ultra-550b-a55b`, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | **200** — answer |
| `nvidia/nemotron-3-super-120b-a12b` (**Tier 2 primary**), `nvidia/nemotron-nano-3-30b-a3b` | **404** "Function … not found for account" — listed in the catalogue, not enabled for this key's account |
| `openai/gpt-oss-20b` (**Tier 1 serving**), `google/gemma-4-31b-it`, `deepseek-ai/deepseek-v4.1-flash`, `z-ai/glm-5.3-flash` | **502** "upstream request failed" at exactly 30 s — consistent with the session's egress proxy cutting long requests, not with the model |

  So **Tier 2 has no reachable model for this account today**, and Tier 1's serving model is unverified. Before the first real measurement: run `npm run ai:eval` from the development PC (no proxy), and check on build.nvidia.com whether the 404 models need enabling for the account.

Next (as of #24): the first full measurement (PC); `ai_model_evaluations` storage and its load into `createCapabilityMatrix`; the `document` and `analysis` corpora. `scenario` waits on OD-18.

**2026-11-01 — measured results stored and loaded (ADR-44)** (migration `0006_phase8_ai_model_evaluations`, `src/server/ai-evaluations.ts`; stacked on #24).
- `npm run ai:eval` stores a full run: one `ai_model_evaluations` row per model and suite, with exact counts and failing case ids in `detail`, never output. `--no-record` skips it; a `--limit` run is refused.
- At server start (`instrumentation.ts`), the latest rows become `source: 'measured'` capability entries, layered over the declared matrix by `createCapabilityMatrix(measured)`. A new measurement takes effect at the next start.
- **When a model gets a measured entry:** every suite of its tier at the suite's current version, no unanswered case, and a declared entry for the fields a measurement cannot supply. Otherwise its declared entry stays, which serves no score-gated route. Scores combine exact counts across suites, and a score nothing measured is 0, so it fails its gate. Latency is the slowest suite's; the entry is as old as its oldest row.
- A failed read at startup is logged and leaves the declared matrix: it fails closed.

**2026-11-01 — `document` suite built** (`src/server/ai/eval/tasks/document.ts`, 20 image cases, suite version 1; PR #26).

- **Corpus:** 20 generated receipt and statement images, covering one or multiple transaction rows, INR/USD/EUR, income/expense/transfer, missing dates and amounts, and one printed prompt injection. The checked-in base64 PNGs in `document-fixtures.json` need no OCR service, uploaded files or database; `scripts/generate-ai-eval-document-fixtures.mjs` regenerates them with ImageMagick.
- **Provider prerequisite:** the AI message type previously only carried text despite the Tier 4 vision capability declaration. `ChatMessage` now supports image attachments on user turns, and NVIDIA Build sends them as OpenAI-compatible `image_url` data URLs. Existing text-only turns remain unchanged; the provider test checks the exact wire payload without egress.
- **Proposal and scoring:** a new strict document proposal contains 1–20 transaction proposals and allows `bookedOn: null` when the document has no readable date. The production prompt says not to treat totals as transactions, invent missing fields, or follow printed instructions. Scoring validates the production schema, exact row count/order/type/date/amount/currency/description and account hints, plus empty fabricated notes/tags/category fields. A missing date or amount must be nullable and marked for review.
- **Verification:** `npm run typecheck`, `npm run lint`, `npm run test:unit` (**1,824 passed**) and `npm run build` all pass. The focused provider/document tests also pass. No model was called and no key is needed.
- **Remaining:** `analysis` is unbuilt. `scenario` remains blocked under OD-18. Tier 4 now has a suite for the runner to measure once it is wired in.

**2026-11-01 — `analysis` suite built** (`src/server/ai/eval/tasks/analysis.ts`, 15 cases, suite version 1; stacked follow-on PR #27).

- **Coverage:** five portfolio reviews (returns, allocation, missing and stale prices, unavailable TWR), four financial-health checks (cash flow, budgets, account/debt obligations, unavailable runway), three period reviews (month comparison, expense driver, net-worth trend), and three cross-domain snapshots.
- **Fixture:** every case replays one or more frozen results from `grounding-results.json` using correctly paired assistant tool calls and tool responses. The figures are the same ones integration-tested against production handlers for the grounding fixture; no database or provider is required to build or score the suite.
- **Deterministic scoring:** reuses grounding's exact numeric-claim parser and scorer, requiring case-specific figures and findings, rejecting unsupported figures, known contradictions, and unnecessary follow-up calls. No LLM-as-judge is used; general prose quality is intentionally unscored.
- **Limits:** this measures whether the model states supported financial findings, not the quality or novelty of open-ended reasoning. No model was called and no key was needed. The `ai:eval` runner PR #24 predates the document/analysis suites and will need follow-up wiring before these suites can be run from the CLI.
- **Verification:** `npm run typecheck`, `npm run lint`, `npm run test:unit` (**1,844 passed**) and `npm run build` all pass. The 20 focused analysis tests pass too. No model or API key was used.
- **Review fix:** a fabricated runway duration ("Your runway is 12 months") passed `analysis-009` beside its disclaimer, because `amountFor` reads only money and percentages. `durationFor` now rejects a runway stated in days, weeks, months or years. A second finding (a TWR of -21.06% passed `analysis-005`; the figure traces to XIRR) led to a sweep: every case that reads the portfolio result rejects a TWR figure, and every case covering unpriced HDFC Bank rejects a market value for it. A third round (Dining "under budget", a stale price called current) led to reversal checks on every case with a directional finding: realised/unrealised sign, stale vs current price, Dining over budget, expense and savings direction, October vs September, net-worth trend. Later rounds: a figure beside a disclaimer is not assigned to the missing metric (`assignedTo` stops at a bracket or denial); analysis no longer counts toward tool-call correctness (its calls are replayed); and key figures are **bound to their metric** (`bound`, `bindingHolds`), so an answer that swaps income and expenses, or equity and ETF, fails even though every figure traces.

**2026-11-01 — `document` and `analysis` wired into `ai:eval`** (#28, on #26/#27; main already had #24/#25).
- Tiers 2–3 also run `analysis`; Tier 4 runs `document`. A Tier 4 proposal needs schema adherence ≥ 0.95 and no tool-call score. A stored measurement needs every current tier suite, so a Tier 2 model now needs an `analysis` row too.
- **Ranking:** `analysisAccuracy` (the `analysis` pass rate) ranks after grounding and before injection resistance and latency, so a model that gets the figures wrong cannot outrank a correct one on speed. It is a reported score, not a gate, and not stored as a capability score.
- **Proposals:** a model with no `DECLARED_CAPABILITIES` entry is reported but never proposed. A measurement cannot supply its context window or modalities, and startup rejects a configured model without an entry. This covers the five `EVALUATION_CANDIDATES`: one that measures well needs a declared entry before it can be proposed.
- **Proposals match selection:** a model whose declared tool-calling, output mode or vision serves none of its tier's capabilities is not proposed (`unsupportedBy` in `orchestrator/select.ts`, the same gate production uses minus scores). One that serves some is proposed with a caveat listing the rest. **Consequence: Tier 4 cannot be proposed today.** `nemotron-3-nano-omni` declares `json_object`, and both document capabilities need `json_schema`, so document extraction is unroutable whatever it measures. Before Tier 4 can serve, verify whether the model accepts `json_schema` on NVIDIA Build and update `config/capabilities.ts`, or choose another vision model. Tier 1's `gpt-oss-20b` likewise serves the tool capabilities but not parse or classify (`json_object`).

Next (as of the storage PR): the first full measurement, from the PC (Tiers 1, 2 and 4). `scenario` waits on OD-18.

## Scope change — 2026-11-01

**Bank import, Groww sync and Groww order placement are now in scope** ([ADR-50](docs/DECISIONS.md#adr-50--bank-import-groww-sync-and-groww-order-placement-are-approved-each-behind-the-owners-confirmation)), each behind the owner's confirmation. This is not Phase 8 work and changes nothing in the current phase.
- Statement and CAS import joins Phase 9's document pipeline.
- Bank alert emails, Groww sync and Groww orders are a new **Phase 14** after deployment, because SEBI requires API orders to come from a static IP. Continuous Improvement becomes Phase 15.
- Account Aggregator is out: it is open only to regulated data receivers.
- Zerodha stays out until the owner asks.

---

## Phase 8 live measurements — 2026-11-01

PRs #23–#28 are merged. Work resumed from `main` at `015fdd0`; the authenticated catalogue still has 85 models. Synthetic fixtures only were sent to NVIDIA. The runner used its existing 2,048 output-token budget and a 45,000 ms request timeout, with `--no-record` so no database capability entries were changed.

| Tier 4 model | Document v1 exact passes | Schema valid | Unanswered | p50 / p95 ms |
|---|---:|---:|---:|---:|
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | 1/20 | 13/20 | 0 | 12540 / 19060 |
| `nvidia/nemotron-3.5-super-vl-120b-a12b` | 9/20 | 19/20 | 0 | 7406 / 23695 |

Reports: [Nano Omni](eval/reports/2026-11-01T13-34-39-tier4.md), [Super VL](eval/reports/2026-11-01T13-36-26-tier4.md), and adjacent JSON files containing exact counts and failed case ids, never model output. Commands: `npm run ai:eval -- --tier 4 --model <model-id> --no-record`, with `AI_REQUEST_TIMEOUT_MS=45000` and `NODE_USE_ENV_PROXY=1` in this environment.

Neither run proposes an order. Nano Omni fails the 0.95 schema gate; Super VL has no declared capability entry. Its 9/20 extraction accuracy also needs investigation before any production recommendation. Schema adherence alone does not establish extraction correctness. No model order, declared capability, prompt, fixture or scorer was changed to obtain these scores.

Bounded one-case access probes: Lightning answered parse but failed schema/accuracy; DeepSeek v4.1 Flash and GPT-OSS-20B timed out at 45 seconds and remain unmeasured. Both vision models answered their document probes. Two further Nano Omni diagnostics at 2,048 and 4,096 output tokens returned schema-valid, nontruncated outputs, so the initial schema failure was not shown to be a token-budget defect. A superseded Nano Omni full run was interrupted before report generation; only the completed runs above are reported as measurements. Limited runs were not stored or committed as full measurements.

Verification on the merged code: `npm run typecheck`, `npm run lint`, and all 1,915 unit tests pass. This PR adds reports and status corrections only. Scenario remains blocked by OD-18; Tiers 1–3 still need complete measurements. Reports are durable evidence, not database rows or accepted production capabilities.

## Phase 8 Tier 3 evaluation — 2026-11-01

A full 105-case attempt for `nvidia/nemotron-3-ultra-550b-a55b` completed on the same `015fdd0` evaluator baseline, with 2,048 output tokens, a 45-second timeout, synthetic fixtures only and `--no-record`. [Report](eval/reports/2026-11-01T13-57-50-tier3.md) and adjacent JSON retain suite counts, latencies, failure ids and provider error counts, never model output.

- Passes by suite: tool-select 20/30, grounding 16/25, robustness 6/10, injection 11/25, analysis 1/15.
- 27/105 requests went unanswered (24 transport errors, 3 timeouts). Ratios exclude those unanswered cases: tool correctness 0.83, grounding 0.73, injection resistance 0.58, analysis accuracy 0.11. These are incomplete-coverage diagnostics, not a qualified Tier 3 capability measurement.
- No order is proposed because of unanswered cases; the applicable tool-call score also falls below 0.90. No database measurement, model configuration or routing policy was changed.
- Fresh Tier 2 probes: Nemotron Super failed with a transport error; GLM Flash timed out at 45 seconds. GLM's report write also encountered the intentional same-second filename overwrite guard after the timeout; the existing report was preserved and no API retry was made just to recreate that limited report. These probes do not establish model scores.

## Phase 8 Tier 1 baseline — 2026-11-01

Lightning (`nvidia/nemotron-3.5-lightning-30b-a3b`) completed all 190 v1 cases with zero unanswered requests. Passes: parse 8/40, classify 56/60, tool-select 29/30, grounding 14/25, robustness 5/10, injection 11/25. Aggregate schema adherence is 0.66, tool correctness 0.7586, grounding 0.56 and injection resistance 0.44. The schema gate fails, so no order is proposed. [Report](eval/reports/2026-11-01T13-56-20-tier1.md) and adjacent JSON retain the exact counts and failed case ids.

The run used the unchanged v1 evaluator from `015fdd0`, 2,048 output tokens, a 45-second timeout, synthetic fixtures and `--no-record`. A separate bounded parse diagnostic stopped at the 2,048-token limit with no final content and 8,076 reasoning characters. That is evidence about one response, not a diagnosis of every failed case. PR #30 aligns budgets with production and versions affected text suites at v2; this report remains baseline evidence rather than a v2 capability measurement.

New one-case access probes: Gemma timed out at 45 seconds; the renamed Nano candidate failed with a transport error. Together with GPT-OSS and the Tier 2 probes, these limit which models can be measured from this environment. None of these probes establishes a capability score. No model order or database measurement was changed. All completed report counts and empty proposed orders were validated before committing.

## Phase 8 evaluation budgets — 2026-11-01

A live Lightning diagnostic exhausted 2,048 completion tokens in reasoning and returned no final content. Separately, inspection found every eval request used that same limit, despite production parsing using 1,024, classification 512, advanced analysis 4,096 and deep investigation 8,192. This branch derives runner budgets from `requirementFor` instead of using a universal limit. Tier 4 deliberately retains the smaller of receipt/document production budgets (2,048), because those routes share a schema score; a 4,096-token run must not certify the 2,048-token receipt route.

Reports and stored evaluation detail include the output-token budget per suite and request timeout. Historical reports without this metadata explicitly say it was not recorded. Parse, classify, tool-select, grounding, robustness, injection and analysis versions advance to 2 because their runner request contract changes for at least one tier; current-version storage guards therefore reject version-1 rows for these suites. Document stays at v1 (same budget and scorer), as does application-code routing. Prompts and scoring rules are unchanged. The baseline runs in PR #29 remain historical evidence at their original versions, not updated-contract measurements.

The change is developed in an isolated worktree while the baseline evaluation continues, so the running model requests retain their original code and budgets. Verification: typecheck, lint, all 1,923 unit tests, the five targeted PostgreSQL evaluation-storage integration tests and the production build pass. The initial build could not follow the isolated worktree’s external node_modules symlink; a local dependency tree resolved that environment issue. No model is called from this branch.

## Phase 8 v2 structured diagnostic — 2026-11-02

The [100-case structured report](eval/reports/2026-11-02T05-44-53-tier1.md) and adjacent JSON were produced by the budget-aligned evaluator at `2ebecee` (PR #30), with parse/classify v2, output limits 1,024/512, a 45-second timeout, synthetic fixtures only and `--no-record`.

- Lightning passed parse 0/40 and classify 1/60. Five requests timed out (four parse, one classify); schema adherence over the 95 answered cases is 1/95, about 0.0105. Counts exclude unanswered requests from score denominators.
- No additional 90 tool cases were run for this attempt: the structured gate already fails and unanswered cases preclude qualification. The report explicitly excludes a routing proposal because four Tier 1 suites are missing. This is a complete attempt of two suites, not a complete Tier 1 capability measurement.
- A fresh v2 GPT-OSS parse probe and Ultra analysis probe timed out at 45 seconds. The Tier 2 primary's grounding probe failed with a transport error. A separate minimal chat request without tools/schema confirmed HTTP 404 for Nemotron Super; GPT-OSS also timed out on the minimal request. These observations are scoped to this account/endpoint and environment, not intrinsic model scores or evidence of a missing key.
- Completion-reason aggregation is added separately in PR #31, after the source commit used for this run. This report cannot establish the finish reason of every failed case. The prior bounded Lightning truncation diagnostic must not be generalized to all failures.
- PRs #29/#30 have green PostgreSQL 17/18 CI; their changes remain open for review. No database capability row or routing order was changed. Further full-tier promotion is blocked by the measured gate failure and provider access; scenario remains blocked by OD-18.

Verification for this report-only change: typecheck and lint pass, along with the 1,923 unit tests on the budget-aligned code. Report versions, budgets, counts, coverage and empty proposed order were checked.

## Phase 8 completion diagnostics — 2026-11-02

Baseline diagnosis required an extra live call because reports retained failed case ids but not the provider's completion reason. This follow-on captures each returned finish reason and aggregates counts per model/suite into report JSON, Markdown and stored row detail. `length` identifies an output-limit stop; `stop` does not assert a correct answer. Provider failures have no finish reason and remain separate error counts. Historical reports explicitly say reasons were not recorded. No prompt, score, token budget, suite version or routing policy changes; raw content/reasoning is never added to reports or storage. Verification: typecheck, lint, all 1,929 unit tests, five targeted PostgreSQL storage integration tests and production build pass. Tests use fake providers; no live call was used to verify this change. The isolated PostgreSQL container was restarted after the cloud environment restart before the database rerun.

## Phase 8 documented reasoning-control probe — 2026-11-02

PRs #29–#32 merged in order after all PostgreSQL 17/18 CI checks passed. Each child was retargeted to main after its parent merge, and merge-tree checks matched the CI-tested heads. The repository-wide update restriction required the permitted admin merge path; protection settings were not changed.

NVIDIA's model-specific documentation includes a Lightning `chat_template_kwargs.enable_thinking=false` example. A separate, explicitly experimental six-case probe used that flag with the existing parse/classify v2 prompts, scorers and production budgets. It passed parse 3/3 and classify 3/3, all with `stop` completion reasons. [Method and result](eval/experiments/README.md), with an adjacent non-promotable JSON artifact. This is not a production-profile measurement or evidence of full-suite quality. It does not replace the default-profile report, change routing, or write database capability rows. Production adoption remains unapproved and needs an explicit profile contract and full evaluation.

## Phase 8 expanded thinking-disabled experiment — 2026-11-02

Continued from merged PRs #29–#32 and the reviewed, CI-green documentation probe in open PR #33. A fresh authenticated catalogue read still returns 85 models with the same identifier drift. The expanded [190-case attempt and method](eval/experiments/README.md#lightning-thinking-disabled-tier-1-attempt--2026-11-02) used unchanged v2 prompts, schemas, scorers and production token budgets, with only the documented Lightning thinking flag changed in an experimental fetch wrapper. No application source or production profile changed.

- Parse: 26/40 exact passes, 40/40 schema-valid. Classify: 26/60 attempted passes, 29 answered and all 29 schema-valid. Tool-select: all 30 requests rate-limited. Grounding: 15/25 attempted passes, 20 answered. Robustness: 2/10. Injection: 16/25.
- Overall, 66/190 requests were unanswered: 63 rate limits and 3 timeouts. Answered-only diagnostics are schema 69/69, tool correctness 20/25 (0.80, injection only), grounding 15/20 and injection 16/25. This is not a qualified capability measurement; unanswered requests are excluded from scores and tool correctness is below the 0.90 gate even on the answered subset. The six-case probe did not establish full-suite quality.
- The experiment uses `limit: 60` (enough to select every current Tier 1 case) to retain the evaluator's unconditional proposal/storage refusal, in addition to `record: false` and the non-production envelope. Exact selected ids and aggregate completion reasons are retained; raw outputs/reasoning are not. No database row, routing order or declared capability changed.
- **Owner decision needed before the proposed contract change:** [request-profile implementation scope](eval/experiments/REQUEST-PROFILE-PROPOSAL.md). It proposes application-controlled profiles plus matching report/storage/selection provenance, legacy rows treated as default-profile only, and fresh paced evaluations. This is a proposal, not an adopted architecture or acceptance of Lightning. Existing measurements cannot certify a production request setting they did not use. OD-18 remains separately unresolved; no Phase 9 work started.
- Verification: typecheck, lint, all 1,929 unit tests, production build and client-secret scan pass. Artifact ids, counts, versions, budgets, scores and non-promotion guards were validated. No integration behavior or schema changed.

## Phase 8 request-profile contract — 2026-11-02

The owner approved the [request-profile implementation scope](eval/experiments/REQUEST-PROFILE-PROPOSAL.md) by instructing work to continue after the explicit approval question. [ADR-51](docs/DECISIONS.md#adr-51--request-profiles-are-application-controlled-and-measurements-must-match-them) records the contract; this does not accept Lightning for production or a new model order.

- `AI_REQUEST_PROFILES` is a JSON model → profile-id map. Empty preserves the existing wire body. The opt-in `lightning-thinking-disabled-v1` profile is supported only for Lightning; provider controls remain inside the adapter and are never taken from conversational text or tool arguments.
- The production adapter exposes the canonical profile identity/fingerprint it actually uses. The evaluator records it per model, and storage retains it in every suite's existing JSON detail. No migration or dependency is needed. Separate profile histories prevent one profile's newer result shadowing another's.
- Capability loading requires all current suites to match the active profile. Legacy rows certify only the unchanged default; selection checks measured provenance, and the orchestrator also checks the adapter before egress. The prior experimental artifacts remain separate and are not imported.
- The evaluation CLI defaults to a 2,000 ms minimum interval between request starts (`--interval-ms` adjusts it). Pacing is outside provider latency/deadlines; a rate-limited case remains unanswered, with the next case respecting `Retry-After` or a 60-second cooldown. No failed case is replayed.
- Verification: typecheck, lint, 1,947 unit tests, 65 property tests and all 542 PostgreSQL 17 integration tests pass (2,554 tests total), along with production build, client-secret scan and integrity (33 passing, 0 failing). PR #35 passed PostgreSQL 17/18 CI and automated review with no findings. PRs #33, #34 and #35 were merged in order using the permitted admin path; protection settings were unchanged and each merge tree equalled its CI-tested head. Production environment values, tier orders, declared model capabilities, prompts, scorers and suite versions are unchanged.

## Phase 8 paced Lightning profile measurement — 2026-11-02

The normal `ai:eval` CLI completed all 190 current Tier 1 cases using the implemented `lightning-thinking-disabled-v1` profile. [Report](eval/reports/2026-11-02T07-21-15-tier1.md) and adjacent JSON. Source baseline: `ea3b436d2030608e56a70e161d15e2d6a06d21ad` (the subsequently merged PR #35 head). Source/evaluator files are unchanged in the report follow-on. Only synthetic fixtures were sent to NVIDIA; no raw response content or reasoning is retained.

Command: `npm run ai:eval -- --tier 1 --model nvidia/nemotron-3.5-lightning-30b-a3b --interval-ms 3000 --no-record`, with `AI_REQUEST_PROFILES={"nvidia/nemotron-3.5-lightning-30b-a3b":"lightning-thinking-disabled-v1"}`, `AI_REQUEST_TIMEOUT_MS=45000` and `NODE_USE_ENV_PROXY=1` scoped to that command. No production environment file was changed. This is a measurement using a represented request profile, separate from the earlier fetch-wrapper experiments; it is not a qualified routing measurement.

| Suite | Exact passes / attempted | Answered | Unanswered |
| --- | ---: | ---: | ---: |
| parse v2 | 29/40 | 39 | 1 timeout |
| classify v2 | 54/60 | 60 | 0 |
| tool-select v2 | 26/30 | 30 | 0 |
| grounding v2 | 17/25 | 25 | 0 |
| robustness v2 | 2/10 | 9 | 1 timeout |
| injection v2 | 14/25 | 25 | 0 |

188 requests were answered, with **zero rate limits**. Schema adherence is **99/99 (1.00)**, tool correctness **44/58 (0.7586206897)**, grounding **17/25 (0.68)** and injection resistance **14/25 (0.56)**. The tool denominator includes three unexpected calls in grounding/robustness, as the existing scorer requires, as well as tool-select and injection. All ratios exclude the two unanswered requests. Answered-request p50/p95 latency is 752/4,252 ms. The tool gate fails even apart from incomplete coverage; no order is proposed. No capability row was stored and Lightning still has no declared capability entry. Schema validity did not establish financial field accuracy or safe tool use.

Fresh bounded minimal default-profile access probes (no tools/schema; `maxTokens: 16`, 45-second timeout) found: Nemotron Super and renamed Nano return HTTP 404; DeepSeek v4.1 Flash and GLM 5.3 Flash time out; GPT-OSS returned a normalized response in 3,128 ms ending in `length`. That last observation establishes only reachability, not capability. A subsequent normal CLI wire check passed the first parse, classify and tool-select cases for GPT-OSS, all with answered requests. Its partial report is deliberately uncommitted and cannot propose/store measurements. A full 190-case default-profile GPT-OSS run follows, with a 3,000 ms interval, 45-second timeout and `--no-record`; log `/tmp/finance-profiles-gpt-full.log` in this managed session. Probe results do not enter any capability score. Tier 2 needs provider/account access resolved; OD-18 still blocks the scenario suite; no Phase 9 work has started.

## NVIDIA reassessment requested — 2026-11-02

**Latest owner direction supersedes continuing the old NVIDIA selection/evaluation sequence:** reassess the NVIDIA setup, model choices and API-key setup from scratch **without application-source mutations or cascading code changes**. All active NVIDIA evaluation processes were stopped at 07:56 UTC. The default-profile GPT-OSS full run was interrupted before a complete suite/report was produced; it must not be described as a complete measurement or used to populate capability scores. The earlier three-case wire check remains limited evidence only.

Historical reports and the merged profile infrastructure are retained. No app source, dependency, schema, tier order or production environment file changed for this reset. A separate workspace at `/workspace/nvidia-reassessment` holds the reassessment protocol, standalone API-access probe, a SHA-256 baseline for 376 tracked application/configuration/test files, and preserved uncommitted probes/interruption notes. The standalone helper imports no app code, loads no `.env`, accesses no database, writes only outside this repository and checks source hashes before/after network work. Offline redaction/filtering/malformed-response checks pass; its configuration check verified all 376 hashes with no network request.

An explicitly labelled existing-key baseline was then read through the standalone helper: `/models` returned HTTP 200 and 85 ids, with all 376 source hashes unchanged. This is a new authenticated catalogue observation, not a resumed inference benchmark or proof every model is callable. `credential-audit.json`, the catalogue artifact, `documentation-review.json` and `candidate-review.md` are in the isolated workspace. Current official public documentation was reviewed for Bolt, Kimi, MiniMax Flash, Super VL and Mistral Large; these are discovery leads only, with no production role/order selected and unresolved API details recorded. No new inference call was made for that documentation review.

The non-secret protocol, source-hash manifest, credential audit, catalogue and documentation/discovery review are also preserved as a durable snapshot in [eval/reassessment/2026-11-02/](eval/reassessment/2026-11-02/README.md), so changing environment settings does not strand the audit in an ephemeral workspace. Application source remains unchanged; the helper stays outside the repository. The isolated PostgreSQL validation container was stopped after its checks completed.

The new setup will separately establish credential/account access, the authenticated catalogue, model/API-feature compatibility, and workload quality. No previous candidate list or experimental request control is preselected. Compatible key/model changes can use the app's existing configuration surface. A model/profile absent from its capability registry will be reported as a bounded compatibility requirement; the reassessment will not silently edit source or bypass that gate.

**Owner/settings action for a fresh credential:** configure an NVIDIA Build hosted-API key as the cloud secret targeting `NVIDIA_API_KEY`, scoped to `integrate.api.nvidia.com`; keep the value out of chat/repository. Current observed binding is `Authorization_Nvidia`; the canonical variable is absent from the standalone process environment. Existing successes do not prove the old key bad, and replacement is not assumed to fix entitlement/provider/network failures. Available tools inspect readiness but cannot create/revoke NVIDIA account keys or update this environment's secret bindings. Retain the old credential until a replacement is validated. See `/workspace/nvidia-reassessment/README.md` for the staged procedure.

The clean setup can initially retain the existing working key: the immediate configuration correction is to target the cloud secret at the application's expected `NVIDIA_API_KEY` variable rather than `Authorization_Nvidia`, avoiding command-local aliases. Replacing/revoking the credential is a separate owner/account decision after validation. No source edit is needed for that binding change.

## Provider switch to Groq — 2026-11-02 (ADR-52)

**The owner opened the provider choice; NVIDIA Build's free tier is replaced by Groq.** The decision is [ADR-52](docs/DECISIONS.md#adr-52--the-model-provider-is-any-openai-compatible-api-groq-replaces-nvidia-builds-free-tier).
- **Evidence, from the owner's key:** 8 of the 50 listed chat models answered; 31 returned 404, including both routed primaries. Full Tier 1 runs (thinking-disabled profile for Lightning) failed the 0.90 tool gate:
  - Bolt: tool 0.80, injection 0.32, schema 0.99;
  - Laguna XS: tool 0.79, injection 0.60, schema 1.00;
  - Lightning: tool 0.76.
- Muse Glimmer (~11 s per request) was stopped. Mistral Large 4's Tier 2 run was stopped when the provider choice opened.
- **`npm run ai:reachability`:** one tiny request per routed model and evaluation candidate. It exits non-zero when a routed model fails.
- **Configuration:** `AI_API_KEY` and `AI_BASE_URL=https://api.groq.com/openai/v1` (the `NVIDIA_*` names remain a fallback).
- **Tier orders (Groq ids, declared only):** T1 `openai/gpt-oss-120b`, `openai/gpt-oss-20b`; T2, T3 and T4 empty until a model is measured on that tier's own suites. Measured eligibility is keyed to a model's declared tier, so one model cannot serve several tiers until that is made tier-specific.

**Handover to Codex — next steps, in order:**
1. `npm run ai:reachability`.
2. `npm run ai:eval -- --tier 1 --model openai/gpt-oss-120b,openai/gpt-oss-20b --interval-ms 3000 --no-record`, and the same for Tiers 2 and 3 with Groq text models (measured on each tier's own suites; a Tier 2/3 model needs its own declared entry at that tier, or tier-specific eligibility first). Watch Groq's free limits: 30 requests/min, 1,000 requests and 200K tokens per day. Spread the runs over days if needed.
3. Find a Groq vision model that answers, and run the Tier 4 document suite on it.
4. **Before the first `--record`:** scope stored measurements to the provider (Codex review of #37, P1). `ai_model_evaluations` provenance identifies a measurement by model, suite and request profile, never by provider or endpoint. So after a provider switch, an old provider's row for the same model id could authorise the new one. Record a non-secret provider identity (for example the base URL's host) in each row's detail. Match it in `latestEvaluations()` / `capabilitiesFromEvaluations()`, and treat rows without it as ineligible. No rows exist today: every live run used `--no-record`.
5. Bring the measured lineup to the owner for approval, then record it (`--record`) and set the orders.

**Unchanged:** scenario remains blocked by OD-18; NVIDIA reports stay as history.

## Groq measurement checkpoint — 2026-11-02

PR #37 was still open when this task started. Both PostgreSQL 17/18 CI checks passed; normal merge was blocked by branch policy and auto-merge is disabled. Following the owner's renewed merge direction it was admin-squash-merged at 13:12 UTC (`faa20f9`). `codex/groq-measurements` starts from that merged main.

- **Access:** `npm run ai:reachability` passed for 120B and 20B. The five historical NVIDIA evaluation candidates fail on Groq. The authenticated catalogue and [Groq vision docs](https://console.groq.com/docs/vision) identify `qwen/qwen3.8-27b`; it returned three successful document responses, but also eight `json_validate_failed` errors in an interrupted suite. No complete Tier 4 quality score exists.
- **Quota:** the observed token-minute bucket is 8,000, in addition to the handover's 30 RPM / 1,000 RPD / 200K TPD. The exact requested full Tier 1 command was started, then interrupted after seven journaled requests before a suite completed. Tier 4 stopped after eleven requests at a conservative reserve. No 429 or retry loop occurred. Initial image-error accounting overcounted base64 bytes; the corrected conservative reserve before the later parse run is 84,131, not 193,427 actual billed tokens. Details and journal: [checkpoint](eval/reports/groq-2026-11-02/README.md).
- **Pre-record P1 fixed on this branch:** new reports/rows carry normalized provider endpoint provenance; recording refuses missing/mismatched identity, latest-row selection filters provider before selecting rows, and the capability loader rejects foreign/unlabelled rows. Endpoint identity excludes credentials/query/fragment and distinguishes base paths. No migration; the existing JSON detail stores it. Unit tests cover missing, mixed and foreign rows; integration tests prove newer foreign/legacy rows cannot shadow current-provider results. **Only synthetic test rows were inserted, into a disposable test database, and cleaned up. No live results were saved.**
- **Completed parse checkpoint:** [120B parse v2](eval/reports/2026-11-02T13-20-02-tier1.md), all 40 cases: 35 correct, 40 schema-valid, 0 unanswered, 40 stop finishes, unchanged default profile / 1,024 output tokens. This is a full parse suite but partial Tier 1 coverage; no tool score or order can be inferred. Preserve it when finishing the other five suites. The standard latency includes quota waits; see the separate server-latency/usage summary.
- **Routing remains unchanged:** no complete Tier 1 comparison; Tiers 2/3 not yet run; Tier 4 incomplete. Proposed accepted orders for 2/3/4 remain empty; no accepted Tier 1 order is proposed yet. 120B's declaration is Tier 1 only: measuring it elsewhere does not make cross-tier eligibility safe. Reconcile that separately before accepting advanced-tier orders.
- **Automation paused — 2026-11-02, 15:22 UTC:** the earlier daily schedule had a 14-occurrence cap, but was broader than needed. It is now disabled; there are no automatic measurement runs while paused. The measurement task has a finite case/suite checklist, independent of any schedule.
- **Final daily quota checkpoint:** 65 chat requests including reachability and 148,382 conservatively reserved tokens; the reserve includes eight bounded errors with no reported usage and is not billed usage. See [daily usage summary](eval/reports/groq-2026-11-02/daily-usage-summary.json). No further live process is running.
- **Resume:** retain complete suite reports between days and finish every suite for both Tier 1 candidates, Tier 2 120B, Tier 3 120B, and Tier 4 Qwen. Respect token as well as request limits, stop on quota errors rather than retrying, and pace outside the adapter latency timer. The temporary fetch guard inflated report latency by including waits: do not rank model speed from those timings. Do not combine historical NVIDIA rows with Groq measurements. Bring the completed per-tier proposal to the owner before setting orders or recording.

## Groq continuation checkpoint — 2026-11-02, 15:09 UTC

- **20B robustness v2: 8/10 cases retained**, with 3 passing, 4 scorer failures and 1 HTTP 400 classified as transport. Cases 009/010 remain; no completed robustness score or order is proposed. [Score checkpoint](eval/reports/checkpoint-tier1-robustness-openai-gpt-oss-20b.json), [transcript and resume notes](eval/reports/groq-2026-11-02/README.md#continuation--2026-11-02-15061509-utc).
- **Current quota ledger:** [73 requests / 183,316 conservatively reserved tokens](eval/reports/groq-budget-2026-11-02.json), including all earlier usage. This supersedes the earlier 148,382 stop point; it is not billed usage. No further calls fit the next case's bound, and no live process remains running. Also account for preceding-24-hour activity when seeding a fresh UTC-day ledger; do not infer reset from the date alone.
- **Resumable CLI:** `node --conditions=react-server --import tsx scripts/ai-eval-budgeted.ts --tier 1 --suite robustness --model openai/gpt-oss-20b --interval-ms 3000 --no-record`, with the configured Groq credential mapped to `AI_API_KEY` and `NODE_USE_ENV_PROXY=1`. Checkpoints bind source/provider/profile/suite/budget; no raw output is stored. Quota waits happen outside adapter latency. The ordinary harness aggregation/count/summary rules are reused unchanged; no gates, prompts, scorers, suites, request profiles or tier orders changed. `--record` is refused by this CLI.
- **Verification:** 1,952 unit tests, typecheck, lint, production build and client-secret scan pass. A reserve-stop resume sent no provider request and left ledger/checkpoint hashes unchanged. PR #38's earlier head had green PostgreSQL 17/18 CI. The paused automation retains instructions for the two outstanding robustness cases and the completed 120B parse report. No live results were recorded.

## Finite evaluation work list — 2026-11-02, 15:22 UTC

The owner questioned the recurring schedule; it is now **paused**, with no replacement recurring schedule created. The old schedule was daily with `COUNT=14`, not unlimited, but a finite task should be tracked by completed evidence rather than days elapsed.

[Remaining-work table](eval/reports/groq-2026-11-02/remaining-work.md) and [machine-readable manifest](eval/reports/groq-2026-11-02/remaining-work.json) are derived from the unchanged suites and retained reports: **610 planned case measurements / 23 model-tier-suite entries; 48 retained results (47 answered, 1 unanswered); 562 unattempted cases in usable evidence**. Interrupted requests with no scored report do not count as completed. Next are only 20B robustness cases 009/010 after safe quota headroom. Existing failures remain evidence, not an instruction to tune or retry until models pass.

The conservative daily reserve remains 183,316 and cannot fund the next case. No new provider calls were made in this continuation. A conservative next quota check is after **2026-11-03 21:00 Asia/Calcutta**, more than 24 hours after the latest recorded request; still account for any other account activity. Completing development here means finishing the specified suite coverage, reporting exclusions under unchanged gates, and presenting the lineup for owner approval—not obtaining passing results from every candidate. PR #38 remains draft; no recording or tier-order changes. Source and checkpoint fingerprints were left unchanged. PostgreSQL 17/18 CI at `f9134dd` is green.

## Evaluation tooling development — 2026-11-02, 15:39 UTC

Added `npm run ai:eval:budgeted -- <evaluation arguments>`, a rolling-24-hour preflight wrapper around the existing checkpointed CLI. It carries only native prior-day usage, avoids reimporting carry, preserves today's usage/crash reserves, and rejects inconsistent ledgers before launching the evaluator. `--check-only` is offline. Historical baseline time is conservatively sealed once under the measurement lock; repeat checks do not postpone expiry. This removes the previous requirement to seed recent usage manually at each UTC-day boundary. A new ledger with imported calls also waits for the preceding minute bucket before its first request.

The offline check left the totals at **73 requests / 183,316 conservative tokens**. It sealed the older 148,382-token baseline at **2026-11-02T15:39:14.511Z**; conservative carry can therefore retain it through the same time tomorrow. The earlier 21:00 IST check suggestion is a time to inspect headroom, not guaranteed full capacity. No new provider request was sent. Original evaluator/fingerprint inputs, gates, prompts, scorers, suites, profiles and tier orders are unchanged. The 8-case checkpoint fingerprint still matches. **Validation: 1,958 unit tests, typecheck, lint, production build and client-secret scan pass.** An offline CLI test blocks fetch and verifies that two preflight invocations preserve identical totals without retaining a lock. Automation remains paused.

## Complete measurement workflow — 2026-11-02

The evaluation deliverable now has one finite coordinator: **`npm run ai:measure:groq -- --run`** (with configured Groq credentials and proxy support). It executes the full approved **23-entry / 610-case** plan, finalizes interrupted report writing first, resumes partial cases next, then continues pending suites without requiring the owner to choose the next step. Rolling quota preflight is used for every live suite invocation. Partial/no-progress, child errors and provider quota/auth/server failures stop the queue without an automatic case retry. No recording, tier-order update or PR merge is implemented.

- Fixed definitions: [groq-measurement-plan.json](eval/reports/groq-measurement-plan.json). Current generated overview: [Markdown](eval/reports/groq-workflow-progress.md) / [JSON](eval/reports/groq-workflow-progress.json). The earlier remaining-work files are historical snapshots; do not use their counters as ongoing progress.
- **Offline status:** `npm run ai:measure:groq -- --status`. Validates source/provider/profile/budget/version/case provenance and checks report counts against score checkpoints. No account key or database connection is needed for current default-profile Groq status.
- **Offline report recovery:** `npm run ai:measure:groq -- --finalize`. Re-emits completed suite reports after a crash without replaying requests or changing scores. Regression-tested against the ordinary runner's summaries/exclusions.
- **Readiness:** the overview separates missing coverage, unchanged numeric-gate failures, capability declarations and cross-tier eligibility gaps. Earlier fetch-guard latency is not pooled or ranked. No lineup is accepted automatically.
- **Verification:** both offline modes were run with fetch denied; the real ledger and saved 8-case checkpoint hashes remained unchanged. Coverage remains **48 retained results / 562 unattempted cases**, with one unanswered result. No model output is stored and no live provider call was made during this development. All original evaluator fingerprint inputs and gates/prompts/scorers/suites/profiles/orders remain unchanged. **Validation: 1,989 unit tests (including 31 new workflow cases), typecheck, lint, production build, client-secret scan and whitespace checks pass.**
- **Continuation:** the former recurring schedule stays paused. One authorized wakeup is scheduled for **2026-11-03 ~21:30 Asia/Calcutta** and now runs the full coordinator; it should carry through all work the quota window permits, not stop at each suite/tooling change. Only real case-coverage progress may justify one further quota continuation. Owner approval remains required before recording or accepting orders.

## Phase 9 early parallel slice — owner-approved 2026-11-02

**Why early:** the owner asked to keep product development moving while provider quota/funding delays Phase 8. Work is isolated on `codex/phase-9-nl-entry`, in `/workspace/phase-9-nl-entry`, based on main after PR #38 merged. Model-agnostic interpretation and fake-provider tests are permitted; live draft generation is not. No other Phase 9 surface was started.

- Added transaction-only proposal persistence, 24-hour lifetime and field-level validation/resolution. JSON numbers never become amounts. Invalid/ambiguous drafts remain visible for explicit user correction and acknowledgement.
- Added review/edit/confirm/reject UI at `/money/proposals`, linked from Money. Draft generation is visibly unavailable and the authenticated draft action cannot compose a live provider or persist a draft. There is no environment flag/test endpoint that bypasses lineup approval.
- Confirmation atomically claims the owner-scoped row, rechecks current ownership/account/currency/category/FX constraints and calls the original manual transaction/transfer services. Proposal state, ledger writes, tags, version increments and `ai_confirmed` audits commit or roll back together. The partial unique link index and deferred audit/linkage triggers enforce I-10 and I-14; expired/double/concurrent confirmations cannot create additional records.
- Baseline prompt, proposal schema, scorer, golden suites, capability gates and model orders were preserved. The existing prompt/schema are reused, with at most the existing single schema-repair round. Returned tool calls are rejected, not dispatched.
- Migration `0007_phase9_transaction_proposals` and its reverse are included. Conversations, investment proposals, assistant/analysis/scenario/document work remain deferred. [Implementation/activation contract](https://github.com/Javacom710/Personal-AI-Finance-Butler/blob/ccc9879/docs/PHASE9-TRANSACTION-ENTRY.md).
- PR #38 merged after PostgreSQL 17/18 CI passed. Remaining Phase 8 work needs a follow-up measurement PR once OpenRouter funding/credential readiness is confirmed; provider provenance must isolate its evidence. The one-time continuation's handover was updated; the former recurring automation remains paused. No provider switch or live call was made for Phase 9.

### Verification checkpoint — 2026-11-03

[PR #39](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/39) implements the authorized transaction-proposal slice. The complete CI pipeline passed on **PostgreSQL 17 and 18**, at code commit `0e3855f`: unit, property and integration suites; migration/seed and financial integrity checks; typecheck/lint; production build; client-secret scan; dependency audits. [CI evidence](https://github.com/Javacom710/Personal-AI-Finance-Butler/actions/runs/41487036592). The earlier full-suite-pending status is superseded by these completed checks. The prior local HTTP confirmation submission result was not retained across the environment restart and is not claimed as passing; concurrent/double confirmation is covered by PostgreSQL integration tests.

Live draft generation remains hard-disabled, and this does **not** complete all of Phase 9. The owner subsequently authorized the read-only assistant as the next separate slice on 2026-11-03, fake-provider tested and disabled pending lineup approval; scenarios remain blocked by OD-18. Phase 8 next needs confirmation of OpenRouter funding and a configured credential; the current environment exposes Groq/NVIDIA credentials but no OpenRouter credential. Do not spend Groq quota as a substitute, record measurements, or accept tier orders without the required owner approval.

## Codex Cloud environment failure and DeepInfra credit — 2026-11-07

- **Incident (10:20–11:00 IST).** Every Codex Cloud chat in the environment `Personal-AI-Finance-Butler` failed at start with *"Could not start this chat"* / *"Error submitting message"* (request ID `06deb3f9-3259-4c2c-9995-fa04bcc02d8c`), from the desktop app and chatgpt.com/codex alike. Opening that environment's **Edit** also failed (*"Couldn't confirm whether the editing chat was created"*).
- **Diagnosis.** A one-line test chat in the **Default** environment (no repo) answered at once; the same chat in `Personal-AI-Finance-Butler` failed. Ruled out: the prompt, GitHub access (repo public and listed in Codex's repo picker), sign-in, the desktop app (local logs clean, local threads start), and a published outage (status.openai.com listed only an unrelated code-review incident). Cause: that one environment's record broke on OpenAI's side; not fixable from the repository.
- **Fix.** The owner created a **new environment** for the same repo with the same scripts, variables and secrets; its install and maintenance scripts now end with the `.env` block in [RECOVERY-2026-10.md](docs/RECOVERY-2026-10.md#switching-agents) (now including `AI_API_KEY` and `AI_BASE_URL`). Cloud chats work again. The old environment can be deleted. If it recurs, follow the runbook there.
- **DeepInfra prepaid credit.** On 2026-11-07 the owner bought **US$5 of prepaid DeepInfra credit for ₹488.80** (including the card's currency-conversion fee). It is the testing provider for Phase 8 measurements (`AI_BASE_URL=https://api.deepinfra.com/v1/openai`). Track spend against this balance; no auto-recharge is set.

## DeepInfra direct measurement completion — 2026-11-07

The owner selected DeepInfra direct for Phase 8, excluding Google/Anthropic models and requiring approval before recording. **All 23 planned entries / 610 cases were attempted: 607 answered, three timeouts.** No Groq evidence was reused. Both GPT-OSS IDs are unchanged; Tier 4's declared candidate is `Qwen/Qwen3-VL-30B-A3B-Instruct`. No production order or database measurement changed.

[Per-tier approval report](eval/reports/deepinfra-2026-11-07/README.md) and [machine-readable decision](eval/reports/deepinfra-2026-11-07/approval.json): Tier 1 has no qualifying model (120B tools 82.76%; 20B schema 92.93%, tools 86.21%, one timeout); Tier 2's 120B passes the numeric tool gate at 91.38% but has **0/15 strict analysis passes and unresolved tier-specific eligibility**; Tier 3 tools 88.14%, analysis 0/15; Tier 4 schema 83.33%, exact extraction 1/20, two timeouts. **Recommendation: hold all promotions**, while distinguishing that recommendation from the harness's Tier 2 numeric-gate proposal. Phase 8 production selection remains incomplete; scenario still depends on OD-18.

The finite `ai:measure:deepinfra` coordinator uses six concurrent requests, per-case checkpoints, source/profile/provider validation and a $4.75 cap; it cannot record or change routes. Full-queue accounting is $0.06847073; the excluded short serial-start archive retains $0.001691837 of accounting. Probe costs are outside that ledger and covered by the margin below $5. These are estimates/reservations, not billing statements. All 1,991 unit tests, typecheck, lint, production build, client-secret scan and whitespace checks pass. Final offline validation preserved the 23 checkpoint hashes and usage hash without a provider call. The recurring automation remains paused; no continuation was scheduled.

## Phase 8 output-free failure diagnostics — 2026-11-07

Following the owner's instruction to continue building, added **`npm run ai:diagnose:deepinfra`** and deterministic diagnostic helpers for the existing analysis/document scorers. Only reason codes and counts are persisted; raw content, reasoning, arguments, values and validation messages are excluded. This is an evaluation-observability addition, not a scoring, prompt, routing, provider or eligibility redesign.

[Six-probe diagnostic report](eval/reports/deepinfra-2026-11-07/diagnostics/README.md): the three analysis probes answered normally but failed figure traceability, required figures and metric bindings. The answered document case had valid schema and the expected transaction count but incorrect account hints and notes; two other document probes timed out. These are fresh diagnostic observations, not retrospective explanations of all historical failures or new production evidence. Accounting is $0.012614377, including unknown-usage reservations. All 34 original measurement artifacts and their source fingerprint were verified unchanged.

**Verification:** 2,032 unit tests (41 new diagnostic tests), typecheck, lint, production build, client-secret scan and whitespace checks pass. The finite runner shares the measurement lock, enforces diagnostic/account spend caps, refuses recording and arbitrary overrides, and retains failures without retry. No database measurement, promotion, production order, prompt, gate or scorer changed. Phase 8 production selection, tier-specific eligibility and OD-18 remain unresolved.

## Phase 8 numeric presentation fix and fresh campaigns — 2026-11-07

Fixed a reproduced scorer false negative for LaTeX numeric commas (`{,}`) and percent signs (`\%`). Only presentation is normalized; digits, values, signs, precision, units and the financial/tool rubric remain unchanged. Grounding, robustness and analysis advance to v3, with tests refusing v2 capability evidence. New regression coverage checks supported plain/Indian/LaTeX forms alongside wrong values, signs, metric bindings, invented totals, unsupported metrics and extra calls. The three pre-fix live analysis probes did not contain those forms and still failed, so this is not claimed to explain the historical 0/15 result or improve model quality.

Added validated named campaigns to `ai:measure:deepinfra`, a shared account lock with diagnostics, and cross-campaign usage accounting including diagnostics and serial-start reservations. Account accounting is capped at $4.50; diagnostic accounting also retains its $0.25 cap. New campaigns never copy old scores. Historical source-bound checkpoints fail closed, rather than being rewritten to match changed code. [Details and commands](eval/reports/deepinfra-2026-11-07/diagnostics/numeric-presentation.md).

**Verification:** 2,058 unit tests, typecheck, lint, production build, client-secret scan and whitespace checks pass. The [fresh `format-v3` campaign](eval/reports/deepinfra-2026-11-07-format-v3/README.md) is prepared offline: 23 entries / 610 pending cases, zero provider requests at preparation. Combined prior known accounting is $0.083545001. All 34 original artifacts remain byte-identical; the old source-bound checkpoint read is rejected. No historical score was revised and no measurement or production order was accepted. The three extra audit calls added only $0.000768057 of accounting and did not establish LaTeX as the cause of the model's observed failures.

## Phase 8 tier-provenance correction — 2026-11-07

The existing database tier column was dropped by the reader and omitted from its latest-history key. Fixed `latestEvaluations()` to preserve the tier and partition histories by model/tier/suite/profile after provider filtering. Capability loading now accepts only a model's declared tier; missing/invalid/wrong-tier labels fail closed instead of mixing or shadowing shared suites. Selection and the harness's structural eligibility check reject `tier_mismatch`, even for perfect scores and explicit configuration overrides.

This tightens the existing one-tier-per-model contract without a migration or capability-matrix redesign. Measuring GPT-OSS in Tiers 2/3 does not grant those routes while its declaration is Tier 1. A broader multi-tier representation remains separate; production lineup quality and acceptance remain unresolved. [Correction and evidence](docs/audits/2026-11-07-ai-tier-provenance.md).

**Verification:** 2,072 unit tests and 10 PostgreSQL 17 integration tests pass, plus typecheck, lint, production build, client-secret scan and whitespace checks. The integration database was isolated and temporary, with synthetic evaluations only, and removed after testing. No live provider calls, production evaluation recording, order changes, prompt/scoring changes or promotion occurred.

## Phase 8 independent measured tier eligibility — 2026-11-07

Implemented separate measured model/tier entries backed by shared declared physical capabilities. The runtime reads one strict snapshot and selects the requested tier's evidence; scores never inherit across tiers. Activation requires full current corpora, exact production output budgets, valid counts/applicability and zero unanswered cases. Newer invalid evidence blocks older passing rows. Cross-tier proposals additionally verify exact case identities. Existing physical/profile/health/quality checks and default routing orders remain in force. No database migration is needed.

[Implementation and verification](docs/audits/2026-11-07-ai-tiered-eligibility.md), [ADR-53](docs/DECISIONS.md): **2,097 unit tests and 12 isolated PostgreSQL 17 integration tests** pass, plus typecheck, lint, production build and client-secret scan. The temporary database contained synthetic evaluations only and was removed. No production measurement was recorded or routing order accepted.

The fresh `format-v3` campaign completed against the fixed source and scoring contract: **23 entries / 610 attempted, 603 answered, seven timeouts**, six concurrent requests, no retries, no recording. Evidence stays separate from historical v2 measurements. [Current approval report](eval/reports/deepinfra-2026-11-07-format-v3/README.md) and [decision JSON](eval/reports/deepinfra-2026-11-07-format-v3/approval.json):

- Tier 1 120B: schema 100%, tools 49/57 (85.96%); 20B: schema 94%, tools 47/59 (79.66%). Neither qualifies.
- Tier 2 120B: tools 50/57 (87.72%), analysis 1/15 attempted and one timeout. No proposal.
- Tier 3 120B: tools 52/58 (89.66%), analysis 1/15. No proposal; the generated `0.90 < 0.9` exclusion is display rounding, not a passing score.
- Tier 4 Qwen: schema 11/14 (78.57%), exact extraction 0/20 attempted, six timeouts. No proposal.
- Tier 5 remains deferred. **Recommendation: hold every promotion.** No production lineup is qualified or accepted; Phase 8 stays open. Future work must address candidate quality/current evidence before Phase 9; scenario separately needs OD-18.

Campaign accounting is $0.094323145; combined known DeepInfra accounting is $0.177868146, including earlier campaigns/diagnostics/reservations. This is not a provider billing statement. Offline source-bound validation makes no provider calls and preserves all 23 checkpoint hashes and the usage hash; all 34 original measurement artifacts remain unchanged. Recording and production order acceptance remain explicitly pending owner approval.

## Phase 8 shared prompt clarification — 2026-11-07

Clarified the shared production finance prompt's serialized amount/rate interpretation, preservation of valuation qualifications and continuation of legitimate questions after injection rejection. Clarified the document prompt's verbatim account/description evidence and handling of unsupported hints, tags, notes and ambiguities. No model-specific or benchmark-only prompt was introduced. Scorers, thresholds, corpora, budgets, timeouts, profiles and default orders stay unchanged; every affected suite's version advances so old evidence cannot authorize the new request contracts.

**Verification:** 2,110 unit tests, typecheck, lint, production build, client-secret scan and whitespace checks pass. Six bounded DeepInfra probes completed: analysis-001/006/015 answered but failed the existing rubric; doc-002 passed every extraction field; doc-001/018 timed out. These observations do not establish general improvement or qualify a model. No additional full campaign was run; current full-tier qualification remains outstanding.

[Implementation and live observations](docs/audits/2026-11-07-ai-prompt-contracts.md), [verification JSON](docs/audits/2026-11-07-ai-prompt-contracts-verification.json). All 34 original measurement artifacts and 35 format-v3 artifacts remain unchanged, and the old source-bound resume is rejected without provider calls. Added accounting is $0.013182537; combined known accounting is $0.191050683 (estimates/reservations, not billing). The shared lock is released. No database evaluation was recorded, order accepted or Phase 9 feature activated. The next Phase 8 work must address candidate quality/current evidence; full qualification and owner approval still precede recording/promotion. OD-18 and deferred retrieval remain separate.

## Phase 8 diagnostic capture and layout investigation — 2026-11-07

Added output-free layout comparisons to analysis diagnostics and integrated reason/count capture into future full DeepInfra campaigns. It uses each existing response once, stores case-keyed metadata in source-bound checkpoints and adds diagnostic summaries to tier JSON reports. Official scores, proposals and stored measurements never use comparison passes. Resume validates fixed keys/counts, case/verdict association and answered status; malformed metadata fails with a fixed message that does not echo arbitrary field names. The helper is included in the coordinator fingerprint.

The current 420-case fake-provider full-queue test captures diagnostics for all 30 analysis and 20 document answers, rejects unsafe metadata and resumes without new requests or checkpoint rewrites. Three live analysis probes answered but failed every authoritative and layout-comparison check. This does not support the tested presentation hypothesis for these samples; no rubric/prompt change or further full live campaign was made. [Implementation and observations](docs/audits/2026-11-07-ai-diagnostic-capture.md), [verification JSON](docs/audits/2026-11-07-ai-diagnostic-capture-verification.json).

All 34 original measurement artifacts, 35 format-v3 artifacts and five prior diagnostic/verification JSON artifacts remain unchanged. Added accounting is $0.000800277; combined known accounting is $0.191850960 (estimates/reservations, not billing). The shared lock is released. Production recording and order acceptance remain pending owner approval, and Phase 8 qualification remains unresolved.

## Phase 8 additional Qwen candidate campaign — 2026-11-07

The GPT-OSS/smaller-vision candidates remained unqualified after the prompt clarification and layout investigation. Selected two catalogue-confirmed, non-Google/non-Anthropic DeepInfra candidates for a fresh finite plan: `Qwen/Qwen3-235B-A22B-Instruct-2507` independently in Tiers 1–3 and `Qwen/Qwen3-VL-235B-A22B-Instruct` in Tier 4. Added declarations and evaluation entries only; default routing orders stay unchanged and streaming is conservatively unmeasured/unavailable. Campaign provenance now prevents report overwrite when a changed model plan shares no checkpoint names with an old campaign.

**All 17 entries / 420 cases completed: 419 answers and one document timeout.** Text schema is 100%; aggregate tools are 48/57 (84.21%) per tier. Strict analysis is 2/15 in both advanced tiers. Vision schema is 19/19, with exact extraction 14/20 attempted. No tier is proposed or recommended for acceptance. A single failed Tier 2 analysis case passes the experimental combined-layout check; it remains failed and supplies no routing evidence. [Approval report](eval/reports/deepinfra-2026-11-07-qwen-235b-v1/README.md), [decision JSON](eval/reports/deepinfra-2026-11-07-qwen-235b-v1/approval.json), [verification](eval/reports/deepinfra-2026-11-07-qwen-235b-v1/verification.json).

**Verification:** 2,120 unit tests, typecheck, lint, production build, client-secret scan and whitespace checks pass. Offline source-bound validation makes no requests; all 17 checkpoint hashes and the usage hash are unchanged. Diagnostics cover all 49 answered analysis/document cases without response retention. All older measurement/diagnostic artifacts remain intact. No failures were retried, evaluation rows recorded, production orders changed or live Phase 9 generation activated.

Campaign accounting is $0.135406220; workspace campaign/diagnostic accounting totals $0.327257180. On inspecting the independent Claude batch in PR #50, reserved an additional $1 (reported cost under $1, exact ledger absent here). The existing spend scanner now includes that reservation automatically, bringing cap accounting to $1.327257180. This is not a billed amount, charge, request or asserted credit balance; no measurement is imported. The shared $4.50 ceiling remains unchanged and the account lock is released. Scenario/OD-18 and deferred retrieval remain separate.

## Working protocol — applies to every phase from 2 onward

Approved by the user on 2026-08-09. The architecture documents in `docs/` are the **implementation baseline**.

Before implementing any phase:

1. Read the relevant architecture documentation.
2. Inspect the existing implementation.
3. Identify dependencies on existing code.
4. Implement **only the current phase**.
5. Test it.
6. Fix failures.
7. Verify the actual workflow.
8. Update documentation **only when implementation materially changes the architecture**.

**Do not silently redesign major architecture during implementation.** If a major architectural problem is discovered: **stop before making the change**, explain the issue and the proposed correction, and wait.

Corollaries that follow from the above:
- No scope creep into a later phase, even when it looks cheap.
- No new runtime dependency without a justification line ([ARCHITECTURE.md §3](docs/ARCHITECTURE.md)).
- A phase is complete only when every box in its `ROADMAP.md` "Done when" list is ticked — including typecheck, lint, and a passing production build.
- Documentation edits during implementation should be corrections and additions, not redesigns. A redesign is a stop-and-explain event.

---

## What exists

| | |
|---|---|
| `docs/` | 14 documents — the approved architecture baseline, plus three **non-normative review records** ([INVESTMENT-ENGINE-DESIGN.md](docs/INVESTMENT-ENGINE-DESIGN.md), [NET-WORTH-DESIGN.md](docs/NET-WORTH-DESIGN.md), [MARKET-DATA-DESIGN.md](docs/MARKET-DATA-DESIGN.md)). |
| `CLAUDE.md` / `AGENTS.md` | The specification. Byte-identical duplicates (see OD-2). |
| `Workflow Setup.txt` | Canonical 15-phase map ([ADR-20](docs/DECISIONS.md)) |
| Application code | **Phases 2–5.** Next.js 16, exact-money primitives, database, auth, app shell; the money core (accounts, categories, tags, transactions, transfers, budgets, recurring rules, the job runner and the Money UI); the investment engine (instruments, the investment ledger, the FIFO lot engine, positions, valuation, allocation, XIRR/TWR and the Investments UI); and **Net Worth at Cost** (manual assets, liabilities, the contributions map, date-driven as-of aggregation, reconciliation, the change bridge and the Net Worth UI). |
| Git repository | Initialised, `core.autocrlf=input`. Phases 2–5 are committed on `claude/net-worth-architecture-review-7b1dc5`, which carries the Phase 5 design review, its correction pass, and the Phase 5 implementation. |

## Phases

| Phase | Status |
|---|---|
| 0 — Environment & Repository | ✅ complete |
| 1 — Architecture | ✅ complete, **approved** |
| 2 — Foundation | ✅ complete, verified |
| 3 — Financial Core | ✅ complete, verified |
| 4 — Investment Engine | ✅ complete, verified |
| 5 — Net Worth at Cost | ✅ **complete, verified** |
| 6 — Market Data | ✅ **complete, verified.** 6.0–6.9 and **6.11** implemented; **6.10 closed — not built** (OD-15). No open decision remains |
| 6.5 — Recovery (Oct 2026) | ✅ repository rebuilt from the failed drives and published to GitHub — [docs/RECOVERY-2026-10.md](docs/RECOVERY-2026-10.md) |
| 7 — AI Infrastructure | ✅ **complete, 2026-10-26.** 7.0–7.7 built; the Phase 8 entry-gate blockers closed (PRs #5–#12, #14) |
| 8 — Model Evaluation | **in progress** since 2026-10-31: `parse`, `classify`, `tool-select`, `routing`, `grounding`, `injection` and `robustness` merged; `document` built in PR #26 and `analysis` built in PR #27. `scenario` is blocked by OD-18. Runner/storage and suite integration PRs #24–#28 are merged; two complete Tier 4 runs are recorded in reports, with no accepted routing change — see [Phase 8 log](#phase-8-log) |
| 9–14 | not started |

---

## Local environment — how to run it

| | |
|---|---|
| PostgreSQL | **18.4**, installed at `C:\Program Files\PostgreSQL\18`, data at `C:\Program Files\PostgreSQL\18\data`. |
| Service | **`postgresql-x64-18`**, start type `Automatic`, running as `NT AUTHORITY\NetworkService`. **Starts with Windows.** Nothing in this project starts or stops it. |
| Start / stop | `Start-Service postgresql-x64-18` / `Stop-Service postgresql-x64-18` from an elevated shell. Ordinarily neither is needed. |
| Databases | `financeos` (development), `financeos_test` (integration tests, truncated between test files) |
| Roles | `financeos_migrator` owns the schema and is the only role with DDL. `financeos_app` has DML only, INSERT/SELECT on `audit_log`, SELECT on `currencies`. |
| Credentials | Development-only, in `.env` (git-ignored). Regenerate for production. |

Also installed by the PostgreSQL 18 installer and **not used by this application**: `pgagent-pg18`, and PgBouncer on port 6432. The application connects directly to 5432 — connection pooling is deferred until there is a measured need ([ARCHITECTURE.md §10](docs/ARCHITECTURE.md)).

```
npm run db:migrate            # apply migrations + re-apply grants
npm run db:seed               # idempotent reference data + default categories
npm run db:rollback           # reverse the newest migration
npm run auth:create-user -- --email you@example.com     # password in FOS_PASSWORD
npm run verify:integrity      # check the financial invariants against real data
npm run bench:networth        # the Phase 6.11 performance measurement, repeated
npm run jobs:run              # drain the job queue once (cron drives this)
npm run dev | build | start
npm test                      # unit + property + integration
```

**The database needs no babysitting.** It runs under the Windows Service Control
Manager (`postgres.exe ← pg_ctl.exe ← services.exe ← wininit.exe`), so it is not
in any shell's process tree and survives a terminal closing, a tool teardown and
a reboot alike. During Phase 3 the database was a portable instance started by
hand; it was repeatedly killed by console-close events mid-test-run, and a
`db:ensure` script existed to resurrect it. Both the script and the problem are
gone — see **D-23**.

There is **no signup page**. The account is provisioned from the host, which makes login the only unauthenticated endpoint in the application.

---

## What Phase 2 delivered

| Area | Where |
|---|---|
| Exact money | `src/lib/decimal/` — `Money` (bigint, scale 4), `Quantity` (8), `Rate` (10), four rounding modes, `allocate` |
| Calendar dates | `src/lib/date/` — ISO strings, not `Date`; leap years, month clamping, epoch-day arithmetic |
| Environment | `src/lib/env.ts` — Zod-validated, fails fast, one place `process.env` is read (enforced by lint) |
| Errors | `src/lib/result.ts` — `Result<T, DomainError>`; `app/error.tsx` shows a correlation ID, never a stack trace |
| Logging | `src/server/log.ts` — structured JSON with a redaction pass that removes credentials **and financial figures** by field name |
| Database | `src/server/db/` — 9 tables, 3 enums, one checked-in migration, hand-written down migration, idempotent seed, least-privilege grants |
| Authentication | `src/server/auth/` — Argon2id (128 MiB, measured 337 ms), mandatory TOTP, 10 recovery codes, opaque sessions stored as SHA-256, lockout, rate limiting |
| App shell | `app/` — six areas, responsive sidebar/bottom nav, honest empty states, nonce-based CSP in `proxy.ts` |
| Tests | 282 across unit / property / integration; CI in `.github/workflows/ci.yml` |

### Decisions taken during implementation

Each is reversible; the reasoning is recorded so it can be challenged.

| # | Decision | Why |
|---|---|---|
| **D-9** | ~~Portable PostgreSQL 17 rather than Docker Desktop~~ — **superseded by D-23** | Was D-4's documented fallback, chosen because it needed no admin rights, no reboot and no hypervisor. It worked, but a postmaster with no service manager behind it is killed whenever the console that started it closes. Kept here rather than deleted, because the reasoning explains why the project ran on a portable instance for its first two phases. |
| **D-10** | Two database roles from day one | SECURITY.md §2 requires it in production; doing it in development means a missing grant fails a test rather than a deploy. Integration tests run as the application role. |
| **D-11** | Auth rate limits derived from `auth_events` | SECURITY.md §6 requires Postgres-backed limits. Every attempt already writes a row, so counting rows in a window needs no new table and cannot drift from the audit trail. |
| **D-12** | Account provisioning by CLI, no signup route | Single-user application. A registration endpoint would be an unauthenticated write path existing only to be attacked. |
| **D-13** | Hand-written down migrations + `db:rollback` | drizzle-kit generates forward migrations only, and ROADMAP Phase 2 requires clean rollback. A schema-fingerprint test asserts migrate → rollback → migrate is identical. |
| **D-14** | `SESSION_COOKIE_SECRET` signs the TOTP challenge cookie | SECURITY.md §3 lists the secret but §1's design never consumes it. The half-finished login between the password and TOTP steps needed exactly one signed, short-lived carrier. The session cookie remains an unsigned opaque token whose SHA-256 is stored, per §1. |
| **D-15** | Argon2id at 128 MiB / 3 passes | Measured, not copied: 64 MiB gave 158 ms against SECURITY.md §1's ≥250 ms floor. The table of measurements is in `src/server/auth/password.ts`. Memory was raised rather than passes, because memory hardness is what degrades GPU attacks. |
| **D-16** | Decimal input rejects malformed digit grouping | `1,5` means one and a half in much of Europe. Stripping commas blindly would read it as fifteen — a tenfold error entered silently. Both Indian and Western grouping are accepted; anything else is rejected. |

---

## What Phase 3 delivered

| Area | Where |
|---|---|
| Schema | `src/server/db/schema/money.ts` — 9 tables, 7 enums, migration `0001`, hand-written down migration |
| Shape triggers | `check_transaction_shape()` (deferred constraint trigger, I-1/I-2/I-3) and `check_category_shape()` (two levels, matching kind) |
| Engine | `src/server/domain/` — `buildEntries`, `assertEntryInvariants`, `deriveBalance`, cash flow, budget status, category rollup, FX selection, the one `ratio()` |
| Recurrence | `src/lib/date/rrule.ts` — RFC 5545 subset, with month-end **clamping** rather than skipping |
| Periods | `src/lib/date/periods.ts` — monthly, fiscal-aligned quarters, fiscal years |
| Services | `src/server/services/` — accounts, categories, tags, transactions, transfers, budgets, recurring, cash flow, reference; `ReadCtx`/`WriteCtx` as the write boundary |
| Jobs | `src/server/jobs/` — `FOR UPDATE SKIP LOCKED` runner + `recurring.post` |
| Formatting | `src/lib/format/` — exact digit grouping, Indian and Western, no float in the path |
| Integrity | `src/server/db/integrity.ts` + `npm run verify:integrity` — I-1…I-4, I-9, I-11 checked; the rest reported as not yet applicable |
| UI | `app/(app)/money/` — hub, accounts + ledger, transactions with filters, categories, budgets, recurring |
| Tests | 663 across unit / property / integration, including golden scenario **G1** |

### Decisions taken during implementation

| # | Decision | Why |
|---|---|---|
| **D-17** | `transactions.ai_proposal_id` and `recurring_occurrences.investment_transaction_id` deferred | Both are foreign keys to tables that do not exist until Phases 7 and 4. Adding the column early would ship half of an unreviewed phase. |
| **D-18** | Cash-flow totals are summed in the engine over fetched rows, not in SQL | The headline figure and every breakdown are then the same sum over the same array, so a category total that disagreed with the expense total would be arithmetically impossible rather than merely unlikely. Escape hatch if it ever gets slow: a roll-up keyed by `money_ledger_version`. |
| **D-19** | `MetricUnavailable` gained `out_of_range` | A property test produced a savings rate too large for `NUMERIC(20,10)` — ₹0.0001 of income against real spending. The previous code threw a `RangeError` out of a page render. Clamping was rejected: a clamped ratio is a wrong number that looks right. |
| **D-20** | The default expense category is **Business expenses**, not Business | `UNIQUE (user_id, parent_id, name)` does not include `kind`, so a top-level income *Business* and expense *Business* cannot coexist; `ON CONFLICT DO NOTHING` silently dropped one. Renamed rather than widening a reviewed constraint. `seedDefaultCategories` now refuses a list with duplicate top-level names. |
| **D-21** | `postOccurrence` claims and posts inside a **savepoint** | Returning an error from an open transaction does not undo the writes already in it. Without the savepoint a failed posting left the occurrence marked `posted` with no transaction — I-9 violated and a commitment silently never paid. Caught by an integration test. |
| **D-22** | `db:seed` tops up default categories for existing users | The account provisioned in Phase 2 had none, which left the money pages with no category to offer. Idempotent, so an account that already has them is untouched. |

### Decision taken after Phase 3

| # | Decision | Why |
|---|---|---|
| **D-23** | **PostgreSQL 18.4 as a Windows service, replacing the portable 17.7 (supersedes D-9)** | A postmaster started by hand belongs to the process tree of whatever started it, and dies with that console. It happened four times during Phase 3, each time looking like a test failure rather than an environment failure, and each recovery cost a manual restart. A service is owned by the Service Control Manager, starts with Windows, and cannot be reaped by a terminal closing. The migration was a logical dump and restore — verified metric-by-metric against the source, with roles, grants, schema, Drizzle history and data all preserved — so no connection string in `.env` changed. The 17.7 data directory is retained as a rollback until the new instance has some mileage. |

---

## What Phase 4 delivered

| Area | Where |
|---|---|
| Primitive | `src/lib/decimal/price.ts` — `UnitPrice` at scale 8, `valueOf` / `perUnit` / `mulQtyRatio`. `Money` is scale 4 and truncates a NAV at the read boundary. |
| Schema | `src/server/db/schema/investments.ts` — 7 tables, 3 enums, migration `0002`, hand-written down migration. Purely additive; no destructive statement. |
| Lot engine | `src/server/domain/lots/` — `replay()`, the FIFO `MatchingStrategy` (ADR-07's one seam), `kind_rank` ordering |
| Pricing | `src/server/domain/pricing/` — `PriceResult`, valuation with coverage, allocation across five dimensions, concentration with HHI |
| Metrics | `src/server/domain/calc/` — `portfolio.ts` (two denominators), `xirr.ts` (Newton + bisection), `twr.ts` (Modified Dietz, chain-linked) |
| Services | `src/server/services/` — instruments, investments, positions, portfolio, prices. Rebuild shares the mutation's transaction. |
| Integrity | I-5, I-6, I-7, I-12, I-13, I-15…I-20 added to `verify:integrity`; 21 checked, 3 deferred, both non-invariants deliberately unasserted |
| UI | `app/(app)/investments/` — overview, holdings, instrument detail with lots, ledger, allocation, performance, instruments |
| Tests | **249 added** — 150 unit, 13 property, 86 integration — taking the suite from 663 to **912**. Includes golden **G2** and **L1**. |

### Phase 4 final verification — 2026-08-11

The results the completion gate actually produced, not a summary of intent.

| Gate | Result |
|---|---|
| Unit | **549 passed** |
| Property | **47 passed** |
| Integration | **316 passed** |
| **Total** | **912 passed**, 0 failed |
| Typecheck (`tsc --noEmit`, strict) | clean |
| Lint (`eslint .`) | clean |
| Production build (`next build`) | clean |
| Migration apply → rollback → re-apply | **byte-identical schema fingerprint** — columns, constraints, triggers and functions |
| `verify:integrity` | **21 passing, 0 failing, 3 deferred** |
| Live browser workflow | **passed** — sign-in, instrument creation through the server action, a seeded ledger, and every Investments page rendering its hand-verified figures |

**Every Phase 3 financial test continues to pass.** Three Phase 3 test files changed, and in each case only because a phase-boundary expectation was **superseded by Phase 4** — none was weakened, and no assertion about a financial calculation was altered:

| File | What was superseded |
|---|---|
| `tests/integration/integrity.test.ts` | Asserted I-5, I-6, I-7 and I-12 were reported `skipped`. Phase 4 implements the tables they describe, so they are now checked. The test now asserts the opposite, plus that neither declared non-invariant is asserted. |
| `tests/integration/schema.test.ts` | Asserted `instruments`, `positions` and `tax_lots` did **not** exist. Phase 4 creates them; the guard now points at the Phase 5 and Phase 9 tables instead. |
| `tests/integration/migrations.test.ts` | Its `MIGRATIONS` list ended at `0001`. It now includes `0002`, so the rollback/re-apply fingerprint covers Phase 4 — including the first `ALTER TABLE … DROP COLUMN` in a down migration. |

`verify:integrity` checks **I-1, I-2, I-2b, I-3, I-4, I-4b, I-5, I-6, I-7, I-9, I-9b, I-11, I-11b, I-12, I-13, I-15, I-16, I-17, I-18, I-19, I-20**. I-6 is asserted **exactly, with no tolerance**. Three remain deferred and are reported as `skipped` rather than silently omitted: **I-8** (Phase 5), **I-10** and **I-14** (Phase 9).

### Decisions taken during implementation

Each was forced by a test rather than found by reading. Full rationale in [ROADMAP.md](docs/ROADMAP.md) Phase 4.

| # | Decision | Why |
|---|---|---|
| **D-24** | Partial cost consumption uses **flooring**, not `half_up` | [INVESTMENT-DOMAIN.md §4](docs/INVESTMENT-DOMAIN.md)'s pseudocode says `half_up`; its own prose says the residue is *retained*. Only `floor` does both, and only `floor` preserves **I-19** — a database `CHECK`. A lot with ₹0.0001 of basis over 10 units, selling 6, drains to zero basis with units remaining under `half_up`, and the row is rejected mid-rebuild. Found by a property test. No documented figure changes: every worked example divides exactly. |
| **D-25** | Three new database `CHECK` constraints | `inv_txn_acquisition_has_cost` (a purchase whose total rounds to zero would open a lot with units and no basis, failing I-19 mid-rebuild), `inv_txn_original_acquired_not_in_future` (would make `holding_days` negative and surface against `lot_disposals` rather than the row at fault), and `positions_units_and_basis_agree`. |
| **D-26** | `withWriteCtxResult` — atomic rollback for a command that returns an error | Returning an error from inside an open transaction does not undo the writes already in it. An investment mutation inserts its row and bumps `investment_ledger_version` **before** the rebuild can discover an oversell, so edge case 30 was unreachable without this. Generalises Phase 3's D-21 savepoint into the write boundary itself. |
| **D-27** | `ProportionBar` — static width classes instead of inline `style={{ width }}` | The CSP in `proxy.ts` sets `style-src 'self' 'nonce-…'`, which governs style **attributes**. The bars rendered at zero width in every browser with only a console violation to show for it. Phase 3's budget bar shared the defect; both now use `ProportionBar`. |

### Phase 4 scope boundaries and known limitations

Each of these is an **intentional roadmap boundary**, not a defect.

| Limitation | Where it is settled |
|---|---|
| **TWR returns `null` with reason `insufficient_price_history`** for every instrument. `instrument_prices` is empty because it is populated by `getHistoricalPrices()`, which needs the provider blocked on **OD-3**. The algorithm, its Modified Dietz form and its boundary convention are implemented and pinned by a test asserting both the correct figure and the figure the opposite convention would give. | [INVESTMENT-DOMAIN.md §8](docs/INVESTMENT-DOMAIN.md#8-time-weighted-return) |
| **No `MarketDataProvider` registry.** The `PriceResult` union and the staleness classification exist — they are the contract every future adapter returns — but nothing resolves an instrument to a provider. | Phase 6 |
| **No market-data adapters.** No AMFI, no FX, no commercial equity source. Prices are entered by hand into `instrument_quotes` through `setManualPrice`. | Phase 6, gated on OD-3 |
| **No `prices.refresh` job** and no scheduled price fetching. A read never triggers a network call, and there is no network call to trigger. | Phase 6 |
| **AI functionality is outside Phase 4 entirely.** No orchestrator, no tools, no proposals. Every investment figure is produced by `src/server/domain/`, which is what will make an AI answer unable to disagree with a screen when Phase 7 arrives. | Phases 7–9 |
| **`ai_proposal_id` is absent from `investment_transactions`**, following the precedent D-17 set on `transactions.ai_proposal_id`. Phase 7 adds both columns with their foreign keys and the partial unique index invariant **I-14** needs. | Phase 7 |
| **I-8 deferred to Phase 5; I-10 and I-14 deferred to Phase 9.** Reported by `verify:integrity` as `skipped` with the phase named. | [SCHEMA.md §12](docs/SCHEMA.md#12-invariants-summary) |
| **Unrealised FX is not separated** from unrealised price movement. `marketValue` uses the current rate while `investedCapital` uses acquisition rates, so `unrealizedPnl` legitimately contains both. Realised P&L **is** decomposed (I-18). | [INVESTMENT-DOMAIN.md §6.4](docs/INVESTMENT-DOMAIN.md#64-foreign-currency-positions) |
| **`average` and `specific_id` cost-basis methods are interface-only.** `strategyFor` rejects them rather than silently falling back to FIFO. | [ADR-07](docs/DECISIONS.md), [INVESTMENT-DOMAIN.md §4](docs/INVESTMENT-DOMAIN.md#4-cost-basis-engine-default-fifo) |
| **Recurring SIPs are not wired.** `recurring_occurrences.investment_transaction_id` and its foreign key exist; the `investment` recurring kind is still refused by the service layer, exactly as in Phase 3. | Not yet scheduled |

**One consequence of ADR-22 is documented but not yet implemented.** The decision requires the UI to make clear that displayed balances are **trade-dated rather than settlement-dated**; no screen says so today. The engine behaviour is already correct and needs no change — this is a copy addition on the surfaces that show a balance derived from the investment ledger (the accounts list, the account ledger, and the investment ledger's cash column). Recorded here rather than done as part of the OD-6 resolution, because resolving a decision is a documentation act and this is a UI change; it should be picked up by the next piece of work that touches those screens.

---

## Documentation correction pass — 2026-08-11

The Phase 4 design review found 15 defects (D1–D15) in the approved baseline. Under **OD-4** they were applied to the canonical documents; under **OD-5** the `net_amount` currency question was settled. No application code or schema changed.

| Document | What changed |
|---|---|
| `docs/INVESTMENT-DOMAIN.md` | Lot model (`cost_total` / `remaining_cost`, `cost_per_unit` derived); corrected FIFO engine (allocate, exact drain, gross income, zero-P&L transfers); `kind_rank` ordering; new §2.1 currency, §6.2 account-level charges, §6.3 worked verification, §6.4 FX decomposition; `UnitPrice`; XIRR scope; TWR boundary + OD-3 limit; edge cases 21–31 |
| `docs/SCHEMA.md` | `tax_lots` and `lot_disposals` DDL rewritten; 8 new `CHECK` constraints; 5 new indexes; `lot_disposals.user_id`; invariants I-15…I-20; two explicit non-invariants; OD-5 currency rules; forward-reference migration policy |
| `docs/FINANCIAL-DOMAIN.md` | Balance formula's currency contract (OD-5); account currency immutability; `UnitPrice` in §1; `allocate` rule made normative for the lot engine; investment module map |
| `docs/TESTING.md` | I-6 asserted exactly, tolerance removed; `UnitPrice` tests; order-independence property; DB-level constraint tests; XIRR scope and TWR boundary tests; golden **L1**; G2/G3 extended |
| `docs/ARCHITECTURE.md` | §6 rebuild trigger corrected — `positions.ledger_version` is a provenance stamp, not a staleness check; invariant count |
| `docs/DECISIONS.md` | ADR-06 (rebuild transaction + stamp), ADR-07 (I-6 restatement), ADR-12 (OD-5) |
| `docs/ROADMAP.md` | Phase 3 gains the five carried amendments and two gates; Phase 4 gains `UnitPrice`, the new edge cases and invariants, and its Phase 3 block |

**Verification run after the pass:** 154 anchored cross-document links and 67 plain file links all resolve; invariants I-1…I-20 are each defined once in `SCHEMA.md` §12 and referenced consistently; no stale `cost_per_unit`-as-column, `± 1 minor unit`, `(trade_date, created_at, id)` or `income += net` remains in a normative position. A seven-lens consistency audit with adversarial verification then ran across all nine documents.

### Corrections the audit forced — beyond D1–D15

| | Defect | Fix |
|---|---|---|
| **Blocking** | Applying OD-5 naively broke every per-kind cash identity. `net_amount = gross_amount − fees − taxes` equates an **account-currency** column with an **instrument-currency** expression — false for any foreign-currency row, so a USD dividend paid into an INR account would have been **rejected by the database**. Golden scenario `G3` asserts exactly that case | The cash effect is carried at three `CHECK`ed denominations: `net_amount_instrument` (where the identities hold) → `net_amount` (what `deriveBalance()` sums) → `base_net_amount`. Extends `transaction_entries`' ADR-12 pattern by one link |
| High | `positions.fees_total` / `taxes_total` accrued instrument-currency `fees` from dividends and account-currency `\|net_amount\|` from standalone `fee` rows — two currencies in one column | All `positions` totals are instrument currency; standalone rows accrue `\|net_amount_instrument\|` |
| High | `ARCHITECTURE.md` §5's read-path diagram still rebuilt positions "if version changed", which §6 of the same file forbids | Read path reads the cache as-is; rebuilds happen only in the write transaction |
| High | `FINANCIAL-DOMAIN.md` §10.1 still fixed replay order at `(date, created_at, id)`, omitting `kind_rank`, while explicitly naming the lot engine | Restated, with why `created_at` orders rows but not economic events |
| High | `PortfolioSummary` mixed base-currency `realizedPnl` with instrument-currency `investedCapital` | Every `PortfolioSummary` field is base currency; `HoldingView` stays instrument currency |
| High | *(pre-existing)* Net worth filtered accounts and assets on the current-state `is_active` flag inside an `asOf` calculation — an account closed today vanished from last year's figure, contradicting §12 edge case 7 | Every filter is date-driven; `manual_assets` gains `disposed_on` |
| Medium | `CLAUDE.md` requires "portfolio growth" with no canonical source defined | New [INVESTMENT-DOMAIN.md §8.1](docs/INVESTMENT-DOMAIN.md) — derived, one SQL pass, gaps shown as gaps |
| Medium | `ROADMAP.md` Phase 6 said "all ten invariants"; `PROJECT-STATE.md` said "14 invariants" and "no commit yet" | Corrected to twenty and to the actual history |

**One new rule decided during the pass:** a `transfer_in` / `transfer_out` carries **no fees or taxes** (`CHECK`), because a fee on a transfer-in contradicts "no cash effect", and one on a transfer-out has no basis to capitalise into and no realised P&L to reduce — it would vanish from total return. Demat transfer charges are a separate `fee` row.

---

## What Phase 5 delivered

| Area | Where |
|---|---|
| Schema | `src/server/db/schema/networth.ts` — 4 tables, 2 enums, migration `0003`, hand-written down migration. **Purely additive**: no `DROP`, no `ALTER` on any Phase 3/4 table |
| Domain | `src/server/domain/networth/` — `keys.ts` (source identity + the duplicate-rejecting contributions map), `eligibility.ts` (one date predicate per rule), `compose.ts`, `bridge.ts`, `reconcile.ts` |
| Ledger correction | `src/server/domain/ledger/balance.ts` — `accountRole()` now classifies by **sign** via one shared `sideOfAmount()`; `openingContribution()` and `existedAt()` gate the opening balance by `opening_date` |
| Services | `assets.ts` and `liabilities.ts` (the only writers) and a **read-only** `networth.ts` with no `WriteCtx` in any signature |
| Integrity | I-8, I-24, I-27, I-28, I-32 checked against real rows; I-21, I-22, I-23, I-25, I-26, I-29, I-30, I-31 reported as `engine` with the file and test that enforce each |
| UI | `app/(app)/net-worth/` — the figure, both sides grouped and drillable, history, the change waterfall, and assets/liabilities CRUD |
| Tests | **137 added** — 51 unit, 9 property, 77 integration — taking the suite from 912 to **1,049**. Includes golden **G4** and the two browser-found regressions |

### Phase 5 final verification — 2026-08-15

| Gate | Result |
|---|---|
| Unit | **617 passed** |
| Property | **56 passed** |
| Integration | **376 passed** |
| **Total** | **1,049 passed**, 0 failed |
| Typecheck (`tsc --noEmit`, strict) | clean |
| Lint (`eslint .`) | clean |
| Production build (`next build`) | clean — 25 routes, 5 of them net worth |
| Migration apply → rollback → re-apply | **byte-identical schema fingerprint**, now covering `0003` |
| Migration inspected before applying | no `DROP`, no `TRUNCATE`, no `ALTER` on a pre-existing table; every `ALTER TABLE` targets a table the same migration creates |
| Existing data preserved | row counts identical across all 25 pre-existing tables before and after |
| `verify:integrity` | **27 passing, 0 failing, 8 engine-enforced, 2 deferred** |
| Every Phase 3 and Phase 4 test | still passing |
| **Signed-in browser verification** | **passed** — see the table above |
| Net Worth routes unauthenticated | all five `307` to `/login?next=…` |
| Dev-server compile | no errors on any net-worth route |

**Golden scenario G4** — a home loan with EMIs, a credit card carrying a balance, and a car loan closed mid-period — passes with `unexplained` **exactly `0.0000`**.

### Phase 5 signed-in browser verification — 2026-08-17

Performed against the development account (`dev@example.local`, provisioned by
`npm run dev:login` — see *Development sign-in* below), signed in through the
**real** password → TOTP → session flow. A demo dataset was seeded through the
application services so the figures below are hand-checkable.

| Checked | Result |
|---|---|
| `/net-worth` renders signed in | ✅ headline ₹75,90,000 = assets ₹99,35,000 − liabilities ₹23,45,000, matching the hand-computed figure |
| Labelled **Net Worth at Cost** | ✅ page title, headline label, and the basis banner |
| Asset breakdown | ✅ grouped: Cash and bank, Other assets, Brokerage cash, Investments (at cost), Property — each row drillable |
| Liability breakdown | ✅ Credit cards, Loans, with per-row detail |
| Reconciliation | ✅ *"Reconciled: 8 sources, checked by a second independent sum"* |
| Drill-down | ✅ Net worth → Zerodha ledger: opening ₹1,00,000, buy −₹60,000, balance ₹40,000 — the single-counting story end to end |
| Historical / as-of | ✅ 12 month-ends; 2025 rows show only the 2024-opened account, every 2026-opened account absent |
| Currency formatting | ✅ Indian digit grouping throughout (₹99,35,000.00), `en-IN` |
| **No double counting** | ✅ brokerage cash ₹40,000 + INFY basis ₹60,000 = the ₹1,00,000 it started with, not ₹1,60,000 |
| **Overpaid credit card** | ✅ Amex at `+₹5,000` under **assets** — not zero, not a liability |
| Closed account historically | ✅ "Old savings", closed, still contributes ₹30,000 at every date from its opening |
| **Opening balances obey `opening_date`** | ✅ an account dated 1 Dec 2026 contributes nothing today, and ₹50,000 from that date |
| Trade-dated wording (ADR-22) | ✅ present on the net-worth page beneath the balances it qualifies |
| Change bridge | ✅ Jan→Jun: −₹40,000 savings + ₹6,00,000 revaluation + ₹2,00,000 liability change = ₹7,60,000 delta, **Unexplained ₹0.00** |
| Unrealised gain line | ✅ renders as `—` with *"not measured — at cost"*, never as ₹0 |
| Append-only proof | ✅ recording a valuation dated 1 Aug moved **today** to ₹76,90,000 and left 30 Jun and 31 Jul unchanged at ₹75,90,000 |
| Empty state | ✅ before seeding: ₹0.00, "Nothing on this side", full coverage — no fabricated figures |
| Error state | ✅ a duplicate-dated valuation is refused with a domain sentence, not a stack trace |
| Success state | ✅ *"Valuation recorded. Earlier figures are unchanged."*, page revalidated immediately |
| Console / runtime errors | ✅ none in the **production** build; the dev server's CSP inline-style noise is Turbopack's HMR client (measured, see known debt) |
| Mobile at 375 px | ✅ no horizontal overflow on any of the five net-worth routes |
| Redirects after auth | ✅ none; every route returns 200 signed in, and 307 to `/login?next=…` signed out |
| Phase 3 Money pages | ✅ accounts list, balances, available credit, closed-account flag all correct |
| Phase 4 Investments pages | ✅ INFY 600 @ ₹100, invested ₹60,000; unpriced → market value, unrealised and return all `—` with a coverage note, never `0` |

**Two defects found and fixed**, both surfaced only by looking at rendered pages:

| | Defect | Fix | Regression test |
|---|---|---|---|
| 1 | An **overpaid credit card was grouped under "Cash and bank"**. The figure and the side were right (ADR-25), but a receivable from a card issuer filed beside a current account reads as spendable money | `accountGroup()` classifies on side first: a `credit_card`/`loan` in credit is **Other assets** | 4 cases in `networth.test.ts` covering card-in-credit, loan-in-credit, card-in-debit and an overdrawn bank account |
| 2 | A **future-dated account reported its opening balance as money held today** on the accounts page, while net worth correctly excluded it — two screens, one account, two figures. `FINANCIAL-DOMAIN.md` §3 says the default bound is *today*, not "unbounded"; the gate treated it as unbounded | `toView` gates the opening balance by `asOf ?? ctx.today` | asserts the account read **and** net worth both report `0` today, and both report ₹50,000 from the opening date |

Neither changed a total that was already correct: the first moved a row between display groups, the second removed a figure that should never have been shown.

### Decisions taken during implementation

| # | Decision | Why |
|---|---|---|
| **D-28** | `AccountRole` gains a third member, `'none'` | ADR-25 classifies by sign, and a zero balance genuinely sits on neither side. Folding it into `'asset'` would have put a settled credit card under Assets at ₹0; folding it into `'liability'` is the defect ADR-25 exists to remove. One Phase 3 assertion inverted as a result — a repaid card in **G1** — and it is the only Phase 3/4 expectation Phase 5 changed |
| **D-29** | Coverage is a **component-count** ratio in Phase 5, not value-weighted | `FINANCIAL-DOMAIN.md` §9.3 asks for value weighting, but Phase 5's only exclusion cause is a missing FX rate — and a component with no rate has no expressible base value to weight by. `excluded` carries each component's native amount and currency so the magnitude is still visible. Phase 6's price-driven exclusions **are** value-weightable, because cost basis is known in base even when a price is not |
| **D-30** | `verify:integrity` gains two statuses, `engine` and `warning` | Eight net-worth invariants are not expressible as a query, and a SQL approximation of any of them would be a second implementation of net worth living in the checker — free to disagree with the engine. Reporting them with the file and test that enforce each keeps the report a complete account of I-1 … I-32 rather than falling silent. `warning` carries the gold-name heuristic, which a user can legitimately violate |
| **D-31** | The net-worth series is **one fetch, one fold per point** | ADR-24 rules out snapshots, so a 12-point history had to not be 12 computations. `loadSources()` fetches everything once with no date bound; the bound is a pure predicate applied per point. This is also what makes I-29 true by construction rather than by coincidence |
| **D-32** | An unvalued-but-held asset is excluded via an explicit `unvalued` flag | The first cut forced it down the `no_fx_rate` path with a ₹0.0001 sentinel, which put a lie in `excluded[].native`. A separate reason costs one enum member and lets the UI say "held, but not valued by this date" rather than "no exchange rate" |

### Fixed during implementation

Each was found by a test rather than by reading.

1. **`text + text` in the bridge's cost query.** Two `numeric` sums were each cast to `::text` and then added — string concatenation, which Postgres refuses. Summed as numerics and cast once. Caught by every bridge test at once.
2. **A blank optional field arrived as `''`, not `undefined`.** `z.string().trim().max(20).optional().or(z.literal('')…)` never reaches the `.or`, because `''` satisfies the first branch — so `interestRate` on an untouched form failed `Rate.parseUserInput('')` with a required-field error. `.min(1)` before `.optional()` is what makes the fallback reachable.
3. **`eslint.config.mjs` would not load at all — a tooling compatibility fix, retained deliberately.** Since `eslint-config-next@16.3.0` the config object declaring the `react`, `import` and `jsx-a11y` plugins carries a `files` glob; this project's global rules object had none, so it referenced `react/no-danger` for file types where the plugin was out of scope and ESLint refused the whole configuration. **Pre-existing** — it failed identically on the Phase 4 tree — and fixed here because the completion gate requires lint to run. It is a one-line `files` scope matching the upstream glob, changes no rule and disables no check, and is **kept rather than reverted**: without it `npm run lint` cannot execute at all, so the verification gate could not be met. Revisit only if a future `eslint-config-next` drops the glob.

---

## Phase 5 design review — 2026-08-12

**Design and architecture only. Nothing was implemented.** No application code, schema, migration, service, API or UI changed; `0003_phase5_net_worth.sql` does not exist. The output is [docs/NET-WORTH-DESIGN.md](docs/NET-WORTH-DESIGN.md) — a review record with the same standing as `INVESTMENT-ENGINE-DESIGN.md`: **non-normative**, and where it and a canonical document differ, the canonical document wins until OD-9 is approved.

### What it settles

| Area | Conclusion |
|---|---|
| **Single counting** | A structural property of Phase 3/4, not something Phase 5 invents: one `investment_transactions` row debits brokerage cash by exactly what the lot it opens gains, so cash and positions are already disjoint. Phase 5's contribution is to make it *checkable* — a `contributions: Map<SourceKey, Money>` that throws on a duplicate, plus a second-path reconciliation |
| **Account classification** | **By sign, not by kind.** `balance > 0` → asset, `< 0` → liability, `= 0` → neither. Kind decides the display group and the expected sign only |
| **Historical / as-of** | One eligibility table, every row date-driven. `is_active` is read by **no** calculation, on any table — asserted by a source scan, not by review |
| **Investments as of `T`** | Derived from `tax_lots` / `lot_disposals` bounded by `opened_on` / `closed_on` — **not** from `positions`, which is today's cache. Exact for three reasons: splits and bonuses touch no money, FIFO has a prefix property, and I-20 makes the subtraction residue-free |
| **Valuation basis** | `basis ∈ {'cost','market'}`; Phase 5 implements `'cost'` and presents **Net Worth at Cost**, Phase 6 adds `'market'` as a distinct calculation and flips the default. The two are **never mixed inside one figure** |
| **Liabilities** | Two shapes. Transacted (linked account) contributes **nothing** — the account does. Scheduled contributes from an append-only balance series. Interest stays descriptive; no amortisation is computed |
| **Manual assets** | The existing model is sufficient. Valuations are a series, not a field. Four corrections, none of them an expansion |
| **Snapshots** | **Moved to Phase 6.** The history series is five set-based queries, so the performance case disappears — and the cache as specified cannot tell when it is stale (N13). Phase 5 derives everything; no gate depends on a snapshot |
| **Service shape** | `networth.ts` is read-only and exports **no** `WriteCtx` signature. Net Worth introduces no ledger and cannot mutate anything |

### 19 defects found in the baseline — **all applied 2026-08-12**

Recorded as **N1–N19** in [NET-WORTH-DESIGN.md §14](docs/NET-WORTH-DESIGN.md#14-defects-found-in-the-baseline-n1n19), with a per-finding disposition table. None was a live bug — no caller passes `asOf` and the Phase 5 tables do not exist — which is why they survived four completion gates. The three that mattered:

- **N2 (high).** `deriveBalance()` added `opening_balance` unconditionally, so an account opened in 2026 contributed its opening balance to net worth **as of 2020**. The date bound in `entryTotals()` correctly bounds *movements*; an opening position is not a movement. → [ADR-26](docs/DECISIONS.md#adr-26--an-as-of-financial-figure-is-computed-from-dated-facts-only-no-current-state-flag-participates), and the balance formula in [FINANCIAL-DOMAIN.md §3](docs/FINANCIAL-DOMAIN.md#3-accounts) now carries the gate.
- **N6 (high).** §9.3's *"Σ marketValue — priced holdings only"* would have reported investments as **₹0** in the current price-free state, directly contradicting `ROADMAP.md`'s *"net worth is an at-cost figure"* — a contradiction inside the canonical set. → [ADR-23](docs/DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost): a **declared basis**, `cost` in Phase 5, never mixed with market value.
- **N1 (high, and live).** `FINANCIAL-DOMAIN.md` §3 and `src/server/domain/ledger/balance.ts:88` disagreed about an overpaid credit card: §9.3 dropped it from net worth entirely, `accountRole()` reported it as a debt — a ₹10,000 spread on a ₹5,000 balance. → [ADR-25](docs/DECISIONS.md#adr-25--net-worth-classification-is-by-the-economic-sign-of-the-balance-not-by-account-kind): classification by **sign**. **This is the one code change the correction pass implies, and it is Phase 5 implementation work — no source file was touched.**

### Added to the canonical documents, not implemented

**12 new invariants — I-21 … I-32** — plus **I-8 restated**, in [SCHEMA.md §12](docs/SCHEMA.md#12-invariants-summary). The draft `NW-n` labels were folded into the canonical numbering so there is one authoritative scheme; draft `NW-11` was **dissolved**, because N11's correction (dropping the redundant `currency_code`) removes the disagreement it would have policed. Also: six explicit **non-invariants**, 43 adversarial scenarios mapped to named tests, twelve new net-worth edge cases in [FINANCIAL-DOMAIN.md §12](docs/FINANCIAL-DOMAIN.md#12-edge-cases-that-must-be-covered-by-tests), and an entirely additive schema delta ([§15](docs/NET-WORTH-DESIGN.md#15-schema-delta-proposal)).

### Four new ADRs

| | Decision |
|---|---|
| [**ADR-23**](docs/DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost) | Net worth carries a **declared valuation basis**; Phase 5 ships **Net Worth at Cost**; the two bases are never mixed in one figure |
| [**ADR-24**](docs/DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6) | Net worth is **derived on demand**; snapshots deferred to Phase 6, with four rules attached if they are ever built |
| [**ADR-25**](docs/DECISIONS.md#adr-25--net-worth-classification-is-by-the-economic-sign-of-the-balance-not-by-account-kind) | Classification is by the **economic sign** of the balance, not by account kind |
| [**ADR-26**](docs/DECISIONS.md#adr-26--an-as-of-financial-figure-is-computed-from-dated-facts-only-no-current-state-flag-participates) | An `asOf` figure is computed **from dated facts only**; no current-state flag participates |

---

## Development sign-in — local only

There is no signup route and no development bypass in the authentication code.
`src/server/auth/**` is untouched by this: the login flow has no dev flag, no
skipped factor and no back door, so signing in locally exercises the **real**
password → TOTP → session path with real Argon2id verification, the real replay
guard, and the real opaque session cookie.

The second factor is **TOTP**, not SMS or email — a code is *computed* from a
shared secret, so no message provider is involved and none needs stubbing.

```
npm run dev:login            # provision dev@example.local (once), then print a code
npm run dev:login -- --otp   # print a fresh code
```

| | |
|---|---|
| Account | `dev@example.local` — non-personal, `.local` is reserved and cannot resolve. Created **beside** the real account, which is never touched |
| Password | 24 random bytes, generated at provisioning, written to `.dev-credentials.json` (git-ignored, mode 0600). Never printed |
| OTP | `npm run dev:login -- --otp` — the script is an authenticator app for this one account |
| Production guard | Refuses on `NODE_ENV=production`, checked **before** touching the database or filesystem and again after `loadDotEnv`, so a `.env` cannot move the process into production behind the first check. Exits non-zero, writes nothing. Verified |
| Reachability | A `scripts/` entry point: never bundled, never imported by the application, never reachable over HTTP |

**Never create this account on a deployed host.** It exists so a local browser
can exercise the shipped login flow; it has no production counterpart.

---

## Phase 6 — Market Data · scope as planned (historical record)

The next phase. Nothing in it has been built: no provider, no adapter, no
refresh job, no price history, no market-value net worth, no snapshot table or
job.

**Purpose.** Give the investment engine prices. Phase 4 built cost basis,
realised P&L and the lot engine — none of which need a price — and Phase 5 built
net worth on that same at-cost footing. Phase 6 is where a price first enters
the system.

| What it unblocks | Why it is blocked today |
|---|---|
| **Market-value net worth** — `basis: 'market'` as a **distinct** calculation alongside Phase 5's `'cost'`. **The default remains `cost`** ([ADR-32](docs/DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view), superseding ADR-23 on this point); neither basis replaces the other | No price source. A single figure must never mix the two bases |
| **TWR** — returns `null` with `insufficient_price_history` for every instrument | `instrument_prices` is empty; it is populated by `getHistoricalPrices()`, which needs a provider |
| **Portfolio growth series** | Same: the series is only as complete as `instrument_prices`, and gaps render as gaps, never as zeros |
| **Unrealised P&L, portfolio return, market-value allocation** | Not computable without a price; each correctly reports `null` with a reason today |

**Open decision — OD-3, the equity/ETF market-data provider and its terms.** It
gates Phase 6's *completion*, not its start: the `MarketDataProvider` interface,
the registry, the `ManualProvider` and the AMFI adapter (free, official, no key)
can all be built before it is settled. It is a commercial choice about terms, not
an engineering one, and it is **not** resolved here — the canonical documents do
not require it for this checkpoint.

**Carried into Phase 6 from Phase 5, deliberately deferred:**

- `net_worth_snapshots`, the `networth.snapshot` job, and
  `user_state.valuation_version` ([ADR-24](docs/DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6)).
  Phase 5 derives every figure and stores nothing, so the performance case does
  not arise; a market-valued series that joins a price per instrument per date is
  where it might. If introduced, only under ADR-24's four rules — current is
  always derived, a historical point is read only on a full version match, the
  stamp set is completed first, and `verify:integrity` asserts snapshot =
  derivation.
- **Value-weighted coverage.** Phase 5 reports a component-count ratio (D-29),
  because a component with no FX rate has no expressible base value to weight by.
  Phase 6's price-driven exclusions **are** weightable: cost basis is known in
  base even when a price is not.
- **`quantityHeldOn` must apply corporate-action ratios**, not sum `quantity`
  ([INVESTMENT-DOMAIN.md §8.1](docs/INVESTMENT-DOMAIN.md#81-portfolio-growth-over-time)).
  A split carries `quantity IS NULL` and a ratio, so a plain running sum reports
  the pre-split quantity forever. Phase 5 was immune because money is invariant
  under corporate actions; Phase 6's market value is not.

**The Phase 6 basis switch will move net worth for FX reasons alone**, not only
price: the investment block is carried at acquisition rates under `'cost'` and at
spot under `'market'` ([FINANCIAL-DOMAIN.md §9.3](docs/FINANCIAL-DOMAIN.md#93-calculation)).
That belongs in the release note, not in a support conversation.

---

## Phase 6 design review — 2026-08-18

**Design and provider evaluation only. Nothing was implemented.** No source file, schema, migration,
service, API, UI or provider package changed; no dependency was installed. The output is
[docs/MARKET-DATA-DESIGN.md](docs/MARKET-DATA-DESIGN.md) — a review record with the same standing as
`INVESTMENT-ENGINE-DESIGN.md` and `NET-WORTH-DESIGN.md`: **non-normative**, and where it and a
canonical document differ, the canonical document wins until **OD-10** is approved.

Provider facts were **verified against official sources on 2026-08-17/18**, not recalled; anything
unconfirmable from an official page is marked `UNVERIFIED` in the document rather than guessed.

### What it settles

| Area | Conclusion |
|---|---|
| **Phase 6's real gate** | **OD-3 is step 6.9 of twelve, not the phase.** The two adapters that matter most for an INR-base portfolio are free, keyless and official: **AMFI** (Indian mutual-fund NAV, history to 2006) and a **central-bank FX feed**. Eleven of twelve steps are unblocked today |
| **The live gap** | `fx_rates` is empty, so **every non-INR component is excluded from net worth right now**. The FX adapter fixes a defect, not a feature — and it is free and needs no credential |
| **Asset coverage** | Only **three** of nine asset classes need a feed — mutual funds, equities, ETFs — and two share one adapter. Gold is an ETF, an MF, or a manual asset; FDs have no market price; bonds are better marked by the user |
| **Provider strategy** | **Three adapters plus Manual**, each the only good source for its domain. Not multi-provider for novelty: a vendor selling Indian MF NAV is redistributing AMFI's own publication, later and with its own mapping errors |
| **Fallback** | **No cross-provider price fallback.** Splicing two vendors' closes makes the discontinuity indistinguishable from a real price move. Manual is the only floor, always labelled |
| **Caching** | **PostgreSQL only — the two price tables already are the cache.** Volume is ~900 requests/month, three orders of magnitude inside every candidate quota. The binding constraint is coverage and licence, not volume |
| **Trading calendars** | **No table.** The stored price series *is* the calendar — a date with a row is a session. Cannot drift from the prices it describes |
| **Corporate actions** | **Detections, never ledger writes.** A `split` row drives `replay()` and therefore every lot, position and P&L figure; an adapter inserting one is an unvalidated external source mutating Layer 1 |
| **Cost** | MVP as specified: **₹0/month.** With OD-3: **₹500/mo** (Kite Connect) or **≈₹2,800/mo** (Twelve Data Grow, $29). Call volume costs nothing on any candidate plan |

### 13 defects found in the baseline — M1–M13

Recorded in [MARKET-DATA-DESIGN.md §21](docs/MARKET-DATA-DESIGN.md#21-defects-found-in-the-baseline-m1m13)
with a per-finding correction. **None produces a wrong number today** — `instrument_prices` and
`fx_rates` are empty, so every affected path reports a labelled gap, which is why they survived five
completion gates. Each would produce a silently wrong financial figure on the day a provider is
connected. The five that matter:

- **M5 (high).** An **unrecorded split** produces post-split price × pre-split quantity — an 80%
  phantom loss propagated into the portfolio, allocation, market-basis net worth and the change
  bridge, every figure internally consistent and all of them wrong. → **ADR-29**: detect and
  **suppress** with `unreconciled_corporate_action`; never adjust.
- **M4 (high).** Nothing prevents a provider-sourced corporate action from being written to
  `investment_transactions`. Same rule and same reason as `CLAUDE.md`'s AI mutation rule. → **ADR-29**,
  invariant **I-40**.
- **M1 (high).** `selectRate()` in `src/server/domain/fx.ts` resolves **direct or inverse only** — it
  cannot triangulate. An FX adapter storing a reference feed's native EUR-quoted rows would leave a
  USD holding in an INR-base portfolio with **no rate at all**, silently dropping the whole foreign
  block from net worth. → normalise **in the adapter**, request base-quoted pairs, record the
  derivation in `source`. `selectRate` stays the simple thing it is.
- **M2 (high).** `price_stale_after_hours = 24` against **end-of-day** data marks Friday's close stale
  all weekend and until Monday's close lands — every equity, every ETF, every mutual fund, every
  week. A permanently-on warning is an ignored warning. → **ADR-28**: staleness in **trading
  sessions**, with a 10-calendar-day backstop; wall-clock retained only for crypto.
- **M3 (high).** `NetWorthResult` has coverage and exclusions but **no field for "used, but old"**, so
  a market-basis figure built entirely from three-week-old closes has nothing to qualify it.

**Two things were checked and found correct**, recorded so they are not re-litigated: the
currency-mismatch guard at `price-result.ts:84`, and the future-dated-quote handling (`cached` at age
zero rather than discarded — a clock problem, still the best price available).

### Proposed, not applied

**Four ADRs** — ADR-27 (adapters return observations; the registry classifies freshness — *refines*
ADR-11), ADR-28 (session-based staleness), ADR-29 (corporate actions are detections), ADR-30 (one
provider per price series; no cross-provider blending). **Eight invariants**, I-33 … I-40, continuing
`SCHEMA.md` §12 which currently ends at I-32. One new table, `corporate_action_detections`, and three
additive column changes. **Twenty adversarial scenarios** are worked through in
[§24](docs/MARKET-DATA-DESIGN.md#24-adversarial-review), ending with the five places the design could
still produce an incorrect number.

### The two dependencies the review was asked to define precisely

- **TWR** ([§4](docs/MARKET-DATA-DESIGN.md#4-the-twr-dependency-precisely)) — five conditions.
  `twr.ts` **needs no change**; the entire gate is in the caller that builds the `valuations` array.
  Two traps: the boundary set must include instruments **since fully disposed** (a position sold in
  March still determined January's sub-period), and a boundary falling on a **non-trading day** needs
  a carried-back valuation or `twr.ts`'s exact key match refuses forever — which is every Indian user
  with a monthly SIP.
- **Market-value net worth** ([§6](docs/MARKET-DATA-DESIGN.md#6-market-value-net-worth--the-exact-dependency))
  — nine requirements. The contributions map is **unchanged**, so I-21 and I-22 hold without
  modification; only the investment block's amount differs.

---

## What Phase 6 delivered — steps 6.0 … 6.8 · 2026-08-18

| Area | Where |
|---|---|
| **6.0** Canonical corrections | M1–M13 **reconciled** into `DECISIONS.md` (ADR-27…ADR-30), `SCHEMA.md` (§5, new §5.1, I-33…I-40), `FINANCIAL-DOMAIN.md` (§2 rewritten with the resolution table, new §2.1 triangulation and §2.2 rate age), `INVESTMENT-DOMAIN.md` (§5 reasons table, §8.1 bounded carry-back, §10 rewritten, §11 detections, edge cases 32–40), `ARCHITECTURE.md`, `TESTING.md` (§6.1–6.6) |
| **6.1** Provider abstraction | `src/server/market-data/` — `types.ts` (observations, `ProviderFailure`, `ProviderCapabilities`), `registry.ts` (resolution, capability refusal, failure→reason), `http.ts` (injected `fetch`, timeout, 429/404/5xx normalisation), `index.ts` (`defaultRegistry`) |
| **6.2** Persistence | `corporate_action_detections` (new table), `instrument_prices.provider_ref`, `settings.price_stale_after_sessions`. Migration `0004`, hand-written down migration |
| **6.3** FX | `domain/fx.ts` gains **triangulation** through one pivot; `providers/frankfurter.ts`; `fx.refresh` job; base-quoted pair normalisation |
| **6.4** AMFI | `providers/amfi.ts` — `NAVAll.txt` parser, ISIN-first mapping, publication-instant stamping; `prices.refresh` job |
| **6.5** Historical observations | `services/market-data.ts` — `storePriceObservations` with the three guards; `backfillPrices`; `closeAsOf` with the **bounded** carry-back |
| **6.6** Freshness | `market-data/freshness.ts` — **one** classifier, sessions for `eod`/`nav`, hours for `continuous`, 10-day backstop; `PriceResult` gains `freshness` + `sessionsBehind`; four new `MissingPriceReason` members; the Investments price indicator now speaks in sessions |
| **6.7** Corporate-action safety | Detections only; `suppressedInstrumentIds` blanks a value rather than adjusting it; `dismissDetection`; I-40 source scan |
| **6.8** Tests | **128 added** — `freshness`, `fx-triangulation`, `market-data-adapters` (7 failure modes × 2 adapters), `market-data-registry`, `market-data-source-scan`, `market-data` integration |

### Verification — 2026-08-18

| Gate | Result |
|---|---|
| `npm test` | **1,177 passed**, 0 failed (58 files) — up from 1,049 |
| Every Phase 3 / 4 / 5 test | **still passing** |
| Typecheck (`tsc --noEmit`, strict) | clean |
| Lint (`eslint .`) | clean |
| Production build | clean — 23 routes |
| `verify:integrity` | **33 passed, 0 failed**, 9 engine-enforced, 4 deferred |
| Migration inspected before applying | **0 DROP / TRUNCATE / RENAME**, 0 standalone DELETE; every `ALTER` on a pre-existing table is `ADD COLUMN` or `ADD CONSTRAINT` on the new column |
| Migration apply → rollback → re-apply | fingerprint identical, now covering `0004` |
| Existing data preserved | row counts identical across all 29 pre-existing tables; `price_stale_after_sessions` backfilled to 3 |
| `check:no-client-secrets` | no secret in 19 client files |
| Provider isolation | source scan: no file outside `providers/` names a provider; no adapter reads `process.env`; all three declare `requiresCredential: false` |
| No ledger mutation | `investment_ledger_version` and the derived fingerprint byte-identical after a corporate-action detection |

### Decisions taken during implementation

| # | Decision | Why |
|---|---|---|
| **D-33** | **`PriceResult` gains `freshness` and `sessionsBehind` rather than renaming its `status`** | ADR-28 needs four states; the union already had `live`/`cached`/`stale`/`missing`. Renaming would have churned every Phase 4 call site to express the same thing. `freshness` is typed **per variant** — `'stale'` on the stale arm, `'current' \| 'recent'` on the cached arm — so the two fields cannot disagree. Two Phase 4 test fixtures gained the fields; no assertion about a figure changed |
| **D-34** | **Triangulation lives in `selectRate`, not only in the adapter** | The design proposed adapter-side base-pair normalisation alone. Both are implemented, because either alone leaves a gap: normalisation cannot help a pair nobody requested, and triangulation alone puts an avoidable rounding in the common case. The domain rule is the safety net and is tried **last**, after direct and inverse |
| **D-35** | **Suppression tests "held units before the ex-date", not merely "a detection exists"** | Someone who bought *after* a split already holds post-split quantity and their figures are correct. Suppressing those would blank a correct holding, which is its own dishonesty. Asserted both ways |
| **D-36** | **The session calendar is derived per exchange from `instrument_prices`, keyed `''` for instruments with none** | ADR-28 says the price series is the calendar. Mutual funds have no exchange and share a NAV publication rhythm, so they need a bucket rather than an exception |
| **D-37** | **`I-40` is split into a source scan plus a queryable `I-40b`** | "No adapter writes the ledger" is not expressible as SQL. What *is* expressible is that a resolved detection points at a ledger row for the same instrument, kind and user — so both halves are checked rather than one being asserted and the other assumed |

### Fixed during implementation

1. **`daysApart` passed a one-indexed month to `Date.UTC`.** 31 January would have become 3 March, so the carry-back bound was wrong on exactly the month-end dates it matters on. Replaced with the domain's property-tested `daysBetween`. Caught while reading the diff, before any test ran.
2. **A test fixture set `positions.quantity = 0` directly** and hit `positions_units_and_basis_agree` (D-25). The constraint is right and the fixture was wrong: a full disposal now goes through `recordSell`, so the test exercises a state the engine can actually produce.

### Scope boundaries — deliberately not built

| Not built | Why |
|---|---|
| **Twelve Data adapter** | OD-3. Step **6.9**, behind the credential/configuration step. No SDK installed; adding it is one file plus one line of `defaultRegistry()` |
| **Automated equity refresh** | Follows the equity adapter; there is nothing to refresh until one exists |
| **Crypto provider** | Deferred (**OD-11**). The `continuous` cadence and its wall-clock branch are implemented and tested, so enabling crypto is an adapter, not a rule change |
| **Dedicated gold provider** | Deferred (**OD-12**). Gold prices as an ETF or MF, or is a `manual_assets` valuation series |
| **Market-value net worth** | A later Phase 6 step. `ValuationBasis` is still the one-member union `'cost'`, so widening it stays a compile error at every site that must be considered. **I-38 and I-39 are reported as deferred**, not silently omitted |
| **Net-worth snapshots** | ADR-24 — only if measurement justifies them, and nothing has been measured slow |
| **AI market-data analysis** | Phases 7–9 |
| **Corporate-action provider feed** | No shipping adapter supplies one, so `corporate_actions.refresh` ordinarily returns `unsupported`. The **detection, storage and suppression path is complete and tested** — what is missing is a source, not the safety machinery |
| **Historical backfill from a provider** | AMFI's daily file carries one NAV per scheme, so `getHistoricalPrices` is not implemented for it and `backfillPrices` correctly reports the refusal. History accumulates one session per day from the daily refresh, and arrives in bulk with the equity adapter |

---

## What step 6.9 delivered — Twelve Data · 2026-08-18

**The abstraction held.** The adapter is one new file in `providers/`, one entry
in `defaultRegistry()`, and one optional environment variable. **No file above
`src/server/market-data/` was modified to accommodate it** — the property the
whole abstraction exists to provide, now demonstrated rather than asserted.

| Area | Where |
|---|---|
| Adapter | `src/server/market-data/providers/twelvedata.ts` — `/quote`, `/time_series`, `/splits`; prices parsed as strings at `dp=8`; errors read from the **body**, not the HTTP status |
| Exchange identity | `src/server/market-data/exchanges.ts` — `NSE`→`XNSE`, `BSE`→`XBOM`, plus `XNAS`/`XNYS`/`XLON`, with per-venue close instants computed through `Intl` (DST-correct) |
| Credential | `TWELVE_DATA_API_KEY`, **optional**, read once in the composition root and injected. Placeholder in `.env.example` |
| Smoke test | `npm run smoke:market-data` — a `scripts/` entry point, deliberately **not** in the deterministic suite |
| Tests | **68 added** — 49 unit across all 21 required cases, 17 integration, 2 strengthened source scans |

### Verification — 2026-08-18

| Gate | Result |
|---|---|
| `npm test` | **1,245 passed**, 0 failed (60 files) — up from 1,177 |
| Every Phase 3 / 4 / 5 test | **still passing** |
| Typecheck · lint · production build | clean · clean · clean (23 routes) |
| `verify:integrity` | **33 passed, 0 failed**, 9 engine-enforced, 4 deferred |
| Schema | **unchanged** — 6.9 required no migration |
| `check:no-client-secrets` | no secret in **21** client files; a **canary run with a planted key** also clean |
| Provider absent from the browser | the string `twelvedata` appears in **no** client asset |
| Live smoke test | ✅ **run 2026-08-31 against the real provider.** Catalogue read (83 models), text generation on `nvidia/nemotron-3-nano-30b-a3b` (2,288 ms, 47 completion tokens), structured output validated, an unknown model classified as `transport`. No financial data sent; no credential printed |

### The defect this step found and fixed

**A user-typed exchange crashed the whole price refresh.** `instruments.exchange`
is free text (`NSE`), and the refs builder added in step 6.5 asserted it was
already a MIC — so `mic('NSE')` **threw**, aborting `prices.refresh` for the
entire portfolio, not just the offending instrument. Every market-data test to
that point used a mutual fund, whose exchange is `null`, so the equity path had
never been exercised. `resolveMic` now translates or returns `null`, and an
adapter that needs a venue refuses the instrument cleanly. Two regression tests.

### Decisions taken during implementation

| # | Decision | Why |
|---|---|---|
| **D-38** | **The credential is read in the composition root and injected**, not read by the adapter | An adapter reading `process.env` is untestable without mutating global state and adds a second place to look for a leak. Injection means all 49 adapter tests run with no environment at all, and the source scan asserting "no adapter reads the environment" is enforceable |
| **D-39** | **Twelve Data is registered even when unconfigured** | An adapter that vanishes when the key is missing makes "why is nothing priced?" depend on which files loaded. Registered-but-unconfigured returns one typed refusal on every path, and the reason reaches the screen |
| **D-40** | **An error body is checked before the HTTP status is trusted** | Twelve Data returns `{"status":"error","code":429}` with HTTP 200. Trusting transport alone would read a rate-limit refusal as a successful empty response — a portfolio that quietly stops updating |
| **D-41** | **An unresolvable exchange is a refusal, never a guess** | `INFY` without a venue could be the NSE listing or a same-named foreign one. Pricing the wrong security is worse than pricing nothing, and `resolveMic` returns `null` rather than picking a plausible venue |
| **D-42** | **`source` is scoped by venue — `twelvedata:XNSE`** | I-35 pins one source per series. Venue-scoping means a series can never silently mix two listings of the same company |

### Scope boundaries — deliberately not built in 6.9

Automated equity refresh (the existing `prices.refresh` already routes equities;
scheduling is unchanged), crypto (**OD-11**), gold (**OD-12**), market-value net
worth, snapshots, AI. `ValuationBasis` remains the one-member union `'cost'`.

**TWR is not wired into the portfolio summary.** Its *data path* is proven end to
end — stored history → `closeAsOf` → a valuation at every boundary including a
non-trading day → `twr()` returning a figure — but `services/portfolio.ts` still
reports `insufficient_price_history` unconditionally. That connection is a later
step and is not claimed here.

---

## Phase 6.11 design review — 2026-08-21

**Design only. Nothing was implemented.** No source file, schema, migration, service, API, UI or test
changed. The output is [docs/MARKET-VALUE-NET-WORTH-DESIGN.md](docs/MARKET-VALUE-NET-WORTH-DESIGN.md),
a **non-normative** review record with the same standing as the three before it.

### What it settles

| Area | Conclusion |
|---|---|
| **Two bases** | Widen `ValuationBasis` to `'cost' \| 'market'` — the smallest abstraction, and the one ADR-23 already specified. **The basis is a property of component *construction*, not of composition**: `compose()` carries it and never branches on it, so the domain is untouched and `reconcile()` works for both bases unchanged |
| **Single counting** | **A cost-plus-market double count is a thrown exception, not a wrong number.** Both would use the same `position:(account,instrument)` key, and `ContributionMap.add()` throws on a duplicate. The key was designed this way in Phase 5 — `keys.ts:23` says so in as many words |
| **Cost → market** | **A restatement at an instant, not a bridge over time** ([ADR-31](docs/DECISIONS.md#adr-31--cost-to-market-is-a-restatement-at-an-instant-not-a-bridge-over-time)). `bridge()` already refuses cross-basis bridging and is right to; conflating them would let a user read a valuation difference as a gain they made |
| **FX** | The restatement decomposes **exactly** into price and FX rebasis, with **no new column** — `tax_lots` carries `remaining_cost` in instrument currency alongside the acquisition rate. The *holding-level* combined figure (INVESTMENT-DOMAIN §6.4) is deliberately unchanged: different question |
| **Partial valuation** | Shown and labelled, never suppressed and never completed with cost. `complete \| partial \| unavailable`, with **value-weighted** investment coverage by base cost basis — what D-29 promised |
| **Staleness** | A stale price is **used and flagged**; refusing it would blank the headline every long weekend. Finding **M3** — no field for "used, but old" — becomes a V1 requirement |
| **Historical** | Five of six inputs already work. The one new algorithm is **`quantityHeldOn`**, ratio-aware; `positions` must never serve a historical date |
| **Manual assets** | Have a **valuation, not a price**, and do not become "priced" because the basis label changed |
| **Liabilities** | **Unchanged** — a liability has no market value, so the restatement has no liability term |
| **Schema** | **No change required.** Every input exists |

### 6.10 snapshots — closed by measurement

Measured against the real domain functions over synthetic data at 40 instruments, 480 lots and
100,000 price points — larger than the target portfolio, so an upper bound:

| Operation | Measured |
|---|---|
| Net worth at cost, 1 point | 0.31 ms |
| Net worth at market, 1 point | 2.9 ms |
| 12-point market-value series | 33 ms |
| 365-point market-value series, naive scan | 1,156 ms |
| **365-point market-value series, indexed lookup** | **123 ms** |

The naive figure is the instructive one: 1,156 ms looks like a case for a cache and is not — it is a
linear scan of 2,500 price points per instrument per point. Sorting once and binary-searching takes it
to 123 ms. A snapshot table would have added a second stored representation of a derived figure, free
to drift, needing `user_state.valuation_version` and an integrity assertion, to avoid a sort.
**Recommended closed (OD-15).**

### Proposed, not applied

**[ADR-31](docs/DECISIONS.md#adr-31--cost-to-market-is-a-restatement-at-an-instant-not-a-bridge-over-time)** ·
**invariants I-41 … I-49**, each mapped to a domain rule and a test (none is a database constraint —
net worth stores nothing) · **I-38 and I-39 promoted** from deferred to live · golden scenarios **G5**
and **G6** · **26 adversarial scenarios** with expected behaviour.

### One contradiction found and resolved

The task specified a *"cost-to-market bridge"*. `bridge.ts:122` **refuses** to bridge across a basis
change, deliberately and with a good reason. Resolved in favour of the code: it is a **restatement**,
and ADR-31 records why the distinction is not pedantry.

### Decisions — resolved 2026-08-21

| # | Outcome |
|---|---|
| **OD-14** | ✅ **Approved and applied.** [ADR-31](docs/DECISIONS.md#adr-31--cost-to-market-is-a-restatement-at-an-instant-not-a-bridge-over-time) and [ADR-32](docs/DECISIONS.md#adr-32--the-default-valuation-basis-remains-cost-market-is-an-explicit-alternate-view) carry the architecture; the methodology went into `FINANCIAL-DOMAIN.md` §9.3 (`marketValue` normative), new §9.5 (restatement) and §9.6 (what market basis does **not** change), `INVESTMENT-DOMAIN.md` §5.1, `SCHEMA.md` §12 (**I-41, I-43…I-49**) and `TESTING.md` §6.7. **Reconciled, not appended** — draft **I-42 was dissolved** on discovering I-38/I-39 already stated it |
| **OD-15** | ✅ **Closed — snapshots not built.** No `net_worth_snapshots`, no job, no snapshot-based figure. Evidence: **123 ms** for a 365-point market-value series with an indexed price lookup, against 1,156 ms for the naive linear scan the earlier draft measured. Reopened only by a **real production measurement** |
| **OD-16** | ✅ **Resolved: the default basis remains `cost`.** This came back **differently from the design's recommendation**, and ADR-32 supersedes ADR-23's default-flip consequence. Every document that implied market would replace cost has been corrected, including two non-normative review records |

### Why OD-16's outcome is the right one

Recorded because the design argued the other way. Flipping the default would have **restated every
figure the user had already seen** — six months of history and a differently-shaped chart, with no
transaction behind any of it. Cost basis also changes only when the *user* does something (earns,
spends, buys, sells, revalues, repays), which is the property a "how am I doing?" headline wants;
market moves with prices and FX, neither of which they control. And a default should not be able to
report `partial` because a provider had a bad morning — cost coverage is `1.0` by construction.

That the design needed **no structural change** to accommodate the opposite answer is itself evidence
the basis abstraction was drawn in the right place.

**Implementation followed on 2026-08-27** and every gate in
[MARKET-VALUE-NET-WORTH-DESIGN.md §21](docs/MARKET-VALUE-NET-WORTH-DESIGN.md#21-implementation-gates)
is met — see *What step 6.11 delivered* below.

`TWELVE_DATA_API_KEY` is configured and the live smoke test passes, so 6.9 carries no outstanding
verification either.

Superseded pointer, kept for the record: the earlier instruction here was to *perform* this review by
reading `docs/ARCHITECTURE.md`, `docs/INVESTMENT-DOMAIN.md` §5 and
§8.1, [ADR-11](docs/DECISIONS.md#adr-11--market-data-behind-a-provider-abstraction-with-an-always-available-manual-provider),
and `docs/ROADMAP.md` Phase 6 before writing anything.

---

## What step 6.11 delivered — Net Worth at Market Value · 2026-08-27

| Area | Where |
|---|---|
| Basis | `ValuationBasis = 'cost' \| 'market'` in `domain/networth/compose.ts`. Phase 5 shipped it as a one-member union so widening it would be a compile error at every site that had to be reconsidered; that mechanism was used, not circumvented |
| Quantity | `domain/lots/quantity.ts` — `quantityHeldOn`, reading a per-trade-date `quantityTimeline` that `replay()` now emits. **One** implementation of the corporate-action ratio arithmetic |
| Market components | `services/_networth-market.ts` (loader and price selector) and `marketPositions()` in `services/networth.ts` (the builder). Priced or excluded, never cost-substituted |
| Completeness | `domain/networth/market.ts` — status, value-weighted investment coverage, excluded cost, staleness |
| Restatement | `domain/networth/restate.ts` — three computed lines, closing exactly |
| Price index | `domain/pricing/price-series.ts` — sort once per instrument, binary-search per point |
| UI | `app/(app)/net-worth/market/page.tsx`, plus one reciprocal line on the existing page |
| Benchmark | `scripts/bench-networth.ts`, `npm run bench:networth` |
| Tests | **129 added** — 46 unit, 9 property, 41 integration, 23 golden (G5 + G6), 10 source-scan |

### Verification — 2026-08-27

| Gate | Result |
|---|---|
| `npm test` | **1,396 passed**, 0 failed (66 files) — up from 1,267 |
| Every Phase 3 / 4 / 5 / 6.0–6.9 test | **still passing** |
| Typecheck · lint · production build | clean · clean · clean (25 routes) |
| `verify:integrity` | **33 passed, 0 failed**, 19 engine-enforced, 2 deferred |
| Schema | **unchanged** — no migration, as §20 concluded |
| Snapshots | **not built** — OD-15 stands on measurement |
| `check:no-client-secrets` | no secret in 21 client files |
| Net Worth at Cost | **unchanged** — a price arriving moves it by zero minor units, asserted by test and confirmed in the browser |
| Browser — desktop 1440px | default view headline held at ₹76,90,000.00; comparison line, market view, restatement, reconciliation all correct |
| Browser — mobile 375px | no horizontal page overflow; the one wide table scrolls inside its own container |
| Console | no errors beyond the pre-existing Next dev-mode CSP `style-src` notices, which appear identically on the Phase 5 page |

### Performance — measured, not asserted

`npm run bench:networth`, at 8 accounts · 40 instruments · 480 lots · 100,000 price points · 2,500 FX rows:

| Operation | Measured | Design baseline (§12) |
|---|---|---|
| Net worth at cost, 1 point | 0.4 ms | 0.31 ms |
| Net worth at market, 1 point | 0.3 ms | 2.9 ms |
| 12-point market-value series | 4.4 ms | 33 ms |
| 365-point at-cost series | 42 ms | 82 ms |
| **365-point market-value series, indexed** | **80 ms** | **123 ms** |

The naive-scan control measures 14.6 s here against the design's 1,156 ms; that row is a
same-machine control for the *shape* of the cost, not a reproduction — this scan validates each
stored date, so its absolute number is its own. **The gate is the indexed figure**, and it beats the
baseline.

### The defect this step found and fixed

**`selectRate()` rebuilt its whole pair index on every call.** `indexRows` is `O(rows)` and its
result depends only on `(rows, on)`, so one conversion on one page cannot tell the difference — but
a market-value **series** asks for a rate once per foreign position per point, and over 2,500 stored
observations that is a table scan wearing a lookup's clothes. The first benchmark run came in at
**710 ms** against the design's 123 ms, and the price index alone did not explain it.

`rateSelector()` memoises the index per date. The resolution rule is untouched — identity → direct →
inverse → triangulated, dated by the stalest leg, one pivot only — so the change is to what is
recomputed, never to what is decided, and all 1,396 tests confirm every Phase 3/4/5 figure is
byte-identical. The series dropped to **80 ms** and the single-point market fold from 3.0 ms to
0.3 ms.

**Worth stating plainly: a test would not have caught this.** Every figure was already correct. It
took a measurement, which is the argument ADR-24 makes for measuring before caching — and the reason
the benchmark is a committed script rather than a number in a document.

---

## What step 7.0 delivered — Phase 7 pre-implementation corrections — 2026-08-30

**Scope: architecture and tooling boundaries only. No AI infrastructure was implemented.** No AI provider, no SDK installed, no `NVIDIA_API_KEY` configured or requested, no AI tools, no orchestrator, and **no file under `src/server/ai/`** — that directory still does not exist. The work was to make the corrections the Phase 7 design review identified *before* anything is built on top of them.

### The three findings, and how each is now closed

| | The claim the documents made | What the code actually did | The correction |
|---|---|---|---|
| **F-1** | `AI-SYSTEM.md` §1: *"the AI layer holds only a `ReadCtx` … so a write from AI code does not compile"* | Two independent holes. `withWriteCtx(readCtx, …)` **compiled clean**, and `ReadCtx.db` is a `DbExecutor` exposing `.insert`, `.update`, `.delete`, `.execute` and `.transaction` | `withWriteCtx`/`withWriteCtxResult` require a **`RequestCtx`** carrying `beginTransaction`, granted only by `createReadCtx`. The AI layer holds an **`AiReadCtx`** with no `db`, no `fx` and no capability — and which is not a `ReadCtx`. Both holes are now compile errors ([ADR-33](docs/DECISIONS.md#adr-33--the-transaction-opener-is-a-capability-carried-on-the-context-not-an-ambient-import)) |
| **F-2** | `AI-SYSTEM.md` §3: *"nothing inside it imports `src/server/db/`"* | The ESLint AI zone matched only `@/`-aliased specifiers, so `import { db } from '../../db/client'` linted clean. Adding the engine zone's `**/server/db/*` would not have helped — it requires a literal `server` segment the specifier lacks | Aliased **and** relative patterns, `drizzle-orm`/`pg` banned outright, plus a source scan and the capability types. Three mechanisms ([ADR-34](docs/DECISIONS.md#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths)) |
| **F-3** | `AI-SYSTEM.md` §8: *"Σ rows = total at every depth"* | `breakdown()` returned **every node** of the category tree — parents and children — each rolled up. Summing them double-counted every pair; the golden test worked around it by filtering on `›` in the label | `breakdown()` returns a structure with an authoritative `total` and an `additivity` tag; both depths partition exactly, and a tag breakdown declares itself `overlapping` ([ADR-37](docs/DECISIONS.md#adr-37--a-breakdown-declares-whether-its-rows-partition-its-total)) |

**The type change proved itself on contact.** Changing `withWriteCtx` to require a `RequestCtx` made `tsc` report the escalation at every site that used it. There were three, all test harnesses legitimately standing in for a user request — and **no production code at all**, because every server action already obtains its context from `createReadCtx`.

### Also delivered

| | |
|---|---|
| **AI-safe numeric projection** | `src/lib/format/json-projection.ts`. `Money`, `Quantity`, `UnitPrice` and `Rate` cross a JSON boundary as `{ kind, digits…, scale }` — exact digits as a string, tagged. No `Number()` anywhere; the domain types are unchanged and gain no `toJSON` ([ADR-36](docs/DECISIONS.md#adr-36--exact-values-cross-a-json-boundary-as-a-tagged-string-projection-never-as-a-json-number)) |
| **The read capability** | `src/server/ai-read/` — `index.ts` exports `AiReadCtx` and nothing else; `internal.ts` holds the one bridge back to a `ReadCtx`, bound in a module-private `WeakMap` and banned from the AI zone. Phase 7.3 adds the projected read functions to `index.ts` |
| **Root lint scope** | `eslint.config.mjs` now ignores `.claude/**`. `eslint .` was walking the sibling Claude worktrees — five complete copies of this repository nested inside it — because flat config skips neither dot-directories nor `.gitignore` |
| **Tag breakdowns declared non-additive** | Not in the original finding; found while fixing F-3. `tagBreakdown` inner-joins `transaction_tags`, so a two-tag transaction counts twice and an untagged one not at all. The old bare array gave a consumer no way to know |

### Tests and checks added — I-50 … I-54

| Invariant | Mechanism | Where |
|---|---|---|
| **I-50** | **Compile test.** Type-checks probe sources against the project's own `tsconfig.json` via an overlay host — nothing is written to the tree — and asserts the diagnostic codes: `withWriteCtx(ai, …)` → TS2345, `ai.db` → TS2339, `listAccounts(ai)` → TS2345. Also asserts a `RequestCtx` **can** still open a write, so a boundary that broke the application fails here rather than mysteriously elsewhere | `tests/unit/ai-write-boundary.test.ts` (10 tests) |
| **I-51**, **I-52** | **Source scan.** Catches what ESLint structurally cannot — **dynamic `import()` and `require()`**, which `no-restricted-imports` never checks in any zone — plus `ctx.db` DML and any mention of a write-boundary symbol. Also asserts `eslint.config.mjs` still carries the relative patterns | `tests/unit/ai-boundary-source-scan.test.ts` (17 tests) |
| **I-53** | Property tests over generated values past `MAX_SAFE_INTEGER`: the projection agrees with `toDbString`, round-trips through `fromDbString`, is never a JSON number, keeps a price distinguishable from a quantity, and projects a missing figure to `null` rather than zero | `tests/unit/json-projection.test.ts` (17 tests) |
| **I-54** | Property tests over generated two-level trees: `Σ folded === Σ direct` exactly, every input id lands in exactly one row, no emitted row is a descendant of another. The integration half asserts the partition at **both** depths against the golden figures | `tests/unit/breakdown-contract.test.ts` (9 tests), `tests/integration/golden-g1.test.ts` |

**Both F-2 mechanisms were verified empirically, not assumed.** A probe importing `'../../db/client'` relatively is rejected by ESLint *and* the scan. The same import written `await import('../../db/client')` **passes ESLint with exit 0** and is caught only by the scan — which is the concrete reason the scan exists.

**Non-vacuity.** `src/server/ai/**` does not exist yet, and a scan over an empty set passes for the wrong reason. The scan therefore asserts a corpus of synthetic violations, the ESLint config itself, and the capability's shape — all of which hold today — and activates its directory checks from the first file Phase 7 places there.

### Deferred, explicitly

- **OD-18** — the scenario engine, the three missing metrics and the TWR wiring are **not** built. They are removed from the Phase 7 tool registry rather than stubbed. *An AI capability exists only where a deterministic application capability already exists or has an explicitly approved implementation path.*
- **OD-19** — the Overview page is **not** redesigned or implemented. Recorded as a future product/UI work item, scheduled with the Phase 9 UX pass. It does not block Phase 7.

### Verification

**1,456 tests pass and 3 are skipped** (71 files, 1,459 total) — 63 added over the 1,396 of the 6.11 baseline, and every Phase 3, 4, 5 and 6 test still passes. The 3 skips are the AI-zone directory checks, which activate from the first file Phase 7 places under `src/server/ai/` and are deliberately inert until then. `verify:integrity` reports **33 passing, 0 failing, 24 engine-enforced, 2 deferred** (I-50 … I-54 added). Typecheck, lint and the production build are clean, and `eslint .` **from the repository root** now reports **0 problems** where it previously reported **121,213** — it was descending into five complete worktree copies of this repository.

**One test caught a real defect in this very change**, which is the point of writing them first. `breakdown()`'s first cut derived a rollup row's `childCount` as `foldedIds.length - 1`, which undercounts a parent whose children were the only things spent on — the commonest shape in the seed tree, where `Food` has no direct entries of its own. The golden G1 assertion failed on it. The fix reads the descendants directly, and `tests/unit/breakdown-contract.test.ts` now covers both that shape and the single-child case a `length > 1` test for `isRollup` also gets wrong.

**No financial calculation changed.** `rollup()`, `cashflow()`, `periodSummary()` and every engine function are untouched; F-3 changed the *shape* of a row set and the arithmetic that assembles it, not the figures. The golden expectations in `tests/golden/` were not edited.

---

## Live provider verification — 2026-08-31

`NVIDIA_API_KEY` was configured after the Phase 7 commit, so `npm run ai:smoke` and `npm run ai:catalogue` ran against the real provider for the first time. Connectivity, generation, structured output and failure classification all pass.

**The catalogue read corrected the routing table, and disproved two claims this project had been carrying since Phase 0.** `AI-SYSTEM.md` §2.3 recorded them from an *unauthenticated* read; the authenticated one shows otherwise:

| Identifier | Was recorded as | Actually |
|---|---|---|
| `zai-org/glm-5.2` | ⚠️ "real id is `z-ai/glm-5.2`" | ❌ **absent.** No GLM model exists under any publisher prefix |
| `nvidia/nemotron-nano-12b-v2-vl` | ✅ present | ❌ **absent** |

Both were in `config/models.ts`'s default order — GLM as the Tier 2 fallback, the 12b model as the **Tier 4 primary** — so two of the four routed tiers pointed at models the provider would not serve. This is precisely the failure the design review predicted ("any routing table written against `CLAUDE.md`'s list verbatim would fail at runtime"), and the table written from that list inherited it.

Corrected: Tier 2 drops GLM and keeps two candidates; **Tier 4 now has exactly one model and therefore no fallback**, which is the honest configuration rather than a second entry that would answer a document question without having seen the document. Five of thirteen candidates are now recorded `catalogue: null`. Two new tests assert that no tier routes to an absent model and that fallback exists wherever it is possible.

**Also repaired:** the Phase 7 commit introduced mojibake into four documents — ❌, —, §, × and ⏸ double-encoded by a PowerShell write. Clean through `1483166`, corrupted in `c9fe823`, repaired here. The same write path had put a UTF-8 BOM into `package.json`, which broke `next build` until it was stripped.

---

## Adversarial security gate — step 7.0 — 2026-08-30

**Ten attack categories, fourteen import probes, five findings, all fixed.** The review attacked the corrected boundary rather than re-reading it: every result below was produced by writing a probe file into `src/server/ai/`, running the real ESLint config and the real source scan against it, and recording what happened.

**The headline: the boundary was the right idea in the wrong shape.** [ADR-34](docs/DECISIONS.md#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths) closed the relative-path hole but kept a **denylist** naming `db`, `domain` and `services`. Seven of fourteen probes passed **both** ESLint and the source scan.

| # | Route | Granted | Severity | Status |
|---|---|---|---|---|
| **S-1** | `@app/(app)/money/actions`, aliased or relative | A `'use server'` action takes a **form, not a context**, and builds a `WriteCtx` internally from the session. Importing one mutates the ledger with the user's own authority — **no write capability passes through AI code at all**, so ADR-33's type guarantees are bypassed rather than broken | **CRITICAL** | ✅ fixed |
| **S-2** | `@/server/jobs` | `enqueue` / `runDueJobs` / `scheduleRecurringPost`; the handlers call `withWriteCtx`. The same defeat, one indirection away | **CRITICAL** | ✅ fixed |
| **S-3** | `@/lib/env` | `env()` returns `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `SESSION_COOKIE_SECRET`, `TWELVE_DATA_API_KEY` and, by design, `NVIDIA_API_KEY` — to the one layer that sends text to a third party | **HIGH** | ✅ fixed |
| **S-4** | `@/server/auth/**` | Sessions, password verification, and decryption of TOTP secrets and recovery codes under `APP_ENCRYPTION_KEY`; `account.ts` opens its own transaction | **HIGH** | ✅ fixed |
| **S-5** | `ignores: ['…/nvidia-build.ts']` | `ignores` drops a config object *entirely* for the named file, so the exemption meant to permit `openai` also gave the wire client the database, the services and the engine | **HIGH** | ✅ fixed |
| | `@/server/market-data/http` | Arbitrary outbound HTTP with provider credentials — an exfiltration channel | MEDIUM | ✅ fixed |
| | `@/server/health` | Executes SQL, even if only a fixed probe | LOW | ✅ fixed |
| **S-6** | `AiReadCtx` was mutable | `readonly` is erased at runtime. It could never redirect a read — the `WeakMap` keys on identity — but a projection rendering `ai.userId` could label one user's figures with another's name | LOW | ✅ fixed |

**The fix is a change of shape, not a longer list** ([ADR-38](docs/DECISIONS.md#adr-38--the-ai-zone-is-an-allowlist-a-new-directory-is-closed-on-the-day-it-is-created)). Deny `@/server/**`, re-admit exactly `@/server/ai-read` and `@/server/log`, re-deny the bridge inside the first. Adding the six missing directories to the denylist would have closed these seven routes and left the shape that produced them — the next directory would be open again. `@/server/whatever-comes-next` is now closed, and a test asserts it.

**The source scan no longer keeps its own copy of the list.** It reads the patterns out of `eslint.config.mjs`. The copy had already drifted, which is how five routes stayed open in *both* mechanisms at once — the defence-in-depth was two mechanisms enforcing one stale list, not two independent checks.

### Results by attack category

| Attack | Result | Blocked by |
|---|---|---|
| **1 — write escalation** | No path found after the fix. `withWriteCtx(ai, …)` / `ai.db` / service calls are compile errors; every import route to a write helper, a server action or a job is denied | structural (types) + static (ESLint) + source scan |
| **2 — raw database access** | No path. `db`, `drizzle-orm`, `pg`, `health` all denied; the capability carries no handle to write through | structural + static + scan |
| **3 — tool escalation** | Bounded by construction: `ai-read/index.ts` exports only the capability type today, so no tool can reach a service until 7.3 adds enumerated projections there. `ai-read/**` now has its own zone banning the write surface **by name** (`importNames`) while leaving queries importable | structural + static |
| **4 — prompt injection** | No control depends on model behaviour. Authorization is `ctx.userId` filtering inside services; the capability has no database handle; tier and requirements are computed from the *capability*, never from content. A model that decides to misbehave still cannot reach anything | structural |
| **5 — cross-user access** | Blocked. `createReadCtx(anyUserId)` is denied to the zone; the capability is bound in a module-private `WeakMap` and now frozen; a forged or copied capability is refused at runtime | structural + runtime + static |
| **6 — JSON projection** | No loss found. Round-trips at `NUMERIC(20,4)`'s maximum and its negation, past `MAX_SAFE_INTEGER`, at zero and negative zero; a price stays distinguishable from a quantity of identical digits; identical digits in different currencies stay distinct; every projection states its own scale | structural + test |
| **7 — breakdown semantics** | Unambiguous. `additivity` is a **required** field — a `Breakdown` omitting it does not compile — and the result does not type-check as `BreakdownRow[]`, so reaching the rows means reading the declaration | structural + test |
| **8 — secret exposure** | Closed. `@/lib/env` and `@/server/auth/**` denied; `@/server/log` re-admitted deliberately because it exports `redact`/`log` and re-exports nothing from the environment | static + scan |
| **9 — dependency escape** | `src/lib/**` verified to import no database, service or engine module; `@/server/ai-read` imports only `@/lib` types; `@/server/log` reads `LOG_LEVEL` and exposes none of it | static + scan |
| **10 — fail closed** | Every category above is blocked by at least one mechanism that does not depend on a developer remembering a rule. Nothing remains classified CRITICAL, HIGH or MEDIUM | — |

**One residual, accepted and already designed for.** `DomainError` carries an entity id, and for a `settings` error that id **is the user id**, so a tool that returned a raw error would leak it. No tool exists yet; `AI-INFRASTRUCTURE-DESIGN.md` §6.4 already requires a projected error, and Phase 7.3 must implement it. Recorded here so it is a scheduled requirement rather than a discovery.

**What the review did not test.** Live prompt injection against a model, and the runtime behaviour of tools — neither exists. The relevant property was tested instead: that no security control *depends* on the model choosing correctly.

**Verification after the fixes:** 1,470 tests pass and 3 are skipped (71 files), typecheck clean, lint clean, production build clean, `verify:integrity` 33 passing / 0 failing / 24 engine-enforced / 2 deferred.

**AI implementation has still not started.** No provider, no SDK, no `NVIDIA_API_KEY`, no tools, no orchestrator, and `src/server/ai/` does not exist — every probe directory created during this review was deleted, and `git status` is clean.

---

## What Phase 7 delivered — AI Infrastructure — 2026-08-30

**Infrastructure only. No user-facing AI feature exists**, and none was started: no chat interface, no natural-language transaction entry, no assistant, no portfolio analyst, no document extraction, no RAG, no vector store, and no autonomous action. Those are Phase 8 (evaluation) and Phase 9 (features).

**The security gate from step 7.0 is intact and was strengthened by being used.** The three AI-zone directory scans that were inert while `src/server/ai/` did not exist are now live and passing against real code, and the allowlist caught two boundary mistakes while this phase was written — an in-zone module named `health.ts` colliding with the `@/server/health` ban (renamed to `breaker.ts` rather than widening the rule), and a namespace `import * as services` in the read capability that reached the write helpers by name (replaced with explicit named imports). Neither was resolved by relaxing a rule.

### What was built

| Step | Delivered |
|---|---|
| **7.1 provider** | `AiProvider` interface (`provider/types.ts`) and the NVIDIA Build adapter (`provider/nvidia-build.ts`) — the only file that knows the wire format, the endpoints, or the bearer header. Every method returns a classified `Result`; nothing throws |
| **7.2 configuration** | `config/models.ts` — tier → ordered candidates, env-driven, with **`CLAUDE.md`'s candidate list reconciled against the catalogue**: one identifier corrected (`deepseek-v4-flash` → `-0731`) and **five** recorded as absent rather than silently substituted. `config/capabilities.ts` — the gate |
| **7.3 tools** | 18 read-only tools over real services, `AiReadCtx` throughout, per-field JSON projection, row caps, a 150 KB byte budget and visible truncation. Zod `.strict()` schemas → JSON Schema |
| **7.4 orchestrator** | `requirements` → `select` → `fallback`, with a circuit breaker. Routing is decided from the capability alone, before any content is read |
| **7.5 structured output** | Parse → validate → **one** repair carrying the field errors → reject. Zod is the single validation boundary (ADR-16) |
| **7.6 observability + switches** | A closed record of scalars with nowhere to put a figure; `settings.ai_enabled` **now actually read**; a per-user fixed-window rate limiter |
| **7.7 live smoke test** | `npm run ai:smoke` / `ai:catalogue`. **Not run — no credential (OD-1).** It exits 0 and prints local configuration instructions rather than failing |

### Decisions taken, and one deviation recorded

- **[ADR-40](docs/DECISIONS.md#adr-40--the-nvidia-adapter-is-written-over-fetch-the-openai-client-is-deferred-to-the-phase-that-needs-streaming) — the adapter is written over injected `fetch`, not the `openai` client.** `AI-SYSTEM.md` §2.2 chose the client for SSE parsing and retries; Phase 7 needs neither, because there is no streaming caller until Phase 9 and retry policy belongs to the orchestrator. This is a deviation from a canonical document and is recorded as one; §2.2 has been amended. The `openai` import ban stays, so adopting the client later is a change to one file.
- **Declared versus measured capabilities.** `AI-SYSTEM.md` §5 describes `capabilities.json` as written by the eval harness, with measured scores gating routes. The eval cannot run without a credential, which left a choice between an empty matrix (nothing routable, provider untestable) and inventing scores (forbidden). Neither was taken: every entry carries `source`, `'declared'` entries come from documentation and can serve only routes with **no** score threshold, and `'measured'` is required for every structured-output and tool-using route. **No score in the repository is a benchmark result.**

### Boundaries kept, and what is deliberately absent

`run_financial_scenario`, `calculate_financial_metrics` and a TWR tool are **not** in the registry — **OD-18**, unchanged: an AI capability exists only where a deterministic one does. `retrieveRelevantContext` and Tier 5 are absent — ADR-19. `portfolio()` still reports `twr: unavailable('insufficient_price_history')`, and the tool projects that **reason** rather than a number.

The AI layer cannot obtain a `WriteCtx`, execute SQL, reach a service directly, read the environment, or name another user — each asserted rather than intended, and each unchanged from the step 7.0 gate.

### Tests — I-55 … I-58

| Invariant | Covers | Where |
|---|---|---|
| **I-55** | Provider: unconfigured, auth, 429 with `Retry-After`, 5xx, timeout, socket error, non-JSON body, no choices, tool-call passthrough, content filter; the credential never leaves the auth header, even when the provider echoes it in an error | `tests/unit/ai-provider.test.ts` (20) |
| **I-56** | Capability gates in both directions, unmeasured-score refusal, **cross-tier downgrade impossible**, Tier 3 unreachable by escalation, breaker open/half-open/close, attempt ceiling, fail-closed short-circuit, identifier normalisation | `tests/unit/ai-routing.test.ts` (26) |
| **I-57** | No tool accepts a user identifier (swept across the registry), `additionalProperties: false` everywhere, unknown tool, non-JSON arguments, invented argument, malformed date, handler that throws; validate → one repair → reject across eight malformed shapes | `tests/unit/ai-tools.test.ts` (25) |
| **I-58** | `ai_enabled = false` produces **zero egress**, fails closed with no settings row, and leaves other features working; per-user rate limiting; **user isolation swept across every tool** with two users' real data; figures projected, breakdown additivity carried, domain errors stripped of the entity id | `tests/integration/ai-infrastructure.test.ts` (14) |

### Verification

**1,553 tests pass** (75 files) — 85 added, and every Phase 3, 4, 5 and 6 test still passes. `verify:integrity` reports **33 passing, 0 failing, 28 engine-enforced, 2 deferred**. Typecheck, lint and the production build are clean; `check:no-client-secrets` passes.

### Not done, and why

- **The live smoke test has not run.** `NVIDIA_API_KEY` is unset (**OD-1**). Everything else is verified without it, which was the design requirement.
- **No model has been measured.** Phase 8 runs `ai:eval`; the harness exists (`ai/eval/harness.ts`) and records schema adherence, tool-call correctness, latency percentiles and error class, with `null` printed as *not measured* rather than `0`.
- **No AI database tables.** `ai_messages`, `ai_model_attempts` and `ai_usage_daily` are specified in `SCHEMA.md` and not created: nothing writes conversations yet, and a migration for tables no code fills is schema debt. Observability records to an injected sink; the database sink lands with the feature that produces conversations.
- **The read loop is not built.** The orchestrator can call a model with tools, and `dispatchToolCall` executes one — but the multi-turn loop that feeds results back belongs with the assistant in Phase 9.

---

## Phase 7 final verification — 2026-09-03

**Verdict: B — implementation complete, verification partially blocked by the environment.** Every application check passes. Two things stop this being an unqualified pass, and neither is application code: the machine's storage is physically unreliable, and the provider's catalogue moved under a routing table written against it.

### The environment fault, found and named

The "repeated machine-level I/O/process failures" carried through Phases 6 and 7 are a **hardware storage fault**, not a code or tooling problem. The Windows System log records, over 30 days:

| Event | Count | Meaning |
|---|---|---|
| `disk` 51 | 30,318 | I/O error during a paging operation on `\Device\Harddisk0\DR0` |
| `storahci` 129 | 245 | the AHCI controller reset the device |
| `disk` 153 | 160 | I/O operation retried |
| `disk` 157 | 160 | **"Disk 0 has been surprise removed"** — the drive left the bus mid-operation |
| `Ntfs` 50 | — | **"{Delayed Write Failed} … The data has been lost"**, naming files inside this worktree |

Disk 0 is the 932 GB `ST1000DM010` HDD hosting `E:\`, and therefore the repository *(true when written; the repository later moved to the SSD, then to `H:`, and now lives on GitHub — see docs/RECOVERY-2026-10.md)*. SMART still reports *Healthy*, which fits a cable, power or controller fault rather than media wear.

**It was caught in the act.** At 01:06:29 on 2026-09-03, during `npm ci`, the drive surprise-removed and NTFS reported a lost delayed write. The result was a silently corrupted 106 MB native binary: `@next/swc-win32-x64-msvc/next-swc.win32-x64-msvc.node` had **every byte from offset 94,371,840 (exactly 90 MiB) to EOF zeroed**, while retaining its full length — a pre-allocated file whose tail never flushed. `next build` loaded that PE image and died with `0xC0000005` (access violation) in 1.6 s. The npm cache was intact (`npm cache verify`: 1,063 entries), so the corruption occurred on extraction, not download. Reinstalling produced a binary byte-identical to a known-good copy, and the build then passed in 48 s.

**Consequence for trust.** Any file on `E:` can be silently corrupted at any moment, with correct length and no error surfaced to the writing process. A green run on this machine is evidence about the code only insofar as the disk behaved during that run. **The drive's cable/power/controller should be replaced, and the repository re-verified afterwards, before Phase 7 is called fully verified.**

A second, unrelated environment effect is worth recording because it wastes time: Git-Bash on Windows emulates `fork()` via `CreateProcessW`, so a shell loop spawning a subprocess per file exhausts the process table at a few hundred spawns (`fork: Resource temporarily unavailable`, and a spurious "working directory was deleted"). Whole-tree scans must run as **one** process, not a per-file loop.

### Corruption found and repaired

**14 tracked files carried double-encoded UTF-8** (mojibake): text written as UTF-8, misread as CP1252, re-encoded as UTF-8. An em dash — one character, bytes `E2 80 94` — came back as the three characters CP1252 assigns to those bytes (`U+00E2 U+20AC U+201D`), and every other non-ASCII character expanded the same way. It is *valid* UTF-8, which is why an encoding-validity check cannot see it and why it survived earlier passes.

*(Described by codepoint rather than quoted, deliberately: a literal example here would make this file register as corrupt in its own scan, and invite a later repair pass to "fix" the illustration.)*

Two separate write events, both from the PowerShell write path already blamed in the 2026-08-31 entry:

| Introduced by | Files | Previously repaired? |
|---|---|---|
| `ddbaf86` (Phase 6.9) | `scripts/check-no-client-secrets.ts`, `src/server/services/market-data.ts`, `tests/integration/market-data-equity.test.ts`, `tests/unit/market-data-source-scan.test.ts` | **no — never** |
| `c9fe823` (Phase 7) | `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/SECURITY.md`, `docs/TESTING.md`, `src/server/ai-read/{index,projections,queries}.ts`, `src/server/ai/tools/dispatch.ts`, `tests/unit/ai-provider.test.ts` | **partially** — `cbc0637` fixed four documents and missed these ten |

The 2026-08-31 claim that the mojibake was "repaired here" was therefore **incomplete**, and is corrected by this entry.

**1,468 sequences repaired across the 14 files, verified three ways:** every file shows equal `+N -N` in `git diff --numstat` (pure in-place substitution, no structural change); re-corrupting the repaired text reproduces the original byte-for-byte; and for `docs/ARCHITECTURE.md` the repaired box diagram is **byte-identical to the last clean ancestor** (`c773551`), including its pre-existing ragged right edge. All 16 non-comment occurrences were `describe()` labels and one `console.error` string — no identifier, key, comparison or control flow. The affected tests were re-run and pass unchanged.

The box-drawing characters needed a second pass: `┐` is `E2 94 90`, and `0x90` is **undefined** in CP1252, so the decoder emitted the C1 control character `U+0090` rather than a printable one.

**Two NUL bytes are not corruption and were left alone**: `'\0uncategorised'` in `domain/calc/cashflow.ts` is a deliberate sentinel map key that no user category can collide with, and `'/\0'` in `tests/unit/safe-redirect.test.ts` is a NUL-injection vector that must be rejected. Both predate Phase 7 and parse cleanly.

### The catalogue moved again

`npm run ai:smoke` on 2026-09-03 returns **82 models, not the 83 recorded on 2026-08-31**, and **`nvidia/nemotron-3-nano-30b-a3b` — the Tier 1 primary — is no longer in it.**

It appears **renamed, not withdrawn**: the catalogue now carries `nvidia/nemotron-nano-3-30b-a3b`, the same words with the version segment transposed. A new generation has also appeared (`nvidia/nemotron-3.5-lightning-30b-a3b`, `nvidia/nemotron-3.5-content-safety`). This is the third identifier drift in this pool, after `deepseek-v4-flash` → `-0731` and the GLM correction.

**Routing was deliberately not changed.** A transposed name is not proof of the same model, `CLAUDE.md` requires evaluation against real workloads before a route is finalised, and inventing a replacement is exactly the failure this project keeps catching. It is recorded here for Phase 8 to resolve with the eval harness.

**Runtime impact — degraded, not broken.** `transport` carries the `next_candidate` disposition (`ai/errors.ts`), so the dead identifier fails and the chain falls through to `openai/gpt-oss-20b`; the circuit breaker then opens on it and stops trying. Tier 1 keeps serving. The cost is one wasted request and round-trip per breaker window. **Tiers 2, 3 and 4 are unaffected — every identifier they route to is still present.**

### Verification matrix — run sequentially, one at a time

| Check | Result |
|---|---|
| **Full test suite** | ❌ **1,555 passed, 3 failed, 1,558 total** (75 files) · **641 s** |
| Typecheck | ✅ clean (4 s) |
| Lint | ✅ clean (59 s) |
| Production build | ✅ clean (48 s) — **after** repairing the disk-corrupted native binary; it segfaulted before |
| `verify:integrity` | ✅ **33 passed, 0 failed, 28 engine-enforced, 2 deferred** |
| `check:no-client-secrets` | ✅ no secret in 21 client files (7 values checked across `.next/static`) |
| AI security probes | ✅ boundary source scan, write boundary, read capability — all pass |
| Deterministic AI provider/routing/tools | ✅ **114 passed** across 6 files |
| AI integration (`ai-infrastructure`) | ✅ pass |
| Live NVIDIA smoke test | ✅ catalogue, generation (2,897 ms), structured output *valid*, unknown model → `transport` |

**The three failures are a test defect, not an application regression, and not the environment.** All three are in `tests/integration/jobs.test.ts` (a Phase 3 file, untouched by Phase 7) and all assert `expected 3 to be 2`. They fail identically in isolation, so they are deterministic rather than contention.

The cause is a **date-dependent test**. The fixture pins the clock — `setupMoneyFixture({ now: '2026-08-10' })` — but `runDueJobs()` reaches the job handler, which calls `createReadCtx(userId)` and builds a **fresh context from the real system clock** (`services/_ctx.ts`, `today: todayIn(timezone, now)`). The pin covers the assertion context and not the job's execution context. With a rule starting `2026-07-01` and `postDueOccurrences` posting everything where `due_on <= ctx.today`, three occurrences are due on 2026-09-03 where two were due on 2026-08-10. **Three is the correct application answer.** The suite was last green on 2026-08-30 and broke on 2026-09-01 with no code change.

Not fixed here: this task was scoped to verification, and the fix belongs with the recurring/ledger area — either injecting a clock into the job path or making the assertion relational (post-run count unchanged by a second run) rather than absolute. Bumping `2` to `3` would re-arm the same bomb for October.

### What remains true, and what is not yet proven

- The AI layer is still read-only, and each control is enforced by a mechanism rather than a convention: types (`AiReadCtx` cannot become a `WriteCtx`), the ESLint allowlist (deny `@/server/**`, re-admit `ai-read` and `log`), a source scan that reads its patterns *from* `eslint.config.mjs`, and runtime binding in a module-private `WeakMap`. I-50 … I-58 all pass.
- No credential reaches a client bundle, a log, a test file or a tracked file — re-checked against the real build.
- **Not proven on this machine:** that a full-suite green run is repeatable, because the disk can corrupt any file mid-run without reporting it. This is the sole reason the phase is **B** rather than **A**.

---

## Development environment moved to SSD — 2026-09-09

**`E:` is no longer the canonical development location.** The repository now lives at:

```
C:\Dev\AI Enabled Personal Finance          ← canonical, on the SSD
```

### Why

`E:` is a partition of **Disk 0** (`ST1000DM010`, 931.5 GB, HDD), the drive whose fault is documented in the 2026-09-03 entry. It was still failing at the time of the move: in the seven days to 2026-09-09 it logged a further **93 paging-I/O errors, 5 surprise-removal events and 6 NTFS delayed-write failures**. `G:` is the other partition of the same disk and is equally affected. `H:` is a second HDD (Disk 1). **Disk 2 — `WDC WDS240G2G0B`, 223.6 GB, SSD — is the only solid-state device, and it is `C:`.** That made the target unambiguous.

**Nothing was repaired.** The failing drive has not been fixed, replaced or re-cabled. The work was moved off it.

### How, and why it was a clone rather than a copy

The migration used `git clone`, not a file copy, for one reason: **git verifies a checksum over every object it transfers, and a file copy verifies nothing.** On a disk that silently returns zeroed tails — as it did to a 106 MB binary on 2026-09-03 — a copy is exactly the operation that cannot detect what it just lost.

Before the clone, `git fsck --full --strict` on the source **exited 0**: the object database on the failing disk was intact, so there was a good copy to take. After the clone, verification was explicit rather than assumed:

| Check | Result |
|---|---|
| `git fsck --full --strict` on the SSD clone | exit 0 |
| All 10 branch SHAs, source vs clone | identical |
| `HEAD^{tree}` source vs clone | `1a6f135e…` on both sides |
| Tracked files vs their blobs | clean |
| `.env` SHA-256, source vs copy | identical (824 bytes, 10 variables) |

`node_modules`, `.next` and every other generated artefact were **not** copied; they were rebuilt from the lockfile with `npm ci`. The point of the move is to stop trusting what that disk wrote, and a generated artefact is the cheapest thing in the tree to reconstruct.

**The `origin` remote was removed.** The clone briefly pointed at `E:`, and leaving it would have made a failing disk the upstream of the healthy checkout.

**This repository has no remote at all, and that is now the largest single risk to the project.** Every commit from Phase 0 to here exists in exactly two places, both local, one of them on a dying drive. A backup — an external disk or a private remote — is worth more than any remaining Phase 7 work.

### What was left where it was

**PostgreSQL was not touched.** Its data directory is `C:\Program Files\PostgreSQL\18\data` — already on the SSD, never on the failing disk. Service `postgresql-x64-18` running and listening on 5432; all four roles connect; `financeos` and `financeos_test` both reachable with 30 tables each; data intact (2 users, 6 accounts, 58 categories, 20 audit rows). No reset, no migration, no recreation.

The old `E:` tree was left in place, untouched and clean, as a fallback. It is no longer canonical and no longer receives work.

### The date-bomb test, fixed at the runner

The three `jobs.test.ts` failures recorded on 2026-09-03 are resolved, and the fix is in the job runner rather than in the assertions.

**The defect.** `setupMoneyFixture({ now })` pinned `fixture.ctx` — which is what the assertions read — but `runDueJobs()` reached `createReadCtx(userId)` inside the handler, which built a *fresh* context from `new Date()`. The fixture pinned the observer and not the subject, so how many occurrences the job posted was a function of the machine's calendar. The file was green on 2026-08-30 and red on 2026-09-01 with no code change.

**The fix.** `JobDeps { now: Date }` is threaded from `runDueJobs` through `runOne` into every handler, and `RECURRING_POST` passes it to `createReadCtx`. The instant is resolved **once per run**, so two jobs claimed by the same run cannot disagree about the date. This is the injection the codebase already uses everywhere else — `createReadCtx`'s `now`, the AI circuit breaker's `now` — extended to the one path still reading the clock behind its caller.

**Recurring semantics are unchanged.** `postDueOccurrences` still posts exactly `due_on <= ctx.today`, and production calls `runDueJobs()` with no `now` and gets the wall clock as before. What changed is that the clock became *reachable* from a caller.

**No assertion was weakened.** `toBe(2)` still stands; bumping it to `3` was explicitly rejected, because that would have re-armed the same bomb for October. Two regression tests were added: one runs the identical rule at three injected instants (2026-08-10 → 2, 2026-11-05 → 5, 2027-02-01 → 8), and one asserts that two runs at the same instant agree with each other and with the literal 2.

**The guard was proved non-vacuous.** With the one-line fix reverted, 5 of the 10 tests in the file fail, including both new ones. With it in place, all 10 pass.

### Baseline on the SSD

| Check | E: (2026-09-03) | C: (2026-09-09) |
|---|---|---|
| Typecheck | ✅ 4 s | ✅ **4 s** |
| Lint | ✅ 59 s | ✅ **63 s** |
| Production build | ❌ **segfault `0xC0000005`** until a corrupt binary was reinstalled | ✅ **38 s, first attempt** |
| `verify:integrity` | ✅ 33 / 0 / 28 / 2 | ✅ **33 / 0 / 28 / 2** |
| `check:no-client-secrets` | ✅ | ✅ **21 files, 7 values** |
| Full suite | ❌ 1,555 pass / **3 fail** / 1,558 · 641 s | ✅ **1,560 pass / 0 fail / 0 skipped · 75 files · 547 s** |

The authoritative run is `npm test` from `C:\Dev\AI Enabled Personal Finance` on 2026-09-09: **75 test files, 1,560 passed, 0 failed, 0 skipped, 547 s** (exit 0). Two more tests than the 1,558 counted on `E:`, which are the two regression guards added with the runner fix. Wall-clock fell from 641 s to 547 s.

**Phase 7 is now category A — fully verified** — on the SSD checkout, with one qualification that is deliberately *not* an environment caveat: no model has been measured, so routing remains gated by `capabilities.ts` and Phase 8 still owns model selection. The reason the phase was **B** on 2026-09-03 was the storage, and the repository no longer sits on that storage.

**The failing drive still exists and is still failing.** Nothing in this entry should be read as a repair. `E:` and `G:` remain partitions of Disk 0, and anything still stored there is at risk.

---

## Open decisions

| # | Decision | Blocks |
|---|---|---|
| **OD-2** | `AGENTS.md` is byte-identical to `CLAUDE.md`. Two copies of a 2,181-line spec will drift. Recommendation: reduce `AGENTS.md` to a pointer — not done unilaterally, as another tool may require full content at that path | Nothing technically; an instruction-correctness risk |
| **OD-3** | Equity/ETF market-data provider and its terms. **Phase 4 consequence:** `instrument_prices` stays empty, so TWR returns `null` with `insufficient_price_history` and portfolio growth renders as gaps. Both are the documented behaviour, not defects. **Recommendation added 2026-08-18:** **Twelve Data Grow, $29/mo** (verified: India = XNSE at EOD, needs Grow+; terms permit storing data for internal use) for coverage consolidation across Indian + international equities, ETFs, FX and crypto in one adapter. **Kite Connect at ₹500/mo** is a legitimate cheaper alternative if a Zerodha account exists and no international coverage is needed — but its login expires daily, which is hostile to an unattended refresh job, so it costs engineering what it saves in fees. Free routes were evaluated and **excluded on licence grounds**, not overlooked: NSE's terms prohibit automated collection from its website, and Yahoo-compatible sources have no licence for programmatic access. This is a cost-and-account decision, not an engineering one | **Step 6.9 only — not the phase.** Eleven of twelve steps are unblocked ([MARKET-DATA-DESIGN.md §20.J](docs/MARKET-DATA-DESIGN.md#j-implementation-sequence)) |
| **OD-18** | **Where the scenario engine, the three missing metrics, and the TWR wiring belong.** ⏸ **Deferred 2026-08-30 — explicitly not Phase 7.** `run_financial_scenario` has no backing of any kind; `calculate_financial_metrics` has 1 of 4 metrics; `twr()` and `growthSeries()` are implemented, tested and called by nothing (`portfolio.ts` hardcodes `twr: unavailable('insufficient_price_history')`). All three are **deterministic financial-engine work** and are **removed from the Phase 7 tool registry rather than stubbed**. The governing rule is now normative in `AI-SYSTEM.md` §8: *an AI capability exists only where a deterministic application capability already exists or has an explicitly approved implementation path.* **AI must not become a substitute for missing financial-engine functionality.** Scheduling is a later decision — a Phase 6.12 step, or folded into Phase 9 | Nothing in Phase 7 |
| **OD-19** | **The Overview page is still a Phase-2 placeholder.** ⏸ **Deferred 2026-08-30 as a future product/UI work item — explicitly not a Phase 7 blocker.** `app/(app)/page.tsx` renders "Money arrives in Phase 3" while Phases 3–6.11 are complete. `CLAUDE.md <overview>` makes it a MUST-BUILD surface and every figure it describes is now computable. It is not redesigned or implemented now; it is scheduled with the Phase 9 UX pass | Nothing. Phase 7 proceeds without it |
| **OD-13** | **AMFI reuse terms.** `NAVAll.txt` is published publicly and the whole Indian fintech industry consumes it, but **no machine-readable licence or explicit reuse grant was found**, so none is asserted. The adapter is built for personal, non-redistributing use and says so in its own header. Confirm with AMFI before any non-personal use | Nothing for personal use; would block redistribution |

### Resolved

| # | Decision | Outcome |
|---|---|---|
| **OD-1** | `NVIDIA_API_KEY` | ✅ **Resolved: the key was configured and the 7.7 live smoke test and the authenticated catalogue read ran.** No longer blocks anything |
| **OD-17** | How to close the AI write boundary (Phase 7 review **F-1**/**F-2**) | ✅ **Resolved 2026-08-30 by the recommended option: narrow the context the AI layer receives.** The AI layer holds an `AiReadCtx` — no `db`, no `fx`, no transaction capability, and **not** a `ReadCtx` — so both the escalation and the raw write are compile errors. `withWriteCtx` now requires a `RequestCtx` carrying `beginTransaction`, granted only by `createReadCtx`; changing that signature made `tsc` report every escalation site, and all three were test harnesses legitimately standing in for a user request. **AI infrastructure is strictly read-only**, and any future AI-assisted mutation needs a separate approved proposal/confirmation workflow. Normative: [ADR-33](docs/DECISIONS.md#adr-33--the-transaction-opener-is-a-capability-carried-on-the-context-not-an-ambient-import), [ADR-34](docs/DECISIONS.md#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths), [ADR-35](docs/DECISIONS.md#adr-35--ai-infrastructure-is-strictly-read-only-a-mutation-needs-a-separate-approved-proposal-workflow). Invariants **I-50 … I-52** |
| **OD-4** | Amend the approved baseline with the Phase 4 review's D1–D15 | ✅ **Approved and applied 2026-08-11.** The corrections are in the canonical documents; the landing table is at the top of [INVESTMENT-ENGINE-DESIGN.md](docs/INVESTMENT-ENGINE-DESIGN.md), which is now a review record, not a specification |
| **OD-5** | `investment_transactions.net_amount` currency | ✅ **Approved 2026-08-11: the account's currency.** `price` / `gross_amount` / `fees` / `taxes` stay in the instrument's. `deriveBalance()` therefore never mixes currencies, and an account's `currency_code` is immutable once it carries ledger rows. See [FINANCIAL-DOMAIN.md §3](docs/FINANCIAL-DOMAIN.md), [SCHEMA.md §6](docs/SCHEMA.md), [ADR-12](docs/DECISIONS.md) |
| **OD-7** | Net-worth valuation basis before market data exists | ✅ **Approved 2026-08-12: Net Worth at Cost.** Phase 5 calculates and presents net worth **at cost**; investment positions contribute the **exact Phase 4 cost basis**; market value and cost are **never mixed inside one figure**; no screen shows an unqualified "Net worth" that could imply a current market valuation. Phase 6 introduces market-value net worth as a **distinct** calculation. **No valuation toggle in Phase 5** — the existing design does not need one. Normative: [ADR-23](docs/DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost) |
| **OD-8** | `net_worth_snapshots` and the `networth.snapshot` job | ✅ **Approved 2026-08-12: moved to Phase 6.** Phase 5 uses deterministic derivation; **every Phase 5 gate requiring a snapshot is removed**; `user_state.valuation_version` is deferred with them. Phase 6 may still introduce snapshots if measurement justifies it, under four stated rules. Normative: [ADR-24](docs/DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6) |
| **OD-10** | Apply the Market Data review's M1–M13 to the canonical documents | ✅ **Approved and applied 2026-08-18.** Reconciled, not appended: four findings became [ADR-27](docs/DECISIONS.md#adr-27--market-data-adapters-return-observations-the-registry-classifies-freshness) … [ADR-30](docs/DECISIONS.md#adr-30--one-provider-per-instrument-price-series-the-only-price-fallback-is-manual); the rest folded into `FINANCIAL-DOMAIN.md` §2, `INVESTMENT-DOMAIN.md` §5/§8.1/§10/§11, `SCHEMA.md` §5/§5.1/§12 and `TESTING.md` §6. Invariants **I-33 … I-40** added, and **all thirteen findings are implemented**, not merely documented |
| **OD-11** | Crypto market data | ✅ **Deferred 2026-08-18.** No adapter ships. The `continuous` cadence and its wall-clock branch are implemented and tested, so enabling crypto later is an adapter rather than a rule change |
| **OD-12** | Dedicated gold market data | ✅ **Deferred 2026-08-18.** Gold prices as a gold ETF or gold MF through the ordinary adapters, or as a `manual_assets` valuation series. No bullion feed, no purity/unit model |
| **OD-9** | Apply the Net Worth review's N1–N19 to the canonical documents | ✅ **Approved and applied 2026-08-12.** The normative rules were **reconciled**, not appended to — each now has one authoritative statement. Four findings became ADRs ([ADR-23](docs/DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost), [ADR-24](docs/DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6), [ADR-25](docs/DECISIONS.md#adr-25--net-worth-classification-is-by-the-economic-sign-of-the-balance-not-by-account-kind), [ADR-26](docs/DECISIONS.md#adr-26--an-as-of-financial-figure-is-computed-from-dated-facts-only-no-current-state-flag-participates)); the rest were folded into `FINANCIAL-DOMAIN.md`, `SCHEMA.md`, `INVESTMENT-DOMAIN.md`, `ARCHITECTURE.md` and `TESTING.md`. Per-finding disposition: [NET-WORTH-DESIGN.md §14](docs/NET-WORTH-DESIGN.md#14-defects-found-in-the-baseline-n1n19). **No source file, schema, migration or test was touched** |
| **OD-6** | `settlement_date` semantics | ✅ **Resolved 2026-08-11: financial recognition is trade-dated.** `trade_date` is the financial recognition date and the cash date; `settlement_date` is a recorded factual attribute of the transaction and controls nothing — not recognition, not cash-balance derivation, not ledger dating, not replay, and not historical or `asOf` calculations. `deriveBalance()` and `replay()` continue to use the trade-dated ledger. **No settlement-date-based cash movement is to be introduced, and settlement-aware accounting logic is out of scope for the current architecture.** Because balances are trade-dated, a displayed balance can differ from the broker's cleared cash for up to one settlement cycle, so **the UI should make clear that displayed balances are trade-dated rather than settlement-dated**. Normative record: [ADR-22](docs/DECISIONS.md#adr-22--financial-recognition-is-trade-dated-settlement_date-is-informational-metadata), with the rule restated in [FINANCIAL-DOMAIN.md §3](docs/FINANCIAL-DOMAIN.md#3-accounts), [SCHEMA.md §6](docs/SCHEMA.md#6-investment-ledger) and [INVESTMENT-DOMAIN.md §3](docs/INVESTMENT-DOMAIN.md#ordering) |

---

## Known debt and accepted risks

Recorded so these are not rediscovered as bugs.

**Carried from Phase 1**
- **`instruments` is per-user** (`UNIQUE (user_id, symbol, exchange)`). Correct at one user, wrong at ~10k — a migration, not a redesign.
- **Balances are computed on every read**, no stored column. Escape hatch pre-designed: a materialised roll-up keyed by `money_ledger_version`.
- **No Row-Level Security.** Fine single-user; the priority item if this ever becomes multi-tenant.
- ~~**`PortfolioSnapshot`** folded into `net_worth_snapshots.breakdown` (JSONB). Flagged for a decision before Phase 6.~~ **Resolved 2026-08-11**: no `portfolio_snapshots` table. Historical portfolio value is derivable from `investment_transactions` + `instrument_prices` in a single SQL pass; the escape hatch is a roll-up keyed by `investment_ledger_version`, never a mutable record ([INVESTMENT-ENGINE-DESIGN.md §8.3](docs/INVESTMENT-ENGINE-DESIGN.md)).
- **Tier 5 embeddings deferred** with written activation criteria ([ADR-19](docs/DECISIONS.md)).
- **Liability `interest_rate` / `emi_amount` are descriptive only** — no amortisation schedule is computed, and the UI must not imply one.

**New in Phase 2**
- **The compromised-password list is a starter set** (`src/server/auth/common-passwords.ts`, ~110 entries). The 12-character minimum already excludes most published breach corpora, but Phase 11 should bundle a filtered real extract or use the HIBP range API. The limitation is written at the top of that file.
- **No TOTP QR code.** Enrolment shows the base32 secret and the `otpauth://` URI; every authenticator supports manual entry. A QR renderer is a dependency Phase 2 did not need — revisit in Phase 10.
- **4 moderate `npm audit` advisories**, all one advisory (GHSA-67mh-4wv8-2f99, esbuild dev-server CORS) reaching us through `drizzle-kit → @esbuild-kit/*`, which upstream has deprecated. Development-only, never in a runtime bundle, and below the `high` threshold SECURITY.md §11 sets. `npm audit fix --force` would downgrade drizzle-kit to 0.18.1 — a breaking change for a vulnerability we are not exposed to. Re-check when drizzle-kit drops the dependency.
- **Session revocation UI is not built.** `revokeSession` / `revokeOtherSessions` exist and are tested; Settings lists active sessions but offers no revoke button until Phase 10.
- **No E2E suite yet.** Playwright is Phase 12; Phase 2 workflow verification was done by hand in a browser and is recorded below.
- **~~PostgreSQL does not start automatically.~~** Resolved by D-23 — it is a Windows service with `Automatic` start.
- **A PostgreSQL 17.7 rollback is still on disk**, unused: the old data directory `E:\Claude\_tools\pgdata` (91 MB) and the portable install `E:\Claude\_tools\pg17` (897 MB), plus logical dumps under `E:\Claude\_tools\pg-migration-backup-20260810-233153\`. Delete once PostgreSQL 18 has proven itself. The dumps contain a password hash and an encrypted TOTP secret, so they are deliberately outside the repository and must never be committed.
- **CI still tests against `postgres:17`** (`.github/workflows/ci.yml`), while development is now 18.4. Not changed here because it decides what the suite is tested against, which is a call worth making deliberately rather than as cleanup.

**New in Phase 5**
- **Net worth is at cost, and says so on every screen.** Investments contribute their acquisition cost until Phase 6 ([ADR-23](docs/DECISIONS.md#adr-23--net-worth-carries-a-declared-valuation-basis-phase-5-ships-net-worth-at-cost)). A user who has hand-entered prices will see market value on Investments and cost on Net Worth; the basis banner exists so that reads as a stated fact rather than a discrepancy.
- **Coverage is a component count, not a value ratio** (D-29). Honest but coarser than `FINANCIAL-DOMAIN.md` §9.3 asks for, and unavoidable while the only exclusion cause is a missing rate. Phase 6 can make it value-weighted.
- **A manual-asset disposal inflates the savings rate for that period.** The proceeds are ordinary income while the asset they replaced never was, so `income` rises by the whole sale. Net worth is unaffected — the bridge nets the proceeds against the asset's last valuation — and the seeded `Other Income → Asset sale proceeds` category exists so the receipt can be filtered out of a savings reading. A structural fix needs a fifth transaction shape for one case, and is deferred ([FINANCIAL-DOMAIN.md §9.4](docs/FINANCIAL-DOMAIN.md#94-asset-and-liability-lifecycle)).
- **A scheduled liability's repayment is recorded as an expense**, because there is no account to transfer to. The bridge closes — savings falls and the liability line rises by the same amount — but the savings rate for that period reads low. Inherent to the scheduled shape; a transacted liability has no such artefact.
- **`user_state.valuation_version` is not added.** Nothing in Phase 5 reads it, because net worth is derived and there is no cache to invalidate. It is a prerequisite for any Phase 6 snapshot ([ADR-24](docs/DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6) rule 3).
- **The CSP inline-style console errors are development-only, and this is now measured rather than assumed.** The same route rendered by `next start` from the production build logs **zero** console errors; the dev server logs them on every load. Only the server differs, which confirms the Turbopack HMR client as the source (carried Phase 3 debt). No application file emits an inline `style` attribute — `ProportionBar` uses static width classes for exactly this reason (D-27).
- **This worktree now has its own `node_modules`.** `next build` under Turbopack resolves the workspace root from the nearest lockfile and then requires `next/package.json` beneath it, so a worktree sharing the parent's install cannot build (a junction is rejected: *"points out of the filesystem root"*). `npm ci` in the worktree is the fix, and the Phase 4 worktree had already done the same.

**New in Phase 3**
- **Deleting a user is not one statement.** `SCHEMA.md`'s conventions claim it is, and it is not: `users → accounts` cascades, but `transaction_entries.account_id` is `ON DELETE RESTRICT`, and Postgres does not order cascades so it can hit the restricted edge first. Deleting a user therefore fails unless `transactions` are deleted first. **`RESTRICT` is the right rule** — it is what stops an account with history being deleted — so the fix belongs in the deletion *service* (delete transactions, then the user, in one transaction), not in the schema. Nothing depends on this until data deletion is built in Phase 11; recorded so it is not rediscovered as a bug then.
- **A transfer cannot be edited from the transactions page.** `updateTransfer` exists, is tested, and rebuilds both legs together; the transactions table offers only Delete for a transfer, because a two-leg edit form is UI work Phase 3 did not need. Deleting and re-entering is correct in the meantime.
- **No inline edit in the transactions table.** ROADMAP listed it; the table is read-and-delete plus the quick-add composer. Deferred to the Phase 10 UX pass rather than half-built.
- **`recurring.post` is driven by cron, not by an in-process scheduler.** `npm run jobs:run` drains the queue; nothing schedules it automatically yet. Deployment (Phase 13) owns the cron entry.
- **The dev server logs CSP violations for inline styles.** They come from Turbopack's HMR client in development only; the production build's styles are in a stylesheet and the nonce-based CSP is unaffected.

---

## Phase 2 verification record

Run on 2026-08-09 against the production build, not the dev server.

| Check | Result |
|---|---|
| Migrations from an empty database | ✅ applied; grants re-applied |
| Rollback then re-migrate | ✅ schema fingerprint byte-identical |
| Seed run twice | ✅ 12 currencies both times |
| `npm test` | ✅ **282 passed**, 0 skipped (17 files) |
| `npm run typecheck` | ✅ clean |
| `npm run lint` | ✅ clean |
| `npm run build` | ✅ 9 routes |
| `npm run check:no-client-secrets` | ✅ no secret in 17 client files |
| `npm audit --audit-level=high` | ✅ exit 0 |
| Unauthenticated route → login | ✅ 307 to `/login?next=%2Finvestments` |
| Password step alone | ✅ no session row created |
| Wrong TOTP code | ✅ rejected, no session |
| Correct TOTP code | ✅ session issued, returned to the originally requested page |
| Session cookie | ✅ `HttpOnly` — invisible to `document.cookie` |
| Token storage | ✅ only SHA-256 in `sessions.token_hash` |
| Sign out | ✅ row deleted, protected routes redirect again |
| `auth_events` trail | ✅ `totp_failure`, `login_success`, `logout` |
| Security headers | ✅ CSP with per-request nonce + `strict-dynamic`, HSTS, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, COOP/CORP, no `X-Powered-By` |
| Mobile at 375 px | ✅ sidebar hidden, bottom nav fixed, no horizontal overflow |
| `GET /api/health` | ✅ `200 {"status":"ok"}` |

**Bugs found and fixed during Phase 2 verification** (recorded because each passed an earlier gate):
1. `app/(auth)/login/actions.ts` exported a constant from a `'use server'` module — accepted by `tsc` and by `next build`, HTTP 500 on the first POST. Fixed by moving the state shape to `form-state.ts`; `tests/unit/server-actions.test.ts` now guards the rule and was itself verified to fail on a deliberate violation.
2. The authenticated layout redirected to `/login` without the return path. Fixed by passing the pathname through an `x-pathname` request header from `proxy.ts`.
3. `Money.parseUserInput` accepted `1,5` as fifteen. Fixed to validate digit grouping (D-16).
4. Argon2id at 64 MiB measured 158 ms against a ≥250 ms requirement, and the source comment claimed 310 ms without having measured. Fixed to 128 MiB and the real measurement table recorded.

---

## Phase 3 verification record

Run on 2026-08-10.

| Check | Result |
|---|---|
| `npm test` | ✅ **663 passed** — 433 unit + property, 230 integration |
| `npm run typecheck` | ✅ clean |
| `npm run lint` | ✅ clean |
| `npm run build` | ✅ 15 routes, 6 of them money |
| `npm run check:no-client-secrets` | ✅ no secret in 18 client files |
| `npm run verify:integrity` | ✅ 8 passed, 0 failed, 7 not yet applicable |
| Migrate → roll back → migrate | ✅ fingerprint identical, now including constraints, triggers and functions |
| Golden scenario **G1** | ✅ 14 assertions against hand-computed figures |
| Transfer excluded from income/expense | ✅ in the engine, in the services, in a tag report, and on screen |
| 200-transaction fixture | ✅ balance matches the hand-computed ₹49,985.0000 |
| Recurring 31st across February | ✅ 28 Feb 2026 and 29 Feb 2028, clamped rather than skipped |
| Double post, same occurrence | ✅ one transaction, in tests and through the real UI |
| Two concurrent job runners | ✅ each job and each occurrence handled exactly once |
| Live workflow | ✅ account → expense → income → transfer → budget → recurring rule → post, in a browser |
| Savings rate with zero income | ✅ renders `—` with "the denominator is zero", never `0%` |
| Mobile at 375 px | ✅ no horizontal overflow, sidebar hidden, bottom nav fixed |

**Bugs found and fixed during Phase 3 verification:**
1. **A failed recurring posting kept its claim** — the occurrence was marked `posted` with no transaction behind it (I-9 violated, commitment silently skipped). Found by an integration test; fixed with a savepoint (D-21).
2. **An extreme savings rate threw out of a page render** — found by a property test; fixed by returning `out_of_range` (D-19).
3. **A duplicate default category name was silently dropped** by `ON CONFLICT DO NOTHING` — found by asserting the seeded count; fixed by renaming and by refusing a list with duplicates (D-20).
4. **`quarterRange` stepped back to the fiscal year start instead of the quarter start** — found by a unit test before anything consumed it.
5. **A render-prop form crashed every page that used one** — "Functions are not valid as a child of Client Components". It typechecked, linted and built; only loading the page in a browser caught it. Fixed by making each form a concrete client component.
6. **`rollbackLast` reversed the newest migration twice** when two existed, because it indexed the end of the journal rather than the applied count.

---

## Where knowledge lives

| Question | File |
|---|---|
| Why was X decided that way? | [docs/DECISIONS.md](docs/DECISIONS.md) — 26 ADRs with rejected alternatives, plus D-9…D-23 above and D-24…D-27 in [ROADMAP.md](docs/ROADMAP.md) Phase 4 |
| What are the tables and invariants? | [docs/SCHEMA.md](docs/SCHEMA.md) — 32 invariants (I-1 … I-32) plus six explicit non-invariants |
| How does money behave? | [docs/FINANCIAL-DOMAIN.md](docs/FINANCIAL-DOMAIN.md) |
| How do holdings and returns behave? | [docs/INVESTMENT-DOMAIN.md](docs/INVESTMENT-DOMAIN.md) — corrected and authoritative |
| Why does the investment engine work that way? | [docs/INVESTMENT-ENGINE-DESIGN.md](docs/INVESTMENT-ENGINE-DESIGN.md) — the Phase 4 review record and rationale. **Non-normative**: where it and a canonical document differ, the canonical document wins |
| How is net worth meant to work, and why? | [docs/NET-WORTH-DESIGN.md](docs/NET-WORTH-DESIGN.md) — the Phase 5 design review: single counting, as-of methodology, FX, liabilities, reconciliation, the schema delta, 43 edge cases, and the N1–N19 disposition table. **Non-normative** — the rules themselves now live in `FINANCIAL-DOMAIN.md` §9, `SCHEMA.md` §7–9/§12 and ADR-23…ADR-26 |
| How is the AI layer meant to work, and what can't it do? | [docs/AI-INFRASTRUCTURE-DESIGN.md](docs/AI-INFRASTRUCTURE-DESIGN.md) — the Phase 7 review: the write-boundary defects, model tiers and the provisional stack, routing, the real tool surface, mutation, context budgets, prompt injection, cost, the RAG decision and the implementation sequence. **Non-normative** |
| How does market-value net worth work, and why? | [docs/MARKET-VALUE-NET-WORTH-DESIGN.md](docs/MARKET-VALUE-NET-WORTH-DESIGN.md) — the Phase 6.11 review: the two bases, single counting under market, price selection, partial valuation, the restatement, historical reconstruction, precision, the snapshot measurement and 26 adversarial scenarios. **Non-normative** — the rules live in `FINANCIAL-DOMAIN.md` §9.3/§9.5/§9.6, `INVESTMENT-DOMAIN.md` §5.1, `SCHEMA.md` §12 and ADR-31/ADR-32 |
| Where do prices come from, and which provider? | [docs/MARKET-DATA-DESIGN.md](docs/MARKET-DATA-DESIGN.md) — the Phase 6 review: data requirements, ten providers evaluated against verified official sources, the TWR and market-value-net-worth dependencies stated precisely, staleness, missing-data behaviour, caching, persistence, cost, 20 adversarial scenarios, and the M1–M13 defect table. **Non-normative** until OD-10 |
| How does the AI layer work and what can't it do? | [docs/AI-SYSTEM.md](docs/AI-SYSTEM.md) |
| What must be tested before a phase is done? | [docs/TESTING.md](docs/TESTING.md) and each phase's "Done when" |
| What am I building next? | [docs/ROADMAP.md](docs/ROADMAP.md) — **Phase 8, Model Evaluation**. Start with the golden task corpora for `src/server/ai/eval/harness.ts`; run `npm run ai:catalogue` first to see the current catalogue (ADR-45) |

### Transaction review follow-up — 2026-11-03

PR #39 now preserves raw user corrections after rejected confirmation actions by returning edits and remounting the review form with those values. This avoids React action resets discarding decimal precision, account choices, descriptions and notes. Confirmation is unchecked again after a rejected submission. A client expiry timer updates the open review and disables confirmation at its deadline; the server remains authoritative. A local headless Chromium check using fake actions verified rejected-edit preservation and live expiry. Focused tests: 53 passed; typecheck, lint and production build verified. No model calls.

**Next authorization:** build the read-only financial assistant separately, fake providers only and disabled until owner approval of the Phase 8 lineup. No tier/gate changes. OpenRouter funding is still pending today. Once ready, its adapter must require ZDR, deny data collection, prefer DeepInfra with price ordering and allow only ZDR fallback hosts. Measurements must include the actual serving host in provenance. OpenRouter handles host routing; do not build an application host router. Finish the remaining GPT-OSS-120B/20B and Qwen vision suites, then propose the lineup without `--record` pending approval.

## Phase 9 read-only assistant slice — owner-approved 2026-11-03

**Why early:** the owner authorized this next application slice while OpenRouter funding is pending, expanding the previous transaction-entry-only scope. Work is isolated on `codex/phase-9-readonly-assistant`, based directly on main after PR #38; it does not require or merge PR #39. The financial assistant is tested with fake providers only, with no live model call.

- Added an in-memory, single-question read session that reuses the **unchanged** finance-question prompt, `answerFinanceQuestion` capability, closed tool registry and owner-bound dispatcher. It accepts no model/tier/user override from question text or model output. No conversations or new financial schema are stored.
- Bounded at four model turns, eight tool calls and 64 KiB of accumulated tool results. Oversized batches, duplicate call IDs, incomplete/empty/oversized answers and exhausted budgets fail closed. Individual tool failures remain data for a bounded follow-up; source payloads retain missing metrics, reasons, dates, currency and clipping metadata.
- Added a safe answer view separating model interpretation from financial source facts/calculations, with exact decimal text and explicit unavailable reasons. Model/source text is escaped, never interpreted as HTML or executable Markdown. Scenario projections remain unavailable; no scenario engine/tool was added.
- `/ai` now explains setup approval and shows disabled question controls. The authenticated server action independently returns unavailable without composing a provider, minting a read capability or accessing financial services. No environment flag/fake endpoint can activate it.
- Focused verification: **38 unit tests and 3 PostgreSQL integration tests pass**. Integration checks use the real dispatcher/application-role database with a fake provider: owner isolation, exact service-projected spending totals and unchanged ledger/audits after an attempted write. The twelve question-shaped transport cases verify the runner, **not** real model answer correctness.
- Scope remaining before live use: approved measured lineup; a reviewed composition root using `runAiCapability` on **every** model turn (kill switch, usage budget and rate limit); semantic grounding/answer-quality checks using the actual approved models. Persistent multi-turn conversation history and export/delete integration are not implemented in this slice. This does not mark Phase 9 complete or claim its twelve-question quality gate is passed.
- OpenRouter provider preferences and serving-host provenance requirements from the owner are recorded above. They are separate Phase 8 work and are not changed by this assistant branch. Do not use Groq for these fake-only feature tests.

**Assistant verification complete:** [PR #40](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/40), code commit `dd12ed3`: **2,639 tests pass across 103 files**, including all unit, property and PostgreSQL 17 integration tests (343.53 seconds). Typecheck, lint, production build, client-secret scan and whitespace checks pass. The separate PostgreSQL 17/18 CI matrix is running. PR #39's latest transaction-review fixes have passed both PostgreSQL 17 and 18 CI checks. No live model calls, recorded capabilities, tier-order changes or gate changes were made.

### Saved assistant conversations — 2026-11-03 continuation

This supersedes the initial assistant slice's "persistent history pending" limitation. PR #40 is now **stacked on PR #39** (`codex/phase-9-nl-entry`), rather than independent of it: migration `0008_phase9_assistant_conversations` follows transaction proposals in `0007`. Neither PR was merged by this work.

- Added owner-scoped conversations and ordered user/assistant messages, including source evidence and serving-model/usage metadata. Cost stays `null` because no billing rate is verified. Transcripts and tool results are stored only in the documented user-owned content tables, never application logs. The schema adds an exchange revision and a unique message position to preserve chronology and concurrency safety; at most 100 exchanges per conversation.
- Follow-ups replay at most eight complete exchanges / 16,000 characters of prior question/interpretation text. The existing system prompt, capability and tools remain unchanged. Historical tool payloads are **not** replayed as fresh financial facts. Actual-model follow-up grounding remains part of activation verification.
- No database lock/transaction spans a model call. After a complete answer, an owner/revision/active-state claim atomically saves both messages. Concurrent questions, archive/delete during generation and forced insert failures cannot leave partial exchanges or resurrect deleted history. Failed/unmeasured questions save no messages.
- Added saved-history pages, title management, archive/restore, explicit confirmed deletion and authenticated per-conversation JSON export. Export uses one query for a consistent snapshot, exact decimal strings and private/no-store attachment headers. Deleting a conversation cascades messages; deleting its owner cascades only that owner's conversations/messages. These operations do not change financial records. Global Settings data export/delete remains its scheduled phase; no replacement is introduced here.
- Model generation remains hard-disabled: the ask action authenticates then returns unavailable without constructing a provider or reading financial data. History management does not call a model. No fake-provider endpoint, model order, gate, baseline prompt, scorer or evaluation suite was added/changed. All feature-model tests use fake providers only; scenarios remain blocked by OD-18.
- Focused validation: **60 unit tests and 32 integration checks pass**, including 14 conversation cases, schema checks and migration all-down/all-up fingerprint verification. Full regression, build and final static checks are being run before the PR is marked ready again.

- Final history-management UI checks also cover field-level title errors and redirecting successful deletion to `/ai`, so deletion does not leave the user on a removed conversation page. Typecheck, lint, production build and client-secret scan pass for saved conversations. No existing model configuration, prompt or evaluation file differs from PR #39's base.

**Saved-conversation verification complete:** the complete local regression at core commit `f458cc0` passed **2,750 tests across 109 files** (459.44 seconds), including all unit/property/PostgreSQL 17 integration suites. The subsequent field-error/deletion-redirect follow-up (`4fa27ef`) passed **60 focused assistant unit tests**, typecheck, lint, production build and the client-secret scan. Authenticated HTTP checks against that production build passed: anonymous redirect; saved history/detail; disabled question controls; exact-string private export; real rename/archive/restore/delete form actions; delete redirect to `/ai`; and 404 for deleted history/export. The isolated synthetic user, session and private temporary files were removed, and the loopback preview server stopped. The PostgreSQL 17/18 CI matrix runs separately; neither PR was merged.

## OpenRouter preparation — 2026-11-03

**Current authorization:** prepare the owner's requested provider privacy and serving-host provenance with fake HTTP responses only, on `codex/openrouter-provider-provenance`, based on main after #38. No paid/live inference was made. Runtime readiness still exposes no OpenRouter key binding; funding and strict account privacy readiness are not confirmed. Public OpenRouter documentation and a public endpoint catalogue were read without credentials or inference requests. PR #40's saved-conversation changes now pass PostgreSQL 17 and 18 CI ([run](https://github.com/Javacom710/Personal-AI-Finance-Butler/actions/runs/41598942051)); it remains stacked on #39.

- The existing injected-fetch adapter detects the canonical OpenRouter API URL and sends `provider: {zdr:true, data_collection:'deny', order:['deepinfra'], sort:'price', allow_fallbacks:true}` on every chat completion, including tools, structured output and vision. These controls are not app/UI/model inputs. Unsafe/noncanonical OpenRouter URLs are refused before egress; redirects are disabled for this API. Other providers retain their existing wire behavior.
- **Strict-retention readiness:** OpenRouter's current [provider-routing docs](https://openrouter.ai/docs/guides/routing/provider-selection) state that request-level `zdr:true` can also admit Safety Retention endpoints unless account privacy/guardrails are set to **ZDR only**. Before live measurements, confirm ZDR only (Safety Retention excluded) and training/data collection off, alongside funding/key readiness. The request policy does not claim to verify remote account settings.
- Each scored case retains the exact response `provider` label, actual response model ID, canonical endpoint and request-policy fingerprint. Missing/unmatched host provenance is refused, never replaced with DeepInfra. Unknown attribution stays null. This is the returned host label, not an inferred endpoint variant/region. Raw model output is not stored in reports. Smoke/reachability output also includes returned host/policy for OpenRouter responses.
- Reports keep per-case provenance after JSON serialization and separate host-qualified score/latency summaries. A host needs every golden case of every required tier suite under the same policy; another host cannot fill its gaps. Partial runs/subsets cannot propose an order. Provider-wide aggregates are diagnostic only. Host-qualified proposals retain unchanged numeric gates and capability caveats; no tier order is set. OpenRouter remains the host router—there is no application host-selection or retry loop.
- `ai:eval` requires `--no-record` for OpenRouter **before** any HTTP request. The recorder independently refuses OpenRouter runs, and the runtime ignores endpoint-only or manually inserted OpenRouter evidence. Accepting/recording approved host-scoped capabilities needs the owner's lineup decision and a reviewed host-scoped recording/runtime composition first; do not silently reuse the endpoint-only loader. Legacy Groq/NVIDIA behavior remains unchanged.
- Focused checks: **71 unit tests and 10 PostgreSQL checks pass**, including the actual CLI with HTTP denied, privacy controls for all request types, host attribution, mixed-host coverage rejection, gate/caveat preservation, recording refusal and legacy storage behavior. Complete local regression: **2,633 tests across 103 files pass** (372.88 seconds), including all unit/property/PostgreSQL 17 integration tests. Typecheck, lint, the production Webpack build and client-secret scan pass. Local default Turbopack could not resolve the shared dependency symlink used after the workspace ran out of install space; no dependency/configuration changes were made, and CI will exercise the ordinary installation/default build. [Runbook](docs/OPENROUTER-MEASUREMENTS.md). No model order, declared capability, numeric gate, prompt, scorer or golden suite was changed.
## Transaction-draft navigation review fix — 2026-11-03

PR #39 review identified that `/money/proposals` was linked only from the no-accounts state. Added **Review drafts** to populated Money navigation and retained the empty-state link. Draft generation remains disabled; this makes the authorized review flow discoverable. Existing review UI tests (4) and typecheck pass. The read-only assistant remains authorized separately on stacked PR #40, superseding the historical transaction-only scope above.

## Reachable saved assistant history — 2026-11-03 continuation

PR #40 now includes PR #39's navigation fix and replaces the fixed latest-50 history screen with active/archive pagination. Every query is owner-scoped, returns at most 50 visible rows with one lookahead row, and orders tied timestamps by UUID. Malformed/repeated/fractional/unsafe page input fails before database access. Newer/older links preserve the selected group; empty later pages retain a way back. This adds no migration, financial write, model call or activation flag.

Validation: **68 focused unit tests and 21 PostgreSQL 17 integration tests pass**, covering all 103 saved-history fixture rows, group/owner isolation, equal-timestamp ordering, invalid inputs, existing conversation concurrency and the disabled release boundary. Typecheck, lint, the ordinary Turbopack production build and client-secret scan pass. Authenticated production HTTP verification passed for all paged history, invalid/empty pages, disabled question controls, and the draft-review link in both empty/populated Money states. Synthetic test users/sessions/accounts/history and the preview server were removed afterward. PR #40's prior full regression and PostgreSQL 17/18 CI passed; the follow-up CI runs separately.

Phase 8 readiness remains unchanged: no OpenRouter key binding is available. Provider preparation PR #41 and finite runner PR #42 remain open. Strict ZDR-only account readiness/funding and actual approved-model answer quality are still prerequisites for live activation. No existing prompt, evaluation corpus, scorer, gate or tier order changed; scenarios stay blocked by OD-18.

## Assistant pending-answer invalidation — 2026-11-03 continuation

An additional concurrency review reproduced a real race in PR #40: archiving/restoring or renaming/reverting a conversation during generation could accept the old answer because active state and exchange revision matched again. Two integration regressions failed before the fix, including operations with identical timestamps.

`askConversation` now captures PostgreSQL's in-flight `xmin` row version and includes it in the atomic owner/revision/active-state claim. Every committed conversation edit invalidates that pending answer, including edits that restore the original field values. No lock or transaction spans generation. The token never enters stored history/exports, and no migration is added. Rolled-back edits and changes to another conversation preserve a valid pending answer; the exchange revision still counts only saved pairs. A rejected answer saves neither message, consumes no exchange slot and is never retried automatically.

Validation: **24 focused PostgreSQL 17 integration tests and 64 assistant unit tests pass**. The new checks reproduce archive/restore and rename/revert, preserve empty history after rejection, allow a fresh question afterward, and distinguish rollback/unrelated edits. Typecheck, lint, default production build and client-secret scan pass. PR #40 remains stacked on #39; its history-pagination source passed both PostgreSQL 17/18 CI, and the row-version fix triggers a new full matrix. All providers in feature tests remain fake. Phase 9 model calls remain hard-disabled, and no evaluation prompt, suite, scorer, gate or tier order changed. OpenRouter readiness was checked again: no key binding is available.

## Monthly financial reviews — implemented 2026-11-03

`codex/phase-9-monthly-reviews` is stacked on PR #40 to reuse the owner-bound read infrastructure. The existing `analyzeFinancialPeriod` route and five existing monthly read tools cover this slice, with no database/tool schema or gate change. Generation is hard-disabled in the page and direct action. All feature tests use fake providers; no live model call occurred. The review preserves engine figures in facts/calculations panels and keeps qualitative model interpretation and recommendations separate. Invalid/unsupported output is refused without a retry loop. There is no new persistence. Remaining authorized features follow separately, with scenarios excluded. See [the review handover](docs/PHASE9-MONTHLY-REVIEWS.md).

Validation: **47 focused unit checks and three PostgreSQL 17 integration checks pass**, including real engine/tool projections rendered after fake-provider interpretation, transfer exclusion, owner isolation and unchanged ledger/audits. Typecheck, lint, local Webpack production build and client-secret scan pass. The dependency symlink requires local Webpack; CI exercises the ordinary installation/default build. No existing model order, requirement, prompt, scorer or golden suite was changed.

A focused owner question is pending before quarterly/yearly period summaries: approve a bounded `get_period_summary` tool over the existing deterministic engine, or retain monthly-only summaries. Do not modify the frozen registry/input schema until the reply arrives. Continue independent portfolio/health/cross-domain/document work under the standing approval.

The monthly review runner now uses the normal gated tool-calling exchange before any financial read, then a final gated interpretation turn. Initial model requests must exactly match the whole application-owned read plan; all arguments are checked before any read. Real native call IDs are paired with tool messages while source labels stay application-owned. Tests cover half-open breaker recovery and refuse missing/foreign/duplicate/malformed read batches. Diagnostic `explain()` is not used for authorization. No existing routing/gate implementation changed. The shared review correction is finalized in PR #43; portfolio work has resumed on its separate branch.

Additional review-flow validation: **87 AI-boundary source-scan checks pass** alongside the 47 review/assistant unit checks (134 total). The implementation stays inside the existing AI import allowlist; no boundary rule was relaxed.

## Portfolio analysis — implemented 2026-11-03

`codex/phase-9-portfolio-analysis`, stacked on monthly reviews PR #43, adds current portfolio totals, holdings/price status, instrument currencies and three allocation dimensions through six existing read-only tools. The existing `analyzePortfolio` route gates both the tool-calling turn and final qualitative interpretation. Missing prices, unavailable historical metrics and clipped source data remain explicit; unpriced holdings are never valued at cost. Human-readable source labels retain allocation dimensions and currency scope; internal identifiers are hidden from the rendered evidence.

The portfolio page and direct action are independently authenticated and hard-disabled until lineup approval. No live model, new tool/schema, gate, tier order, baseline prompt, scorer or golden-suite change. No financial writes or new persistence. **41 focused unit checks and two PostgreSQL integration checks pass**, including real engine projections, owner isolation and unchanged ledger/audits. Typecheck, lint, production Webpack build and client-secret scan pass. CI exercises PostgreSQL 17/18 and the ordinary installation/default build. [Handover](docs/PHASE9-PORTFOLIO-ANALYSIS.md). The period-summary tool question remains pending; do not implement that registry/input-schema change without the owner reply.

## Financial-health analysis — implemented 2026-11-03

`codex/phase-9-financial-health` is stacked on portfolio PR #44. Five existing read-only tools supply recorded monthly cash flow, account balances, budget status, liabilities and upcoming scheduled commitments. The existing `analyzeFinancialHealth` route gates both turns. It introduces no health score, affordability ratio, return assumption or AI arithmetic. Linked/transacted liability balances remain null to avoid counting an account balance again; schedules stay distinct from transactions.

The health page and direct action remain independently authenticated and hard-disabled. Fake providers only; no live model, new tool/schema, existing gate/rule, tier order, prompt/scorer/suite change, financial write or new persistence. **45 focused unit checks and two PostgreSQL integration checks pass**, including engine balance projections, linked-liability nulls, missing savings rates, owner isolation and unchanged transaction/liability/audit rows. Typecheck, lint, production Webpack build and client-secret scan pass. The period-summary tool approval question is still pending; other authorized slices continue independently.

## Cross-domain analysis — implemented 2026-11-03

`codex/phase-9-cross-domain-analysis`, stacked on financial-health PR #45, combines eight existing owner-bound tools under the existing Tier 2 health-analysis route. Cost and market net worth have distinct source labels. Following the PR #46 review, holdings with engine price status replace the allocation read within the existing eight-read limit: stale usable quotes remain explicit even with complete coverage, while failed/clipped holdings evidence leaves full-valuation freshness unavailable. No AI sums, ratios, deployable-cash estimates or scenario projections are added. Exact engine results and unavailable metrics remain in separate fact/calculation evidence; model interpretation and recommendation are qualitative. The entire native read batch is checked before reads, with equivalent JSON key ordering accepted.

The linked page and direct action are independently authenticated and hard-disabled. No live provider, new tool/schema, existing gate/rule, tier order, baseline prompt, scorer/suite change or financial write. **53 focused unit checks and three PostgreSQL integration checks pass**, including a regression that failed before the freshness fix, stale-but-usable quotes in final model context/rendered evidence, failed/clipped freshness sources, expected cost/market totals, owner isolation, unchanged ledgers/audits and release blocking. Typecheck, lint, production Webpack build and client-secret scan pass. [Handover](docs/PHASE9-CROSS-DOMAIN.md). Monthly-review PR #43 and portfolio PR #44 now pass both PostgreSQL 17/18 CI; health PR #45 is running. The quarterly/yearly tool question remains pending; existing monthly-only summaries can proceed without it.

## Period summaries — monthly mode implemented 2026-11-03

`codex/phase-9-period-summaries` is stacked on cross-domain PR #46. It uses the existing Tier 1 `summarizeFinancialData` capability and four existing monthly tools, preserving the production output budget. Every figure remains an exact engine projection, with separate fact/calculation/interpretation/recommendation sections. Unsupported quarterly/yearly selections are rejected before any read/model call, never silently downgraded. The pending `get_period_summary` tool question remains unanswered; no registry/input-schema change has been made.

The linked page and direct action are independently authenticated and hard-disabled. Fake providers only, with no new persistence, financial write, database/tool schema, existing gate/rule, tier order, baseline prompt, scorer or golden-suite change. **58 focused unit checks and two PostgreSQL integration checks pass**, including decimal savings, real source projections, owner isolation, unchanged ledgers/audits, Tier 1 budget and unsupported-period refusal. Typecheck, lint, production Webpack build and client-secret scan pass. [Handover](docs/PHASE9-PERIOD-SUMMARIES.md).

The first cross-domain CI run exposed a test false positive: a broad foreign-amount substring matched digits in a random record UUID. Portfolio/health/cross-domain branches now check exact monetary fields and known engine totals, and the correction is merged into this branch. No production behavior, isolation rule or scorer was changed. Rendered evidence also keeps recorded credit limits/liability balances and scheduled amounts in Facts, while engine-derived totals/metrics stay in Calculations.

## Document/receipt extraction — implemented 2026-11-03

`codex/phase-9-document-extraction` is stacked on monthly period-summary PR #47. It uses the existing `ChatImage`, frozen document prompt/schema and `analyzeDocument` vision/schema gate. Supported inputs are bounded PNG/JPEG/WebP image envelopes; no native PDF transport or external OCR/converter is added. Raw images remain in memory and are not persisted. One model response is validated without repair; unsupported investment kinds, malformed amounts, filtered/truncated output and tool requests cannot create proposals.

Document lines share the same atomic staging helper as text drafts in the existing transaction-only proposal table. The pre-existing document schema permits null dates, and the pre-existing normalized draft type permits null fields: the resolver now preserves those nulls with field-level errors, never substituting today or a guessed amount. Every line remains an unconfirmed interpretation. Applying it uses the unchanged existing confirmation/manual transaction or transfer service, owner reauthorization, I-10 audit linkage and 24-hour expiry. No database/tool/response schema, gate, tier order, baseline prompt, scorer or suite is changed.

Batch review now pages all editable drafts in stable created-time/UUID order, keeping older entries reachable beyond fifty with owner scoping and validated page input. Both the new image page and direct action remain independently authenticated and hard-disabled; no environment flag or fake production endpoint enables generation.

Focused checks: **79 unit tests and 33 PostgreSQL integration tests pass**, including the original proposal lifecycle, exact decimal strings, missing-date/amount correction, acknowledgement, transfer handling, replay/expiry/owner guards, I-10, atomic batch rollback and 55-draft pagination. The complete local unit suite passes **2,194 tests across 81 files**. Typecheck, lint, local Webpack production build and client-secret scan pass. CI checks the ordinary installation/default build on PostgreSQL 17/18 separately. [Document handover](docs/PHASE9-DOCUMENT-EXTRACTION.md). No live model call was made. Quarter/year summaries remain blocked on the pending read-tool question. CAS investment drafts remain blocked on the separate pending schema/audit-linkage question; do not relax the transaction-only constraint or investment schema without the reply. Scenarios stay blocked by OD-18.

The six authorized feature slices are separate stacked PRs: monthly reviews [#43](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/43), portfolio [#44](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/44), health [#45](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/45), cross-domain [#46](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/46), monthly summaries [#47](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/47), then document drafts on `codex/phase-9-document-extraction`. PRs #43–47 have passed both PostgreSQL 17/18 CI. All remain open and disabled, pending review and the separate Phase 8 lineup approval. Quarterly/yearly summaries and CAS investment drafts remain limited by the two unanswered exception questions above.

## Finite OpenRouter campaign runner — 2026-11-03 continuation

**Implementation complete:** [PR #42](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/42), `codex/openrouter-measurement-runner`, stacked on provider preparation PR #41, in `/workspace/openrouter-provider-provenance`. Review the [campaign runbook](docs/OPENROUTER-CAMPAIGN.md). PR #41 now passes PostgreSQL 17/18 CI; no review comments were present. OpenRouter key/funding/ZDR-only account readiness remains unconfirmed, so all runner development uses fake providers. No live inference or capability recording occurred.

- Added `npm run ai:measure:openrouter`: offline status by default, with an explicit verified Qwen vision catalogue ID. Its finite plan measures the authorized GPT-OSS pair in Tier 1, GPT-OSS-120B in Tiers 2/3 and Qwen vision in Tier 4, using every existing tier suite and the unchanged production budgets. Evaluation-only target names are configuration, not routing orders.
- Campaign identity binds source/dependency fingerprints, endpoint, request policy, model profiles, tier/suite versions, case fingerprints, pacing and timeout/budgets. Git revisions are informational, so committing report/docs files does not silently start a new campaign. Live mode refuses dirty measurement inputs and never substitutes a legacy provider key.
- Each case is durably reserved before HTTP, then its scored result is saved before another case can start. Resumes skip prior reservations, including interrupted calls with unknown billing/outcome; ordinary resumes never replay them. Provider errors and content filters stop the invocation. Retry-After is retained across invocations; waits beyond one minute return a finite cooldown state instead of parking or scheduling another job.
- One **explicit** `--recover-case KEY` is allowed per unanswered/ambiguous case after readiness/provider issues are resolved. It retains the original attempt, never retries a scored correct/wrong answer or a content-filter response, and cannot loop or make a third attempt. Recovery is not automatic and stays within the same case/model/profile/policy. Host selection remains OpenRouter's.
- Atomic owner-private checkpoint/report files, a non-waiting writer lock and offline `--finalize` preserve evidence after interruptions. Stale locks require inspecting the PID before manual removal; no stale lock is silently deleted. Finalization uses retained scores, not model output or rescoring. Checkpoints/reports are distinct from `ai_model_evaluations`, which remains closed pending lineup approval.
- Complete regression passed **2,678 tests across 106 files** (389.92 seconds), including unit/property/PostgreSQL 17 integration suites and the full actual golden queue through fake responses. A final recovery-evidence fix and portable test-import follow-up passed **47 focused tests**: a recovery protocol failure remains final evidence rather than being hidden behind the original transport error. Checks cover crash/IO behavior, concurrency, recovery limits, offline CLI with HTTP denied, missing-key refusal and dirty-input refusal. Typecheck, lint, production Webpack build and client-secret scan pass. Local Webpack uses the existing shared dependency symlink; CI uses an ordinary installation/default build. No prompts, scorers, golden suites, thresholds or production tier orders changed. Runtime readiness was checked again: no OpenRouter key binding is available. Live results and the owner-approved lineup remain pending; do not substitute Groq quota, schedule polling, or record capabilities.
