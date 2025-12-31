#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance } from 'axios';

// NCBI Datasets API interfaces
interface NCBIGenomeInfo {
  accession: string;
  organism: {
    tax_id: number;
    organism_name: string;
    common_name?: string;
  };
  assembly_info: {
    assembly_name: string;
    assembly_level: string;
    assembly_type: string;
    submission_date: string;
    submitter: string;
  };
  assembly_stats: {
    total_sequence_length: number;
    total_ungapped_length: number;
    number_of_contigs: number;
    number_of_scaffolds: number;
    scaffold_n50: number;
    contig_n50: number;
  };
  annotation_info?: {
    name: string;
    source: string;
    release_date: string;
    stats: {
      gene_counts: {
        total: number;
        protein_coding: number;
        non_coding: number;
      };
    };
  };
}

interface NCBIGeneInfo {
  gene_id: number;
  symbol: string;
  description: string;
  gene_type: string;
  organism: {
    tax_id: number;
    organism_name: string;
  };
  genomic_locations: Array<{
    accession_version: string;
    assembly_name: string;
    chromosome: string;
    start: number;
    end: number;
    strand: string;
  }>;
  nomenclature_authority?: {
    authority: string;
    identifier: string;
  };
  synonyms?: string[];
}

interface NCBITaxonomyInfo {
  tax_id: number;
  organism_name: string;
  common_name?: string;
  rank: string;
  division: string;
  lineage: string[];
  parent_tax_id?: number;
  children_tax_ids?: number[];
}

interface NCBIAssemblyInfo {
  assembly_accession: string;
  assembly_name: string;
  organism: {
    tax_id: number;
    organism_name: string;
    common_name?: string;
  };
  assembly_level: string;
  assembly_type: string;
  submission_date: string;
  submitter: string;
  assembly_stats: {
    total_sequence_length: number;
    total_ungapped_length: number;
    number_of_contigs: number;
    number_of_scaffolds: number;
    scaffold_n50: number;
    contig_n50: number;
    gc_percent: number;
  };
  checkm_info?: {
    completeness: number;
    contamination: number;
    strain_heterogeneity: number;
  };
}

interface NCBISearchResult {
  total_count: number;
  page_token?: string;
  assemblies?: NCBIAssemblyInfo[];
  genes?: NCBIGeneInfo[];
  genomes?: NCBIGenomeInfo[];
  taxonomy?: NCBITaxonomyInfo[];
}

// Type guards and validation functions
const isValidSearchArgs = (
  args: any
): args is {
  query?: string;
  organism?: string;
  tax_id?: number;
  assembly_level?: string;
  assembly_source?: string;
  max_results?: number;
  page_token?: string;
  exclude_atypical?: boolean;
} => {
  return (
    typeof args === 'object' &&
    args !== null &&
    (args.query === undefined || typeof args.query === 'string') &&
    (args.organism === undefined || typeof args.organism === 'string') &&
    (args.tax_id === undefined || typeof args.tax_id === 'number') &&
    (args.assembly_level === undefined || ['complete', 'chromosome', 'scaffold', 'contig'].includes(args.assembly_level)) &&
    (args.assembly_source === undefined || ['refseq', 'genbank', 'all'].includes(args.assembly_source)) &&
    (args.max_results === undefined || (typeof args.max_results === 'number' && args.max_results > 0 && args.max_results <= 1000)) &&
    (args.page_token === undefined || typeof args.page_token === 'string') &&
    (args.exclude_atypical === undefined || typeof args.exclude_atypical === 'boolean')
  );
};

const isValidGeneSearchArgs = (
  args: any
): args is {
  gene_symbol?: string;
  gene_id?: number;
  organism?: string;
  tax_id?: number;
  chromosome?: string;
  max_results?: number;
  page_token?: string;
} => {
  return (
    typeof args === 'object' &&
    args !== null &&
    (args.gene_symbol === undefined || typeof args.gene_symbol === 'string') &&
    (args.gene_id === undefined || typeof args.gene_id === 'number') &&
    (args.organism === undefined || typeof args.organism === 'string') &&
    (args.tax_id === undefined || typeof args.tax_id === 'number') &&
    (args.chromosome === undefined || typeof args.chromosome === 'string') &&
    (args.max_results === undefined || (typeof args.max_results === 'number' && args.max_results > 0 && args.max_results <= 1000)) &&
    (args.page_token === undefined || typeof args.page_token === 'string')
  );
};

const isValidInfoArgs = (
  args: any
): args is {
  accession?: string;
  gene_id?: number;
  tax_id?: number;
  assembly_accession?: string;
  include_annotation?: boolean;
  include_sequences?: boolean;
} => {
  return (
    typeof args === 'object' &&
    args !== null &&
    (args.accession === undefined || typeof args.accession === 'string') &&
    (args.gene_id === undefined || typeof args.gene_id === 'number') &&
    (args.tax_id === undefined || typeof args.tax_id === 'number') &&
    (args.assembly_accession === undefined || typeof args.assembly_accession === 'string') &&
    (args.include_annotation === undefined || typeof args.include_annotation === 'boolean') &&
    (args.include_sequences === undefined || typeof args.include_sequences === 'boolean')
  );
};

class NCBIDatasetsServer {
  private server: Server;
  private apiClient: AxiosInstance;
  private baseUrl: string;
  private apiKey?: string;

