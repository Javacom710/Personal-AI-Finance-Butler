# Evaluation tier provenance — 7 November 2026

**Subsequent extension:** [independently measured tier eligibility](2026-11-07-ai-tiered-eligibility.md) adds separate full-corpus entries for additional tiers. The provenance isolation described here remains; the earlier one-tier-only limitation is superseded.

Fixed a provenance defect within the existing **one declared tier per capability entry** contract. This does not introduce multi-tier model eligibility or accept a production lineup.

## Defect and correction

`ai_model_evaluations` already stores `tier`, but `latestEvaluations()` omitted it from both its returned rows and the SQL latest-history partition. The pure capability loader then grouped by model/profile without checking the stored tier. Newer Tier 2/3 results could shadow another tier's shared suites, or several tiers could supply different parts of one supposedly complete measurement. The request budgets differ across tiers, so suite names and versions alone do not establish equivalence.

The query now retains the latest history independently by **model, tier, suite and request profile**, after filtering to the active provider. Returned rows retain their tier. Capability conversion accepts only rows whose tier equals the model's declared tier; missing, invalid and other-tier labels cannot complete or replace that tier's evidence.

Selection also checks `ModelCapabilities.tier` against the requested tier. A configuration override cannot make Tier 1 evidence authorize Tier 2/3, even with perfect scores. Rejection uses `tier_mismatch`. The evaluator's proposal check reuses this structural check, so a numerically passing candidate in another declared tier is no longer proposed as routable.

No migration is needed: the tier column already existed. The capability matrix remains one entry per model, with one declared tier. Supporting the same model in multiple tiers remains a separate design decision; measurements in several tiers are retained for comparison but do not expand eligibility automatically.

## Verification

- **2,072 unit tests pass**, including missing/invalid/wrong-tier rows, prevention of mixed-suite certification and newer-history shadowing, wrong-tier routing in both directions despite perfect scores, and rejection of an ineligible harness proposal.
- **10 PostgreSQL 17 integration tests pass** against a temporary, dedicated `financeos_test_ai_tiers` database. Real stored rows retain both Tier 1 and Tier 2 histories; newer Tier 2 results cannot shadow Tier 1. Passing Tier 3 rows cannot certify a Tier 2 model or replace its lower Tier 2 score. Existing provider/profile isolation tests still pass.
- Typecheck, lint, production build, client-secret scan and whitespace checks pass. The cached official PostgreSQL image required no package install or image download. The test container/database was removed afterward.
- No live model call, production evaluation recording, routing-order change, prompt change, scoring change or model promotion occurred. The original measurement files remain historical; prepared campaigns must use the current source fingerprint.

This closes the dropped-tier and cross-tier routing holes. Model quality, production lineup acceptance and a broader multi-tier capability representation remain unresolved.

[Verification metadata](2026-11-07-ai-tier-provenance-verification.json) confirms the 34 historical measurement artifacts are unchanged, the fresh campaign still retains zero cases, and no live provider request or production recording occurred for this change.
