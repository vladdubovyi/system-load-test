# BreakIT

BreakIT is a browser-based system design game: place load balancers, services, caches, and databases on a board, connect them, then run traffic until something breaks — or your design holds.

Built for engineers practicing system design interviews and for anyone who wants a more production-like feel than a static whiteboard.

## Play online

**https://vladdubovyi.github.io/system-load-test/**

Hosted on GitHub Pages (repository name is still `system-load-test`).

## Stack

- **Frontend:** Vite + TypeScript (vanilla DOM/SVG)
- **Backend:** ASP.NET Core 8 + Entity Framework Core + PostgreSQL

## Run locally

### Frontend

```bash
cp .env.example .env.development
npm install
npm run dev
```

Open the URL shown in the terminal (typically http://localhost:5173).

### Backend (optional, for API-backed challenges)

```bash
# PostgreSQL must be running; see backend/README.md
cd backend/SystemDesignSimulator.Api
dotnet run
```

Point `VITE_API_URL` in `.env.development` at the API (default in `.env.example`: `http://localhost:5063`).

## How to play

1. Place components from the palette onto the board.
2. Enter **Connect Mode** and link ports with conveyor belts.
3. Press **Play** and keep every component below 100% load for the scenario duration.
4. Right-click a component to remove it.

## Tests

```bash
npm test          # unit tests (Vitest) for the simulation engine and API client
npm run test:e2e  # end-to-end tests (Playwright, Chromium)
```

The end-to-end suite in `e2e/` starts the Vite dev server itself and mocks the
backend API in the browser, so it needs no database or .NET runtime. It covers
the landing page, the challenges browser, email sign-in/registration, and the
sandbox: every seeded challenge is opened, its starter architecture is checked,
and a full simulation is run at 100x speed and its end-of-run report asserted.
Board editing (placing, wiring, configuring, undo/redo), pause/resume, traffic
config, and failure injection are exercised as well.

Useful variants:

```bash
npm run test:e2e:ui        # Playwright UI mode
npm run test:e2e:headed    # watch the browser
npm run test:e2e:report    # open the last HTML report
E2E_BASE_URL=http://localhost:5173 npm run test:e2e   # reuse a running dev server
```

First run only: `npx playwright install chromium`.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for planned work (FE↔BE wiring, scenarios, testing, production-like env, UI/UX).

## Deployment

GitHub Pages setup: [DEPLOY.md](./DEPLOY.md). Backend deploy notes: [backend/README.md](./backend/README.md).

## License

MIT — see [LICENSE](./LICENSE).
