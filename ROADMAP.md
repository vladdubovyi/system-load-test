# BreakIT roadmap

Work planned for the next stretch of development (well over 20 hours of real product work).

## Proper frontend ↔ backend communication

- Make the Vite app rely on the ASP.NET API for challenges, components, and auth end-to-end (no silent stale fallbacks in normal flows).
- Align types, error handling, CORS, and env config (`VITE_API_URL`) so local and deployed FE/BE stay in sync.
- Harden auth token handling and API client retries/timeouts.

## More scenarios

- Add new interview-style challenges beyond the current seeded set (URL shortener, file storage, feed, rate limiter).
- Richer traffic patterns, failure modes, and scoring per scenario.
- Scenario content (overview, requirements, allowed components) editable via the backend.

## Edge-case testing

- Automated tests for simulation edge cases (spikes, cache stampedes, cascading failures, saturation at 100%).
- API tests for challenge/component endpoints and auth failure paths.
- Frontend regression coverage for connect mode, undo/redo, and sandbox routing.

## Production-like test environment

- Staging (or docker-compose) stack that mirrors production: API + PostgreSQL + frontend build with real env vars.
- Smoke checks against that environment before release.
- Clear secrets handling (no `.env` in git; platform env vars only).

## UI / UX fixes

- Polish landing, challenges browser, and sandbox chrome under the **BreakIT** brand.
- Fix navigation, scrolling, empty/loading/error states, and mobile layout gaps.
- Tighten simulation controls and feedback so failures and bottlenecks are obvious.

## Tracking

Open GitHub issues from this list as work starts; keep this file as the summary of intent.
