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
  SupportedLanguage,
} from "./types.ts";
import { CursorManager, type CursorPosition } from "./cursor-manager.ts";
import {
  SuggestionManager,
  type SuggestionCallbacks,
} from "./suggestion-manager.ts";
import { TextAnalyzer, type TextAnalysisCallbacks } from "./text-analyzer.ts";
import {
  CheckerStateMachine,
  type StateTransitionCallbacks,
} from "./checker-state-machine.ts";
import { EventManager, type EventCallbacks } from "./event-manager.ts";
import {
  ErrorHighlighter,
  type HighlightingCallbacks,
} from "./error-highlighter.ts";

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

// Global variable to store available languages from API
let availableLanguages: AvailableLanguage[] = [];

export class GrammarChecker {
  private api: CheckerApi;
  private config: GrammarCheckerConfig;
  private state: EditorState;
  private checkingContext: CheckingContext | null = null;
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

  // Text analysis
  private textAnalyzer: TextAnalyzer;

  // State machine
  private stateMachine: CheckerStateMachine;

  // Event management
  private eventManager: EventManager;

  // Error highlighting
  private errorHighlighter: ErrorHighlighter;

  private createApiForLanguage(language: SupportedLanguage): CheckerApi {
    // Find the language in our available languages list
    const languageInfo = availableLanguages.find(
      (lang) => lang.code === language
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
        this.errorHighlighter.clearErrors();
      },
      onCheckGrammar: () => {
        this.textAnalyzer.checkGrammar();
      },
    };
    this.suggestionManager = new SuggestionManager(
      this.editor,
      suggestionCallbacks
    );

    // Initialize text analyzer
    const textAnalysisCallbacks: TextAnalysisCallbacks = {
      onErrorsFound: (errors: CheckerError[], lineNumber?: number) => {
        if (lineNumber !== undefined) {
          this.errorHighlighter.highlightLineErrors(errors);
        } else {
          this.state.errors = errors;
          this.eventManager.updateErrors(errors);
        }
      },
      onUpdateErrorCount: (count: number) => {
        this.updateErrorCount(count);
      },
      onUpdateStatus: (status: string, isChecking: boolean) => {
        this.updateStatus(status, isChecking);
      },
      onShowErrorMessage: (message: string) => {
        this.showErrorMessage(message);
      },
    };
    this.textAnalyzer = new TextAnalyzer(
      this.api,
      this.editor,
      textAnalysisCallbacks,
      this.config.language
    );

    // Initialize state machine
    const stateTransitionCallbacks: StateTransitionCallbacks = {
      onStateEntry: (state: CheckerState) => this.onStateEntry(state),
      onStateExit: (state: CheckerState) => this.onStateExit(state),
      onCheckRequested: () => this.performGrammarCheck(),
    };
    this.stateMachine = new CheckerStateMachine(
      this.config.autoCheckDelay,
      stateTransitionCallbacks
    );

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

    // Initialize event manager
    const eventCallbacks: EventCallbacks = {
      onTextChange: (source: string, currentText: string) =>
        this.handleTextChange(source, currentText),
      onLanguageChange: (language: SupportedLanguage) =>
        this.setLanguage(language),
      onClearEditor: () => this.clearEditor(),
      onErrorClick: (
        errorNode: HTMLElement,
        matching: CheckerError,
        index: number,
        length: number,
        event: MouseEvent
      ) =>
        this.suggestionManager.showSuggestionTooltip(
          errorNode,
          matching,
          index,
          length,
          event
        ),
      onErrorRightClick: (x: number, y: number, matchingError: CheckerError) =>
        this.suggestionManager.showContextMenu(x, y, matchingError),
      onIntelligentPasteCheck: (
        prePasteSelection: { index: number; length: number },
        prePasteText: string,
        pastedContent: string
      ) =>
        this.handleIntelligentPasteCheck(
          prePasteSelection,
          prePasteText,
          pastedContent
        ),
    };
    this.eventManager = new EventManager(
      this.editor,
      this.clearButton,
      eventCallbacks
    );

    // Initialize error highlighter
    const highlightingCallbacks: HighlightingCallbacks = {
      onHighlightingStart: () => {
        this.isHighlighting = true;
        this.eventManager.setHighlightingState(true);
      },
      onHighlightingComplete: () => {
        this.isHighlighting = false;
        this.eventManager.setHighlightingState(false);
        this.stateMachine.onHighlightingComplete();
      },
      onErrorsCleared: () => {
        this.state.errors = [];
        this.eventManager.updateErrors([]);
        this.state.errorSpans = [];
        this.updateErrorCount(0);
      },
    };
    this.errorHighlighter = new ErrorHighlighter(
      this.editor,
      this.cursorManager,
      highlightingCallbacks
    );
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

  private handleTextChange(_source: string, _currentText: string): void {
    // Handle state transitions via state machine
    if (this.stateMachine.getCurrentState() === "highlighting") {
      // Skip if currently highlighting
      console.debug("🔄 Text change during highlighting, ignoring");
      return;
    }

    // Let state machine handle the transition
    this.stateMachine.handleTextChange();
  }

  private async handleIntelligentPasteCheck(
    prePasteSelection: { index: number; length: number },
    prePasteText: string,
    pastedContent: string
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
        postPasteText
      );

