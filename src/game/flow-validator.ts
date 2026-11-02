import type { ConveyorBelt, PlacedComponent } from './types';
import type { FlowSpec, FlowStep } from './flow-types';
import { describeSelector, matchPendingStep, selectorMatches, validateFlows } from './flows';
import { SOURCE_ID } from './simulation';

/**
 * Design-time flow lint (docs/specs/flow-correctness.md §7): a static walk of
 * the board against each flow spec, using the same step-matching and routing
 * rules as the engine's interpreter. Every reachable dead end is reported,
 * because the engine routes uniformly over satisfying belts — a dead-end
 * branch of the design will receive real traffic and violate at run time.
 *
 * The walk explores (component, remaining steps) states breadth-first from
 * every component wired to the source (the engine spawns onto all of them).
 * Branch arms (cache hit and miss) are both followed; a route choice follows
 * every satisfying belt. `returnTo` legs resume at the caller without checking
 * reachability, exactly like the engine (they reuse the forward belts).
 */

export interface FlowLintIssue {
  /** Request kind of the flow that gets stuck; null for board-level problems. */
  kind: string | null;
  /** Step that cannot be satisfied, when one is identifiable. */
  stepId: string | null;
  /** Components where the flow gets stuck (the lint frontier). */
  componentIds: string[];
  message: string;
}

function componentOfPort(portId: string): string {
  return portId.split(':')[0];
}

interface BoardGraph {
  componentById: Map<string, PlacedComponent>;
  /** Distinct forward targets per component id. */
  targets: Map<string, PlacedComponent[]>;
  /** Targets of the belts out of the source; the engine spawns onto all of them. */
  entries: PlacedComponent[];
}

function buildGraph(components: PlacedComponent[], belts: ConveyorBelt[]): BoardGraph {
  const componentById = new Map(components.map((c) => [c.id, c]));
  const targets = new Map<string, PlacedComponent[]>();
  const entries: PlacedComponent[] = [];

  for (const belt of belts) {
    const fromId = componentOfPort(belt.fromPortId);
    const target = componentById.get(componentOfPort(belt.toPortId));
    if (!target) continue;
    if (fromId === SOURCE_ID) {
      if (!entries.some((t) => t.id === target.id)) entries.push(target);
      continue;
    }
    const list = targets.get(fromId) ?? [];
    if (!list.some((t) => t.id === target.id)) list.push(target);
    targets.set(fromId, list);
  }

  return { componentById, targets, entries };
}

function connectedPhrase(graph: BoardGraph, component: PlacedComponent): string {
  const labels = (graph.targets.get(component.id) ?? []).map((t) => t.label);
  if (labels.length === 0) return 'nothing is connected';
  return `only ${labels.join(', ')} ${labels.length > 1 ? 'are' : 'is'} connected`;
}

interface LintState {
  component: PlacedComponent;
  pending: FlowStep[];
  /** Component that satisfied each step id, for resolving returnTo legs. */
  satisfiedBy: Record<string, string>;
}

