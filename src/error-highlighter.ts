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

  constructor(
    editor: EditorHighlightInterface,
    cursorManager: CursorManager,
    callbacks: HighlightingCallbacks,
  ) {
    this.editor = editor;
    this.cursorManager = cursorManager;
    this.callbacks = callbacks;
    this.isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  }

  /**
   * Highlight errors for a specific line without clearing existing highlights
   */
  highlightLineErrors(errors: CheckerError[]): void {
    // Set highlighting flag to prevent triggering grammar checks during line highlighting
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
    const formatTypes = ["grammar-error", "grammar-typo", "grammar-other"];

    for (const error of errors) {
      const length = error.end_index - error.start_index;

      for (const formatType of formatTypes) {
        try {
          this.editor.formatText(
            error.start_index,
            length,
            formatType,
            false,
            "silent",
          );
        } catch (_err) {
          // ignore individual format failures
        }
      }
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

    // Set highlighting flag to prevent triggering grammar checks during highlighting
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
      this.editor.formatText(0, docLength, "grammar-error", false);
      this.editor.formatText(0, docLength, "grammar-typo", false);
      this.editor.formatText(0, docLength, "grammar-other", false);
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
    const quillInstance = this.editor._quill;
    let originalHistoryRecord: (() => void) | null = null;

    if (quillInstance?.history) {
      const history = quillInstance.history as unknown as {
        record?: () => void;
      };
      if (history.record) {
        originalHistoryRecord = history.record;
        history.record = () => {}; // Disable recording temporarily
      }
    }

    try {
      // Apply highlighting for new errors without clearing existing ones
      errors.forEach((error) => {
        const start = error.start_index;
        const len = error.end_index - error.start_index;
        const isTypo = error.error_code === "typo" ||
          (error.title && String(error.title).toLowerCase().includes("typo"));
        const formatName = isTypo ? "grammar-typo" : "grammar-other";

        console.debug(
          `🎨 Highlighting error: "${error.error_text}" at ${start}-${error.end_index} with format ${formatName}`,
        );

        try {
          // Use silent mode to prevent triggering selection changes during formatting
          if (
            this.editor._quill &&
            typeof this.editor._quill.formatText === "function"
          ) {
            this.editor._quill.formatText(
              start,
              len,
              formatName,
              true,
              "silent",
            );
          } else {
            this.editor.formatText(start, len, formatName, true, "silent");
          }
        } catch (_err) {
          // Ignore formatting errors
        }
      });

      // Restore cursor position
      this.cursorManager.restoreCursorPositionImmediate(savedSelection);
    } finally {
      // Restore original history recording if it was intercepted
      if (originalHistoryRecord && quillInstance?.history) {
        const history = quillInstance.history as unknown as {
          record?: () => void;
        };
        if (history) {
          history.record = originalHistoryRecord;
        }
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
    // Batch all operations together to minimize DOM thrashing
    const quillInstance = this.editor._quill;

    // Temporarily disable history recording during highlighting
    let originalHistoryRecord: (() => void) | null = null;

    // Try to intercept the history recording
    if (quillInstance?.history) {
      const history = quillInstance.history as unknown as {
        record?: () => void;
      };
      if (history.record) {
        originalHistoryRecord = history.record;
        history.record = () => {}; // Disable recording temporarily
      }
    }

    try {
      // Clear existing error formatting across entire document
      // For now, we clear all formatting (can be optimized later for specific lines)
      console.debug("🎨 Clearing existing formatting across entire document");
      const docLength = this.editor.getLength();
      this.editor.formatText(0, docLength, "grammar-error", false, "silent");
      this.editor.formatText(0, docLength, "grammar-typo", false, "silent");
      this.editor.formatText(0, docLength, "grammar-other", false, "silent");

      // Apply highlighting for each error
      console.debug(`🎨 Highlighting ${errors.length} errors`);
      errors.forEach((error, index) => {
        const start = error.start_index;
        const len = error.end_index - error.start_index;

        if (start < 0 || len <= 0) {
          console.warn(`Invalid error position: ${start}-${error.end_index}`);
          return;
        }

        const isTypo = error.error_code === "typo" ||
          (error.title && String(error.title).toLowerCase().includes("typo"));
        const formatName = isTypo ? "grammar-typo" : "grammar-other";

        console.debug(
          `🎨 [${index}] Highlighting "${error.error_text}" at ${start}-${error.end_index} with ${formatName}`,
        );

        try {
          // Use silent mode to prevent triggering selection changes during formatting
          if (
            this.editor._quill &&
            typeof this.editor._quill.formatText === "function"
          ) {
            this.editor._quill.formatText(
              start,
              len,
              formatName,
              true,
              "silent",
            );
          } else {
            this.editor.formatText(start, len, formatName, true, "silent");
          }
        } catch (err) {
          console.warn(
            `Failed to highlight error at ${start}-${error.end_index}:`,
            err,
          );
        }
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
      if (originalHistoryRecord && quillInstance?.history) {
        const history = quillInstance.history as unknown as {
          record?: () => void;
        };
        if (history) {
          history.record = originalHistoryRecord;
        }
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
        try {
          const errorClass = this.getErrorClass(error.error_code);
          const length = error.end_index - error.start_index;

          this.editor.formatText(
            error.start_index,
            length,
            errorClass,
            true,
            "silent",
          );
        } catch (err) {
          console.warn(
            `Failed to highlight error at ${error.start_index}-${error.end_index}:`,
            err,
          );
        }
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
      const formatTypes = ["grammar-error", "grammar-typo", "grammar-other"];

      for (const formatType of formatTypes) {
        try {
          this.editor.formatText(
            lineNumber,
            lineLength,
            formatType,
            false,
            "silent",
          );
        } catch (err) {
          console.warn(
            `Failed to clear ${formatType} for line ${lineNumber}:`,
            err,
          );
        }
      }

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
