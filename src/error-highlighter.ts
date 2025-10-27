/**
 * ErrorHighlighter - Handles error highlighting and visual formatting operations
 *
 * This class encapsulates all Quill formatting operations, error highlighting logic,
 * Safari-specific workarounds, and DOM isolation techniques to keep visual formatting
 * separate from business logic.
 */

import type { CheckerError } from "./types.ts";
import type { CursorManager } from "./cursor-manager.ts";

// Minimal editor interface for highlighting operations
interface EditorHighlightInterface {
  root: HTMLElement;
  getLength(): number;
  formatText(
    index: number,
    len: number,
    format: string,
    value: unknown,
    source?: string,
  ): void;
  _quill?: {
    formatText?: (
      index: number,
      len: number,
      format: string,
      value: unknown,
      source?: string,
    ) => void;
    container?: HTMLElement;
    history?: {
      options?: { delay?: number };
      disable?: () => void;
      enable?: () => void;
      clear?: () => void;
      record?: () => void;
    };
    setSelection?: (index: number, length: number, source?: string) => void;
  };
}

export interface HighlightingCallbacks {
  onHighlightingStart: () => void;
  onHighlightingComplete: () => void;
  onHighlightingAborted: () => void; // New: called when highlighting is aborted due to stale data
  onErrorsCleared: () => void;
}

export class ErrorHighlighter {
  private editor: EditorHighlightInterface;
  private cursorManager: CursorManager;
  private callbacks: HighlightingCallbacks;
  private isHighlighting: boolean = false;
  private currentHighlightId: number = 0;
  private isSafari: boolean;
  private static readonly FORMAT_TYPES = [
    "grammar-error",
    "grammar-typo",
    "grammar-other",
  ] as const;

  constructor(
    editor: EditorHighlightInterface,
    cursorManager: CursorManager,
    callbacks: HighlightingCallbacks,
  ) {
    this.editor = editor;
    this.cursorManager = cursorManager;
    this.callbacks = callbacks;
    this.isSafari = ErrorHighlighter.detectSafari();
  }

  /**
   * Detect if browser is Safari
   */
  private static detectSafari(): boolean {
    return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  }

  /**
   * Get the appropriate CSS class for an error
   */
  private static getErrorFormatType(error: CheckerError): string {
    const isTypo = error.error_code === "typo" ||
      (error.title && String(error.title).toLowerCase().includes("typo"));
    return isTypo ? "grammar-typo" : "grammar-other";
  }

  /**
   * Apply formatting to a text range
   */
  private formatTextSilent(
    index: number,
    length: number,
    format: string,
    value: boolean,
  ): void {
    try {
      if (
        this.editor._quill &&
        typeof this.editor._quill.formatText === "function"
      ) {
        this.editor._quill.formatText(index, length, format, value, "silent");
      } else {
        this.editor.formatText(index, length, format, value, "silent");
      }
    } catch (_err) {
      // ignore formatting errors
    }
  }

  /**
   * Clear all format types from a specific range
   */
  private clearAllFormats(startIndex: number, length: number): void {
    for (const formatType of ErrorHighlighter.FORMAT_TYPES) {
      this.formatTextSilent(startIndex, length, formatType, false);
    }
  }

  /**
   * Disable Quill history recording and return a function to restore it
   */
  private disableHistory(): (() => void) | null {
    const quillInstance = this.editor._quill;
    if (!quillInstance?.history) {
      return null;
    }

    const history = quillInstance.history as unknown as {
      record?: () => void;
    };

    if (!history.record) {
      return null;
    }

    const originalHistoryRecord = history.record;
    history.record = () => {}; // Disable recording temporarily

    // Return a function to restore the original
    return () => {
      if (history) {
        history.record = originalHistoryRecord;
      }
    };
  }

