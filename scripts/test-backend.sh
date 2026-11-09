#!/usr/bin/env bash
#
# Build and test the ASP.NET API.
#
#   npm run test:backend
#
# The API is database-free (docs/specs/interview-platform.md §2.3): the tests
# host the real application in-process and need nothing but the .NET SDK.
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
