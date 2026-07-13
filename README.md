# System Design Game

A browser-based game where you architect systems under interview-style load. Start with the **URL Shortener** scenario: wire up load balancers, services, caches, and databases using conveyor belts, then survive traffic spikes and celebrity URL hotspots.

## Play

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (typically http://localhost:5173).

## How to play

1. Place components from the palette onto the board.
2. Enter **Connect Mode** and link ports with conveyor belts:
   - Incoming Requests → Load Balancer
   - Load Balancer → Shortener Service (creates) and Backend Service (reads)
   - Shortener → Database (and optionally Redis)
   - Backend → Redis (cache hits) and/or Database (cache misses)
3. Press **Play** and keep every component below 100% load for 45 seconds.
4. Right-click a component to remove it.

## Stack

- Vite + TypeScript
- Vanilla DOM/SVG rendering (no framework)

## Build

```bash
npm run build
npm run preview
```