      // Perform intelligent checking
      await this.checkAffectedLinesOnly(
        linesToCheck,
        pasteStartIndex,
        lengthDifference,
        postPasteText
      );
    } catch (error) {
      console.error(
        "Intelligent paste check failed, falling back to full check:",
        error
      );
      // Fallback to full check
      this.state.lastCheckedContent = "";
      this.textAnalyzer.checkGrammar();
    }
  }

  private calculateAffectedLines(
    pasteStartIndex: number,
    pastedLength: number,
    prePasteText: string,
    postPasteText: string
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
      const lineLength =
        postLines[i].length + (i < postLines.length - 1 ? 1 : 0);
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
    fullText: string
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
        lines
      );
      const affectedEndIndex = this.getLineStartIndex(
        linesToCheck.endLine + 1,
        lines
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
                this.config.language
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
                this.errorHighlighter.highlightLineErrors(adjustedErrors);
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
      this.errorHighlighter.highlightErrors(this.state.errors);

      const errorCount = this.state.errors.length;
      this.updateStatus("Ready", false);
      this.updateErrorCount(errorCount);

      console.log(
        `Intelligent paste check complete. Checked lines ${
          linesToCheck.startLine + 1
        }-${linesToCheck.endLine + 1}. Total errors: ${errorCount}`
      );
    } catch (error) {
      console.error("Affected lines check failed:", error);
      this.updateStatus("Error checking grammar", false);
      throw error;
    } finally {
      this.state.isChecking = false;
    }
  }



  // State Machine Callback Implementations
  private onStateExit(state: CheckerState): void {
    switch (state) {
      case "checking":
        // Abort any ongoing check
        this.textAnalyzer.clearCheckingContext();
        this.state.isChecking = false;
        break;
    }
  }

  private onStateEntry(state: CheckerState): void {
    switch (state) {
      case "idle":
        this.updateStatus("Ready", false);
        this.textAnalyzer.clearCheckingContext();
        break;
      case "checking":
        this.state.isChecking = true;
        this.updateStatus("Checking...", true);
        break;
      case "highlighting":
        this.updateStatus("Updating highlights...", true);
        break;
    }
  }

  // Line-level caching methods

  private performGrammarCheck(): void {
    // Set up checking context in text analyzer
    this.checkingContext = this.textAnalyzer.startCheckingContext();

    // Perform the actual grammar check
    this.textAnalyzer
      .checkGrammar()
      .then(() => {
        this.stateMachine.onCheckComplete();
      })
      .catch((error) => {
        console.warn("Grammar check failed:", error);
        this.stateMachine.onCheckFailed();
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
    // Delegate to TextAnalyzer
    await this.textAnalyzer.checkGrammar();
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

  private applySuggestion(error: CheckerError, suggestion: string): void {
    try {
      // Get line information before making changes
      const lineInfo = this.getLineFromError(error);
      const originalLength = error.end_index - error.start_index;
      const newLength = suggestion.length;
      const lengthDifference = newLength - originalLength;

      console.log(
        `Applying suggestion on line ${lineInfo.lineNumber}: "${error.error_text}" → "${suggestion}"`
      );
      console.log(
        `Length change: ${originalLength} → ${newLength} (diff: ${lengthDifference})`
      );

      // Apply the suggestion
      const start = error.start_index;

      // Clear formatting first
      this.editor.formatText(
        start,
        originalLength,
        error.error_code === "typo" ? "grammar-typo" : "grammar-other",
        false
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
          lengthDifference
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
    lengthDifference: number
  ): Promise<void> {
    try {
      console.log(
        `Starting intelligent correction for line ${lineInfo.lineNumber}`
      );

      // Remove the corrected error from state
      this.state.errors = this.state.errors.filter(
        (err) => err !== originalError
      );

      // If there's a length difference, adjust indices of subsequent errors
      if (lengthDifference !== 0) {
        this.adjustSubsequentErrorIndices(
          originalError.start_index,
          lengthDifference
        );
      }

      // Only recheck the modified line
      await this.recheckModifiedLine(lineInfo.lineNumber);

      // Update UI
      this.updateErrorCount(this.state.errors.length);
      this.updateStatus("Ready", false);

      console.log(
        `Intelligent correction complete. Total errors: ${this.state.errors.length}`
      );
    } catch (error) {
      console.error(
        "Intelligent correction failed, falling back to full check:",
        error
      );
      // Fallback to full grammar check
      this.state.lastCheckedContent = "";
      this.errorHighlighter.clearErrors();
      this.textAnalyzer.checkGrammar();
    }
  }

  private adjustSubsequentErrorIndices(
    correctionPosition: number,
    lengthDifference: number
  ): void {
    console.log(
      `Adjusting error indices after position ${correctionPosition} by ${lengthDifference}`
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
    this.errorHighlighter.highlightErrors(this.state.errors);
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
        const prevLineWithNewline =
          i < lines.length - 1 ? prevLine + "\n" : prevLine;
        lineStartPosition += prevLineWithNewline.length;
      }

      console.log(`Rechecking line ${lineNumber}: "${line}"`);

      // Only check if the line has content
      if (lineWithNewline.trim()) {
        const response = await this.api.checkText(
          lineWithNewline,
          this.config.language
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
          this.errorHighlighter.highlightLineErrors(adjustedErrors);
        }

        console.log(
          `Line ${lineNumber} recheck complete. Found ${adjustedErrors.length} errors.`
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
    // Update text analyzer with new API and language
    this.textAnalyzer.updateApi(this.api);
    this.textAnalyzer.updateLanguage(language);
    this.errorHighlighter.clearErrors();
    // Re-check with new language if there's content
    const text = this.getText();
    if (text && text.trim()) {
      this.textAnalyzer.checkGrammar();
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
    this.textAnalyzer.checkGrammar();
  }

  getText(): string {
    return this.editor.getText();
  }

  clearEditor(): void {
    this.editor.setText("");
    this.errorHighlighter.clearErrors();
    this.editor.focus();
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
