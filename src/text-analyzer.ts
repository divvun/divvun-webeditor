/**
 * TextAnalyzer - Handles core text checking logic, line caching, and performance optimization
 *
 * This class encapsulates all the logic for analyzing text content, managing
 * line-based caching for performance, and coordinating with the checking API.
 */

import type {
  CheckerApi,
  CheckerError,
  LineCacheEntry,
  SupportedLanguage,
} from "./types.ts";

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

export class TextAnalyzer {
  private api: CheckerApi;
  private editor: EditorTextInterface;
  private callbacks: TextAnalysisCallbacks;
  private lineCache: Map<number, LineCacheEntry> = new Map();
  private lastCheckedContent: string = "";
  private currentLanguage: SupportedLanguage;
  private checkingContext: CheckingContext | null = null;

  constructor(
    api: CheckerApi,
    editor: EditorTextInterface,
    callbacks: TextAnalysisCallbacks,
    initialLanguage: SupportedLanguage
  ) {
    this.api = api;
    this.editor = editor;
    this.callbacks = callbacks;
    this.currentLanguage = initialLanguage;
  }

  /**
   * Update the API instance (e.g., when language changes)
   */
  updateApi(newApi: CheckerApi): void {
    this.api = newApi;
    // Clear cache when API changes as different APIs may give different results
    this.clearCache();
  }

  /**
   * Update the current language
   */
  updateLanguage(language: SupportedLanguage): void {
    if (language !== this.currentLanguage) {
      this.currentLanguage = language;
      // Clear cache when language changes
      this.clearCache();
    }
  }

  /**
   * Main grammar checking method
   */
  async checkGrammar(): Promise<void> {
    const currentText = this.editor.getText();

    // Don't check if content hasn't changed or is empty
    if (!currentText || currentText.trim() === "") {
      return;
    }

    // Skip if content hasn't changed
    if (currentText === this.lastCheckedContent) {
      return;
    }

    try {
      // Use line-by-line checking with caching
      const lines = currentText.split("\n");
      const allErrors: CheckerError[] = [];

      // Check each line that might have changed
      for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
        // Check if we should abort (user might have interrupted)
        if (this.checkingContext?.abortController.signal.aborted) {
          console.debug("Grammar check aborted by user");
          return;
        }

        const lineErrors = await this.checkSingleLine(lineNumber);
        allErrors.push(...lineErrors);

        // Highlight this line's errors immediately if any found
        if (lineErrors.length > 0) {
          this.callbacks.onErrorsFound(lineErrors, lineNumber);
          // Update error count progressively
          this.callbacks.onUpdateErrorCount(allErrors.length);
        }
      }

      // Store the checked content
      this.lastCheckedContent = currentText;

      // Update final error count and notify about all errors
      this.callbacks.onUpdateErrorCount(allErrors.length);
      this.callbacks.onErrorsFound(allErrors);
    } catch (error) {
      console.error("Grammar check failed:", error);
      this.callbacks.onUpdateStatus("Error checking grammar", false);
      this.callbacks.onShowErrorMessage(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Check a single line with caching
   */
  private async checkSingleLine(lineNumber: number): Promise<CheckerError[]> {
    const text = this.editor.getText();
    const lines = text.split("\n");

    if (lineNumber < 0 || lineNumber >= lines.length) {
      return [];
    }

    const lineContent = lines[lineNumber];

    // Skip empty or whitespace-only lines
    if (!lineContent || lineContent.trim().length === 0) {
      return [];
    }

    // Check cache first
    const cached = this.lineCache.get(lineNumber);
    if (cached && cached.content === lineContent) {
      const age = Date.now() - cached.timestamp.getTime();
      if (age < 30000) {
        // Cache valid for 30 seconds
        return cached.errors;
      }
    }

    // Cache miss or expired - check with API
    try {
      const response = await this.api.checkText(
        lineContent,
        this.currentLanguage
      );
      const errors = response.errs || [];

      // Adjust error indices to match document position
      const lineStartIndex = this.getLineStartIndex(lineNumber, lines);
      const adjustedErrors = errors.map((error: CheckerError) => ({
        ...error,
        start_index: error.start_index + lineStartIndex,
        end_index: error.end_index + lineStartIndex,
      }));

      // Cache the results
      this.lineCache.set(lineNumber, {
        content: lineContent,
        errors: adjustedErrors,
        timestamp: new Date(),
      });

      return adjustedErrors;
    } catch (error) {
      console.warn(`Failed to check line ${lineNumber}:`, error);
      return [];
    }
  }

  /**
   * Get the starting index of a line in the document
   */
  private getLineStartIndex(lineNumber: number, lines: string[]): number {
    if (lineNumber === 0) {
      return 0;
    }

    let index = 0;
    // Sum up all previous lines plus their newline characters
    for (let i = 0; i < lineNumber; i++) {
      index += lines[i].length + 1; // +1 for the \n character
    }
    return index;
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
   * Invalidate cache for specific line range
   */
  invalidateLineCache(fromLine: number, toLine: number = fromLine): void {
    for (let i = fromLine; i <= toLine; i++) {
      this.lineCache.delete(i);
    }
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.lineCache.clear();
    this.lastCheckedContent = "";
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
   * Get cache statistics for debugging
   */
  getCacheStats(): {
    size: number;
    entries: Array<{ lineNumber: number; age: number }>;
  } {
    const entries: Array<{ lineNumber: number; age: number }> = [];
    const now = Date.now();

    for (const [lineNumber, entry] of this.lineCache) {
      entries.push({
        lineNumber,
        age: now - entry.timestamp.getTime(),
      });
    }

    return {
      size: this.lineCache.size,
      entries,
    };
  }
}
