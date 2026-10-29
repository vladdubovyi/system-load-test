# Flow Correctness — Design Spec

Status: **Approved direction, pre-implementation**
Owner: Vlad
Last updated: 2026-10-29

## 1. Problem

Today a challenge is won by *surviving load*: the run is `lost` only if a
component's queue overflows for 1.8s, otherwise `won`. Nothing checks that the
design executes the **correct flow**. Concretely:

- Routing is hard-coded per legacy type in `Simulation.completeOneRequest`
  (`src/game/simulation.ts`): `backend` prefers Redis with `cacheHitRatio`
  probability, `shortener` forwards to any "storage", generic compute prefers
  any cache. A request's lifetime is at most source → ingress → one compute
  hop → one storage hop.
- `isStorageType` (`src/game/component-taxonomy.ts`) includes `redis`, and any
  storage node with no outgoing belt completes the request. **A create request
  that lands in Redis counts as a success** — a cache silently substitutes for
  the durable database.
- Win/lose ignores drop rate, completion rate, and path taken.
- Challenge definitions (`src/game/scenario-types.ts`) carry only traffic
  numbers plus `scoringPriorities` / `failureScenarios` /
  `referenceArchitecture`, which are declared but never read.
  `scenario-runtime.ts` strips everything but traffic before the engine sees
  it.
- The only design-time constraint is `canConnect`
  (`src/game/simulation.ts`), a hard-coded role-pair table that treats Redis
  and the database as interchangeable "storage" and rejects connections
  silently.

