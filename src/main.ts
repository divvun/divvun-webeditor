import {
  getAvailableLanguages,
  GrammarCheckerAPI,
  SpellCheckerAPI,
} from "./api.ts";
import type {
  AvailableLanguage,
  CheckerApi,
  CheckerError,
  CheckerState,
  CheckingContext,
  EditorState,
  GrammarCheckerConfig,
  LineCacheEntry,
  SupportedLanguage,
} from "./types.ts";
import { CursorManager, type CursorPosition } from "./cursor-manager.ts";
import { SuggestionManager, type SuggestionCallbacks } from "./suggestion-manager.ts";

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
    source?: string,
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
      source?: string,
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
        options?: unknown,
      ) => QuillBridgeInstance;
    };
  }
).QuillBridge;
if (!maybeBridge) {
  throw new Error(
    "QuillBridge is not available. Ensure src/quill-bridge.js is loaded.",
  );
}
const QuillBridge = maybeBridge;

// Global variable to store available languages from API
let availableLanguages: AvailableLanguage[] = [];

export class GrammarChecker {
  private api: CheckerApi;
  private config: GrammarCheckerConfig;
  private state: EditorState;
  private checkTimeout: ReturnType<typeof setTimeout> | null = null;

  // State machine
  private currentState: CheckerState = "idle";
  private checkingContext: CheckingContext | null = null;
  private lineCache: Map<number, LineCacheEntry> = new Map();

  // Undo detection
  private recentTextChanges: Array<{ timestamp: number; text: string }> = [];
  private lastUserActionTime: number = 0;
  private isHighlighting: boolean = false;

  // DOM elements
  private editor: QuillBridgeInstance; // Quill instance
  private languageSelect: HTMLSelectElement;
  private clearButton: HTMLButtonElement;
  private statusText: HTMLElement;
  private statusDisplay: HTMLElement;
  private errorCount: HTMLElement;

  // Cursor management
  private cursorManager: CursorManager;
  
  // Suggestion management
  private suggestionManager: SuggestionManager;

  private createApiForLanguage(language: SupportedLanguage): CheckerApi {
    // Find the language in our available languages list
    const languageInfo = availableLanguages.find(
      (lang) => lang.code === language,
    );

    if (languageInfo) {
      // Use the API type specified by the server
      if (languageInfo.type === "speller") {
        return new SpellCheckerAPI();
      } else {
        return new GrammarCheckerAPI();
      }
    }

    // Fallback logic if language not found in API data
    // SMS uses spell checker, all others use grammar checker
    if (language === "sms") {
      return new SpellCheckerAPI();
    } else {
      return new GrammarCheckerAPI();
    }
  }

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

    this.api = this.createApiForLanguage(this.config.language);

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

    // Initialize cursor manager
    this.cursorManager = new CursorManager(this.editor);

