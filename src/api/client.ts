import type { Challenge, ComponentDefinition } from '../game/scenario-types';

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || import.meta.env.VITE_API_URL || 'http://localhost:5000';
  }

  async getChallenges(): Promise<Challenge[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/challenges`);
      if (!response.ok) {
        throw new Error(`Failed to fetch challenges: ${response.statusText}`);
      }
      const data = await response.json();
      
      // Transform backend response to frontend format
      return data.map((item: any) => ({
        id: item.id,
        name: item.name,
        slug: item.slug,
        description: item.description,
        difficulty: item.difficulty,
        createdAt: item.createdAt,
        allowedComponents: item.allowedComponents || [],
        scenario: {
          id: item.scenario.id,
          title: item.name,
          description: item.description,
          duration: item.scenario.durationSeconds,
          drainDuration: item.scenario.scenarioConfig?.drainDuration || 10,
          requirements: item.scenario.scenarioConfig?.requirements || [],
          traffic: {
            baseRps: item.scenario.baseRps,
            spikeMultiplier: item.scenario.spikeMultiplier,
            spikeChance: item.scenario.spikeChance,
            pattern: item.scenario.scenarioConfig?.pattern || 'constant',
            requestTypes: item.scenario.scenarioConfig?.requestTypes,
            characteristics: item.scenario.scenarioConfig?.characteristics,
          },
          allowedComponents: item.allowedComponents || [],
          scoringPriorities: item.scenario.scoringWeights || {},
        },
      }));
    } catch (error) {
      console.error('Error fetching challenges:', error);
      throw error;
    }
  }

  async getChallenge(id: string): Promise<Challenge> {
    try {
      const response = await fetch(`${this.baseUrl}/api/challenges/${id}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch challenge: ${response.statusText}`);
      }
      const item = await response.json();
      
      return {
        id: item.id,
        name: item.name,
        slug: item.slug,
        description: item.description,
        difficulty: item.difficulty,
        createdAt: item.createdAt,
        allowedComponents: item.allowedComponents || [],
        scenario: {
          id: item.scenario.id,
          title: item.name,
          description: item.description,
          duration: item.scenario.durationSeconds,
          drainDuration: item.scenario.scenarioConfig?.drainDuration || 10,
          requirements: item.scenario.scenarioConfig?.requirements || [],
          traffic: {
            baseRps: item.scenario.baseRps,
            spikeMultiplier: item.scenario.spikeMultiplier,
            spikeChance: item.scenario.spikeChance,
            pattern: item.scenario.scenarioConfig?.pattern || 'constant',
            requestTypes: item.scenario.scenarioConfig?.requestTypes,
            characteristics: item.scenario.scenarioConfig?.characteristics,
          },
          allowedComponents: item.allowedComponents || [],
          scoringPriorities: item.scenario.scoringWeights || {},
        },
      };
    } catch (error) {
      console.error('Error fetching challenge:', error);
      throw error;
    }
  }

  async getChallengeBySlug(slug: string): Promise<Challenge> {
    try {
      const response = await fetch(`${this.baseUrl}/api/challenges/slug/${slug}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch challenge: ${response.statusText}`);
      }
      const item = await response.json();
      
      return {
        id: item.id,
        name: item.name,
        slug: item.slug,
        description: item.description,
        difficulty: item.difficulty,
        createdAt: item.createdAt,
        allowedComponents: item.allowedComponents || [],
        scenario: {
          id: item.scenario.id,
          title: item.name,
          description: item.description,
          duration: item.scenario.durationSeconds,
          drainDuration: item.scenario.scenarioConfig?.drainDuration || 10,
          requirements: item.scenario.scenarioConfig?.requirements || [],
          traffic: {
            baseRps: item.scenario.baseRps,
            spikeMultiplier: item.scenario.spikeMultiplier,
            spikeChance: item.scenario.spikeChance,
            pattern: item.scenario.scenarioConfig?.pattern || 'constant',
            requestTypes: item.scenario.scenarioConfig?.requestTypes,
            characteristics: item.scenario.scenarioConfig?.characteristics,
          },
          allowedComponents: item.allowedComponents || [],
          scoringPriorities: item.scenario.scoringWeights || {},
        },
      };
    } catch (error) {
      console.error('Error fetching challenge by slug:', error);
      throw error;
    }
  }

  async getComponentDefinitions(): Promise<ComponentDefinition[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/components`);
      if (!response.ok) {
        throw new Error(`Failed to fetch components: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching components:', error);
      throw error;
    }
  }

  async getComponentByType(type: string): Promise<ComponentDefinition> {
    try {
      const response = await fetch(`${this.baseUrl}/api/components/${type}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch component: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching component:', error);
      throw error;
    }
  }
}

// Singleton instance
export const apiClient = new ApiClient();