Goal: validate that the user's design executes the scenario's intended flow
(e.g. "a create must be persisted in a durable store", "service A must fetch
from the DB before calling service B"), generically enough that users can
eventually author their own scenarios. First target: the **URL Shortener**
scenario.

## 2. Design overview

Three pillars:

1. **Capability model** — components declare semantic capabilities
   (`durable-store` vs `cache` etc.) instead of the lumpy role taxonomy.
2. **FlowSpec + flow-driven engine** — each request kind has a declarative
   step sequence stored in the challenge; the engine interprets it instead of
   hard-coded heuristics. A request that cannot take its next required step is
   a **flow violation**, a distinct terminal outcome.
3. **Static flow lint + objectives** — a pre-Play graph check gives actionable
   design-time feedback, and win/lose becomes objective-driven (flow
   completion rate, not just survival).

The uncommitted request-tracing work (request identity across hops,
`request.events[]` journey log, request inspector UI) is the substrate: a flow
requirement is a predicate over the trace, and the inspector is where
violations are explained to the user.

### Decisions already made

- **Violation strictness:** flow violations fail the *request* (terminal state
  `violated`), hurting completion-rate objectives. They do not hard-fail the
  run the way queue overload does.
- **Response path:** `FlowStep` reserves a `returnTo` field so round-trip
  flows (A → DB → back to A → B) can be modeled later. Engine semantics and
  visuals for the return leg are **out of scope** for the initial phases; the
  field is designed now so adding it is non-breaking.
- **Delivery:** one PR per phase (see §8), spec merged first.

## 3. Capability model

```ts
// src/game/capabilities.ts (new)
export type Capability =
  | 'ingress'        // accepts traffic from the outside (LB, API gateway, reverse proxy)
  | 'traffic-filter' // shapes/filters traffic in front of compute (rate limiter, CDN, WAF)
  | 'compute'        // application logic
  | 'durable-store'  // survives restarts: database, nosql-database, object-storage
  | 'cache'          // fast, volatile: redis, cdn
  | 'queue';         // messaging: message-queue, kafka, pub-sub
```

- Capabilities are a `Set<Capability>` per component **type**. A type may have
  several (a CDN is `traffic-filter` + `cache`).
- **`redis` has `cache` only — never `durable-store`.** This is the single
  change that kills the "Redis instead of a DB" exploit.
- Source of truth: `ComponentDefinition` from the backend gains a
  `capabilities: string[]` field (serialized inside the existing
  `ConfigSchema`/definition payload — jsonb, no migration). The frontend keeps
  a hard-coded map as the offline fallback, same pattern as
  `app-init.ts`'s legacy challenge fallback.
- `component-taxonomy.ts` becomes a thin adapter over capabilities so existing
  call sites (`isComputeType`, `isStorageType`, …) keep working during the
  transition. `isStorageType` maps to `durable-store` (behavior change:
  excludes redis — intentional, see Phase 2).

## 4. FlowSpec

```ts
// src/game/flow-types.ts (new)

/** Selects which components may satisfy a step. */
export interface NodeSelector {
  capability?: Capability;      // e.g. 'durable-store'
  componentType?: string;       // exact type, e.g. 'shortener'
  tag?: string;                 // scenario-assigned role tag, e.g. 'write-service' (see §4.1)
}

export interface FlowBranch {
  /** Number in [0,1], or the name of a scenario traffic field, e.g. 'cacheHitRatio'. */
  probability: number | 'cacheHitRatio';
  /** 'complete' ends the request successfully; otherwise continue with these steps. */
  onHit: 'complete' | FlowStep[];
  onMiss: FlowStep[];
}

export interface FlowStep {
  id: string;                   // stable id for lint messages & telemetry
  require: NodeSelector;
  /** Step may be skipped if no satisfying belt exists (e.g. optional cache). */
  optional?: boolean;
  /** Probabilistic branching at this node (cache hit/miss, A/B paths). */
  branch?: FlowBranch;
  /** Reaching (and being processed by) this step completes the request. */
  terminal?: boolean;
  /**
   * RESERVED (not interpreted yet): after this step, control returns to the
   * step with this id (round-trip / response-path modeling). Designed now so
   * adding return legs later is a non-breaking schema change.
   */
  returnTo?: string;
  /** Human label used in lint/violation messages. */
  label?: string;
}

export interface FlowSpec {
  /** Request kind this flow governs; replaces the hard-coded 'create' | 'read' union. */
  kind: string;
  /** Share of traffic, from TrafficProfile.requestTypes (weights normalized). */
  steps: FlowStep[];
}
```

Semantics:

- Steps are matched **in order**. The implicit step 0 is the source; the first
  step is normally an `ingress` selector.
- At each hop the engine routes to an outgoing belt whose target satisfies the
  **next non-optional step** (optional steps are taken when a satisfying belt
  exists and skipped otherwise).
- If the next required step has no satisfying healthy belt, the request
  terminates as **`violated`** with a generated reason, e.g.
  `create needed a durable store after "URL Shortener Service", but only Redis is connected`.
- `branch` is evaluated when the request is processed at the branching step's
  node. `onHit: 'complete'` models a cache hit; `onMiss` steps are appended to
  the remaining sequence — real miss-chaining
  (compute → cache → **database**), which the engine can do now that requests
  keep identity across hops.
- A request completes successfully only by reaching a `terminal: true` step or
  an `onHit: 'complete'` branch. Storage nodes no longer auto-complete
  anything that reaches them.

### 4.1 Tags

Scenarios may need to distinguish two components of the same type ("write
service" vs "read service", or "service A must call the DB before service B").
A scenario can define **tags** with selectors, and the user assigns tags to
placed components via the component config UI (same interaction family as
config chips). For the URL Shortener v1 we avoid needing tags by selecting on
capability only; tags ship with the authoring phase (Phase 5) unless a
scenario needs them sooner.

### 4.2 Fit with existing types

- `ScenarioDefinition` gains `flows?: FlowSpec[]` and
  `objectives?: Objectives` (§6).
- `RequestKind` (`src/game/types.ts`) widens from `'create' | 'read'` to
  `string`; spawn weights come from `TrafficProfile.requestTypes` instead of
  `readRatio`. (`readRatio` remains as a derived fallback for legacy data.)
- `Request` gains `flow: { kind: string; stepIndex: number; pending: FlowStep[] }`
  (the cursor; `pending` holds branch-injected steps).
- `RequestState` gains `'violated'`; `RequestEventKind` gains `'violated'`.
- `RuntimeScenario` / `setActiveScenarioFromChallenge`
  (`src/game/scenario-runtime.ts`) must carry `flows`, `objectives`, and
  `requestTypes` through to the engine instead of dropping them.

## 5. Engine changes (flow interpreter)

`completeOneRequest`'s type-specific branches (`backend`, `shortener`, generic
compute, storage auto-complete) are replaced by one interpreter:

1. Pop the oldest queued request; look up its next step (skipping satisfied
   optionals).
2. If the current node satisfies a `terminal` step → `finishRequest`
   (success).
3. Evaluate `branch` if present (RNG against resolved probability).
4. Otherwise find outgoing belts whose target satisfies the next step; pick
   among healthy, uncongested candidates (same belt-picking rules as today).
5. No satisfying belt for a **required** step → terminate as `violated`, log a
   `violated` event with a human-readable reason. Violations are counted per
   step id for the report ("93% of creates died because no durable store is
   reachable from X").

Legacy compatibility: today's heuristics are expressed as a **default
FlowSpec** (used when a challenge defines no flows), so the engine has exactly
one routing code path. The legacy default keeps redis acceptable as a
terminal so old behavior is preserved until a challenge opts into real flows.

Per-flow counters: `totalCompleted`/`totalDropped` become per-kind maps, plus
`totalViolated`. Telemetry and the report consume these.

### URL Shortener flows (first concrete spec)

```ts
flows: [
  { kind: 'create', steps: [
    { id: 'ingress',  require: { capability: 'ingress' } },
    { id: 'service',  require: { capability: 'compute' } },
    { id: 'persist',  require: { capability: 'durable-store' }, terminal: true },
    { id: 'warm',     require: { capability: 'cache' }, optional: true },  // write-through
  ]},
  { kind: 'read', steps: [
    { id: 'ingress',  require: { capability: 'ingress' } },
    { id: 'service',  require: { capability: 'compute' } },
    { id: 'cache',    require: { capability: 'cache' }, optional: true,
      branch: { probability: 'cacheHitRatio', onHit: 'complete',
                onMiss: [{ id: 'db-read', require: { capability: 'durable-store' }, terminal: true }] } },
    { id: 'db-direct', require: { capability: 'durable-store' }, terminal: true }, // no-cache path
  ]},
]
```

Teaching outcome: cache is optional-but-rewarded (absorbs load → survival),
database is mandatory (cache-only designs violate on every miss / every
create).

## 6. Objectives & scoring

```ts
export interface Objectives {
  /** Per request kind, minimum completed/spawned ratio, e.g. { create: 0.95, read: 0.95 }. */
  minCompletionRate?: Record<string, number>;
  /** Maximum violated/spawned ratio across all kinds (default 0). */
  maxViolationRate?: number;
  /** Existing survival rule; default true. */
  noComponentFailures?: boolean;
}
```

- End-of-run result = survival **and** all objectives met. Each failed
  objective produces a report line with the dominant cause (top violation step
  / top drop reason).
- `report.ts` rework: replace hard-coded `REQUIRED_COMPONENTS` and the
  legacy-type `meetsExcellence` checks with objective/flow-based scoring;
  start consuming `scoringPriorities`. Also fixes the latent crash where
  `report.ts` indexes `COMPONENT_DEFS` with non-legacy types
  (`microservice`, `backend-service` — the default starter board).

## 7. Design-time lint

New `src/game/flow-validator.ts`:

- For each FlowSpec, BFS over the product graph *(component, stepIndex)* from
  the source to check at least one satisfying path exists; report the first
  unsatisfiable step with the frontier components, e.g.
  *"Reads can reach Redis, but a cache miss has nowhere to go — connect a
  compute service to the Database."*
- Runs on Play (blocking is a UX choice: v1 shows warnings but lets the run
  proceed, since runtime violations now make the failure visible anyway).
- Surfaced in a lint panel in the sandbox; also reuse it to explain rejected
  connections (today `canConnect` fails silently). Longer term `canConnect`'s
  pair table is derived from capabilities.

## 8. Phasing (one PR each)

| PR | Phase | Scope |
|----|-------|-------|
| 0a | Spec | This document. |
| 0b | Tracing foundation | Land the in-flight request-tracing work (request identity, `events[]`, inspector, belt-geometry, pause/resume). Include the `report.ts` `COMPONENT_DEFS` crash fix so the report survives the default starter board. |
| 1 | Capability model + types | `capabilities.ts`, taxonomy adapter, `flow-types.ts`, URL Shortener FlowSpec as a TS constant, `ScenarioDefinition.flows/objectives` fields, runtime plumbing (`scenario-runtime.ts`, `api/client.ts` mapping consolidation). No engine behavior change. |
| 2 | Flow interpreter | Replace `completeOneRequest` heuristics with the interpreter; `violated` state/event; per-flow counters; generalized `RequestKind`; legacy default FlowSpec for challenges without flows; wire URL Shortener challenge to its flows. |
| 3 | Lint + UX | `flow-validator.ts`, lint panel, violation reasons in request inspector, toast for rejected connections. |
| 4 | Objectives + report | `Objectives` in win/lose, report rework (per-flow stats, objective lines, `scoringPriorities`), remove `REQUIRED_COMPONENTS` / `meetsExcellence` legacy checks. |
| 5 | Serialization + authoring | Flows/objectives/capabilities into backend `ScenarioConfig` (jsonb, no migration) and `ChallengeSeeder`; tags (§4.1); challenge-authoring endpoints/UI. Separate mini-spec before implementation. |

Each phase keeps the build green (`tsc && vite build`) and the existing
scenarios playable.

## 9. Out of scope (for now)

- Return-leg execution and visuals (`returnTo` is schema-only).
- Message-queue / async worker semantics (today messaging nodes dead-end;
  fixing that is a natural FlowSpec extension but a separate effort).
- Persisting user designs.
- Multiplayer/leaderboard implications of new scoring.

## 10. Risks & mitigations

- **Behavior change for existing players:** legacy default FlowSpec preserves
  current behavior until a challenge defines flows; only the URL Shortener
  opts in during Phase 2.
- **`isStorageType` semantics change** ripples through `canConnect`, presets,
  and routing — Phase 1 keeps the adapter bug-for-bug compatible; the
  tightening lands with the interpreter in Phase 2 where it's testable.
- **No test harness:** extend `scripts/sim-load-test.ts` into a headless
  flow-assertion harness (spawn N requests, assert per-kind
  completion/violation counts) as part of Phase 2.
