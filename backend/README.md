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

## Main endpoints

- `GET /api/health`
- `GET /api/challenges`, `/api/challenges/{id}`, `/api/challenges/slug/{slug}`
- `GET /api/components`, `/api/components/{type}`
- Auth under `/api/auth/*`

## Seeded challenges

URL Shortener, File Storage / Dropbox, Instagram Feed, Rate Limiter — plus component definitions used by the sandbox.

## CORS

Set `CORS_ORIGINS` to a comma-separated list of allowed frontend origins (no wildcards in production).
