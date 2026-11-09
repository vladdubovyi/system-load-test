# BreakIT — Backend API

ASP.NET Core 8 API for BreakIT: the challenge library and component
definitions, served read-only from memory.

The API is **anonymous and database-free** by design
([docs/specs/interview-platform.md](../docs/specs/interview-platform.md) §2):
no accounts, no tokens, no write endpoints, no persistence of any kind. The
challenge catalog is built from the seed source at startup and held in
memory. Keep it that way — §2.1 of the spec is the checklist, and
`AnonymousMvpTests` fails the build if an account surface or a database
comes back.

## Stack

- .NET 8 / ASP.NET Core
- Swashbuckle (Swagger UI in Development)

## Prerequisites

- .NET 8 SDK. Nothing else: no database, no secrets.

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

Integration tests host the real application in-process with
`WebApplicationFactory`; they need only the SDK.

For the frontend-plus-backend suite, `npm run test:e2e:real` from the repo
root starts this API on a free port and runs `e2e/real-api.spec.ts` with no
request mocking.

## Endpoints

- `GET /api/health`
- `GET /api/challenges`, `/api/challenges/{id}`, `/api/challenges/slug/{slug}`
- `GET /api/components`, `/api/components/{type}` (includes each component's
  semantic `capabilities`)

There is no `PUT`, `POST` or `DELETE`.

## Rooms hub

`/hubs/room` is a SignalR hub (WebSockets) for collaborative rooms
(`docs/specs/interview-platform.md` §3, §5, §7). Everything lives in
process memory: a room has a join code, a hashed host secret, an ordered
board of opaque entities and a version counter. Clients send credentials in
hub invocations (`JoinByCode`, `JoinAsHost`), never in the query string.
Diffs merge last-writer-wins per entity and are broadcast as one ordered
stream of versions.

Limits (`Rooms/RoomLimits.cs`): rooms empty for 30 minutes or idle for 12
hours are deleted; 500 rooms per process; 20 room creations per hour and 20
failed joins per 10 minutes per IP; per-connection caps on diff and cursor
rates and on diff and board size. SignalR logging is at `Warning` and
detailed errors are off, and `RoomHubTests` asserts that no board content,
join code or host secret ever reaches the logs.

Rooms need a single always-on instance. A second instance would need a
backplane, and scaling to zero ends every room.

## Challenge catalog

URL Shortener, File Storage / Dropbox, Instagram Feed, Rate Limiter, plus
the component definitions used by the sandbox. Source:

- `Data/Seed/ChallengeSeeder.cs` — challenges, scenarios, allowed
  components, component definitions.
- `Data/Seed/FlowDefinitions.cs` — flows, objectives and component
  capabilities.
- `Data/ChallengeCatalog.cs` — the in-memory catalog the controllers read.

IDs are derived from slugs and component types (`ChallengeSeeder.StableId`),
so they are identical on every start of every instance.

To change a seeded challenge, edit the seed source and redeploy. Players
edit scenarios on the spot in the sandbox's Scenario editor (**Apply**);
that stays in their browser.

## Configuration

- `CORS_ORIGINS` — comma-separated list of allowed frontend origins (no
  wildcards in production).
- `PORT` — injected by the host; the API binds to it when present.
- `KNOWN_PROXIES` — optional, comma-separated IPs or CIDR ranges of the
  reverse proxy in front of the API. When set, the per-IP room limits key on
  `X-Forwarded-For` from those proxies; unset, every client behind the proxy
  shares one bucket.
