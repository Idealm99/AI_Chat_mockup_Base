import axios, { AxiosInstance } from 'axios';

export class OpenGenesApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://open-genes.com/api',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          // The request was made and the server responded with a status code
          // that falls out of the range of 2xx
          const errorMessage = error.response.data?.message || error.response.statusText;
          throw new Error(`API Error (${error.response.status}): ${errorMessage}`);
        } else if (error.request) {
          // The request was made but no response was received
          throw new Error('No response received from Open Genes API');
        } else {
          // Something happened in setting up the request that triggered an Error
          throw new Error(`Request setup error: ${error.message}`);
        }
      }
    );
  }

  async get<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    const response = await this.client.get<T>(endpoint, { params });
    return response.data;
  }
}

// Singleton instance
export const apiClient = new OpenGenesApiClient();
