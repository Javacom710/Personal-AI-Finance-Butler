# Claude continuation and consolidated build strategy — 11 November 2026

The app thread-history service was unavailable. This continuation uses the latest published GitHub commits and durable handoffs, without assuming access to unpublished Claude session work.

| Source | Pinned head | Contribution |
|---|---|---|
| #67 | `d1a4c46` | Current parse-v4 evidence, guarded Tier 1 composition/actions/forms and operator import preview |
| Claude #68 | `fb7fbcc` | Overview, deterministic attention checks, complete financial-source empty-state fixes |
| Claude #69 | `fcff136` | Scenario engine/UI, expense ratio/runway/commitment coverage, unpaginated commitments, TWR wiring and first-boundary correction |

The review branch preserves all three histories. Documentation conflicts retain the current model evidence/spending and Claude's resolved OD-18/OD-19 work plus open OD-21. Original branches, `main`, prior reports and the v4 manifest remain untouched.

## Current state and strategy

Phases 0–7 are implemented. Tier 1 has current v4 qualification evidence, with remaining semantic/injection quality failures and owner release review still open. Other tiers are unselected. The non-scenario AI features are built and disabled. Claude's deterministic scenario/metrics/TWR and Overview work is now integrated in this checkout, while its scenario AI tools/features/evaluation suite remain unregistered.

The strategy is to finish deterministic correctness before more model qualification: resolve OD-21, register scenario/metrics tools with Tier 2 work as the owner scheduled, and advance affected contracts together before one fresh measurement batch. Avoid paying repeatedly while engine/tool contracts are still changing. Current accounted development inference spending is US$2.005912455 of US$10; this continuation makes no model request or deployment evidence write. AI generation remains disabled. This task does not create, stop or alter Claude's existing resume automation.

## OD-21 protection and remaining engine work

The engine mixes priced market value with the basis/cash flows of every holding. A missing holding price can therefore appear as a loss. A correct engine change needs consistent valuation cohorts across unrealised P&L, percentage denominators and XIRR cash flows; removing unpriced cost from a single subtraction leaves inconsistent metrics.

Claude already withholds returns on Overview when any holding is unpriced. This continuation applies that same presentation guard to Investments and Performance. It hides aggregate unrealised/total returns and XIRR while preserving known invested costs, priced market value, realised/income figures and individual holding results. TWR also retains its explicit incomplete-pricing state. Zero-priced but fully quoted holdings and stale-but-available quotes are not confused with missing prices. The aggregate table label and coverage text now distinguish all-holding cost from priced value.

The Investments empty-state test now also considers positions and recorded financial history, so deactivated instruments or closed positions do not hide valid figures. The underlying engine defect and AI-tool values remain unchanged; OD-21 stays open. No financial formula, model gate, schema, frozen fixture or evaluation version is changed by this mitigation.

## Verification

| Check | Result |
|---|---|
| Full unit suite | 2,635 passed |
| Property suite | 68 passed |
| PostgreSQL 17 integration suite | 695 passed, including unchanged frozen AI grounding |
| Financial integrity | 35 passing, 0 failing, 0 warnings; 28 further checks enforced by the engine |
| Typecheck, lint, production build | Passed |
| Client-secret scan | Passed: 24 client files and emitted static bundles |
| Offline v4 evidence preview | Byte-identical to the retained manifest; digest `0b576c87529b09d01ac1411a5fb9974359f0f7787fa265155d5f62c27d591e9b` |

Focused SSR checks cover partial pricing, legitimate zero/loss figures, a zero-cost missing-price holding, stale quotes, inactive held instruments, closed history and a genuine empty state. All 17 focused Overview/return-display tests were rerun after the final presentation changes. Authentication/action regression checks also pass with stable local dependencies. No thresholds or test timeouts are weakened.

The initial database run could not connect because the existing local PostgreSQL container was stopped. Starting that same PostgreSQL 17 container restored the test environment; the full integration suite then passed. Both pinned source Claude PRs also pass PostgreSQL 17 and 18 CI ([#68 run](https://github.com/Javacom710/Personal-AI-Finance-Butler/actions/runs/43064533817), [#69 run](https://github.com/Javacom710/Personal-AI-Finance-Butler/actions/runs/43070753803)).

Production Chromium checks found and corrected mobile overflow: the visually hidden price-provenance labels were absolutely positioned outside the scrolling table's containing block. Making each price indicator wrapper relative keeps those labels within its cell. Overview, Investments, Performance, Money and Scenarios now pass at 1280px and 390px, with no page overflow or browser exceptions. Signed-out Performance requests redirect to login.

The browser used an actual opaque session for a synthetic user on the dedicated `financeos_test` database, with both test URL names checked before truncation. Two deactivated holdings cost ₹1,000 each; one has a ₹1,200 value and the other has no quote. The engine still reproduces the known −₹800 aggregate defect, while the pages withhold that aggregate, retain the holdings and correctly show the known values. The GET scenario form produces ₹12,000 for ₹1,000 monthly over one year at an explicit 0% assumption, and ₹13,200 when starting from that ₹1,200 priced portfolio value, with the missing holding disclosed. Fixtures and sessions are removed in `finally`; no development or real-user records are changed.
