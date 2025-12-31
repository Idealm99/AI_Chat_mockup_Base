import { apiClient } from '../utils/api-client.js';
export class GeneTools {
    async searchGenes(params) {
        return await apiClient.get('/gene/search', params);
    }
    async getGeneById(params) {
        const { id, ...queryParams } = params;
        return await apiClient.get(`/gene/${id}`, queryParams);
    }
    async getGeneBySymbol(params) {
        const { symbol, ...queryParams } = params;
        return await apiClient.get(`/gene/${symbol}`, queryParams);
    }
    async getGeneByNcbiId(params) {
        const { id, ...queryParams } = params;
        return await apiClient.get(`/gene/{ncbi_id}`.replace('{ncbi_id}', id), queryParams);
    }
    async getGeneSuggestions(params) {
        return await apiClient.get('/gene/suggestions', params);
    }
    async getGeneSymbols(params) {
        return await apiClient.get('/gene/symbols', params);
    }
    async getLatestGenes(params) {
        return await apiClient.get('/gene/by-latest', params);
    }
    async getGenesByFunctionalCluster(params) {
        const { ids, ...queryParams } = params;
        return await apiClient.get(`/gene/by-functional_cluster/${ids}`, queryParams);
    }
    async getGenesBySelectionCriteria(params) {
        const { ids, ...queryParams } = params;
        return await apiClient.get(`/gene/by-selection-criteria/${ids}`, queryParams);
    }
    async getGenesByGoTerm(params) {
        const { term, ...queryParams } = params;
        return await apiClient.get(`/gene/by-go-term/${term}`, queryParams);
    }
    async getGenesByExpressionChange(params) {
        const { expressionChange, ...queryParams } = params;
        return await apiClient.get(`/gene/by-expression-change/${expressionChange}`, queryParams);
    }
    async getGeneTaxon(params) {
        return await apiClient.get('/gene/taxon', params);
    }
    async getGeneMethylation(params) {
        return await apiClient.get('/gene/methylation', params);
    }
    async getGenesIncreaseLifespan(params) {
        return await apiClient.get('/gene/increase-lifespan', params);
    }
}
export const geneTools = new GeneTools();
