import { apiClient } from '../utils/api-client.js';
import { ModelOrganism, Phylum, BaseParams } from '../types/api.js';

export class TaxonomyTools {
  async getModelOrganisms(params: BaseParams): Promise<ModelOrganism[]> {
    return await apiClient.get<ModelOrganism[]>('/model-organism', params);
  }

  async getPhylums(params: BaseParams): Promise<Phylum[]> {
    return await apiClient.get<Phylum[]>('/phylum', params);
  }
}

export const taxonomyTools = new TaxonomyTools();
