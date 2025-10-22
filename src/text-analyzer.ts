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
      const lines = this.getTextLines();

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
   * Get text lines from editor
   * @returns Array of text lines
   */
  private getTextLines(): string[] {
    return this.editor.getText().split("\n");
  }

  /**
   * Get line text with newline character if not the last line
   * @param lines - Array of text lines
   * @param lineIndex - 0-based line index
   * @returns Line text with newline if appropriate
   */
  private getLineWithNewline(lines: string[], lineIndex: number): string {
    const line = lines[lineIndex];
    return lineIndex < lines.length - 1 ? line + "\n" : line;
  }

  /**
   * Calculate the character position of a line in the full document
   * @param lines - Array of text lines
   * @param lineNumber - 0-based line number
   * @returns Character offset from start of document
   */
  private calculateLineOffset(lines: string[], lineNumber: number): number {
    let offset = 0;
    for (let i = 0; i < lineNumber; i++) {
      offset += this.getLineWithNewline(lines, i).length;
    }
    return offset;
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
    // Note: We only care about leading whitespace, not trailing (like newlines)
    const leadingWhitespace = lineText.length - lineText.trimStart().length;
    const apiLeadingWhitespace = response.text.length -
      response.text.trimStart().length;
    const trimOffset = leadingWhitespace - apiLeadingWhitespace;

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
    const lines = this.getTextLines();

    if (lineNumber < 0 || lineNumber >= lines.length) {
      console.warn(`Invalid line number: ${lineNumber}`);
      return [];
    }

    const lineWithNewline = this.getLineWithNewline(lines, lineNumber);
    const lineStartPosition = this.calculateLineOffset(lines, lineNumber);

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
    const lines = this.getTextLines();
    const allErrors: CheckerError[] = [];

    // Validate range
    const validStartLine = Math.max(0, startLine);
    const validEndLine = Math.min(lines.length - 1, endLine);

    let currentIndex = 0;

    // Check each line in the range
    for (let i = 0; i < lines.length; i++) {
      const lineWithNewline = this.getLineWithNewline(lines, i);

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

  /**
   * Get the character offset where a line starts in the document
   * @param lineNumber - 0-based line number
   * @param lines - Array of text lines
   * @returns Character offset from start of document
   */
  getLineStartIndex(lineNumber: number, lines: string[]): number {
    if (lineNumber === 0) {
      return 0;
    }

    let index = 0;
    for (let i = 0; i < lineNumber; i++) {
      index += this.getLineWithNewline(lines, i).length;
    }
    return index;
  }

  /**
   * Find which line contains a specific error
   * @param error - The error to locate
   * @returns Line information including line number, content, and position within line
   */
  getLineFromError(error: CheckerError): {
    lineNumber: number;
    lineContent: string;
    positionInLine: number;
  } {
    const lines = this.getTextLines();
    let currentIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineWithNewline = this.getLineWithNewline(lines, i);
      const lineStart = currentIndex;
      const lineEnd = currentIndex + lineWithNewline.length;

      // Check if the error falls within this line
      if (error.start_index >= lineStart && error.start_index < lineEnd) {
        return {
          lineNumber: i, // 0-based line numbering for internal consistency
          lineContent: line,
          positionInLine: error.start_index - lineStart,
        };
      }

      currentIndex += lineWithNewline.length;
    }

    // Fallback if line not found
    return {
      lineNumber: 0,
      lineContent: lines[0] || "",
      positionInLine: error.start_index,
    };
  }

  /**
   * Remove errors that fall within a specific character range
   * @param errors - Current error array
   * @param startIndex - Start of range (inclusive)
   * @param endIndex - End of range (exclusive)
   * @returns Filtered error array
   */
  removeErrorsInRange(
    errors: CheckerError[],
    startIndex: number,
    endIndex: number,
  ): CheckerError[] {
    return errors.filter((error) => {
      return error.start_index < startIndex || error.start_index >= endIndex;
    });
  }

  /**
   * Adjust error indices after a text edit
   * @param errors - Current error array
   * @param position - Position where edit occurred
   * @param lengthDifference - Net change in length (positive = insertion, negative = deletion)
   * @returns Error array with adjusted indices
   */
  adjustErrorIndices(
    errors: CheckerError[],
    position: number,
    lengthDifference: number,
  ): CheckerError[] {
    if (lengthDifference === 0) {
      return errors;
    }

    return errors.map((error) => {
      if (error.start_index > position) {
        return {
          ...error,
          start_index: error.start_index + lengthDifference,
          end_index: error.end_index + lengthDifference,
        };
      }
      return error;
    });
  }

  /**
   * Check a range of lines and return updated error array
   * This combines checking with error state management
   *
   * @param errors - Current error array
   * @param startLine - Start line (inclusive)
   * @param endLine - End line (inclusive)
   * @param onProgress - Optional progress callback
   * @returns Updated error array with old errors removed and new errors added
   */
  async checkLinesAndUpdateErrors(
    errors: CheckerError[],
    startLine: number,
    endLine: number,
    onProgress?: (message: string) => void,
  ): Promise<CheckerError[]> {
    const lines = this.getTextLines();
    const currentText = this.editor.getText();

    // Calculate the character range being checked
    const startIndex = this.getLineStartIndex(startLine, lines);
    const endIndex = endLine < lines.length - 1
      ? this.getLineStartIndex(endLine + 1, lines)
      : currentText.length;

    // Remove all errors in the range being rechecked
    let updatedErrors = this.removeErrorsInRange(errors, startIndex, endIndex);

    // Check the range using cache-aware checking
    const newErrors = await this.checkMultipleLinesForStateManagement(
      startLine,
      endLine,
      onProgress,
    );

    // Add the new errors
    updatedErrors = [...updatedErrors, ...newErrors];

    return updatedErrors;
  }

  /**
   * Recheck a single modified line and return updated error array
   * @param errors - Current error array
   * @param lineNumber - 0-based line number to recheck
   * @returns Updated error array
   */
  async recheckLineAndUpdateErrors(
    errors: CheckerError[],
    lineNumber: number,
  ): Promise<CheckerError[]> {
    const lines = this.getTextLines();

    if (lineNumber < 0 || lineNumber >= lines.length) {
      console.warn(`Invalid line number: ${lineNumber}`);
      return errors;
    }

    const lineWithNewline = this.getLineWithNewline(lines, lineNumber);
    const lineStartPosition = this.getLineStartIndex(lineNumber, lines);

    console.log(`Rechecking line ${lineNumber}: "${lines[lineNumber]}"`);

    // Check the line
    const adjustedErrors = await this.checkLineForStateManagement(lineNumber);

    // Remove any existing errors from this line first
    const lineEnd = lineStartPosition + lineWithNewline.length;
    let updatedErrors = this.removeErrorsInRange(
      errors,
      lineStartPosition,
      lineEnd,
    );

    // Add new errors from the rechecked line
    updatedErrors = [...updatedErrors, ...adjustedErrors];

    console.log(
      `Line ${lineNumber} recheck complete. Found ${adjustedErrors.length} errors.`,
    );

    return updatedErrors;
  }
}
