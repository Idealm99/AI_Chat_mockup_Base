import { apiClient } from '../utils/api-client.js';
export class DiseaseTools {
    async getDiseases(params) {
        return await apiClient.get('/disease', params);
    }
    async getDiseaseCategories(params) {
        return await apiClient.get('/disease-category', params);
    }
}
export const diseaseTools = new DiseaseTools();
