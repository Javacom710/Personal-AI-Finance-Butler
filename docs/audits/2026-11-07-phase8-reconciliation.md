# Phase 8 reconciliation after the PR merges — 7 November 2026

The previously uncommitted DeepInfra evaluation implementation and evidence were reconciled onto main `44e53ce86aaeb1a4178a25a3efaff0b83866809c` in an isolated worktree, preserving the original checkout. This brings the finite no-record coordinator, bounded output-free diagnostics, current prompt contracts, numeric-presentation scoring correction and independent model/tier eligibility together with the merged disabled Phase 9 features and unactivated OpenRouter infrastructure.

## Evidence and integration boundaries

- All 169 original modified/untracked files were hashed before reconciliation and remain unchanged in the original checkout. All 117 local report files are preserved byte-for-byte. The colliding campaign README is retained as `codex-original-README.md`; main's independent Claude README is retained verbatim as `claude-original-README.md`. The replacement README is an index, not a combined score report.
- Both project histories are retained, including all 61 main headings and all 55 local headings. The main working-protocol and earlier implementation suffix was preserved verbatim. A new top checkpoint identifies the integrated state so historical warnings do not control current work.
- The only source integration adjustment was adding the required tier to the existing OpenRouter test fixture. Four regressions check that full current DeepInfra tier evidence loads while OpenRouter endpoint-level rows and foreign-provider rows cannot certify any tier.
- The old Qwen campaign was checked with a fetch-denied preload and a fake key. It correctly refused with `Campaign source differs; choose a fresh --campaign name.` Reconciliation changes the source fingerprint; historical measurements are not rewritten or presented as measurements of this new source.
- No live provider calls, production database access, `--record`, lineup promotion or feature activation occurred during reconciliation. DeepInfra direct remains selected; Google/Anthropic models remain excluded. OpenRouter remains unactivated.
- Qwen's complete campaign remains historical evidence: 420 attempts, 419 answers, one document timeout, and no qualifying tiers. Known local campaign accounting remains $0.327257180, plus the separately labeled $1 conservative reservation for PR #50's external campaign, totaling $1.327257180 for account-cap purposes. The reservation is not a new charge or a billing statement.

## Verification

Final verification of PR #51's head `b651867`, completed 2026-11-07 by Claude in a cloud session (PostgreSQL 16 locally; CI covers 17 and 18):

| Check | Result |
|---|---|
| Typecheck, lint | pass |
| Unit + property tests, isolated run | **2,476 / 2,476 pass** (99 files). The five timeouts from the earlier concurrent run did not recur |
| Integration tests | **619 / 619 pass** (38 files) with the environment's `AI_*` variables removed, as CI runs. With them present, 2 cases in `ai-daily-budget.test.ts` fail identically on `main`: a test-isolation gap, not a regression (see TESTING.md) |
| Production build | pass |
| Client-secret scan | pass — no secret in 23 client files |
| `verify:integrity` | 35 passed, 0 failed, 28 enforced by the engine |
| GitHub CI, PostgreSQL 17 and 18 | both green on `b651867` |

No live provider call, `--record`, routing change or feature activation was made during verification. No browser interaction or live model quality verification is implied.
