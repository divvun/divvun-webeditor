// Type definitions for the Divvun Grammar Checker

export type SupportedLanguage = 'se' | 'sma' | 'smj' | 'fao';

export interface DivvunError {
  error_text: string;
  start_index: number;
  end_index: number;
  error_code: string;
  description: string;
  suggestions: string[];
  title: string;
}

export interface DivvunResponse {
  text: string;
  errs: DivvunError[];
}

export interface GrammarCheckerConfig {
  language: SupportedLanguage;
  apiUrl: string;
  autoCheckDelay: number;
  maxRetries: number;
}

export interface ErrorSpan {
  element: HTMLElement;
  error: DivvunError;
  startOffset: number;
  endOffset: number;
}

export interface EditorState {
  lastCheckedContent: string;
  errors: DivvunError[];
  isChecking: boolean;
  errorSpans: ErrorSpan[];
}