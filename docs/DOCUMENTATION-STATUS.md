# Documentation status and review inventory

<!-- project-doc-status:start -->
> **Status reviewed 12 November 2026:** Phase 8 quality/release review open; Phase 9 live AI disabled; Overview, Scenarios, metrics and TWR built; Phase 10 partial. OD-21/22/23 remain open. DeepInfra direct is selected.
> **Current references:** [Project state](../PROJECT-STATE.md) · [Roadmap](ROADMAP.md) · [Maintained deadline forecast](../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Complete documentation review inventory.
<!-- project-doc-status:end -->

**Review date:** 12 November 2026 (Asia/Kolkata). **Coverage:** 119 project Markdown files.
The owner requested every `.md` file updated and a maintained project-end forecast
against actual progress. Root instructions, technical references, reviews, audits,
experiments and evaluation reports are included; dependencies, build output and
Git internals are excluded.

## Current reconciliation

Verified published main `50b604a` and latest Claude `259fa91`, then integrated the
latest TWR hardening with main's return-visibility guard. Overview, deterministic
Scenarios, Money metrics and TWR are built. Phase 8 quality/release review remains
open, Phase 9 live generation remains disabled and Phase 10 is partial. OD-21/22/23
remain open. See the [current handoff audit](audits/2026-11-12-claude-latest-handoff.md)
for source pins, verification and remaining work.

Every file below has a dated status annotation and working relative links to
state, roadmap and the [maintained forecast](../PROJECT-DEADLINE-FORECAST.md).
Current state, index, roadmap, decisions and forecast also receive substantive
corrections against actual code. Historical bodies are not rewritten as current
results. Both instruction files are byte-identical and require forecast upkeep
at the start/end of material tasks or PRs.

F1 remains **18 December 2026 core / 15 January 2027 full scope**, low confidence,
with explicit exit conditions, assumptions, milestone variance and an append-only
change log. No committed owner deadline, background maintenance job or live
activation is implied.

## Evidence preservation

The prior review at `7037372` covered 102 Markdown files. This review covers all
119 present files, including newer main/Claude work and the current audit.
Annotations change Markdown bytes only. Historical hashes refer to the original
commit/files, not newly annotated HEAD. Retrieve historical bodies from main
`50b604a` or, for independently retained PR #72 artifacts, `7037372`. Removing the
status annotation reproduces those historical report/audit bodies byte-for-byte.
The historical PR #72 diagnostic implementation is reproduced at its pinned
commit; it is not copied over newer main's implementation. Nov-12 parse-v2
measurements are historical for the current v4 prompt.

All existing machine-readable evaluation evidence remains unchanged except the
shared diagnostic usage ledger, which preserves main's eighteen-event prefix
and appends the independent fifteen-event probe run once. Sixteen absent JSON
campaign/probe files from `7037372` are copied byte-for-byte. The combined spending
account is US$2.079573720 / US$10, without new paid requests in this task. The
current v4 preview remains twelve rows with digest
`0b576c87529b09d01ac1411a5fb9974359f0f7787fa265155d5f62c27d591e9b`.
No historical score is relabeled, rescored or accepted as a current-contract run.

## Inventory — all reviewed 12 November 2026

| Project Markdown file | Role / interpretation |
|---|---|
| [AGENTS.md](../AGENTS.md) | Project instructions; forecast maintenance required. |
| [CLAUDE.md](../CLAUDE.md) | Project instructions; forecast maintenance required. |
| [PROJECT-DEADLINE-FORECAST.md](../PROJECT-DEADLINE-FORECAST.md) | Maintained forecast versus actual; frozen F1 baseline. |
| [PROJECT-STATE.md](../PROJECT-STATE.md) | Current status with dated historical checkpoints. |
| [docs/AI-INFRASTRUCTURE-DESIGN.md](AI-INFRASTRUCTURE-DESIGN.md) | Design/review reference; canonical implementation docs govern. |
| [docs/AI-SYSTEM.md](AI-SYSTEM.md) | Technical/operational reference; current state and roadmap govern completion. |
| [docs/ARCHITECTURE.md](ARCHITECTURE.md) | Technical/operational reference; current state and roadmap govern completion. |
| [docs/DECISIONS.md](DECISIONS.md) | Technical/operational reference; current state and roadmap govern completion. |
| [docs/DEPLOYMENT.md](DEPLOYMENT.md) | Technical/operational reference; current state and roadmap govern completion. |
| [docs/DOCUMENTATION-STATUS.md](DOCUMENTATION-STATUS.md) | Complete documentation review inventory. |
| [docs/FINANCIAL-DOMAIN.md](FINANCIAL-DOMAIN.md) | Technical/operational reference; current state and roadmap govern completion. |
| [docs/INVESTMENT-DOMAIN.md](INVESTMENT-DOMAIN.md) | Technical/operational reference; current state and roadmap govern completion. |
| [docs/INVESTMENT-ENGINE-DESIGN.md](INVESTMENT-ENGINE-DESIGN.md) | Design/review reference; canonical implementation docs govern. |
| [docs/MARKET-DATA-DESIGN.md](MARKET-DATA-DESIGN.md) | Design/review reference; canonical implementation docs govern. |
| [docs/MARKET-VALUE-NET-WORTH-DESIGN.md](MARKET-VALUE-NET-WORTH-DESIGN.md) | Design/review reference; canonical implementation docs govern. |
| [docs/NET-WORTH-DESIGN.md](NET-WORTH-DESIGN.md) | Design/review reference; canonical implementation docs govern. |
| [docs/OPENROUTER-CAMPAIGN.md](OPENROUTER-CAMPAIGN.md) | Unselected provider reference; DeepInfra remains selected. |
| [docs/OPENROUTER-MEASUREMENTS.md](OPENROUTER-MEASUREMENTS.md) | Unselected provider reference; DeepInfra remains selected. |
| [docs/PHASE9-CROSS-DOMAIN.md](PHASE9-CROSS-DOMAIN.md) | Feature activation contract; live generation disabled. |
| [docs/PHASE9-DOCUMENT-EXTRACTION.md](PHASE9-DOCUMENT-EXTRACTION.md) | Feature activation contract; live generation disabled. |
| [docs/PHASE9-FINANCIAL-HEALTH.md](PHASE9-FINANCIAL-HEALTH.md) | Feature activation contract; live generation disabled. |
| [docs/PHASE9-MONTHLY-REVIEWS.md](PHASE9-MONTHLY-REVIEWS.md) | Feature activation contract; live generation disabled. |
| [docs/PHASE9-PERIOD-SUMMARIES.md](PHASE9-PERIOD-SUMMARIES.md) | Feature activation contract; live generation disabled. |
| [docs/PHASE9-PORTFOLIO-ANALYSIS.md](PHASE9-PORTFOLIO-ANALYSIS.md) | Feature activation contract; live generation disabled. |
| [docs/PHASE9-READONLY-ASSISTANT.md](PHASE9-READONLY-ASSISTANT.md) | Feature activation contract; live generation disabled. |
| [docs/PHASE9-TRANSACTION-ENTRY.md](PHASE9-TRANSACTION-ENTRY.md) | Feature activation contract; live generation disabled. |
| [docs/README.md](README.md) | Documentation navigation and current status. |
| [docs/RECOVERY-2026-10.md](RECOVERY-2026-10.md) | Technical/operational reference; current state and roadmap govern completion. |
| [docs/ROADMAP.md](ROADMAP.md) | Technical/operational reference; current state and roadmap govern completion. |
| [docs/SCHEMA.md](SCHEMA.md) | Technical/operational reference; current state and roadmap govern completion. |
| [docs/SECURITY.md](SECURITY.md) | Technical/operational reference; current state and roadmap govern completion. |
| [docs/TESTING.md](TESTING.md) | Technical/operational reference; current state and roadmap govern completion. |
| [docs/audits/2026-09-24-phase8-entry-gate-audit.md](audits/2026-09-24-phase8-entry-gate-audit.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-09-25-b2-boundary-audit.md](audits/2026-09-25-b2-boundary-audit.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-07-ai-diagnostic-capture.md](audits/2026-11-07-ai-diagnostic-capture.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-07-ai-prompt-contracts.md](audits/2026-11-07-ai-prompt-contracts.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-07-ai-tier-provenance.md](audits/2026-11-07-ai-tier-provenance.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-07-ai-tiered-eligibility.md](audits/2026-11-07-ai-tiered-eligibility.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-07-assistant-workload-evidence.md](audits/2026-11-07-assistant-workload-evidence.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-07-claude-handoff-reconciliation.md](audits/2026-11-07-claude-handoff-reconciliation.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-07-claude-tier1-decision-original.md](audits/2026-11-07-claude-tier1-decision-original.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-07-open-pr-merge.md](audits/2026-11-07-open-pr-merge.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-07-phase8-reconciliation.md](audits/2026-11-07-phase8-reconciliation.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-07-tier1-contract-reconciliation.md](audits/2026-11-07-tier1-contract-reconciliation.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-08-parse-prompt-v4.md](audits/2026-11-08-parse-prompt-v4.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-08-tier1-evidence-import.md](audits/2026-11-08-tier1-evidence-import.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-08-tier1-generation-forms.md](audits/2026-11-08-tier1-generation-forms.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-08-tier1-intent-actions.md](audits/2026-11-08-tier1-intent-actions.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-08-tier1-release-review.md](audits/2026-11-08-tier1-release-review.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-08-tier1-runtime-composition.md](audits/2026-11-08-tier1-runtime-composition.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-08-tier1-v3-quality-diagnostics.md](audits/2026-11-08-tier1-v3-quality-diagnostics.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-11-claude-continuation.md](audits/2026-11-11-claude-continuation.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [docs/audits/2026-11-12-claude-latest-handoff.md](audits/2026-11-12-claude-latest-handoff.md) | Current continuation audit; local verification distinguished from CI. |
| [docs/audits/2026-11-12-tier1-failure-diagnostics.md](audits/2026-11-12-tier1-failure-diagnostics.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/experiments/README.md](../eval/experiments/README.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/experiments/REQUEST-PROFILE-PROPOSAL.md](../eval/experiments/REQUEST-PROFILE-PROPOSAL.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reassessment/2026-11-02/README.md](../eval/reassessment/2026-11-02/README.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reassessment/2026-11-02/candidate-review.md](../eval/reassessment/2026-11-02/candidate-review.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-01T13-34-39-tier4.md](../eval/reports/2026-11-01T13-34-39-tier4.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-01T13-36-26-tier4.md](../eval/reports/2026-11-01T13-36-26-tier4.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-01T13-56-20-tier1.md](../eval/reports/2026-11-01T13-56-20-tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-01T13-57-50-tier3.md](../eval/reports/2026-11-01T13-57-50-tier3.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-02T05-44-53-tier1.md](../eval/reports/2026-11-02T05-44-53-tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-02T07-21-15-tier1.md](../eval/reports/2026-11-02T07-21-15-tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-02T13-20-02-tier1.md](../eval/reports/2026-11-02T13-20-02-tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T07-44-06-tier1.md](../eval/reports/2026-11-07T07-44-06-tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T07-44-09-tier1.md](../eval/reports/2026-11-07T07-44-09-tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T07-44-12-tier2.md](../eval/reports/2026-11-07T07-44-12-tier2.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T07-44-15-tier3.md](../eval/reports/2026-11-07T07-44-15-tier3.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T07-44-18-tier4.md](../eval/reports/2026-11-07T07-44-18-tier4.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T14-10-16-tier1.md](../eval/reports/2026-11-07T14-10-16-tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T14-10-19-tier1.md](../eval/reports/2026-11-07T14-10-19-tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T14-10-22-tier1.md](../eval/reports/2026-11-07T14-10-22-tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T14-10-25-tier1.md](../eval/reports/2026-11-07T14-10-25-tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T14-10-28-tier2.md](../eval/reports/2026-11-07T14-10-28-tier2.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T14-10-31-tier2.md](../eval/reports/2026-11-07T14-10-31-tier2.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T14-10-35-tier2.md](../eval/reports/2026-11-07T14-10-35-tier2.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T14-10-38-tier3.md](../eval/reports/2026-11-07T14-10-38-tier3.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T15-26-03-tier1.md](../eval/reports/2026-11-07T15-26-03-tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T15-26-06-tier1.md](../eval/reports/2026-11-07T15-26-06-tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T15-26-08-tier1.md](../eval/reports/2026-11-07T15-26-08-tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T15-26-12-tier2.md](../eval/reports/2026-11-07T15-26-12-tier2.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T15-26-15-tier2.md](../eval/reports/2026-11-07T15-26-15-tier2.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T15-26-18-tier2.md](../eval/reports/2026-11-07T15-26-18-tier2.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/2026-11-07T15-26-21-tier2.md](../eval/reports/2026-11-07T15-26-21-tier2.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-external-pr50/README.md](../eval/reports/deepinfra-2026-11-07-external-pr50/README.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-format-v3/README.md](../eval/reports/deepinfra-2026-11-07-format-v3/README.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-format-v3/tier1.md](../eval/reports/deepinfra-2026-11-07-format-v3/tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-format-v3/tier2.md](../eval/reports/deepinfra-2026-11-07-format-v3/tier2.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-format-v3/tier3.md](../eval/reports/deepinfra-2026-11-07-format-v3/tier3.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-format-v3/tier4.md](../eval/reports/deepinfra-2026-11-07-format-v3/tier4.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-qwen-235b-v1/README.md](../eval/reports/deepinfra-2026-11-07-qwen-235b-v1/README.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-qwen-235b-v1/tier1.md](../eval/reports/deepinfra-2026-11-07-qwen-235b-v1/tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-qwen-235b-v1/tier2.md](../eval/reports/deepinfra-2026-11-07-qwen-235b-v1/tier2.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-qwen-235b-v1/tier3.md](../eval/reports/deepinfra-2026-11-07-qwen-235b-v1/tier3.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-qwen-235b-v1/tier4.md](../eval/reports/deepinfra-2026-11-07-qwen-235b-v1/tier4.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-tier1-current-2026-11-08/README.md](../eval/reports/deepinfra-2026-11-07-tier1-current-2026-11-08/README.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-tier1-current-2026-11-08/tier1.md](../eval/reports/deepinfra-2026-11-07-tier1-current-2026-11-08/tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-tier1-current-2026-11-12/README.md](../eval/reports/deepinfra-2026-11-07-tier1-current-2026-11-12/README.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-tier1-current-2026-11-12/tier1.md](../eval/reports/deepinfra-2026-11-07-tier1-current-2026-11-12/tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-tier1-parse-v3-2026-11-08/README.md](../eval/reports/deepinfra-2026-11-07-tier1-parse-v3-2026-11-08/README.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-tier1-parse-v3-2026-11-08/tier1.md](../eval/reports/deepinfra-2026-11-07-tier1-parse-v3-2026-11-08/tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-tier1-parse-v4-2026-11-08/README.md](../eval/reports/deepinfra-2026-11-07-tier1-parse-v4-2026-11-08/README.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07-tier1-parse-v4-2026-11-08/tier1.md](../eval/reports/deepinfra-2026-11-07-tier1-parse-v4-2026-11-08/tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07/README.md](../eval/reports/deepinfra-2026-11-07/README.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07/claude-original-README.md](../eval/reports/deepinfra-2026-11-07/claude-original-README.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07/claude-rounds2-3-original-README.md](../eval/reports/deepinfra-2026-11-07/claude-rounds2-3-original-README.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07/codex-original-README.md](../eval/reports/deepinfra-2026-11-07/codex-original-README.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07/diagnostics/README.md](../eval/reports/deepinfra-2026-11-07/diagnostics/README.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07/diagnostics/numeric-presentation.md](../eval/reports/deepinfra-2026-11-07/diagnostics/numeric-presentation.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07/tier1.md](../eval/reports/deepinfra-2026-11-07/tier1.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07/tier2.md](../eval/reports/deepinfra-2026-11-07/tier2.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07/tier3.md](../eval/reports/deepinfra-2026-11-07/tier3.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-07/tier4.md](../eval/reports/deepinfra-2026-11-07/tier4.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-08-tier1-diagnostics/README.md](../eval/reports/deepinfra-2026-11-08-tier1-diagnostics/README.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/deepinfra-2026-11-08-tier1-v3-failures/README.md](../eval/reports/deepinfra-2026-11-08-tier1-v3-failures/README.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/groq-2026-11-02/README.md](../eval/reports/groq-2026-11-02/README.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/groq-2026-11-02/remaining-work.md](../eval/reports/groq-2026-11-02/remaining-work.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |
| [eval/reports/groq-workflow-progress.md](../eval/reports/groq-workflow-progress.md) | Dated evidence; original score and finding body retained, source contracts may be historical. |

## Maintenance

Update this inventory when project Markdown is added, removed or changes role.
Refresh relevant substantive references when implementation changes; annotations
are dated snapshots. Maintain the forecast at material task/PR boundaries,
including a reason when dates remain unchanged. Check coverage, relative links,
historical body preservation and instruction-file equality before publication.
