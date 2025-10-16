// Type definitions for the Divvun Grammar Checker

export type SupportedLanguage =
  | "se"
  | "sma"
  | "smj"
  | "smn"
  | "sms"
  | "fo"
  | "ga"
  | "kl"
  | "nb";

export interface CheckerError {
  error_text: string;
  start_index: number;
  end_index: number;
  error_code: string;
  description: string;
  suggestions: string[];
  title: string;
}

// New spell checker API response format
export interface SpellSuggestion {
  value: string;
  weight: number;
}

export interface SpellResult {
  word: string;
  is_correct: boolean;
  suggestions: SpellSuggestion[];
}

export interface SpellCheckerResponse {
  results: SpellResult[];
}

export interface CheckerResponse {
  text: string;
  errs: CheckerError[];
}

export interface GrammarCheckerConfig {
  language: SupportedLanguage;
  apiUrl: string;
  autoCheckDelay: number;
  maxRetries: number;
}

export interface ErrorSpan {
  element: HTMLElement;
  error: CheckerError;
  startOffset: number;
  endOffset: number;
}

export interface EditorState {
  lastCheckedContent: string;
  errors: CheckerError[];
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
  errors: CheckerError[];
  timestamp: Date;
}
