// Type definitions for the Divvun Grammar Checker

export type SupportedLanguage =
  | "se"
  | "sma"
  | "smj"
  | "smn"
  | "fo"
  | "ga"
  | "kl"
  | "nb";

export interface GrammarCheckerError {
  error_text: string;
  start_index: number;
  end_index: number;
  error_code: string;
  description: string;
  suggestions: string[];
  title: string;
}

export interface GrammarCheckerResponse {
  text: string;
  errs: GrammarCheckerError[];
}

export interface GrammarCheckerConfig {
  language: SupportedLanguage;
  apiUrl: string;
  autoCheckDelay: number;
  maxRetries: number;
}

export interface ErrorSpan {
  element: HTMLElement;
  error: GrammarCheckerError;
  startOffset: number;
  endOffset: number;
}

export interface EditorState {
  lastCheckedContent: string;
  errors: GrammarCheckerError[];
  isChecking: boolean;
  errorSpans: ErrorSpan[];
}

// State Machine Types
export type CheckerState =
  | "idle"
  | "editing"
  | "timeout"
  | "checking"
  | "highlighting";

export interface StateTransition {
  from: CheckerState;
  to: CheckerState;
  trigger: string;
  timestamp: Date;
}

export interface CheckingContext {
  abortController: AbortController;
  startTime: Date;
  affectedLines?: number[];
}

export interface LineCacheEntry {
  content: string;
  errors: GrammarCheckerError[];
  timestamp: Date;
}
