import { apiClient } from '../utils/api-client.js';
import { CalorieExperiment, AgingMechanism, BaseParams, ApiResponse } from '../types/api.js';

export class ResearchTools {
  async getCalorieExperiments(params: BaseParams): Promise<ApiResponse<CalorieExperiment>> {
    return await apiClient.get<ApiResponse<CalorieExperiment>>('/diet', params);
  }

  async getAgingMechanisms(params: BaseParams): Promise<AgingMechanism[]> {
    return await apiClient.get<AgingMechanism[]>('/aging-mechanisms', params);
  }
}

export const researchTools = new ResearchTools();