  /**
   * Highlight errors for a specific line without clearing existing highlights
   * Returns a Promise that resolves when highlighting is complete
   */
  highlightLineErrors(errors: CheckerError[]): Promise<void> {
    // Cancel any ongoing highlighting operation
    if (this.isHighlighting) {
      console.debug(
        "🔄 Cancelling previous line highlighting to start new operation",
      );
      // Clear the flag to allow new operation
      this.isHighlighting = false;
    }

    // Increment operation ID to track this specific highlighting operation
    const operationId = ++this.currentHighlightId;

    // Set highlighting flag to prevent triggering text checks during line highlighting
    this.isHighlighting = true;
    this.callbacks.onHighlightingStart();

    // Instead of aggressive global clearing, only clear formatting for affected lines
    try {
      if (errors.length > 0) {
        this.clearFormattingForErrors(errors);
      }
    } catch (_err) {
      // ignore
    }

    // Highlight errors for a specific line without clearing existing highlights
    const savedSelection = this.cursorManager.saveCursorPosition();
    // Save document length to detect if text changed during async highlighting
    const savedDocLength = this.editor.getLength();

    if (this.isSafari) {
      // Safari uses synchronous path
      this.performLineHighlightingOperations(errors, savedSelection);
      this.finishHighlighting(operationId);
      return Promise.resolve();
    } else {
      return new Promise((resolve) => {
        requestAnimationFrame(() => {
          try {
            // Check if document changed during async operation
            const currentDocLength = this.editor.getLength();
            const docChanged = currentDocLength !== savedDocLength;

            if (docChanged) {
              console.debug(
                `🔄 Document changed during line highlighting (${savedDocLength} → ${currentDocLength}), aborting stale highlight operation`,
              );
              // Don't highlight with stale error positions - abort and notify callbacks
              this.callbacks.onHighlightingAborted();
              this.finishHighlighting(operationId);
              resolve();
              return;
            }

            this.performLineHighlightingOperations(
              errors,
              savedSelection,
            );
          } catch (error) {
            console.error("Error during line highlighting operations:", error);
          } finally {
            this.finishHighlighting(operationId);
            resolve();
          }
        });
      });
    }
  }

  /**
   * Clear formatting only for the specific error ranges
   */
  private clearFormattingForErrors(errors: CheckerError[]): void {
    for (const error of errors) {
      const length = error.end_index - error.start_index;
      this.clearAllFormats(error.start_index, length);
    }
  }

  /**
   * Highlight all errors in the document
   * Returns a Promise that resolves when highlighting is complete
   */
  highlightErrors(
    errors: CheckerError[],
    _changedLines?: number[],
  ): Promise<void> {
    // Cancel any ongoing highlighting operation
    if (this.isHighlighting) {
      console.debug(
        "🔄 Cancelling previous highlighting to start new operation",
      );
      // Clear the flag to allow new operation
      this.isHighlighting = false;
      // Note: We don't call onHighlightingComplete here because we're
      // immediately starting a new operation
    }

    // Increment operation ID to track this specific highlighting operation
    const operationId = ++this.currentHighlightId;

    // Set highlighting flag to prevent triggering text checks during highlighting
    this.isHighlighting = true;
    this.callbacks.onHighlightingStart();

    // Safari-specific approach: Completely disable all selection events during formatting
    const savedSelection = this.cursorManager.saveCursorPosition();
    // Save document length to detect if text changed during async highlighting
    const savedDocLength = this.editor.getLength();

    if (this.isSafari) {
      // For Safari, use synchronous approach wrapped in Promise
      return this.performSafariSafeHighlightingAsync(
        errors,
        savedSelection,
        operationId,
      );
    } else {
      // Use Promise-based approach for other browsers
      return this.scheduleHighlighting(errors, savedSelection, savedDocLength)
        .catch((error) => {
          console.error("Error during highlighting operations:", error);
        })
        .finally(() => {
          this.finishHighlighting(operationId);
        });
    }
  }

  /**
   * Clear all error formatting and tooltips
   */
  clearErrors(): void {
    // Remove any grammar-related formatting
    try {
      const docLength = this.editor.getLength();
      this.clearAllFormats(0, docLength);
    } catch (_err) {
      // ignore
    }

    // Remove any tooltips
    const tooltips = document.querySelectorAll(".error-tooltip");
    tooltips.forEach((tooltip) => tooltip.remove());

    this.callbacks.onErrorsCleared();
  }

