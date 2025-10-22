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
  onErrorsCleared: () => void;
}

export class ErrorHighlighter {
  private editor: EditorHighlightInterface;
  private cursorManager: CursorManager;
  private callbacks: HighlightingCallbacks;
  private isHighlighting: boolean = false;
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
   */
  highlightLineErrors(errors: CheckerError[]): void {
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

    try {
      if (this.isSafari) {
        this.performLineHighlightingOperations(errors, savedSelection);
      } else {
        requestAnimationFrame(() => {
          this.performLineHighlightingOperations(errors, savedSelection);
          // Clear highlighting flag after line operations complete
          this.finishHighlighting();
        });
        return; // Early return for async path
      }
    } finally {
      // Clear highlighting flag for synchronous Safari path
      if (this.isSafari) {
        this.finishHighlighting();
      }
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
   */
  highlightErrors(errors: CheckerError[], _changedLines?: number[]): void {
    // Prevent multiple simultaneous highlighting operations
    if (this.isHighlighting) {
      console.debug(
        "🔄 Highlighting already in progress, skipping duplicate call",
      );
      return;
    }

    // Set highlighting flag to prevent triggering text checks during highlighting
    this.isHighlighting = true;
    this.callbacks.onHighlightingStart();

    // Safari-specific approach: Completely disable all selection events during formatting
    const savedSelection = this.cursorManager.saveCursorPosition();

    try {
      if (this.isSafari) {
        // For Safari, use a more aggressive approach
        this.performSafariSafeHighlighting(errors, savedSelection);
        // Safari method handles its own finishHighlighting calls
      } else {
        // Use standard approach for other browsers
        requestAnimationFrame(() => {
          this.performHighlightingOperations(errors, savedSelection);
          // Clear highlighting flag after operations complete
          this.finishHighlighting();
        });
      }
    } catch (error) {
      console.error("Error during highlighting:", error);
      // Ensure highlighting flag is cleared even on error
      this.finishHighlighting();
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

  private performSafariSafeHighlighting(
    errors: CheckerError[],
    savedSelection: { index: number; length: number } | null,
  ): void {
    // Try DOM isolation first for Safari
    if (this.trySafariDOMIsolation(errors, savedSelection)) {
      // DOM isolation succeeded, highlighting is complete
      this.finishHighlighting();
      return;
    }

    // Fallback: Use standard highlighting with additional delays
    setTimeout(() => {
      this.performHighlightingOperations(errors, savedSelection);
      this.finishHighlighting();
    }, 10);
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

      // Restore cursor position with a slight delay to ensure all formatting is complete
      if (savedSelection && !this.isSafari) {
        setTimeout(() => {
          this.cursorManager.restoreCursorPositionImmediate(savedSelection);
        }, 10);
      } else if (savedSelection) {
        this.cursorManager.restoreCursorPositionImmediate(savedSelection);
      }
    } finally {
      // Restore original history recording if it was intercepted
      if (restoreHistory) {
        restoreHistory();
      }
    }
  }

  private finishHighlighting(): void {
    setTimeout(() => {
      this.isHighlighting = false;
      this.callbacks.onHighlightingComplete();
    }, 100); // Small delay to ensure all operations are complete
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

  /**
   * Get the appropriate CSS class for an error code
   */
  private getErrorClass(errorCode: string): string {
    const isTypo = errorCode === "typo" ||
      errorCode === "unknown-word" ||
      errorCode.toLowerCase().includes("spell");
    return isTypo ? "grammar-typo" : "grammar-other";
  }
}
