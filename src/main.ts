import { DivvunAPI } from "./api.ts";
import type {
  SupportedLanguage,
  DivvunError,
  EditorState,
  GrammarCheckerConfig,
} from "./types.ts";

// Quill types are not shipped with Deno by default; use any to avoid type issues in this small app
// Minimal Quill typings we need (Quill is loaded via CDN in the page)
// Use the runtime bridge created in src/quill-bridge.js (exposes `globalThis.QuillBridge`)
interface QuillBridgeInstance {
  root: HTMLElement;
  getText(): string;
  on(event: string, handler: (...args: unknown[]) => void): void;
  getLength(): number;
  formatText(
    index: number,
    len: number,
    format: string,
    value: unknown,
    source?: string
  ): void;
  setText(text: string): void;
  deleteText(index: number, len: number): void;
  insertText(index: number, text: string): void;
  focus(): void;
  findBlot?(node: Node): unknown;
  getIndex?(blot: unknown): number;
  getSelection(): { index: number; length: number } | null;
  setSelection(index: number, length?: number, source?: string): void;
  _quill?: {
    formatText: (
      index: number,
      length: number,
      format: string,
      value: unknown,
      source?: string
    ) => void;
    setSelection: (index: number, length: number, source?: string) => void;
  };
}

// Register custom Quill blots for error highlighting
function registerQuillBlots() {
  // Use runtime JavaScript to avoid TypeScript complexity with Quill blots
  const script = `
    if (typeof Quill !== 'undefined') {
      const Inline = Quill.import('blots/inline');
      
      class GrammarTypoBlot extends Inline {
        static create(value) {
          let node = super.create();
          node.classList.add('grammar-typo');
          return node;
        }
        static formats(node) {
          return 'grammar-typo';
        }
      }
      GrammarTypoBlot.blotName = 'grammar-typo';
      GrammarTypoBlot.tagName = 'span';

      class GrammarOtherBlot extends Inline {
        static create(value) {
          let node = super.create();
          node.classList.add('grammar-other');
          return node;
        }
        static formats(node) {
          return 'grammar-other';
        }
      }
      GrammarOtherBlot.blotName = 'grammar-other';
      GrammarOtherBlot.tagName = 'span';

      Quill.register(GrammarTypoBlot);
      Quill.register(GrammarOtherBlot);
    }
  `;

  // Execute the script
  const scriptElement = document.createElement("script");
  scriptElement.textContent = script;
  document.head.appendChild(scriptElement);
}

const maybeBridge = (
  globalThis as unknown as {
    QuillBridge?: {
      create: (
        container: string | HTMLElement,
        options?: unknown
      ) => QuillBridgeInstance;
    };
  }
).QuillBridge;
if (!maybeBridge) {
  throw new Error(
    "QuillBridge is not available. Ensure src/quill-bridge.js is loaded."
  );
}
const QuillBridge = maybeBridge;

export class GrammarChecker {
  private api: DivvunAPI;
  private config: GrammarCheckerConfig;
  private state: EditorState;
  private checkTimeout: ReturnType<typeof setTimeout> | null = null;

  // DOM elements
  private editor: QuillBridgeInstance; // Quill instance
  private languageSelect: HTMLSelectElement;
  private clearButton: HTMLButtonElement;
  private statusText: HTMLElement;
  private statusDisplay: HTMLElement;
  private errorCount: HTMLElement;

  constructor() {
    this.config = {
      language: "se",
      apiUrl: "https://api-giellalt.uit.no/grammar",
      autoCheckDelay: 600,
      maxRetries: 3,
    };

    this.state = {
      lastCheckedContent: "",
      errors: [],
      isChecking: false,
      errorSpans: [],
    };

    this.api = new DivvunAPI();

    // Register custom Quill blots for error highlighting
    registerQuillBlots();

    // Initialize Quill editor via the bridge
    const editorContainer = document.getElementById("editor") as HTMLElement;
    this.editor = QuillBridge.create(editorContainer, {
      theme: "snow",
      modules: {
        toolbar: [
          [{ header: [1, 2, false] }],
          ["bold", "italic", "underline"],
          ["link", "clean"],
        ],
      },
    });

    // Ensure editor root is focusable
    this.editor.root.setAttribute("aria-label", "Grammar editor");
    // Disable native browser spellcheck inside Quill editor
    try {
      this.editor.root.setAttribute("spellcheck", "false");
    } catch (_err) {
      // ignore
    }

    // Get other DOM elements
    this.languageSelect = document.getElementById(
      "language-select"
    ) as HTMLSelectElement;
    this.clearButton = document.getElementById(
      "clear-btn"
    ) as HTMLButtonElement;
    this.statusText = document.getElementById("status-text") as HTMLElement;
    this.statusDisplay = document.getElementById(
      "status-display"
    ) as HTMLElement;
    this.errorCount = document.getElementById("error-count") as HTMLElement;

    // Populate language options from API and then wire up events
    this.populateLanguageOptions();
    this.setupEventListeners();
    console.log("Grammar checker initialized successfully");
  }

