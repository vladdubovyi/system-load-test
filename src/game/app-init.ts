import { apiClient } from '../api/client';
import { componentRegistry } from './component-registry';
import { getPresetFlows, getPresetObjectives } from './flow-presets';
import type { Challenge, ComponentDefinition } from './scenario-types';

export interface AppInitResult {
  challenges: Challenge[];
  components: ComponentDefinition[];
  selectedChallenge: Challenge | null;
}

/**
 * Initialize the application by loading challenges and components from backend
 * Falls back to legacy data if backend is unavailable
 */
export async function initializeApp(challengeSlug?: string): Promise<AppInitResult> {
  let challenges: Challenge[] = [];
  let components: ComponentDefinition[] = [];
  let selectedChallenge: Challenge | null = null;

  try {
    // Try to load from backend
    console.log('Loading challenges and components from backend...');
    
    [challenges, components] = await Promise.all([
      apiClient.getChallenges(),
      apiClient.getComponentDefinitions(),
    ]);

    console.log(`Loaded ${challenges.length} challenges and ${components.length} components from backend`);

    // Initialize component registry with backend data
    await componentRegistry.initialize(components);

    // Default to requested slug, then URL Shortener, then first available
    selectedChallenge =
      (challengeSlug ? challenges.find(c => c.slug === challengeSlug) : null) ||
      challenges.find(c => c.slug === 'url-shortener') ||
      challenges[0] ||
      null;

  } catch (error) {
    console.warn('Failed to load from backend, using legacy data:', error);
    
    // Fallback to legacy hardcoded data
    await componentRegistry.initialize(); // Will use COMPONENT_DEFS
    
    // Create legacy URL Shortener challenge
    selectedChallenge = createLegacyUrlShortenerChallenge();
    challenges = [selectedChallenge];
  }

  return {
    challenges,
    components,
    selectedChallenge,
  };
}

/**
 * Create a legacy URL Shortener challenge from hardcoded SCENARIO
 */
function createLegacyUrlShortenerChallenge(): Challenge {
  return {
    id: 'legacy-url-shortener',
    name: 'URL Shortener',
    slug: 'url-shortener',
    description: 'Design a high-traffic URL shortening service like bit.ly',
    difficulty: 'medium',
    createdAt: new Date().toISOString(),
    allowedComponents: ['load-balancer', 'shortener', 'backend', 'database', 'redis'],
    scenario: {
      id: 'legacy-scenario',
      title: 'Design a URL Shortener',
      description: 'Design a high-traffic URL shortening service',
      requirements: [
        'Very high sustained load — millions of redirects per day',
        'Traffic spikes during viral events (celebrity links)',
        'Mixed request types: creates (shorten) and reads (redirect)',
        'Colored requests = different original URLs — a few go viral',
        'Goal: keep every component healthy for the full simulation'
      ],
      duration: 45,
      drainDuration: 10,
      traffic: {
        baseRps: 200,
        spikeMultiplier: 3.2,
        spikeChance: 0.08,
        pattern: 'spike',
        requestTypes: { read: 0.72, create: 0.28 },
        characteristics: { celebrityShare: 0.82 },
      },
      allowedComponents: ['load-balancer', 'shortener', 'backend', 'database', 'redis'],
      scoringPriorities: {
        availability: 40,
        latency: 30,
        scalability: 20,
        cost: 10,
      },
      flows: getPresetFlows('url-shortener'),
      objectives: getPresetObjectives('url-shortener'),
    },
  };
}
