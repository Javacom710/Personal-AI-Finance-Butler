# Claude handoff reconciliation — 7 November 2026

This isolated integration combines the documentation refresh in Claude PR #52 (`f932d7f`) and test-isolation fix in #53 (`ae472e4`) with the verified assistant continuation #55 (`fa62ca2`). Both incoming heads remain merge parents. No original Claude branch or main was modified. This is a consolidated review path for the overlapping #52/#53 work; do not independently apply duplicate conflicting patches after accepting it.

## Preserved history and resolved overlap

The project-state and earlier reconciliation audit conflicts were resolved using bounded line markers, preserving both sides. All 69 project headings from each input remain present. The two independent verification records are labeled with their distinct contexts, instead of combining their observations into one claimed run. Both AGENTS.md and CLAUDE.md receive the identical, owner-authorized DeepInfra provider correction.

The budget fixture retains #51's exact restoration of undefined variables and adds #53's full four-variable isolation (`AI_API_KEY`, `AI_BASE_URL`, `NVIDIA_API_KEY`, `NVIDIA_BASE_URL`) plus the explicit unconfigured-provider assertion. The testing document records the gap as closed; running tests no longer requires editing a developer's `.env`.

The broader documentation now names DeepInfra direct, preserves the prohibition on Google/Anthropic through it, and records ADR-54/OD-20. Reconciliation corrects stale details in the incoming draft:

- The injection quality checkbox stays incomplete. Running the corpus with failing adversarial cases is not evidence that a production candidate satisfies it.
- The older Phase 5 table/test counts are retained under a historical heading with a valid Markdown table; they no longer appear as current status.
- The format-v3 campaign is labeled historical for later prompt/source changes. Diagnostic samples are not generalized into proof that layout never matters.
- #54's third-round GLM candidate remains separate source-bound evidence with conflicting version identities. Its scorer, scores and colliding README are not imported. Additional external spending still needs reconciliation before new paid work.
- Deployment examples use `APP_ORIGIN` and distinct app/migration-role URLs. The provider decision records the initial prepaid credit and testing authorization, without claiming unverified auto-recharge settings or activating a serving lineup. The finite workspace spending lock is distinguished from external runs that have not entered its ledger.

## Verification and boundaries

All nine budget tests pass in **six configurations**: shell generic/legacy keys, `.env` generic/legacy keys, and neither, on PostgreSQL 17 and 18. That is **54 passing checks**, zero failures. A preload denies fetch and writes a marker on any attempt; no marker was created. Only fake keys and temporary `.env` content were used, and pre-existing environment files were never overwritten. Disposable app/migrator roles and test databases were used.

Typecheck, fixture ESLint, whitespace and newly added relative documentation-link checks pass. The runtime, app, scripts, prompts, scorer versions, model orders, all measurement reports and dependency manifests are byte-identical to #55, whose full PostgreSQL 17/18 CI run [42388730630](https://github.com/Javacom710/Personal-AI-Finance-Butler/actions/runs/42388730630) is green. Production build/model suites are not repeated for documentation and test-fixture isolation changes. Historical campaigns are not relabeled or rescored.

No provider call, live-measurement recording, feature activation or main merge occurred. Original Claude PRs remain available for provenance. [Verification JSON](2026-11-07-claude-handoff-reconciliation-verification.json) retains the configuration matrix and evidence hashes.
