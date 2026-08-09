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

## Conventions used in these documents

- **MUST / MUST NOT** — a rule that, if broken, is a correctness or security defect.
- **SHOULD** — strong default; deviation needs a note in `DECISIONS.md`.
- `ADR-nn` — cross-reference into [DECISIONS.md](DECISIONS.md).
- Code identifiers are written as they will appear in the repository.

Status: **architecture only — no application code written yet.** Nothing in `docs/` describes shipped behaviour until [ROADMAP.md](ROADMAP.md) marks the relevant phase complete.
