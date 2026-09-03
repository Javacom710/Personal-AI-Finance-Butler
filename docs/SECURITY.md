# Security & Privacy

This application holds a complete picture of one person's finances. The threat model is: a remote attacker on the public internet, a compromised browser extension, a leaked credential, a lost backup, and a prompt-injection payload arriving inside the user's own data.

## 0. Authentication ≠ Authorization

These are two different questions, answered in two different layers, and conflating them is how access-control bugs happen.

| | Authentication | Authorization |
|---|---|---|
| Question | **Who are you?** | **Are you allowed to do this, to this thing?** |
| Answered by | Argon2id password + TOTP → an opaque session token | Per-use-case permission checks on every referenced entity |
| Layer | Presentation — `requireSession()` at every entry point | Application services — `_guards.ts`, inside the use case |
| Result | A `userId`, or a redirect to login | Proceed, or a typed `forbidden` error |
| Frequency | Once per request | Once per **entity touched** by the request |
| Covered in | §1 below | §2 below |

**A valid session is not permission to do anything.** Passing `requireSession()` proves only that a request belongs to a known user. It does not establish that the account in the request body belongs to them, that the account is active, that the category kind matches the transaction kind, or that the instrument is one of theirs. Those are authorization questions, and they are asked inside the application service ([ADR-21](DECISIONS.md#adr-21--application-services-are-a-distinct-layer-from-the-financial-engine)) — one place, on the only path in.

This matters more than it would in a typical single-user application for two reasons:

- **The AI's tools enter through the same application services.** Authorization is therefore enforced on the AI path by construction, not by remembering to add a parallel check. If authorization lived in server actions, the AI tool path would silently skip it.
- **Single-user today is not single-user forever.** Every query already filters on the session `userId`, and every guard already takes the entity as an argument. Nothing here assumes there is one user — it just happens to be true today. That is the difference between not building multi-tenancy and building something that would have to be unpicked to allow it.

Neither question is ever answered by a model ([AI-SYSTEM.md §15](AI-SYSTEM.md#15-security-boundary)).

## 1. Authentication

[ADR-10](DECISIONS.md#adr-10--database-backed-opaque-sessions-not-a-jwt-or-an-oauth-framework). Password + mandatory TOTP, database-backed opaque sessions.

**What is not hand-rolled:** no custom cryptography, no custom hashing, no JWT signing, no OAuth. Standard primitives only.

### Password

- Hash: **Argon2id** via `@node-rs/argon2`. Parameters: `memoryCost = 65536` (64 MiB), `timeCost = 3`, `parallelism = 4`, 32-byte salt, 32-byte output. Tuned so a hash takes ≥ 250 ms on the production host; recorded in code with a comment stating the measured time.
- Minimum length 12, no composition rules, checked against a compromised-password list at set time. Length beats character classes.
- Verification is constant-time by construction (argon2 verify). A login attempt for a non-existent user performs a dummy hash so response time does not leak account existence.
- Change requires the current password and revokes all other sessions.

### Second factor

- TOTP (RFC 6238), SHA-1, 6 digits, 30-second step, ±1 step drift window.
- Secret encrypted at rest with AES-256-GCM using `APP_ENCRYPTION_KEY` (32 bytes, from the environment, never in the database).
- 10 single-use recovery codes, stored as Argon2id hashes, shown once.
- A used TOTP code is rejected for its remaining window (replay guard keyed on `user_id + code_window`).
- **Mandatory.** There is no "skip 2FA" path. A single-user finance app with a password-only login is one credential-stuffing hit from total compromise.

### Lockout

- 5 consecutive failures → 15-minute lock (`users.locked_until`), doubling to a 4-hour cap.
- Every attempt writes an `auth_events` row with IP and user agent. Settings → Security shows recent attempts.
- Lockout is per-account, and a separate per-IP rate limit applies to the login endpoint regardless of account.

### Sessions

- Token: 32 bytes from `crypto.randomBytes`, base64url-encoded, sent to the client. Only `SHA-256(token)` is stored. **A database read cannot mint a session.**
- Lookup uses `crypto.timingSafeEqual` on the hash.
- Cookie: `HttpOnly; Secure; SameSite=Lax; Path=/`, `__Host-` prefix, no `Domain` attribute.
- Absolute lifetime 30 days; idle timeout 7 days (`last_seen_at`); both enforced server-side, not by cookie expiry.
- Rotated on privilege change (password change, TOTP enable/disable).
- Settings → Security lists active sessions with IP, user agent, and last seen, with individual and "revoke all others" actions. Revocation is immediate because the check is a database read.
- Logout deletes the row. There is no denylist to maintain, because there is no stateless token.

## 2. Authorisation

Authorization lives in `src/server/services/**` — one layer, one place ([ADR-21](DECISIONS.md#adr-21--application-services-are-a-distinct-layer-from-the-financial-engine)). See §0 for why this is a separate question from authentication.

- Every query filters on `user_id` taken from the **session**. No query anywhere accepts a user ID from a request parameter, a form field, a URL, or an AI tool input.
- `requireSession()` (authentication) runs in the app-segment layout and in every route handler and server action. It is not optional and not inherited implicitly — each entry point calls it.
- `_guards.ts` (authorization) runs inside each application service, once per entity the use case touches: `requireOwnership(ctx, accountId)`, `requireActiveAccount`, `requireCategoryKind`, `requireInstrumentOwnership`. A use case that references three accounts performs three checks.
- Both the UI and the AI tools reach these guards through the same service functions, so there is no second path to keep in sync.
- Permission checks live in deterministic application code, never in a prompt ([CLAUDE.md §16](../CLAUDE.md)).
- Postgres role used by the application has `SELECT/INSERT/UPDATE/DELETE` on data tables and only `INSERT/SELECT` on `audit_log`. Migrations run as a separate, higher-privileged role that the application process does not hold.

## 3. Secrets

| Secret | Where | Never |
|---|---|---|
| `DATABASE_URL` | environment | in the repo, in a client bundle, in a log line |
| `NVIDIA_API_KEY` (`nvapi-…`) | environment, read only inside `src/server/ai/provider/nvidia-build.ts` | in `NEXT_PUBLIC_*`, in the browser, in an error message |
| `AI_TIER*_MODELS` | environment ([ADR-17](DECISIONS.md#adr-17--model-identifiers-are-configuration-not-code)) | hard-coded at a call site |
| Market-data API keys | environment, read only inside `src/server/market-data/providers/` | in the browser |
| `APP_ENCRYPTION_KEY` | environment (32 random bytes, base64) | in the database, in a backup that also holds ciphertext |
| `SESSION_COOKIE_SECRET` | environment | anywhere else |

Enforcement:

- Every module touching a secret starts with `import 'server-only'`, so importing it from a client component is a build error rather than a runtime leak.
- No variable is prefixed `NEXT_PUBLIC_` unless it is genuinely public. A CI check fails the build if `NEXT_PUBLIC_` and a name containing `KEY|SECRET|TOKEN|PASSWORD|DSN` co-occur.
- `.env*` is git-ignored; `.env.example` documents every variable with a placeholder.
- A startup validator parses the environment with Zod and refuses to boot on a missing or malformed secret, rather than failing later with a confusing error.
- Secret rotation procedure is documented in [DEPLOYMENT.md](DEPLOYMENT.md). Rotating `APP_ENCRYPTION_KEY` requires re-encrypting TOTP secrets — there is a command for it.

## 4. Transport and headers

- HTTPS only in production, TLS terminated by Caddy with automatic certificates.
- HSTS: `max-age=63072000; includeSubDomains; preload`.
- Content-Security-Policy — strict, nonce-based, no `unsafe-inline` for scripts:
  ```
  default-src 'self';
  script-src 'self' 'nonce-<per-request>';
  style-src 'self' 'nonce-<per-request>';
  img-src 'self' data:;
  font-src 'self';
  connect-src 'self';
  frame-ancestors 'none';
  form-action 'self';
  base-uri 'none';
  object-src 'none'
  ```
  `connect-src 'self'` matters: the browser never talks to NVIDIA Build or a market-data provider directly, so a CSP that forbids it is both correct and a guard against accidental client-side calls. If a future change ever needs a browser→provider call, the CSP breaks first — which is the desired failure order.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` denying camera, microphone, geolocation, payment, USB.
- `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`.
- Cookies as described in §1.

## 5. Input validation

- Zod at every boundary ([ADR-16](DECISIONS.md#adr-16--zod-as-the-single-validation-boundary-including-for-ai-schemas)): server actions, route handlers, AI tool inputs, AI structured outputs, imported files, environment variables.
- Parameterised queries throughout (Drizzle). Raw SQL, where used for aggregates, uses bound parameters — string interpolation into SQL is a review-blocking defect.
- Monetary input is parsed by `Money.parseUserInput`, which rejects anything that is not a well-formed decimal, and never falls back to `parseFloat`.
- File import (CSV/JSON) is size-capped, streamed, row-capped, and validated per row; a bad row is reported, not skipped silently.
- Output encoding is React's default escaping. `dangerouslySetInnerHTML` is not used anywhere; a lint rule forbids it.

## 6. Rate limiting

Application-level, backed by Postgres (no Redis — [CLAUDE.md §17](../CLAUDE.md)):

| Endpoint | Limit |
|---|---|
| Login | 10 / 15 min per IP, 5 / 15 min per account |
| TOTP verify | 5 / 15 min per session attempt |
| Password change | 5 / hour |
| AI chat | 30 / hour, plus the daily token budget |
| Market-data manual refresh | 10 / hour |
| Data export | 5 / day |
| Everything else authenticated | 300 / min per session |

Exceeding a limit returns `429` with `Retry-After`. Limits are also enforced at the reverse proxy as a coarse backstop.

## 7. Logging

- **Never logged:** account balances, transaction amounts, holdings, net worth, passwords, TOTP secrets or codes, session tokens, API keys, full AI message content.
- **Logged:** timestamp, correlation ID, route, status, duration, user ID, error class and message, and for AI requests: task, tier, model, fallback depth, token counts, cost, finish reason, failure class, tool names, row counts.
- Errors reaching the browser show a correlation ID only. Stack traces are server-side.
- `ai_messages.content` stores conversation content in the database because the product needs it; that is a deliberate, documented storage decision, distinct from application logs. It is covered by export and by delete.
- Log retention: 30 days. `auth_events` and `audit_log` are retained longer (see §10) because they are security records.

## 8. AI-specific security

Covered in detail in [AI-SYSTEM.md §15](AI-SYSTEM.md#15-security-boundary). The security-relevant summary:

- **The kill switch is real.** `settings.ai_enabled` is read by `src/server/ai-runtime.ts` before any request is constructed, and **fails closed** — a settings row that cannot be read disables AI rather than defaulting to on. `ai_enabled = false` produces **zero egress**: not a request attempted and discarded, but one never built (**I-58**). Until Phase 7 this column had no reader anywhere while this document twice named it as the mitigation.
- **AI requests are rate limited per user**, in-process, fixed-window (`AI_RATE_LIMIT_PER_MINUTE`, default 10). A refusal is typed and no provider call is made. A single-user application needs no shared store, and `CLAUDE.md` rules one out.
- **`NVIDIA_API_KEY` is read in exactly one file** — `src/server/ai-runtime.ts` — and passed into the provider. `src/server/ai/**` cannot import `@/lib/env` at all, so the AI layer holds a configured client and never a credential it could place in a prompt. The key appears only in an `Authorization` header, never in a request body, an error, or a log (**I-55**).
- **AI infrastructure is strictly read-only** ([ADR-35](DECISIONS.md#adr-35--ai-infrastructure-is-strictly-read-only-a-mutation-needs-a-separate-approved-proposal-workflow)). No write tool exists, and none can be written: the AI layer holds an `AiReadCtx` with no database handle and no transaction capability, so `withWriteCtx(ai, …)`, `ai.db` and `createTransaction(ai, …)` are each a **compile error** (**I-50**). The model's maximum impact is a proposal the user must confirm, and even that row is persisted by an application service rather than by AI code. **Any future AI-assisted mutation requires a separate, explicitly approved proposal/confirmation workflow** and is outside Phase 7 and Phase 8.
- **The AI zone's import surface is an allowlist**: `@/server/ai-read`, `@/server/log` and `@/lib/**` except `@/lib/env` — nothing else under `src/server/`, `app/`, or the environment ([ADR-38](DECISIONS.md#adr-38--the-ai-zone-is-an-allowlist-a-new-directory-is-closed-on-the-day-it-is-created), **I-51**, **I-52**). A directory added tomorrow is closed by default. The adversarial review of 2026-08-30 attacked the previous denylist with fourteen probes and found **seven open routes**, two of them complete defeats of the write boundary: a `'use server'` action takes a *form*, not a context, and builds a `WriteCtx` internally, so importing one mutates the ledger with the session's own authority and no capability ever passes through AI code; `@/server/jobs` does the same one indirection further away. Enforced by any import style — aliased, relative, or dynamic.
- **Credentials are outside the AI layer's reach.** `@/lib/env` — which returns `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `SESSION_COOKIE_SECRET` and every provider key — is banned from the zone, as is `@/server/auth/**` (sessions, password verification, and decryption of TOTP secrets and recovery codes). Tier lists reach `config/` by being **passed in**, never read (`AI-SYSTEM.md` §12). Three mechanisms enforce this, because none alone is sufficient: the capability types, the ESLint AI zone, and a source scan. The scan exists specifically because `no-restricted-imports` registers no `ImportExpression` listener, so `await import('@/server/db/client')` is invisible to it ([ADR-34](DECISIONS.md#adr-34--the-ai-import-boundary-is-enforced-three-ways-and-covers-relative-paths)).
- **Exact figures cross the provider boundary as tagged digit strings**, never as JSON numbers, so no precision is lost on the way to a model and no figure returns as a float ([ADR-36](DECISIONS.md#adr-36--exact-values-cross-a-json-boundary-as-a-tagged-string-projection-never-as-a-json-number), **I-53**). Projection is explicit per tool and per field; a blind serializer would ship whatever a service happened to return, including entity ids and `notes`.
- **`userId` comes from the session**, never from tool input. No tool accepts a user identifier — asserted by test.
- **Tool results are data, not instructions**, and the system prompt says so; instructions found inside user data are to be reported, not obeyed.
- **No execution capability**: no code execution, no shell, no filesystem, no network tool, no MCP server.
- **Minimum necessary data** is sent to the provider — aggregates before records, projected fields, row and byte caps (`CLAUDE.md <ai_data_access>`). With no prompt caching on NVIDIA Build, minimisation is a cost control as well as a privacy control, so the two incentives point the same way.
- **Model selection cannot be influenced by content.** Tier and capability requirements are computed by application code from the task type, never inferred from user text or tool output — so injection cannot escalate a request to a more permissive path.
- Prompt injection cannot escalate privilege because there is no privilege to escalate to: every capability the model has is a read the user could perform themselves.

**Re-verified 2026-09-03**, against the code rather than against this document. Every claim above still holds: `verify:integrity` reports I-50 … I-58 passing (33 passed, 0 failed); the boundary source scan, write-boundary and read-capability probes pass; 114 deterministic AI tests pass across provider, routing and tools; and `check:no-client-secrets` found no secret in 21 client files after a real production build, checking 7 secret values across `.next/static`. No write path, raw-SQL path, server-action path, job-runner path, env-secret path or auth-secret path is reachable from `src/server/ai/**`, and cross-user isolation is swept across every tool with two users' real data.

One nuance worth stating precisely, because it is a property of the *matrix* rather than of the catalogue: the effective allowlist at request time is `config/capabilities.ts`, not the provider's catalogue. An operator who points `AI_TIER2_MODELS` at an identifier with no capability entry gets a clean fail-closed refusal (`no_capable_model`) on the first request — never a blind call — but the process still **boots without complaint**, so the misconfiguration surfaces on use rather than at startup. That is safe, and it is not self-announcing.

### Egress inventory — what leaves for NVIDIA Build

Documented because `CLAUDE.md <security_privacy>` requires it.

| Sent | Not sent |
|---|---|
| System prompt and tool schemas (static) | Credentials of any kind |
| The user's message | Database rows verbatim |
| Tool results: financial figures, category and account **names**, descriptions, dates — within row/field/byte caps | Account numbers, IFSC/routing details, `notes` unless a tool's contract includes them |
| Uploaded receipt/statement images (Tier 4 only, at the user's action) | Any data belonging to a request the user did not initiate |

Egress is zero when `settings.ai_enabled = false`, and every other feature continues to work.

## 9. Data export, backup, and deletion

### Export
`Settings → Data → Export` produces a single archive containing every user-owned row: accounts, transactions and entries, categories, tags, budgets, recurring rules and occurrences, instruments, investment transactions, derived lots and positions, manual assets and valuations, liabilities and balances, net-worth snapshots, AI conversations and proposals, settings, and the audit log. JSON (complete, round-trippable) plus CSV per table (spreadsheet-friendly). Amounts are exported as exact decimal strings, never as JSON numbers.

The export is generated server-side, streamed, and rate-limited. It is not emailed and not stored.

### Backup
Nightly `pg_dump --format=custom`, compressed, encrypted with **age** to a key the user holds, uploaded to off-site object storage. Details, retention, and the restore drill in [DEPLOYMENT.md](DEPLOYMENT.md). The controls that matter here:

- Backups are encrypted **before** leaving the host. Storage credentials do not grant access to plaintext.
- The encryption key is not stored on the application host beyond the public half — the private key lives with the user.
- A monthly `backup.verify` job restores the most recent backup into a scratch database and runs the integrity checks. **An untested backup is not a backup.**

### Deletion
`Settings → Data → Delete everything` requires password + TOTP re-authentication and typing a confirmation phrase. It executes `DELETE FROM users WHERE id = $1`, which cascades to every user-owned table. Then it purges AI conversation content, revokes all sessions, and writes a final terminal entry to an operational log outside the user tables. Backups are listed with their retention dates so the user knows when the last copy expires; on request, backups are deleted immediately.

## 10. Auditability

- `audit_log` records every mutation: actor (`user` | `system` | `ai_confirmed`), action, entity type and ID, full before/after, correlation ID.
- Append-only at the database-grant level; retention handled by an explicit maintenance job.
- Every AI-originated record links to its `ai_proposals` row, so "why does this transaction exist" is always answerable.
- `auth_events` retains 1 year.
- `npm run verify:integrity` runs the invariants in [SCHEMA.md §12](SCHEMA.md#12-invariants-summary) against live data and is part of the post-restore drill.

## 11. Dependency and supply chain

- `npm audit` in CI; a high or critical advisory fails the build.
- Lockfile committed; `npm ci` in every build.
- New runtime dependencies require a justification line in the PR ([ARCHITECTURE.md §3](ARCHITECTURE.md#3-technical-stack)).
- No analytics, no telemetry, no error-reporting SaaS, no fonts or scripts from a CDN. The CSP would block them anyway; the point is that nothing tries.
- Docker images pinned by digest, rebuilt on base-image security updates.

## 12. Known accepted risks

Recorded rather than hidden.

| Risk | Mitigation | Residual |
|---|---|---|
| Financial content is sent to NVIDIA Build for AI features | Data minimisation, aggregates first, field projection, row/byte caps, documented egress inventory (§8), AI fully disableable | Accepted — inherent to the feature. `ai_enabled = false` removes it entirely and the rest of the app is unaffected. |
| Open-weight models vary in structured-output and tool-calling reliability; an unreliable model could mis-parse a transaction | Measured capability matrix gates routing ([ADR-18](DECISIONS.md#adr-18--a-measured-capability-matrix-gates-routing-and-fallback)); Tier 1 requires ≥0.95 schema adherence; every proposal is user-confirmed before it writes | Accepted — the confirmation step means a parse error is a visible wrong draft, not a wrong record |
| A compromised host exposes the database | Disk encryption, no inbound access except 443, no shared credentials, encrypted off-site backups | Accepted for a single-user self-hosted deployment |
| Market-data providers learn which instruments are queried | Server-side only; no user identifier sent; batched queries | Accepted |
| TOTP secrets are recoverable if both the database and `APP_ENCRYPTION_KEY` leak | Key lives only in the environment, never in the database or in the same backup | Accepted |
| Browser extension with page access can read rendered figures | Strict CSP, no third-party scripts | Not fully mitigable client-side |
| Session cookie theft via a physical device compromise | Idle timeout, session list with revoke, TOTP on re-auth for sensitive actions | Accepted |

