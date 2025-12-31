// API Response Types for Open Genes API

export interface GeneSearchParams {
  lang?: 'en' | 'ru';
  page?: number;
  pageSize?: number;
  sortOrder?: 'ASC' | 'DESC';
  sortBy?: string;
  byDiseases?: string;
  byDiseaseCategories?: string;
  byAgeRelatedProcess?: string;
  byExpressionChange?: string;
  bySelectionCriteria?: string;
  byAgingMechanism?: string;
  byAgingMechanismUUID?: string;
  byProteinClass?: string;
  bySpecies?: string;
  byOrigin?: string;
  byFamilyOrigin?: string;
  byConservativeIn?: string;
  byGeneId?: string;
  byGeneSymbol?: string;
  bySuggestions?: string;
  byChromosomeNum?: string;
  researches?: string;
  isHidden?: string;
  confidenceLevel?: string;
}

export interface Gene {
  id: number;
  symbol: string;
  name: string;
  ncbiId: number;
  uniprot?: string;
  aliases?: string[];
  description?: string;
  homologueTaxon?: string;
  origin?: string;
  familyOrigin?: string;
  conservativeIn?: string;
  expressionChange?: number;
  band?: string;
  locationStart?: number;
  locationEnd?: number;
  orientation?: number;
  accPromoter?: string;
  accOrf?: string;
  accCds?: string;
  chromosome?: string;
  diseases?: Disease[];
  proteinClasses?: ProteinClass[];
  agingMechanisms?: AgingMechanism[];
  researches?: Research[];
  timestamp?: string;
}

export interface Disease {
  id: number;
  name: string;
  icdCode?: string;
  icdVersion?: string;
  categories?: DiseaseCategory[];
}

export interface DiseaseCategory {
  id: number;
  name: string;
  parent?: number;
}

export interface ProteinClass {
  id: number;
  name: string;
  description?: string;
}

export interface AgingMechanism {
  id: number;
  name: string;
  description?: string;
  uuid?: string;
}

export interface Research {
  id: number;
  name: string;
  description?: string;
  doi?: string;
  pmid?: string;
}

export interface ModelOrganism {
  id: number;
  name: string;
  latinName: string;
  taxon?: string;
  lifespan?: number;
}

export interface Phylum {
  id: number;
  name: string;
  latinName?: string;
}

export interface CalorieExperiment {
  id: number;
  name: string;
  description?: string;
  species?: string;
  lifespan?: number;
  lifespanChange?: number;
  lifespanChangePercent?: number;
}

export interface ApiResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface GeneByIdParams {
  id: string;
  lang?: 'en' | 'ru';
}

export interface GeneBySymbolParams {
  symbol: string;
  lang?: 'en' | 'ru';
}

export interface GeneSuggestionsParams {
  lang?: 'en' | 'ru';
}

export interface GeneByFunctionalClusterParams {
  ids: string;
  lang?: 'en' | 'ru';
  page?: number;
  pageSize?: number;
}

export interface GeneBySelectionCriteriaParams {
  ids: string;
  lang?: 'en' | 'ru';
  page?: number;
  pageSize?: number;
}

export interface GeneByGoTermParams {
  term: string;
  lang?: 'en' | 'ru';
  page?: number;
  pageSize?: number;
}

export interface GeneByExpressionChangeParams {
  expressionChange: string;
  lang?: 'en' | 'ru';
  page?: number;
  pageSize?: number;
}

export interface BaseParams {
  lang?: 'en' | 'ru';
  page?: number;
  pageSize?: number;
}
