# Cross-domain financial analysis

<!-- project-doc-status:start -->
> **Project status reviewed 12 November 2026:** Phases 0–7 complete; Phase 8 quality/release review open; Phase 9 built but live AI disabled. Selected provider: DeepInfra direct.
> **Current references:** [Project state](../PROJECT-STATE.md) · [Roadmap](ROADMAP.md) · [Maintained deadline forecast](../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Feature activation contract; live generation disabled.
<!-- project-doc-status:end -->

> **Status 2026-11-07:** merged into `main` (PRs #39–#48). Live generation stays hard-disabled. The owner has selected a Tier 1 lineup ([ADR-55](DECISIONS.md#adr-55--retain-the-tier-1-selection-recorded-in-claude-pr-54-current-contract-eligibility-remains-independent)), but activation still needs complete current-contract measurements and a reviewed release; features that need Tiers 2–4 also need those tiers selected ([OD-20](DECISIONS.md#open-decisions-requiring-the-user)). The PR-stacking notes below are the original build record.

Built under the standing Phase 9 approval, stacked on financial-health PR #45. Fake providers only; production generation remains hard-disabled pending lineup approval and reviewed runtime composition. Scenarios remain blocked by OD-18.

Eight existing owner-bound reads supply recorded monthly cash flow, accounts, net worth at cost, net worth at market, portfolio totals/coverage, holdings with engine price status, liabilities and upcoming commitments. The existing Tier 2 `analyzeFinancialHealth` capability gates the tool-calling and interpretation turns. The entire native read batch must match the application-owned plan before any read. Equivalent JSON property ordering is accepted; omitted valuation bases, extra reads, scenario calls and changed arguments are refused.

Cost and market net worth have different source labels in both evidence sections; they are never presented as amounts to add together. Exact engine figures, unavailable metrics, coverage and schedules retain their source meaning. Unsupported investment/net-worth ratios, deployable-cash capacity and scenario projections remain unavailable, rather than being calculated by AI. Facts/calculations and qualitative interpretation/recommendation stay separate. Stale-but-usable holdings remain visibly stale even when coverage is complete, and that exact engine status reaches the final model context. Failed or clipped holdings evidence makes freshness of the full valuation unavailable. The dedicated portfolio review retains allocation analysis; this cross-domain plan stays within eight reads without adding a tool or changing a tool schema.

The authenticated `/ai/reviews/cross-domain` page is linked in the grouped financial-review navigation. Both controls and the independently authenticated direct action remain unavailable without composing a model or reading finances. There is no new persistence, tool/database schema, existing gate/rule, tier order, baseline prompt, scorer or golden-suite change.

Validation: **53 focused unit checks and three PostgreSQL integration checks pass**. The real-engine fixture verifies separate cost and market net-worth results, expected exact totals, stale-but-usable quotes with complete coverage, model-context and rendered freshness labels, owner isolation and unchanged money/investment/audit rows. Other checks cover complete read scope, property-order equivalence, refused scenario substitution, labeled rendering, failed/clipped freshness evidence and direct-action/page blocking. Typecheck, lint, production Webpack build and client-secret scan pass. CI checks PostgreSQL 17/18 with the ordinary install/default build. Fake tests do not certify live-model semantic quality.
