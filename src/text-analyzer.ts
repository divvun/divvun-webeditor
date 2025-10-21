/**
 * TextAnalyzer - Handles core text checking logic and performance optimization
 *
 * This class encapsulates all the logic for analyzing text content
 * and coordinating with the checking API.
 */

import type { CheckerApi, CheckerError, SupportedLanguage } from "./types.ts";

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
      // Check line-by-line
      const lines = currentText.split("\n");
      const allErrors: CheckerError[] = [];

      // Check each line
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
   * Check a specific line only - for line-specific grammar checking
   * This is the public API for checking individual lines
   */
  async checkSpecificLine(lineNumber: number): Promise<CheckerError[]> {
    // Use the existing private method but notify callbacks about line-specific results
    const errors = await this.checkSingleLine(lineNumber);

    // Notify callbacks with line-specific information
    if (errors.length > 0) {
      this.callbacks.onErrorsFound(errors, lineNumber);
      this.callbacks.onUpdateErrorCount(errors.length);
    }

    return errors;
  }

  /**
   * Check a single line
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

    // Check with API
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
   * Clear all cached data (no longer used, kept for compatibility)
   */
  clearCache(): void {
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
   * Check and highlight a specific line atomically
   * This is the main entry point for line-by-line checking + highlighting
   */
  async checkAndHighlightLine(
    lineNumber: number,
    highlighter: {
      highlightSpecificLine: (
        lineNumber: number,
        errors: CheckerError[]
      ) => void;
      clearSpecificLine: (lineNumber: number, lineLength: number) => void;
    }
  ): Promise<CheckerError[]> {
    console.log(`🧪 checkAndHighlightLine ENTERED for line ${lineNumber}`);

    try {
      // First, check the line
      console.log(`🔍 About to call checkSpecificLine for line ${lineNumber}`);
      const errors = await this.checkSpecificLine(lineNumber);
      console.log(
        `✅ checkSpecificLine completed for line ${lineNumber}, found ${errors.length} errors`
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
        error
      );
      throw error;
    }
  }
}