function lintFlow(spec: FlowSpec, graph: BoardGraph): FlowLintIssue[] {
  const issues = new Map<string, FlowLintIssue>();
  const visited = new Set<string>();
  const queue: LintState[] = [];
  const hasReturnTo = (steps: FlowStep[]): boolean =>
    steps.some(
      (s) =>
        s.returnTo !== undefined ||
        (s.branch !== undefined &&
          ((s.branch.onHit !== 'complete' && hasReturnTo(s.branch.onHit)) ||
            hasReturnTo(s.branch.onMiss)))
    );
  const trackCallers = hasReturnTo(spec.steps);

  const record = (key: string, issue: Omit<FlowLintIssue, 'kind'>): void => {
    if (!issues.has(key)) issues.set(key, { kind: spec.kind, ...issue });
  };

  const enqueue = (state: LintState): void => {
    const callerKey = trackCallers
      ? Object.entries(state.satisfiedBy)
          .map(([step, comp]) => `${step}=${comp}`)
          .sort()
          .join(',')
      : '';
    const key = `${state.component.id}|${state.pending.map((s) => s.id).join('>')}|${callerKey}`;
    if (visited.has(key)) return;
    visited.add(key);
    queue.push(state);
  };

  /** Mirror of the engine's pickFlowRoute: route `pending` out of `component`. */
  const route = (
    component: PlacedComponent,
    pending: FlowStep[],
    satisfiedBy: Record<string, string>
  ): void => {
    for (const step of pending) {
      const matching = (graph.targets.get(component.id) ?? []).filter((t) =>
        selectorMatches(step.require, t.type)
      );
      if (matching.length > 0) {
        for (const target of matching) {
          enqueue({ component: target, pending, satisfiedBy });
        }
        return;
      }
      if (!step.optional) {
        record(`stuck:${step.id}:${component.id}`, {
          stepId: step.id,
          componentIds: [component.id],
          message: `${spec.kind} requests need ${describeSelector(step.require)} after "${component.label}", but ${connectedPhrase(graph, component)}.`,
        });
        return;
      }
    }
    // Ran out of steps without completing: validateFlowSpec flags the spec
    // itself, but a reachable instance of it is still worth pointing at.
    record(`end:${component.id}`, {
      stepId: null,
      componentIds: [component.id],
      message: `${spec.kind} requests run out of flow steps at "${component.label}" without completing.`,
    });
  };

  for (const entry of graph.entries) {
    enqueue({ component: entry, pending: [...spec.steps], satisfiedBy: {} });
  }

  while (queue.length > 0) {
    const { component, pending, satisfiedBy } = queue.shift()!;

    const idx = matchPendingStep(pending, component.type);
    if (idx === -1) {
      const next = pending.find((s) => !s.optional) ?? pending[0] ?? null;
      record(`arrive:${next?.id ?? 'end'}:${component.id}`, {
        stepId: next?.id ?? null,
        componentIds: [component.id],
        message: next
          ? `${spec.kind} requests need ${describeSelector(next.require)} but arrive at "${component.label}" instead.`
          : `${spec.kind} requests arrive at "${component.label}" after their flow has ended.`,
      });
      continue;
    }

    const step = pending[idx];
    const remainder = pending.slice(idx + 1);
    const nextSatisfied = trackCallers
      ? { ...satisfiedBy, [step.id]: component.id }
      : satisfiedBy;

    const arms: FlowStep[][] = [];
    if (step.branch) {
      if (step.branch.onHit !== 'complete') {
        arms.push([...step.branch.onHit, ...remainder]);
      }
      arms.push([...step.branch.onMiss, ...remainder]);
    } else if (step.terminal) {
      continue; // the flow completes here
    } else {
      arms.push(remainder);
    }

    for (const arm of arms) {
      if (step.returnTo) {
        // The return leg retraces forward belts, so it never fails on
        // reachability (spec §5); the flow resumes routing at the caller.
        const caller = graph.componentById.get(nextSatisfied[step.returnTo] ?? '');
        if (caller) route(caller, arm, nextSatisfied);
        continue;
      }
      route(component, arm, nextSatisfied);
    }
  }

  return [...issues.values()];
}

/**
 * Lint the board against the scenario's flow specs. Returns an empty array
 * when the scenario has no flows (legacy challenges are never linted).
 */
export function lintBoard(
  flows: FlowSpec[],
  components: PlacedComponent[],
  belts: ConveyorBelt[]
): FlowLintIssue[] {
  if (flows.length === 0) return [];

  const issues: FlowLintIssue[] = validateFlows(flows).map((message) => ({
    kind: null,
    stepId: null,
    componentIds: [],
    message,
  }));

  const graph = buildGraph(components, belts);
  if (graph.entries.length === 0) {
    issues.push({
      kind: null,
      stepId: null,
      componentIds: [],
      message:
        'Nothing is connected to Incoming Requests — wire the source to a load balancer or API gateway.',
    });
    return issues;
  }

  for (const spec of flows) {
    issues.push(...lintFlow(spec, graph));
  }
  return issues;
}
