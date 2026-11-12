# Numeric presentation correction — 7 November 2026

<!-- project-doc-status:start -->
> **Project status reviewed 12 November 2026:** Phases 0–7 complete; Phase 8 quality/release review open; Phase 9 built but live AI disabled. Selected provider: DeepInfra direct.
> **Current references:** [Project state](../../../../PROJECT-STATE.md) · [Roadmap](../../../../docs/ROADMAP.md) · [Maintained deadline forecast](../../../../PROJECT-DEADLINE-FORECAST.md).
> **Document role:** Dated evidence below retains its original findings and scores; this annotation is a current navigation update.
<!-- project-doc-status:end -->

Fixed a deterministic scorer defect: a supported answer passed in plain text but failed when LaTeX represented a thousands comma as `{,}` or a percentage sign as `\%`. The parser split the monetary amount into unrelated fragments or treated the percentage as money.

`normalizeNumericPresentation()` now renders only those two numeric punctuation forms. It does not change digits, signs, decimal precision, units, words, financial arithmetic or tool calls. Grounding traceability, required/forbidden figures, contradiction checks and analysis metric bindings use the same rendered positions. Wrong amounts, swapped metrics, wrong signs, invented totals, unsupported metrics and unnecessary tool calls remain rejected.

Grounding, robustness and analysis are now **version 3**. Parse, classify, tool-selection and injection remain version 2; document remains version 1. The capability loader refuses version 2 evidence for the three changed suites. Original reports/checkpoints were preserved without rescoring; their source-bound checkpoints cannot resume against current code.

## Live audit and limits

Before applying the scorer correction, three new analysis-only probes used the unchanged production requests and version 2 scorer. All three answered, failed the scorer, and contained **neither** of the two detected LaTeX forms. The formatting defect therefore does **not** explain those live failures, and there is no model-quality improvement claim. The original 610-case results remain historical evidence under their original scorer.

The [audit metadata](2026-11-07T06-18-35-469Z.json) contains no raw response text. Total diagnostic accounting, including earlier probes and unknown-usage reservations, reached **$0.013382434**; this audit added $0.000768057. No additional document requests, new models, Google/Anthropic calls, provider switch, retries, recording or promotion occurred.

## Fresh campaigns and account accounting

The measurement runner now accepts `--campaign <name>`, keeping fresh checkpoints/reports separate from the completed original campaign. It reads the same authenticated DeepInfra catalogue and retains source, provider, profile, case, suite-version and budget validation. An invalid or traversal-style campaign name is refused. It never imports old scores automatically.

All DeepInfra campaign, diagnostic and serial-start usage ledgers count toward a shared **$4.50 accounting ceiling**, including unknown-usage reservations. Measurements and diagnostics use one account lock. Ledger reads occur under that lock before spending; foreign or invalid ledgers fail closed. Diagnostic spending also retains its $0.25 cap. This spending aggregation never combines model quality measurements.

```sh
# Offline preparation/status of the fresh v3 campaign; no provider call.
AI_API_KEY="$AI_API_KEY_DeepInfra" npm run ai:measure:deepinfra -- --status --campaign format-v3

# A future fresh full measurement, without recording or promotion.
AI_API_KEY="$AI_API_KEY_DeepInfra" npm run ai:measure:deepinfra -- --run --no-record --campaign format-v3

# A bounded, separate diagnostic run with only the three analysis cases.
AI_API_KEY="$AI_API_KEY_DeepInfra" npm run ai:diagnose:deepinfra -- --run --no-record --analysis-only
```

Do not alter fingerprints or rewrite historical checkpoint versions to force a resume. Production selection, model quality and tier-specific eligibility remain unresolved; fresh current-version full-tier evidence and owner approval are required before promotion.

## Verification

All **2,058 unit tests**, typecheck, lint, production build, client-secret scan and whitespace checks pass. Nineteen presentation regressions cover valid forms and false-positive guards; capability tests reject each changed suite's v2 evidence. CLI tests execute two isolated full fake-provider campaigns, reject unsafe campaign names, enforce cross-campaign/account spend limits, and preserve another process's account lock.

The [fresh v3 campaign](../../deepinfra-2026-11-07-format-v3/README.md) was prepared offline with zero model requests. All 34 original measurement artifact hashes remain unchanged, and an attempted original-checkpoint status read correctly refuses stale source provenance. [Verification metadata](numeric-presentation-verification.json).
