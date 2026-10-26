# Recovery record — October 2026

**Status as of 2026-10-26.** This file is the recovery record and the register of the blockers found on the way to Phase 8. `PROJECT-STATE.md` and `docs/ROADMAP.md` were brought up to date on 2026-10-26 (B-4), so they are current again.

**Phase 7 (AI infrastructure) is complete. Phase 8 (Model Evaluation) has not started and is unblocked.** Every blocker from the [2026-09-24 entry-gate audit](audits/2026-09-24-phase8-entry-gate-audit.md) is closed by a pull request listed below; this file assumes those pull requests are merged.

---

## What happened

Both hard drives that held working copies of this repository have failed.

| Date | Event |
|---|---|
| to 2026-09-09 | Development on `E:` (Disk 0, `ST1000DM010`), the drive whose faults are recorded in PROJECT-STATE's 2026-09-03 and 2026-09-09 entries |
| 2026-09-09 | Repository moved to the SSD at `C:\Dev\AI Enabled Personal Finance`, commit `1515eb1`. Recorded baseline: `npm test` **1,560 / 1,560**, Phase 7 category A |
| 2026-09-16 → 25 | Later sessions worked on a copy of the `E:` repository on `H:` (`H:\E-Drive\…`, then `H:\Claude\…`). That copy **did not contain `1515eb1`**, so those sessions re-solved the job-clock defect independently. Commits `cf91bc6`, `f63d9b0` and `a20b9e2` existed only there |
| 2026-09-25 19:20 IST | Last session (`0589592d`): the B-2 fix, then its [read-only audit](audits/2026-09-25-b2-boundary-audit.md). The full suite was 1,606 / 1,606 at `a20b9e2` |
| after 2026-09-25 | `H:` failed (actuator head). Clean-room recovery was out of budget, so its contents are treated as lost |
| 2026-10-17 | The `H:`-only work was rebuilt from the session transcripts onto `C:\Dev`, and the repository was published to GitHub (`main`) for the first time |

## What the H: commits became

| `H:` commit | Content | Now |
|---|---|---|
| `cf91bc6` | Job-clock fix | **Superseded** by `1515eb1`, which fixed the same defect at the runner (`JobDeps { now }`) on 2026-09-09 and adds regression tests. `cf91bc6`'s version was not carried over |
| `cf91bc6` | ESLint worktree ignore `'.claude/worktrees/**'` | **Not needed.** `'.claude/**'` has been on the line since `c773551` |
| `cf91bc6` | `npm audit fix` lockfile | **Regenerated** as `0abc48d` (next 16.4.2, sharp 0.35.5), not byte-identical to the lost lockfile `e8aaf01` |
| `f63d9b0` | Reconciliation of `cf91bc6` onto `a6d0d20` (B-1) | **Not needed.** `1515eb1` already combines the Phase 7 tip with the job-clock fix |
| `a20b9e2` | B-2: resolved-path AI import boundary | **Rebuilt exactly** as `4eb4e15`: the same four files, replayed from the transcript and rebased onto `1515eb1` |

Every older branch survived on `C:\Dev` and is on GitHub unchanged. The [entry-gate audit](audits/2026-09-24-phase8-entry-gate-audit.md) and the [B-2 audit](audits/2026-09-25-b2-boundary-audit.md) had been written outside the repository; both are now in `docs/audits/`, recovered byte-for-byte.

**Lost and not rebuilt:** the `.env` files on `E:` and `H:`. A copy dated 2026-09-09 survives in `C:\Dev\AIEPF` (see R-1).

**Never at risk:** the local databases. They live in the PostgreSQL 18.4 Windows service on `C:` (decision D-23), which is still running. The portable PostgreSQL 17 on `E:` was only its rollback copy.

## Verified on 2026-10-17

On `0abc48d`, on the Windows PC (Node 26, npm 11.19), and again on Linux under Node 22 with npm 11.19.1, which is the CI configuration:

| Check | Result |
|---|---|
| typecheck | exit 0 |
| lint | exit 0 |
| unit | 1,041 / 1,041: 994 before B-2, plus its tests |
| property | 65 / 65 |
| I-51 boundary suite | 68 / 68 |
| build | exit 0 |
| `check:no-client-secrets` | exit 0: 21 files, 7 values |
| `npm audit --omit=dev --audit-level=high` | exit 0: 0 vulnerabilities |
| integration | **501 / 501 on PostgreSQL 17.10** in the CI configuration, after the test fix below. The changed file also passes 30 / 30 on the PC's PostgreSQL 18.4 |
| `verify:integrity` | **not run.** It needs a database, and CI does not run it (R-2) |
| secret scan of all 32 commits | clean |

## Blocker status

