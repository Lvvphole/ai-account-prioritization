#!/usr/bin/env bash
#
# Applies every migration to an empty PostgreSQL database and asserts the
# invariants the schema is supposed to enforce.
#
# The point is that these are behavioural claims, not structural ones. A
# migration can create the right tables and still let a batch skip approval, an
# unauthenticated connection forge an approval, or a manager resolve a hard
# block. Only running the SQL proves otherwise, so this is a gate rather than a
# thing somebody remembers to do.
#
# Usage:
#   scripts/verify-migrations.sh                 # start a throwaway server
#   DATABASE_URL=postgres://… scripts/verify-migrations.sh
#
# Exits non-zero on the first refused assertion.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
TESTS="$ROOT/supabase/tests"

fail() { echo "FAILED: $*" >&2; exit 1; }

# ------------------------------------------------------------- connection --
# An externally supplied DATABASE_URL is used as-is. Otherwise a temporary
# cluster is started and removed on exit, so the script needs no setup and
# leaves nothing behind.

CLEANUP=""
trap 'if [ -n "$CLEANUP" ]; then eval "$CLEANUP"; fi' EXIT

if [ -n "${DATABASE_URL:-}" ]; then
  PSQL=(psql "$DATABASE_URL")
else
  PGBIN=""
  for candidate in /usr/lib/postgresql/*/bin "$(pg_config --bindir 2>/dev/null || true)"; do
    if [ -x "$candidate/initdb" ]; then PGBIN="$candidate"; break; fi
  done
  [ -n "$PGBIN" ] || fail "no PostgreSQL server found; install postgresql or set DATABASE_URL"

  PGDATA="$(mktemp -d)"
  PGSOCK="$(mktemp -d)"
  PGPORT="${PGPORT:-54329}"

  # initdb refuses to run as root, so drop to the postgres account when we are.
  RUNAS=""
  if [ "$(id -u)" = "0" ]; then
    id postgres >/dev/null 2>&1 || fail "running as root but no postgres user exists"
    chown postgres "$PGDATA" "$PGSOCK"
    RUNAS="postgres"
  fi

  run() {
    if [ -n "$RUNAS" ]; then su "$RUNAS" -c "$1"; else bash -c "$1"; fi
  }

  echo "==> Starting a throwaway PostgreSQL cluster on port $PGPORT"
  # -U pins the database superuser name regardless of which OS account runs
  # initdb. Without it the superuser is named after the invoking user, which
  # differs between a root container (postgres) and a CI runner (runner).
  run "$PGBIN/initdb -D $PGDATA -A trust -U postgres" >/dev/null 2>&1 \
    || fail "initdb failed"
  run "$PGBIN/pg_ctl -D $PGDATA -o '-k $PGSOCK -p $PGPORT' -l $PGDATA/log start" >/dev/null \
    || fail "could not start PostgreSQL"

  CLEANUP="run \"$PGBIN/pg_ctl -D $PGDATA stop -m immediate\" >/dev/null 2>&1 || true; rm -rf '$PGDATA' '$PGSOCK'"

  for _ in $(seq 1 20); do
    if psql -h "$PGSOCK" -p "$PGPORT" -U postgres -c 'select 1' >/dev/null 2>&1; then break; fi
    sleep 0.5
  done

  PSQL=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres)
fi

psql_run() { "${PSQL[@]}" -v ON_ERROR_STOP=1 -q "$@"; }

# ------------------------------------------------------------- migrations --

echo "==> Applying migrations"
psql_run -f "$TESTS/00_supabase_auth_stub.sql" >/dev/null \
  || fail "could not create the auth schema stub"

applied=0
for migration in "$MIGRATIONS"/*.sql; do
  # NOTICEs about "does not exist, skipping" are normal for idempotent DDL and
  # are only surfaced when the migration actually fails.
  if ! err="$(psql_run -f "$migration" 2>&1)"; then
    echo "$err" | sed 's/^/    /' >&2
    fail "migration $(basename "$migration")"
  fi
  applied=$((applied + 1))
done
echo "    $applied migrations applied to an empty database"

# ------------------------------------------------------------ assertions --
#
# Order matters: each file builds on the fixtures the previous one created,
# which keeps the setup honest rather than re-seeding a convenient world for
# every check.

total=0
for suite in "$TESTS"/0[1-9]_*.sql "$TESTS"/[1-9][0-9]_*.sql; do
  [ -e "$suite" ] || continue
  name="$(basename "$suite" .sql)"
  output="$("${PSQL[@]}" -q -f "$suite" 2>&1)" || {
    echo "$output" | sed 's/^/    /' >&2
    fail "$name"
  }
  if echo "$output" | grep -qE "FAIL|ERROR"; then
    echo "$output" | grep -E "FAIL|ERROR" | sed 's/^/    /' >&2
    fail "$name"
  fi
  passed="$(echo "$output" | grep -cE "PASS" || true)"
  echo "    $name: $passed assertions passed"
  total=$((total + passed))
done

echo "PASSED: $total schema assertions across $applied migrations."