  private populateLanguageOptions(): void {
    try {
      const languages = this.api.getSupportedLanguages();
      // Clear existing options
      this.languageSelect.innerHTML = "";
      languages.forEach((lang) => {
        const opt = document.createElement("option");
        opt.value = lang.code;
        opt.textContent = lang.name;
        this.languageSelect.appendChild(opt);
      });

      // Set the select to the configured language if available
      let found = false;
      for (let i = 0; i < this.languageSelect.options.length; i++) {
        if (this.languageSelect.options[i].value === this.config.language) {
          found = true;
          break;
        }
      }

      if (found) {
        this.languageSelect.value = this.config.language;
      } else if (this.languageSelect.options.length > 0) {
        this.config.language = this.languageSelect.options[0]
          .value as SupportedLanguage;
        this.languageSelect.value = this.config.language;
      }
    } catch (_err) {
      // If populating languages fails, leave existing static options as fallback
    }
  }

  private setupEventListeners(): void {
    // Auto-check on text change with debouncing (Quill emits 'text-change')
    this.editor.on("text-change", () => {
      if (this.checkTimeout) {
        clearTimeout(this.checkTimeout);
      }

      this.checkTimeout = setTimeout(() => {
        this.checkGrammar();
      }, this.config.autoCheckDelay);
    });

    // Language selection
    this.languageSelect.addEventListener("change", (e) => {
      const target = e.target as HTMLSelectElement;
      this.setLanguage(target.value as SupportedLanguage);
    });

    // Clear button
    this.clearButton.addEventListener("click", () => {
      this.clearEditor();
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

      // Try multiple methods to find the error at the cursor position
      let matchingError: DivvunError | undefined;

      // Method 1: Check if right-clicking directly on an error element
      const target = e.target as HTMLElement;
      const errorElement = target.closest(
        ".grammar-typo, .grammar-other"
      ) as HTMLElement;

      if (errorElement) {
        // Get the text content and find matching error
        const errorText = errorElement.textContent || "";
        matchingError = this.state.errors.find(
          (error) =>
            error.error_text === errorText ||
            (error.suggestions &&
              error.suggestions.some((s) => s.includes(errorText)))
        );
      }

      // Method 2: Try browser-specific caret position methods
      if (!matchingError) {
        let clickIndex: number | null = null;

        // Try caretPositionFromPoint (Chrome/Edge)
        const caretPos = (
          document as unknown as {
            caretPositionFromPoint?: (
              x: number,
              y: number
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
          matchingError = this.state.errors.find(
            (err) => err.start_index <= clickIndex && clickIndex < err.end_index
          );
        }
      }

      if (
        matchingError &&
        matchingError.suggestions &&
        matchingError.suggestions.length > 0
      ) {
        // Calculate Chrome-compatible coordinates
        let menuX = e.clientX;
        let menuY = e.clientY;

        // Detect browser for positioning adjustments
        const userAgent = globalThis.navigator?.userAgent || "";
        const isChrome =
          userAgent.includes("Chrome") && !userAgent.includes("Edg");

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

        this.showContextMenu(menuX, menuY, matchingError);
      }
    });

    // Click on an error span to show suggestions
    this.editor.root.addEventListener("click", (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const errorNode = target.closest(
        ".grammar-typo, .grammar-other"
      ) as HTMLElement;
      if (!errorNode) return;

      // Use Quill's blot find to determine index and length
      try {
        const blot = this.editor.findBlot
          ? this.editor.findBlot(errorNode)
          : undefined;
        const index =
          this.editor.getIndex && blot !== undefined
            ? this.editor.getIndex(blot)
            : 0;
        const maybeLength =
          blot && typeof (blot as { length?: unknown }).length === "function"
            ? (blot as { length: () => number }).length()
            : 0;
        const length = maybeLength ?? 0;

        // Find matching error by index
        const matching = this.state.errors.find(
          (err) =>
            err.start_index === index &&
            err.end_index - err.start_index === length
        );
        if (matching) {
          this.showSuggestionTooltip(
            errorNode,
            matching,
            index,
            length,
            e as MouseEvent
          );
        }
      } catch (_err) {
        // ignore
      }
    });
  }

  async checkGrammar(): Promise<void> {
    const currentText = this.editor.getText();

    // Don't check if content hasn't changed or is empty
    if (this.state.isChecking) return;
    if (!currentText || currentText.trim() === "") return;
    if (currentText === this.state.lastCheckedContent) return;

    this.state.isChecking = true;
    this.updateStatus("Checking...", true);

    try {
      const response = await this.api.checkText(
        currentText,
        this.config.language
      );

      this.state.lastCheckedContent = currentText;
      this.state.errors = response.errs;
      this.highlightErrors(response.errs);

      const errorCount = response.errs.length;
      this.updateStatus("Ready", false);
      this.updateErrorCount(errorCount);
    } catch (error) {
      console.error("Grammar check failed:", error);
      this.updateStatus("Error checking grammar", false);
      this.showErrorMessage(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      this.state.isChecking = false;
    }
  }

  private highlightErrors(errors: DivvunError[]): void {
    // Safari-specific approach: Completely disable all selection events during formatting
    const savedSelection = this.saveCursorPosition();

    // Detect Safari
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    if (isSafari) {
      // For Safari, use a more aggressive approach
      this.performSafariSafeHighlighting(errors, savedSelection);
    } else {
      // Use standard approach for other browsers
      requestAnimationFrame(() => {
        this.performHighlightingOperations(errors, savedSelection);
      });
    }
  }

  private trySafariDOMIsolation(
    errors: DivvunError[],
    savedSelection: { index: number; length: number } | null
  ): boolean {
    try {
      const quillInstance = this.editor._quill as unknown as {
        container?: HTMLElement;
      };
      const container = quillInstance?.container;

      if (!container || !container.parentNode) {
        return false;
      }

      // Create a placeholder element
      const placeholder = document.createComment("quill-temp-placeholder");
      const parentNode = container.parentNode;

      // Save scroll position
      const scrollTop =
        document.documentElement.scrollTop || document.body.scrollTop;
      const scrollLeft =
        document.documentElement.scrollLeft || document.body.scrollLeft;

      // Remove container from DOM temporarily
      parentNode.insertBefore(placeholder, container);
      parentNode.removeChild(container);

      // Perform formatting operations while detached from DOM
      this.performHighlightingOperations(errors, null);

      // Reattach container to DOM
      parentNode.insertBefore(container, placeholder);
      parentNode.removeChild(placeholder);

      // Restore scroll position
      globalThis.scrollTo(scrollLeft, scrollTop);

      // Restore cursor position after a brief delay
      setTimeout(() => {
        if (savedSelection) {
          const docLength = this.editor.getLength();
          const safeIndex = Math.min(
            savedSelection.index,
            Math.max(0, docLength - 1)
          );
          const safeLength = Math.min(
            savedSelection.length,
            Math.max(0, docLength - safeIndex)
          );

          if (this.editor.setSelection) {
            this.editor.setSelection(safeIndex, safeLength, "silent");
          }
        }
      }, 10);

      return true;
    } catch (err) {
      console.warn("Safari DOM isolation failed, falling back:", err);
      return false;
    }
  }

  private performSafariSafeHighlighting(
    errors: DivvunError[],
    savedSelection: { index: number; length: number } | null
  ): void {
    // Safari-specific implementation - try DOM isolation approach first
    if (this.trySafariDOMIsolation(errors, savedSelection)) {
      return;
    }

    // Fallback to selection method override approach
    const quillInstance = this.editor._quill as unknown as {
      setSelection?: (index: number, length: number, source?: string) => void;
      updateSelection?: (source?: string) => void;
      scrollSelectionIntoView?: () => void;
      container?: HTMLElement;
    };

    if (!quillInstance) return;

    // Store original selection methods
    const originalSetSelection = quillInstance.setSelection;
    const originalUpdateSelection = quillInstance.updateSelection;
    const originalScrollSelectionIntoView =
      quillInstance.scrollSelectionIntoView;

    let container: HTMLElement | undefined;
    try {
      // Completely disable selection updates during formatting
      if (quillInstance.setSelection) {
        quillInstance.setSelection = () => {};
      }
      if (quillInstance.updateSelection) {
        quillInstance.updateSelection = () => {};
      }
      if (quillInstance.scrollSelectionIntoView) {
        quillInstance.scrollSelectionIntoView = () => {};
      }

      // Disable all events that could trigger selection changes
      container = quillInstance.container;
      if (container) {
        container.style.pointerEvents = "none";
      }

      // Perform formatting operations
      this.performHighlightingOperations(errors, null);

      // Wait for DOM to settle, then restore selection
      setTimeout(() => {
        try {
          // Restore original methods
          if (originalSetSelection) {
            quillInstance.setSelection = originalSetSelection;
          }
          if (originalUpdateSelection) {
            quillInstance.updateSelection = originalUpdateSelection;
          }
          if (originalScrollSelectionIntoView) {
            quillInstance.scrollSelectionIntoView =
              originalScrollSelectionIntoView;
          }

          // Re-enable pointer events
          if (container) {
            container.style.pointerEvents = "";
          }

          // Force restore selection after methods are restored
          if (savedSelection && originalSetSelection) {
            const docLength = this.editor.getLength();
            const safeIndex = Math.min(
              savedSelection.index,
              Math.max(0, docLength - 1)
            );
            const safeLength = Math.min(
              savedSelection.length,
              Math.max(0, docLength - safeIndex)
            );

            originalSetSelection.call(
              quillInstance,
              safeIndex,
              safeLength,
              "silent"
            );
          }
        } catch (err) {
          console.warn("Safari selection restoration failed:", err);
        }
      }, 0);
    } catch (err) {
      // Restore methods in case of error
      if (originalSetSelection) {
        quillInstance.setSelection = originalSetSelection;
      }
      if (originalUpdateSelection) {
        quillInstance.updateSelection = originalUpdateSelection;
      }
      if (originalScrollSelectionIntoView) {
        quillInstance.scrollSelectionIntoView = originalScrollSelectionIntoView;
      }

      if (container) {
        container.style.pointerEvents = "";
      }

      throw err;
    }
  }

  private performHighlightingOperations(
    errors: DivvunError[],
    savedSelection: { index: number; length: number } | null
  ): void {
    // Batch all operations together to minimize DOM thrashing
    const quillInstance = this.editor._quill as unknown as {
      history?: { options?: { delay?: number } };
      setSelection?: (index: number, length: number, source?: string) => void;
    };

    let _originalDelay: number | undefined;
    if (quillInstance?.history?.options) {
      _originalDelay = quillInstance.history.options.delay;
      quillInstance.history.options.delay = 0; // Disable history during formatting
    }

    try {
      // Clear existing error formatting across the document
      try {
        const docLength = this.editor.getLength();
        // Use silent mode to prevent cursor jumps during clearing
        if (
          this.editor._quill &&
          typeof this.editor._quill.formatText === "function"
        ) {
          this.editor._quill.formatText(
            0,
            docLength,
            "grammar-typo",
            false,
            "silent"
          );
          this.editor._quill.formatText(
            0,
            docLength,
            "grammar-other",
            false,
            "silent"
          );
        } else {
          this.editor.formatText(0, docLength, "grammar-typo", false, "silent");
          this.editor.formatText(
            0,
            docLength,
            "grammar-other",
            false,
            "silent"
          );
        }
      } catch (_err) {
        // ignore
      }

      if (!errors || errors.length === 0) {
        // Restore cursor position even when no errors
        this.restoreCursorPositionImmediate(savedSelection);
        return;
      }

      // Robust formatting: try index-based formatting first; if that fails, fallback to text search
      const docText = this.editor.getText();
      const docLen = docText.length;

      errors.forEach((error) => {
        const start =
          typeof error.start_index === "number" ? error.start_index : null;
        const end =
          typeof error.end_index === "number" ? error.end_index : null;
        const len =
          start !== null && end !== null ? Math.max(0, end - start) : 0;
        const isTypo =
          error.error_code === "typo" ||
          (error.title && String(error.title).toLowerCase().includes("typo"));
        const formatName = isTypo ? "grammar-typo" : "grammar-other";

        let applied = false;
        if (start !== null && len > 0 && start < docLen) {
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
                "silent"
              );
            } else {
              this.editor.formatText(start, len, formatName, true, "silent");
            }
            applied = true;
          } catch (_err) {
            applied = false;
          }
        }

        if (!applied && error.error_text) {
          try {
            const needle = String(error.error_text).trim();
            if (needle.length > 0) {
              const foundIndex = docText.indexOf(needle);
              if (foundIndex !== -1) {
                // Use silent mode for fallback formatting as well
                if (
                  this.editor._quill &&
                  typeof this.editor._quill.formatText === "function"
                ) {
                  this.editor._quill.formatText(
                    foundIndex,
                    needle.length,
                    formatName,
                    true,
                    "silent"
                  );
                } else {
                  this.editor.formatText(
                    foundIndex,
                    needle.length,
                    formatName,
                    true,
                    "silent"
                  );
                }
                applied = true;
              }
            }
          } catch (_err) {
            // ignore
          }
        }
      });

      // Force immediate cursor restoration
      this.restoreCursorPositionImmediate(savedSelection);
    } finally {
      // Re-enable history if it was disabled
      if (quillInstance?.history?.options && _originalDelay !== undefined) {
        quillInstance.history.options.delay = _originalDelay; // Restore original delay
      }
    }
  }