  /**
   * Schedule highlighting to run in the next animation frame
   * Returns a Promise that resolves when highlighting is complete
   */
  private scheduleHighlighting(
    errors: CheckerError[],
    savedSelection: { index: number; length: number } | null,
    savedDocLength: number,
  ): Promise<void> {
    console.log(
      `📅 scheduleHighlighting: creating Promise for ${errors.length} errors`,
    );
    return new Promise((resolve) => {
      console.log("📅 scheduleHighlighting: calling requestAnimationFrame");
      requestAnimationFrame(() => {
        console.log("🎬 Animation frame callback executing");
        // Check if document changed during async operation
        const currentDocLength = this.editor.getLength();
        const docChanged = currentDocLength !== savedDocLength;

        if (docChanged) {
          console.debug(
            `🔄 Document changed during highlighting (${savedDocLength} → ${currentDocLength}), aborting stale highlight operation`,
          );
          // Don't highlight with stale error positions - abort and notify callbacks
          this.callbacks.onHighlightingAborted();
          resolve();
          return;
        }

        this.performHighlightingOperations(
          errors,
          savedSelection,
        );

        console.log(
          "✅ performHighlightingOperations complete, scheduling Promise resolution",
        );
        // Add a small delay to ensure state machine transitions complete
        // before the Promise chain resolves. We need enough time for the
        // state transition from "checking" to "highlighting" to be visible.
        setTimeout(() => {
          console.log("🎯 Resolving scheduleHighlighting Promise");
          resolve();
        }, 10);
      });
    });
  }

