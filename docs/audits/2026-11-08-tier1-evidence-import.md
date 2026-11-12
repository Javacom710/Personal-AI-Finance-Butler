# Tier 1 retained-evidence import preparation — 8 November 2026

<!-- project-doc-status:start -->
> **Status reviewed 12 November 2026:** Phase 8 quality/release review open; Phase 9 live AI disabled; Overview, Scenarios, metrics and TWR built; Phase 10 partial. OD-21/22/23 remain open. DeepInfra direct is selected.
> **Current references:** [Project state](../../PROJECT-STATE.md) · [Roadmap](../ROADMAP.md) · [Maintained deadline forecast](../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence; original score and finding body retained, source contracts may be historical.
<!-- project-doc-status:end -->

> Historical v3 preparation. The current prompt is v4, so this archived command/digest is stale. See the [v4 update](2026-11-08-parse-prompt-v4.md) and [current manifest](2026-11-08-tier1-parse-v4-evidence-preview.json). The original v3 preview remains byte-identical. No deployment recording has occurred.

Continues CI-green PR #64 (`d4f13eb`, PostgreSQL 17/18). Adds an offline preview and an explicit operator recording command for the retained parse-v3 Tier 1 campaign. **No deployment recording or activation has been performed.** The owner still needs to accept or resolve the [documented quality limitations](2026-11-08-tier1-release-review.md) before authorizing deployment evidence writes.

## Reviewable evidence and rows

The [committed preview](2026-11-08-tier1-evidence-preview.json) contains the exact twelve proposed database rows, the original campaign timestamp, failed-case identifiers, count/latency/outcome metadata, the selected model order, quality summaries and hashes of all fourteen input artifacts. Its review digest is `dc12fa595707112f1711fdabddd4fc93361e87da929ddf7593768c9d04983583`. No model response, prompt, credential or personal financial data is included.

`npm run --silent ai:evidence:tier1 -- --preview` reads only the fixed reviewed campaign directory. It accepts neither arbitrary model/tier inputs nor a different source campaign. It checks provider/plan/source provenance, current suite versions, exact model/suite/case coverage, request-profile identities, production output budgets, full answered counts and agreement between reports and retained cases. Latencies, outcome histograms, failed IDs, summary scores and the first-checkpoint timestamp must agree. The existing `assessEntry`/`checkpointReport` functions reconstruct reports from retained verdicts without inference or rescoring.

The row encoder is extracted from the existing `recordEvaluationRun`, retaining its checks and JSON shape. Preview and recording therefore share the same representation. The preview runs these rows through the existing production capability aggregator and selector, reproducing GLM-5.3-Flash → GPT-OSS-120B for both parsing and routine questions, in Tier 1 only. Existing gates, scorers, prompts, contracts, selected orders and schemas do not change.

The retained source identity stays pinned to the original campaign. Extracting the shared writer changes the current coordinator source fingerprint; the historical measurement campaign must not be resumed or re-emitted with the new source. Any future live measurement needs a fresh campaign. This importer only reads the retained artifacts.

The digest covers the canonical manifest (including input-byte hashes and exact rows), rather than the pretty-printed JSON file as a whole. Use the preview's `digest` value for review. Any input-byte change, including a diagnostic or whitespace change, produces a different pin. This identifies the reviewed bytes; it does not itself grant owner approval or certify real-model quality. A regression check pins the generated manifest to the committed review artifact. Preview's `recorded: false` means the preview made no write; it does not inspect deployment database state.

## Recording implementation prepared for review

After explicit owner approval, the operator command is:

```sh
npm run ai:evidence:tier1 -- --record --expect-sha256 dc12fa595707112f1711fdabddd4fc93361e87da929ddf7593768c9d04983583
```

**This command has not been run against the deployment database.** It is a deployment write that makes the recorded models eligible for the unchanged measured-capability loader. The preview needs no environment configuration, database connection, key or network. Recording loads the deployment configuration, revalidates the evidence/pin and requires the matching active DeepInfra endpoint, Tier 1 order and request profiles. Provider/key pairing follows the existing environment semantics.

Recording uses the ordinary evaluation writer inside a single database transaction. A transaction advisory lock serializes concurrent invocations of this import command. A complete, identical existing batch is a no-op, preserving row IDs and timestamps. A partial or altered batch, a collision at the existing database unique key, or newer matching evidence is refused without overwriting anything. Newer evidence at another endpoint is not pooled into this import. Normal database constraints remain authoritative, and any insert failure rolls back the entire batch. No schema or evaluation-detail fields are added.

The command does not edit settings, model orders or the false generation release hold. It does not run an evaluation, call a model, increase the spending cap, rewrite retained reports or deploy the application. Live verification and activation remain separate owner-reviewed steps. Accounted development inference spending remains US$1.932521049 of US$10.

## Verification

Focused verification passes 54 unit checks (including 28 new evidence checks) and 25 PostgreSQL checks (including 13 new import checks). The CLI preview succeeds with invalid database/secret configuration and all sockets/fetch denied. Retained inputs remain byte-identical. Mutation tests cover stale versions, foreign provenance, profiles/budgets, incomplete/duplicate coverage, forged counts/failure IDs/latencies/outcome summaries, unanswered cases and raw response fields.

Database writes occur only in the disposable integration database. Tests cover exact import/no-op behavior, concurrent duplicates, changed digest/configuration, partial/altered rows, newer matching evidence, endpoint isolation and a forced last-suite database failure with complete rollback. The real production generation hold remains false after those test imports. The full regression passes **2,572 unit, 65 property and 674 PostgreSQL 17 integration tests (3,311 total)**, plus typecheck, lint, production build, client-secret scan (24 client files) and integrity (35 passing, 0 failing). The final committed-manifest assertion passes its targeted rerun. Focused tests repeat cases included in the full totals. PostgreSQL 18 remains the follow-up PR's CI check; base #64 is already green on both versions.
