# BreakIT Product Directions — Tech Spec

Status: **v1, approved for implementation** (2026-11-10).
Owner: Vlad
Last updated: 2026-11-10

Six directions, one document. Each section is written to the same standard
as `flow-correctness.md` and `interview-platform.md`: enough design that
implementation can start without re-deciding anything, with phases, tests
and risks. The directions execute **one by one, in the order of §1.2**;
"as built" notes get appended to each section as its phases land, as the
earlier specs do.

## 1. Ground rules and execution order

### 1.1 Invariants every direction keeps

These restate `interview-platform.md` §2 and bind everything below:

- **Free to use. Zero personal data.** No accounts, no email, no names, no
  analytics. Nothing written to cookies, `localStorage` or
  `sessionStorage`. No server-side persistence of any kind.
- **The backend stays read-only + one hub.** Six catalog GETs from the
  in-memory catalog and the rooms hub. No write endpoints. Anything that
  would need a database is out of scope here and parked in
  `interview-platform.md` §10.
- **Determinism is sacred.** Every engine-visible input must come from the
  scenario, the board, the seed or a tick-stamped event
  (`interview-platform.md` §8, §4.4). Any feature that adds an engine input
  must thread it through all four of: solo runs, room runs, the interview
  projection, and the calibration tests.
- **Guard tests keep the rules.** `AnonymousMvpTests`, `anonymous.spec.ts`
  and the hub log-redaction test must stay green untouched. New features
  add their own guards where they create a new place for data to leak.

### 1.2 Execution order and why

| # | Direction | Size | Depends on |
|---|---|---|---|
| D1 | Portable artifacts (links, files, replays) | S | — |
| D2 | Scenario depth and breadth | L (content) | D1 (authors share scenarios as links) |
| D3 | Coaching layer | M | D1 (A/B uses snapshot links), D2 (hints are per-scenario content) |
| D4 | Interview host tooling | M | D1 (replay file) |
| D5 | Engine fidelity | L (recalibrates everything) | after D2, so new scenarios are written once |
| D6 | Reach and accessibility | M | — (interleave; see §7.5) |

D1 first because it is small, unblocks sharing for everything after it,
and exercises no new server surface. D2 before D5 because adding scenarios
after an engine change means calibrating once, not twice. D6 has no
dependencies; its phases are deliberately independent so they can fill
gaps between larger directions.

## 2. D1 — Portable artifacts

### 2.1 Goal

A design, a scenario and a run must be shareable and reproducible with
**no server state at all**: a URL you can paste in chat, a file you can
attach to an issue, a replay you can hand to someone and they see your
exact run. This is the only sharing model compatible with §1.1, and it is
also the bug-report pipeline the project itself needs.

### 2.2 Snapshot model

One client-side document type, the **snapshot**, used by all three
carriers (link, file, replay):

```ts
interface BoardSnapshotV1 {
  v: 1;                              // format version, bump on breaking change
  kind: 'board' | 'run';             // 'run' additionally pins the seed
  scenarioSlug: string | null;       // catalog scenario this started from
  scenario?: ScenarioDocument;       // applied override (flow-authoring §2)
  traffic?: TrafficProfile;          // Traffic-panel override, if applied
  seed?: number;                     // kind 'run' only
  board: WireEntity[];               // { kind, id, value }, room wire shape
}
```

- `board` reuses the room wire shape (`src/rooms/room-client.ts`,
  `WireEntity`) and the five entity kinds of `RoomBoard.Kinds`:
  `component | belt | config | text | stroke`. One serialization for rooms,
  links and files; one validator.
- `scenarioSlug: null` means "whatever the default is" and also lets an
  interview participant export their board without exporting the withheld
  scenario identity: the export writes **only what the client holds**, so
  projection (interview-platform §6) is preserved by construction.
- A snapshot deliberately contains **no names, no notes, no room codes**.
  Host notes and participant labels never enter any carrier.