  /**
   * Safari-specific highlighting wrapped in a Promise
   */
  private performSafariSafeHighlightingAsync(
    errors: CheckerError[],
    savedSelection: { index: number; length: number } | null,
    operationId: number,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      // Always use async completion to avoid race conditions
      // Even successful DOM isolation needs to complete asynchronously
      setTimeout(() => {
        try {
          // Try DOM isolation first for Safari
          if (!this.trySafariDOMIsolation(errors, savedSelection)) {
            // Fallback: Use standard highlighting
            this.performHighlightingOperations(errors, savedSelection);
          }
        } catch (error) {
          console.error("Error in Safari highlighting operations:", error);
        } finally {
          resolve();
        }
      }, 0);
    })
      .catch((error) => {
        console.error("Error during Safari highlighting:", error);
      })
      .finally(() => {
        this.finishHighlighting(operationId);
      });
  }

  private performLineHighlightingOperations(
    errors: CheckerError[],
    savedSelection: { index: number; length: number } | null,
  ): void {
    // Disable Quill history during line highlighting
    const restoreHistory = this.disableHistory();

    try {
      // Apply highlighting for new errors without clearing existing ones
      errors.forEach((error) => {
        const start = error.start_index;
        const len = error.end_index - error.start_index;
        const formatName = ErrorHighlighter.getErrorFormatType(error);

        console.debug(
          `🎨 Highlighting error: "${error.error_text}" at ${start}-${error.end_index} with format ${formatName}`,
        );

        this.formatTextSilent(start, len, formatName, true);
      });

      // Restore cursor position
      this.cursorManager.restoreCursorPositionImmediate(savedSelection);
    } finally {
      // Restore original history recording if it was intercepted
      if (restoreHistory) {
        restoreHistory();
      }
    }
  }

  private trySafariDOMIsolation(
    errors: CheckerError[],
    savedSelection: { index: number; length: number } | null,
  ): boolean {
    try {
      const quillInstance = this.editor._quill;
      const container = quillInstance?.container;

      if (!container || !container.parentNode) {
        return false;
      }

      // Create a placeholder element
      const placeholder = document.createComment("quill-temp-placeholder");
      const parentNode = container.parentNode;

      // Save scroll position
      const scrollTop = document.documentElement.scrollTop ||
        document.body.scrollTop;
      const scrollLeft = document.documentElement.scrollLeft ||
        document.body.scrollLeft;

      // Remove container from DOM temporarily
      parentNode.insertBefore(placeholder, container);
      parentNode.removeChild(container);

      // Perform formatting operations while detached from DOM
      this.performHighlightingOperations(errors, null);

      // Reattach container to DOM
      parentNode.insertBefore(container, placeholder);
      parentNode.removeChild(placeholder);

      // Restore scroll position
      document.documentElement.scrollTop = scrollTop;
      document.body.scrollTop = scrollTop;
      document.documentElement.scrollLeft = scrollLeft;
      document.body.scrollLeft = scrollLeft;

      // Restore cursor position after reattachment
      if (savedSelection) {
        setTimeout(() => {
          this.cursorManager.restoreCursorPositionImmediate(savedSelection);
        }, 50);
      }

      return true;
    } catch (error) {
      console.warn("Safari DOM isolation failed:", error);
      return false;
    }
  }

  private performHighlightingOperations(
    errors: CheckerError[],
    savedSelection: { index: number; length: number } | null,
  ): void {
    // Temporarily disable history recording during highlighting
    const restoreHistory = this.disableHistory();

    try {
      // Clear existing error formatting across entire document
      console.debug("🎨 Clearing existing formatting across entire document");
      const docLength = this.editor.getLength();
      this.clearAllFormats(0, docLength);

      // Apply highlighting for each error
      console.debug(`🎨 Highlighting ${errors.length} errors`);
      errors.forEach((error, index) => {
        const start = error.start_index;
        const len = error.end_index - error.start_index;

        if (start < 0 || len <= 0) {
          console.warn(`Invalid error position: ${start}-${error.end_index}`);
          return;
        }

        const formatName = ErrorHighlighter.getErrorFormatType(error);

        console.debug(
          `🎨 [${index}] Highlighting "${error.error_text}" at ${start}-${error.end_index} with ${formatName}`,
        );

        this.formatTextSilent(start, len, formatName, true);
      });

      // Restore cursor position immediately
      // With Promise-based flow, we have explicit control and don't need setTimeout delays
      if (savedSelection) {
        this.cursorManager.restoreCursorPositionImmediate(savedSelection);
      }
    } finally {
      // Restore original history recording if it was intercepted
      if (restoreHistory) {
        restoreHistory();
      }
    }
  }

  private finishHighlighting(operationId: number): void {
    console.log(
      `🏁 finishHighlighting called for operation ${operationId}, current: ${this.currentHighlightId}, isHighlighting: ${this.isHighlighting}`,
    );

    // Only finish if this is still the current operation
    if (operationId !== this.currentHighlightId) {
      console.debug(
        `Skipping finishHighlighting - operation ${operationId} was superseded by ${this.currentHighlightId}`,
      );
      return;
    }

    if (this.isHighlighting) {
      console.log("✅ Calling onHighlightingComplete callback");
      this.isHighlighting = false;
      this.callbacks.onHighlightingComplete();
    } else {
      console.warn("⚠️ finishHighlighting called but isHighlighting is false!");
    }
  }

  /**
   * Highlight errors for a specific line only
   * This is the new isolated line-by-line highlighting approach
   */
  highlightSpecificLine(
    lineNumber: number,
    errors: CheckerError[],
  ): void {
    if (errors.length === 0) {
      return; // Nothing to highlight
    }

    console.debug(
      `🎨 Highlighting line ${lineNumber} with ${errors.length} errors`,
    );

    const savedSelection = this.cursorManager.saveCursorPosition();

    try {
      // Apply highlighting only for this line's errors
      for (const error of errors) {
        const formatName = ErrorHighlighter.getErrorFormatType(error);
        const length = error.end_index - error.start_index;

        this.formatTextSilent(error.start_index, length, formatName, true);
      }

      // Restore cursor if it was affected
      if (savedSelection) {
        this.cursorManager.restoreCursorPositionImmediate(savedSelection);
      }
    } catch (err) {
      console.warn(`Line highlighting failed for line ${lineNumber}:`, err);
    }
  }

  /**
   * Clear highlighting for a specific line only
   */
  clearSpecificLine(lineNumber: number, lineLength: number): void {
    console.debug(`🧹 Clearing highlighting for line ${lineNumber}`);

    const savedSelection = this.cursorManager.saveCursorPosition();

    try {
      // Clear all grammar-related formatting for this line
      this.clearAllFormats(lineNumber, lineLength);

      // Restore cursor
      if (savedSelection) {
        this.cursorManager.restoreCursorPositionImmediate(savedSelection);
      }
    } catch (err) {
      console.warn(`Line clearing failed for line ${lineNumber}:`, err);
    }
  }
}
