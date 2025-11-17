export interface ReasoningStep {
  id: string;
  stage: string;
  message: string;
  iteration?: number;
  timestamp: Date;
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
