# Project deadline forecast — forecast versus actual

<!-- project-doc-status:start -->
> **Status reviewed 12 November 2026:** Phase 8 quality/release review open; Phase 9 live AI disabled; Overview, Scenarios, metrics and TWR built; Phase 10 partial. OD-21 is protected in the engine; OD-22/23 remain open. DeepInfra direct is selected.
> **Current references:** [Project state](PROJECT-STATE.md) · [Roadmap](docs/ROADMAP.md) · [Maintained deadline forecast](PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Maintained forecast versus actual; frozen F1 baseline.
<!-- project-doc-status:end -->

**Updated:** 12 November 2026 (Asia/Kolkata). **Baseline:** F1, established 12 November 2026; retained after the latest-source review.
**Current full-scope end forecast: 15 January 2027. Confidence: low.**
**Core private-production forecast: 18 December 2026. Confidence: low.**

These are provisional engineering forecasts, not an owner-committed deadline.
No earlier delivery forecast was found in the reviewed project documentation. Prior completed work
is recorded as actual progress, never presented as a prediction made in advance.

## What “finished” means

**Core private production:** the roadmap's Phases 0–13 are accepted, including
verified deterministic capabilities, approved measured AI lineups and real
workflows, Overview/UX, security, end-to-end verification, the personal domain,
backups, a tested restore and a tested rollback. Built-but-disabled AI does not
meet this milestone.

**Full approved scope:** core production plus the approved statement/CAS review
work and Phase 14 Gmail bank-alert import, Groww read reconciliation and exact
order confirmation with fresh authentication. Pending schema/tool decisions,
broker credentials, static-IP eligibility and setup are included as dependencies.
Phase 15 continuous improvement has no finite end date and is not counted as
unfinished initial delivery. This forecast grants no new implementation or
deployment permission.

## Forecast against what is actually happening

| Measure | Baseline forecast F1 | Current forecast | Actual at 12 Nov | Forecast movement |
|---|---|---|---|---|
| Core private production | 18 Dec 2026 | 18 Dec 2026 | Not deployed; AI disabled | 0 days; reviewed against newer source |
| Full approved scope | 15 Jan 2027 | 15 Jan 2027 | Integrations not implemented | 0 days; reviewed against newer source |
| Core forecast window | 4 Dec 2026–15 Jan 2027 | Same | Model-quality and decision uncertainty remain | Not a confidence interval |
| Full-scope forecast window | 18 Dec 2026–12 Feb 2027 | Same | External broker/hosting readiness unverified | Not a confidence interval |

Zero movement means the conditional baseline is retained after reconciling newer
source evidence. It is not evidence that the project is on schedule. There is no reliable measured delivery velocity yet;
test counts, phase counts and cheap API calls cannot establish one.

| Actual work | Evidence | Schedule implication |
|---|---|---|
| Phases 0–7 built; main now includes PR #70 | [Roadmap](docs/ROADMAP.md), main `50b604a` | Foundation and consolidated UI/engine work exist; production acceptance remains open |
| Historical Tier 1 parse-v4 pair measured, 380/380 answers | [Current campaign](eval/reports/deepinfra-2026-11-07-tier1-parse-v4-2026-11-08/README.md) | Complete historical evidence; current v6 financial contracts require fresh measurement after remaining contract work |
| v4 parsing 38/40 GLM, 33/40 GPT-OSS; injection 24/25 and 21/25 | Same campaign; schema 100/100 each; tools 54/57 and 53/57 | Passing numerical gates does not close release-quality review |
| Independent Nov-12 v2 campaign and fifteen diagnostic probes retained from PRs #71/#72 | [Historical investigation](docs/audits/2026-11-12-tier1-failure-diagnostics.md), source `7037372` | Historical source contracts; not current v4 qualification; no rescoring or replay |
| Overview, deterministic scenarios, expense ratio/runway/coverage and TWR built | Main PR #70 plus latest Claude `259fa91`; [handoff audit](docs/audits/2026-11-12-claude-latest-handoff.md) | Earlier “placeholder/missing engine” actuals corrected; M2/M5 remain incomplete |
| Latest TWR transfer, action, future-row and freshness fixes integrated; missing-FX cash withholds ratios | Same handoff; 3,411 local tests (2,705 unit/property, 706 PostgreSQL 17 integration); integrity 35/0 | Verified engineering progress, not production or model-quality acceptance; branch CI tracked separately |
| Phase 9 non-scenario slices/composition/forms built; live generation disabled | [Feature handovers](docs/README.md) | Activation, advanced/scenario tools and real-model workflows still outstanding |
| OD-18 timing settled by owner on 11 Nov; Tiers 2–4 unselected | [OD-18/20](docs/DECISIONS.md); tool registration with Tier 2 work | Part of M1 resolved; remaining quality/candidate decisions prevent milestone closure |
| OD-21 protected in the engine; OD-22 unmatched-transfer XIRR and OD-23 tool freshness open | [Open decisions](docs/DECISIONS.md#open-decisions-requiring-the-user) | Batch affected engine/tool/evaluation changes before the next paid measurement and before relevant activation |
| Phase 10 partial; Phases 11–14 unfinished | [Roadmap](docs/ROADMAP.md) | UX, security, release rehearsal, deployment and integrations remain |

## Milestones and variance

Dates are calendar delivery targets in Asia/Kolkata. Estimates assume one active
engineering workstream, five active workdays a week and owner decisions within
two workdays. These assumptions describe the forecast, not known availability
or a commitment by the owner. The core target allocates approximately 26 weekday
slots after 12 November; the full-scope target approximately 46. Actual active
workdays must be recorded as work occurs before using them as measured velocity.

| ID / exit condition | Baseline F1 | Current forecast | Actual finish | Forecast variance | Dependency / current condition |
|---|---|---|---|---|---|
| M1 — quality-revision approach, remaining tier candidates and OD-18 path settled | 16 Nov 2026 | 16 Nov 2026 | — | 0 days | OD-18 timing settled 11 Nov; remaining quality approach/tier candidates open |
| M2 — approved deterministic gaps and changed tool/schema contracts implemented and tested | 20 Nov 2026 | 20 Nov 2026 | — | 0 days | Engine/UI built; OD-21 protection and v6 financial contracts implemented; OD-22/23, scenario/metrics tools and final affected suites remain; approved period/CAS boundaries where required |
| M3 — final current-contract lineups measured and accepted for every release capability | 27 Nov 2026 | 27 Nov 2026 | — | 0 days | M2; quality, model availability, budget and owner acceptance |
| M4 — Phase 9 live composition and real user workflows verified | 4 Dec 2026 | 4 Dec 2026 | — | 0 days | M3; explicit reviewed activation, all relevant feature gates |
| M5 — Overview and Phase 10 UX/accessibility/performance complete | 9 Dec 2026 | 9 Dec 2026 | — | 0 days | Overview built; phone fixes verified; remaining accessibility/tap targets/performance and M4 live-AI interaction checks |
| M6 — Phase 11 security findings closed | 14 Dec 2026 | 14 Dec 2026 | — | 0 days | M4/M5; includes final shipped AI boundary |
| M7 — Phase 12 end-to-end/golden checks and release rehearsals pass | 16 Dec 2026 | 16 Dec 2026 | — | 0 days | M6; complete release candidate and disposable restore target |
| M8 — Phase 13 core private production accepted | 18 Dec 2026 | 18 Dec 2026 | — | 0 days | M7; host/domain/TLS, verified backups/restore/rollback and owner acceptance |
| M9 — remaining approved imports and Phase 14 Groww workflows accepted; full scope finished | 15 Jan 2027 | 15 Jan 2027 | — | 0 days | M8; CAS/import contracts, Gmail/Groww access, static IP and owner-confirmation checks |

**Order matters:** The current TWR wiring leaves the retained grounding fixture unchanged, but
OD-21 now changes projected results and advances financial suites to v6; OD-23 will change the result shape and OD-22 must be checked against the fixture.
These changes and tool registration require coordinated affected suite versions. Finish the approved deterministic contract changes before
the final paid qualification campaign, rather than paying to certify contracts
that will immediately change. Independent preparation can proceed, but this plan
does not assume several agents are working in parallel.

**Variance rules:** forecast variance is current forecast minus the frozen
baseline in calendar days. Delivery variance is actual finish minus baseline,
recorded only when a milestone finishes. An unfinished milestone has no actual
finish date; do not substitute a forecast. Baseline dates never move silently.

## Conditions that can move the date

| Risk / signal | Current evidence | Required forecast response |
|---|---|---|
| Quality remains below the release bar | Full campaign has injection/accuracy failures; diagnostics show variable responses | Do not activate to protect a date; after each bounded revision/campaign, recalculate M3 and every downstream milestone |
| Decisions or credentials delayed | OD-18 timing is settled; OD-20 quality/tier choices, period/CAS contracts and release configuration remain open | Record waiting separately from active engineering; shift dependent dates by the resulting delay |
| Inference cap blocks required evidence | US$2.079573720 accounted; US$7.920426280 remains of US$10; both branches reconciled, no new paid calls here | Estimate before each paid run; stop at the guard and record a blocked milestone, never assume a budget increase |
| Broker/domain/host setup unavailable | Production and Groww static-IP access are not verified | Keep M8/M9 conditional; distinguish core release from full-scope finish |
| Capacity differs from assumptions | No reliable active-workday velocity is recorded | Replace the five-day assumption with observed capacity at the next review and recalculate dates |
| Scope or a security/integrity defect changes remaining work | No owner acceptance of a reduced release scope exists | Record the change explicitly and revise the forecast; do not remove a required feature to keep the old target |

## Actuals and forecast-change log — append, do not rewrite

| Date | What actually happened | Baseline / current end | Variance / reason |
|---|---|---|---|
| 12 Nov 2026 | Complete Tier 1 campaign retained in PR #71; 380 answered, release review still open | No earlier forecast existed | Actual event before F1; no invented prior deadline |
| 12 Nov 2026 | Fifteen diagnostics completed; 143 focused / 2,647 full local tests pass; no activation | No earlier forecast existed | Active investigation completed; quality work remains |
| 12 Nov 2026 | Owner requested all Markdown updated and a maintained forecast against actual progress | **F1:** core 18 Dec 2026; full scope 15 Jan 2027 | Initial conditional baseline; low confidence; no actual project end |
| 12 Nov 2026 | All 102 Markdown files reviewed/updated; 306 status-navigation links and historical-body preservation verified; both instruction files require maintenance | F1 unchanged | Documentation task completed locally; no delivery milestone or release gate closed |
| 12 Nov 2026 | Latest-source review found main #70 merged and Claude `259fa91` recording OD-23. Corrected actuals: Overview/scenarios/metrics/TWR built; OD-18 timing already decided. Integrated latest TWR hardening with partial-price UI guards; 3,411 local tests and 35/0 integrity pass. | Core 18 Dec / full scope 15 Jan → unchanged | 0 days; low confidence retained. New evidence reduces uncertainty about built code, but engine/tool correctness, quality acceptance and release dependencies remain. No measured velocity to justify advancing the end dates. |
| 12 Nov 2026 | Reconciled independent historical v2/diagnostic spend with main's current v4 campaign: US$2.079573720 accounted / US$7.920426280 remaining. Current task uses no paid inference. All 119 Markdown files refreshed; historical bodies and machine-readable campaign evidence preserved. | F1 unchanged | Accounting/status correction; no new delivery completion, committed deadline or scope reduction |
| 12 Nov 2026 | Continued from PR #73 after confirming PostgreSQL 17/18 CI success. Implemented OD-21 in the engine, preserved partial priced-value display, regenerated the handler fixture and advanced grounding/robustness/analysis to v6. Existing complete v4 campaign/pinned preview remain historical and cannot qualify/import the changed contracts. Remaining OD-22/23/tools still precede the next paid batch; no inference spending. Verification: [OD-21 audit](docs/audits/2026-11-12-incomplete-portfolio-returns.md). | Core 18 Dec / full scope 15 Jan → unchanged | 0 days; low confidence retained. M2 is partially advanced, not complete; release quality, remaining contract work and owner/external dependencies remain. No measured velocity supports advancing dates. |

## Maintenance contract

At the start and end of every material task or PR, reconcile this file with
`PROJECT-STATE.md`, the roadmap, actual code, retained evidence and CI. Update:

1. Actual completions and verification, with dates and links; distinguish local
   checks, CI, merged code, activation and production acceptance.
2. Remaining work, blockers, owner/external waiting and observed active capacity.
3. Current milestone forecasts, downstream impacts, confidence and signed variance.
4. The append-only change log: old date, new date, reason and supporting evidence
   whenever a forecast changes. Record a review with no change when appropriate.

If a target passes unfinished, mark it overdue and reforecast at the next active
review. Never keep an expired date labelled current. Only create a new baseline
after explicitly recording why; preserve F1 and its variance history.

**Next review:** the next active project task, no later than 13 November 2026 if
work continues; M1 is the next delivery checkpoint. This is a repository workflow,
not a scheduled background job or an automatic promise of daily execution.

**End-of-task verification, 12 November:** 20 production browser checks pass
(including phone layouts, scenario submission, stale-price disclosure and partial
pricing). Documentation coverage is 119 files / 357 navigation links, with 86
historical bodies preserved. F1 dates and low confidence remain unchanged;
combined-branch CI is tracked separately in the handoff audit/PR.
