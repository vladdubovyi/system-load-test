# Flow Authoring & Serialization — Mini-spec (Phase 5)

Status: **Implemented and verified** (Phase 5 of
[flow-correctness.md](./flow-correctness.md) §8) — frontend, backend and
full-stack suites all green; see §7.
Owner: Vlad
Last updated: 2026-11-02

## 1. Goal

Phases 1–4 made flows, objectives and capabilities first-class in the
frontend, but they still live as TypeScript constants keyed by challenge slug
(`flow-presets.ts`). Phase 5 moves them into the data a challenge carries, so
that:

1. every seeded challenge ships its flows from the backend (no slug lookup),
2. a scenario author can change them without a frontend release,
3. a scenario can distinguish two components of the same type (tags, §4.1 of
   the parent spec), and
4. the engine's legacy heuristic routing can be deleted (§5 amendment).

## 2. Data model

### 2.1 ScenarioConfig (backend jsonb, no migration)

`Scenario.ScenarioConfig` gains three optional keys alongside the existing
`requestTypes`, `requirements`, `pattern`, `drainDuration`, `characteristics`:

```jsonc
{
  "flows":      FlowSpec[],      // parent spec §4
  "objectives": Objectives,      // parent spec §6
  "tags":       TagDefinition[]  // §2.3 below
}
```

The frontend reads them in `mapChallengeFromApi` (`src/api/client.ts`),
exactly like it reads `requestTypes` today. Precedence in
`scenario-runtime.ts` is unchanged: challenge-supplied values win, the
slug-keyed presets remain only as a fallback for challenges that predate this
phase (and for the offline fallback challenge).

**Hardening:** backend JSON is normalised on the way in. `null` values are
stripped (a `"componentType": null` would otherwise fail the selector's
`!== undefined` test), and flows that fail `validateFlows` are logged and
replaced by the preset for that slug so a bad edit can never brick a
challenge.

### 2.2 ComponentDefinition capabilities

`ComponentDefinition.ConfigSchema` (already jsonb) carries
`{ "capabilities": Capability[] }`. `ComponentsController` surfaces it as a
top-level `capabilities` array, which `capabilities.ts` already prefers over
its built-in table. The seeder writes the same values as the frontend
fallback table so a fresh database and the offline mode agree.

### 2.3 Tags

```ts
// src/game/flow-types.ts
export interface TagDefinition {
  id: string;            // selector value, e.g. 'write-service'
  label: string;         // chip text, e.g. 'Write service'
  description?: string;
  /** Which component types may carry the tag; omitted = any. */
  appliesTo?: NodeSelector;
}
```

- `ScenarioDefinition.tags?: TagDefinition[]`, carried through
  `RuntimeScenario`.
- `PlacedComponent.tags?: string[]` — tags are part of the board, so they are
  captured by undo/redo and the pre-run snapshot like every other board edit.
- `selectorMatches` takes the component (type **and** tags), not just the
  type. A `tag` criterion matches when the component carries that tag. All
  other criteria on the selector must still match (AND semantics, unchanged).
- **UI:** when the active scenario defines tags, the configuration palette
  shows a "Roles" group of draggable tag chips (`data-tag-chip`). Dropping one
  on a component whose type satisfies `appliesTo` toggles the tag and renders
  a `🏷 label` badge. Dropping on an ineligible component shows the same toast
  used for rejected connections.
- Lint and violation messages phrase a tag step as
  *a component tagged "Write service"* so the remedy is obvious.

## 3. Authoring surface (v1)

### 3.1 Scenario editor panel

A **✎ Scenario** action in the sandbox chrome opens `#scenario-editor`, a
panel in the same family as the Traffic panel. It holds one JSON document:

```jsonc
{ "requestTypes": {…}, "tags": […], "flows": […], "objectives": {…} }
```

Buttons:

- **Validate** — JSON parse + `validateFlows` + cross-checks (every
  `requestTypes` kind has a flow; every `minCompletionRate` kind exists; tag
  selectors reference declared tags). Problems render in
  `.scenario-editor-errors`; nothing is applied.
- **Apply** — validates, then installs the document as a *scenario override*
  for this browser session (`setActiveScenarioOverride` in
  `scenario-runtime.ts`, layered between the challenge and the Traffic
  override). Lint and the next run use it immediately. **Reset** clears it.
- **Save** — `PUT /api/challenges/slug/{slug}/scenario-config` with the
  document. Disabled with a hint unless the user is signed in; success and
  failure are reported with the board toast.

A visual step editor is deliberately deferred: the JSON form is complete,
copy-pasteable, and exercises the entire pipeline, which is what this phase
needs to prove.

### 3.2 Endpoint

`PUT /api/challenges/slug/{slug}/scenario-config` — `[Authorize]`

Body: a JSON object; recognised keys `flows`, `objectives`, `tags`,
`requestTypes`. Each present key replaces the same key in `ScenarioConfig`;
absent keys are left alone. Returns the challenge in the same shape as
`GET /api/challenges/slug/{slug}`.

Validation is shape-level only (`flows` must be an array of objects with a
string `kind` and a `steps` array; `objectives`/`tags`/`requestTypes` must be
the right JSON kind). Semantic validation lives in the frontend's
`validateFlows`, which the editor runs before it ever calls Save.

**Authorization.** There is no role system. The endpoint is gated by an
allowlist: `CHALLENGE_AUTHORS` (env or appsettings), a comma-separated list
of emails compared against the JWT `email` claim. **If the list is unset the
endpoint returns 403 for everyone** — secure by default; deployments opt in.
A proper author role can replace this later without changing the client.

