#!/usr/bin/env bash
#
# Build and test the ASP.NET API.
#
#   npm run test:backend
#
# Integration tests host the real application against throwaway PostgreSQL
# databases (one per test class, dropped afterwards). A server must be
# reachable; override it with TEST_POSTGRES, e.g.
#   TEST_POSTGRES="Host=db;Port=5432;Database=postgres;Username=postgres;Password=secret"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v dotnet >/dev/null 2>&1 && [ -x "$HOME/.dotnet/dotnet" ]; then
  export PATH="$HOME/.dotnet:$PATH"
fi
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

if ! command -v dotnet >/dev/null 2>&1; then
  echo "dotnet SDK not found. Install .NET 8 (https://dot.net) or add it to PATH." >&2
  exit 1
fi

exec dotnet test "$ROOT/backend/SystemDesignSimulator.Api.Tests" "$@"