  private restoreCursorPositionImmediate(
    selection: { index: number; length: number } | null
  ): void {
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
            "silent"
          );
        } else {
          this.editor.setSelection(
            Math.max(0, safeIndex),
            Math.max(0, safeLength),
            "silent"
          );
        }
      }
    } catch (_err) {
      // Fallback: try regular restoration with delay for Safari
      this.restoreCursorPosition(selection);
    }
  }

  private saveCursorPosition(): { index: number; length: number } | null {
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
            const startIndex =
              this.editor.getIndex(startBlot) + range.startOffset;
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

  private restoreCursorPosition(
    selection: { index: number; length: number } | null
  ): void {
    if (!selection) return;

    try {
      // Use multiple restoration attempts with different delays for Safari
      const isSafari = /^((?!chrome|android).)*safari/i.test(
        navigator.userAgent
      );

      const restoreAttempt = (attempt: number = 0) => {
        try {
          if (this.editor.setSelection) {
            // Ensure the selection is within document bounds
            const docLength = this.editor.getLength();
            const safeIndex = Math.min(selection.index, docLength - 1);
            const safeLength = Math.min(
              selection.length,
              docLength - safeIndex
            );

            this.editor.setSelection(
              Math.max(0, safeIndex),
              Math.max(0, safeLength)
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

  private showSuggestionTooltip(
    _anchor: HTMLElement,
    error: DivvunError,
    index: number,
    length: number,
    ev: MouseEvent
  ) {
    // Remove existing tooltip
    const existing = document.querySelector(".error-tooltip");
    if (existing) existing.remove();

    const tooltip = document.createElement("div");
    tooltip.className = "error-tooltip";

    const title = document.createElement("div");
    title.className = "error-title";
    title.textContent = error.title || "Suggestion";
    tooltip.appendChild(title);

    if (error.description) {
      const desc = document.createElement("div");
      desc.className = "error-description";
      desc.textContent = error.description;
      tooltip.appendChild(desc);
    }

    const ul = document.createElement("ul");
    ul.className = "suggestions";
    const suggestions =
      error.suggestions && error.suggestions.length > 0
        ? error.suggestions
        : [error.error_text];
    suggestions.forEach((sugg) => {
      const li = document.createElement("li");
      li.textContent = sugg;
      li.addEventListener("click", (e) => {
        e.stopPropagation();
        // Replace text in editor
        try {
          this.editor.deleteText(index, length);
          this.editor.insertText(index, sugg);
          // After replacement, clear formatting for that range
          this.editor.formatText(index, sugg.length, "grammar-typo", false);
          this.editor.formatText(index, sugg.length, "grammar-other", false);
          // Clear state errors and re-run check
          this.state.lastCheckedContent = "";
          this.clearErrors();
          this.checkGrammar();
        } catch (_err) {
          // ignore
        }
        tooltip.remove();
      });
      ul.appendChild(li);
    });
    tooltip.appendChild(ul);

    document.body.appendChild(tooltip);

    // Position near mouse but ensure within viewport
    const x = ev.clientX + 8;
    const y = ev.clientY + 8;
    const win = globalThis as unknown as {
      innerWidth: number;
      innerHeight: number;
    };
    tooltip.style.left = `${Math.min(win.innerWidth - 320, x)}px`;
    tooltip.style.top = `${Math.min(win.innerHeight - 200, y)}px`;
  }

  private updateStatus(status: string, isChecking: boolean): void {
    this.statusText.textContent = status;
    this.statusDisplay.className = isChecking
      ? "status checking"
      : "status complete";

    // Add/remove spinner
    const existingSpinner = this.statusDisplay.querySelector(".spinner");
    if (isChecking && !existingSpinner) {
      const spinner = document.createElement("div");
      spinner.className = "spinner";
      this.statusDisplay.appendChild(spinner);
    } else if (!isChecking && existingSpinner) {
      existingSpinner.remove();
    }
  }

  private updateErrorCount(count: number): void {
    this.errorCount.textContent = `${count} ${
      count === 1 ? "error" : "errors"
    }`;
    this.errorCount.className =
      count > 0 ? "error-count has-errors" : "error-count";
  }

  private showErrorMessage(message: string): void {
    // Simple alert for now - in a full implementation, you'd want a nicer notification system
    alert(`Error: ${message}`);
  }

  private getCaretPosition(caret: {
    offsetNode: Node;
    offset: number;
  }): number {
    // Use Quill's built-in method to find position from DOM node
    try {
      const blot = this.editor.findBlot?.(caret.offsetNode);
      if (blot && this.editor.getIndex) {
        return this.editor.getIndex(blot) + caret.offset;
      }
    } catch (_err) {
      // ignore
    }
    return 0;
  }

  private getRangePosition(range: Range): number {
    // Convert DOM range to Quill index (for Safari/Firefox)
    try {
      const blot = this.editor.findBlot?.(range.startContainer);
      if (blot && this.editor.getIndex) {
        return this.editor.getIndex(blot) + range.startOffset;
      }
    } catch (_err) {
      // ignore
    }
    return 0;
  }

  private showContextMenu(x: number, y: number, error: DivvunError): void {
    // Remove existing context menu
    const existing = document.getElementById("grammar-context-menu");
    if (existing) existing.remove();

    const menu = document.createElement("div");
    menu.id = "grammar-context-menu";

    // Use Tailwind classes for menu styling
    menu.className =
      "absolute bg-white border border-gray-300 rounded-md shadow-lg z-[1000] min-w-[120px] overflow-hidden";

    // Adjust coordinates to prevent menu from appearing off-screen
    // This helps with Chrome's different coordinate calculation
    const viewportWidth =
      globalThis.innerWidth || document.documentElement.clientWidth;
    const viewportHeight =
      globalThis.innerHeight || document.documentElement.clientHeight;

    const adjustedX = Math.max(10, Math.min(x, viewportWidth - 200));
    const adjustedY = Math.max(10, Math.min(y, viewportHeight - 150));

    // Position the menu
    menu.style.left = `${adjustedX}px`;
    menu.style.top = `${adjustedY}px`;

    // Add title if available
    if (error.title) {
      const title = document.createElement("div");
      title.className =
        "px-3 py-2 font-semibold border-b border-gray-200 text-xs text-gray-700 bg-gray-50";
      title.textContent = error.title;
      menu.appendChild(title);
    }

    // Add suggestions
    const suggestions =
      error.suggestions && error.suggestions.length > 0
        ? error.suggestions
        : [error.error_text];

    suggestions.forEach((suggestion) => {
      const btn = document.createElement("button");

      // Use Tailwind classes for button styling
      btn.className =
        "block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none transition-colors duration-150";
      btn.textContent = suggestion;

      btn.addEventListener("click", () => {
        this.applySuggestion(error, suggestion);
        menu.remove();
      });

      menu.appendChild(btn);
    });

    document.body.appendChild(menu);

    // Close menu when clicking outside - use longer delay to prevent immediate closure
    setTimeout(() => {
      const closeHandler = (e: Event) => {
        if (!menu.contains(e.target as Node)) {
          menu.remove();
          document.removeEventListener("click", closeHandler);
          document.removeEventListener("contextmenu", closeHandler);
        }
      };

      // Handle both click and contextmenu events for closing
      document.addEventListener("click", closeHandler);
      document.addEventListener("contextmenu", closeHandler);

      // Also close on escape key
      const escHandler = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          menu.remove();
          document.removeEventListener("keydown", escHandler);
          document.removeEventListener("click", closeHandler);
          document.removeEventListener("contextmenu", closeHandler);
        }
      };
      document.addEventListener("keydown", escHandler);
    }, 150); // Longer delay to prevent immediate closure from contextmenu event
  }

  private applySuggestion(error: DivvunError, suggestion: string): void {
    try {
      // Apply the suggestion
      const start = error.start_index;
      const length = error.end_index - error.start_index;

      // Clear formatting first
      this.editor.formatText(
        start,
        length,
        error.error_code === "typo" ? "grammar-typo" : "grammar-other",
        false
      );

      // Replace the text
      this.editor.deleteText(start, length);
      this.editor.insertText(start, suggestion);

      // Set cursor position after the replaced text
      const newCursorPosition = start + suggestion.length;
      try {
        this.editor.setSelection(newCursorPosition, 0);
      } catch (_selErr) {
        // If selection fails, at least focus the editor
        this.editor.focus();
      }

      // Clear state and re-check grammar
      this.state.lastCheckedContent = "";
      this.clearErrors();

      // Re-run grammar check after a brief delay
      setTimeout(() => {
        this.checkGrammar();
      }, 100);
    } catch (_err) {
      // ignore
    }
  }

  setLanguage(language: SupportedLanguage): void {
    this.config.language = language;
    this.clearErrors();
    // Re-check with new language if there's content
    const text = this.getText();
    if (text && text.trim()) {
      this.state.lastCheckedContent = ""; // Force re-check
      this.checkGrammar();
    }
  }

  setText(text: string): void {
    this.editor.setText(text);
    this.state.lastCheckedContent = ""; // Force re-check
    this.checkGrammar();
  }

  getText(): string {
    return this.editor.getText();
  }

  clearEditor(): void {
    this.editor.setText("");
    this.clearErrors();
    this.editor.focus();
  }

  clearErrors(): void {
    this.state.errors = [];
    this.state.errorSpans = [];
    this.updateErrorCount(0);
    // Remove any grammar-error formatting
    try {
      const docLength = this.editor.getLength();
      this.editor.formatText(0, docLength, "grammar-error", false);
    } catch (_err) {
      // ignore
    }

    // Remove any tooltips
    const tooltips = document.querySelectorAll(".error-tooltip");
    tooltips.forEach((tooltip) => tooltip.remove());
  }

  // Test methods
  testUserExample(): void {
    this.setText("Dáll čálán davvsámgiela");
  }

  testGrammarErrors(): void {
    this.setText("Mun leat studeanta ja mun háliidan oahpahit sámegiella.");
  }

  testMixedErrors(): void {
    this.setText(
      "This textt has speling errors. Mun leat studeanta ja háliidan oahpahit sámegiella."
    );
  }

  // Public API for debugging
  getState(): EditorState {
    return { ...this.state };
  }

  getConfig(): GrammarCheckerConfig {
    return { ...this.config };
  }
}

// Initialize the grammar checker when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded, initializing grammar checker...");

  // Check if required elements exist
  const editorElement = document.getElementById("editor");
  console.log("Editor element:", editorElement);

  if (!editorElement) {
    console.error("Editor element not found!");
    return;
  }

  // Check if Quill is available
  const quill = (globalThis as unknown as { Quill?: unknown })?.Quill;
  console.log("Quill available:", !!quill);

  // Check if QuillBridge is available
  const bridge = (globalThis as unknown as { QuillBridge?: unknown })
    ?.QuillBridge;
  console.log("QuillBridge available:", !!bridge);

  if (!quill) {
    console.error("Quill.js not loaded!");
    return;
  }

  if (!bridge) {
    console.error("QuillBridge not loaded!");
    return;
  }

  try {
    const grammarChecker = new GrammarChecker();

    // Make it available globally for debugging
    (
      globalThis as unknown as { grammarChecker?: GrammarChecker }
    ).grammarChecker = grammarChecker;

    console.log("Grammar checker initialized successfully");
  } catch (error) {
    console.error("Error initializing grammar checker:", error);
  }
});

// The GrammarChecker class is already exported above