## 4. Flows for the remaining challenges

With these two the four seeded challenges all carry flows, which is the
precondition for deleting the legacy routing path.

**File storage (Dropbox).** Starter gains one belt, Worker Service → Object
Storage, so the async path has somewhere to land.

| kind | steps |
|---|---|
| `upload` | ingress → *ingress (optional, the gateway)* → compute → *queue (optional)* → *compute (optional, worker)* → object-storage **terminal** |
| `download` | ingress → *ingress (opt)* → compute → *cache (opt, branch hit→complete / miss→object-storage terminal)* → object-storage **terminal** |
| `metadata` | ingress → *ingress (opt)* → compute → database **terminal** |

Uploads therefore split between the direct path (API → Object Storage) and
the async path (API → Message Queue → Worker → Object Storage); both are
correct, and a queue with no worker behind it is a flow violation instead of
a silent sink. Message-queue *semantics* (batching, async completion) stay
out of scope per the parent spec §9 — the queue is a hop with capacity.

**Rate limiter.** Starter gains Redis Cache → SQL Database for miss chaining.

| kind | steps |
|---|---|
| `check` | ingress → traffic-filter (**required**) → compute → *cache (opt, branch hit→complete / miss→durable-store terminal)* → durable-store **terminal** |

A design that bypasses the rate limiter violates every request; that is the
lesson of the challenge.

Objectives for both use the Phase 4 calibration rule: completion floors the
shipped starter clears, `maxViolationRate: 0`. Measured on the starters
(6 runs, reference configs): Dropbox 0.53–0.65 per kind → floors **0.4**;
Rate Limiter 0.26–0.47 (it sheds most of its 5× spikes) → floor **0.2**.

## 5. Legacy routing removal

Removed from `simulation.ts`: `legacyCompleteOneRequest`, the ingress
heuristics for `shortener`/`backend`, the "Shortener only handles create"
accept rules, the storage-node auto-complete, and the `readRatio` split in
predictive scaling (a kind with no flow now carries no routable traffic, so
it gets no predictive share).

`readRatio` itself stays. Besides read-replica sizing, `pickRequestKind`
still falls back to a `readRatio` read/create split when a scenario defines
no `requestTypes` at all — the derived fallback for legacy data that the
parent spec §4.2 calls for. Such kinds are only routable if the scenario
also defines flows for them; otherwise they are violated on arrival like any
other flow-less kind.

A request kind with no FlowSpec is now a **configuration error** rather than
a routing mode: the lint reports *"Request kind "x" has no flow"* and the
engine terminates such requests as violated on their first hop with the same
message. Scenarios without flows at all keep lint-free survival-only
behaviour until they gain flows.

## 6. Out of scope

- Visual flow editor; challenge create/delete endpoints; author role.
- Persisting tag assignments with a design (designs are not persisted yet).
- Deriving `canConnect` from capabilities (parent spec §7, still "longer
  term").

## 7. Verification

All three layers are covered and green:

- **Unit (Vitest, 118):** tag matching, override layering, API null
  normalisation, scenario-document validation, lint for flow-less kinds,
  Dropbox/Rate-Limiter flows on their starters.
- **Backend (xUnit, 72) — `npm run test:backend`:** the real application
  hosted with `WebApplicationFactory` against a throwaway **PostgreSQL**
  database per test class (same engine as production, so `jsonb` and
  `System.Text.Json` behave identically). Covers the authoring endpoint
  (401/403/400/404/200, merge semantics, jsonb round-trip of nested
  branches), the author allowlist including the closed-by-default case, the
  seeder, the `EnsureFlowDefinitions` backfill (idempotent, never overwrites
  authored edits), capability exposure, and the serialized flow shape
  (no `null` members, every flow can complete).
- **E2E, mocked (Playwright, 88) — `npm run test:e2e`:** frontend behaviour
  against the canned API fixtures. Fast and hermetic; no backend needed.
- **E2E, live (Playwright, 7) — `npm run test:e2e:real`:** the frontend
  against a real API and PostgreSQL with **no request mocking**. Proves
  flows/objectives/capabilities survive jsonb → API → client mapping →
  engine, and that an author can save a scenario in the editor and have the
  backend serve it on the next load. Skipped unless `E2E_REAL_API_URL` is
  set; `scripts/e2e-real-api.sh` provisions everything and drops the
  database afterwards.

### Harness notes (learned the hard way)

- `Program.cs` reads the connection string and JWT secret **while building
  the host**, so `WebApplicationFactory.ConfigureAppConfiguration` is applied
  too late for them. Supplying them that way silently leaves the suite
  pointing at the developer's own `systemdesignsim` database and mutating
  seeded data. `ApiFactory` sets them as environment variables in
  `CreateHost` instead, and `IsolationTests` asserts the application is
  connected to the throwaway database.
- `dotnet run` applies `launchSettings.json`, which pins the URL to `:5000`
  and overrides `ASPNETCORE_URLS`; the script passes `--no-launch-profile`
  and `--urls`, and picks a free port rather than a fixed one.
- The mocked and live suites both drive a Vite dev server on `E2E_PORT`, and
  only the live one points it at the API — running them concurrently fails
  both. Run them sequentially, or give them different ports.
- Readiness means "the API returned the seeded challenges as JSON", not
  "something accepted a connection": an unrelated server on the port would
  otherwise look healthy while the frontend quietly used its offline
  fallback. The live suite also asserts the loaded challenge id is a database
  GUID rather than `legacy-url-shortener`, and the script fails a run in
  which every test skipped.
