# Tier 1 selection and scorer-contract reconciliation — 7 November 2026

<!-- project-doc-status:start -->
> **Project status reviewed 12 November 2026:** Phases 0–7 complete; Phase 8 quality/release review open; Phase 9 built but live AI disabled. Selected provider: DeepInfra direct.
> **Current references:** [Project state](../../PROJECT-STATE.md) · [Roadmap](../ROADMAP.md) · [Maintained deadline forecast](../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence below retains its original findings and scores; this annotation is a current navigation update.
<!-- project-doc-status:end -->

Claude PR #54 at `cd5e65e` records owner pop-up approval of two scorer corrections and Tier 1 selection **GLM-5.3-Flash → GPT-OSS-120B** on DeepInfra. This isolated integration carries that selection onto the verified #56 handoff without treating its historical measurements as measurements of the merged source. No original branch or main is modified.

## Configuration, scorer versions and evidence

The selected default Tier 1 order is retained and GLM receives a conservative **declared** capability entry, without scores or assumed streaming support. Other tier orders remain empty. The entry/order does not override the measured runtime gates; all live-generation actions remain hard-disabled.

The branches had conflicting suite identities: Claude's grounding/robustness/analysis v3 preceded this branch's v4 prompt/LaTeX contracts, while both called different injection semantics v3. The combined contract is **grounding/robustness/analysis v5 and injection v4**, with parse/classify v2, tool-select v3 and document v2 unchanged. Shared numeric presentation handling retains both LaTeX punctuation and the recorded typeset grouping/hyphen correction. Digits, units, signs and decimal precision are preserved. Wrong figures, wrong metric bindings, unsupported derived figures and extra tool calls remain rejected; thresholds are unchanged. Injection allows only schema-valid `basis`/`dimension` beyond an otherwise exact permitted read; expected arguments, foreign IDs, dates, unknown fields and write calls retain their checks.

Claude's 30 timestamped Markdown/JSON reports and original README are byte-identical to the source commit. The README is separately archived beside the index; it does not replace or combine earlier campaigns. All 158 parent report artifacts remain unchanged. Report provider identities were checked as DeepInfra direct, and no incoming model is Google/Anthropic. The original decision is preserved [verbatim](2026-11-07-claude-tier1-decision-original.md); its branch-local ADR-53 becomes canonical ADR-55 so the existing independent-tier ADR-53 and provider ADR-54 remain intact.

Regression tests load the actual archived GLM report, establish its original tool-call gate pass and zero unanswered cases, then show that it cannot produce a current measured capability under the reconciled versions. The actual GPT-OSS fallback report retains two unanswered Tier 1 cases and is also refused. No report is relabeled, rescored or recorded to manufacture current eligibility.

## Verification

- **2,493 unit/property tests across 100 files pass** with one worker. This includes the recorded typography/injection regressions, unchanged financial-fact rejection cases, previous-version rejection from both branches and the new actual-report qualification checks. An initial focused run caught one stale injection version assertion; it was updated to the new contract before the complete passing run.
- **65 focused integration checks across four files pass on each of PostgreSQL 17 and 18:** stored-evaluation/runtime loading, infrastructure gates, frozen grounding-handler results and the real-engine assistant workload corpus. Fake providers and disposable databases with separate app/migration roles were used; synthetic rows never reach a deployment database.
- Typecheck, full lint, a fresh normal dependency installation/default production build and client-secret scan pass. The lockfile is unchanged.
- Authenticated production HTTP checks pass for all seven disabled AI workflow pages. Signed-out requests redirect to login, signed-in pages return 200, generation controls remain disabled, and health returns 200. This verifies the HTTP release boundary, not browser interaction or real-model quality.
- The coordinator refuses old campaign resume with a fetch-denied preload before updating any report. Archive hashes and both project histories were verified afterward. ADR numbers stay unique and AGENTS.md/CLAUDE.md stay identical.

## Remaining release work

Current complete merged-contract evidence is still required before measured eligibility and deployment recording, including for the selected fallback. The owner-PC Tier 2 plan recorded by Claude must use these reconciled contracts; clearing a few old unanswered cases cannot qualify a different prompt/scorer version. Additional external #54 spending is not reconstructable from score-summary reports and still needs reconciliation before another paid campaign. The existing finite coordinator's Qwen plan remains unchanged and is not a new selected-lineup campaign.

No paid inference, historical rescoring, deployment recording, activation or main merge occurred. [Machine-readable verification](2026-11-07-tier1-contract-reconciliation-verification.json) includes source/artifact hashes and the exact check boundaries.
