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
}
