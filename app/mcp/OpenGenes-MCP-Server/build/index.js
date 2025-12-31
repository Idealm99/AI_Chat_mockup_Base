#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, } from '@modelcontextprotocol/sdk/types.js';
import { geneTools } from './tools/genes.js';
import { taxonomyTools } from './tools/taxonomy.js';
import { proteinTools } from './tools/proteins.js';
import { diseaseTools } from './tools/diseases.js';
import { researchTools } from './tools/research.js';
class OpenGenesServer {
    server;
    constructor() {
        this.server = new Server({
            name: 'open-genes-server',
            version: '0.1.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupToolHandlers();
        // Error handling
        this.server.onerror = (error) => console.error('[MCP Error]', error);
        process.on('SIGINT', async () => {
            await this.server.close();
            process.exit(0);
        });
    }
    setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                // Gene search tools
                {
                    name: 'search_genes',
                    description: 'Search for genes with multiple filter parameters',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                            page: { type: 'number', description: 'Page number (default: 1)' },
                            pageSize: { type: 'number', description: 'Page size (default: 20)' },
                            sortOrder: { type: 'string', enum: ['ASC', 'DESC'], description: 'Sort order' },
                            sortBy: { type: 'string', description: 'Field to sort by' },
                            byDiseases: { type: 'string', description: 'Filter by diseases' },
                            byDiseaseCategories: { type: 'string', description: 'Filter by disease categories' },
                            byAgeRelatedProcess: { type: 'string', description: 'Filter by age-related process' },
                            byExpressionChange: { type: 'string', description: 'Filter by expression change' },
                            bySelectionCriteria: { type: 'string', description: 'Filter by selection criteria' },
                            byAgingMechanism: { type: 'string', description: 'Filter by aging mechanism' },
                            byProteinClass: { type: 'string', description: 'Filter by protein class' },
                            bySpecies: { type: 'string', description: 'Filter by species' },
                            byOrigin: { type: 'string', description: 'Filter by origin' },
                            byGeneSymbol: { type: 'string', description: 'Filter by gene symbol' },
                            confidenceLevel: { type: 'string', description: 'Filter by confidence level' },
                        },
                    },
                },
                {
                    name: 'get_gene_by_id',
                    description: 'Get a specific gene by its ID',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: 'Gene ID' },
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                        },
                        required: ['id'],
                    },
                },
                {
                    name: 'get_gene_by_symbol',
                    description: 'Get a gene by its symbol',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            symbol: { type: 'string', description: 'Gene symbol' },
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                        },
                        required: ['symbol'],
                    },
                },
                {
                    name: 'get_gene_by_ncbi_id',
                    description: 'Get a gene by its NCBI ID',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: 'NCBI ID' },
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                        },
                        required: ['id'],
                    },
                },
                {
                    name: 'get_gene_suggestions',
                    description: 'Get gene name suggestions',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                        },
                    },
                },
                {
                    name: 'get_gene_symbols',
                    description: 'Get all gene symbols',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                        },
                    },
                },
                {
                    name: 'get_latest_genes',
                    description: 'Get recently added genes',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                            page: { type: 'number', description: 'Page number (default: 1)' },
                            pageSize: { type: 'number', description: 'Page size (default: 20)' },
                        },
                    },
                },
                {
                    name: 'get_genes_by_functional_cluster',
                    description: 'Get genes by functional cluster IDs',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            ids: { type: 'string', description: 'Comma-separated functional cluster IDs' },
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                            page: { type: 'number', description: 'Page number (default: 1)' },
                            pageSize: { type: 'number', description: 'Page size (default: 20)' },
                        },
                        required: ['ids'],
                    },
                },
                {
                    name: 'get_genes_by_selection_criteria',
                    description: 'Get genes by selection criteria IDs',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            ids: { type: 'string', description: 'Comma-separated selection criteria IDs' },
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                            page: { type: 'number', description: 'Page number (default: 1)' },
                            pageSize: { type: 'number', description: 'Page size (default: 20)' },
                        },
                        required: ['ids'],
                    },
                },
                {
                    name: 'get_genes_by_go_term',
                    description: 'Get genes by GO term',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            term: { type: 'string', description: 'GO term' },
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                            page: { type: 'number', description: 'Page number (default: 1)' },
                            pageSize: { type: 'number', description: 'Page size (default: 20)' },
                        },
                        required: ['term'],
                    },
                },
                {
                    name: 'get_genes_by_expression_change',
                    description: 'Get genes by expression change',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            expressionChange: { type: 'string', description: 'Expression change value' },
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                            page: { type: 'number', description: 'Page number (default: 1)' },
                            pageSize: { type: 'number', description: 'Page size (default: 20)' },
                        },
                        required: ['expressionChange'],
                    },
                },
                {
                    name: 'get_gene_taxon',
                    description: 'Get gene taxon information',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                        },
                    },
                },
                {
                    name: 'get_genes_increase_lifespan',
                    description: 'Get genes that increase lifespan',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                            page: { type: 'number', description: 'Page number (default: 1)' },
                            pageSize: { type: 'number', description: 'Page size (default: 20)' },
                        },
                    },
                },
                // Taxonomy tools
                {
                    name: 'get_model_organisms',
                    description: 'Get list of model organisms',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                        },
                    },
                },
                {
                    name: 'get_phylums',
                    description: 'Get list of phylums',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                        },
                    },
                },
                // Protein tools
                {
                    name: 'get_protein_classes',
                    description: 'Get protein class information',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                        },
                    },
                },
                // Disease tools
                {
                    name: 'get_diseases',
                    description: 'Get disease list',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                        },
                    },
                },
                {
                    name: 'get_disease_categories',
                    description: 'Get disease category list',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                        },
                    },
                },
                // Research tools
                {
                    name: 'get_calorie_experiments',
                    description: 'Search calorie restriction experiments',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                            page: { type: 'number', description: 'Page number (default: 1)' },
                            pageSize: { type: 'number', description: 'Page size (default: 20)' },
                        },
                    },
                },
                {
                    name: 'get_aging_mechanisms',
                    description: 'Get aging mechanisms',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            lang: { type: 'string', enum: ['en', 'ru'], description: 'Language (default: en)' },
                        },
                    },
                },
            ],
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                const { name, arguments: args } = request.params;
                switch (name) {
                    // Gene tools
                    case 'search_genes':
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await geneTools.searchGenes(args || {}), null, 2),
                                },
                            ],
                        };
                    case 'get_gene_by_id':
                        if (!args || !args.id) {
                            throw new McpError(ErrorCode.InvalidParams, 'Missing required parameter: id');
                        }
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await geneTools.getGeneById(args), null, 2),
                                },
                            ],
                        };
                    case 'get_gene_by_symbol':
                        if (!args || !args.symbol) {
                            throw new McpError(ErrorCode.InvalidParams, 'Missing required parameter: symbol');
                        }
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await geneTools.getGeneBySymbol(args), null, 2),
                                },
                            ],
                        };
                    case 'get_gene_by_ncbi_id':
                        if (!args || !args.id) {
                            throw new McpError(ErrorCode.InvalidParams, 'Missing required parameter: id');
                        }
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await geneTools.getGeneByNcbiId(args), null, 2),
                                },
                            ],
                        };
                    case 'get_gene_suggestions':
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await geneTools.getGeneSuggestions(args || {}), null, 2),
                                },
                            ],
                        };
                    case 'get_gene_symbols':
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await geneTools.getGeneSymbols(args || {}), null, 2),
                                },
                            ],
                        };
                    case 'get_latest_genes':
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await geneTools.getLatestGenes(args || {}), null, 2),
                                },
                            ],
                        };
                    case 'get_genes_by_functional_cluster':
                        if (!args || !args.ids) {
                            throw new McpError(ErrorCode.InvalidParams, 'Missing required parameter: ids');
                        }
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await geneTools.getGenesByFunctionalCluster(args), null, 2),
                                },
                            ],
                        };
                    case 'get_genes_by_selection_criteria':
                        if (!args || !args.ids) {
                            throw new McpError(ErrorCode.InvalidParams, 'Missing required parameter: ids');
                        }
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await geneTools.getGenesBySelectionCriteria(args), null, 2),
                                },
                            ],
                        };
                    case 'get_genes_by_go_term':
                        if (!args || !args.term) {
                            throw new McpError(ErrorCode.InvalidParams, 'Missing required parameter: term');
                        }
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await geneTools.getGenesByGoTerm(args), null, 2),
                                },
                            ],
                        };
                    case 'get_genes_by_expression_change':
                        if (!args || !args.expressionChange) {
                            throw new McpError(ErrorCode.InvalidParams, 'Missing required parameter: expressionChange');
                        }
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await geneTools.getGenesByExpressionChange(args), null, 2),
                                },
                            ],
                        };
                    case 'get_gene_taxon':
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await geneTools.getGeneTaxon(args || {}), null, 2),
                                },
                            ],
                        };
                    case 'get_genes_increase_lifespan':
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await geneTools.getGenesIncreaseLifespan(args || {}), null, 2),
                                },
                            ],
                        };
                    // Taxonomy tools
                    case 'get_model_organisms':
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await taxonomyTools.getModelOrganisms(args || {}), null, 2),
                                },
                            ],
                        };
                    case 'get_phylums':
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await taxonomyTools.getPhylums(args || {}), null, 2),
                                },
                            ],
                        };
                    // Protein tools
                    case 'get_protein_classes':
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await proteinTools.getProteinClasses(args || {}), null, 2),
                                },
                            ],
                        };
                    // Disease tools
                    case 'get_diseases':
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await diseaseTools.getDiseases(args || {}), null, 2),
                                },
                            ],
                        };
                    case 'get_disease_categories':
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await diseaseTools.getDiseaseCategories(args || {}), null, 2),
                                },
                            ],
                        };
                    // Research tools
                    case 'get_calorie_experiments':
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await researchTools.getCalorieExperiments(args || {}), null, 2),
                                },
                            ],
                        };
                    case 'get_aging_mechanisms':
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(await researchTools.getAgingMechanisms(args || {}), null, 2),
                                },
                            ],
                        };
                    default:
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
                }
            }
            catch (error) {
                if (error instanceof McpError) {
                    throw error;
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('Open Genes MCP server running on stdio');
    }
}
const server = new OpenGenesServer();
server.run().catch(console.error);
