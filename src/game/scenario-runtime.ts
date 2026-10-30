import type { Challenge, TrafficProfile } from './scenario-types';
import type { FlowSpec, Objectives } from './flow-types';
import { getPresetFlows, getPresetObjectives } from './flow-presets';
import { SCENARIO } from './types';

export interface RuntimeScenario {
  id: string;
  slug: string;
  title: string;
  description: string;
  duration: number;
  drainDuration: number;
  requirements: string[];
  baseRps: number;
  spikeMultiplier: number;
  spikeChance: number;
  readRatio: number;
  celebrityShare: number;
  cacheHitRatio: number;
  /** Spawn weights per request kind (normalized by the engine). */
  requestTypes: Record<string, number>;
  /** Required request flows; undefined means legacy routing (Phase 2 default). */
  flows?: FlowSpec[];
  /** Data-driven win conditions evaluated at the end of a run (Phase 4). */
  objectives?: Objectives;
}

const DEFAULT_SCENARIO: RuntimeScenario = {
  id: SCENARIO.id,
  slug: 'url-shortener',
  title: SCENARIO.title,
  description: 'Design a high-traffic URL shortening service',
  duration: SCENARIO.duration,
  drainDuration: SCENARIO.drainDuration,
  requirements: [...SCENARIO.requirements],
  baseRps: SCENARIO.baseRps,
  spikeMultiplier: SCENARIO.spikeMultiplier,
  spikeChance: SCENARIO.spikeChance,
  readRatio: SCENARIO.readRatio,
  celebrityShare: SCENARIO.celebrityShare,
  cacheHitRatio: SCENARIO.cacheHitRatio,
  requestTypes: { read: SCENARIO.readRatio, create: 1 - SCENARIO.readRatio },
  flows: getPresetFlows('url-shortener'),
  objectives: getPresetObjectives('url-shortener'),
};

let activeScenario: RuntimeScenario = { ...DEFAULT_SCENARIO };
let activeChallenge: Challenge | null = null;
/** User edits from the Traffic panel, layered over the challenge's own profile. */
let trafficOverride: TrafficProfile | null = null;

export function getActiveScenario(): RuntimeScenario {
  return activeScenario;
}

/** Select a challenge. Any Traffic-panel override from a previous challenge is discarded. */
export function setActiveScenarioFromChallenge(challenge: Challenge | null): void {
  activeChallenge = challenge;
  trafficOverride = null;
  rebuildActiveScenario();
}

/**
 * Apply (or, with `null`, clear) a custom traffic profile on top of the active
 * challenge. The engine reads `getActiveScenario()` when a run starts, so this
 * is what makes the Traffic panel's "Apply" actually change the next run.
 */
export function setActiveTrafficOverride(traffic: TrafficProfile | null): void {
  trafficOverride = traffic;
  rebuildActiveScenario();
}

export function getActiveTrafficOverride(): TrafficProfile | null {
  return trafficOverride;
}

function rebuildActiveScenario(): void {
  const base = activeChallenge
    ? buildScenarioFromChallenge(activeChallenge)
    : { ...DEFAULT_SCENARIO };
  activeScenario = trafficOverride ? applyTrafficOverride(base, trafficOverride) : base;
}

function applyTrafficOverride(base: RuntimeScenario, traffic: TrafficProfile): RuntimeScenario {
  const hasRequestTypes =
    traffic.requestTypes !== undefined && Object.keys(traffic.requestTypes).length > 0;
  const readRatio =
    typeof traffic.requestTypes?.read === 'number' ? traffic.requestTypes.read : base.readRatio;

  return {
    ...base,
    baseRps: traffic.baseRps,
    spikeMultiplier: traffic.spikeMultiplier ?? base.spikeMultiplier,
    spikeChance: traffic.spikeChance ?? base.spikeChance,
    readRatio,
    requestTypes: hasRequestTypes ? { ...traffic.requestTypes } : base.requestTypes,
  };
}

function buildScenarioFromChallenge(challenge: Challenge): RuntimeScenario {
  const traffic = challenge.scenario.traffic;
  const characteristics = traffic.characteristics ?? {};

  const readRatio =
    typeof traffic.requestTypes?.read === 'number'
      ? traffic.requestTypes.read
      : challenge.slug === 'url-shortener'
        ? 0.72
        : challenge.slug === 'instagram-feed'
          ? 0.95
          : DEFAULT_SCENARIO.readRatio;

  return {
    id: challenge.id,
    slug: challenge.slug,
    title: challenge.name,
    description: challenge.description || challenge.scenario.description,
    duration: challenge.scenario.duration,
    drainDuration: challenge.scenario.drainDuration,
    requirements: challenge.scenario.requirements.length
      ? [...challenge.scenario.requirements]
      : [...DEFAULT_SCENARIO.requirements],
    baseRps: traffic.baseRps,
    spikeMultiplier: traffic.spikeMultiplier ?? DEFAULT_SCENARIO.spikeMultiplier,
    spikeChance: traffic.spikeChance ?? DEFAULT_SCENARIO.spikeChance,
    readRatio,
    requestTypes:
      traffic.requestTypes && Object.keys(traffic.requestTypes).length > 0
        ? { ...traffic.requestTypes }
        : { read: readRatio, create: 1 - readRatio },
    flows: challenge.scenario.flows ?? getPresetFlows(challenge.slug),
    objectives: challenge.scenario.objectives ?? getPresetObjectives(challenge.slug),
    celebrityShare:
      typeof characteristics.celebrityShare === 'number'
        ? characteristics.celebrityShare
        : challenge.slug === 'url-shortener'
          ? 0.82
          : 0.2,
    cacheHitRatio:
      typeof characteristics.hotDataRatio === 'number'
        ? Math.min(0.99, characteristics.hotDataRatio)
        : challenge.slug === 'url-shortener'
          ? 0.97
          : 0.85,
  };
}
