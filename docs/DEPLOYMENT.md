# Deployment & Operations

## 1. Environments

| Environment | Purpose | Database | AI |
|---|---|---|---|
| `local` | Development on Windows | **Postgres 18.4 as the `postgresql-x64-18` Windows service** (decision **D-23**) | Real key, low daily budget |
| `test` | CI and integration tests | Ephemeral Postgres container, per-run | Mocked; no network |
| `production` | The user's domain | Postgres on the same host | Real API key, real budget |

There is deliberately no staging environment. For a single-user application it would be a third copy of production data to secure and back up, for a rehearsal that a golden-scenario suite already covers.

## 2. Local development setup

### Prerequisites (current machine state)

| Requirement | Status | Action |
|---|---|---|
| Node.js ≥ 20 | ✅ v26.3.0 | none |
| npm | ✅ 11.16.0 | none |
| git | ✅ 2.55.0 | **`git init` — the project directory is not yet a repository** |
| PostgreSQL | ✅ **18.4**, `postgresql-x64-18` service, `Automatic` | none |
| Docker Desktop | ❌ not installed | **not required** — see D-4 below |
| `NVIDIA_API_KEY` | ❌ not set | decision **OD-1** — blocks Phase 7 onward |
| NVIDIA Build reachable | ✅ `HTTP 200`, 0.67 s | none |
| `ANTHROPIC_BASE_URL` | ⚠️ set in this shell | Claude Code's own config — the application must **not** read it |

### D-4: local database — settled

Docker was never installed. The project ran on a **portable PostgreSQL 17** for Phases 2 and 3 (**D-9**), and now runs on **PostgreSQL 18.4 installed as the `postgresql-x64-18` Windows service** (**D-23**), which is what the machine has today:

| | |
|---|---|
| Install | `C:\Program Files\PostgreSQL\18` |
| Data | `C:\Program Files\PostgreSQL\18\data` |
| Service | `postgresql-x64-18`, `Automatic`, `NT AUTHORITY\NetworkService` |
| Port | 5432 |
| Databases | `financeos`, `financeos_test` |

Because there is no Docker, integration tests use a dedicated `financeos_test` database — truncated between test files — rather than `testcontainers`. Nothing in the repository starts or stops the database: it is a service, and it starts with Windows.

The reason a service was chosen over a hand-started instance is worth keeping: a postmaster launched from a terminal belongs to that terminal's process group and is killed when it closes. That happened repeatedly during Phase 3 and presented as intermittent test failures.

### First run

```bash
git init
npm install
cp .env.example .env.local          # then fill in the values
docker compose -f docker-compose.dev.yml up -d
npm run db:migrate
npm run db:seed                     # currencies + default categories, idempotent
npm run dev
```

### Environment variables

```
DATABASE_URL=postgres://financeos:...@localhost:5432/financeos_dev
APP_ENCRYPTION_KEY=<32 random bytes, base64>      # openssl rand -base64 32
SESSION_COOKIE_SECRET=<32 random bytes, base64>
APP_URL=http://localhost:3000
NODE_ENV=development

# --- AI provider (NVIDIA Build) -------------------------------------------
AI_PROVIDER=nvidia-build
AI_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_API_KEY=nvapi-...
AI_ENABLED=true

# Tier candidate lists, in fallback order (ADR-17).
# Verify against the authenticated catalogue before setting: npm run ai:catalogue
AI_TIER1_MODELS=nvidia/nemotron-3-nano-30b-a3b,openai/gpt-oss-20b,google/gemma-4-31b-it
AI_TIER2_MODELS=nvidia/nemotron-3-super-120b-a12b,z-ai/glm-5.2
AI_TIER3_MODELS=nvidia/nemotron-3-ultra-550b-a55b
AI_TIER4_MODELS=nvidia/nemotron-nano-12b-v2-vl,nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
AI_TIER5_MODELS=                                  # empty — embeddings deferred (ADR-19)

# --- Market data -----------------------------------------------------------
# Added per provider as adapters are built. AMFI and manual need no key.
```

> `ANTHROPIC_BASE_URL` is present in the developer's shell for Claude Code itself. It is **not** application configuration and must not be read by this application.

`src/lib/env.ts` parses all of the above with Zod at startup and refuses to boot on anything missing or malformed. A tier list naming a model absent from `capabilities.json` is a startup failure, not a runtime surprise.

## 3. Production topology ([ADR-13](DECISIONS.md#adr-13--self-hosted-deployment-on-a-single-vps-data-under-user-control))