    // Initialize suggestion manager
    const suggestionCallbacks: SuggestionCallbacks = {
      onSuggestionApplied: (error: CheckerError, suggestion: string) => {
        this.applySuggestion(error, suggestion);
      },
      onClearErrors: () => {
        this.state.lastCheckedContent = "";
        this.clearErrors();
      },
      onCheckGrammar: () => {
        this.checkGrammar();
      }
    };
    this.suggestionManager = new SuggestionManager(this.editor, suggestionCallbacks);

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
      "language-select",
    ) as HTMLSelectElement;
    this.clearButton = document.getElementById(
      "clear-btn",
    ) as HTMLButtonElement;
    this.statusText = document.getElementById("status-text") as HTMLElement;
    this.statusDisplay = document.getElementById(
      "status-display",
    ) as HTMLElement;
    this.errorCount = document.getElementById("error-count") as HTMLElement;

    // Set up event listeners (LanguageSelector component handles its own options)
    this.setupEventListeners();
  }

  async initializeLanguages(): Promise<void> {
    // Fetch available languages from API
    try {
      availableLanguages = await getAvailableLanguages();
      // Re-initialize the API with the default language using the new data
      this.api = this.createApiForLanguage(this.config.language);
    } catch (error) {
      console.warn("Failed to initialize languages:", error);
      // Continue with current API setup as fallback
    }
  }

  private setupEventListeners(): void {
    // Auto-check on text change using state machine
    this.editor.on("text-change", (...args: unknown[]) => {
      const source = args[2] as string;
      const now = Date.now();
      const currentText = this.editor.getText();

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

      // State machine transitions based on current state
      switch (this.currentState) {
        case "idle":
          this.transitionTo("editing", "text-change");
          break;
        case "editing":
          // Reset to editing (interrupts any pending timeout)
          this.transitionTo("editing", "continued-editing");
          break;
        case "timeout":
          // Interrupt timeout and go back to editing
          this.transitionTo("editing", "editing-during-timeout");
          break;
        case "checking":
          // Interrupt ongoing check and start editing
          this.transitionTo("editing", "editing-during-check");
          break;
        case "highlighting":
          // Skip if currently highlighting
          console.debug("🔄 Text change during highlighting, ignoring");
          break;
      }

      // If now in editing state, start the timeout
      if (this.currentState === "editing") {
        this.transitionTo("timeout", "editing-finished");
      }
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
          this.handleIntelligentPasteCheck(
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
      this.setLanguage(language);
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
      let matchingError: CheckerError | undefined;

      // Method 1: Check if right-clicking directly on an error element
      const target = e.target as HTMLElement;
      const errorElement = target.closest(
        ".grammar-typo, .grammar-other",
      ) as HTMLElement;

      if (errorElement) {
        // Get the text content and find matching error
        const errorText = errorElement.textContent || "";
        matchingError = this.state.errors.find(
          (error) =>
            error.error_text === errorText ||
            (error.suggestions &&
              error.suggestions.some((s) => s.includes(errorText))),
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
          matchingError = this.state.errors.find(
            (err) =>
              err.start_index <= clickIndex && clickIndex < err.end_index,
          );
        }
      }

      if (matchingError) {
        // Calculate Chrome-compatible coordinates
        let menuX = e.clientX;
        let menuY = e.clientY;

        // Detect browser for positioning adjustments
        const userAgent = globalThis.navigator?.userAgent || "";
        const isChrome = userAgent.includes("Chrome") &&
          !userAgent.includes("Edg");

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

        this.suggestionManager.showContextMenu(menuX, menuY, matchingError);
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
        const matching = this.state.errors.find(
          (err) =>
            err.start_index === index &&
            err.end_index - err.start_index === length,
        );
        if (matching) {
          this.suggestionManager.showSuggestionTooltip(
            errorNode,
            matching,
            index,
            length,
            e as MouseEvent,
          );
        }
      } catch (_err) {
        // ignore
      }
    });
  }

  private async handleIntelligentPasteCheck(
    prePasteSelection: { index: number; length: number },
    prePasteText: string,
    pastedContent: string,
  ): Promise<void> {
    try {
      // Get current text after paste
      const postPasteText = this.editor.getText();

      // Calculate paste boundaries
      const pasteStartIndex = prePasteSelection.index;
      const replacedLength = prePasteSelection.length; // Length of selected text that was replaced
      const actualPastedLength = pastedContent.length;

      // Calculate net length change
      const lengthDifference = actualPastedLength - replacedLength;

      console.debug("  Net length change:", lengthDifference);

      // Determine which lines need checking
      const linesToCheck = this.calculateAffectedLines(
        pasteStartIndex,
        actualPastedLength,
        prePasteText,
        postPasteText,
      );

      // Perform intelligent checking
      await this.checkAffectedLinesOnly(
        linesToCheck,
        pasteStartIndex,
        lengthDifference,
        postPasteText,
      );
    } catch (error) {
      console.error(
        "Intelligent paste check failed, falling back to full check:",
        error,
      );
      // Fallback to full check
      this.state.lastCheckedContent = "";
      this.checkGrammar();
    }
  }

  private calculateAffectedLines(
    pasteStartIndex: number,
    pastedLength: number,
    prePasteText: string,
    postPasteText: string,
  ): { startLine: number; endLine: number; needsIndexAdjustment: boolean } {
    // Find which lines contain the paste
    const preLines = prePasteText.split("\n");
    const postLines = postPasteText.split("\n");

    // Find the line where paste started
    let currentIndex = 0;
    let startLine = 0;

    for (let i = 0; i < preLines.length; i++) {
      const lineLength = preLines[i].length + (i < preLines.length - 1 ? 1 : 0); // +1 for newline
      if (currentIndex + lineLength > pasteStartIndex) {
        startLine = i;
        break;
      }
      currentIndex += lineLength;
    }

    // Find the line where paste ended
    const pasteEndIndex = pasteStartIndex + pastedLength;
    currentIndex = 0;
    let endLine = startLine;

    for (let i = 0; i < postLines.length; i++) {
      const lineLength = postLines[i].length +
        (i < postLines.length - 1 ? 1 : 0);
      if (currentIndex + lineLength >= pasteEndIndex) {
        endLine = i;
        break;
      }
      currentIndex += lineLength;
    }

    // Include one line before and after for context (if they exist)
    const contextStartLine = Math.max(0, startLine - 1);
    const contextEndLine = Math.min(postLines.length - 1, endLine + 1);

    return {
      startLine: contextStartLine,
      endLine: contextEndLine,
      needsIndexAdjustment: true, // Lines after the paste need index adjustment
    };
  }

  private async checkAffectedLinesOnly(
    linesToCheck: {
      startLine: number;
      endLine: number;
      needsIndexAdjustment: boolean;
    },
    pasteStartIndex: number,
    lengthDifference: number,
    fullText: string,
  ): Promise<void> {
    if (this.state.isChecking) return;

    this.state.isChecking = true;
    this.updateStatus("Checking affected lines...", true);

    try {
      const lines = fullText.split("\n");
      const newErrors: CheckerError[] = [];

      // Step 1: Remove errors from affected lines (they'll be rechecked)
      let currentIndex = 0;
      const affectedStartIndex = this.getLineStartIndex(
        linesToCheck.startLine,
        lines,
      );
      const affectedEndIndex = this.getLineStartIndex(
        linesToCheck.endLine + 1,
        lines,
      );

      this.state.errors = this.state.errors.filter((error) => {
        // Remove errors that fall within the affected range
        return !(
          error.start_index >= affectedStartIndex &&
          error.start_index < affectedEndIndex
        );
      });

      // Step 2: Adjust indices of errors that come after the paste
      if (lengthDifference !== 0) {
        this.state.errors = this.state.errors.map((error) => {
          if (error.start_index > pasteStartIndex) {
            return {
              ...error,
              start_index: error.start_index + lengthDifference,
              end_index: error.end_index + lengthDifference,
            };
          }
          return error;
        });
      }

      // Step 3: Check only the affected lines
      currentIndex = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineWithNewline = i < lines.length - 1 ? line + "\n" : line;

        if (i >= linesToCheck.startLine && i <= linesToCheck.endLine) {
          // Check this affected line
          if (lineWithNewline.trim()) {
            this.updateStatus(`Checking affected line ${i + 1}...`, true);

            try {
              const response = await this.api.checkText(
                lineWithNewline,
                this.config.language,
              );

              // Adjust error indices to account for position in full text
              const adjustedErrors = response.errs.map((error) => ({
                ...error,
                start_index: error.start_index + currentIndex,
                end_index: error.end_index + currentIndex,
              }));

              newErrors.push(...adjustedErrors);

              // Highlight errors for this line immediately
              if (adjustedErrors.length > 0) {
                this.highlightLineErrors(adjustedErrors);
              }
            } catch (error) {
              console.warn(`Error checking affected line ${i + 1}:`, error);
            }
          }
        }

        currentIndex += lineWithNewline.length;
      }

      // Step 4: Add new errors and update state
      this.state.errors.push(...newErrors);
      this.state.lastCheckedContent = fullText;

      // Re-highlight all errors to ensure proper display
      this.highlightErrors(this.state.errors);

      const errorCount = this.state.errors.length;
      this.updateStatus("Ready", false);
      this.updateErrorCount(errorCount);

      console.log(
        `Intelligent paste check complete. Checked lines ${
          linesToCheck.startLine + 1
        }-${linesToCheck.endLine + 1}. Total errors: ${errorCount}`,
      );
    } catch (error) {
      console.error("Affected lines check failed:", error);
      this.updateStatus("Error checking grammar", false);
      throw error;
    } finally {
      this.state.isChecking = false;
    }
  }

  private isUndoOperation(currentText: string, source: string): boolean {
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
        (change) => now - change.timestamp < 1000, // Last 1 second
      );

      if (recentChanges.length > 3) {
        console.debug("🔄 Rapid text changes detected - possible undo cascade");
        return true;
      }
    }

    // Check if this change happened very soon after user action but during highlighting
    if (this.isHighlighting && now - this.lastUserActionTime < 2000) {
      console.debug(
        "🔄 Change during highlighting phase - likely undo of highlight",
      );
      return true;
    }

    return false;
  }

  private finishHighlighting(): void {
    setTimeout(() => {
      this.isHighlighting = false;

      // Transition back to idle when highlighting is complete
      if (this.currentState === "highlighting") {
        this.transitionTo("idle", "highlighting-complete");
      }
    }, 100); // Small delay to ensure all operations are complete
  }

  // State Machine Methods
  private transitionTo(newState: CheckerState, _trigger: string): void {
    if (newState === this.currentState) {
      return; // No transition needed
    }

    // Handle state exit
    this.onStateExit(this.currentState);

    // Update current state
    this.currentState = newState;

    // Handle state entry
    this.onStateEntry(this.currentState);
  }

  private onStateExit(state: CheckerState): void {
    switch (state) {
      case "timeout":
        if (this.checkTimeout) {
          clearTimeout(this.checkTimeout);
          this.checkTimeout = null;
        }
        break;
      case "checking":
        // Abort any ongoing check
        if (this.checkingContext?.abortController) {
          this.checkingContext.abortController.abort();
        }
        this.state.isChecking = false;
        break;
    }
  }

  private onStateEntry(state: CheckerState): void {
    switch (state) {
      case "idle":
        this.updateStatus("Ready", false);
        this.checkingContext = null;
        break;
      case "editing":
        // Clear any pending timeouts
        if (this.checkTimeout) {
          clearTimeout(this.checkTimeout);
          this.checkTimeout = null;
        }
        break;
      case "timeout":
        // Start the timeout for checking
        this.checkTimeout = setTimeout(() => {
          this.transitionTo("checking", "timeout-expired");
        }, this.config.autoCheckDelay);
        break;
      case "checking":
        this.state.isChecking = true;
        this.updateStatus("Checking...", true);
        // Perform the actual checking
        this.performGrammarCheck();
        break;
      case "highlighting":
        this.updateStatus("Updating highlights...", true);
        break;
    }
  }

  // Line-level caching methods
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
        this.config.language,
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

  private invalidateLineCache(
    fromLine: number,
    toLine: number = fromLine,
  ): void {
    for (let i = fromLine; i <= toLine; i++) {
      this.lineCache.delete(i);
    }
  }

  private getLineNumberFromIndex(index: number): number {
    const text = this.editor.getText();
    const lines = text.substring(0, index).split("\n");
    return lines.length - 1; // 0-based line number
  }

  private performGrammarCheck(): void {
    // Set up checking context
    this.checkingContext = {
      abortController: new AbortController(),
      startTime: new Date(),
    };

    // Perform the actual grammar check
    this.checkGrammar()
      .then(() => {
        if (this.currentState === "checking") {
          this.transitionTo("highlighting", "check-complete");
        }
      })
      .catch((error) => {
        console.warn("Grammar check failed:", error);
        if (this.currentState === "checking") {
          this.transitionTo("idle", "check-failed");
        }
      });
  }

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

  async checkGrammar(): Promise<void> {
    const currentText = this.editor.getText();

    // Don't check if content hasn't changed or is empty
    if (!currentText || currentText.trim() === "") {
      if (this.currentState === "checking") {
        this.transitionTo("idle", "empty-content");
      }
      return;
    }

    // Skip if content hasn't changed
    if (currentText === this.state.lastCheckedContent) {
      if (this.currentState === "checking") {
        this.transitionTo("idle", "no-change");
      }
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
        if (lineErrors.length > 0 && this.currentState === "checking") {
          this.highlightLineErrors(lineErrors);
          // Update error count progressively
          this.updateErrorCount(allErrors.length);
        }
      }

      // Only proceed if we're still in checking state
      if (this.currentState === "checking") {
        this.state.lastCheckedContent = currentText;
        this.state.errors = allErrors;

        // Update final error count
        this.updateErrorCount(allErrors.length);

        // Transition to idle since highlighting was done progressively
        this.transitionTo("idle", "check-complete");
      }
    } catch (error) {
      console.error("Grammar check failed:", error);
      this.updateStatus("Error checking grammar", false);
      this.showErrorMessage(
        error instanceof Error ? error.message : String(error),
      );

      // Transition back to idle on error
      if (this.currentState === "checking") {
        this.transitionTo("idle", "check-error");
      }
    }
  }

  private highlightLineErrors(errors: CheckerError[]): void {
    // Set highlighting flag to prevent triggering grammar checks during line highlighting
    this.isHighlighting = true;

    // AGGRESSIVE FIX: Always clear ALL formatting before highlighting
    try {
      const docLength = this.editor.getLength();
      this.editor.formatText(0, docLength, "grammar-error", false, "silent");
      this.editor.formatText(0, docLength, "grammar-typo", false, "silent");
      this.editor.formatText(0, docLength, "grammar-other", false, "silent");
    } catch (_err) {
      // ignore
    }

    // Highlight errors for a specific line without clearing existing highlights
    const savedSelection = this.cursorManager.saveCursorPosition();

    // Detect Safari
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    try {
      if (isSafari) {
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
      if (isSafari) {
        this.finishHighlighting();
      }
    }
  }

  private performLineHighlightingOperations(
    errors: CheckerError[],
    savedSelection: { index: number; length: number } | null,
  ): void {
    // Disable Quill history during line highlighting
    const quillInstance = this.editor._quill as unknown as {
      history?: {
        disable?: () => void;
        enable?: () => void;
      };
    };
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

  private highlightErrors(errors: CheckerError[]): void {
    // Set highlighting flag to prevent triggering grammar checks during highlighting
    this.isHighlighting = true;

    // Safari-specific approach: Completely disable all selection events during formatting
    const savedSelection = this.cursorManager.saveCursorPosition();

    // Detect Safari
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    try {
      if (isSafari) {
        // For Safari, use a more aggressive approach
        this.performSafariSafeHighlighting(errors, savedSelection);
      } else {
        // Use standard approach for other browsers
        requestAnimationFrame(() => {
          this.performHighlightingOperations(errors, savedSelection);
          // Clear highlighting flag after operations complete
          this.finishHighlighting();
        });
        return; // Early return for async path
      }
    } finally {
      // Clear highlighting flag for synchronous Safari path
      if (isSafari) {
        this.finishHighlighting();
      }
    }
  }

  private trySafariDOMIsolation(
    errors: CheckerError[],
    savedSelection: { index: number; length: number } | null,
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
      globalThis.scrollTo(scrollLeft, scrollTop);

      // Restore cursor position after a brief delay
      setTimeout(() => {
        if (savedSelection) {
          const docLength = this.editor.getLength();
          const safeIndex = Math.min(
            savedSelection.index,
            Math.max(0, docLength - 1),
          );
          const safeLength = Math.min(
            savedSelection.length,
            Math.max(0, docLength - safeIndex),
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
    errors: CheckerError[],
    savedSelection: { index: number; length: number } | null,
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
              Math.max(0, docLength - 1),
            );
            const safeLength = Math.min(
              savedSelection.length,
              Math.max(0, docLength - safeIndex),
            );

            originalSetSelection.call(
              quillInstance,
              safeIndex,
              safeLength,
              "silent",
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
    errors: CheckerError[],
    savedSelection: { index: number; length: number } | null,
  ): void {
    // Batch all operations together to minimize DOM thrashing
    const quillInstance = this.editor._quill as unknown as {
      history?: {
        options?: { delay?: number };
        disable?: () => void;
        enable?: () => void;
        clear?: () => void;
      };
      setSelection?: (index: number, length: number, source?: string) => void;
    };

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
      // Clear existing error formatting across the document
      console.debug("🎨 Clearing existing formatting before highlighting");
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
            "silent",
          );
          this.editor._quill.formatText(
            0,
            docLength,
            "grammar-other",
            false,
            "silent",
          );
        } else {
          this.editor.formatText(0, docLength, "grammar-typo", false, "silent");
          this.editor.formatText(
            0,
            docLength,
            "grammar-other",
            false,
            "silent",
          );
        }
      } catch (_err) {
        // ignore
      }

      if (!errors || errors.length === 0) {
        // Restore cursor position even when no errors
        this.cursorManager.restoreCursorPositionImmediate(savedSelection);
        return;
      }

      // Robust formatting: try index-based formatting first; if that fails, fallback to text search
      const docText = this.editor.getText();
      const docLen = docText.length;

      errors.forEach((error) => {
        const start = typeof error.start_index === "number"
          ? error.start_index
          : null;
        const end = typeof error.end_index === "number"
          ? error.end_index
          : null;
        const len = start !== null && end !== null
          ? Math.max(0, end - start)
          : 0;
        const isTypo = error.error_code === "typo" ||
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
                "silent",
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
                    "silent",
                  );
                } else {
                  this.editor.formatText(
                    foundIndex,
                    needle.length,
                    formatName,
                    true,
                    "silent",
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
      this.cursorManager.restoreCursorPositionImmediate(savedSelection);
    } finally {
      // Restore original history recording if it was intercepted
      if (originalHistoryRecord && quillInstance?.history) {
        console.debug(
          "🎨 Restoring Quill history recording after highlighting",
        );
        const history = quillInstance.history as unknown as {
          record?: () => void;
        };
        if (history) {
          history.record = originalHistoryRecord;
        }
      }
    }
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
    this.errorCount.className = count > 0
      ? "error-count has-errors"
      : "error-count";
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



  private applySuggestion(error: CheckerError, suggestion: string): void {
    try {
      // Get line information before making changes
      const lineInfo = this.getLineFromError(error);
      const originalLength = error.end_index - error.start_index;
      const newLength = suggestion.length;
      const lengthDifference = newLength - originalLength;

      console.log(
        `Applying suggestion on line ${lineInfo.lineNumber}: "${error.error_text}" → "${suggestion}"`,
      );
      console.log(
        `Length change: ${originalLength} → ${newLength} (diff: ${lengthDifference})`,
      );

      // Apply the suggestion
      const start = error.start_index;

      // Clear formatting first
      this.editor.formatText(
        start,
        originalLength,
        error.error_code === "typo" ? "grammar-typo" : "grammar-other",
        false,
      );

      // Replace the text
      this.editor.deleteText(start, originalLength);
      this.editor.insertText(start, suggestion);

      // Set cursor position after the replaced text
      const newCursorPosition = start + newLength;
      try {
        this.editor.setSelection(newCursorPosition, 0);
      } catch (_selErr) {
        // If selection fails, at least focus the editor
        this.editor.focus();
      }

      // Intelligent re-checking: only check the modified line and adjust indices
      setTimeout(() => {
        this.intelligentCorrection(
          error,
          suggestion,
          lineInfo,
          lengthDifference,
        );
      }, 100);
    } catch (_err) {
      // ignore
    }
  }

  private async intelligentCorrection(
    originalError: CheckerError,
    _suggestion: string,
    lineInfo: {
      lineNumber: number;
      lineContent: string;
      positionInLine: number;
    },
    lengthDifference: number,
  ): Promise<void> {
    try {
      console.log(
        `Starting intelligent correction for line ${lineInfo.lineNumber}`,
      );

      // Remove the corrected error from state
      this.state.errors = this.state.errors.filter(
        (err) => err !== originalError,
      );

      // If there's a length difference, adjust indices of subsequent errors
      if (lengthDifference !== 0) {
        this.adjustSubsequentErrorIndices(
          originalError.start_index,
          lengthDifference,
        );
      }

      // Only recheck the modified line
      await this.recheckModifiedLine(lineInfo.lineNumber);

      // Update UI
      this.updateErrorCount(this.state.errors.length);
      this.updateStatus("Ready", false);

      console.log(
        `Intelligent correction complete. Total errors: ${this.state.errors.length}`,
      );
    } catch (error) {
      console.error(
        "Intelligent correction failed, falling back to full check:",
        error,
      );
      // Fallback to full grammar check
      this.state.lastCheckedContent = "";
      this.clearErrors();
      this.checkGrammar();
    }
  }

  private adjustSubsequentErrorIndices(
    correctionPosition: number,
    lengthDifference: number,
  ): void {
    console.log(
      `Adjusting error indices after position ${correctionPosition} by ${lengthDifference}`,
    );

    this.state.errors = this.state.errors.map((error) => {
      if (error.start_index > correctionPosition) {
        return {
          ...error,
          start_index: error.start_index + lengthDifference,
          end_index: error.end_index + lengthDifference,
        };
      }
      return error;
    });

    // Re-highlight all errors with adjusted positions
    this.highlightErrors(this.state.errors);
  }

  private async recheckModifiedLine(lineNumber: number): Promise<void> {
    try {
      const fullText = this.editor.getText();
      const lines = fullText.split("\n");

      if (lineNumber < 1 || lineNumber > lines.length) {
        console.warn(`Invalid line number: ${lineNumber}`);
        return;
      }

      // Get the modified line (convert from 1-based to 0-based index)
      const lineIndex = lineNumber - 1;
      const line = lines[lineIndex];
      const lineWithNewline = lineIndex < lines.length - 1 ? line + "\n" : line;

      // Calculate the start position of this line in the full text
      let lineStartPosition = 0;
      for (let i = 0; i < lineIndex; i++) {
        const prevLine = lines[i];
        const prevLineWithNewline = i < lines.length - 1
          ? prevLine + "\n"
          : prevLine;
        lineStartPosition += prevLineWithNewline.length;
      }

      console.log(`Rechecking line ${lineNumber}: "${line}"`);

      // Only check if the line has content
      if (lineWithNewline.trim()) {
        const response = await this.api.checkText(
          lineWithNewline,
          this.config.language,
        );

        // Adjust error indices to account for position in full text
        const adjustedErrors = response.errs.map((error) => ({
          ...error,
          start_index: error.start_index + lineStartPosition,
          end_index: error.end_index + lineStartPosition,
        }));

        // Remove any existing errors from this line first
        this.state.errors = this.state.errors.filter((error) => {
          const lineEnd = lineStartPosition + lineWithNewline.length;
          return !(
            error.start_index >= lineStartPosition &&
            error.start_index < lineEnd
          );
        });

        // Add new errors from the rechecked line
        this.state.errors.push(...adjustedErrors);

        // Highlight the new errors for this line
        if (adjustedErrors.length > 0) {
          this.highlightLineErrors(adjustedErrors);
        }

        console.log(
          `Line ${lineNumber} recheck complete. Found ${adjustedErrors.length} errors.`,
        );
      }
    } catch (error) {
      console.error(`Error rechecking line ${lineNumber}:`, error);
    }
  }

  setLanguage(language: SupportedLanguage): void {
    this.config.language = language;
    // Create appropriate API for the new language
    this.api = this.createApiForLanguage(language);
    this.clearErrors();
    // Re-check with new language if there's content
    const text = this.getText();
    if (text && text.trim()) {
      this.state.lastCheckedContent = ""; // Force re-check
      this.checkGrammar();
    }
  }

  private getLineFromError(error: CheckerError): {
    lineNumber: number;
    lineContent: string;
    positionInLine: number;
  } {
    const fullText = this.editor.getText();
    const lines = fullText.split("\n");
    let currentIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineWithNewline = i < lines.length - 1 ? line + "\n" : line;
      const lineStart = currentIndex;
      const lineEnd = currentIndex + lineWithNewline.length;

      // Check if the error falls within this line
      if (error.start_index >= lineStart && error.start_index < lineEnd) {
        return {
          lineNumber: i + 1, // 1-based line numbering
          lineContent: line,
          positionInLine: error.start_index - lineStart,
        };
      }

      currentIndex += lineWithNewline.length;
    }

    // Fallback if line not found
    return {
      lineNumber: 1,
      lineContent: lines[0] || "",
      positionInLine: error.start_index,
    };
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
  }
}

// Initialize the grammar checker when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  // Check if required elements exist
  const editorElement = document.getElementById("editor");

  if (!editorElement) {
    console.error("Editor element not found!");
    return;
  }

  // Check if Quill is available
  const quill = (globalThis as unknown as { Quill?: unknown })?.Quill;

  // Check if QuillBridge is available
  const bridge = (globalThis as unknown as { QuillBridge?: unknown })
    ?.QuillBridge;

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

    // Initialize languages asynchronously
    grammarChecker
      .initializeLanguages()
      .then(() => {
        console.log("Languages initialized successfully");
      })
      .catch((error) => {
        console.warn("Language initialization failed:", error);
      });

    // Make it available globally for debugging
    (
      globalThis as unknown as { grammarChecker?: GrammarChecker }
    ).grammarChecker = grammarChecker;
  } catch (error) {
    console.error("Error initializing grammar checker:", error);
  }
});

// The GrammarChecker class is already exported above
