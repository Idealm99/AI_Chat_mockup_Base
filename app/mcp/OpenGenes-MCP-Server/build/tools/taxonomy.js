import { apiClient } from '../utils/api-client.js';
export class TaxonomyTools {
    async getModelOrganisms(params) {
        return await apiClient.get('/model-organism', params);
    }
    async getPhylums(params) {
        return await apiClient.get('/phylum', params);
    }
}
export const taxonomyTools = new TaxonomyTools();
