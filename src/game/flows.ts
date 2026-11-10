import { getCapabilities } from './capabilities';
import type { Capability } from './capabilities';
import { getComponentDef } from './component-catalog';
import type {
  FlowSpec,
  FlowStep,
  NodeSelector,
  Objectives,
  ScenarioDocument,
  TagDefinition,
} from './flow-types';
import { isCapability } from './capabilities';

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

/** What a selector is matched against: a bare type, or a placed component with its tags. */
export type SelectorTarget = string | { type: string; tags?: readonly string[] };

function targetType(target: SelectorTarget): string {
  return typeof target === 'string' ? target : target.type;
}

function targetTags(target: SelectorTarget): readonly string[] {
  return typeof target === 'string' ? [] : (target.tags ?? []);
}

/** Human label for a tag id, falling back to the id when the scenario does not define it. */
export function tagLabel(tagId: string, tags?: readonly TagDefinition[]): string {
  return tags?.find((tag) => tag.id === tagId)?.label ?? tagId;
}

export function describeSelector(selector: NodeSelector, tags?: readonly TagDefinition[]): string {
  if (selector.tag) return `a component tagged "${tagLabel(selector.tag, tags)}"`;
  if (selector.componentType) return `a ${getComponentDef(selector.componentType).label}`;
  if (selector.capability) return CAPABILITY_PHRASES[selector.capability];
  return 'a matching component';
}

/**
 * True when a component satisfies a selector. All given criteria must match:
 * the exact type, the capability, and the user-assigned tag.
 */
export function selectorMatches(selector: NodeSelector, target: SelectorTarget): boolean {
  if (
    selector.capability === undefined &&
    selector.componentType === undefined &&
    selector.tag === undefined
  ) {
    return false;
  }
  const type = targetType(target);
  if (selector.componentType !== undefined && selector.componentType !== type) {
    return false;
  }
  if (selector.capability !== undefined && !getCapabilities(type).has(selector.capability)) {
    return false;
  }
  if (selector.tag !== undefined && !targetTags(target).includes(selector.tag)) {
    return false;
  }
  return true;
}

/**
 * Index of the pending step a component satisfies, mirroring the engine's
 * cursor semantics: leading optional steps that do not match are skippable,
 * while a non-matching required step stops the scan.
 */
export function matchPendingStep(pending: readonly FlowStep[], target: SelectorTarget): number {
  for (let i = 0; i < pending.length; i++) {
    const step = pending[i];
    if (selectorMatches(step.require, target)) return i;
    if (!step.optional) return -1;
  }
  return -1;
}

/**
 * Deep-copy a JSON value dropping `null` members. System.Text.Json writes
 * unset members as null, and a `componentType: null` would otherwise be
 * treated as a criterion that can never match.
 */
export function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripNulls(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === null) continue;
      out[key] = stripNulls(item);
    }
    return out as T;
  }
  return value;
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

/**
 * Validate an authorable scenario document as a whole: the flows themselves,
 * plus the cross-references between request kinds, objectives and tags that
 * the engine would otherwise only surface at run time.
 */
const FAILURE_TYPES = new Set(['shutdown', 'latency', 'capacity', 'partition']);

/** Scripted failure phases (product-directions.md §3.3). */
export function validateFailureScenarios(phases: ScenarioDocument['failureScenarios']): string[] {
  if (phases === undefined) return [];
  if (!Array.isArray(phases)) return ['"failureScenarios" must be an array.'];
  const problems: string[] = [];
  const ids = new Set<string>();
  phases.forEach((phase, i) => {
    const where = `failureScenarios[${i}]`;
    if (!phase || typeof phase !== 'object') {
      problems.push(`${where} must be an object.`);
      return;
    }
    if (typeof phase.id !== 'string' || phase.id.length === 0) problems.push(`${where} needs an "id".`);
    else if (ids.has(phase.id)) problems.push(`${where}: duplicate id "${phase.id}".`);
    else ids.add(phase.id);
    if (typeof phase.label !== 'string' || phase.label.length === 0) problems.push(`${where} needs a "label".`);
    if (typeof phase.atSeconds !== 'number' || !(phase.atSeconds >= 0)) problems.push(`${where}.atSeconds must be a number ≥ 0.`);
    if (typeof phase.durationSeconds !== 'number' || !(phase.durationSeconds > 0)) problems.push(`${where}.durationSeconds must be a number > 0.`);
    if (!FAILURE_TYPES.has(phase.type as string)) problems.push(`${where}.type must be shutdown, latency, capacity or partition.`);
    const target = phase.target;
    if (!target || typeof target !== 'object' || (target.capability === undefined && target.componentType === undefined && target.tag === undefined)) {
      problems.push(`${where}.target needs a capability, componentType or tag.`);
    }
  });
  return problems;
}