```
                    Internet
                       │  :443 only
                 ┌─────▼──────┐
                 │   Caddy    │  automatic TLS, HSTS, security headers,
                 │            │  coarse rate limiting
                 └─────┬──────┘
                       │ :3000 (loopback)
                 ┌─────▼──────┐        ┌──────────────┐
                 │  Next.js   │───────▶│ PostgreSQL 17│
                 │ standalone │  :5432 │  (loopback)  │
                 │ + job      │        └──────┬───────┘
                 │   runner   │               │
                 └─────┬──────┘        ┌──────▼───────┐
                       │               │  pg_dump →   │
                       │ outbound      │  age encrypt │
                       ▼ 443           │  → off-site  │
        integrate.api.nvidia.com       └──────────────┘
              market-data providers
```

**Host.** 2 vCPU / 4 GB RAM / 40 GB SSD is generous for this workload (~$6–12/month). Debian stable or Ubuntu LTS.

**Host hardening.**
- Firewall: inbound 443 and SSH only; SSH on a non-default port, key-only, root login disabled.
- Automatic security updates enabled.
- Full-disk encryption at provision time.
- Postgres bound to `127.0.0.1` — never exposed to the network.
- The application container runs as a non-root user with a read-only root filesystem.
- `fail2ban` on SSH.

**Deploy.** `docker compose up -d --build` from a checked-out tag, or a build-and-push pipeline. Steps: build → run migrations → health check → switch. Next.js `output: 'standalone'` keeps the image small.

