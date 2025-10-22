/**
 * EventManager - Handles all DOM event registration and coordination
 *
 * This class encapsulates DOM event handling, undo detection, caret positioning,
 * and intelligent paste operations to keep event logic separate from main business logic.
 */

import type { CheckerError, SupportedLanguage } from "./types.ts";

// Minimal editor interface for event management
interface EditorEventInterface {
  root: HTMLElement;
  getText(): string;
  getSelection(): { index: number; length: number } | null;
  setSelection(index: number, length?: number, source?: string): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  findBlot?(node: Node): unknown;
  getIndex?(blot: unknown): number;
}

export interface EventCallbacks {
  onTextChange: (source: string, currentText: string) => void;
  onLanguageChange: (language: SupportedLanguage) => void;
  onClearEditor: () => void;
  onRetryCheck: () => void;
  onErrorClick: (
    errorNode: HTMLElement,
    matching: CheckerError,
    index: number,
    length: number,
    event: MouseEvent,
  ) => void;
  onErrorRightClick: (
    x: number,
    y: number,
    matchingError: CheckerError,
  ) => void;
  onIntelligentPasteCheck: (
    prePasteSelection: { index: number; length: number },
    prePasteText: string,
    pastedContent: string,
  ) => void;
}

export class EventManager {
  private editor: EditorEventInterface;
  private clearButton: HTMLButtonElement;
  private retryButton: HTMLButtonElement;
  private callbacks: EventCallbacks;
  private errors: CheckerError[] = [];

  // Undo detection state
  private recentTextChanges: Array<{ timestamp: number; text: string }> = [];
  private lastUserActionTime: number = 0;
  private isHighlighting: boolean = false;
  private isApplyingSuggestion: boolean = false;

  constructor(
    editor: EditorEventInterface,
    clearButton: HTMLButtonElement,
    retryButton: HTMLButtonElement,
    callbacks: EventCallbacks,
  ) {
    this.editor = editor;
    this.clearButton = clearButton;
    this.retryButton = retryButton;
    this.callbacks = callbacks;
    this.setupEventListeners();
  }

  /**
   * Update the current errors for context menu handling
   */
  updateErrors(errors: CheckerError[]): void {
    this.errors = errors;
  }

  /**
   * Update highlighting state for undo detection
   */
  setHighlightingState(isHighlighting: boolean): void {
    this.isHighlighting = isHighlighting;
  }

  /**
   * Update suggestion application state for undo detection
   */
  setSuggestionApplicationState(isApplying: boolean): void {
    this.isApplyingSuggestion = isApplying;
  }

  private setupEventListeners(): void {
    // Auto-check on text change using state machine
    this.editor.on("text-change", (...args: unknown[]) => {
      const source = args[2] as string;
      const now = Date.now();
      const currentText = this.editor.getText();

      // Skip text change processing if we're programmatically applying a suggestion
      if (this.isApplyingSuggestion) {
        return;
      }

      // Track text changes for undo detection
      this.recentTextChanges.push({ timestamp: now, text: currentText });

      // Keep only recent changes (last 5 seconds)
      this.recentTextChanges = this.recentTextChanges.filter(
        (change) => now - change.timestamp < 5000,
      );

      // Check if this is likely an undo operation
      if (this.isUndoOperation(currentText, source)) {
        return;
      }

      // Record user action time
      if (source === "user") {
        this.lastUserActionTime = now;
      }

      // Notify callback
      this.callbacks.onTextChange(source, currentText);
    });

    // Handle paste events for cursor positioning and intelligent checking
    this.editor.root.addEventListener("paste", (e: ClipboardEvent) => {
      // Record cursor position before paste
      const prePasteSelection = this.editor.getSelection();
      const prePasteText = this.editor.getText();
      const isEmpty = prePasteText.trim() === "";

      if (isEmpty) {
        // Let the paste happen, then position cursor at start
        setTimeout(() => {
          // Record this as user action for undo detection
          this.lastUserActionTime = Date.now();
          this.editor.setSelection(0, 0);
        }, 10);
      } else if (prePasteSelection) {
        // For non-empty editor, record paste context for intelligent checking
        setTimeout(() => {
          this.callbacks.onIntelligentPasteCheck(
            prePasteSelection,
            prePasteText,
            e.clipboardData?.getData("text") || "",
          );
        }, 50); // Allow paste to complete
      }
    });

    // Language selection - listen for custom event from LanguageSelector component
    globalThis.addEventListener("languageChanged", (e) => {
      const customEvent = e as CustomEvent;
      const language = customEvent.detail.language as SupportedLanguage;
      this.callbacks.onLanguageChange(language);
    });

    // Clear button
    this.clearButton.addEventListener("click", () => {
      this.callbacks.onClearEditor();
    });

    // Retry button
    this.retryButton.addEventListener("click", () => {
      this.callbacks.onRetryCheck();
    });

    // Click outside to close tooltips
    document.addEventListener("click", (e) => {
      const existingTooltip = document.querySelector(".error-tooltip");
      if (existingTooltip && !existingTooltip.contains(e.target as Node)) {
        existingTooltip.remove();
      }
    });

    // Right-click context menu for error corrections
    this.editor.root.addEventListener("contextmenu", (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const matchingError = this.findErrorAtPosition(e);
      if (matchingError) {
        const { menuX, menuY } = this.calculateContextMenuPosition(e);
        this.callbacks.onErrorRightClick(menuX, menuY, matchingError);
      }
    });

    // Click on an error span to show suggestions
    this.editor.root.addEventListener("click", (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const errorNode = target.closest(
        ".grammar-typo, .grammar-other",
      ) as HTMLElement;
      if (!errorNode) return;

      // Use Quill's blot find to determine index and length
      try {
        const blot = this.editor.findBlot
          ? this.editor.findBlot(errorNode)
          : undefined;
        const index = this.editor.getIndex && blot !== undefined
          ? this.editor.getIndex(blot)
          : 0;
        const maybeLength =
          blot && typeof (blot as { length?: unknown }).length === "function"
            ? (blot as { length: () => number }).length()
            : 0;
        const length = maybeLength ?? 0;

        // Find matching error by index
        const matching = this.errors.find(
          (err) =>
            err.start_index === index &&
            err.end_index - err.start_index === length,
        );
        if (matching) {
          this.callbacks.onErrorClick(errorNode, matching, index, length, e);
        }
      } catch (_err) {
        // ignore
      }
    });
  }