/** Multi-phase traffic (product-directions.md §3.4). */
export function validateTrafficPhases(phases: ScenarioDocument['trafficPhases']): string[] {
  if (phases === undefined) return [];
  if (!Array.isArray(phases)) return ['"trafficPhases" must be an array.'];
  const problems: string[] = [];
  phases.forEach((phase, i) => {
    const where = `trafficPhases[${i}]`;
    if (!phase || typeof phase !== 'object') {
      problems.push(`${where} must be an object.`);
      return;
    }
    if (typeof phase.atSeconds !== 'number' || !(phase.atSeconds >= 0)) problems.push(`${where}.atSeconds must be a number ≥ 0.`);
    if (phase.baseRps !== undefined && (typeof phase.baseRps !== 'number' || !(phase.baseRps > 0))) {
      problems.push(`${where}.baseRps must be a number > 0.`);
    }
    for (const [kind, weight] of Object.entries(phase.requestTypes ?? {})) {
      if (typeof weight !== 'number' || !(weight >= 0)) problems.push(`${where}.requestTypes["${kind}"] must be a number ≥ 0.`);
    }
  });
  return problems;
}

export function validateScenarioDocument(doc: ScenarioDocument): string[] {
  const problems: string[] = [];
  const flows = doc.flows ?? [];
  const flowKinds = new Set(flows.map((f) => f.kind));

  if (doc.flows !== undefined && !Array.isArray(doc.flows)) {
    return ['"flows" must be an array of flow specs.'];
  }
  for (const flow of flows) {
    if (!flow || typeof flow !== 'object' || !Array.isArray((flow as FlowSpec).steps)) {
      return ['Every flow needs a "kind" and a "steps" array.'];
    }
  }

  problems.push(...validateFlows(flows));

  const requestTypes = doc.requestTypes ?? {};
  for (const [kind, weight] of Object.entries(requestTypes)) {
    if (typeof weight !== 'number' || weight < 0 || Number.isNaN(weight)) {
      problems.push(`Request kind "${kind}" has an invalid weight; expected a number ≥ 0.`);
    } else if (weight > 0 && flows.length > 0 && !flowKinds.has(kind)) {
      problems.push(`Request kind "${kind}" has no flow — add a flow with kind "${kind}" or remove it from requestTypes.`);
    }
  }

  const objectives: Objectives = doc.objectives ?? {};
  for (const [kind, rate] of Object.entries(objectives.minCompletionRate ?? {})) {
    if (typeof rate !== 'number' || rate < 0 || rate > 1) {
      problems.push(`Completion floor for "${kind}" must be a number in [0, 1].`);
    }
    if (!flowKinds.has(kind) && !(kind in requestTypes)) {
      problems.push(`Objective references request kind "${kind}", which has neither a flow nor traffic.`);
    }
  }
  problems.push(...validateFailureScenarios(doc.failureScenarios));
  problems.push(...validateTrafficPhases(doc.trafficPhases));

  if (
    objectives.maxViolationRate !== undefined &&
    (typeof objectives.maxViolationRate !== 'number' ||
      objectives.maxViolationRate < 0 ||
      objectives.maxViolationRate > 1)
  ) {
    problems.push('maxViolationRate must be a number in [0, 1].');
  }

  const tags = doc.tags ?? [];
  const tagIds = new Set<string>();
  for (const tag of tags) {
    if (!tag || typeof tag !== 'object' || typeof tag.id !== 'string' || !tag.id) {
      problems.push('Every tag needs a string "id".');
      continue;
    }
    if (tagIds.has(tag.id)) problems.push(`Duplicate tag id "${tag.id}".`);
    tagIds.add(tag.id);
    if (typeof tag.label !== 'string' || !tag.label) {
      problems.push(`Tag "${tag.id}" needs a "label".`);
    }
    if (tag.appliesTo?.capability !== undefined && !isCapability(tag.appliesTo.capability)) {
      problems.push(`Tag "${tag.id}" applies to unknown capability "${tag.appliesTo.capability}".`);
    }
  }
  for (const flow of flows) {
    for (const step of allSteps(flow)) {
      if (step.require?.tag !== undefined && !tagIds.has(step.require.tag)) {
        problems.push(
          `Flow "${flow.kind}" step "${step.id}" selects tag "${step.require.tag}", which the scenario does not define.`
        );
      }
      if (step.require?.capability !== undefined && !isCapability(step.require.capability)) {
        problems.push(
          `Flow "${flow.kind}" step "${step.id}" uses unknown capability "${step.require.capability}".`
        );
      }
    }
  }

  return problems;
}
