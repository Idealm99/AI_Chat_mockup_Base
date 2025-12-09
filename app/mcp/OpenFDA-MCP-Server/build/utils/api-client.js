/**
 * FDA API Client Utility
 *
 * This module provides HTTP client functionality for communicating with the FDA API,
 * including error handling, rate limiting awareness, and response formatting.
 */
import axios from 'axios';
// FDA API configuration
const FDA_API_BASE_URL = 'https://api.fda.gov';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
// Rate limiting constants
const REQUESTS_PER_MINUTE = 240; // With API key
const REQUESTS_PER_HOUR = 120000; // With API key
const REQUESTS_PER_MINUTE_NO_KEY = 40; // Without API key
const REQUESTS_PER_HOUR_NO_KEY = 1000; // Without API key
// API key from environment variable
const FDA_API_KEY = process.env.FDA_API_KEY || 'sNQRRzbOvngzuFVbiajF6AelXY7QncaX3OKN8YQD';
/**
 * FDA API Client class
 */
export class FDAAPIClient {
    axiosInstance;
    hasAPIKey;
    constructor() {
        this.hasAPIKey = !!FDA_API_KEY;
        this.axiosInstance = axios.create({
            baseURL: FDA_API_BASE_URL,
            timeout: 30000,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'FDA-MCP-Server/1.0.0',
            },
        });
        // Add response interceptor for error handling
        this.axiosInstance.interceptors.response.use((response) => response, (error) => this.handleAPIError(error));
    }
    /**
     * Makes a GET request to the FDA API
     */
    async get(endpoint, params = {}) {
        // Add API key if available
        const requestParams = { ...params };
        if (this.hasAPIKey) {
            requestParams.api_key = FDA_API_KEY;
        }
        // Ensure limit is within bounds
        if (requestParams.limit) {
            requestParams.limit = Math.min(requestParams.limit, MAX_LIMIT);
        }
        else {
            requestParams.limit = DEFAULT_LIMIT;
        }
        // Remove undefined parameters
        Object.keys(requestParams).forEach(key => {
            if (requestParams[key] === undefined || requestParams[key] === null) {
                delete requestParams[key];
            }
        });
        try {
            const response = await this.axiosInstance.get(endpoint, {
                params: requestParams
            });
            return response.data;
        }
        catch (error) {
            // Error is already handled by interceptor
            throw error;
        }
    }
    /**
     * Search drug adverse events
     */
    async searchDrugAdverseEvents(searchParams) {
        const params = this.buildSearchParams(searchParams);
        return this.get('/drug/event.json', params);
    }
    /**
     * Search drug labels
     */
    async searchDrugLabels(searchParams) {
        const params = this.buildSearchParams(searchParams);
        return this.get('/drug/label.json', params);
    }
    /**
     * Search drug NDC directory
     */
    async searchDrugNDC(searchParams) {
        const params = this.buildSearchParams(searchParams);
        return this.get('/drug/ndc.json', params);
    }
    /**
     * Search drug recalls
     */
    async searchDrugRecalls(searchParams) {
        const params = this.buildSearchParams(searchParams);
        return this.get('/drug/enforcement.json', params);
    }
    /**
     * Search Drugs@FDA
     */
    async searchDrugsFDA(searchParams) {
        const params = this.buildSearchParams(searchParams);
        return this.get('/drug/drugsfda.json', params);
    }
    /**
     * Search drug shortages
     */
    async searchDrugShortages(searchParams) {
        const params = this.buildSearchParams(searchParams);
        return this.get('/drug/drugshortages.json', params);
    }
    /**
     * Search device 510(k) clearances
     */
    async searchDevice510K(searchParams) {
        const params = this.buildSearchParams(searchParams);
        return this.get('/device/510k.json', params);
    }
    /**
     * Search device classifications
     */
    async searchDeviceClassifications(searchParams) {
        const params = this.buildSearchParams(searchParams);
        return this.get('/device/classification.json', params);
    }
    /**
     * Search device adverse events
     */
    async searchDeviceAdverseEvents(searchParams) {
        const params = this.buildSearchParams(searchParams);
        return this.get('/device/event.json', params);
    }
    /**
     * Search device recalls
     */
    async searchDeviceRecalls(searchParams) {
        const params = this.buildSearchParams(searchParams);
        return this.get('/device/enforcement.json', params);
    }
    /**
     * Search food adverse events
     */
    async searchFoodAdverseEvents(searchParams) {
        const params = this.buildSearchParams(searchParams);
        return this.get('/food/event.json', params);
    }
    /**
     * Search food recalls
     */
    async searchFoodRecalls(searchParams) {
        const params = this.buildSearchParams(searchParams);
        return this.get('/food/enforcement.json', params);
    }
    /**
     * Get API usage statistics
     */
    getUsageInfo() {
        return {
            hasAPIKey: this.hasAPIKey,
            rateLimits: {
                requestsPerMinute: this.hasAPIKey ? REQUESTS_PER_MINUTE : REQUESTS_PER_MINUTE_NO_KEY,
                requestsPerHour: this.hasAPIKey ? REQUESTS_PER_HOUR : REQUESTS_PER_HOUR_NO_KEY,
            },
            recommendations: this.hasAPIKey
                ? 'API key configured - higher rate limits available'
                : 'Consider setting FDA_API_KEY environment variable for higher rate limits'
        };
    }
    /**
     * Builds search parameters from user input
     */
    buildSearchParams(searchParams) {
        const params = {};
        // Handle search query
        if (searchParams.search) {
            params.search = searchParams.search;
        }
        // Handle count/grouping
        if (searchParams.count) {
            params.count = searchParams.count;
        }
        // Handle pagination
        if (searchParams.limit) {
            params.limit = Math.min(searchParams.limit, MAX_LIMIT);
        }
        if (searchParams.skip) {
            params.skip = searchParams.skip;
        }
        return params;
    }
    /**
     * Handles API errors and provides meaningful error messages
     */
    handleAPIError(error) {
        if (error.response) {
            const status = error.response.status;
            const data = error.response.data;
            switch (status) {
                case 400:
                    throw new Error(`Bad Request: ${data?.error?.message || 'Invalid search parameters'}`);
                case 404:
                    throw new Error('No results found for the given search criteria');
                case 429:
                    throw new Error(`Rate limit exceeded. ${this.hasAPIKey ? 'API key rate limits' : 'Consider using an API key for higher limits'}`);
                case 500:
                    throw new Error('FDA API server error. Please try again later');
                case 503:
                    throw new Error('FDA API service temporarily unavailable');
                default:
                    throw new Error(`FDA API error (${status}): ${data?.error?.message || error.message}`);
            }
        }
        else if (error.request) {
            throw new Error('Network error: Unable to connect to FDA API');
        }
        else {
            throw new Error(`Request error: ${error.message}`);
        }
    }
}
// Singleton instance
export const fdaAPIClient = new FDAAPIClient();
