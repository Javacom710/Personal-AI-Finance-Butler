# Latest Claude handoff and project reconciliation — 12 November 2026

<!-- project-doc-status:start -->
> **Status reviewed 12 November 2026:** Phase 8 quality/release review open; Phase 9 live AI disabled; Overview, Scenarios, metrics and TWR built; Phase 10 partial. OD-21/22/23 remain open. DeepInfra direct is selected.
> **Current references:** [Project state](../../PROJECT-STATE.md) · [Roadmap](../ROADMAP.md) · [Maintained deadline forecast](../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Current continuation audit; local verification distinguished from CI.
<!-- project-doc-status:end -->

## Sources and last completed work

Checked the published repository before continuing. `main` is
`50b604a87c8d0f4bbe3b67b96cd03ec41c78b77e`, including merged
[PR #70](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/70).
Claude's latest published commit is
`259fa9107d6e13185e2f715fd1b6c229f5207d3b` on
`claude/cool-volta-3mclpv`, [PR #69](https://github.com/Javacom710/Personal-AI-Finance-Butler/pull/69),
at 04:42 UTC / 10:12 IST on 12 November. It records **OD-23: the AI portfolio
tool reports TWR without its freshness**. That finding is recorded, not fixed.
No literal “Fable” identifier was found in the branch metadata; this is the
latest verified Claude-authored work.

Seven published Claude commits follow the portion already consolidated on main:

| Commit | Change |
|---|---|
| `dab5d5f` | Phone-width scroll and Settings badge fixes |
| `b648ce3` | TWR freshness disclosure, first-boundary fee accounting, incomplete-cash ratio withholding |
| `25079c3` | In-kind transfer legs treated as TWR capital flows |
| `b18eeed` | Transfer legs valued at market rather than carried cost |
| `23e324d` | Same-day split/bonus restatement before transfer pricing |
| `a371ddf` | Future-dated rows excluded before pricing; stale transfer valuations counted |
| `259fa91` | OD-23 recorded for the coordinated tool/evaluation change |

## Continued implementation

Merged the latest Claude history into `codex/claude-fable-latest-handoff` from
current main. Resolved the Performance-page overlap by preserving main's
all-holdings-priced guard and adding Claude's stale-TWR explanation only when
returns can be displayed. A hidden return cannot carry an explanation that
suggests a usable displayed result. Price indicators retain their positioned
wrapper; both main's partial-price safeguards and Claude's phone fix survive.
Two rendering regressions exercise historical/current staleness with complete
and incomplete pricing; pre-existing mocks now supply the actual TWR detail shape.

The deterministic engine/UI work is built: Overview, Scenarios, Money health
metrics and TWR. Phase 10 is partial. **OD-21 consistent return cohorts, OD-22
unmatched-transfer XIRR and OD-23 AI TWR freshness remain open.** Follow the
owner's 11 November OD-18 timing: register the scenario/metrics tools with Tier 2
work and coordinate affected contracts before the next paid measurement. The
assistant must not activate with OD-23 outstanding. No prompt, scorer, frozen
financial result, AI registry, deployment evaluation, model order, budget cap or
live-generation hold is changed by this reconciliation.

## Verification

- **2,705 unit/property tests** pass across 112 files (200.99 seconds).
- **706 PostgreSQL 17 integration tests** pass across 44 files (645.42 seconds),
  including TWR, metrics/scenarios and unchanged grounding fixtures.
- Typecheck, lint, production build (32 routes), client-secret scan (24 client
  files) and integrity (**35 passing, 0 failing, 0 warnings**) pass.
- **20 production Chromium checks pass**, with no page errors: real password/TOTP login, seven routes at 1280px and 375px without horizontal overflow, missing-FX warnings, historical stale-TWR disclosure, real scenario GET submission, invalid-input handling and partial-price return withholding on Overview/Investments/Performance. The 375px Performance screenshot was visually checked. These are one-off browser checks, not a new committed automation suite.
- Source PR #69 is green on PostgreSQL 17/18. The new combined branch has its own
  CI matrix; source checks are not claimed as combined-head CI.
- Offline, fetch-denied current-v4 evidence preview reproduces all twelve rows
  and digest `0b576c87529b09d01ac1411a5fb9974359f0f7787fa265155d5f62c27d591e9b`.

Local checks use disposable synthetic records and the test database. No personal
production data, live AI provider or paid inference is needed. Development schema
and seed were brought up to date before the 35/0 integrity verification.

## Evidence and accounting reconciliation

Retained the independent Nov-12 parse-v2 campaign and fifteen diagnostic probes
from `7037372ca82afbd46d19f395c733b29a056bb182` (PR #72), without porting its
older diagnostic/runtime implementation over newer main. The dated report bodies
remain historical; reproduction of that implementation uses its pinned commit.
These older-contract measurements do not supersede current parse-v4 evidence.
All sixteen previously absent machine-readable campaign/probe artifacts are
preserved byte-for-byte, alongside two historical Markdown report bodies. The shared diagnostics usage ledger preserves main's
eighteen-event prefix and appends the other branch's fifteen real events once.

Combined development inference accounting is **US$2.079573720**, with
**US$7.920426280 remaining** under the unchanged US$10 cap. The increase from
main's US$2.005912455 is the historical independent campaign/probe accounting,
not new requests. No new provider billing-page reconciliation is asserted.

All project Markdown receives current-status navigation, with substantive
corrections to current state, decisions, roadmap and forecast. Historical score
and finding bodies are preserved. The [inventory](../DOCUMENTATION-STATUS.md)
defines the preservation boundary. The [forecast](../../PROJECT-DEADLINE-FORECAST.md)
retains F1 **18 December 2026 core / 15 January 2027 full scope**, low confidence;
actuals and the no-change review are appended. Both instruction files require
maintenance at material task/PR boundaries. No deployment, activation or Claude
scheduling change occurs.

## Final preservation checks

All **119 Markdown files / 357 status-navigation links** and instruction-file
equality pass. Stripping only the status wrapper reproduces **86 historical
report/audit bodies** from their respective source commits. **204 existing
machine-readable evidence files** match main byte-for-byte; sixteen retained
JSON files match `7037372`. The diagnostics ledger has 33 events with no repeated
append. Claude's two service files and two affected integration-test files match
`259fa91` exactly; existing AI/runtime/config/suite/fixture files match main.
The [verification record](2026-11-12-claude-latest-handoff-verification.json)
contains the one-off browser outcomes and aggregate checks, without credentials.
