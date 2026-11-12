# Project deadline forecast — forecast versus actual

<!-- project-doc-status:start -->
> **Project status reviewed 12 November 2026:** Phases 0–7 complete; Phase 8 quality/release review open; Phase 9 built but live AI disabled. Selected provider: DeepInfra direct.
> **Current references:** [Project state](PROJECT-STATE.md) · [Roadmap](docs/ROADMAP.md) · [Maintained deadline forecast](PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Maintained forecast versus actual; frozen F1 baseline.
<!-- project-doc-status:end -->

**Updated:** 12 November 2026 (Asia/Kolkata). **Baseline:** F1, established today.
**Current full-scope end forecast: 15 January 2027. Confidence: low.**
**Core private-production forecast: 18 December 2026. Confidence: low.**

These are provisional engineering forecasts, not an owner-committed deadline.
No earlier delivery forecast was found in the reviewed project documentation. Prior completed work
is recorded as actual progress, never presented as a prediction made in advance.

## What “finished” means

**Core private production:** the roadmap's Phases 0–13 are accepted, including
the missing deterministic capabilities, approved measured AI lineups and real
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
| Core private production | 18 Dec 2026 | 18 Dec 2026 | Not deployed; AI disabled | 0 days; initial baseline |
| Full approved scope | 15 Jan 2027 | 15 Jan 2027 | Integrations not implemented | 0 days; initial baseline |
| Core forecast window | 4 Dec 2026–15 Jan 2027 | Same | Model-quality and decision uncertainty remain | Not a confidence interval |
| Full-scope forecast window | 18 Dec 2026–12 Feb 2027 | Same | External broker/hosting readiness unverified | Not a confidence interval |

Zero movement today means the baseline was just created. It is not evidence that
the project is on schedule. There is no reliable measured delivery velocity yet;
test counts, phase counts and cheap API calls cannot establish one.

| Actual work | Evidence | Schedule implication |
|---|---|---|
| Phases 0–7 are recorded complete | [Roadmap](docs/ROADMAP.md); Phase 7 closed 26 Oct | Foundation work exists; remaining release checks still count |
| Selected Tier 1 pair measured, 380/380 answers | [Full campaign](eval/reports/deepinfra-2026-11-07-tier1-current-2026-11-12/README.md), 12 Nov | Coverage/completeness established; quality and release acceptance remain open |
| Injection 24/25 GLM, 19/25 GPT-OSS; parsing 36/40 and 32/40 | Same campaign; numerical schema/tool gates pass | Numerical threshold passage does not close the release-quality gate |
| Fifteen independent diagnostic probes completed | [Investigation](docs/audits/2026-11-12-tier1-failure-diagnostics.md), 12 Nov | Identifies missing reads, tool selection, payload repetition and ambiguity/partial-result issues; no original score replaced |
| Phase 9 non-scenario slices built with fake-provider tests | [Feature handovers](docs/README.md) | Live activation and real-workflow verification remain work |
| 2,647 local unit/property tests and build checks pass | Current continuation; parent [PR #71 CI](https://github.com/Javacom710/Personal-AI-Finance-Butler/actions/runs/43161545321) green on PostgreSQL 17/18 | Current continuation [CI status](https://github.com/Javacom710/Personal-AI-Finance-Butler/actions?query=branch%3Acodex%2Ftier1-failure-diagnostics) is tracked separately; test success is not production completion |
| Tiers 2–4 unselected; scenarios/metrics/TWR placement unresolved | OD-18/OD-20 in [decisions](docs/DECISIONS.md) | Critical dependency before final qualification/activation |
| Overview placeholder; Phases 10–14 not delivered | [Roadmap](docs/ROADMAP.md) | Significant UI, release and integration work remains |

## Milestones and variance

Dates are calendar delivery targets in Asia/Kolkata. Estimates assume one active
engineering workstream, five active workdays a week and owner decisions within
two workdays. These assumptions describe the forecast, not known availability
or a commitment by the owner. The core target allocates approximately 26 weekday
slots after 12 November; the full-scope target approximately 46. Actual active
workdays must be recorded as work occurs before using them as measured velocity.

| ID / exit condition | Baseline F1 | Current forecast | Actual finish | Forecast variance | Dependency / current condition |
|---|---|---|---|---|---|
| M1 — quality-revision approach, remaining tier candidates and OD-18 path settled | 16 Nov 2026 | 16 Nov 2026 | — | 0 days | Decisions open; evidence ready for review |
| M2 — approved deterministic gaps and changed tool/schema contracts implemented and tested | 20 Nov 2026 | 20 Nov 2026 | — | 0 days | M1; includes scenarios/metrics/TWR and approved period/CAS boundaries where required |
| M3 — final current-contract lineups measured and accepted for every release capability | 27 Nov 2026 | 27 Nov 2026 | — | 0 days | M2; quality, model availability, budget and owner acceptance |
| M4 — Phase 9 live composition and real user workflows verified | 4 Dec 2026 | 4 Dec 2026 | — | 0 days | M3; explicit reviewed activation, all relevant feature gates |
| M5 — Overview and Phase 10 UX/accessibility/performance complete | 9 Dec 2026 | 9 Dec 2026 | — | 0 days | M4 for final AI interaction checks |
| M6 — Phase 11 security findings closed | 14 Dec 2026 | 14 Dec 2026 | — | 0 days | M4/M5; includes final shipped AI boundary |
| M7 — Phase 12 end-to-end/golden checks and release rehearsals pass | 16 Dec 2026 | 16 Dec 2026 | — | 0 days | M6; complete release candidate and disposable restore target |
| M8 — Phase 13 core private production accepted | 18 Dec 2026 | 18 Dec 2026 | — | 0 days | M7; host/domain/TLS, verified backups/restore/rollback and owner acceptance |
| M9 — remaining approved imports and Phase 14 Groww workflows accepted; full scope finished | 15 Jan 2027 | 15 Jan 2027 | — | 0 days | M8; CAS/import contracts, Gmail/Groww access, static IP and owner-confirmation checks |

**Order matters:** TWR wiring changes frozen financial results and may require
suite-version changes. Finish the approved deterministic contract changes before
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
| Decisions or credentials delayed | OD-18/OD-20, period/CAS contracts and release configuration remain open | Record waiting separately from active engineering; shift dependent dates by the resulting delay |
| Inference cap blocks required evidence | US$1.863718445 accounted; US$8.136281555 remains of US$10 | Estimate before each paid run; stop at the guard and record a blocked milestone, never assume a budget increase |
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
