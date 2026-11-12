# Documentation Index

Durable technical reference for the Personal Finance & Investment OS. Read in this order when picking up implementation work.

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Product architecture, technical stack, layering, module map, UI information architecture |
| [DECISIONS.md](DECISIONS.md) | Numbered ADRs — every material decision with rationale and rejected alternatives |
| [SCHEMA.md](SCHEMA.md) | Full database schema, invariants, indexes, migration policy |
| [FINANCIAL-DOMAIN.md](FINANCIAL-DOMAIN.md) | Money type, accounts, ledger, transfers, budgets, recurring, cash-flow calculations |
| [INVESTMENT-DOMAIN.md](INVESTMENT-DOMAIN.md) | Instruments, investment ledger, lot engine, corporate actions, portfolio metrics, XIRR/TWR, market data |
| [AI-SYSTEM.md](AI-SYSTEM.md) | Model routing, tool surface, proposal/confirmation flow, prompt caching, cost control, injection defence |
| [SECURITY.md](SECURITY.md) | Auth, sessions, secrets, transport, headers, data boundaries, export/delete |
| [TESTING.md](TESTING.md) | Test strategy, layers, fixtures, golden scenarios, coverage bar |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Environments, hosting, TLS, backup/restore, operations |
| [ROADMAP.md](ROADMAP.md) | Phased delivery plan with per-phase definition of done |
| [RECOVERY-2026-10.md](RECOVERY-2026-10.md) | The October 2026 disk-failure recovery: what was rebuilt, the current blocker register, the order of remaining work, and how agents work from GitHub |
| [AI-INFRASTRUCTURE-DESIGN.md](AI-INFRASTRUCTURE-DESIGN.md) | The Phase 7 design review: read-only AI boundary, routing, budgets, open decisions OD-17/OD-18 |
| [INVESTMENT-ENGINE-DESIGN.md](INVESTMENT-ENGINE-DESIGN.md), [NET-WORTH-DESIGN.md](NET-WORTH-DESIGN.md), [MARKET-DATA-DESIGN.md](MARKET-DATA-DESIGN.md), [MARKET-VALUE-NET-WORTH-DESIGN.md](MARKET-VALUE-NET-WORTH-DESIGN.md) | Phase 4–6 design reviews, applied to the canonical documents above |
| `PHASE9-*.md` | One activation contract per Phase 9 feature: [transaction entry](PHASE9-TRANSACTION-ENTRY.md), [read-only assistant](PHASE9-READONLY-ASSISTANT.md), [monthly reviews](PHASE9-MONTHLY-REVIEWS.md), [portfolio analysis](PHASE9-PORTFOLIO-ANALYSIS.md), [financial health](PHASE9-FINANCIAL-HEALTH.md), [period summaries](PHASE9-PERIOD-SUMMARIES.md), [cross-domain analysis](PHASE9-CROSS-DOMAIN.md), [document extraction](PHASE9-DOCUMENT-EXTRACTION.md). All are built and disabled until the Phase 8 lineup is approved |
| [OPENROUTER-MEASUREMENTS.md](OPENROUTER-MEASUREMENTS.md), [OPENROUTER-CAMPAIGN.md](OPENROUTER-CAMPAIGN.md) | OpenRouter privacy controls and measurement runbook — built, not the selected provider (ADR-54) |
| [audits/](audits/) | Dated audit reports kept as historical records, such as the 2026-09-24 Phase 8 entry-gate audit and the 2026-11-07 Phase 8 reconciliation and tier-eligibility audits |

## Conventions used in these documents

- **MUST / MUST NOT** — a rule that, if broken, is a correctness or security defect.
- **SHOULD** — strong default; deviation needs a note in `DECISIONS.md`.
- `ADR-nn` — cross-reference into [DECISIONS.md](DECISIONS.md).
- Code identifiers are written as they will appear in the repository.

Status (2026-11-12): **Phases 0–7 are built and verified; Phase 8 has complete current-contract Tier 1 measurements passing numerical schema/tool gates, with injection failures and release review outstanding; Phase 9 is built but disabled.** [ROADMAP.md](ROADMAP.md) "Where the project stands" is the current summary and [PROJECT-STATE.md](../PROJECT-STATE.md) the full record. A design document describes shipped behaviour only where ROADMAP marks that phase complete.
