# BreakIT roadmap

Summary of intent. Specs under `docs/specs/` hold the detail and the "as
built" notes; this file says what is done and what is on the table.

## Done

- **Flow correctness** (`flow-correctness.md`): capability model, declared
  request flows, flow interpreter, violations distinct from drops, objectives
  with completion floors and a violation ceiling, design-time lint, request
  inspector, objective-driven report.
- **Flow authoring** (`flow-authoring.md`): one scenario document (request
  mix, roles, flows, objectives), the in-app editor with Apply, flows and
  calibrated floors for all four scenarios, legacy routing removed.
- **Anonymous collaborative rooms with interview mode**
  (`interview-platform.md`, build order 1–7 plus §4.1): database-free and
  account-free backend, seeded determinism and reference solutions,
  per-entity sync with per-person undo, rooms over one SignalR hub, room-wide
  deterministic runs, room settings, server-side scenario projection and the
  opaque run-time flow bundle, host notes and the PDF record.

## Constraints every direction keeps

Free to use. Zero personal data: no accounts, no storage in the browser, no
server-side persistence, no analytics. Anything that needs a database or a
person's identity is parked (`interview-platform.md` §10).

## Directions (specified, executing in order)

Tech spec for all six: [docs/specs/product-directions.md](./docs/specs/product-directions.md)
(2026-11-10). Execution order: D1 portable artifacts → D2 scenarios → D3
coaching → D4 host tooling → D5 engine fidelity, with D6 reach phases
interleaved. **Done:** D1 (links, files, replays) and D2 (scripted drills,
traffic phases, ten scenarios) — 2026-11-10. **In progress:** D3 coaching — phases 1 (Why? drawer) and 2 (same-seed A/B compare) done 2026-11-10; next hints and concept cards.

1. **Portable artifacts without a server** — boards and scenarios encoded in
   the URL fragment (compressed), JSON export/import, "permalink to my
   design"; the deterministic event log as a self-contained replay file.
2. **Scenario depth and breadth** — more interview classics (messaging,
   ticket booking, dispatch, autocomplete, notifications, payments), scripted
   failure phases (region outage, cache stampede, hot shard), multi-phase
   traffic timelines; each with flows, objectives, a reference and
   calibration.
3. **Coaching layer** — explain the verdict with trace-backed evidence,
   same-seed A/B comparison of two boards, guided walkthroughs and a hint
   ladder per scenario, concept cards attached to lint messages.
4. **Interview host tooling** — local-only rubric form folded into the PDF,
   phase timer, one-click failure drills, local participant labels (§11 Q6),
   local session replay from seed + event log.
5. **Engine fidelity** — latency percentiles from a queueing model, retries,
   timeouts and backoff, circuit breakers and backpressure, replication lag,
   multi-zone topology and partition semantics, cost over time. Requires
   re-calibrating every floor.
6. **Reach and accessibility** — tablet layout, keyboard-only editing,
   colour-blind-safe request palette, onboarding tour, PWA offline solo mode,
   one-command self-hosting, scenario packs contributed via pull request.

## Tracking

Open GitHub issues from the chosen direction; keep this file as the summary.
