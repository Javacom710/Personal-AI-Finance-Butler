# Incomplete portfolio returns — 12 November 2026

<!-- project-doc-status:start -->
> **Status reviewed 12 November 2026:** OD-21 protected in the engine; OD-22/23 remain open. Phase 8 quality/release review open; live AI disabled. DeepInfra direct is selected.
> **Current references:** [Project state](../../PROJECT-STATE.md) · [Roadmap](../ROADMAP.md) · [Maintained deadline forecast](../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated implementation and verification record.
<!-- project-doc-status:end -->

## Baseline and scope

The restored environment was at `47ab421` (8 November), behind published main
`50b604a` and draft [PR #73](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/73)
at `21108ac`. Verified #73's PostgreSQL 17/18 CI run
[43212886226](https://github.com/Javacom710/Personal-AI-Finance-Butler/actions/runs/43212886226)
succeeded and its discussion had no comments. Continued on
`codex/continue-project-status` from that exact handoff; original branches and
main remain unchanged.

This slice addresses **OD-21**. OD-22 unmatched-transfer XIRR, OD-23 AI TWR
freshness, scenario/metrics tool registration and remaining tier/release work
remain outstanding. They precede the next paid qualification batch. No new
registry tool or database schema is introduced.

## Financial behavior

Previously, priced market value was compared with every holding's cost and
full historical cash flows. One missing price could turn two profitable holdings
into an apparent aggregate loss. UI guards hid the result on some pages, but the
service/AI projection still returned it.

The engine now withholds whole-scope unrealised P&L, total return, their
percentages and XIRR whenever valuation is incomplete. Nullable money stays null;
rate metrics carry `no_price`. Explicit unpriced instruments are checked alongside
cost-weighted coverage so an unpriced zero-cost holding cannot bypass the guard.
This preserves consistent full-portfolio cohorts rather than combining partial
P&L with full deployment denominators, realised history or cash flows.

Known full costs, realised gains, dividends/interest/charges, partial priced market
value and individual holding results remain available. Overview, Investments and
Performance determine whether a priced market value exists from valuation holding
counts, independently of P&L availability. Empty/closed portfolios and fully
priced portfolios retain their arithmetic. Pricing the last holding restores the
aggregate figures. TWR independently retains its historical-price requirements.
[ADR-57](../DECISIONS.md#adr-57--whole-portfolio-returns-require-a-complete-terminal-valuation)
records the choice.

## Evaluation and evidence boundary

Regenerated `grounding-results.json` through the real production handlers and
PostgreSQL fixture. Its portfolio changes only the former phantom unrealised
loss, total return/percentage and XIRR to unavailable values. Other frozen calls
remain unchanged. Grounding/robustness/analysis advance **v5 → v6**. Analysis and
robustness expectations now require the actual missing-price limitation and
reject sourced-looking figures assigned to unavailable returns, including zero.
Exact arithmetic, traceability, shared prompts, thresholds, model orders and
production request budgets remain unchanged. Parse v4, classify v2, tool-select
v3, injection v4 and document v2 are unchanged.

All retained campaign reports, checkpoints, usage ledgers and pinned manifests
remain byte-identical. The existing importer fails closed on their old financial
suite versions; actual archived-report regressions prove they cannot qualify
current Tier 1. CLI subprocess checks deny network and use unusable deployment
configuration, including refusal with the formerly valid pinned digest. Nothing
is relabeled, rescored or recorded.

The existing importer integrity/concurrency/atomicity tests retain a clearly
marked historical-only suite-version sandbox. Those tests check old transport
and database transaction mechanics, not current qualification. Composition
feature tests now use explicitly synthetic current-contract scores, rather than
borrowing a historical campaign to enable fake-response runtime tests. Real
archive refusal is checked separately without that sandbox. Live generation
remains hard-disabled.

## Verification

Three new domain regression cases reproduced the phantom loss before the fix.
Coverage includes partial/rounded coverage, zero-cost missing holdings, empty and
fully sold portfolios, known realised history, real AI projections, scoped reads,
restoring prices, ledger/audit immutability, UI partial-value retention, and
rejection of historical evidence. Final suite totals and CI are appended below.

Typecheck, lint, production build and client-secret scan pass. Integrity reports
**35 passing / 0 failing / 0 warnings**. Eight one-off production Chromium checks
pass with zero page errors: real password/TOTP login, Overview/Investments/
Performance at 1280px and 375px, no horizontal overflow, the known ₹12,000 priced
subtotal with withheld aggregate returns, then ₹24,000 complete value and ₹4,000
total gain plus available XIRR after pricing the final holding. The exact
synthetic development user and its cascading records were removed afterward.
No personal production database or live model was used.

The initial concurrent regression attempt found outdated feature-fixture
qualification and output expectations, now corrected. CPU contention also caused
CLI/Argon2 test timeouts; no production timeout or gate is widened. The final
regression uses one unit worker and avoids overlapping the heavy database suite.
Local checks use PostgreSQL 17; PostgreSQL 18 is verified by the PR CI matrix.

## Forecast and remaining work

Reviewed the maintained forecast at task start/end. F1 stays **18 December 2026
core / 15 January 2027 full scope**, low confidence, **0-day movement**. M2 advances
but is incomplete; this is not a release or a delivery milestone. Accounted
inference stays **US$2.079573720**, leaving **US$7.920426280** of US$10. No paid
request, deployment recording, activation, main merge or automation change occurs.

Next: complete OD-22 and OD-23, register scenario/metrics tools with Tier 2 work,
finish the affected contract migration, then prepare one fresh bounded
qualification campaign and a new reviewed import manifest. Quality acceptance,
recording and activation remain distinct release steps.
