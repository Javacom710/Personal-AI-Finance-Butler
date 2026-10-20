#!/bin/bash
# Cloud-session setup for Claude Code (claude.ai/code, `claude --cloud`, the
# Desktop app's Cloud mode, the mobile app).
#
# Runs from the SessionStart hook in .claude/settings.json. It does nothing on
# your own machine: the cloud VM sets CLAUDE_CODE_REMOTE=true, a local session
# never does, so locally the script exits on the first line and your Windows
# PostgreSQL 18 service and your real .env are untouched.
#
# In the cloud it mirrors .github/workflows/ci.yml:
#   1. the project's npm (package.json "packageManager"),
#   2. npm ci, skipped while the lockfile is unchanged,
#   3. a local PostgreSQL with the two roles and two databases CI uses,
#   4. a throwaway .env (git-ignored) with well-formed, VM-only secrets,
#   5. migrations and seed on the dev database, the first time only.
#
# Real API keys (TWELVE_DATA_API_KEY, NVIDIA_API_KEY) never come from here. Both
# are optional; add them as environment variables on the cloud environment at
# claude.ai/code if a session needs them.

if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

set -u
cd "$CLAUDE_PROJECT_DIR" || exit 1
log() { echo "[cloud-setup] $*"; }

# --- 1. npm -----------------------------------------------------------------
want_npm=$(node -p "(require('./package.json').packageManager||'').split('@')[1]||''")
if [ -n "$want_npm" ] && [ "$(npm --version)" != "$want_npm" ]; then
  log "installing npm@$want_npm"
  for _ in 1 2 3; do
    npm install -g "npm@$want_npm" --no-fund --no-audit >/dev/null 2>&1 && break
    sleep 2
  done
  hash -r
  [ "$(npm --version)" = "$want_npm" ] || log "npm@$want_npm install failed; npm ci will likely reject the lockfile"
fi

# --- 2. dependencies ----------------------------------------------------------
hashes=node_modules/.cloud-setup.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  rm -f "$hashes"
  log "npm ci"
  if npm ci --no-fund --no-audit; then
    sha256sum scripts/cloud-session-setup.sh package.json package-lock.json > "$hashes" || rm -f "$hashes"
  else
    log "npm ci failed; ask Claude to run it and read the error"
  fi
fi

# --- 3. PostgreSQL --------------------------------------------------------------
# The VM ships PostgreSQL 16. CI and your machine run 17/18; the schema and the
# whole suite pass on 16 as well. If the environment's network allows
# apt.postgresql.org, set PG_MAJOR=17 on the cloud environment to use 17 instead.
pg_major="${PG_MAJOR:-}"
if [ -n "$pg_major" ] && [ ! -d "/usr/lib/postgresql/$pg_major" ]; then
  log "installing PostgreSQL $pg_major"
  if [ -x /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh ]; then
    (/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null 2>&1 \
      && apt-get install -y -q "postgresql-$pg_major" >/dev/null 2>&1) \
      || log "PostgreSQL $pg_major unavailable on this network; falling back to the bundled version"
  fi
fi
service postgresql start >/dev/null 2>&1
# With more than one cluster installed, use the requested one if it exists.
port=5432
if [ -n "$pg_major" ] && pg_lsclusters -h 2>/dev/null | awk '{print $1}' | grep -qx "$pg_major"; then
  port=$(pg_lsclusters -h | awk -v v="$pg_major" '$1==v {print $3; exit}')
fi
for _ in $(seq 1 20); do pg_isready -q -h 127.0.0.1 -p "$port" && break; sleep 0.5; done

psql_su() { su postgres -c "psql -q -p $port -v ON_ERROR_STOP=1 $*"; }
if ! su postgres -c "psql -p $port -tAc \"SELECT 1 FROM pg_roles WHERE rolname='financeos_migrator'\"" | grep -q 1; then
  log "creating roles and databases"
  psql_su "-d postgres" <<'SQL'
CREATE ROLE financeos_migrator LOGIN PASSWORD 'cloud_migrator';
CREATE ROLE financeos_app      LOGIN PASSWORD 'cloud_app';
CREATE DATABASE financeos      OWNER financeos_migrator;
CREATE DATABASE financeos_test OWNER financeos_migrator;
SQL
  for db in financeos financeos_test; do
    psql_su "-d $db -c 'REVOKE ALL ON SCHEMA public FROM PUBLIC;' -c 'GRANT USAGE ON SCHEMA public TO financeos_app;' -c 'GRANT ALL ON SCHEMA public TO financeos_migrator;'"
  done
fi

# --- 4. .env (git-ignored, VM-only) -------------------------------------------
if [ ! -f .env ]; then
  log "writing a cloud-only .env"
  cat > .env <<EOF
DATABASE_URL=postgres://financeos_app:cloud_app@127.0.0.1:$port/financeos
DATABASE_MIGRATION_URL=postgres://financeos_migrator:cloud_migrator@127.0.0.1:$port/financeos
TEST_DATABASE_URL=postgres://financeos_migrator:cloud_migrator@127.0.0.1:$port/financeos_test
TEST_DATABASE_APP_URL=postgres://financeos_app:cloud_app@127.0.0.1:$port/financeos_test
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
SESSION_COOKIE_SECRET=$(openssl rand -base64 32)
APP_ORIGIN=http://localhost:3000
LOG_LEVEL=error
EOF
  # Keys set on the cloud environment pass through, so features that need them work.
  for k in TWELVE_DATA_API_KEY NVIDIA_API_KEY; do
    [ -n "${!k:-}" ] && echo "$k=${!k}" >> .env
  done
fi

# --- 5. schema ------------------------------------------------------------------
# Migrations are idempotent, so run them every start (new ones arrive with git
# pulls). The seed only fills reference data, once per VM.
if [ -d node_modules ]; then
  if npm run --silent db:migrate >/dev/null 2>&1; then
    if [ ! -f node_modules/.cloud-setup.seeded ]; then
      log "seeding the dev database"
      npm run --silent db:seed >/dev/null 2>&1 && touch node_modules/.cloud-setup.seeded \
        || log "seed failed; ask Claude to run npm run db:seed"
    fi
  else
    log "migrations failed; ask Claude to run npm run db:migrate"
  fi
fi

log "ready (PostgreSQL $(su postgres -c "psql -p $port -tAc 'SHOW server_version'" | cut -d' ' -f1), npm $(npm --version))"
exit 0
