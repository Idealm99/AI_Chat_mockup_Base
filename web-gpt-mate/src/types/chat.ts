export interface ToolLog {
  id: string;
  name: string;
  description?: string;
  inputArgs?: unknown;
  outputResult?: unknown;
  outputPreview?: string;
  timestamp?: Date;
  stageKey?: string;
  stageTitle?: string;
  serverName?: string;
  rawToolName?: string;
}

export interface ReasoningStep {
  id: string;
  stage: string;
  message: string;
  iteration?: number;
  timestamp: Date;
  toolLog?: ToolLog;
  stageKey?: string;
  isStageSummary?: boolean;
  toolLogs?: ToolLog[];
}

export interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
  reasoningSteps?: ReasoningStep[];
  isThinking?: boolean;
  references?: DocumentReference[];
}

export interface DocumentReference {
  fileName: string;
  page?: number | string | null;
  position?: number | string | null;
  contentSnippet?: string;
}

export interface KnowledgeGraphNode {
  id: string;
  label: string;
  group: "target" | "pathway" | "compound" | string;
  level: number;
}

export interface KnowledgeGraphLink {
  source: string;
  target: string;
  strength?: number;
}

export interface KnowledgeGraphData {
  nodes: KnowledgeGraphNode[];
  links: KnowledgeGraphLink[];
}

export interface StructurePanelData {
  pdbUrl?: string;
  pdbId?: string | null;
  target?: string;
  compound?: string;
  bindingPocket?: string;
  bindingModeImage?: string;
  summary?: string;
}

export interface LinkageInfo {
  target?: string;
  compound?: string;
  smiles?: string;
  mechanism?: string;
  references?: string[] | null;
}

export interface ReportCardMedia {
  type: "image" | "video" | "3d";
  url: string;
  caption?: string;
}

export interface ReportCard {
  title: string;
  summary: string;
  media?: ReportCardMedia[];
  tags?: string[];
}

export interface UiPayload {
  knowledge_graph?: KnowledgeGraphData;
  knowledgeGraph?: KnowledgeGraphData;
  structure_panel?: StructurePanelData;
  structurePanel?: StructurePanelData;
  linkage?: LinkageInfo;
  report_cards?: ReportCard[];
  reportCards?: ReportCard[];
}
