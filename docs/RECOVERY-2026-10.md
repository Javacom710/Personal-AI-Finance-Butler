# Recovery record — October 2026

**Status as of 2026-10-17.** Where this file and the status lines in `PROJECT-STATE.md` or `docs/ROADMAP.md` disagree, this file is current until blocker B-4 brings those lines up to date.

**Phase 7 (AI infrastructure) is implemented. Phase 8 (Model Evaluation) has not started.** It is blocked by B-3 and B-4 of the [2026-09-24 entry-gate audit](audits/2026-09-24-phase8-entry-gate-audit.md).

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

**Lost and not rebuilt:** the `.env` files on `E:` and `H:` (see R-1).

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
| **B-2** | Relative-import escape from the AI zone | ✅ **Resolved**: `4eb4e15`. Audit verdict PASS. The ROADMAP L379 tick is now true |
| **B-3a** | Daily budget checked before egress | ⬜ Open. Needs a storage decision: in-memory like the rate limiter, or a table |
| **B-3b** | Startup fails loudly on a missing capability entry | ⬜ Open. Decide `capabilities.json` vs `capabilities.ts` first. ADR-41 rules out reading the provider catalogue at boot; a local check of the tier lists against the capability matrix is not affected |
| **B-3c** | Row caps, `truncated`, byte budget tested | ⬜ Open. Also, `withinByteBudget` counts UTF-16 units, not bytes |
| **B-3d** | Complete `required` array on every tool schema | ⬜ Open |
| **B-3e** | Catalogue confirmation stale for the Tier 1 primary | ⬜ Open. Needs a recorded decision; ADR-41 already defers the replacement to Phase 8 |
| **B-4** | ROADMAP ticks and PROJECT-STATE status lines | ⬜ Open. Includes D-1 to D-5 of the entry-gate audit. D-6, the E: → H: → C:\Dev history, is this file |
| **H-1** | Global capability surface (B-2 audit §7, MEDIUM): `globalThis.__financeOsDb` (`src/server/db/client.ts:57`), `globalThis.process.env` (missed by the lint selector), ambient `fetch`, indirect / aliased `eval`. LOW: the DML scan misses aliased `db` handles | ⬜ Open. Not part of the Phase 8 gate, but should be closed before the AI zone is called confined |
| **R-1** | Rotate secrets: `.env` files were on both failed drives, and `H:` is with a repair lab. Replace `NVIDIA_API_KEY`. Generate a new `APP_ENCRYPTION_KEY` and `SESSION_COOKIE_SECRET`; nothing needs re-encrypting because the database is gone | ⬜ Open, user action |
| **R-2** | Add `verify:integrity` to CI, using the read-only database role | ⬜ Open |
| **R-3** | **PostgreSQL 17 / 18 divergence.** PostgreSQL 18 reports a RESTRICT foreign-key refusal as SQLSTATE `23001`, not `23503`. `toDomainError` (`src/server/services/_errors.ts`) maps only `23503`, so on 18 such a delete becomes an unhandled fault instead of a `conflict`. Two integration tests also matched 18's wording; they now assert the code and the catalogue's delete rule, which holds on both versions. Remaining: map `23001` with a test, and decide whether CI should also run on 18 | ⬜ Open |

**Line numbers.** The audits cite the `H:` copy. `PROJECT-STATE.md` has since grown by 73 lines, and ROADMAP Phase 7 "Done when" now spans L377–L392, so find each item by its text.

## Order of work

1. ~~Publish to GitHub; CI runs the integration suite.~~ Done 2026-10-17.
2. B-3a to B-3e, H-1 and R-3. These are independent of each other, so take one branch each.
3. R-2, so the Phase 8 entry contract can be checked in CI.
4. B-4: tick each ROADMAP box whose evidence now exists, correct the status lines, and close D-1 to D-5.
5. Full Phase 7 gate on the final commit, with and without `NVIDIA_API_KEY`: at least 1,606 tests, 0 skips, plus every check in the entry contract (entry-gate audit §9).
6. **Phase 8 — Model Evaluation.** The first dependency is the golden task corpora for the eval harness (`src/server/ai/eval/harness.ts`).

R-1 can happen at any time and should happen soon.

## How work happens now

The repository lives on GitHub. Claude, Codex and ChatGPT all work from it, and the `C:\Dev` clone is a backup mirror, not a working copy.

- **`main` is the only long-lived branch.** Every change reaches it through a pull request whose CI run is green.
- **One task, one branch, one agent.** Name branches `claude/<topic>`, `codex/<topic>` or `chatgpt/<topic>`. Two agents never push to the same branch at the same time.
- **Instructions are already in the repo.** Codex reads `AGENTS.md`, Claude reads `CLAUDE.md`, and both start from `PROJECT-STATE.md`. A pull request that changes project status updates `PROJECT-STATE.md` in the same PR. The PR description says what changed, how it was verified, and what comes next.
- **The package manager is npm 11.** `package.json` declares `packageManager: npm@11.19.1` and CI pins it. Node 22 bundles npm 10, which rejects this lockfile (`Missing: esbuild@0.28.2`), so on such a machine run `npx -y npm@11.19.1 ci`. Never commit a lockfile written by npm 10: it drops the `libc` fields and adds optional-peer entries that npm 11 removes again.
- **CI is the authority for integration tests.** It runs PostgreSQL 17, the version the schema and production target. The PC runs PostgreSQL 18.4 (D-23), so a test that passes on only one of them is a defect, not a flake (R-3). A hosted database for running the app is a decision for the deployment phase.
- **Secrets never enter git.** When a cloud agent needs `NVIDIA_API_KEY` (Phase 8 evaluation), it goes into that agent's environment settings or a GitHub Actions secret, never into a file.
- **Backups:** every branch on GitHub; the `C:\Dev` mirror; and a periodic `git bundle --all` copied off the machine. `.env` is backed up only offline or in a password manager.
