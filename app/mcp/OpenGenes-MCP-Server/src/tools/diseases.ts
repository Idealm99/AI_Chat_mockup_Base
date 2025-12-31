import { apiClient } from '../utils/api-client.js';
import { Disease, DiseaseCategory, BaseParams } from '../types/api.js';

export class DiseaseTools {
  async getDiseases(params: BaseParams): Promise<Disease[]> {
    return await apiClient.get<Disease[]>('/disease', params);
  }

  async getDiseaseCategories(params: BaseParams): Promise<DiseaseCategory[]> {
    return await apiClient.get<DiseaseCategory[]>('/disease-category', params);
  }
}

export const diseaseTools = new DiseaseTools();
