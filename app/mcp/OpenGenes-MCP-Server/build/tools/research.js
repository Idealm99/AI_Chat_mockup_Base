import { apiClient } from '../utils/api-client.js';
export class ResearchTools {
    async getCalorieExperiments(params) {
        return await apiClient.get('/diet', params);
    }
    async getAgingMechanisms(params) {
        return await apiClient.get('/aging-mechanisms', params);
    }
}
export const researchTools = new ResearchTools();
