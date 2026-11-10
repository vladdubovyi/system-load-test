import type { NodeSelector, ScenarioHint } from './flow-types';

/**
 * Concept cards (docs/specs/product-directions.md §4.4): a short, hand-written
 * explanation attached to a stable rule id. Lint issues carry the id of the
 * rule they tripped; violations carry the id of the step they could not
 * satisfy; drops, failures and slow paths have fixed ids. Cards paraphrase
 * flows, so in interview mode they are shown to the host only.
 */

export interface ConceptCard {
  id: string;
  title: string;
  body: string;
}

const CARDS: Record<string, ConceptCard> = {
  'missing:durable-store': {
    id: 'missing:durable-store',
    title: 'A cache is not a durable store',
    body: 'Caches hold copies of data that already lives somewhere else; they can be evicted, restarted or simply miss. A write that ends in a cache was never persisted, so flows that create or change data require a durable store — a database, document store or object storage — reachable from the component that handles the write.',
  },
  'missing:cache': {
    id: 'missing:cache',
    title: 'Caches are optional until they are not',
    body: 'A cache step is usually optional: reads work without it, just slower and heavier on the store behind it. When a flow does require one, it is because the scenario expects hot data to be served from memory; the store alone would not meet the latency or capacity the requirements describe.',
  },
  'missing:queue': {
    id: 'missing:queue',
    title: 'Buffers are a contract',
    body: 'A queue between a producer and a consumer absorbs bursts and lets the two scale separately. When a flow requires a queue, skipping it means the API talks to the worker directly — every burst reaches the worker at full force, and the pipeline cannot be drained later. The buffer is part of the design, not an optimization.',
  },
  'missing:compute': {
    id: 'missing:compute',
    title: 'Every request needs a worker',
    body: 'Only compute components — services, workers, functions — execute business logic. A request that reaches a database or a queue without having passed through compute has skipped the step that decides what to do with it, so the flow calls it a violation rather than letting the store guess.',
  },
  'missing:ingress': {
    id: 'missing:ingress',
    title: 'Traffic enters through a front door',
    body: 'Load balancers and gateways are the only components the outside world may reach. They spread traffic, hide topology changes and give scaling somewhere to attach. A flow whose first step is ingress refuses requests that arrive at a service directly.',
  },
  'missing:traffic-filter': {
    id: 'missing:traffic-filter',
    title: 'Admission control before capacity',
    body: 'A rate limiter decides which requests are allowed in before any capacity is spent on them. Scenarios that require a traffic filter model abusive or retrying callers: without the limiter, every storm reaches the API, and no amount of scaling behind it is a substitute for turning excess traffic away at the edge.',
  },
  'missing-type:database': {
    id: 'missing-type:database',
    title: 'This step needs the relational database',
    body: 'Some writes need transactions and row locks — reservations, ledgers, counters that must not drift. The flow asks for the relational database specifically because a cache or a document store would accept the write and silently lose the guarantee the scenario is about.',
  },
  'missing-type:search-service': {
    id: 'missing-type:search-service',
    title: 'This step needs the search index',
    body: 'Autocomplete and full-text queries are answered by an index, not by a general-purpose database. The flow routes suggestions and index updates to the search service because that is where the data structure that makes them fast lives.',
  },
  'missing-type:object-storage': {
    id: 'missing-type:object-storage',
    title: 'This step needs object storage',
    body: 'Large blobs belong in object storage, which is built for durability and throughput on big payloads; a relational database would choke on them. The flow separates the blob path from the metadata path on purpose.',
  },
  'missing-type:generic': {
    id: 'missing-type:generic',
    title: 'This step needs a specific component',
    body: 'The flow names a component type rather than a capability because the scenario depends on a property only that component has. Add it and wire it in where the request currently gets stuck.',
  },
  'missing-tag': {
    id: 'missing-tag',
    title: 'Roles single out one component',
    body: 'When several components of the same type exist, the scenario uses roles (tags) to say which one a step means — a write service versus a read service. Assign the role on the component that should take the step; the flow cannot guess.',
  },
  'no-flow': {
    id: 'no-flow',
    title: 'Traffic without a flow',
    body: 'Every request kind in the traffic mix needs a flow that says where it goes. Without one the engine has no path to route along, so each request of that kind is violated on arrival. Add a flow for the kind in the scenario editor, or remove the kind from the mix.',
  },
  'flow-ended': {
    id: 'flow-ended',
    title: 'Flows must end on a terminal step',
    body: 'A request completes only when it reaches a step marked terminal. If the flow runs out of steps before that, or a request arrives somewhere after its flow has ended, the engine cannot count it as done — it is a violation of the spec, not of the design.',
  },
  'invalid-flow': {
    id: 'invalid-flow',
    title: 'A flow spec must be well-formed',
    body: 'Each flow needs a kind and ordered steps with unique ids, at least one of them terminal, and selectors that name a capability, a component type or a role. The validator reports what is missing; fix the document before judging the board against it.',
  },
  'no-entry': {
    id: 'no-entry',
    title: 'Nothing is wired to incoming requests',
    body: 'Requests spawn onto whatever the source is connected to. With nothing connected they are dropped before they exist. Connect the source to a load balancer or an API gateway — the ingress step every flow starts with.',
  },
  'drop:queue-full': {
    id: 'drop:queue-full',
    title: 'Drops are queue overflow',
    body: 'Each component has a queue of bounded depth. When a request arrives and the queue is full, the sender drops it. Sustained drops mean the component processes fewer requests per second than it receives: give it more capacity, add instances, or shed load earlier with a limiter or a buffer.',
  },
  'inflight:slow': {
    id: 'inflight:slow',
    title: 'Slow is a failure mode too',
    body: 'Requests still queued or traveling when the run ends were neither completed nor dropped. The path works, but queues were deep enough that work spilled past the finish line. Shorter queues drain faster; more capacity drains them at all.',
  },
  'failure:overload': {
    id: 'failure:overload',
    title: 'Why a component fails',
    body: 'A component fails when its queue stays full while it cannot process anything for about two seconds — the moment load stops being a backlog and becomes an outage. Everything that depends on it then drops what it sends. Redundancy and headroom are the two ways out.',
  },
  'scripted:collateral': {
    id: 'scripted:collateral',
    title: 'Drills test everything but the target',
    body: 'A scripted drill degrades its target on schedule; the target itself is down by script, not by design. What the objective judges is whether the components around it survive the extra load the drill pushes onto them.',
  },
};

export function conceptFor(ruleId: string | null | undefined): ConceptCard | null {
  if (!ruleId) return null;
  return CARDS[ruleId] ?? (ruleId.startsWith('missing-type:') ? CARDS['missing-type:generic'] : null);
}

/** The rule a step's selector trips when nothing satisfies it. */
export function ruleIdForSelector(selector: NodeSelector | null | undefined): string {
  if (!selector) return 'flow-ended';
  if (selector.tag) return 'missing-tag';
  if (selector.componentType) return `missing-type:${selector.componentType}`;
  if (selector.capability) return `missing:${selector.capability}`;
  return 'invalid-flow';
}

export function conceptForViolation(selector: NodeSelector | null | undefined): ConceptCard | null {
  return conceptFor(ruleIdForSelector(selector));
}

/** The rungs of a hint ladder that apply to a finished run. */
export function applicableHints(
  hints: readonly ScenarioHint[] | undefined,
  run: { lost: boolean; violated: boolean }
): ScenarioHint[] {
  if (!hints) return [];
  return hints.filter(
    (hint) =>
      hint.after === 'always' || (hint.after === 'loss' && run.lost) || (hint.after === 'violation' && run.violated)
  );
}