### 2.3 Encoding for the URL carrier

`{site}/sandbox#board=1.<payload>` where `payload` is
`base64url(deflate-raw(JSON))` and the leading `1.` is the format version.

- **The fragment, again.** Same reasons as room links
  (interview-platform §3.2): works on a static host with no SPA fallback,
  and never appears in a server log. `#board=` must coexist with `#join=` /
  `#host=`; `parseRoomFragment` (`src/rooms/join-codes.ts:49`) already
  ignores unknown keys, and the board fragment parser ignores room keys.
  If both are present, the room wins and the board fragment is dropped —
  a room defines its own board.
- **Compression:** `CompressionStream('deflate-raw')` /
  `DecompressionStream`. Available in every 2026 evergreen browser. If the
  API is missing, the Share dialog hides the link option; import of an
  uncompressed `1u.<payload>` variant is **not** offered — one format.
- **Size cap:** refuse to *create* a link when the encoded fragment
  exceeds **8,000 characters** (safe across browsers and chat apps); the
  dialog says to use file export instead. Decoding enforces the same caps
  as the server board (`RoomLimits`): ≤ 5,000 entities, ≤ 2 MB of entity
  JSON after decode, ≤ 256 KB of scenario/traffic JSON.

### 2.4 Decoding and validation

Decoding is parsing untrusted input and is specified as such:

1. Version prefix must be `1.`; anything else → "This link was made by a
   newer version of BreakIT" (forward) or "not a board link" (garbage).
2. JSON must parse; `v === 1`; `kind` in the enum; unknown top-level keys
   are **dropped**, not kept.
3. Entities: kind must be in `RoomBoard.Kinds`; ids non-empty strings
   ≤ 200 chars; duplicates (same kind+id) → last wins; belts whose
   endpoint component is absent are dropped (same cascade as
   `applyDiff`/`RoomBoard`). Values are structurally cloned, never
   evaluated.
4. `scenario` goes through `validateScenarioDocument` (`src/game/flows.ts`)
   — the same gate the editor's Apply uses; an invalid document voids the
   whole snapshot (better no load than a half-load).
5. `traffic` and `seed` are range-checked (`baseRps` 1..100000, seed a
   positive int32).
6. Text annotations arrive as data and are rendered through the existing
   escaping path (commit 95f7c1c); a test plants `<img onerror>` in an
   imported note and asserts it renders inert.

A failed decode leaves the sandbox exactly as it was, with one toast.

### 2.5 Surfaces

- **Share dialog** (`src/rooms/room-ui.ts`) gains a third section,
  **"Snapshot"**, above room sharing, available solo and in rooms:
  - *Copy board link* — `kind: 'board'`, no seed.
  - *Copy run link* — enabled when a last-run seed exists
    (`state.lastSeed`); `kind: 'run'` with the seed. Opening it pins the
    seed like `?seed=` does today and loads the board.
  - *Export file* — downloads `breakit-board-<scenario>-<date>.json`,
    pretty-printed snapshot (the file carrier has no size cap).
  - *Import file* — file picker; same decoder; **in a room it is a normal
    gesture**: refused without the pen, broadcast as one diff when
    allowed. Solo, it replaces the board through `installBoard` and is one
    undo step.
- **Loader:** `mountSandboxApp` (`src/sandbox/sandbox-app.ts`) reads
  `#board=` when there is no room credential, installs scenario override,
  traffic and board, pins the seed for `kind:'run'`, then clears the
  fragment (`history.replaceState`) so refresh does not re-import over
  later edits.
- **Report modal** (`src/ui/report-modal.ts`) gains *Copy run link* next
  to *Replay same traffic* — the "here is my exact run" affordance.

### 2.6 Replay carrier (phase 3)

`kind: 'run'` reproduces a run that had no mid-run intervention. Room runs
already record the full intervention sequence as tick-stamped events
(`RunEventMessage`). The replay file is the snapshot plus that log:

```ts
interface RunReplayV1 extends BoardSnapshotV1 {
  kind: 'run';
  seed: number;                       // required here
  events?: { seq: number; kind: RunEventKind; payload: unknown; applyAtTick: number }[];
}
```

Loading a replay arms a **local event scheduler**: the solo engine applies
each event at its tick, reusing `applyRoomEvent`'s switch
(`src/sandbox/sandbox-app.ts`) outside a room. The host's report modal
offers *Export replay* after a room run (the client already holds the
stamped events). Solo runs with manual failure injections do **not**
record events in v1 — that would mean instrumenting solo controls; noted
as the first v2 item.

### 2.7 Phases, tests, risks

| Phase | Deliverable |
|---|---|
| 1 | `src/share/snapshot.ts`: types, encode/decode/validate, fragment build/parse. Vitest: round-trip, caps, cascade, malformed input, forward-version message. |
| 2 | Share-dialog section, `#board=` loader, report-modal run link. e2e (`e2e/share.spec.ts`): link round-trip across two contexts; run link reproduces identical flow stats; room fragment beats board fragment; XSS note inert. |
| 3 | File export/import incl. in-room import-as-gesture; replay export after a room run and local replay with events applied. e2e: file round-trip; replay of a run with a failure event matches the original report. |

Risks: URL length in messengers (mitigated by the 8k refusal + file
fallback); format lock-in (versioned prefix, decoder keeps v1 forever);
imported garbage (validation above, and the sandbox-untouched guarantee).

## 3. D2 — Scenario depth and breadth

### 3.1 Goal

The catalog is the moat and the anti-cheat posture
(interview-platform §6.4). Target: **six new scenarios** and two depth
mechanisms (scripted failure phases, multi-phase traffic) that all
scenarios — old and new — can use.

### 3.2 New scenarios

