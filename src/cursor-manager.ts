/**
 * CursorManager - Handles cursor position saving/restoration and text selection management
 *
 * This class encapsulates all the complex logic for managing cursor positions
 * in the Quill editor, including browser-specific workarounds for Safari.
 */

// Minimal Quill interface for cursor operations
interface QuillEditorInterface {
  getSelection(): { index: number; length: number } | null;
  setSelection(index: number, length?: number, source?: string): void;
  getLength(): number;
  focus(): void;
  findBlot?(node: Node): unknown;
  getIndex?(blot: unknown): number;
  _quill?: {
    setSelection: (index: number, length: number, source?: string) => void;
  };
}

export interface CursorPosition {
  index: number;
  length: number;
}

export class CursorManager {
  private editor: QuillEditorInterface;

  constructor(editor: QuillEditorInterface) {
    this.editor = editor;
  }

  /**
   * Save the current cursor position in the editor
   * @returns The current cursor position or null if unable to determine
   */
  saveCursorPosition(): CursorPosition | null {
    try {
      // Try to use Quill's getSelection method if available
      if (this.editor.getSelection) {
        return this.editor.getSelection();
      }

      // Fallback: use browser's selection API
      const selection = (
        globalThis as unknown as { getSelection?: () => Selection | null }
      ).getSelection?.();
      if (!selection || selection.rangeCount === 0) {
        return null;
      }

      const range = selection.getRangeAt(0);

      // Find the position within the editor using Quill's methods
      if (this.editor.findBlot && this.editor.getIndex) {
        try {
          const startBlot = this.editor.findBlot(range.startContainer);
          const endBlot = this.editor.findBlot(range.endContainer);

          if (startBlot && endBlot) {
            const startIndex = this.editor.getIndex(startBlot) +
              range.startOffset;
            const endIndex = this.editor.getIndex(endBlot) + range.endOffset;

            return {
              index: startIndex,
              length: endIndex - startIndex,
            };
          }
        } catch (_err) {
          // Fallback to simple position
        }
      }

      return null;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Restore cursor position with Safari-specific retry logic
   * @param selection The cursor position to restore
   */
  restoreCursorPosition(selection: CursorPosition | null): void {
    if (!selection) return;

    try {
      // Use multiple restoration attempts with different delays for Safari
      const isSafari = /^((?!chrome|android).)*safari/i.test(
        navigator.userAgent,
      );

      const restoreAttempt = (attempt: number = 0) => {
        try {
          if (this.editor.setSelection) {
            // Ensure the selection is within document bounds
            const docLength = this.editor.getLength();
            const safeIndex = Math.min(selection.index, docLength - 1);
            const safeLength = Math.min(
              selection.length,
              docLength - safeIndex,
            );

            this.editor.setSelection(
              Math.max(0, safeIndex),
              Math.max(0, safeLength),
            );

            // Verify the selection was actually set correctly
            if (isSafari && attempt < 3) {
              setTimeout(() => {
                const currentSelection = this.editor.getSelection();
                if (!currentSelection || currentSelection.index !== safeIndex) {
                  restoreAttempt(attempt + 1);
                }
              }, 5);
            }
          }
        } catch (_err) {
          // If setSelection fails, try to at least focus the editor
          if (attempt === 0) {
            try {
              this.editor.focus();
              if (isSafari) {
                setTimeout(() => restoreAttempt(1), 10);
              }
            } catch (_focusErr) {
              // ignore
            }
          }
        }
      };

      // Initial attempt with delay for Safari
      if (isSafari) {
        setTimeout(() => restoreAttempt(0), 15);
      } else {
        restoreAttempt(0);
      }
    } catch (_err) {
      // ignore
    }
  }

  /**
   * Restore cursor position immediately without delays (for performance-critical operations)
   * @param selection The cursor position to restore
   */
  restoreCursorPositionImmediate(selection: CursorPosition | null): void {
    if (!selection) return;

    try {
      // Immediate restoration without delays
      if (this.editor.setSelection) {
        const docLength = this.editor.getLength();
        const safeIndex = Math.min(selection.index, docLength - 1);
        const safeLength = Math.min(selection.length, docLength - safeIndex);

        // Use 'silent' source to prevent events
        if (
          this.editor._quill &&
          typeof this.editor._quill.setSelection === "function"
        ) {
          this.editor._quill.setSelection(
            Math.max(0, safeIndex),
            Math.max(0, safeLength),
            "silent",
          );
        } else {
          this.editor.setSelection(
            Math.max(0, safeIndex),
            Math.max(0, safeLength),
            "silent",
          );
        }
      }
    } catch (_err) {
      // Fallback: try regular restoration with delay for Safari
      this.restoreCursorPosition(selection);
    }
  }
}