  private isUndoOperation(currentText: string, source: string): boolean {
    // Don't apply undo detection during suggestion application
    if (this.isApplyingSuggestion) {
      console.debug(
        "🔧 Suggestion application in progress - skipping undo detection",
      );
      return false;
    }

    // If source is not 'user', it's likely a programmatic change (like undo/redo)
    if (source !== "user") {
      console.debug("🔄 Non-user source detected:", source);
      return true;
    }

    const now = Date.now();

    // Check if we have a recent history of text changes
    if (this.recentTextChanges.length >= 2) {
      // Look for a pattern where text reverts to a previous state
      const previousTexts = this.recentTextChanges
        .slice(0, -1) // Exclude the current change
        .map((change) => change.text);

      // If current text matches any previous text from recent history, it's likely undo
      if (previousTexts.includes(currentText)) {
        console.debug("🔄 Text reverted to previous state - undo detected");
        return true;
      }

      // Check for rapid changes that might indicate undo cascading
      const recentChanges = this.recentTextChanges.filter(
        (change) => now - change.timestamp < 500, // Reduced to 500ms for tighter detection
      );

      if (recentChanges.length > 5) {
        // Increased threshold to be less sensitive
        console.debug("🔄 Rapid text changes detected - possible undo cascade");
        return true;
      }
    }

    // Check if this change happened very soon after user action but during highlighting
    // Only consider it an undo if it happens within 500ms and the text is reverting
    if (this.isHighlighting && now - this.lastUserActionTime < 500) {
      // Additional check: only treat as undo if text is actually reverting to a previous state
      const previousTexts = this.recentTextChanges
        .slice(0, -1)
        .map((change) => change.text);

      if (previousTexts.includes(currentText)) {
        console.debug(
          "🔄 Change during highlighting phase - likely undo of highlight",
        );
        return true;
      }
    }

    return false;
  }

