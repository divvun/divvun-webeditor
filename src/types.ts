// Type definitions for the Divvun Text Checker

// The api provides language codes as strings
export type SupportedLanguage = string;

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

export interface CheckerApi {
  checkText(
    text: string,
    language: SupportedLanguage,
  ): Promise<CheckerResponse>;
}

export interface TextCheckerConfig {
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
  | "idle" // Ready for user input
  | "editing" // User is making changes (debouncing)
  | "checking" // Performing text check AND highlighting (atomic operation)
  | "failed"; // Text check failed, awaiting retry

export interface CheckingContext {
  abortController: AbortController;
  startTime: Date;
  affectedLines?: number[];
}

// API Server Response Types
export interface ApiLanguageResponse {
  available: {
    grammar: Record<string, string>;
    hyphenation: Record<string, string>;
    speller: Record<string, string>;
  };
}

export type ApiEnvironment = "stable" | "beta" | "dev";

export type CheckerType = "grammar" | "speller";

export interface CheckerCombination {
  code: SupportedLanguage;
  name: string;
  type: CheckerType;
  environment: ApiEnvironment;
}

// Helper type for the selector value format: "code|environment|type"
// e.g., "se|stable|grammar" or "sms|beta|speller"
export type LanguageSelectorValue = string;

// Text-to-Speech Types
export interface TTSVoice {
  code: SupportedLanguage;
  name: string;
  voice: string;
  voiceLabel: string;
  gender?: "male" | "female";
}

export interface TTSRequest {
  text: string;
}
