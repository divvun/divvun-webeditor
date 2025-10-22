/**
 * TextAnalyzer - Handles core text checking logic and performance optimization
 *
 * This class encapsulates all the logic for analyzing text content
 * and coordinating with the checking API.
 */

import type {
  CheckerApi,
  CheckerError,
  CheckerResponse,
  SupportedLanguage,
} from "./types.ts";
import { LRUCache } from "./lru-cache.ts";

// Minimal editor interface for text analysis
interface EditorTextInterface {
  getText(): string;
  getLength(): number;
}

export interface TextAnalysisCallbacks {
  onErrorsFound: (errors: CheckerError[], lineNumber?: number) => void;
  onUpdateErrorCount: (count: number) => void;
  onUpdateStatus: (status: string, isChecking: boolean) => void;
  onShowErrorMessage: (message: string) => void;
}

export interface CheckingContext {
  abortController: AbortController;
  startTime: Date;
}

/**
 * Maximum number of items to store in the text analysis cache
 */
const TEXT_ANALYZER_CACHE_SIZE = 1000;

export class TextAnalyzer {
  private api: CheckerApi;
  private editor: EditorTextInterface;
  private callbacks: TextAnalysisCallbacks;
  private lastCheckedContent: string = "";
  private currentLanguage: SupportedLanguage;
  private checkingContext: CheckingContext | null = null;
  private cache: LRUCache<string, CheckerResponse>;

  constructor(
    api: CheckerApi,
    editor: EditorTextInterface,
    callbacks: TextAnalysisCallbacks,
    initialLanguage: SupportedLanguage,
  ) {
    this.api = api;
    this.editor = editor;
    this.callbacks = callbacks;
    this.currentLanguage = initialLanguage;
    this.cache = new LRUCache(TEXT_ANALYZER_CACHE_SIZE);
  }

  /**
   * Update the API instance (e.g., when language changes)
   */
  updateApi(newApi: CheckerApi): void {
    this.api = newApi;
    // Clear last checked content when API changes
    this.lastCheckedContent = "";
  }

  /**
   * Update the current language
   */
  updateLanguage(language: SupportedLanguage): void {
    if (language !== this.currentLanguage) {
      this.currentLanguage = language;
      // Clear last checked content when language changes
      this.lastCheckedContent = "";
      // Clear cache when language changes
      this.cache.clear();
    }
  }

  /**
   * Check a specific line only - for line-specific text checking
   * Uses cache-aware checking for optimal performance
   */
  async checkSpecificLine(lineNumber: number): Promise<CheckerError[]> {
    // Use the cache-aware method for checking
    const errors = await this.checkLineForStateManagement(lineNumber);

    // Notify callbacks with line-specific information
    if (errors.length > 0) {
      this.callbacks.onErrorsFound(errors, lineNumber);
      this.callbacks.onUpdateErrorCount(errors.length);
    }

    return errors;
  }

