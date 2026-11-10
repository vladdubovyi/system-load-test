# BreakIT

**Design a system, run real traffic at it, and watch where it breaks — alone or live with someone else. Free, anonymous, nothing stored.**

BreakIT is a browser-based system design simulator. You place load balancers, services, caches, queues and databases on a board, wire them up, and press Play. Seeded traffic flows through your design request by request; spikes hit, queues fill, components overload, and at the end you get a report that says whether the architecture *survived* and whether it *did the job* — every request kind took the path the scenario requires, at the completion rates it demands.

Open a scenario, click **Share**, and whoever has the link or the 8-character code is on the same canvas, live. Switch the room to **interview mode** and the scenario's flows and objectives are withheld from the other side by the server, not just hidden by the UI.

**Play online:** https://vladdubovyi.github.io/system-load-test/

## Who it is for

- **Engineers preparing for system design interviews** who want more than a whiteboard: a design that can actually be wrong, and a run that shows *why*.
- **Interviewers and hiring teams** who want every candidate to face the same scenario under the same traffic, with a private host-side view and a PDF record that stays on the interviewer's machine.
- **Mentors, teachers and study groups** who want to build and break a design together in real time, without anyone creating an account.

## The two rules

BreakIT is built around two commitments that shape every feature (see [`docs/specs/interview-platform.md`](./docs/specs/interview-platform.md) §2 and §6):

1. **Zero personal data.** No accounts, no email, no names, no passwords, no analytics. Nothing is written to cookies, `localStorage` or `sessionStorage`. The server has no database and no file storage: rooms live in process memory and disappear shortly after everyone leaves. Participants get generated names ("Blue Heron"). Host notes never leave the host's tab. A test suite fails the build if any of this changes.
2. **Integrity by construction.** In interview mode, the server projects the scenario per role: participants receive a whitelisted document (title, requirements, traffic, allowed components) and never the flows, objectives, scoring weights or even the scenario's identity. The flows their engine needs arrive as an opaque bundle only when a run starts and are discarded when it ends. The spec states plainly where this is weaker than it sounds (§6.2): a determined participant reading network traffic during a run can capture the bundle.

## What you can do

### Solo sandbox

- **Ten interview-classic scenarios**, each with requirements, traffic profile, required request flows, objectives and a calibrated reference solution: URL shortener, file storage (Dropbox), social feed (Instagram), rate limiter, chat messaging, ticket booking (with a multi-phase on-sale rush), search autocomplete, ride dispatch (rush-hour ramp), notification fan-out (built-in worker-degradation drill), payment webhooks (built-in degraded-ledger drill).
- **Scenario depth**: scripted failure phases ("the database goes down at t = 20 s for 15 s") and multi-phase traffic timelines are scenario data — deterministic, room-safe, and authorable in the scenario editor.
- **23 component types** across networking, compute, storage, messaging and cross-cutting services, each with semantic *capabilities* (ingress, compute, cache, durable store, queue, traffic filter…) that flows select on.
- **Flow correctness, not just survival.** Each request kind has a declared path (e.g. *ingress → compute → durable store*, with an optional cache branch). A request that cannot take a required step is a *violation*, distinct from a drop. Objectives set completion floors per kind and a violation ceiling; a design that stays healthy but routes writes into a cache fails outright.
- **Design-time lint** at Play tells you which required steps your board cannot satisfy before the run proves it.
- **Request inspector**: pause and click any moving request to see its full journey — every hop, queue wait, branch outcome and the exact reason it was violated or dropped.
- **Component configuration**: horizontal/vertical scaling, reactive and predictive auto-scaling, database read replication and sharding; scenario-defined roles (tags) so a flow can single out "the write service".
- **Traffic panel** (base RPS, spike behaviour, request mix) and **failure injection** mid-run (shutdown, latency, capacity loss, partition).
- **Deterministic, seeded runs.** Every random draw comes from one seeded generator; two boards with the same seed produce the same run tick for tick. The report shows the seed, **Replay same traffic** reproduces it, and `?seed=N` pins a tab for bug reports and comparisons.
- **End-of-run report** with verdict, objectives checklist, per-kind flow stats, scores across availability, latency, correctness, efficiency and headroom, the component table, broken-service causes, and a **PDF export** that includes the board, the scenario as applied and the seed.
- **Scenario editor**: edit the request mix, roles, flows and objectives as one JSON document and apply it for the session. Starter and reference boards per scenario; full undo/redo covering placement, wiring, configuration, drags, and free-hand annotations (text and strokes).

### Collaborative rooms