**Migrations** run as a separate, higher-privileged database role in a one-shot container **before** the new application version starts. The application role cannot run DDL ([SECURITY.md §2](SECURITY.md#2-authorisation)).

### Alternative: Vercel + managed Postgres

Application code is unchanged. Trade-offs, for the record:

| | Self-hosted VPS | Vercel + Neon/Supabase |
|---|---|---|
| Ops burden | Patching, monitoring, backups | Near zero |
| Data custody | Entirely the user's | Two additional third parties hold the full dataset |
| "Delete everything" | `DROP DATABASE` + backup purge | A deletion request plus provider retention windows |
| Background jobs | In-process runner, transactional | Needs Vercel Cron or an external trigger |
| Cost | ~$6–12/month, flat | Free tier likely sufficient, then usage-based |
| Cold starts | None | Present on the free tier |

Recommendation stands with the VPS for a dataset of this sensitivity — taken as decision **D-5** (see [DECISIONS.md](DECISIONS.md#decisions-taken-independently-in-phase-1)).

## 4. Backup and restore

### Backup

Nightly, on the host:

```
pg_dump --format=custom --no-owner financeos
  | age --recipient <user's age public key>
  > financeos-$(date -u +%Y%m%dT%H%M%SZ).dump.age
```

Uploaded to off-site object storage (any S3-compatible provider). **Encrypted before it leaves the host** — the storage credential grants access to ciphertext only, and the private key lives with the user, not on the server.

Retention: 7 daily, 4 weekly, 12 monthly. A `backup.status` record is written after each run; the Settings → Data page shows the last successful backup age and turns it into a visible warning past 48 hours.

### Restore drill — monthly, automated

The `backup.verify` job:
1. Downloads the most recent backup.
2. Decrypts and restores it into a scratch database.
3. Runs `npm run verify:integrity` (the invariants in [SCHEMA.md §12](SCHEMA.md#12-invariants-summary)).
4. Compares row counts and the latest net-worth snapshot against production.
5. Drops the scratch database and records the result.

A failed verification raises an alert. **An untested backup is not a backup** — this drill is the reason the backup section exists at all.

### Manual restore

```bash
age --decrypt --identity key.txt < financeos-<ts>.dump.age > restore.dump
createdb financeos_restore
pg_restore --dbname=financeos_restore --no-owner restore.dump
npm run verify:integrity -- --database-url=postgres://.../financeos_restore
# then switch DATABASE_URL and restart
```

Documented recovery objectives: **RPO 24 hours** (nightly backup), **RTO 1 hour** (provision + restore + verify). Both are stated so the user can decide whether to tighten them (continuous archiving via WAL shipping would take RPO to minutes at some added complexity).

## 5. Background jobs

One in-process runner ([ADR-14](DECISIONS.md#adr-14--background-work-via-a-postgres-job-table-not-a-queue-service)), polling `jobs` with `FOR UPDATE SKIP LOCKED`.

| Job | Schedule | Notes |
|---|---|---|
| `recurring.post` | daily 00:15 local | Idempotent via `UNIQUE (rule_id, due_on)` |
| `prices.refresh` | hourly during market hours, else daily | Batched per provider; failures degrade to stale, never break a page |
| `fx.refresh` | daily | Populates `fx_rates` |
| `networth.snapshot` | **not scheduled — Phase 6, if built at all** | Net worth is **derived on demand**; nothing is stored ([ADR-24](DECISIONS.md#adr-24--net-worth-is-derived-on-demand-snapshots-are-deferred-to-phase-6)). If Phase 6 introduces it on measurement, it runs daily 00:30 local, after recurring posting and price refresh |
| `backup.verify` | monthly | §4 |
| `audit.retention` | weekly | Trims logs past their retention window |

Failed jobs retry with exponential backoff up to `max_attempts`, then land in `failed` and surface in Settings → System. Jobs are safe across restarts because their state is in the table, not in memory.

## 6. Monitoring

Minimal and self-hosted — no third-party telemetry ([SECURITY.md §11](SECURITY.md#11-dependency-and-supply-chain)).

- `/api/health` returns database connectivity, pending job count, oldest pending job age, last successful backup age, and last snapshot date. Not authenticated, but returns booleans and ages only — no financial data.
- An uptime check against `/api/health` from outside the host.
- Settings → System surfaces: failed jobs, stale prices, last backup, AI spend today, integrity-check status.
- Container logs to the host journal with rotation; 30-day retention ([SECURITY.md §7](SECURITY.md#7-logging)).

## 7. Runbook

| Situation | Action |
|---|---|
| Site down | `docker compose ps`; check Caddy and app logs; `docker compose restart app` |
| Database won't start | Check disk space first — it is the usual cause. Then Postgres logs. Restore from backup if corrupted. |
| Migration failed mid-deploy | The previous version is still running (migrations run before the switch). Fix forward; never edit an applied migration. |
| Prices all stale | Check provider status and the `jobs` table for failures; `ManualProvider` remains available so the app is still usable |
| AI unavailable | Check `ai_usage_daily` against the budget, then `ai_model_attempts` for the failure class per model (an open circuit breaker looks like an outage), then NVIDIA Build status. The rest of the app is unaffected by design. |
| One model degrading | `ai_model_attempts` grouped by model and outcome shows it before users do. Reorder the tier list in the environment and restart — no code change ([ADR-17](DECISIONS.md#adr-17--model-identifiers-are-configuration-not-code)). |
| Suspected data corruption | `npm run verify:integrity`; if invariants fail, `npm run rebuild:positions`; if still failing, restore from the last verified backup |
| Suspected compromise | Revoke all sessions, rotate `NVIDIA_API_KEY`, `APP_ENCRYPTION_KEY`, `SESSION_COOKIE_SECRET`, and the database password; force a password change; review `auth_events` and `audit_log` |
| Certificate expiry | Caddy renews automatically; if it fails, check port 80 reachability for the ACME challenge |

## 8. Secret rotation

| Secret | Frequency | Procedure |
|---|---|---|
| `NVIDIA_API_KEY` | on suspicion | Create a new key in NVIDIA Build, update the environment, restart, revoke the old key |
| Market-data keys | on suspicion | Same |
| `SESSION_COOKIE_SECRET` | on suspicion | Update and restart; all sessions invalidate |
| `APP_ENCRYPTION_KEY` | on suspicion | `npm run rotate:encryption-key` re-encrypts TOTP secrets under the new key inside one transaction; **take a backup first** |
| Database password | annually | Update the role, update `DATABASE_URL`, restart |
| Backup `age` key | on suspicion | Generate a new pair, re-encrypt current backups, retire the old key once the retention window on old backups has passed |

## 9. Pre-launch checklist

- [ ] `git init`, `.gitignore` covers `.env*`, `node_modules`, `.next`
- [ ] All secrets generated fresh for production — no development value reused
- [ ] TLS live, HSTS present, headers verified externally
- [ ] Postgres not reachable from the network
- [ ] Migrations applied; `verify:integrity` passes on a seeded database
- [ ] Backup runs, uploads, **and a restore has been verified end to end**
- [ ] TOTP enrolled; recovery codes stored somewhere other than this application
- [ ] AI daily budget set to a deliberate figure
- [ ] Health check reachable from outside; uptime monitor configured
- [ ] Export downloads and parses
- [ ] `npm audit` clean at high and critical
