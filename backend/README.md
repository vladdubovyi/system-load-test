# BreakIT — Backend API

ASP.NET Core 8 API for BreakIT: challenges, component definitions, and auth.

## Stack

- .NET 8 / ASP.NET Core
- Entity Framework Core 8 + PostgreSQL (Npgsql)

## Prerequisites

- .NET 8 SDK
- PostgreSQL 16

## Database

```bash
sudo -u postgres psql -c "CREATE DATABASE systemdesignsim;"
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';"
```

Connection string defaults live in `SystemDesignSimulator.Api/appsettings.json` (local placeholders only). In production, set `ConnectionStrings__DefaultConnection`, `JWT_SECRET`, and `CORS_ORIGINS` via the host — never commit secrets.

## Run

```bash
cd backend/SystemDesignSimulator.Api
dotnet run
```

Swagger: check the console for the listening URL (often `http://localhost:5063` or `http://localhost:5000`).

## Tests

```bash
npm run test:backend          # from the repo root
# or: dotnet test backend/SystemDesignSimulator.Api.Tests
```

Integration tests host the real application against a throwaway PostgreSQL
database per test class (created and dropped automatically), so they need a
reachable server — the same `postgres/postgres` default as above. Point them
elsewhere with `TEST_POSTGRES`:

```bash
TEST_POSTGRES="Host=db;Port=5432;Database=postgres;Username=postgres;Password=secret" npm run test:backend
```

They never touch the `systemdesignsim` development database; `IsolationTests`
fails the run if that ever regresses.

For the frontend-plus-backend suite, `npm run test:e2e:real` from the repo
root starts this API on a free port against its own database and runs
`e2e/real-api.spec.ts` with no request mocking.

## Main endpoints

- `GET /api/health`
- `GET /api/challenges`, `/api/challenges/{id}`, `/api/challenges/slug/{slug}`
- `GET /api/components`, `/api/components/{type}` (includes each component's
  semantic `capabilities`)
- `PUT /api/challenges/slug/{slug}/scenario-config` — challenge authoring
  (flows, objectives, tags, requestTypes). Requires a signed-in user whose
  email is listed in `CHALLENGE_AUTHORS`; **unset means nobody can author**.
- Auth under `/api/auth/*`

## Seeded challenges

URL Shortener, File Storage / Dropbox, Instagram Feed, Rate Limiter — plus component definitions used by the sandbox.

## Challenge authoring

Set `CHALLENGE_AUTHORS` to a comma-separated list of emails allowed to edit
challenge scenarios through the sandbox's Scenario editor. Leaving it unset
closes the endpoint to everyone, which is the default.

## CORS

Set `CORS_ORIGINS` to a comma-separated list of allowed frontend origins (no wildcards in production).
