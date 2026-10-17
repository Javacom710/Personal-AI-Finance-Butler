> **Historical record — recovered 2026-10-17.** The closing report of the last session (`0589592d`, 2026-09-25 19:20 IST), a read-only audit of the B-2 fix. It existed only in the session transcript. `a20b9e2` is now `4eb4e15` on `main` (same four files, rebased onto `1515eb1`); `f63d9b0` and `cf91bc6` were never carried over ([RECOVERY-2026-10.md](../RECOVERY-2026-10.md#what-the-h-commits-became)). The MEDIUM findings in §7 are tracked as **H-1**.

# B-2 Independent Adversarial Audit — a20b9e2

## 1. Git verification
- Branch `claude/phase-7-b2-remediation`; HEAD `a20b9e2521e4a425d975133aee68fcbff25d48ca`; parent `f63d9b061cb64f9dc01ec574cc55ea5625881ee2`; worktree clean.
- `claude/phase-7-reconciled` still `f63d9b0`; main checkout still `cf91bc6`. All 12 branch tips as expected (10 original + reconciled + this branch); none moved. No merge/rebase/cherry-pick in progress.

## 2. Changed-file verification
Exactly four paths differ from `f63d9b0`: `ai-import-boundary.mjs` (A), `ai-import-boundary.d.mts` (A), `eslint.config.mjs` (M), `tests/unit/ai-boundary-source-scan.test.ts` (M). No production code, `package.json`, `package-lock.json`, or other tests changed.

## 3. Shared resolver audit
Read line-by-line and exercised with a ~70-case matrix from a scratch copy of the committed tree. It genuinely computes a canonical module key (alias expansion, relative resolution, `.`/`..`/`//` collapse, backslash→slash, per-segment trailing dot/space stripping, lower-casing, extension and `/index` stripping) and then applies an allowlist to that key. **No case classified a forbidden target as ALLOW.** Confirmed denied by resolution regardless of spelling: `../ai-runtime`, `@/lib/./env`, `@/lib//env`, `@/lib/../lib/env`, `@/lib/ENV`, `@/lib/env.`, `..\..\lib\env`, `../ai-read/./internal`, `../ai-read/queries|projections`, `@/server/db/client.json`, traversal above root, absolute/`file://`/drive/UNC paths, and all node builtins with or without the `node:` prefix. Depth-sensitivity is correct (a specifier resolves differently from `ai/` vs `ai/tools/`, matching the real files).

One imprecision, non-exploitable: unlisted extensions (`.json`, `.node`, `.wasm`) aren't stripped, so `@/lib/env.json` classifies ALLOW. It resolves to a non-existent module (the secrets file is `env.ts`), and every forbidden `src/server/**` target stays denied because those branches match by directory prefix. **INFORMATIONAL.**

## 4. Package allowlist audit
Genuine allowlist: `ALLOWED_PACKAGES = ['zod','server-only']`, plus `openai` for `nvidia-build.ts` only. Attack matrix results — all DENY except the intended allows:
- builtins (`node:module`/`module`, `node:fs`/`fs`, `node:child_process`, `node:vm`/`vm`, `worker_threads`, `node:net`), arbitrary packages (`undici`, `axios`), subpath-imports (`#internal`): all `package-not-allowed`.
- `openai` from any non-wire file (including `provider/types.ts` and case-variant `OpenAI`): `wire-client` (deny). `openai`/`openai/foo` from `nvidia-build.ts`: allow. The importer is derived from the real file path, not attacker-controllable.
- Subpaths of allowed packages (`zod/v4`, `server-only/register`) allow via package name — acceptable for these two packages.
`createRequire` cannot be imported (its source, `node:module`, is denied).

## 5. ESLint rule audit
Ran the real rule against 20 exotic forms in a scratch AI-zone file. Every load-bearing form is caught by `ai-boundary/resolved-imports`: `import`, `import type`, `import *`, `export … from`, `export *`, `export type … from`, `import x = require()`, type-position `import()`, dynamic `import('…')` / `import(\`…\`)`, `require('…')`/`require(\`…\`)`, `import(...)` with import-attributes, and the extra-argument `require(a,b)` form. Non-static targets (`import('a'+'b')`, `import(v)`, `require(v)`) → `dynamic` (fail closed). `eval(...)`, `Function(...)`, `new Function(...)` → `codeLoading`.
**Gap:** the code-loading check matches only a direct `eval`/`Function` identifier callee. Indirect/aliased forms (`(0,eval)(…)`, `const e = eval; e(…)`) and aliased `require` are not flagged. In an ESM module (`"type":"module"`) `require` is undefined at runtime, but `eval` is a live global — see §7. **MEDIUM**, and outside the import boundary.

## 6. I-51 scanner audit
Reads module references from the TypeScript AST, so the previous text-based weaknesses are closed: comment markers inside strings don't hide an import; real comments are stripped by parser token positions (not regex); backtick and `\u`/`\x`/`\u{}` escaped specifiers are decoded as the loader would; `import()`, `require()`, `import=require`, and type-position `import()` are all extracted; non-static dynamic arguments become `dynamic-unresolved` (fail closed). The suite runs real ESLint via the `ESLint` class for parity, so the two mechanisms are not merely asserted to agree. One residual: the scanner relies on the file being parseable and does not itself assert zero parse errors — but an unparseable AI file fails `tsc` and ESLint in CI, so it cannot ship. **INFORMATIONAL.**

## 7. Capability-escape audit (beyond imports)
The import boundary is sound, but it is not a runtime sandbox, and there are capability paths from AI-zone **source** that need no import and are caught by none of the three mechanisms. All are **pre-existing** (present identically at `f63d9b0` and earlier) and **outside B-2's scope**, but they bear on "security-complete":
- **`globalThis.__financeOsDb`** — `src/server/db/client.ts:57` caches the live `Database` (a write-capable handle) on `globalThis`. AI-zone code could read it and issue DML with no import; the `.db.<dml>` scan doesn't match a receiver named `__financeOsDb`. This also sidesteps the I-50 type guarantee via an `any` cast. **MEDIUM** (reachable only from committed first-party source, which the CI gate is meant to review; but it defeats the intent of I-50/I-51/I-52).
- **`globalThis.process.env`** — reaches every secret. The global `no-restricted-syntax` rule's selector requires `object.object.name==='process'`, so the `globalThis.process.env` form isn't caught (bare `process.env` is). **MEDIUM.**
- **Ambient `fetch`** and **indirect `eval`** — arbitrary outbound HTTP / code execution, no import. **MEDIUM.**
None of the 15 current AI files use any of these; this is latent surface, not a live defect.

## 8. Database-write boundary audit
`writeFindings` (AST-based) catches `.insert/.update/.delete/.execute/.transaction` when the receiver's member name is `db` — so `ctx.db…`, `foo.db…`, `this.db…`, `obj['db']…`, and update/delete/execute/transaction. It does **not** catch a destructured/aliased handle (`const { db } = ctx; db.insert(…)`, `const d = ctx.db; d.insert(…)`), optional chaining on the receiver, or the `globalThis.__financeOsDb` handle from §7. This check is a **secondary** net: the primary guarantee is that AI-zone code cannot legitimately obtain any `db` handle (import boundary denies `db/client`, `ai-read/internal`, `services/_ctx`; `AiReadCtx` has no `db` field per I-52). Given no legitimate handle exists, the DML-text gaps are **LOW**, except the `globalThis` route counted under §7.

## 9. Additional adversarial cases
Beyond the committed 27, I tested (resolver + real ESLint, in scratch): mixed `./../` and repeated/back separators, extension and `/index` variants, case and trailing-dot/space variants, `\u`/`\u{}`/`\x` escapes, template literals, string concatenation, `import=require`, type-position `import()`, import-attributes, extra-arg `require`, `node:` vs bare builtins, package case variants, and traversal outside the repo. Every forbidden variant was denied by both layers or failed closed. The only misses are the non-import forms in §7 (indirect eval, globals) — no *import* spelling escaped.

## 10. AI-zone import inventory
Enumerated all **15** files and classified every static/dynamic/type reference through the committed resolver: every import resolves to an allowed target (`server-only`, `zod`, within-zone relatives, `../../ai-read` index, `../../../lib/result`). **Zero denied imports; zero relied on a resolver quirk.** No dynamic `import()`, `require()`, `eval`, `process`, `fetch`, or `globalThis` appears in any of the 15 files.

## 11. Test-quality / circularity audit
Expected values are independently specified (hardcoded booleans, keys, and capability labels), not computed by calling the function under test. The ESLint parity tests execute the real `ESLint` engine against the real config, so they are independent of the scanner's logic. No mocks of the dangerous behavior; no `.skip/.only/.todo`. **One inherent caveat:** both mechanisms consume the same `isAllowedFromAiZone`, so the parity tests prove agreement, not correctness — a bug in the shared decision would be invisible to them. Correctness is pinned separately by the hardcoded resolver-decision tests. This is the expected trade-off of single-source-of-truth. **INFORMATIONAL.**

## 12. Claim-by-claim verification
| Claim | Verdict |
|---|---|
| Both mechanisms use the same shared decision | CONFIRMED (both import `./ai-import-boundary.mjs`) |
| All 27 bypasses blocked by both | CONFIRMED (suite 68/68 independently; ESLint parity test real) |
| Unresolved dynamic expressions fail closed | CONFIRMED |
| All six privileged targets denied in all six import forms | CONFIRMED |
| `openai` restricted to `nvidia-build.ts` | CONFIRMED |
| AI zone cannot reach env / db / ai-runtime / ai-read internals — **by import** | CONFIRMED |
| …as an absolute capability guarantee | PARTIALLY CONFIRMED — `globalThis` routes exist (§7), outside the import boundary |
| eval and Function denied | PARTIALLY CONFIRMED — direct calls denied; indirect/aliased eval not caught |
| Production behavior unchanged | CONFIRMED (no `src/` or `app/` change; deps unchanged) |

## 13. Findings by severity
- **BLOCKER:** none.
- **HIGH:** none.
- **MEDIUM (pre-existing, outside B-2 / the import boundary):** AI-zone source can reach the DB write handle via `globalThis.__financeOsDb`, secrets via `globalThis.process.env`, and arbitrary HTTP/code via `fetch`/indirect `eval` — none caught by the import boundary, the scanner, or the global lint rule.
- **LOW:** DML-text check misses destructured/aliased/optional-chained handles (mitigated: no legitimate `db` handle is obtainable in-zone).
- **INFORMATIONAL:** unlisted-extension resolver imprecision (non-exploitable); scanner assumes parseability (CI-covered); shared-decision parity tests prove agreement, not correctness.

## 14. Final verdict

**B-2 AUDIT: PASS**

The B-2 defect — relative/normalized/dynamic import spellings bypassing the AI server-import boundary — is comprehensively and correctly closed. Enforcement is resolved-path, covers every code-loading AST form, fails closed on non-static targets, is driven by one shared decision so the two layers cannot drift, produces zero false positives on the 15 real files, and the full suite (1,606 tests, verified last turn; the I-51 file re-verified independently this turn) is green. No import bypass survived independent adversarial testing.

`a20b9e2` **is suitable as the Phase-7 import-security baseline.** It is not, by itself, a complete runtime capability sandbox: the MEDIUM findings in §7 (`globalThis.__financeOsDb`, `globalThis.process.env`, `fetch`, indirect `eval`) are reachable from AI-zone source without any import. They are pre-existing and were never in B-2's scope, so they do not reopen B-2 — but they should be tracked as a separate Phase-7 hardening item before the AI zone is treated as fully confined, and I'd raise them with you rather than fold them silently into a "security-complete" sign-off.

Recommended single next operation (not executed): open a distinct hardening task for the global-capability surface — narrowing the DB handle's `globalThis` cache and extending the source scan / lint to `globalThis.<db-handle>`, `globalThis.process.env`, and indirect `eval`/`Function` — separate from the B-2 commit and reviewed on its own.

Read-only audit complete. Stopping here; no changes made.