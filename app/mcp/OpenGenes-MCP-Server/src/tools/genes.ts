import { apiClient } from '../utils/api-client.js';
import {
  Gene,
  GeneSearchParams,
  ApiResponse,
  GeneByIdParams,
  GeneBySymbolParams,
  GeneSuggestionsParams,
  GeneByFunctionalClusterParams,
  GeneBySelectionCriteriaParams,
  GeneByGoTermParams,
  GeneByExpressionChangeParams,
  BaseParams,
} from '../types/api.js';

export class GeneTools {
  async searchGenes(params: GeneSearchParams): Promise<ApiResponse<Gene>> {
    return await apiClient.get<ApiResponse<Gene>>('/gene/search', params);
  }

  async getGeneById(params: GeneByIdParams): Promise<Gene> {
    const { id, ...queryParams } = params;
    return await apiClient.get<Gene>(`/gene/${id}`, queryParams);
  }

  async getGeneBySymbol(params: GeneBySymbolParams): Promise<Gene> {
    const { symbol, ...queryParams } = params;
    return await apiClient.get<Gene>(`/gene/${symbol}`, queryParams);
  }

  async getGeneByNcbiId(params: GeneByIdParams): Promise<Gene> {
    const { id, ...queryParams } = params;
    return await apiClient.get<Gene>(`/gene/{ncbi_id}`.replace('{ncbi_id}', id), queryParams);
  }

  async getGeneSuggestions(params: GeneSuggestionsParams): Promise<string[]> {
    return await apiClient.get<string[]>('/gene/suggestions', params);
  }

  async getGeneSymbols(params: BaseParams): Promise<string[]> {
    return await apiClient.get<string[]>('/gene/symbols', params);
  }

  async getLatestGenes(params: BaseParams): Promise<ApiResponse<Gene>> {
    return await apiClient.get<ApiResponse<Gene>>('/gene/by-latest', params);
  }

  async getGenesByFunctionalCluster(params: GeneByFunctionalClusterParams): Promise<ApiResponse<Gene>> {
    const { ids, ...queryParams } = params;
    return await apiClient.get<ApiResponse<Gene>>(`/gene/by-functional_cluster/${ids}`, queryParams);
  }

  async getGenesBySelectionCriteria(params: GeneBySelectionCriteriaParams): Promise<ApiResponse<Gene>> {
    const { ids, ...queryParams } = params;
    return await apiClient.get<ApiResponse<Gene>>(`/gene/by-selection-criteria/${ids}`, queryParams);
  }

  async getGenesByGoTerm(params: GeneByGoTermParams): Promise<ApiResponse<Gene>> {
    const { term, ...queryParams } = params;
    return await apiClient.get<ApiResponse<Gene>>(`/gene/by-go-term/${term}`, queryParams);
  }

  async getGenesByExpressionChange(params: GeneByExpressionChangeParams): Promise<ApiResponse<Gene>> {
    const { expressionChange, ...queryParams } = params;
    return await apiClient.get<ApiResponse<Gene>>(`/gene/by-expression-change/${expressionChange}`, queryParams);
  }

  async getGeneTaxon(params: BaseParams): Promise<any> {
    return await apiClient.get<any>('/gene/taxon', params);
  }

  async getGeneMethylation(params: BaseParams): Promise<ApiResponse<any>> {
    return await apiClient.get<ApiResponse<any>>('/gene/methylation', params);
  }

  async getGenesIncreaseLifespan(params: BaseParams): Promise<ApiResponse<Gene>> {
    return await apiClient.get<ApiResponse<Gene>>('/gene/increase-lifespan', params);
  }
}

export const geneTools = new GeneTools();
