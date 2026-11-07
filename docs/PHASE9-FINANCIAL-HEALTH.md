# Financial-health analysis

> **Status 2026-11-07:** merged into `main` (PRs #39–#48). Live generation stays hard-disabled until the owner accepts a measured Phase 8 lineup ([OD-20](DECISIONS.md#open-decisions-requiring-the-user)). The PR-stacking notes below are the original build record.

The owner's standing Phase 9 approval permits this feature in its own PR, stacked on portfolio PR #44. All providers used in development are fake. Production generation remains hard-disabled until lineup approval and a reviewed runtime composition.

Five existing owner-bound tools supply current account balances, recorded monthly cash flow, budgets, liabilities and scheduled commitments over the next thirty days. The existing `analyzeFinancialHealth` route gates the initial native tool request before any read and the final interpretation turn. The model's complete read batch must match the application-owned plan; no widening, write, scenario or repair/retry loop is supported.

The view separates facts, deterministic calculations, qualitative interpretation and recommendation. Exact projected values and missing-metric reasons are retained. Linked/transacted liabilities preserve null standalone balances, so they cannot silently count an account balance again. Scheduled items are not labeled recorded cash flows. There is no invented financial-health score, inferred affordability ratio or return assumption.

The `/ai/reviews/health` page is linked from AI with disabled controls. Its direct action independently authenticates and returns unavailable without reading finances or constructing an orchestrator. An environment key/flag cannot enable it. There is no new persistence, tool/database schema, existing gate/rule, tier order, baseline prompt, scorer or golden-suite change.

45 focused unit checks and two PostgreSQL integration checks pass: existing route/read scope, measured-gate refusal, rejected widened horizon, real engine projections, missing savings rate, linked-liability nulls, owner isolation, unchanged financial/audit rows and independent page/action blocking. Typecheck, lint, production Webpack build and client-secret scan pass. Real-model semantic quality remains unverified.
