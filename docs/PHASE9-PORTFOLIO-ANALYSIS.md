# Portfolio analysis

> **Status 2026-11-07:** merged into `main` (PRs #39–#48). Live generation stays hard-disabled until the owner accepts a measured Phase 8 lineup ([OD-20](DECISIONS.md#open-decisions-requiring-the-user)). The PR-stacking notes below are the original build record.

Built under the owner's standing Phase 9 approval, stacked on monthly-review PR #43 to reuse its bounded read/interpretation runner and separated evidence view. No live provider is used; generation remains hard-disabled pending lineup approval and reviewed runtime composition.

The existing `analyzePortfolio` capability receives current portfolio totals, holdings with price status, instrument currencies, and allocation by asset class, instrument and currency through existing owner-bound tools. These are six bounded reads, requested through the existing gated tool-calling route, followed by a final gated interpretation turn. Source labels retain each allocation dimension. Source rows use their human-readable names; internal identifiers stay out of the rendered evidence. Unit prices retain their own units and are not assumed to be in the base currency. No write, scenario, benchmark estimate, speculative return or AI calculation is added.

Exact values, missing prices, incomplete coverage, clipping metadata and unavailable performance reasons stay in source panels. Unpriced holdings are not valued at acquisition cost. Facts/calculations and qualitative interpretation/recommendation remain separate. Historical performance or benchmarks unavailable through existing tools remain unavailable; the feature does not claim a complete historical-performance analysis.

The authenticated `/ai/reviews/portfolio` page is linked from AI with disabled generation controls. Its direct action authenticates and returns unavailable without a model or financial read. Environment configuration cannot enable it. There is no new persistence, database/tool schema, capability gate, tier order, baseline prompt or evaluation change. Reviews cannot mutate holdings or audit history.

Tests cover existing route selection, exact production projections, missing price/performance information, allocation dimensions, owner isolation, read-only behavior, rendering and independent page/action release blocking. Actual-model semantics remain unverified until Phase 8 approval and activation checks.

Validation: **41 focused unit checks and two PostgreSQL integration checks pass**, including real portfolio projections with priced/unpriced holdings and another owner, exact source values, missing historical-performance reasons and unchanged investment/audit rows. Typecheck, lint, production Webpack build and client-secret scan pass; CI exercises PostgreSQL 17 and 18.