- **Share** opens a private room: a participant link and an 8-character Crockford base-32 code (readable aloud; `O→0`, `I/L→1`), plus a host link that gets you back in as host. No listing, no search; unknown and expired codes get the same answer.
- **Live, per-entity sync**: concurrent edits merge last-writer-wins per component, belt, config, note or stroke, so two people can work different corners of the board; **undo stays per person**. Presence, roles and live cursors.
- **Runs are room-wide and identical everywhere**: the server fixes the seed and board version; every client runs its own engine; the controller's clock keeps everyone in step; pause, resume, speed, failure injection and traffic changes are tick-stamped room events. A client that joins mid-run fast-forwards from tick 0. If the controller disconnects, the host takes over.
- **Room settings, set on the spot and gone with the room**: open or interview mode; shared pen or a single pen that the host hands over (participants can raise a hand); who can run; a pinned traffic seed; report visibility (everyone, or host-only until released).
- **Rooms expire**: 30 minutes empty, 12 hours idle. Creation and failed joins are rate-limited per IP; message and board sizes are capped; the hub never logs payloads, codes or secrets.

### Interview mode

- Server-side projection per role (above). Open-mode participants can read the scenario document; interview-mode participants cannot open it at all.
- Violation wording, lint and step-level inspector detail are suppressed on participant screens; the host keeps the full picture. The host can switch lint on for participants as explicit design hints, and is told that this sends them the flows.
- Reports default to host-only; participants see "Run complete" until the host releases it. Even when released, participants' reports structurally lack the authored objectives.
- Private **host notes** (in the host's tab only) and the PDF record: board as run, scenario as applied, seed, room code, notes. That PDF *is* the interview record, and it lives on the host's machine.
- A **public-scenario banner** reminds the host that an unedited catalog scenario is public — edit it on the spot to make it yours — and a **fresh interview room** button creates a new room when participants have already seen the open-mode internals.

## Stack

- **Frontend:** Vite + TypeScript, vanilla DOM/SVG, `@microsoft/signalr` for rooms. No framework, no state library.
- **Backend:** ASP.NET Core 8 — six read-only catalog endpoints served from an in-memory catalog built from the seed source, and one SignalR hub for rooms. **No database, no Identity, no write endpoints.**
- **Hosting:** the frontend is a static site (GitHub Pages today). The API needs WebSockets and a single always-on instance (rooms live in process memory; scaling to zero ends every room). `VITE_API_URL` is baked in at build time.

## Run locally

```bash
npm install
npm run dev            # frontend on http://localhost:5173
```

Solo play works with no backend: the app falls back to its built-in URL-shortener challenge and component library. For the full catalog and rooms:

```bash
cd backend/SystemDesignSimulator.Api
dotnet run             # needs only the .NET 8 SDK
```

Then `cp .env.example .env.development` and point `VITE_API_URL` at the API's URL.

## Tests

| Suite | Command | What it covers |
|---|---|---|
| Unit (Vitest) | `npm test` | Engine determinism and calibration (every starter misses a floor, every reference passes, on several seeds), flows and lint, objectives and report, board diffs, join codes, wire conversions. |
| Backend (xUnit) | `npm run test:backend` | Catalog, anonymous-MVP guards (no auth routes, no EF/Identity assemblies), hub protocol, merge semantics, runs, settings, interview projection, expiry, rate limits, log redaction. |
| End-to-end (Playwright) | `npm run test:e2e` | Landing, challenges, every scenario's starter and a full 100× run, editing and undo/redo, lint, inspector, scenario editor, determinism, privacy guards, and two-browser room flows (sync, runs, settings, interview mode) against an in-process fake hub. |
| Live backend | `npm run test:e2e:real` | The real API and hub with no mocking: catalog, two-person room, interview projection, no account surface. |

The mocked e2e suite starts its own Vite server on port 4273 and reuses one if it is already listening — if a stale dev server is running, set `E2E_PORT` to another port. Simulation tests are CPU-bound; on a loaded machine use `--workers=2`. First run: `npx playwright install chromium`.

## Specs

Design decisions live in `docs/specs/` and are kept current with "as built" notes:

- [`flow-correctness.md`](./docs/specs/flow-correctness.md) — capability model, flow specs, the engine's flow interpreter, objectives, lint.
- [`flow-authoring.md`](./docs/specs/flow-authoring.md) — the scenario document, the editor, flows for every scenario, legacy routing removal.
- [`interview-platform.md`](./docs/specs/interview-platform.md) — the anonymous MVP, determinism, rooms, runs, settings, interview mode, abuse limits.

[ROADMAP.md](./ROADMAP.md) lists candidate directions. Deployment notes: [DEPLOY.md](./DEPLOY.md), [backend/README.md](./backend/README.md).

## License

MIT — see [LICENSE](./LICENSE).