| # | Item | Status |
|---|---|---|
| **B-1** | Stabilization on the authoritative line | ✅ **Resolved**: `1515eb1` plus `0abc48d` |
| **B-2** | Relative-import escape from the AI zone | ✅ **Resolved**: `4eb4e15`. Audit verdict PASS |
| **B-3a** | Daily budget checked before egress | ✅ **Resolved**, PR #10: `ai_usage_daily`, checked before every request ([ADR-43](DECISIONS.md#adr-43--the-daily-ai-budget-is-kept-in-a-table)) |
| **B-3b** | Startup fails loudly on a missing capability entry | ✅ **Resolved**, PR #11: checked in `instrumentation.ts`; the matrix stays `capabilities.ts` ([ADR-44](DECISIONS.md#adr-44--the-capability-matrix-stays-capabilitiests-checked-at-startup)) |
| **B-3c** | Row caps, `truncated`, byte budget tested | ✅ **Resolved**, PR #5: tested; the budget counts UTF-8 bytes; holdings capped; the dispatcher refuses any result over the ceiling |
| **B-3d** | Complete `required` array on every tool schema | ✅ **Resolved**, PR #6: every object schema carries one, asserted across the registry |
| **B-3e** | Catalogue confirmation stale for the Tier 1 primary | ✅ **Resolved by decision**: deferred to Phase 8 ([ADR-45](DECISIONS.md#adr-45--the-tier-1-catalogue-drift-is-deferred-to-phase-8)) |
| **B-4** | ROADMAP ticks and PROJECT-STATE status lines | ✅ **Resolved**, the B-4 PR: every Phase 7 box ticked with its evidence; status lines corrected; D-1 to D-5 closed (D-5's `schema.test.ts` comment in PR #10). D-6, the E: → H: → C:\Dev history, is this file |
| **H-1** | Global capability surface (B-2 audit §7): `globalThis.__financeOsDb`, `globalThis.process.env`, ambient `fetch`, indirect / aliased `eval`; aliased `db` handles | ✅ **Resolved**, PR #8: both boundary mechanisms refuse ambient globals in the AI zone; with no route to a handle, there is nothing to alias |
| **R-1** | Rotate secrets that were on the failed drives | ✅ **Closed 2026-10-26 without rotation.** Both drives came back from the lab unread: recovery was out of budget and never started. Rotation is not needed. Keep the drives secure and destroy them physically before disposal |
| **R-2** | Add `verify:integrity` to CI, using the read-only database role | ✅ **Resolved**, PR #7 |
| **R-3** | **PostgreSQL 17 / 18 divergence.** PostgreSQL 18 reports a RESTRICT foreign-key refusal as SQLSTATE `23001` with its own wording; 17 reports `23503` for RESTRICT and NO ACTION alike. Two integration tests depended on 18's wording; since PR #1 they assert the code and the catalogue's delete rule, which holds on both. Application code is not affected, because it translates no database error (R-4): a constraint that fires is a fault with a correlation id, on both versions | 🟨 **One question open, blocking nothing:** should CI also run PostgreSQL 18, the version on the PC? |
| **R-4** | `src/server/services/_errors.ts` was never wired in (found by the Codex review of PR #2, since closed) | ✅ **Resolved**, PR #12: deleted ([ADR-46](DECISIONS.md#adr-46--database-errors-are-not-translated-the-unwired-translator-is-deleted)) |
| — | New advisory GHSA-mrhx-c7xc-m3w5 (`zod` below 4.6.6, high), published after 2026-10-17 | ✅ **Resolved**, PR #9: `zod` 4.6.7 |

**Line numbers.** The audits cite the `H:` copy. `PROJECT-STATE.md` has since grown by 73 lines, and ROADMAP Phase 7 "Done when" now spans L377–L392, so find each item by its text.

## Order of work

1. ~~Publish to GitHub; CI runs the integration suite.~~ Done 2026-10-17.
2. ~~B-3a to B-3e, H-1, R-3 and R-4.~~ Done 2026-10-26 (R-3's CI question aside).
3. ~~R-2.~~ Done 2026-10-26.
4. ~~B-4.~~ Done 2026-10-26.
5. Full Phase 7 gate on `main` once these pull requests are merged, with and without `NVIDIA_API_KEY`: every test passing with 0 skips, plus every check in the entry contract (entry-gate audit §9). CI covers the run without a key.
6. **Phase 8 — Model Evaluation.** Start by running `npm run ai:catalogue` (ADR-45); the first build dependency is the golden task corpora for the eval harness (`src/server/ai/eval/harness.ts`).

## How work happens now

The repository lives on GitHub. Claude, Codex and ChatGPT all work from it, and the `C:\Dev` clone is a backup mirror, not a working copy.

- **`main` is the only long-lived branch.** Every change reaches it through a pull request whose CI run is green.
- **One task, one branch, one agent.** Name branches `claude/<topic>`, `codex/<topic>` or `chatgpt/<topic>`. Two agents never push to the same branch at the same time.
- **Instructions are already in the repo.** Codex reads `AGENTS.md`, Claude reads `CLAUDE.md`, and both start from `PROJECT-STATE.md`. A pull request that changes project status updates `PROJECT-STATE.md` in the same PR. The PR description says what changed, how it was verified, and what comes next.
- **The package manager is npm 11.** `package.json` declares `packageManager: npm@11.19.1` and CI pins it. Node 22 bundles npm 10, which rejects this lockfile (`Missing: esbuild@0.28.2`), so on such a machine run `npx -y npm@11.19.1 ci`. Never commit a lockfile written by npm 10: it drops the `libc` fields and adds optional-peer entries that npm 11 removes again.
- **Cloud sessions are set up.** `.claude/settings.json` runs `scripts/cloud-session-setup.sh`, so a Claude Code cloud session starts with dependencies, PostgreSQL, both roles and both databases (see `docs/DEPLOYMENT.md` §1).
- **CI is the authority for integration tests.** It runs PostgreSQL 17, the version the schema and production target. The PC runs PostgreSQL 18.4 (D-23), so a test that passes on only one of them is a defect, not a flake (R-3). A hosted database for running the app is a decision for the deployment phase.
- **Secrets never enter git.** When a cloud agent needs `NVIDIA_API_KEY` (Phase 8 evaluation), it goes into that agent's environment settings or a GitHub Actions secret, never into a file.
- **Backups:** every branch on GitHub; the `C:\Dev` mirror; and a periodic `git bundle --all` copied off the machine. `.env` is backed up only offline or in a password manager.
