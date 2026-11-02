#!/usr/bin/env bash
#
# Run the live-backend Playwright suite (e2e/real-api.spec.ts) against a real
# ASP.NET API and a throwaway PostgreSQL database.
#
#   npm run test:e2e:real
#
# The database is created fresh, migrated and seeded by the API itself, then
# dropped on exit — the developer's own `systemdesignsim` database is never
# touched. Override the server with TEST_POSTGRES / PGHOST etc.
#
# Do NOT run this at the same time as `npm run test:e2e`: both drive a Vite
# dev server on E2E_PORT, and only this one points it at the live API, so a
# concurrent run makes both suites fail. Set E2E_PORT to separate them.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT/backend/SystemDesignSimulator.Api"

# Pick a port nothing else holds: other dev servers on this machine have been
# known to squat on the obvious ones, and a stray HTML server would otherwise
# look "ready" to the check below.
pick_free_port() {
  python3 - <<'PYPORT'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PYPORT
}
API_PORT="${E2E_API_PORT:-$(pick_free_port)}"
API_URL="http://127.0.0.1:${API_PORT}"
FRONTEND_PORT="${E2E_PORT:-4273}"
DB_NAME="breakit_e2e_$(date +%s)_$$"
AUTHOR_EMAIL="${E2E_AUTHOR_EMAIL:-author@example.com}"

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

# The SDK is not always on PATH (e.g. a user-local install).
if ! command -v dotnet >/dev/null 2>&1 && [ -x "$HOME/.dotnet/dotnet" ]; then
  export PATH="$HOME/.dotnet:$PATH"
fi
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

API_PID=""

cleanup() {
  local status=$?
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -q \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" \
    >/dev/null 2>&1 || true
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -q \
    -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";" >/dev/null 2>&1 || true
  exit $status
}
trap cleanup EXIT INT TERM

echo "==> Creating database ${DB_NAME}"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -q -c "CREATE DATABASE \"${DB_NAME}\";"

echo "==> Building API"
dotnet build "$API_DIR" --nologo -v quiet

# --no-launch-profile: launchSettings.json pins applicationUrl to :5000 and
# would otherwise override ASPNETCORE_URLS.
echo "==> Starting API on ${API_URL}"
(
  cd "$API_DIR"
  ASPNETCORE_URLS="$API_URL" \
  ASPNETCORE_ENVIRONMENT=Development \
  ConnectionStrings__DefaultConnection="Host=${PGHOST};Port=${PGPORT};Database=${DB_NAME};Username=${PGUSER};Password=${PGPASSWORD}" \
  JWT_SECRET="e2e-real-api-secret-key-at-least-32-chars" \
  CHALLENGE_AUTHORS="$AUTHOR_EMAIL" \
  CORS_ORIGINS="http://localhost:${FRONTEND_PORT}" \
  dotnet run --no-build --no-launch-profile --project "$API_DIR" --urls "$API_URL"
) &
API_PID=$!

# Ready means "our API answered with the seeded challenges as JSON" — not
# merely "something accepted a connection on that port".
api_is_ours() {
  curl -fsS -H 'Accept: application/json' "${API_URL}/api/challenges" 2>/dev/null \
    | grep -q '"slug":"url-shortener"'
}

echo "==> Waiting for the API to become ready"
for _ in $(seq 1 90); do
  if api_is_ours; then
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "API exited before becoming ready" >&2
    exit 1
  fi
  sleep 1
done

if ! api_is_ours; then
  echo "API did not serve the seeded challenges at ${API_URL}." >&2
  echo "Response was:" >&2
  curl -sS -i "${API_URL}/api/challenges" 2>&1 | head -5 >&2
  exit 1
fi
echo "==> API is serving $(curl -fsS "${API_URL}/api/challenges" | grep -o '"slug"' | wc -l) challenges"

echo "==> Running the live-backend Playwright suite"
# Exported rather than prefixed: a line continuation followed by a comment
# silently drops the assignments, and the suite then skips itself.
export E2E_REAL_API_URL="$API_URL"
export E2E_AUTHOR_EMAIL="$AUTHOR_EMAIL"
export E2E_PORT="$FRONTEND_PORT"

# One worker: these tests share a single backend database, and the authoring
# test mutates a challenge while it runs.
set +e
npx playwright test e2e/real-api.spec.ts --workers=1 "$@" | tee /tmp/breakit-real-api-run.log
run_status=${PIPESTATUS[0]}
set -e

# A suite that skipped everything is not a pass: it means the tests never saw
# E2E_REAL_API_URL and nothing about the backend was actually verified.
if grep -qE "^\s+[0-9]+ skipped" /tmp/breakit-real-api-run.log \
   && ! grep -qE "^\s+[0-9]+ passed" /tmp/breakit-real-api-run.log; then
  echo "All live-backend tests skipped — E2E_REAL_API_URL did not reach Playwright." >&2
  exit 1
fi

exit "$run_status"
