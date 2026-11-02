import { getCapabilities } from './capabilities';
import type { Capability } from './capabilities';
import { getComponentDef } from './component-catalog';
import type { FlowSpec, FlowStep, NodeSelector } from './flow-types';

/**
 * Runtime helpers over flow specs: selector matching (used by the Phase 2
 * interpreter and the Phase 3 lint) and structural validation of specs.
 */

/** Human phrasing for flow-violation and lint messages. */
export const CAPABILITY_PHRASES: Record<Capability, string> = {
  ingress: 'an ingress (load balancer or gateway)',
  'traffic-filter': 'a traffic filter',
  compute: 'a compute service',
  'durable-store': 'a durable store (database)',
  cache: 'a cache',
  queue: 'a message queue',
};

export function describeSelector(selector: NodeSelector): string {
  if (selector.componentType) return `a ${getComponentDef(selector.componentType).label}`;
  if (selector.capability) return CAPABILITY_PHRASES[selector.capability];
  if (selector.tag) return `a component tagged "${selector.tag}"`;
  return 'a matching component';
}

/** True when a component type satisfies a selector. All given criteria must match. */
export function selectorMatches(selector: NodeSelector, componentType: string): boolean {
  if (
    selector.capability === undefined &&
    selector.componentType === undefined &&
    selector.tag === undefined
  ) {
    return false;
  }
  if (selector.componentType !== undefined && selector.componentType !== componentType) {
    return false;
  }
  if (selector.capability !== undefined && !getCapabilities(componentType).has(selector.capability)) {
    return false;
  }
  // Tags ship with authoring (Phase 5); until then a tag criterion never matches.
  if (selector.tag !== undefined) {
    return false;
  }
  return true;
}

/**
 * Index of the pending step a component satisfies, mirroring the engine's
 * cursor semantics: leading optional steps that do not match are skippable,
 * while a non-matching required step stops the scan.
 */
export function matchPendingStep(pending: readonly FlowStep[], componentType: string): number {
  for (let i = 0; i < pending.length; i++) {
    const step = pending[i];
    if (selectorMatches(step.require, componentType)) return i;
    if (!step.optional) return -1;
  }
  return -1;
}

function collectSteps(steps: FlowStep[], out: FlowStep[]): void {
  for (const step of steps) {
    out.push(step);
    if (step.branch) {
      if (step.branch.onHit !== 'complete') collectSteps(step.branch.onHit, out);
      collectSteps(step.branch.onMiss, out);
    }
  }
}

/** Every step in a spec, including steps nested inside branches. */
export function allSteps(spec: FlowSpec): FlowStep[] {
  const out: FlowStep[] = [];
  collectSteps(spec.steps, out);
  return out;
}

function sequenceCanComplete(steps: FlowStep[]): boolean {
  return steps.some((step) => {
    if (step.terminal) return true;
    if (!step.branch) return false;
    const hitOk =
      step.branch.onHit === 'complete' || sequenceCanComplete(step.branch.onHit);
    return hitOk || sequenceCanComplete(step.branch.onMiss);
  });
}

/**
 * Structural validation of a single flow spec. Returns human-readable
 * problems; an empty array means the spec is well-formed.
 */
export function validateFlowSpec(spec: FlowSpec): string[] {
  const problems: string[] = [];
  const label = spec.kind || '(unnamed flow)';

  if (!spec.kind) problems.push('Flow is missing a request kind.');
  if (spec.steps.length === 0) {
    problems.push(`Flow "${label}" has no steps.`);
    return problems;
  }

  const steps = allSteps(spec);
  const ids = new Set<string>();
  for (const step of steps) {
    if (!step.id) {
      problems.push(`Flow "${label}" has a step without an id.`);
      continue;
    }
    if (ids.has(step.id)) {
      problems.push(`Flow "${label}" has a duplicate step id "${step.id}".`);
    }
    ids.add(step.id);
  }

  for (const step of steps) {
    const sel = step.require;
    if (
      sel.capability === undefined &&
      sel.componentType === undefined &&
      sel.tag === undefined
    ) {
      problems.push(
        `Flow "${label}" step "${step.id}" has an empty selector — set capability, componentType or tag.`
      );
    }
    if (step.terminal && step.optional) {
      problems.push(
        `Flow "${label}" step "${step.id}" is both terminal and optional — a completion point cannot be skippable.`
      );
    }
    if (step.branch) {
      const p = step.branch.probability;
      if (typeof p === 'number' && (p < 0 || p > 1 || Number.isNaN(p))) {
        problems.push(
          `Flow "${label}" step "${step.id}" has branch probability ${p}; expected a value in [0, 1].`
        );
      }
    }
    if (step.returnTo !== undefined && !ids.has(step.returnTo)) {
      problems.push(
        `Flow "${label}" step "${step.id}" returns to unknown step "${step.returnTo}".`
      );
    }
  }

  if (!sequenceCanComplete(spec.steps)) {
    problems.push(
      `Flow "${label}" can never complete — mark a step terminal or give a branch onHit: 'complete'.`
    );
  }

  // Top-level steps after the first unconditional terminal are unreachable
  // unless they are optional post-completion work (e.g. a write-through cache).
  const firstTerminal = spec.steps.findIndex((s) => s.terminal);
  if (firstTerminal >= 0) {
    for (const step of spec.steps.slice(firstTerminal + 1)) {
      if (!step.optional) {
        problems.push(
          `Flow "${label}" step "${step.id}" follows terminal step "${spec.steps[firstTerminal].id}" but is not optional.`
        );
      }
    }
  }

  return problems;
}

/** Validate a set of flows together (per-spec checks plus unique kinds). */
export function validateFlows(specs: FlowSpec[]): string[] {
  const problems = specs.flatMap(validateFlowSpec);
  const kinds = new Set<string>();
  for (const spec of specs) {
    if (spec.kind && kinds.has(spec.kind)) {
      problems.push(`Multiple flows declare the request kind "${spec.kind}".`);
    }
    kinds.add(spec.kind);
  }
  return problems;
}
