![Logo](logo.png)
# Unofficial Open Genes MCP Server

A Model Context Protocol (MCP) server that provides access to the Open Genes API, a comprehensive database of genetic and aging-related data.

**Developed by [Augmented Nature](https://augmentednature.ai)**

## Overview

The Open Genes MCP server exposes the Open Genes API functionality through standardized MCP tools, allowing you to query genetic data, aging mechanisms, diseases, and more directly from your MCP-enabled environment.

## Features

### Gene Search and Retrieval
- **search_genes** - Search for genes with multiple filter parameters
- **get_gene_by_id** - Get a specific gene by its ID
- **get_gene_by_symbol** - Get a gene by its symbol (e.g., "TP53")
- **get_gene_by_ncbi_id** - Get a gene by its NCBI ID
- **get_gene_suggestions** - Get gene name suggestions
- **get_gene_symbols** - Get all available gene symbols
- **get_latest_genes** - Get recently added genes
- **get_genes_by_functional_cluster** - Get genes by functional cluster IDs
- **get_genes_by_selection_criteria** - Get genes by selection criteria IDs
- **get_genes_by_go_term** - Get genes by GO (Gene Ontology) term
- **get_genes_by_expression_change** - Get genes by expression change
- **get_gene_taxon** - Get gene taxon information
- **get_genes_increase_lifespan** - Get genes that increase lifespan

### Taxonomy Tools
- **get_model_organisms** - Get list of model organisms
- **get_phylums** - Get list of phylums

### Protein Tools
- **get_protein_classes** - Get protein class information

### Disease Tools
- **get_diseases** - Get disease list
- **get_disease_categories** - Get disease category list

### Research Tools
- **get_calorie_experiments** - Search calorie restriction experiments
- **get_aging_mechanisms** - Get aging mechanisms

## Installation

The server has been automatically configured in your MCP settings. No additional setup is required.

## Usage Examples

### Search for genes
```
Use the search_genes tool with filters:
- byGeneSymbol: "TP53"
- byDiseases: "cancer"
- byAgingMechanism: "cellular senescence"
```

### Get gene information
```
Use get_gene_by_symbol with:
- symbol: "SIRT1"
- lang: "en"
```

### Get aging mechanisms
```
Use get_aging_mechanisms with:
- lang: "en"
```

## Language Support

All tools support both English (`en`) and Russian (`ru`) languages through the `lang` parameter.

## Pagination

Many tools support pagination through:
- `page` - Page number (default: 1)
- `pageSize` - Number of items per page (default: 20)

## API Reference

The server connects to the Open Genes API at https://open-genes.com/api

For more information about the Open Genes project, visit: https://open-genes.com

## Development

### Building
```bash
npm run build
```

### Project Structure
```
open-genes-server/
├── src/
│   ├── index.ts          # Main server implementation
│   ├── tools/            # Tool implementations
│   │   ├── genes.ts      # Gene-related tools
│   │   ├── taxonomy.ts   # Taxonomy tools
│   │   ├── proteins.ts   # Protein tools
│   │   ├── diseases.ts   # Disease tools
│   │   └── research.ts   # Research tools
│   ├── types/            # TypeScript type definitions
│   │   └── api.ts        # API response types
│   └── utils/            # Utility functions
│       └── api-client.ts # Axios instance configuration
├── package.json
├── tsconfig.json
└── README.md
```

## Error Handling

The server includes comprehensive error handling for:
- Network failures
- Invalid parameters
- API errors
- Missing required fields

All errors are returned with descriptive messages to help diagnose issues.
