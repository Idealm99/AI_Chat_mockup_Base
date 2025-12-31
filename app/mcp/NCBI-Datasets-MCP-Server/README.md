![NCBI Datasets MCP Server Logo](logo.png)
# Unofficial NCBI Datasets MCP Server

A Model Context Protocol (MCP) server that provides comprehensive access to the NCBI Datasets API. This server enables seamless integration with NCBI's vast collection of genomic, taxonomic, and biological data through 31 specialized tools.

**Developed by [Augmented Nature](https://augmentednature.ai)**

## Features

- **31 comprehensive tools** covering all major NCBI Datasets functionality
- **9 organized categories** of biological data operations
- **Resource templates** for direct URI-based data access
- **Full TypeScript implementation** with proper error handling
- **Rate limiting and caching** for optimal performance
- **Environment variable configuration** for API keys

## Installation

```bash
npm install
npm run build
```

## Configuration

### Environment Variables

- `NCBI_API_KEY` (optional): Your NCBI API key for higher rate limits and priority access

### MCP Configuration

Add to your MCP settings:

```json
{
  "mcpServers": {
    "ncbi-datasets-server": {
      "command": "node",
      "args": ["/path/to/ncbi-datasets-server/build/index.js"],
      "env": {
        "NCBI_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Available Tools

### 🧬 Genome Operations

- `search_genomes` - Search genome assemblies by organism, keywords, or criteria
- `get_genome_info` - Get detailed information for a specific genome assembly
- `get_genome_summary` - Get summary statistics for a genome assembly

### 🧬 Gene Operations

- `search_genes` - Search genes by symbol, name, organism, or location
- `get_gene_info` - Get detailed information for a specific gene
- `get_gene_sequences` - Retrieve sequences for a specific gene

### 🏷️ Taxonomy Operations

- `search_taxonomy` - Search taxonomic information by organism name
- `get_taxonomy_info` - Get detailed taxonomic information for a taxon
- `get_organism_info` - Get organism-specific information and datasets

### 🏗️ Assembly Operations

- `search_assemblies` - Search genome assemblies with detailed filtering
- `get_assembly_info` - Get detailed metadata and statistics for assemblies
- `get_assembly_reports` - Get assembly quality reports and validation info
- `download_genome_data` - Get download URLs for genome data files
- `batch_assembly_info` - Get information for multiple assemblies

### 🦠 Virus Operations

- `search_virus_genomes` - Search viral genome assemblies
- `get_virus_info` - Get detailed information for viral genomes

### 🧪 Protein Operations

- `search_proteins` - Search protein sequences by name or function
- `get_protein_info` - Get detailed information for specific proteins

### 📝 Annotation Operations

- `get_genome_annotation` - Get annotation information for assemblies
- `search_genome_features` - Search for specific genomic features

### 🔬 Comparative Genomics

- `compare_genomes` - Compare two or more genome assemblies
- `find_orthologs` - Find orthologous genes across organisms

### 🧬 Sequence Operations

- `get_sequence_data` - Retrieve sequence data for genomes/genes/proteins
- `blast_search` - Perform BLAST search against NCBI databases

### 🌳 Phylogenetic Operations

- `get_phylogenetic_tree` - Get phylogenetic tree data for organisms
- `get_taxonomic_lineage` - Get complete taxonomic lineage

### 📊 Statistics Operations

- `get_database_stats` - Get statistics about NCBI Datasets content
- `search_by_bioproject` - Search datasets by BioProject accession
- `search_by_biosample` - Search datasets by BioSample accession

### ✅ Quality Control

- `get_assembly_quality` - Get quality metrics for genome assemblies
- `validate_sequences` - Validate sequence data and check for issues

## Usage Examples

### Genome Analysis

```javascript
// Search for E. coli genomes
{
  "tool": "search_genomes",
  "arguments": {
    "tax_id": 511145,
    "assembly_level": "complete",
    "max_results": 10
  }
}

// Get detailed genome information
{
  "tool": "get_genome_info",
  "arguments": {
    "accession": "GCF_000005845.2",
    "include_annotation": true
  }
}

// Get genome summary statistics
{
  "tool": "get_genome_summary",
  "arguments": {
    "accession": "GCF_000005845.2"
  }
}
```

### Gene Research

```javascript
// Search for BRCA1 gene
{
  "tool": "search_genes",
  "arguments": {
    "gene_symbol": "BRCA1",
    "organism": "Homo sapiens",
    "max_results": 5
  }
}

// Get detailed gene information
{
  "tool": "get_gene_info",
  "arguments": {
    "gene_id": 672,
    "include_sequences": true
  }
}

// Get gene sequences
{
  "tool": "get_gene_sequences",
  "arguments": {
    "gene_id": 672,
    "sequence_type": "transcript"
  }
}
```

### Taxonomic Analysis

```javascript
// Search taxonomy by organism name
{
  "tool": "search_taxonomy",
  "arguments": {
    "query": "Escherichia coli",
    "max_results": 10
  }
}

// Get detailed taxonomic information
{
  "tool": "get_taxonomy_info",
  "arguments": {
    "tax_id": 511145,
    "include_lineage": true
  }
}

// Get organism information
{
  "tool": "get_organism_info",
  "arguments": {
    "organism": "Escherichia coli"
  }
}
```

### Assembly Operations

```javascript
// Search assemblies with filtering
{
  "tool": "search_assemblies",
  "arguments": {
    "query": "human",
    "assembly_level": "chromosome",
    "assembly_source": "refseq",
    "max_results": 20
  }
}

// Get assembly information
{
  "tool": "get_assembly_info",
  "arguments": {
    "assembly_accession": "GCF_000001405.40",
    "include_annotation": true
  }
}

// Batch assembly lookup
{
  "tool": "batch_assembly_info",
  "arguments": {
    "accessions": ["GCF_000001405.40", "GCF_000005825.2", "GCF_000002305.1"]
  }
}
```

### Comparative Genomics

```javascript
// Compare multiple genomes
{
  "tool": "compare_genomes",
  "arguments": {
    "accessions": ["GCF_000005845.2", "GCF_000001405.40"],
    "comparison_type": "basic_stats",
    "include_orthologs": true
  }
}

// Find orthologous genes
{
  "tool": "find_orthologs",
  "arguments": {
    "gene_symbol": "BRCA1",
    "source_organism": "Homo sapiens",
    "target_organisms": ["Mus musculus", "Rattus norvegicus"],
    "similarity_threshold": 80
  }
}
```

### Virus Research

```javascript
// Search viral genomes
{
  "tool": "search_virus_genomes",
  "arguments": {
    "virus_name": "SARS-CoV-2",
    "host": "Homo sapiens",
    "max_results": 50
  }
}

// Get viral genome information
{
  "tool": "get_virus_info",
  "arguments": {
    "accession": "NC_045512.2",
    "include_proteins": true,
    "include_metadata": true
  }
}
```

## Resource Templates

The server provides resource templates for direct data access:

- `ncbi://genome/{accession}` - Complete genome assembly information
- `ncbi://gene/{gene_id}` - Gene information with annotations
- `ncbi://taxonomy/{tax_id}` - Taxonomic classification and lineage
- `ncbi://assembly/{assembly_accession}` - Assembly metadata and statistics
- `ncbi://search/{data_type}/{query}` - Search results for specified queries

## API Rate Limits

- **Without API key**: 3 requests per second
- **With API key**: 10 requests per second with priority access

To obtain an API key, visit: https://www.ncbi.nlm.nih.gov/account/settings/

## Error Handling

The server implements comprehensive error handling:

- **Network errors**: Automatic retry with exponential backoff
- **Rate limiting**: Intelligent request queuing and throttling
- **Invalid parameters**: Clear validation error messages
- **API errors**: Detailed error reporting with context

## Data Sources

This server accesses data from:

- **NCBI Datasets API v2**: Primary genomic and assembly data
- **NCBI Taxonomy**: Taxonomic classifications and lineages
- **NCBI Gene**: Gene annotations and sequences
- **NCBI Assembly**: Assembly metadata and quality metrics
- **NCBI BioProject/BioSample**: Project and sample information

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit issues, feature requests, or pull requests.

## Support

For issues related to:

- **Server functionality**: Open an issue in this repository
- **NCBI data**: Consult NCBI Datasets documentation
- **API access**: Contact NCBI support for API-related questions
