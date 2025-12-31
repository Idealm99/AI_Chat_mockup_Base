import { apiClient } from '../utils/api-client.js';
import { ProteinClass, BaseParams } from '../types/api.js';

export class ProteinTools {
  async getProteinClasses(params: BaseParams): Promise<ProteinClass[]> {
    return await apiClient.get<ProteinClass[]>('/protein-class', params);
  }
}

export const proteinTools = new ProteinTools();
