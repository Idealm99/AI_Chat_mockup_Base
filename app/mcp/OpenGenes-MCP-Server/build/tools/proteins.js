import { apiClient } from '../utils/api-client.js';
export class ProteinTools {
    async getProteinClasses(params) {
        return await apiClient.get('/protein-class', params);
    }
}
export const proteinTools = new ProteinTools();
