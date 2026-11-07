# Period summaries

Built under the standing Phase 9 approval, stacked on cross-domain PR #46. This slice supports recorded calendar months using existing tools. Quarterly/yearly summaries remain explicitly unavailable pending the owner's answer about a bounded deterministic period-summary tool. Unsupported period inputs are rejected, never silently treated as a month.

The existing Tier 1 `summarizeFinancialData` capability gates a native tool request and final qualitative summary, preserving its production output budget. Four existing owner-bound reads supply monthly cash flow, previous-month comparison and income/expense category totals. Calendar boundaries and every figure come from existing engine/tool behavior. The shared review runner checks the complete read batch before executing application-owned arguments; it cannot add a tool, write records or retry an invalid answer.

The view separates facts, exact deterministic calculations, qualitative interpretation and recommendation. Missing metrics retain unavailable reasons. The current month retains the recorded-calendar-period scope, including recorded future-dated entries in that month. The feature introduces no quarterly/yearly aggregation, AI arithmetic, scenario or hypothetical return.

The authenticated `/ai/reviews/summary` page has disabled month controls and generation. Its independently authenticated direct action returns unavailable without financial reads or a model. No environment flag enables it. Fake providers only; no new database/tool schema, existing gate/rule, tier order, baseline prompt, scorer/suite change or persistence. Real-model semantic quality remains unverified pending lineup approval and reviewed runtime composition.

Validation: **58 focused unit checks and two PostgreSQL integration checks pass**, including exact engine projections, decimal savings, owner isolation, unchanged ledgers/audits, existing Tier 1 production budget, unsupported-period refusal, unmeasured-route blocking and independent page/action authentication. Typecheck, lint, production Webpack build and client-secret scan pass. CI uses ordinary installation/default builds on PostgreSQL 17/18.
