import type { Challenge, ComponentDefinition } from '../game/scenario-types';
import { stripNulls } from '../game/flows';

/**
 * Transform a backend challenge payload into the frontend Challenge shape.
 * Exported for tests.
 */
export function mapChallengeFromApi(item: any): Challenge {
  const config = item.scenario.scenarioConfig ?? {};
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    description: item.description,
    difficulty: item.difficulty,
    createdAt: item.createdAt,
    allowedComponents: item.allowedComponents || [],
    overviewContent: item.overviewContent,
    videoUrl: item.videoUrl,
    scenario: {
      id: item.scenario.id,
      title: item.name,
      description: item.description,
      duration: item.scenario.durationSeconds,
      drainDuration: config.drainDuration || 10,
      requirements: config.requirements || [],
      traffic: {
        baseRps: item.scenario.baseRps,
        spikeMultiplier: item.scenario.spikeMultiplier,
        spikeChance: item.scenario.spikeChance,
        pattern: config.pattern || 'constant',
        requestTypes: config.requestTypes,
        characteristics: config.characteristics,
        phases: config.trafficPhases == null ? undefined : stripNulls(config.trafficPhases),
      },
      allowedComponents: item.allowedComponents || [],
      scoringPriorities: item.scenario.scoringWeights || {},
      // Authored data (docs/specs/flow-authoring.md §2.1): System.Text.Json
      // writes unset members as null, which selectors must not see.
      flows: config.flows == null ? undefined : stripNulls(config.flows),
      objectives: config.objectives == null ? undefined : stripNulls(config.objectives),
      tags: config.tags == null ? undefined : stripNulls(config.tags),
      failureScenarios: config.failureScenarios == null ? undefined : stripNulls(config.failureScenarios),
      hints: config.hints == null ? undefined : stripNulls(config.hints),
    },
  };
}

/** Where the ASP.NET API lives; the room hub (`/hubs/room`) is on the same host. */
export function apiBaseUrl(): string {
  return import.meta.env.VITE_API_URL || 'http://localhost:5000';
}

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || apiBaseUrl();
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers || {});
    if (!headers.has('Content-Type') && init.body) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      let message = response.statusText;
      try {
        const payload = await response.json();
        message = payload.error || payload.title || message;
      } catch {
        // ignore parse errors
      }
      throw new Error(message || 'Request failed');
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  async getChallenges(): Promise<Challenge[]> {
    try {
      const data = await this.request<any[]>('/api/challenges');

      // Transform backend response to frontend format
      return data.map(mapChallengeFromApi);
    } catch (error) {
      console.error('Error fetching challenges:', error);
      throw error;
    }
  }

  async getChallenge(id: string): Promise<Challenge> {
    try {
      const item = await this.request<any>(`/api/challenges/${id}`);

      return mapChallengeFromApi(item);
    } catch (error) {
      console.error('Error fetching challenge:', error);
      throw error;
    }
  }

  async getChallengeBySlug(slug: string): Promise<Challenge> {
    try {
      const item = await this.request<any>(`/api/challenges/slug/${slug}`);

      return mapChallengeFromApi(item);
    } catch (error) {
      console.error('Error fetching challenge by slug:', error);
      throw error;
    }
  }

  async getComponentDefinitions(): Promise<ComponentDefinition[]> {
    try {
      return await this.request<ComponentDefinition[]>('/api/components');
    } catch (error) {
      console.error('Error fetching components:', error);
      throw error;
    }
  }

  async getComponentByType(type: string): Promise<ComponentDefinition> {
    try {
      return await this.request<ComponentDefinition>(`/api/components/${type}`);
    } catch (error) {
      console.error('Error fetching component:', error);
      throw error;
    }
  }
}

// Singleton instance
export const apiClient = new ApiClient();
