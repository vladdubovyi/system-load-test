import type { Capability } from './capabilities';
import type { FailureScenario, TrafficPhase } from './scenario-types';

/**
 * Flow specifications — the declarative description of the path a request
 * kind must take through the user's design. See docs/specs/flow-correctness.md.
 * Phase 1 only defines the data model; the engine starts interpreting these
 * in Phase 2.
 */

/** Selects which components may satisfy a step. All given criteria must match. */
export interface NodeSelector {
  capability?: Capability;
  /** Exact component type, e.g. 'shortener'. */
  componentType?: string;
  /** Scenario-defined role the user assigned to the placed component (see TagDefinition). */
  tag?: string;
}

/**
 * A role a scenario lets the user assign to placed components, so a flow can
 * single out one component among several of the same type ("write service"
 * vs "read service"). See docs/specs/flow-authoring.md §2.3.
 */
export interface TagDefinition {
  /** Selector value, e.g. 'write-service'. */
  id: string;
  /** Chip and badge text, e.g. 'Write service'. */
  label: string;
  description?: string;
  /** Which component types may carry the tag; omitted means any. */
  appliesTo?: NodeSelector;
}

/** The authorable part of a scenario — what the scenario editor edits and the backend stores. */
export interface ScenarioDocument {
  requestTypes?: Record<string, number>;
  tags?: TagDefinition[];
  flows?: FlowSpec[];
  objectives?: Objectives;
  /** Scripted failure phases (product-directions.md §3.3). */
  failureScenarios?: FailureScenario[];
  /** Multi-phase traffic timeline (product-directions.md §3.4). */
  trafficPhases?: TrafficPhase[];
  /** Hint ladder, revealed one at a time on the report (product-directions.md §4.4). */
  hints?: ScenarioHint[];
}

/** One rung of a scenario's hint ladder; `after` says when it applies. */
export interface ScenarioHint {
  id: string;
  after: 'always' | 'loss' | 'violation';
  text: string;
}

export interface FlowBranch {
  /** Number in [0,1], or the name of a scenario traffic field, e.g. 'cacheHitRatio'. */
  probability: number | 'cacheHitRatio';
  /** 'complete' ends the request successfully; otherwise continue with these steps. */
  onHit: 'complete' | FlowStep[];
  onMiss: FlowStep[];
}

export interface FlowStep {
  /** Stable id for lint messages and telemetry; unique within a FlowSpec. */
  id: string;
  require: NodeSelector;
  /** Step may be skipped if no satisfying belt exists (e.g. optional cache). */
  optional?: boolean;
  /** Probabilistic branching at this node (cache hit/miss, A/B paths). */
  branch?: FlowBranch;
  /** Reaching (and being processed by) this step completes the request. */
  terminal?: boolean;
  /**
   * RPC semantics: after this step's node processes the request, the request
   * travels back to the component that satisfied the step with this id and
   * the flow resumes there. The return legs reuse the same belts in reverse —
   * no extra connection is required — with travel time charged normally and a
   * 'returned' event logged. The return journey is not rendered in v1.
   */
  returnTo?: string;
  /** Human label used in lint and violation messages. */
  label?: string;
}

export interface FlowSpec {
  /** Request kind this flow governs; spawn share comes from TrafficProfile.requestTypes. */
  kind: string;
  steps: FlowStep[];
}

/**
 * The engine's per-request flow cursor: where in its FlowSpec a live request
 * currently is. Attached to Request when the active scenario defines a flow
 * for the request's kind; requests without one use the legacy routing
 * heuristics.
 */
export interface RequestFlowState {
  kind: string;
  /** Number of steps satisfied so far (telemetry/debugging only). */
  stepIndex: number;
  /** Steps still ahead of the request, including branch-injected ones. */
  pending: FlowStep[];
  /** Component that satisfied each step id — lookup target for returnTo. */
  satisfiedBy: Record<string, string>;
  /** Forward hops taken, so return legs can retrace the same belts. */
  trail: { beltId: string; fromComponentId: string }[];
  /** Active reverse journey back to a returnTo caller (never rendered). */
  returnLeg: { belts: string[]; index: number; callerId: string } | null;
  /** True right after a return leg lands: route onward without re-matching. */
  resume: boolean;
}

/** Data-driven win conditions, evaluated at the end of a run (Phase 4). */
export interface Objectives {
  /** Per request kind, minimum completed/spawned ratio, e.g. { create: 0.95 }. */
  minCompletionRate?: Record<string, number>;
  /** Maximum violated/spawned ratio across all kinds (default 0). */
  maxViolationRate?: number;
  /** Existing survival rule; default true. */
  noComponentFailures?: boolean;
  /**
   * With scripted failure phases (product-directions.md §3.3): no component
   * other than the drill's target may fail while a phase is active. Default
   * true whenever the scenario has phases.
   */
  surviveScriptedFailures?: boolean;
}