Each ships complete or not at all: seeder entry + e2e fixture + flows +
objectives + starter + reference + calibration row + one e2e scenario
test. Authoring checklist per scenario (this is the §2.1 "definition of
done" from flow-authoring, plus calibration):

1. `ChallengeSeeder.cs` + `FlowDefinitions.cs` entries (IDs via
   `StableId`; floors in both C# and `flow-presets.ts`, pinned by the
   existing cross-language test).
2. `e2e/fixtures/api-data.ts` mirror, with **all characteristics
   explicit** — the projection lesson from interview-mode: no slug-keyed
   frontend fallbacks (§6.5).
3. Starter (correct but under-provisioned) and reference in
   `challenge-presets.ts`; measured floors via `calibration.test.ts`
   seeds; starter must lose, reference must win, on every seed.

The six, chosen for distinct lessons with the existing component set:

| Slug | Lesson | Key flows |
|---|---|---|
| `chat-messaging` | fan-out writes, queues as buffers | send → queue → worker → store; fetch |
| `ticket-booking` | contention on one hot row, no overselling | browse (cacheable), reserve (must hit the database, `maxViolationRate 0`) |
| `ride-dispatch` | location write floods vs. match reads | locationUpdate (high-rate, lossy floor), match (strict floor) |
| `search-autocomplete` | read-heavy, latency-dominated | suggest via `search-service` + cache; index via queue |
| `notification-fanout` | pure async pipeline | event → queue/kafka → worker → pubsub; delivery floor |
| `payment-webhook` | spiky ingress, rate-limited third parties | webhook → gateway → queue → worker → store, `traffic-filter` required |

Six scenarios reuse the 23 existing component types; **no new component
types in D2** (that belongs with D5 if ever).

### 3.3 Scripted failure phases

`scenario-types.ts` already declares `failureScenarios?: FailureScenario[]`
but nothing reads it. Make it real:

```ts
interface FailureScenario {
  id: string;                 // 'db-outage'
  label: string;              // shown in the HUD when it fires
  atSeconds: number;          // simulation time, deterministic by construction
  target: NodeSelector;       // same selector language as flow steps
  type: 'shutdown' | 'latency' | 'capacity' | 'partition';
  durationSeconds: number;
}
```

- The engine applies each at its tick — scenario time, not wall time, so
  determinism and room runs need **no new events**: the script rides the
  scenario document.
- Target selection uses `selectorMatches` (`src/game/flows.ts`) against the
  live board; among matches, board order picks (same rule as §8 ID work).
  No match → the phase is skipped and the report notes it.
- HUD shows a banner while a scripted failure is active ("⚡ Region
  outage: SQL Database down, 8s left"). In interview mode the label is in
  the whitelist — participants see the event, not the flows
  (projection §6.1 gains `failureScenarios` **with** labels/times but the
  selector reduced to the component label it resolved to… no: selectors
  stay; they name capabilities, which the components panel already
  shows. Keep whole entries in the projection whitelist.)
- Report: scripted phases listed with survival before/after; an objective
  flavor `surviveScriptedFailures: boolean` (default true when a script
  exists) fails the run if any component died *during* a scripted phase.

### 3.4 Multi-phase traffic

```ts
interface TrafficPhase { atSeconds: number; baseRps?: number; requestTypes?: Record<string, number>; }
// TrafficProfile gains: phases?: TrafficPhase[];
```

Linear interpolation between phase points for `baseRps`; request mix
switches at the boundary. Spikes keep working on top. The Traffic panel
displays phases read-only in v1 (authoring stays JSON in the scenario
editor). Engine reads phases inside `updateTrafficPattern` from the
scenario — again no new run inputs.

### 3.5 Phases, tests, risks

Phase 1: engine support (scripted failures + traffic phases) behind the
existing scenarios untouched; unit tests for both mechanisms, determinism
test extended to a scripted scenario. Phase 2: three scenarios
(`chat-messaging`, `ticket-booking`, `search-autocomplete`). Phase 3: the
other three, each using at least one depth mechanism.

Risks: calibration time dominates (budget half the direction for it);
balance regressions when D5 lands (accepted, §1.2 explains the order);
scenario sprawl in the seeder (mitigate: one file per scenario under
`Data/Seed/Scenarios/` when the third new scenario lands).

## 4. D3 — Coaching layer

### 4.1 Goal

Turn "you lost" into "here is why, see for yourself, try this". Three
mechanisms, all client-side, all derived from data the engine already
produces (counts, violations-by-step, drop reasons, the trace log).

### 4.2 Verdict explanations ("Why?")

Each failed objective row in the report gains **Why?** → a drawer that:

- names the dominant cause (already computed:
  `causeForKind`/`topForKind` in `src/game/objectives.ts`),
- shows **three example request traces** for that cause, rendered with the
  existing request-inspector timeline (`buildTimeline`) from finished-run
  request logs,
- states the engine rule in one sentence ("A request is violated when no
  connected component satisfies its next required step").

Engine change: keep the last N=50 finished requests *per (kind, end
state)* ring-buffered so examples exist after the run; today only live
requests are inspectable. Memory-capped, cleared on reset. Interview
participants: the drawer obeys `hideFlowDetails` — examples render, step
reasons do not (§6.2 consistency).

### 4.3 Same-seed A/B comparison

- The report modal gains **Pin this run** (session memory, max 2 pinned:
  A and B — board snapshot via D1 codec, seed, report).
- With A pinned, finishing another run with the **same seed** offers
  *Compare to A*: a two-column diff of objectives, per-kind flow stats,
  scores, and a board-diff summary ("+1 Redis Cache, Database sharding
  on") computed by `diffBoards` (`src/game/board-diff.ts`).
- Different seed → the compare button explains it compares like-for-like
  only ("Replay same traffic" is one click away). Nothing persists; both
  pins die with the tab.

### 4.4 Hints and concept cards

- Scenario documents gain `hints?: { id: string; after: 'loss' | 'violation' | 'always'; text: string }[]`
  — a ladder revealed one at a time via "Show a hint" on the report
  (count shown: "hint 1 of 3"). Authored content, so it ships with D2
  scenarios; the four existing scenarios get ladders retrofitted.
- Lint issues and violation reasons gain a stable `ruleId`; a static map
  (`src/game/concepts.ts`) attaches a 3-sentence concept card
  ("Write-through vs write-back", "Why a cache is not a durable store") to
  each ruleId, shown inline in the lint panel and the Why? drawer.
- Interview mode: hints and cards are **host-only** (they paraphrase
  flows); the projection already strips `hints` because the whitelist
  never admitted it — add the guard assertion anyway.

### 4.5 Phases, tests, risks

Phase 1: Why? drawer + finished-request ring buffer (unit: buffer caps and
sampling; e2e: a lost run's drawer names the missing durable store and
shows a violated trace). Phase 2: A/B pin-and-compare (e2e: fix seed, run
starter, pin, add cache, compare shows the delta). Phase 3: hints +
concept cards (e2e: ladder reveals one at a time; interview participant
sees neither).

Risks: explanation quality is content work disguised as engineering —
timebox copy per card; ring buffer memory on 100× runs (cap small, sample
reservoir-style using the seeded RNG so even the samples are
deterministic).

## 5. D4 — Interview host tooling

### 5.1 Goal

Make the host's hour frictionless without storing a byte: everything
lives in the host's tab and exits only through the PDF (the record,
§4.5 of interview-platform).

### 5.2 Features

- **Rubric**: a fixed default rubric (requirements, capacity math,
  bottleneck analysis, failure handling, communication; 1–5 each + note),
  editable as JSON the way scenarios are. Lives next to host notes in tab
  memory; folded into the PDF as a table. Never sent, never stored — the
  existing host-notes guard test pattern extends to it.
- **Phase timer**: host-local checklist timer (intro / requirements /
  design / deep-dive / wrap) with a quiet toast at each boundary. Pure UI.
- **Failure drills**: one-click buttons on the failure panel (host side)
  that inject a themed sequence ("kill the primary DB for 10 s", "add
  300 ms latency to every cache") as ordinary run events — room-safe by
  construction since they are just `failure` events.
- **Local participant labels** (resolves §11 Q6 → **yes, local-only**):
  the host can relabel "Blue Heron" → "Candidate" in their own tab;
  mapping keyed by connectionId, in memory, dies with the tab; PDF uses
  the label. Guard: the label never appears in any hub invocation.
- **Session replay (local)**: the host's tab already holds the full run
  (seed + stamped events) — D1's replay file is the export; this phase
  adds in-tab "replay last run" with a scrubber limited to
  pause/step-to-tick (no reverse).

### 5.3 Phases, tests, risks

Phase 1: rubric + labels (+ guards). Phase 2: timer + drills. Phase 3:
in-tab replay. e2e extends `rooms-settings.spec.ts` patterns; every
feature gets a "nothing reached the hub or storage" assertion.

Risk: feature creep toward a proctoring tool — the line is §6.4 of the
platform spec (no surveillance, no telemetry about the participant);
labels and rubric describe the *host's judgment*, not captured behavior.

## 6. D5 — Engine fidelity

### 6.1 Goal and stance

Close the realism gaps that teach wrong lessons, **without** turning the
game into a queueing-theory workbook. Everything stays deterministic and
tick-driven; every addition is scenario-opt-in so old scenarios and floors
stay valid until recalibrated deliberately.

### 6.2 Mechanisms, in order

1. **Latency distributions**: per-component service time becomes
   `base + queueWait` with a deterministic jitter draw from the seeded
   RNG; the report's latency score uses p50/p95/p99 computed from actual
   request latencies (already tracked per request) instead of averages.
   No behavior change to routing; floors unaffected (latency is scored,
   not an objective) — the gentlest first step.
2. **Timeouts and retries**: flow steps gain
   `timeoutMs?` and `retries?`; a timed-out hop returns to the caller and
   retries along the same selection rules, each retry a fresh load on the
   target. Teaches retry storms; surfaced in the inspector ("attempt
   2/3").
3. **Circuit breaker + backpressure**: a component config toggle; open
   breaker sheds load with a distinct drop reason; queues gain a
   high-water mark that propagates slowdown upstream instead of silent
   infinite queues.
4. **Replication lag**: read replicas serve reads with a configured lag;
   scenarios can mark a request kind `readYourWrites: true`, and a read
   served by a replica inside the lag window after that user's write is a
   *staleness violation* — a new violation flavor, same accounting.
5. **Zones and partitions**: components get an optional zone tag;
   `partition` failures sever cross-zone belts instead of one component.
   This is the largest change and lands only with a scenario that needs
   it (a "multi-region reads" scenario added here, not in D2).

### 6.3 Recalibration protocol

After each mechanism: run `calibration.test.ts` seeds for every scenario;
any floor that moved gets re-measured with the §8 method and changed in
**both** `flow-presets.ts` and `FlowDefinitions.cs` in the same commit,
with the measurement table updated in the spec. A mechanism that moves
floors for scenarios that do not opt in is a bug by definition.

### 6.4 Phases, tests, risks

One mechanism per phase, in §6.2 order; each lands with unit tests, a
determinism test extension, an inspector/report surface, and the
recalibration protocol. Risks: compounding complexity in
`simulation.ts` (pre-phase: extract the routing core into
`simulation/routing.ts` first — a pure refactor commit); teaching wrong
intuitions with half-real models (every mechanism's report copy links its
concept card from D3).

## 7. D6 — Reach and accessibility

### 7.1 Goal

More people can use what exists: input methods, display, first-run
experience, self-hosting. No new simulation features.

### 7.2 Scope

1. **Keyboard-first editing**: palette focus + Enter places at cursor;
   arrows nudge selection; `C` starts connect mode from selection, Tab
   cycles ports, Enter commits; everything already undoable. Full audit
   against WCAG 2.1 keyboard criteria for the sandbox chrome.
2. **Color-blind-safe mode**: request colors get a shape channel (dot /
   ring / square / diamond) and an alternative palette; toggle in the
   toolbar, stored nowhere (per the rules) — it is a URL-less, per-tab
   toggle, default off.
3. **Onboarding tour**: a 6-step overlay on first sandbox visit (place →
   connect → play → report → lint → share), driven entirely by DOM state;
   "don't show again" cannot be persisted (no storage), so the tour is
   instead entered only from a "Take the tour" button and a one-time
   auto-prompt per tab session.
4. **Tablet / pointer sizing**: hit-target audit (44px), pinch zoom on the
   board (viewport.ts), palette as a bottom drawer under 900px width.
5. **PWA offline solo**: a service worker caching the static bundle; solo
   play already works backendless (built-in fallback challenge); offline
   banner states rooms need a connection. No background sync, no
   notification permissions — nothing that touches identity.
6. **Self-hosting**: one `docker compose up` for API + static frontend,
   README section, and a `SCENARIOS.md` contribution guide (scenario packs
   arrive as pull requests to the seed source — the §2.3 authoring model,
   now documented for outsiders).

### 7.3 Phases

Each scope item is its own phase and independently shippable; order as
listed. e2e for keyboard editing and the tour; axe-core pass added to the
e2e suite for the three pages.

### 7.5 Interleaving rule

D6 phases are the designated "palate cleansers": any one may be pulled
forward between phases of D2–D5 without renegotiating this spec.

## 8. Out of scope, everywhere

Accounts, databases, telemetry, server-side scenario storage, billing,
LLM-powered anything (hint content is authored by hand), native apps, and
all of `interview-platform.md` §10 and §12. A direction that seems to need
one of these goes back to this document for a decision first.
