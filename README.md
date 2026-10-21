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

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for planned work (FE↔BE wiring, scenarios, testing, production-like env, UI/UX).

## Deployment

GitHub Pages setup: [DEPLOY.md](./DEPLOY.md). Backend deploy notes: [backend/README.md](./backend/README.md).

## License

MIT — see [LICENSE](./LICENSE).
