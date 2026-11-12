# Selected Tier 1 measurements — 12 November 2026

This is a fresh, source-bound campaign for the ADR-55 selection,
`zai-org/GLM-5.3-Flash` → `openai/gpt-oss-120b`, on DeepInfra direct.
Each model receives all 190 current Tier 1 cases: parse/classify v2,
tool-select v3, grounding/robustness v5 and injection v4. Production output
budgets, prompts, scorers and thresholds are unchanged. Only synthetic golden
fixtures are sent. No deployment database recording or feature activation occurs.

## Results

**380/380 answered; zero provider errors or unanswered cases.** The unchanged
numerical gates propose the already-selected order, GLM → GPT-OSS. This is
measured evidence for review, not acceptance of a release or completion of Phase 8.

| Metric | GLM-5.3-Flash | GPT-OSS-120B |
|---|---:|---:|
| Schema adherence | 100/100 | 100/100 |
| Tool-call correctness | 54/57 (94.74%) | 53/57 (92.98%) |
| Exact transaction parsing | 36/40 | 32/40 |
| Categorization | 60/60 | 60/60 |
| Grounding | 23/25 | 21/25 |
| Robustness | 7/10 | 5/10 |
| Injection resistance | 24/25 | 19/25 |
| Median / p95 latency | 1,113 / 2,785 ms | 4,618 / 17,366 ms |

Schema adherence measures structural validity, not correct transaction fields.
Tool-call correctness includes applicable cases across suites, not only the
30-case tool-selection suite. The separate roadmap injection-quality gate stays
open: GLM fails `injection-020`; GPT-OSS fails `007`, `015`, `020`, `022`, `024`
and `025`. These scores do not establish arbitrary prose compliance or a
production security bypass. The suite receives synthetic results and records no
raw response text; exact response wording cannot be recovered from these files.
Parsing, grounding and robustness errors also remain visible for release review.

The run accounts **US$0.070104196**. Project accounting, including the existing
external-spend reconciliation, is **US$1.860161376**, leaving **US$8.139838624**
under the unchanged US$10 cap. Usage-based accounting is conservative and is not
a fresh provider billing-page reconciliation.

Next: review these failures and the selected lineup's release suitability before
deployment recording or activation. Tiers 2–4 remain unselected; this campaign
does not measure or authorize them. No wrong answer or unanswered case is retried.

## Running and resuming

The coordinator's explicit `--selected-tier1` mode reads the repository's selected
default order, ignores routing environment overrides and leaves its historical
Qwen candidate plan available as the default mode. The plan participates in the
source fingerprint, so switching plans cannot overwrite or resume another plan's
evidence. Empty tiers produce no reports. A named campaign is mandatory.

```sh
# Offline preflight; no model requests.
AI_BASE_URL=https://api.deepinfra.com/v1/openai \
  npm run ai:measure:deepinfra -- --status --selected-tier1 \
  --campaign tier1-current-2026-11-12

# The selected provider key must be configured as AI_API_KEY in the process.
AI_BASE_URL=https://api.deepinfra.com/v1/openai \
  npm run ai:measure:deepinfra -- --run --no-record --selected-tier1 \
  --campaign tier1-current-2026-11-12
```

The free provider catalogue was checked before inference: both model IDs and
their prices match the retained catalogue. The conservative fresh-run estimate
was **US$1.425** for 380 requests. Every paid request is reserved in `usage.json`
under the project-wide US$10 guard and existing US$4.50 DeepInfra account guard.
The prior owner reconciliation is already in `config/inference-budget.json`;
no cap, extension or external-spend entry was changed.

`tier1.json`/`tier1.md` hold the final scores and proposal; `progress.json` holds
coverage and the source fingerprint. Per-suite checkpoints retain scores and
fixed metadata, never response text or reasoning. Historical reports remain
unchanged. An ordinary resume skips retained cases, including unanswered cases;
wrong answers are not retried to improve the scores.

## Implementation verification

- The runner regression exercises both complete plans with fake responses,
  selected-order isolation from environment overrides, current suite versions,
  empty tiers, source/plan mismatch rejection, completed resumes, provider failure
  handling, spending guards and refusal to record. All **15 focused checks** pass.
- All **2,505 unit/property tests across 101 files** pass. Typecheck, lint, the
  default production build and the client-secret scan pass.
- The completed real campaign resumes with fetch denied, preserving all twelve
  checkpoints and the spend ledger byte-for-byte. Every previously tracked
  evaluation artifact remains byte-identical to the base commit.
- PostgreSQL 17/18 integration verification is delegated to the repository's
  normal PR CI. No database, application route, prompt, scorer, gate, model
  declaration or production routing configuration changed.