  /**
   * Main text checking method - checks entire document using cache-aware approach
   */
  async checkText(): Promise<void> {
    const currentText = this.editor.getText();

    // Don't check if content is empty
    if (!currentText || currentText.trim() === "") {
      return;
    }

    // Skip if content hasn't changed
    if (currentText === this.lastCheckedContent) {
      return;
    }

    try {
      const lines = currentText.split("\n");

      // Check if we should abort (user might have interrupted)
      if (this.checkingContext?.abortController.signal.aborted) {
        console.debug("Text check aborted by user");
        return;
      }

      // Use cache-aware multi-line checking for all lines
      const allErrors = await this.checkMultipleLinesForStateManagement(
        0,
        lines.length - 1,
        (message) => this.callbacks.onUpdateStatus(message, true),
      );

      // Store the checked content
      this.lastCheckedContent = currentText;

      // Update final error count and notify about all errors
      this.callbacks.onUpdateErrorCount(allErrors.length);
      this.callbacks.onErrorsFound(allErrors);
    } catch (error) {
      console.error("Text check failed:", error);
      this.callbacks.onUpdateStatus("Error checking text", false);
      this.callbacks.onShowErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Get line number from character index
   */
  getLineNumberFromIndex(index: number): number {
    const text = this.editor.getText();
    const lines = text.substring(0, index).split("\n");
    return lines.length - 1; // 0-based line number
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.lastCheckedContent = "";
    this.cache.clear();
  }

  /**
   * Set up checking context for abort handling
   */
  startCheckingContext(): CheckingContext {
    this.checkingContext = {
      abortController: new AbortController(),
      startTime: new Date(),
    };
    return this.checkingContext;
  }

  /**
   * Clean up checking context
   */
  clearCheckingContext(): void {
    if (this.checkingContext?.abortController) {
      this.checkingContext.abortController.abort();
    }
    this.checkingContext = null;
  }

  /**
   * Check if content has changed since last check
   */
  hasContentChanged(): boolean {
    const currentText = this.editor.getText();
    return currentText !== this.lastCheckedContent;
  }

  /**
   * Get current checking context
   */
  getCheckingContext(): CheckingContext | null {
    return this.checkingContext;
  }

  /**
   * Check and highlight a specific line atomically
   * This is the main entry point for line-by-line checking + highlighting
   * Uses cache-aware checking for optimal performance
   */
  async checkAndHighlightLine(
    lineNumber: number,
    highlighter: {
      highlightSpecificLine: (
        lineNumber: number,
        errors: CheckerError[],
      ) => void;
      clearSpecificLine: (lineNumber: number, lineLength: number) => void;
    },
  ): Promise<CheckerError[]> {
    console.log(`🧪 checkAndHighlightLine ENTERED for line ${lineNumber}`);

    try {
      // Use cache-aware checking
      console.log(
        `🔍 About to call checkLineForStateManagement for line ${lineNumber}`,
      );
      const errors = await this.checkLineForStateManagement(lineNumber);
      console.log(
        `✅ checkLineForStateManagement completed for line ${lineNumber}, found ${errors.length} errors`,
      );

      // Then apply highlighting
      console.log(`🎨 About to apply highlighting for line ${lineNumber}`);
      const text = this.editor.getText();
      const lines = text.split("\n");
      if (lineNumber >= 0 && lineNumber < lines.length) {
        const lineContent = lines[lineNumber];
        // Clear old highlights for this line
        highlighter.clearSpecificLine(lineNumber, lineContent.length);
        // Apply new highlights if there are errors
        if (errors.length > 0) {
          highlighter.highlightSpecificLine(lineNumber, errors);
        }
      }
      console.log(`✅ Highlighting completed for line ${lineNumber}`);

      console.log(`🏁 checkAndHighlightLine COMPLETED for line ${lineNumber}`);
      return errors;
    } catch (error) {
      console.error(
        `❌ Error in checkAndHighlightLine for line ${lineNumber}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Check a single line of text with cache-aware API call
   * This is the core method that handles cache checking, API calls, and index adjustment
   *
   * @param lineText - The line text to check (with or without newline)
   * @param documentOffset - The character position of this line in the full document
   * @param lineNumber - The 0-based line number (for logging purposes)
   * @returns Array of errors with indices adjusted to document position
   */
  private async checkLineWithCache(
    lineText: string,
    documentOffset: number,
    lineNumber: number,
  ): Promise<CheckerError[]> {
    // Skip empty lines
    if (!lineText.trim()) {
      return [];
    }

    // Create cache key
    const cacheKey = `${this.currentLanguage}:${lineText}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    let response: CheckerResponse;

    if (cached) {
      console.debug(
        `📦 Cache hit for line ${lineNumber} (${lineText.length} chars)`,
      );
      response = cached;
    } else {
      console.debug(`🌐 Cache miss for line ${lineNumber}, calling API`);
      try {
        response = await this.api.checkText(
          lineText,
          this.currentLanguage,
        );
        // Store in cache
        this.cache.set(cacheKey, response);
      } catch (error) {
        console.warn(`Error checking line ${lineNumber}:`, error);
        return [];
      }
    }

    // Check if API trimmed leading whitespace from the text
    const trimOffset = lineText.length - response.text.length;

    // Adjust error indices to account for:
    // 1. Position in full text (documentOffset)
    // 2. Any leading whitespace trimmed by API (trimOffset)
    const adjustedErrors = response.errs.map((error) => ({
      ...error,
      start_index: error.start_index + documentOffset + trimOffset,
      end_index: error.end_index + documentOffset + trimOffset,
    }));

    return adjustedErrors;
  }

  /**
   * Check a single line and return adjusted errors for state management
   * This method does NOT trigger callbacks - it's for use by main.ts error state management
   *
   * @param lineNumber - 0-based line number to check
   * @returns Array of errors with indices adjusted to document position
   */
  async checkLineForStateManagement(
    lineNumber: number,
  ): Promise<CheckerError[]> {
    const text = this.editor.getText();
    const lines = text.split("\n");

    if (lineNumber < 0 || lineNumber >= lines.length) {
      console.warn(`Invalid line number: ${lineNumber}`);
      return [];
    }

    const line = lines[lineNumber];
    const lineWithNewline = lineNumber < lines.length - 1 ? line + "\n" : line;

    // Calculate the start position of this line in the full text
    let lineStartPosition = 0;
    for (let i = 0; i < lineNumber; i++) {
      const prevLine = lines[i];
      const prevLineWithNewline = i < lines.length - 1
        ? prevLine + "\n"
        : prevLine;
      lineStartPosition += prevLineWithNewline.length;
    }

    // Use the unified cache-aware checking method
    return await this.checkLineWithCache(
      lineWithNewline,
      lineStartPosition,
      lineNumber,
    );
  }

  /**
   * Check multiple lines and return all adjusted errors for state management
   * This method does NOT trigger callbacks - it's for use by main.ts error state management
   *
   * @param startLine - 0-based start line number (inclusive)
   * @param endLine - 0-based end line number (inclusive)
   * @param onProgress - Optional callback for progress updates (e.g., "Checking line 5...")
   * @returns Array of all errors from all lines with indices adjusted to document position
   */
  async checkMultipleLinesForStateManagement(
    startLine: number,
    endLine: number,
    onProgress?: (message: string) => void,
  ): Promise<CheckerError[]> {
    const text = this.editor.getText();
    const lines = text.split("\n");
    const allErrors: CheckerError[] = [];

    // Validate range
    const validStartLine = Math.max(0, startLine);
    const validEndLine = Math.min(lines.length - 1, endLine);

    let currentIndex = 0;

    // Check each line in the range
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineWithNewline = i < lines.length - 1 ? line + "\n" : line;

      if (i >= validStartLine && i <= validEndLine) {
        // Check this line
        if (lineWithNewline.trim()) {
          if (onProgress) {
            onProgress(`Checking affected line ${i + 1}...`);
          }

          // Use the unified cache-aware checking method
          const errors = await this.checkLineWithCache(
            lineWithNewline,
            currentIndex,
            i,
          );
          allErrors.push(...errors);
        }
      }

      currentIndex += lineWithNewline.length;
    }

    return allErrors;
  }
}
