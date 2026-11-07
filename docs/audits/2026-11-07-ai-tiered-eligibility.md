# Independently measured tier eligibility — 7 November 2026

The same model can now have separate measured entries for several application tiers. Shared declarations supply physical capabilities and a default tier; they do not supply another tier's quality scores. This extends the earlier [tier-provenance correction](2026-11-07-ai-tier-provenance.md) while retaining its isolation guarantees.

## Contract

- Storage histories remain separate by active provider, model, tier, suite and request profile. One database read builds a `MeasuredCapabilitySnapshot` with default-tier entries and independently measured tier entries.
- A measured tier requires every current suite, its full golden-case answer count, zero unanswered cases and the exact production output budget. Fixed schema/tool applicability counts must match the corpus, and all counts must be valid and internally bounded. Analysis answers cannot pad the tool score. The latest invalid matching row blocks that tier; it does not revive older passing data.
- `CapabilityMatrix.get(model, tier)` uses that tier's measured entry. Missing evidence falls back to the default declaration/entry, where the existing `tier_mismatch` or unmeasured-score guard refuses the request. `get(model)` retains default-tier behavior.
- A model may therefore pass Tier 2 while failing Tier 1; Tier 2 scores cannot authorize Tier 1 or Tier 3. Physical tool/schema/vision support, active request profile, numeric thresholds, health checks, budget accounting and the explicit Tier 3 user-action requirement remain in force.
- Existing default routing lists are unchanged. An entry is considered only if the model is configured for the requested tier; recording and production order acceptance still require the owner's decision.

The runtime loads strict tier snapshots for default-tier routing too. Legacy/partial rows lacking full corpus coverage or production-budget provenance cannot activate a route. The lower-level declared-tier conversion remains available as an aggregation/compatibility helper; it is not the runtime activation path.

## Proposals and compatibility

Cross-tier proposals require their own full current suite results, production budgets and exact case IDs without duplicates or another model's cases. A numeric aggregate by itself cannot create a proposal. The readiness report now distinguishes physical support and missing/failed measurement evidence without the former structural one-tier limitation.

No migration or new dependency is needed: the database already retains the tier and request metadata. The tier-provenance reader and default-tier compatibility projection remain intact. Model ids stay in configuration, no model-specific prompt or request control was added, and circuit-breaker/daily-usage identities keep their existing scope.

## Verification

**2,097 unit tests** and **12 PostgreSQL 17 integration tests** pass, plus typecheck, lint, production build and client-secret checks. Coverage includes:

- Tier 2 selection while the same model fails Tier 1, with unchanged declarations and default routing;
- refusal of another tier/provider/profile's rows, partial corpora, wrong/missing budgets, stale versions, undersampled scores and analysis-based tool-score padding;
- blocking older evidence after a newer invalid row;
- physical capability and profile checks, scoped staleness, invalid/unknown entries;
- complete independent proposals and rejection of wrong budgets, old versions, missing/duplicate/foreign cases or duplicate suites;
- real stored rows through snapshot loading and selection, followed by refusal after a newer incomplete suite.

The PostgreSQL database is temporary and contains synthetic evaluation rows only. No production evaluation was recorded or routing order accepted by this implementation. Current model quality is still a separate measurement and approval question.

## Fresh DeepInfra measurements

The subsequent source-bound `format-v3` run completed all 23 entries / 610 cases: 603 answers and seven timeouts. None qualifies under the existing gates. Independent tier representation is implemented, but that does not certify model quality. [Per-tier approval report](../../eval/reports/deepinfra-2026-11-07-format-v3/README.md) and [verification JSON](2026-11-07-ai-tiered-eligibility-verification.json) retain the current outcomes, source fingerprint and accounting.

An offline status run validated the current checkpoints without a provider request; all 23 checkpoint hashes and the usage hash were unchanged, as were all 34 original measurement artifacts. The account lock was released. No production evaluation was recorded or order changed. Phase 8 remains open; no Phase 9 feature was activated.
