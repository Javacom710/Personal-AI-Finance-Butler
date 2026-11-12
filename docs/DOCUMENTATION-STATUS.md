# Documentation status and review inventory

<!-- project-doc-status:start -->
> **Project status reviewed 12 November 2026:** Phases 0–7 complete; Phase 8 quality/release review open; Phase 9 built but live AI disabled. Selected provider: DeepInfra direct.
> **Current references:** [Project state](../PROJECT-STATE.md) · [Roadmap](ROADMAP.md) · [Maintained deadline forecast](../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Complete documentation review inventory.
<!-- project-doc-status:end -->

**Review date:** 12 November 2026 (Asia/Kolkata). **Coverage:** 102 project Markdown files.
The owner requested every `.md` file updated and a maintained project end forecast.
This inventory includes root instructions, canonical docs, design reviews, audits,
experiments and evaluation reports. Dependencies, build output and Git internals
are outside the project-documentation inventory.

## What changed

Every file below has a dated current-status annotation and working relative links
to project state, roadmap and the [maintained deadline forecast](../PROJECT-DEADLINE-FORECAST.md).
Active references also receive relevant substantive corrections: approved integration
scope, current provider, real workspace prerequisites, PostgreSQL 17/18 CI,
actual test duration versus design speed targets, and phase/forecast maintenance.
Both instruction files remain byte-identical and require forecast updates at
material task/PR boundaries.

The forecast records a conditional core target of **18 December 2026** and full
approved-scope target of **15 January 2027**, low confidence, with explicit scope,
windows, assumptions, milestone actuals, variance and an append-only change log.
There was no earlier forecast; completed work is not given an invented historical
planned date. No committed owner deadline, automatic daily job, activation,
deployment or new feature approval is implied.

## Evidence preservation

The status annotations on historical records are an explicit part of this owner's
all-Markdown update request. They change Markdown file bytes, not historical
measurement outcomes. Previously recorded source/archive hashes describe the
commit and files at the time of those audits; they are not hashes of the new
annotated HEAD. Retrieve the pre-review body from parent commit `529aef7` when
byte-level original evidence is required. After removing the new annotation,
all previously committed historical Markdown report/audit bodies are unchanged.

The full 380-case campaign's JSON reports, checkpoints and usage are unchanged.
Fifteen fresh diagnostic probes have a separate JSON report; only the shared
diagnostic usage ledger appends fifteen events, preserving its old prefix.
Partial probes do not rescore historical failures or certify a model.

## Inventory — all reviewed on 12 November 2026

| Project Markdown file | Role / how to interpret it |
|---|---|
| [AGENTS.md](../AGENTS.md) | Project instructions; forecast maintenance required |
| [CLAUDE.md](../CLAUDE.md) | Project instructions; forecast maintenance required |
| [PROJECT-DEADLINE-FORECAST.md](../PROJECT-DEADLINE-FORECAST.md) | Maintained forecast versus actual; frozen F1 baseline |
| [PROJECT-STATE.md](../PROJECT-STATE.md) | Current status with dated historical checkpoints |
| [docs/AI-INFRASTRUCTURE-DESIGN.md](AI-INFRASTRUCTURE-DESIGN.md) | Design/review reference; canonical implementation docs govern |
| [docs/AI-SYSTEM.md](AI-SYSTEM.md) | Active technical/operational reference; roadmap governs completion |
| [docs/ARCHITECTURE.md](ARCHITECTURE.md) | Active technical/operational reference; roadmap governs completion |
| [docs/DECISIONS.md](DECISIONS.md) | Active technical/operational reference; roadmap governs completion |
| [docs/DEPLOYMENT.md](DEPLOYMENT.md) | Active technical/operational reference; roadmap governs completion |
| [docs/DOCUMENTATION-STATUS.md](DOCUMENTATION-STATUS.md) | Complete documentation review inventory |
| [docs/FINANCIAL-DOMAIN.md](FINANCIAL-DOMAIN.md) | Active technical/operational reference; roadmap governs completion |
| [docs/INVESTMENT-DOMAIN.md](INVESTMENT-DOMAIN.md) | Active technical/operational reference; roadmap governs completion |
| [docs/INVESTMENT-ENGINE-DESIGN.md](INVESTMENT-ENGINE-DESIGN.md) | Design/review reference; canonical implementation docs govern |
| [docs/MARKET-DATA-DESIGN.md](MARKET-DATA-DESIGN.md) | Design/review reference; canonical implementation docs govern |
| [docs/MARKET-VALUE-NET-WORTH-DESIGN.md](MARKET-VALUE-NET-WORTH-DESIGN.md) | Design/review reference; canonical implementation docs govern |
| [docs/NET-WORTH-DESIGN.md](NET-WORTH-DESIGN.md) | Design/review reference; canonical implementation docs govern |
| [docs/OPENROUTER-CAMPAIGN.md](OPENROUTER-CAMPAIGN.md) | Unselected provider reference; DeepInfra remains selected |
| [docs/OPENROUTER-MEASUREMENTS.md](OPENROUTER-MEASUREMENTS.md) | Unselected provider reference; DeepInfra remains selected |
| [docs/PHASE9-CROSS-DOMAIN.md](PHASE9-CROSS-DOMAIN.md) | Feature activation contract; live generation disabled |
| [docs/PHASE9-DOCUMENT-EXTRACTION.md](PHASE9-DOCUMENT-EXTRACTION.md) | Feature activation contract; live generation disabled |
| [docs/PHASE9-FINANCIAL-HEALTH.md](PHASE9-FINANCIAL-HEALTH.md) | Feature activation contract; live generation disabled |
| [docs/PHASE9-MONTHLY-REVIEWS.md](PHASE9-MONTHLY-REVIEWS.md) | Feature activation contract; live generation disabled |
| [docs/PHASE9-PERIOD-SUMMARIES.md](PHASE9-PERIOD-SUMMARIES.md) | Feature activation contract; live generation disabled |
| [docs/PHASE9-PORTFOLIO-ANALYSIS.md](PHASE9-PORTFOLIO-ANALYSIS.md) | Feature activation contract; live generation disabled |
| [docs/PHASE9-READONLY-ASSISTANT.md](PHASE9-READONLY-ASSISTANT.md) | Feature activation contract; live generation disabled |
| [docs/PHASE9-TRANSACTION-ENTRY.md](PHASE9-TRANSACTION-ENTRY.md) | Feature activation contract; live generation disabled |
| [docs/README.md](README.md) | Documentation navigation and current status |
| [docs/RECOVERY-2026-10.md](RECOVERY-2026-10.md) | Active technical/operational reference; roadmap governs completion |
| [docs/ROADMAP.md](ROADMAP.md) | Active technical/operational reference; roadmap governs completion |
| [docs/SCHEMA.md](SCHEMA.md) | Active technical/operational reference; roadmap governs completion |
| [docs/SECURITY.md](SECURITY.md) | Active technical/operational reference; roadmap governs completion |
| [docs/TESTING.md](TESTING.md) | Active technical/operational reference; roadmap governs completion |
| [docs/audits/2026-09-24-phase8-entry-gate-audit.md](audits/2026-09-24-phase8-entry-gate-audit.md) | Dated evidence; original score and finding body retained |
| [docs/audits/2026-09-25-b2-boundary-audit.md](audits/2026-09-25-b2-boundary-audit.md) | Dated evidence; original score and finding body retained |
| [docs/audits/2026-11-07-ai-diagnostic-capture.md](audits/2026-11-07-ai-diagnostic-capture.md) | Dated evidence; original score and finding body retained |
| [docs/audits/2026-11-07-ai-prompt-contracts.md](audits/2026-11-07-ai-prompt-contracts.md) | Dated evidence; original score and finding body retained |
| [docs/audits/2026-11-07-ai-tier-provenance.md](audits/2026-11-07-ai-tier-provenance.md) | Dated evidence; original score and finding body retained |
| [docs/audits/2026-11-07-ai-tiered-eligibility.md](audits/2026-11-07-ai-tiered-eligibility.md) | Dated evidence; original score and finding body retained |
| [docs/audits/2026-11-07-assistant-workload-evidence.md](audits/2026-11-07-assistant-workload-evidence.md) | Dated evidence; original score and finding body retained |
| [docs/audits/2026-11-07-claude-handoff-reconciliation.md](audits/2026-11-07-claude-handoff-reconciliation.md) | Dated evidence; original score and finding body retained |
| [docs/audits/2026-11-07-claude-tier1-decision-original.md](audits/2026-11-07-claude-tier1-decision-original.md) | Dated evidence; original score and finding body retained |
| [docs/audits/2026-11-07-open-pr-merge.md](audits/2026-11-07-open-pr-merge.md) | Dated evidence; original score and finding body retained |
| [docs/audits/2026-11-07-phase8-reconciliation.md](audits/2026-11-07-phase8-reconciliation.md) | Dated evidence; original score and finding body retained |
| [docs/audits/2026-11-07-tier1-contract-reconciliation.md](audits/2026-11-07-tier1-contract-reconciliation.md) | Dated evidence; original score and finding body retained |
| [docs/audits/2026-11-12-tier1-failure-diagnostics.md](audits/2026-11-12-tier1-failure-diagnostics.md) | Dated evidence; original score and finding body retained |
| [eval/experiments/README.md](../eval/experiments/README.md) | Dated evidence; original score and finding body retained |
| [eval/experiments/REQUEST-PROFILE-PROPOSAL.md](../eval/experiments/REQUEST-PROFILE-PROPOSAL.md) | Dated evidence; original score and finding body retained |
| [eval/reassessment/2026-11-02/README.md](../eval/reassessment/2026-11-02/README.md) | Dated evidence; original score and finding body retained |
| [eval/reassessment/2026-11-02/candidate-review.md](../eval/reassessment/2026-11-02/candidate-review.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-01T13-34-39-tier4.md](../eval/reports/2026-11-01T13-34-39-tier4.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-01T13-36-26-tier4.md](../eval/reports/2026-11-01T13-36-26-tier4.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-01T13-56-20-tier1.md](../eval/reports/2026-11-01T13-56-20-tier1.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-01T13-57-50-tier3.md](../eval/reports/2026-11-01T13-57-50-tier3.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-02T05-44-53-tier1.md](../eval/reports/2026-11-02T05-44-53-tier1.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-02T07-21-15-tier1.md](../eval/reports/2026-11-02T07-21-15-tier1.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-02T13-20-02-tier1.md](../eval/reports/2026-11-02T13-20-02-tier1.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T07-44-06-tier1.md](../eval/reports/2026-11-07T07-44-06-tier1.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T07-44-09-tier1.md](../eval/reports/2026-11-07T07-44-09-tier1.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T07-44-12-tier2.md](../eval/reports/2026-11-07T07-44-12-tier2.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T07-44-15-tier3.md](../eval/reports/2026-11-07T07-44-15-tier3.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T07-44-18-tier4.md](../eval/reports/2026-11-07T07-44-18-tier4.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T14-10-16-tier1.md](../eval/reports/2026-11-07T14-10-16-tier1.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T14-10-19-tier1.md](../eval/reports/2026-11-07T14-10-19-tier1.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T14-10-22-tier1.md](../eval/reports/2026-11-07T14-10-22-tier1.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T14-10-25-tier1.md](../eval/reports/2026-11-07T14-10-25-tier1.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T14-10-28-tier2.md](../eval/reports/2026-11-07T14-10-28-tier2.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T14-10-31-tier2.md](../eval/reports/2026-11-07T14-10-31-tier2.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T14-10-35-tier2.md](../eval/reports/2026-11-07T14-10-35-tier2.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T14-10-38-tier3.md](../eval/reports/2026-11-07T14-10-38-tier3.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T15-26-03-tier1.md](../eval/reports/2026-11-07T15-26-03-tier1.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T15-26-06-tier1.md](../eval/reports/2026-11-07T15-26-06-tier1.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T15-26-08-tier1.md](../eval/reports/2026-11-07T15-26-08-tier1.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T15-26-12-tier2.md](../eval/reports/2026-11-07T15-26-12-tier2.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T15-26-15-tier2.md](../eval/reports/2026-11-07T15-26-15-tier2.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T15-26-18-tier2.md](../eval/reports/2026-11-07T15-26-18-tier2.md) | Dated evidence; original score and finding body retained |
| [eval/reports/2026-11-07T15-26-21-tier2.md](../eval/reports/2026-11-07T15-26-21-tier2.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07-external-pr50/README.md](../eval/reports/deepinfra-2026-11-07-external-pr50/README.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07-format-v3/README.md](../eval/reports/deepinfra-2026-11-07-format-v3/README.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07-format-v3/tier1.md](../eval/reports/deepinfra-2026-11-07-format-v3/tier1.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07-format-v3/tier2.md](../eval/reports/deepinfra-2026-11-07-format-v3/tier2.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07-format-v3/tier3.md](../eval/reports/deepinfra-2026-11-07-format-v3/tier3.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07-format-v3/tier4.md](../eval/reports/deepinfra-2026-11-07-format-v3/tier4.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07-qwen-235b-v1/README.md](../eval/reports/deepinfra-2026-11-07-qwen-235b-v1/README.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07-qwen-235b-v1/tier1.md](../eval/reports/deepinfra-2026-11-07-qwen-235b-v1/tier1.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07-qwen-235b-v1/tier2.md](../eval/reports/deepinfra-2026-11-07-qwen-235b-v1/tier2.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07-qwen-235b-v1/tier3.md](../eval/reports/deepinfra-2026-11-07-qwen-235b-v1/tier3.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07-qwen-235b-v1/tier4.md](../eval/reports/deepinfra-2026-11-07-qwen-235b-v1/tier4.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07-tier1-current-2026-11-12/README.md](../eval/reports/deepinfra-2026-11-07-tier1-current-2026-11-12/README.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07-tier1-current-2026-11-12/tier1.md](../eval/reports/deepinfra-2026-11-07-tier1-current-2026-11-12/tier1.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07/README.md](../eval/reports/deepinfra-2026-11-07/README.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07/claude-original-README.md](../eval/reports/deepinfra-2026-11-07/claude-original-README.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07/claude-rounds2-3-original-README.md](../eval/reports/deepinfra-2026-11-07/claude-rounds2-3-original-README.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07/codex-original-README.md](../eval/reports/deepinfra-2026-11-07/codex-original-README.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07/diagnostics/README.md](../eval/reports/deepinfra-2026-11-07/diagnostics/README.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07/diagnostics/numeric-presentation.md](../eval/reports/deepinfra-2026-11-07/diagnostics/numeric-presentation.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07/tier1.md](../eval/reports/deepinfra-2026-11-07/tier1.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07/tier2.md](../eval/reports/deepinfra-2026-11-07/tier2.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07/tier3.md](../eval/reports/deepinfra-2026-11-07/tier3.md) | Dated evidence; original score and finding body retained |
| [eval/reports/deepinfra-2026-11-07/tier4.md](../eval/reports/deepinfra-2026-11-07/tier4.md) | Dated evidence; original score and finding body retained |
| [eval/reports/groq-2026-11-02/README.md](../eval/reports/groq-2026-11-02/README.md) | Dated evidence; original score and finding body retained |
| [eval/reports/groq-2026-11-02/remaining-work.md](../eval/reports/groq-2026-11-02/remaining-work.md) | Dated evidence; original score and finding body retained |
| [eval/reports/groq-workflow-progress.md](../eval/reports/groq-workflow-progress.md) | Dated evidence; original score and finding body retained |

## Keep this review current

Update this inventory when a Markdown file is added, removed or changes role.
Refresh substantive status in relevant active references after material changes;
a review annotation is a dated snapshot, not a promise that a file updates itself.
Preserve dated finding and score bodies rather than rewriting the past.
Maintain the deadline forecast at the start and end of each material task/PR,
including reviews that leave its dates unchanged. Validate relative links,
coverage and instruction-file equality before publishing documentation changes.