  private findErrorAtPosition(e: MouseEvent): CheckerError | undefined {
    // Try multiple methods to find the error at the cursor position
    let matchingError: CheckerError | undefined;

    // Method 1: Check if right-clicking directly on an error element
    const target = e.target as HTMLElement;
    const errorElement = target.closest(
      ".grammar-typo, .grammar-other",
    ) as HTMLElement;

    if (errorElement) {
      // FIXED: Use Quill's blot system to get the exact position of the clicked element
      // This ensures we match the correct error when multiple identical errors exist
      try {
        const blot = this.editor.findBlot?.(errorElement);
        if (blot && this.editor.getIndex) {
          const elementIndex = this.editor.getIndex(blot);
          const elementLength =
            blot && typeof (blot as { length?: unknown }).length === "function"
              ? (blot as { length: () => number }).length()
              : 0;

          // Find error by matching BOTH position AND text for accuracy
          matchingError = this.errors.find(
            (error) =>
              error.start_index === elementIndex &&
              error.end_index - error.start_index === elementLength,
          );

          if (matchingError) {
            console.debug(
              `✅ Found error at position ${elementIndex} by element position`,
            );
            return matchingError;
          }
        }
      } catch (err) {
        console.debug("Could not get element position from blot:", err);
      }

      // Fallback: If we couldn't get position from blot, try matching by text
      // but prefer the error closest to the click position
      const errorText = errorElement.textContent || "";
      const candidateErrors = this.errors.filter(
        (error) =>
          error.error_text === errorText ||
          (error.suggestions &&
            error.suggestions.some((s) => s.includes(errorText))),
      );

      if (candidateErrors.length === 1) {
        matchingError = candidateErrors[0];
      } else if (candidateErrors.length > 1) {
        // Multiple errors with same text - try to find which one is closest
        console.warn(
          `⚠️ Found ${candidateErrors.length} errors with text "${errorText}", attempting position-based matching`,
        );

        // Try to get click position to find the closest error
        let clickIndex: number | null = null;

        const caretPos = (
          document as unknown as {
            caretPositionFromPoint?: (
              x: number,
              y: number,
            ) => { offsetNode: Node; offset: number } | null;
          }
        ).caretPositionFromPoint?.(e.clientX, e.clientY);

        if (caretPos) {
          clickIndex = this.getCaretPosition(caretPos);
        } else {
          const range = (
            document as unknown as {
              caretRangeFromPoint?: (x: number, y: number) => Range | null;
            }
          ).caretRangeFromPoint?.(e.clientX, e.clientY);

          if (range) {
            clickIndex = this.getRangePosition(range);
          }
        }

        if (clickIndex !== null) {
          // Find the error that contains this position
          matchingError = candidateErrors.find(
            (err) =>
              err.start_index <= clickIndex && clickIndex < err.end_index,
          );
        }

        // Final fallback: use first match (original behavior)
        if (!matchingError) {
          console.warn(
            "⚠️ Could not determine position, using first matching error",
          );
          matchingError = candidateErrors[0];
        }
      }
    }

    // Method 2: Try browser-specific caret position methods
    if (!matchingError) {
      let clickIndex: number | null = null;

      // Try caretPositionFromPoint (Chrome/Edge)
      const caretPos = (
        document as unknown as {
          caretPositionFromPoint?: (
            x: number,
            y: number,
          ) => { offsetNode: Node; offset: number } | null;
        }
      ).caretPositionFromPoint?.(e.clientX, e.clientY);

      if (caretPos) {
        clickIndex = this.getCaretPosition(caretPos);
      } else {
        // Try caretRangeFromPoint (Safari/Firefox)
        const range = (
          document as unknown as {
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
          }
        ).caretRangeFromPoint?.(e.clientX, e.clientY);

        if (range) {
          clickIndex = this.getRangePosition(range);
        }
      }

      if (clickIndex !== null) {
        matchingError = this.errors.find(
          (err) => err.start_index <= clickIndex && clickIndex < err.end_index,
        );
      }
    }

    return matchingError;
  }

  private calculateContextMenuPosition(e: MouseEvent): {
    menuX: number;
    menuY: number;
  } {
    let menuX = e.clientX;
    let menuY = e.clientY;

    // Detect browser for positioning adjustments
    const userAgent = globalThis.navigator?.userAgent || "";
    const isChrome = userAgent.includes("Chrome") && !userAgent.includes("Edg");

    const target = e.target as HTMLElement;
    const errorElement = target.closest(
      ".grammar-typo, .grammar-other",
    ) as HTMLElement;

    if (isChrome) {
      // Chrome calculates coordinates differently - need much larger offset
      menuX = e.clientX;
      menuY = e.clientY + 50; // Much larger offset for Chrome

      // If we have error element, use element position but with Chrome-specific offset
      if (errorElement) {
        const rect = errorElement.getBoundingClientRect();
        menuX = rect.left + rect.width / 2;
        // Use element's bottom position plus large margin for Chrome
        menuY = rect.bottom + 20;
      }
    } else {
      // Firefox and Safari: use element-based positioning when available
      if (errorElement) {
        const rect = errorElement.getBoundingClientRect();
        menuX = rect.left + rect.width / 2;
        menuY = rect.bottom + 5;
      } else {
        // Use mouse coordinates for Firefox/Safari
        menuX = e.clientX;
        menuY = e.clientY + 5;
      }
    }

    return { menuX, menuY };
  }

  /**
   * Calculate Quill editor index from a DOM node and offset
   * @param node DOM node to find position for
   * @param offset Character offset within the node
   * @returns Quill editor index, or 0 if not found
   */
  private getPositionFromNode(node: Node, offset: number): number {
    try {
      const blot = this.editor.findBlot?.(node);
      if (blot && this.editor.getIndex) {
        return this.editor.getIndex(blot) + offset;
      }
    } catch (_err) {
      // ignore
    }
    return 0;
  }

  private getCaretPosition(caret: {
    offsetNode: Node;
    offset: number;
  }): number {
    return this.getPositionFromNode(caret.offsetNode, caret.offset);
  }

  private getRangePosition(range: Range): number {
    return this.getPositionFromNode(range.startContainer, range.startOffset);
  }
}
