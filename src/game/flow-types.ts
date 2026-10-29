import type { Capability } from './capabilities';

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
  /** Scenario-assigned role tag (reserved — ships with authoring, Phase 5). */
  tag?: string;
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
   * RESERVED (not interpreted yet): after this step, control returns to the
   * step with this id (round-trip / response-path modeling). Declared now so
   * adding return legs later is a non-breaking schema change.
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

/** Data-driven win conditions, evaluated at the end of a run (Phase 4). */
export interface Objectives {
  /** Per request kind, minimum completed/spawned ratio, e.g. { create: 0.95 }. */
  minCompletionRate?: Record<string, number>;
  /** Maximum violated/spawned ratio across all kinds (default 0). */
  maxViolationRate?: number;
  /** Existing survival rule; default true. */
  noComponentFailures?: boolean;
}