  constructor() {
    this.server = new Server(
      {
        name: 'ncbi-datasets-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    // Configuration from environment variables
    this.baseUrl = process.env.NCBI_BASE_URL || 'https://api.ncbi.nlm.nih.gov/datasets/v2alpha';
    this.apiKey = process.env.NCBI_API_KEY;
    const timeout = parseInt(process.env.NCBI_TIMEOUT || '30000');

    // Initialize NCBI Datasets API client
    this.apiClient = axios.create({
      baseURL: this.baseUrl,
      timeout: timeout,
      headers: {
        'User-Agent': 'NCBI-Datasets-MCP-Server/1.0.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(this.apiKey && { 'api-key': this.apiKey }),
      },
    });

    this.setupResourceHandlers();
    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error: any) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupResourceHandlers() {
    // List available resource templates
    this.server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      async () => ({
        resourceTemplates: [
          {
            uriTemplate: 'ncbi://genome/{accession}',
            name: 'NCBI genome assembly information',
            mimeType: 'application/json',
            description: 'Complete genome assembly information including statistics and annotation',
          },
          {
            uriTemplate: 'ncbi://gene/{gene_id}',
            name: 'NCBI gene information',
            mimeType: 'application/json',
            description: 'Gene information including genomic locations and functional annotations',
          },
          {
            uriTemplate: 'ncbi://taxonomy/{tax_id}',
            name: 'NCBI taxonomic information',
            mimeType: 'application/json',
            description: 'Taxonomic classification and lineage information',
          },
          {
            uriTemplate: 'ncbi://assembly/{assembly_accession}',
            name: 'NCBI assembly metadata',
            mimeType: 'application/json',
            description: 'Assembly metadata, statistics, and quality metrics',
          },
          {
            uriTemplate: 'ncbi://search/{data_type}/{query}',
            name: 'NCBI search results',
            mimeType: 'application/json',
            description: 'Search results for the specified data type and query',
          },
        ],
      })
    );

    // Handle resource requests
    this.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request: any) => {
        const uri = request.params.uri;

        // Handle genome requests
        const genomeMatch = uri.match(/^ncbi:\/\/genome\/(.+)$/);
        if (genomeMatch) {
          const accession = genomeMatch[1];
          try {
            const response = await this.apiClient.get(`/genome/accession/${accession}`);
            return {
              contents: [
                {
                  uri: request.params.uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(response.data, null, 2),
                },
              ],
            };
          } catch (error) {
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to fetch genome ${accession}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }

        // Handle gene requests
        const geneMatch = uri.match(/^ncbi:\/\/gene\/(.+)$/);
        if (geneMatch) {
          const geneId = geneMatch[1];
          try {
            const response = await this.apiClient.get(`/gene/id/${geneId}`);
            return {
              contents: [
                {
                  uri: request.params.uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(response.data, null, 2),
                },
              ],
            };
          } catch (error) {
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to fetch gene ${geneId}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }

        // Handle taxonomy requests
        const taxonomyMatch = uri.match(/^ncbi:\/\/taxonomy\/(.+)$/);
        if (taxonomyMatch) {
          const taxId = taxonomyMatch[1];
          try {
            const response = await this.apiClient.get(`/taxonomy/taxon/${taxId}`);
            return {
              contents: [
                {
                  uri: request.params.uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(response.data, null, 2),
                },
              ],
            };
          } catch (error) {
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to fetch taxonomy ${taxId}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }

        // Handle assembly requests
        const assemblyMatch = uri.match(/^ncbi:\/\/assembly\/(.+)$/);
        if (assemblyMatch) {
          const assemblyAccession = assemblyMatch[1];
          try {
            const response = await this.apiClient.get(`/assembly/accession/${assemblyAccession}`);
            return {
              contents: [
                {
                  uri: request.params.uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(response.data, null, 2),
                },
              ],
            };
          } catch (error) {
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to fetch assembly ${assemblyAccession}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }

        // Handle search requests
        const searchMatch = uri.match(/^ncbi:\/\/search\/([^\/]+)\/(.+)$/);
        if (searchMatch) {
          const dataType = searchMatch[1];
          const query = decodeURIComponent(searchMatch[2]);
          try {
            const response = await this.apiClient.get(`/${dataType}/search`, {
              params: { q: query, limit: 50 }
            });
            return {
              contents: [
                {
                  uri: request.params.uri,
                  mimeType: 'application/json',
                  text: JSON.stringify({ search_results: response.data, query, data_type: dataType }, null, 2),
                },
              ],
            };
          } catch (error) {
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to search ${dataType} for ${query}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }

        throw new McpError(
          ErrorCode.InvalidRequest,
          `Invalid URI format: ${uri}`
        );
      }
    );
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // Genome Operations
        {
          name: 'search_genomes',
          description: 'Search genome assemblies by organism, keywords, or assembly criteria',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query (organism name, keywords, or assembly name)' },
              organism: { type: 'string', description: 'Organism name to filter results' },
              tax_id: { type: 'number', description: 'NCBI taxonomy ID to filter results' },
              assembly_level: { type: 'string', enum: ['complete', 'chromosome', 'scaffold', 'contig'], description: 'Assembly level filter' },
              assembly_source: { type: 'string', enum: ['refseq', 'genbank', 'all'], description: 'Assembly source filter (default: all)' },
              max_results: { type: 'number', description: 'Maximum number of results (1-1000, default: 50)', minimum: 1, maximum: 1000 },
              page_token: { type: 'string', description: 'Page token for pagination' },
            },
            required: [],
          },
        },
        {
          name: 'get_genome_info',
          description: 'Get detailed information for a specific genome assembly',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'Genome assembly accession (e.g., GCF_000001405.40)' },
              include_annotation: { type: 'boolean', description: 'Include annotation information (default: true)' },
            },
            required: ['accession'],
          },
        },
        {
          name: 'get_genome_summary',
          description: 'Get summary statistics for a genome assembly',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'Genome assembly accession (e.g., GCF_000001405.40)' },
            },
            required: ['accession'],
          },
        },

        // Gene Operations
        {
          name: 'search_genes',
          description: 'Search genes by symbol, name, organism, or genomic location',
          inputSchema: {
            type: 'object',
            properties: {
              gene_symbol: { type: 'string', description: 'Gene symbol (e.g., BRCA1, TP53)' },
              gene_id: { type: 'number', description: 'NCBI Gene ID' },
              organism: { type: 'string', description: 'Organism name to filter results' },
              tax_id: { type: 'number', description: 'NCBI taxonomy ID to filter results' },
              chromosome: { type: 'string', description: 'Chromosome name to filter results' },
              max_results: { type: 'number', description: 'Maximum number of results (1-1000, default: 50)', minimum: 1, maximum: 1000 },
              page_token: { type: 'string', description: 'Page token for pagination' },
            },
            required: [],
          },
        },
        {
          name: 'get_gene_info',
          description: 'Get detailed information for a specific gene',
          inputSchema: {
            type: 'object',
            properties: {
              gene_id: { type: 'number', description: 'NCBI Gene ID' },
              gene_symbol: { type: 'string', description: 'Gene symbol (alternative to gene_id)' },
              organism: { type: 'string', description: 'Organism name (required when using gene_symbol)' },
              include_sequences: { type: 'boolean', description: 'Include gene sequences (default: false)' },
            },
            required: [],
          },
        },
        {
          name: 'get_gene_sequences',
          description: 'Retrieve sequences for a specific gene',
          inputSchema: {
            type: 'object',
            properties: {
              gene_id: { type: 'number', description: 'NCBI Gene ID' },
              sequence_type: { type: 'string', enum: ['genomic', 'transcript', 'protein'], description: 'Type of sequence to retrieve (default: all)' },
            },
            required: ['gene_id'],
          },
        },

        // Taxonomy Operations
        {
          name: 'search_taxonomy',
          description: 'Search taxonomic information by organism name or keywords',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query (organism name or taxonomic keywords)' },
              rank: { type: 'string', description: 'Taxonomic rank filter (e.g., species, genus, family)' },
              max_results: { type: 'number', description: 'Maximum number of results (1-1000, default: 50)', minimum: 1, maximum: 1000 },
            },
            required: ['query'],
          },
        },
        {
          name: 'get_taxonomy_info',
          description: 'Get detailed taxonomic information for a specific taxon',
          inputSchema: {
            type: 'object',
            properties: {
              tax_id: { type: 'number', description: 'NCBI taxonomy ID' },
              include_lineage: { type: 'boolean', description: 'Include full taxonomic lineage (default: true)' },
            },
            required: ['tax_id'],
          },
        },
        {
          name: 'get_organism_info',
          description: 'Get organism-specific information including available datasets',
          inputSchema: {
            type: 'object',
            properties: {
              organism: { type: 'string', description: 'Organism name' },
              tax_id: { type: 'number', description: 'NCBI taxonomy ID (alternative to organism name)' },
            },
            required: [],
          },
        },

        // Assembly Operations
        {
          name: 'search_assemblies',
          description: 'Search genome assemblies with detailed filtering options',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query (organism name, assembly name, or keywords)' },
              assembly_level: { type: 'string', enum: ['complete', 'chromosome', 'scaffold', 'contig'], description: 'Assembly level filter' },
              assembly_source: { type: 'string', enum: ['refseq', 'genbank', 'all'], description: 'Assembly source filter (default: all)' },
              tax_id: { type: 'number', description: 'NCBI taxonomy ID to filter results' },
              exclude_atypical: { type: 'boolean', description: 'Exclude atypical assemblies (default: false)' },
              max_results: { type: 'number', description: 'Maximum number of results (1-1000, default: 50)', minimum: 1, maximum: 1000 },
              page_token: { type: 'string', description: 'Page token for pagination' },
            },
            required: [],
          },
        },
        {
          name: 'get_assembly_info',
          description: 'Get detailed metadata and statistics for a genome assembly',
          inputSchema: {
            type: 'object',
            properties: {
              assembly_accession: { type: 'string', description: 'Assembly accession (e.g., GCF_000001405.40)' },
              include_annotation: { type: 'boolean', description: 'Include annotation statistics (default: true)' },
            },
            required: ['assembly_accession'],
          },
        },

        // Advanced Operations
        {
          name: 'get_assembly_reports',
          description: 'Get assembly quality reports and validation information',
          inputSchema: {
            type: 'object',
            properties: {
              assembly_accession: { type: 'string', description: 'Assembly accession (e.g., GCF_000001405.40)' },
              report_type: { type: 'string', enum: ['sequence_report', 'assembly_stats', 'annotation_report'], description: 'Type of report to retrieve' },
            },
            required: ['assembly_accession'],
          },
        },
        {
          name: 'download_genome_data',
          description: 'Get download URLs and information for genome data files',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'Genome assembly accession' },
              include_annotation: { type: 'boolean', description: 'Include annotation files (default: true)' },
              file_format: { type: 'string', enum: ['fasta', 'genbank', 'gff3', 'gtf', 'all'], description: 'File format filter (default: all)' },
            },
            required: ['accession'],
          },
        },
        {
          name: 'batch_assembly_info',
          description: 'Get information for multiple assemblies in a single request',
          inputSchema: {
            type: 'object',
            properties: {
              accessions: { type: 'array', items: { type: 'string' }, description: 'List of assembly accessions (max 100)', maxItems: 100 },
              include_annotation: { type: 'boolean', description: 'Include annotation information (default: false)' },
            },
            required: ['accessions'],
          },
        },

        // Virus Operations
        {
          name: 'search_virus_genomes',
          description: 'Search viral genome assemblies by virus name or taxonomy',
          inputSchema: {
            type: 'object',
            properties: {
              virus_name: { type: 'string', description: 'Virus name or species (e.g., SARS-CoV-2, Influenza A)' },
              tax_id: { type: 'number', description: 'NCBI taxonomy ID for virus' },
              host: { type: 'string', description: 'Host organism filter' },
              collection_date_start: { type: 'string', description: 'Start date for collection (YYYY-MM-DD)' },
              collection_date_end: { type: 'string', description: 'End date for collection (YYYY-MM-DD)' },
              geo_location: { type: 'string', description: 'Geographic location filter' },
              max_results: { type: 'number', description: 'Maximum number of results (1-1000, default: 50)', minimum: 1, maximum: 1000 },
              page_token: { type: 'string', description: 'Page token for pagination' },
            },
            required: [],
          },
        },
        {
          name: 'get_virus_info',
          description: 'Get detailed information for a specific viral genome',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'Viral genome accession' },
              include_proteins: { type: 'boolean', description: 'Include protein information (default: true)' },
              include_metadata: { type: 'boolean', description: 'Include collection metadata (default: true)' },
            },
            required: ['accession'],
          },
        },

        // Protein Operations
        {
          name: 'search_proteins',
          description: 'Search protein sequences by name, organism, or function',
          inputSchema: {
            type: 'object',
            properties: {
              protein_name: { type: 'string', description: 'Protein name or description' },
              organism: { type: 'string', description: 'Source organism' },
              tax_id: { type: 'number', description: 'NCBI taxonomy ID' },
              gene_symbol: { type: 'string', description: 'Associated gene symbol' },
              function_keywords: { type: 'string', description: 'Functional keywords' },
              max_results: { type: 'number', description: 'Maximum number of results (1-1000, default: 50)', minimum: 1, maximum: 1000 },
              page_token: { type: 'string', description: 'Page token for pagination' },
            },
            required: [],
          },
        },
        {
          name: 'get_protein_info',
          description: 'Get detailed information for a specific protein',
          inputSchema: {
            type: 'object',
            properties: {
              protein_accession: { type: 'string', description: 'Protein accession number' },
              include_sequence: { type: 'boolean', description: 'Include protein sequence (default: true)' },
              include_domains: { type: 'boolean', description: 'Include domain information (default: true)' },
              include_structure: { type: 'boolean', description: 'Include structure information (default: false)' },
            },
            required: ['protein_accession'],
          },
        },

        // Annotation Operations
        {
          name: 'get_genome_annotation',
          description: 'Get annotation information for a genome assembly',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'Genome assembly accession' },
              annotation_type: { type: 'string', enum: ['genes', 'features', 'all'], description: 'Type of annotation to retrieve (default: all)' },
              feature_type: { type: 'string', enum: ['CDS', 'gene', 'rRNA', 'tRNA', 'ncRNA', 'all'], description: 'Feature type filter (default: all)' },
              chromosome: { type: 'string', description: 'Chromosome/contig filter' },
              start_position: { type: 'number', description: 'Start position for range query' },
              end_position: { type: 'number', description: 'End position for range query' },
            },
            required: ['accession'],
          },
        },
        {
          name: 'search_genome_features',
          description: 'Search for specific genomic features across assemblies',
          inputSchema: {
            type: 'object',
            properties: {
              feature_name: { type: 'string', description: 'Feature name or gene symbol' },
              feature_type: { type: 'string', enum: ['CDS', 'gene', 'rRNA', 'tRNA', 'ncRNA'], description: 'Type of genomic feature' },
              organism: { type: 'string', description: 'Source organism' },
              tax_id: { type: 'number', description: 'NCBI taxonomy ID' },
              chromosome: { type: 'string', description: 'Chromosome name' },
              max_results: { type: 'number', description: 'Maximum number of results (1-1000, default: 50)', minimum: 1, maximum: 1000 },
            },
            required: [],
          },
        },

        // Comparative Genomics
        {
          name: 'compare_genomes',
          description: 'Compare two or more genome assemblies',
          inputSchema: {
            type: 'object',
            properties: {
              accessions: { type: 'array', items: { type: 'string' }, description: 'List of assembly accessions to compare (2-10)', minItems: 2, maxItems: 10 },
              comparison_type: { type: 'string', enum: ['basic_stats', 'gene_content', 'synteny'], description: 'Type of comparison (default: basic_stats)' },
              include_orthologs: { type: 'boolean', description: 'Include orthologous gene information (default: false)' },
            },
            required: ['accessions'],
          },
        },
        {
          name: 'find_orthologs',
          description: 'Find orthologous genes across different organisms',
          inputSchema: {
            type: 'object',
            properties: {
              gene_symbol: { type: 'string', description: 'Gene symbol to find orthologs for' },
              source_organism: { type: 'string', description: 'Source organism' },
              target_organisms: { type: 'array', items: { type: 'string' }, description: 'Target organisms to search for orthologs' },
              similarity_threshold: { type: 'number', description: 'Minimum similarity threshold (0-100, default: 70)', minimum: 0, maximum: 100 },
              max_results: { type: 'number', description: 'Maximum number of results per organism (default: 10)', minimum: 1, maximum: 100 },
            },
            required: ['gene_symbol', 'source_organism', 'target_organisms'],
          },
        },

        // Sequence Operations
        {
          name: 'get_sequence_data',
          description: 'Retrieve sequence data for genomes, genes, or proteins',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'Sequence accession number' },
              sequence_type: { type: 'string', enum: ['genomic', 'transcript', 'protein', 'all'], description: 'Type of sequence (default: all)' },
              format: { type: 'string', enum: ['fasta', 'genbank', 'json'], description: 'Output format (default: fasta)' },
              start_position: { type: 'number', description: 'Start position for subsequence' },
              end_position: { type: 'number', description: 'End position for subsequence' },
              strand: { type: 'string', enum: ['plus', 'minus', 'both'], description: 'DNA strand (default: plus)' },
            },
            required: ['accession'],
          },
        },
        {
          name: 'blast_search',
          description: 'Perform BLAST search against NCBI databases',
          inputSchema: {
            type: 'object',
            properties: {
              query_sequence: { type: 'string', description: 'Query sequence in FASTA format' },
              database: { type: 'string', enum: ['nr', 'nt', 'refseq_genomic', 'refseq_protein'], description: 'Target database (default: nr)' },
              program: { type: 'string', enum: ['blastn', 'blastp', 'blastx', 'tblastn', 'tblastx'], description: 'BLAST program (auto-detected if not specified)' },
              max_hits: { type: 'number', description: 'Maximum number of hits (1-500, default: 50)', minimum: 1, maximum: 500 },
              evalue_threshold: { type: 'number', description: 'E-value threshold (default: 0.001)' },
              organism_filter: { type: 'string', description: 'Restrict search to specific organism' },
            },
            required: ['query_sequence'],
          },
        },

        // Phylogenetic Operations
        {
          name: 'get_phylogenetic_tree',
          description: 'Get phylogenetic tree data for a set of organisms',
          inputSchema: {
            type: 'object',
            properties: {
              tax_ids: { type: 'array', items: { type: 'number' }, description: 'List of taxonomy IDs (2-50)', minItems: 2, maxItems: 50 },
              tree_type: { type: 'string', enum: ['species', 'strain', 'custom'], description: 'Type of phylogenetic tree (default: species)' },
              format: { type: 'string', enum: ['newick', 'json', 'xml'], description: 'Output format (default: newick)' },
              include_distances: { type: 'boolean', description: 'Include branch distances (default: true)' },
            },
            required: ['tax_ids'],
          },
        },
        {
          name: 'get_taxonomic_lineage',
          description: 'Get complete taxonomic lineage for an organism',
          inputSchema: {
            type: 'object',
            properties: {
              tax_id: { type: 'number', description: 'NCBI taxonomy ID' },
              include_ranks: { type: 'boolean', description: 'Include taxonomic ranks (default: true)' },
              include_synonyms: { type: 'boolean', description: 'Include synonyms (default: false)' },
              format: { type: 'string', enum: ['json', 'text'], description: 'Output format (default: json)' },
            },
            required: ['tax_id'],
          },
        },

        // Statistics and Summary Operations
        {
          name: 'get_database_stats',
          description: 'Get statistics about NCBI Datasets database content',
          inputSchema: {
            type: 'object',
            properties: {
              data_type: { type: 'string', enum: ['genomes', 'genes', 'proteins', 'assemblies', 'all'], description: 'Type of data to get stats for (default: all)' },
              organism_group: { type: 'string', enum: ['bacteria', 'archaea', 'eukaryotes', 'viruses', 'all'], description: 'Organism group filter (default: all)' },
              include_trends: { type: 'boolean', description: 'Include historical trends (default: false)' },
            },
            required: [],
          },
        },
        {
          name: 'search_by_bioproject',
          description: 'Search datasets by BioProject accession',
          inputSchema: {
            type: 'object',
            properties: {
              bioproject_accession: { type: 'string', description: 'BioProject accession (e.g., PRJNA12345)' },
              data_type: { type: 'string', enum: ['genomes', 'assemblies', 'genes', 'all'], description: 'Type of data to retrieve (default: all)' },
              max_results: { type: 'number', description: 'Maximum number of results (1-1000, default: 100)', minimum: 1, maximum: 1000 },
            },
            required: ['bioproject_accession'],
          },
        },
        {
          name: 'search_by_biosample',
          description: 'Search datasets by BioSample accession',
          inputSchema: {
            type: 'object',
            properties: {
              biosample_accession: { type: 'string', description: 'BioSample accession (e.g., SAMN12345678)' },
              include_metadata: { type: 'boolean', description: 'Include sample metadata (default: true)' },
              related_data: { type: 'boolean', description: 'Include related datasets (default: false)' },
            },
            required: ['biosample_accession'],
          },
        },

        // Quality Control Operations
        {
          name: 'get_assembly_quality',
          description: 'Get quality metrics and validation results for genome assemblies',
          inputSchema: {
            type: 'object',
            properties: {
              accession: { type: 'string', description: 'Assembly accession' },
              include_checkm: { type: 'boolean', description: 'Include CheckM quality scores (default: true)' },
              include_busco: { type: 'boolean', description: 'Include BUSCO completeness scores (default: true)' },
              include_contamination: { type: 'boolean', description: 'Include contamination analysis (default: true)' },
            },
            required: ['accession'],
          },
        },
        {
          name: 'validate_sequences',
          description: 'Validate sequence data and check for common issues',
          inputSchema: {
            type: 'object',
            properties: {
              sequences: { type: 'array', items: { type: 'string' }, description: 'List of sequences to validate (max 10)', maxItems: 10 },
              sequence_type: { type: 'string', enum: ['dna', 'rna', 'protein'], description: 'Type of sequences' },
              check_contamination: { type: 'boolean', description: 'Check for contamination (default: true)' },
              check_vector: { type: 'boolean', description: 'Check for vector sequences (default: true)' },
            },
            required: ['sequences', 'sequence_type'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          // Genome Operations
          case 'search_genomes':
            return await this.handleSearchGenomes(args);
          case 'get_genome_info':
            return await this.handleGetGenomeInfo(args);
          case 'get_genome_summary':
            return await this.handleGetGenomeSummary(args);

          // Gene Operations
          case 'search_genes':
            return await this.handleSearchGenes(args);
          case 'get_gene_info':
            return await this.handleGetGeneInfo(args);
          case 'get_gene_sequences':
            return await this.handleGetGeneSequences(args);

          // Taxonomy Operations
          case 'search_taxonomy':
            return await this.handleSearchTaxonomy(args);
          case 'get_taxonomy_info':
            return await this.handleGetTaxonomyInfo(args);
          case 'get_organism_info':
            return await this.handleGetOrganismInfo(args);

          // Assembly Operations
          case 'search_assemblies':
            return await this.handleSearchAssemblies(args);
          case 'get_assembly_info':
            return await this.handleGetAssemblyInfo(args);

          // Advanced Operations
          case 'get_assembly_reports':
            return await this.handleGetAssemblyReports(args);
          case 'download_genome_data':
            return await this.handleDownloadGenomeData(args);
          case 'batch_assembly_info':
            return await this.handleBatchAssemblyInfo(args);

          // Virus Operations
          case 'search_virus_genomes':
            return await this.handleSearchVirusGenomes(args);
          case 'get_virus_info':
            return await this.handleGetVirusInfo(args);

          // Protein Operations
          case 'search_proteins':
            return await this.handleSearchProteins(args);
          case 'get_protein_info':
            return await this.handleGetProteinInfo(args);

          // Annotation Operations
          case 'get_genome_annotation':
            return await this.handleGetGenomeAnnotation(args);
          case 'search_genome_features':
            return await this.handleSearchGenomeFeatures(args);

          // Comparative Genomics
          case 'compare_genomes':
            return await this.handleCompareGenomes(args);
          case 'find_orthologs':
            return await this.handleFindOrthologs(args);

          // Sequence Operations
          case 'get_sequence_data':
            return await this.handleGetSequenceData(args);
          case 'blast_search':
            return await this.handleBlastSearch(args);

          // Phylogenetic Operations
          case 'get_phylogenetic_tree':
            return await this.handleGetPhylogeneticTree(args);
          case 'get_taxonomic_lineage':
            return await this.handleGetTaxonomicLineage(args);

          // Statistics and Summary Operations
          case 'get_database_stats':
            return await this.handleGetDatabaseStats(args);
          case 'search_by_bioproject':
            return await this.handleSearchByBioproject(args);
          case 'search_by_biosample':
            return await this.handleSearchByBiosample(args);

          // Quality Control Operations
          case 'get_assembly_quality':
            return await this.handleGetAssemblyQuality(args);
          case 'validate_sequences':
            return await this.handleValidateSequences(args);

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error executing tool ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  // Tool handler implementations
  private async handleSearchGenomes(args: any) {
    if (!isValidSearchArgs(args) || !args.tax_id) {
      throw new McpError(ErrorCode.InvalidParams, 'Tax ID is required for genome search');
    }

    try {
      const params: any = {
        limit: args.max_results || 50,
      };

      if (args.assembly_level) params.assembly_level = args.assembly_level;
      if (args.assembly_source && args.assembly_source !== 'all') params.assembly_source = args.assembly_source;
      if (args.page_token) params.page_token = args.page_token;

      const response = await this.apiClient.get(`/genome/taxon/${args.tax_id}/dataset_report`, { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              search_parameters: args,
              total_count: response.data.total_count || 0,
              returned_count: response.data.reports?.length || 0,
              page_token: response.data.next_page_token,
              genomes: response.data.reports || [],
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search genomes: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetGenomeInfo(args: any) {
    if (!isValidInfoArgs(args) || !args.accession) {
      throw new McpError(ErrorCode.InvalidParams, 'Genome accession is required');
    }

    try {
      const params: any = {};
      if (args.include_annotation !== false) params.include_annotation_type = 'GENOME_GFF,GENOME_GBFF';

      const response = await this.apiClient.get(`/genome/accession/${args.accession}/dataset_report`, { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get genome info: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetGenomeSummary(args: any) {
    if (!isValidInfoArgs(args) || !args.accession) {
      throw new McpError(ErrorCode.InvalidParams, 'Genome accession is required');
    }

    try {
      const response = await this.apiClient.get(`/genome/accession/${args.accession}/dataset_report`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              accession: args.accession,
              summary: response.data,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get genome summary: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleSearchGenes(args: any) {
    if (!isValidGeneSearchArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid gene search arguments');
    }

    try {
      const params: any = {
        limit: args.max_results || 50,
      };

      if (args.gene_symbol) params.symbol = args.gene_symbol;
      if (args.gene_id) params.gene_id = args.gene_id.toString();
      if (args.organism) params.taxon = args.organism;
      if (args.tax_id) params.taxon = args.tax_id.toString();
      if (args.chromosome) params.chromosome = args.chromosome;
      if (args.page_token) params.page_token = args.page_token;

      const response = await this.apiClient.get('/gene/search', { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              search_parameters: args,
              total_count: response.data.total_count || 0,
              returned_count: response.data.genes?.length || 0,
              page_token: response.data.next_page_token,
              genes: response.data.genes || [],
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search genes: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetGeneInfo(args: any) {
    try {
      let response;

      if (args.gene_id) {
        const params: any = {};
        if (args.include_sequences) params.returned_content = 'COMPLETE';

        response = await this.apiClient.get(`/gene/id/${args.gene_id}`, { params });
      } else if (args.gene_symbol && args.organism) {
        const params: any = {
          symbol: args.gene_symbol,
          taxon: args.organism,
          limit: 1,
        };
        if (args.include_sequences) params.returned_content = 'COMPLETE';

        const searchResponse = await this.apiClient.get('/gene/search', { params });
        if (searchResponse.data.genes && searchResponse.data.genes.length > 0) {
          const geneId = searchResponse.data.genes[0].gene_id;
          response = await this.apiClient.get(`/gene/id/${geneId}`, {
            params: args.include_sequences ? { returned_content: 'COMPLETE' } : {}
          });
        } else {
          throw new McpError(ErrorCode.InternalError, `Gene ${args.gene_symbol} not found in ${args.organism}`);
        }
      } else {
        throw new McpError(ErrorCode.InvalidParams, 'Either gene_id or gene_symbol with organism must be provided');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get gene info: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetGeneSequences(args: any) {
    if (!args.gene_id || typeof args.gene_id !== 'number') {
      throw new McpError(ErrorCode.InvalidParams, 'Gene ID is required');
    }

    try {
      const params: any = {
        returned_content: 'COMPLETE',
      };

      if (args.sequence_type) {
        switch (args.sequence_type) {
          case 'genomic':
            params.include_annotation_type = 'GENOME_FASTA';
            break;
          case 'transcript':
            params.include_annotation_type = 'RNA_FASTA';
            break;
          case 'protein':
            params.include_annotation_type = 'PROT_FASTA';
            break;
        }
      }

      const response = await this.apiClient.get(`/gene/id/${args.gene_id}`, { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              gene_id: args.gene_id,
              sequence_type: args.sequence_type || 'all',
              sequences: response.data,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get gene sequences: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleSearchTaxonomy(args: any) {
    if (!args.query || typeof args.query !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Search query is required');
    }

    try {
      const params: any = {
        q: args.query,
        limit: args.max_results || 50,
      };

      if (args.rank) params.rank = args.rank;

      const response = await this.apiClient.get('/taxonomy/search', { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              search_parameters: args,
              total_count: response.data.total_count || 0,
              returned_count: response.data.taxonomy?.length || 0,
              taxonomy: response.data.taxonomy || [],
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search taxonomy: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetTaxonomyInfo(args: any) {
    if (!args.tax_id || typeof args.tax_id !== 'number') {
      throw new McpError(ErrorCode.InvalidParams, 'Taxonomy ID is required');
    }

    try {
      const params: any = {};
      if (args.include_lineage !== false) params.include_lineage = true;

      const response = await this.apiClient.get(`/taxonomy/taxon/${args.tax_id}`, { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get taxonomy info: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetOrganismInfo(args: any) {
    if (!args.organism && !args.tax_id) {
      throw new McpError(ErrorCode.InvalidParams, 'Either organism name or taxonomy ID is required');
    }

    try {
      let taxId = args.tax_id;

      // If organism name provided, first get the taxonomy ID
      if (args.organism && !taxId) {
        const searchResponse = await this.apiClient.get('/taxonomy/search', {
          params: { q: args.organism, limit: 1 }
        });

        if (searchResponse.data.taxonomy && searchResponse.data.taxonomy.length > 0) {
          taxId = searchResponse.data.taxonomy[0].tax_id;
        } else {
          throw new McpError(ErrorCode.InternalError, `Organism ${args.organism} not found`);
        }
      }

      // Get organism information and available datasets
      const [taxonomyResponse, genomesResponse] = await Promise.all([
        this.apiClient.get(`/taxonomy/taxon/${taxId}`),
        this.apiClient.get('/genome/search', { params: { taxon: taxId.toString(), limit: 10 } })
      ]);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              organism_info: taxonomyResponse.data,
              available_genomes: genomesResponse.data.assemblies || [],
              genome_count: genomesResponse.data.total_count || 0,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get organism info: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleSearchAssemblies(args: any) {
    if (!isValidSearchArgs(args)) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid search arguments');
    }

    try {
      const params: any = {
        limit: args.max_results || 50,
      };

      if (args.query) params.q = args.query;
      if (args.assembly_level) params.assembly_level = args.assembly_level;
      if (args.assembly_source && args.assembly_source !== 'all') params.assembly_source = args.assembly_source;
      if (args.tax_id) params.taxon = args.tax_id.toString();
      if (args.exclude_atypical) params.exclude_atypical = true;
      if (args.page_token) params.page_token = args.page_token;

      const response = await this.apiClient.get('/assembly/search', { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              search_parameters: args,
              total_count: response.data.total_count || 0,
              returned_count: response.data.assemblies?.length || 0,
              page_token: response.data.next_page_token,
              assemblies: response.data.assemblies || [],
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search assemblies: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetAssemblyInfo(args: any) {
    if (!args.assembly_accession || typeof args.assembly_accession !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Assembly accession is required');
    }

    try {
      const params: any = {};
      if (args.include_annotation !== false) params.include_annotation_type = 'GENOME_GFF,GENOME_GBFF';

      const response = await this.apiClient.get(`/assembly/accession/${args.assembly_accession}`, { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get assembly info: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetAssemblyReports(args: any) {
    if (!args.assembly_accession || typeof args.assembly_accession !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Assembly accession is required');
    }

    try {
      let endpoint = `/assembly/accession/${args.assembly_accession}`;

      switch (args.report_type) {
        case 'sequence_report':
          endpoint += '/sequence_reports';
          break;
        case 'assembly_stats':
          endpoint += '/dataset_report';
          break;
        case 'annotation_report':
          endpoint += '/annotation_report';
          break;
        default:
          endpoint += '/dataset_report';
      }

      const response = await this.apiClient.get(endpoint);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              assembly_accession: args.assembly_accession,
              report_type: args.report_type || 'assembly_stats',
              report: response.data,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get assembly reports: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleDownloadGenomeData(args: any) {
    if (!args.accession || typeof args.accession !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Genome accession is required');
    }

    try {
      const params: any = {};

      if (args.include_annotation !== false) {
        params.include_annotation_type = 'GENOME_GFF,GENOME_GBFF';
      }

      if (args.file_format && args.file_format !== 'all') {
        switch (args.file_format) {
          case 'fasta':
            params.include_annotation_type = 'GENOME_FASTA';
            break;
          case 'genbank':
            params.include_annotation_type = 'GENOME_GBFF';
            break;
          case 'gff3':
            params.include_annotation_type = 'GENOME_GFF';
            break;
          case 'gtf':
            params.include_annotation_type = 'GENOME_GTF';
            break;
        }
      }

      const response = await this.apiClient.get(`/genome/accession/${args.accession}/download`, { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              accession: args.accession,
              file_format: args.file_format || 'all',
              download_info: response.data,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get download info: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleBatchAssemblyInfo(args: any) {
    if (!args.accessions || !Array.isArray(args.accessions) || args.accessions.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'Assembly accessions array is required');
    }

    if (args.accessions.length > 100) {
      throw new McpError(ErrorCode.InvalidParams, 'Maximum 100 accessions allowed per batch request');
    }

    try {
      const params: any = {
        accessions: args.accessions.join(','),
      };

      if (args.include_annotation) {
        params.include_annotation_type = 'GENOME_GFF,GENOME_GBFF';
      }

      const response = await this.apiClient.post('/assembly/accession', {
        accessions: args.accessions,
        ...params
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              requested_accessions: args.accessions,
              returned_count: response.data.assemblies?.length || 0,
              assemblies: response.data.assemblies || [],
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get batch assembly info: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // Additional handler implementations for new tools
  private async handleSearchVirusGenomes(args: any) {
    try {
      const params: any = {
        limit: args.max_results || 50,
      };

      if (args.virus_name) params.q = args.virus_name;
      if (args.tax_id) params.taxon = args.tax_id.toString();
      if (args.host) params.host = args.host;
      if (args.collection_date_start) params.collection_date_start = args.collection_date_start;
      if (args.collection_date_end) params.collection_date_end = args.collection_date_end;
      if (args.geo_location) params.geo_location = args.geo_location;
      if (args.page_token) params.page_token = args.page_token;

      const response = await this.apiClient.get('/virus/search', { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              search_parameters: args,
              total_count: response.data.total_count || 0,
              returned_count: response.data.virus_genomes?.length || 0,
              page_token: response.data.next_page_token,
              virus_genomes: response.data.virus_genomes || [],
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search virus genomes: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetVirusInfo(args: any) {
    if (!args.accession || typeof args.accession !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Viral genome accession is required');
    }

    try {
      const params: any = {};
      if (args.include_proteins !== false) params.include_proteins = true;
      if (args.include_metadata !== false) params.include_metadata = true;

      const response = await this.apiClient.get(`/virus/accession/${args.accession}`, { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get virus info: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleSearchProteins(args: any) {
    try {
      const params: any = {
        limit: args.max_results || 50,
      };

      if (args.protein_name) params.q = args.protein_name;
      if (args.organism) params.organism = args.organism;
      if (args.tax_id) params.taxon = args.tax_id.toString();
      if (args.gene_symbol) params.gene_symbol = args.gene_symbol;
      if (args.function_keywords) params.function = args.function_keywords;
      if (args.page_token) params.page_token = args.page_token;

      const response = await this.apiClient.get('/protein/search', { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              search_parameters: args,
              total_count: response.data.total_count || 0,
              returned_count: response.data.proteins?.length || 0,
              page_token: response.data.next_page_token,
              proteins: response.data.proteins || [],
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search proteins: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetProteinInfo(args: any) {
    if (!args.protein_accession || typeof args.protein_accession !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Protein accession is required');
    }

    try {
      const params: any = {};
      if (args.include_sequence !== false) params.include_sequence = true;
      if (args.include_domains !== false) params.include_domains = true;
      if (args.include_structure) params.include_structure = true;

      const response = await this.apiClient.get(`/protein/accession/${args.protein_accession}`, { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get protein info: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetGenomeAnnotation(args: any) {
    if (!args.accession || typeof args.accession !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Genome accession is required');
    }

    try {
      const params: any = {};

      if (args.annotation_type && args.annotation_type !== 'all') {
        switch (args.annotation_type) {
          case 'genes':
            params.include_annotation_type = 'GENOME_GFF';
            break;
          case 'features':
            params.include_annotation_type = 'GENOME_GBFF';
            break;
        }
      } else {
        params.include_annotation_type = 'GENOME_GFF,GENOME_GBFF';
      }

      if (args.feature_type && args.feature_type !== 'all') {
        params.feature_type = args.feature_type;
      }
      if (args.chromosome) params.chromosome = args.chromosome;
      if (args.start_position) params.start = args.start_position;
      if (args.end_position) params.end = args.end_position;

      const response = await this.apiClient.get(`/genome/accession/${args.accession}/annotation`, { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              accession: args.accession,
              annotation_type: args.annotation_type || 'all',
              annotation: response.data,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get genome annotation: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleSearchGenomeFeatures(args: any) {
    try {
      const params: any = {
        limit: args.max_results || 50,
      };

      if (args.feature_name) params.q = args.feature_name;
      if (args.feature_type) params.feature_type = args.feature_type;
      if (args.organism) params.organism = args.organism;
      if (args.tax_id) params.taxon = args.tax_id.toString();
      if (args.chromosome) params.chromosome = args.chromosome;

      const response = await this.apiClient.get('/genome/features/search', { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              search_parameters: args,
              total_count: response.data.total_count || 0,
              returned_count: response.data.features?.length || 0,
              features: response.data.features || [],
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search genome features: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleCompareGenomes(args: any) {
    if (!args.accessions || !Array.isArray(args.accessions) || args.accessions.length < 2) {
      throw new McpError(ErrorCode.InvalidParams, 'At least 2 assembly accessions are required for comparison');
    }

    if (args.accessions.length > 10) {
      throw new McpError(ErrorCode.InvalidParams, 'Maximum 10 assemblies allowed for comparison');
    }

    try {
      const params: any = {
        accessions: args.accessions.join(','),
        comparison_type: args.comparison_type || 'basic_stats',
      };

      if (args.include_orthologs) params.include_orthologs = true;

      const response = await this.apiClient.post('/genome/compare', {
        accessions: args.accessions,
        ...params
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              compared_accessions: args.accessions,
              comparison_type: args.comparison_type || 'basic_stats',
              comparison_results: response.data,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to compare genomes: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleFindOrthologs(args: any) {
    if (!args.gene_symbol || !args.source_organism || !args.target_organisms) {
      throw new McpError(ErrorCode.InvalidParams, 'Gene symbol, source organism, and target organisms are required');
    }

    if (!Array.isArray(args.target_organisms) || args.target_organisms.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'Target organisms must be a non-empty array');
    }

    try {
      const params: any = {
        gene_symbol: args.gene_symbol,
        source_organism: args.source_organism,
        target_organisms: args.target_organisms.join(','),
        similarity_threshold: args.similarity_threshold || 70,
        max_results: args.max_results || 10,
      };

      const response = await this.apiClient.get('/gene/orthologs', { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              search_parameters: args,
              ortholog_results: response.data,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to find orthologs: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetSequenceData(args: any) {
    if (!args.accession || typeof args.accession !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Sequence accession is required');
    }

    try {
      const params: any = {
        format: args.format || 'fasta',
      };

      if (args.sequence_type && args.sequence_type !== 'all') {
        params.sequence_type = args.sequence_type;
      }
      if (args.start_position) params.start = args.start_position;
      if (args.end_position) params.end = args.end_position;
      if (args.strand) params.strand = args.strand;

      const response = await this.apiClient.get(`/sequence/accession/${args.accession}`, { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              accession: args.accession,
              sequence_type: args.sequence_type || 'all',
              format: args.format || 'fasta',
              sequence_data: response.data,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get sequence data: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleBlastSearch(args: any) {
    if (!args.query_sequence || typeof args.query_sequence !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Query sequence is required');
    }

    try {
      const params: any = {
        query: args.query_sequence,
        database: args.database || 'nr',
        max_hits: args.max_hits || 50,
        evalue: args.evalue_threshold || 0.001,
      };

      if (args.program) params.program = args.program;
      if (args.organism_filter) params.organism = args.organism_filter;

      const response = await this.apiClient.post('/blast/search', params);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              search_parameters: args,
              blast_results: response.data,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to perform BLAST search: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetPhylogeneticTree(args: any) {
    if (!args.tax_ids || !Array.isArray(args.tax_ids) || args.tax_ids.length < 2) {
      throw new McpError(ErrorCode.InvalidParams, 'At least 2 taxonomy IDs are required for phylogenetic tree');
    }

    if (args.tax_ids.length > 50) {
      throw new McpError(ErrorCode.InvalidParams, 'Maximum 50 taxonomy IDs allowed for phylogenetic tree');
    }

    try {
      const params: any = {
        tax_ids: args.tax_ids.join(','),
        tree_type: args.tree_type || 'species',
        format: args.format || 'newick',
        include_distances: args.include_distances !== false,
      };

      const response = await this.apiClient.get('/taxonomy/tree', { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              tax_ids: args.tax_ids,
              tree_type: args.tree_type || 'species',
              format: args.format || 'newick',
              phylogenetic_tree: response.data,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get phylogenetic tree: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetTaxonomicLineage(args: any) {
    if (!args.tax_id || typeof args.tax_id !== 'number') {
      throw new McpError(ErrorCode.InvalidParams, 'Taxonomy ID is required');
    }

    try {
      const params: any = {
        include_ranks: args.include_ranks !== false,
        include_synonyms: args.include_synonyms || false,
        format: args.format || 'json',
      };

      const response = await this.apiClient.get(`/taxonomy/taxon/${args.tax_id}/lineage`, { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              tax_id: args.tax_id,
              format: args.format || 'json',
              taxonomic_lineage: response.data,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get taxonomic lineage: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetDatabaseStats(args: any) {
    try {
      const params: any = {
        data_type: args.data_type || 'all',
        organism_group: args.organism_group || 'all',
        include_trends: args.include_trends || false,
      };

      const response = await this.apiClient.get('/stats/database', { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              data_type: args.data_type || 'all',
              organism_group: args.organism_group || 'all',
              database_statistics: response.data,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get database stats: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleSearchByBioproject(args: any) {
    if (!args.bioproject_accession || typeof args.bioproject_accession !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'BioProject accession is required');
    }

    try {
      const params: any = {
        bioproject: args.bioproject_accession,
        data_type: args.data_type || 'all',
        limit: args.max_results || 100,
      };

      const response = await this.apiClient.get('/bioproject/search', { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              bioproject_accession: args.bioproject_accession,
              data_type: args.data_type || 'all',
              total_count: response.data.total_count || 0,
              returned_count: response.data.datasets?.length || 0,
              datasets: response.data.datasets || [],
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search by BioProject: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleSearchByBiosample(args: any) {
    if (!args.biosample_accession || typeof args.biosample_accession !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'BioSample accession is required');
    }

    try {
      const params: any = {
        biosample: args.biosample_accession,
        include_metadata: args.include_metadata !== false,
        related_data: args.related_data || false,
      };

      const response = await this.apiClient.get('/biosample/search', { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              biosample_accession: args.biosample_accession,
              biosample_data: response.data,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search by BioSample: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetAssemblyQuality(args: any) {
    if (!args.accession || typeof args.accession !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Assembly accession is required');
    }

    try {
      const params: any = {
        include_checkm: args.include_checkm !== false,
        include_busco: args.include_busco !== false,
        include_contamination: args.include_contamination !== false,
      };

      const response = await this.apiClient.get(`/assembly/accession/${args.accession}/quality`, { params });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              accession: args.accession,
              quality_metrics: response.data,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get assembly quality: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleValidateSequences(args: any) {
    if (!args.sequences || !Array.isArray(args.sequences) || args.sequences.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'Sequences array is required');
    }

    if (args.sequences.length > 10) {
      throw new McpError(ErrorCode.InvalidParams, 'Maximum 10 sequences allowed for validation');
    }

    if (!args.sequence_type || !['dna', 'rna', 'protein'].includes(args.sequence_type)) {
      throw new McpError(ErrorCode.InvalidParams, 'Valid sequence type (dna, rna, protein) is required');
    }

    try {
      const params: any = {
        sequences: args.sequences,
        sequence_type: args.sequence_type,
        check_contamination: args.check_contamination !== false,
        check_vector: args.check_vector !== false,
      };

      const response = await this.apiClient.post('/sequence/validate', params);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              sequence_count: args.sequences.length,
              sequence_type: args.sequence_type,
              validation_results: response.data,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to validate sequences: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('NCBI Datasets MCP server running on stdio');
  }
}

const server = new NCBIDatasetsServer();
server.run().catch(console.error);
