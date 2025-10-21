// ConfigManager now handles API imports
import type {
  CheckerApi,
  CheckerError,
  CheckerState,
  CheckingContext,
  EditorState,
  SupportedLanguage,
} from "./types.ts";
import { CursorManager } from "./cursor-manager.ts";
import {
  SuggestionManager,
  type SuggestionCallbacks,
} from "./suggestion-manager.ts";
import { TextAnalyzer, type TextAnalysisCallbacks } from "./text-analyzer.ts";
import {
  CheckerStateMachine,
  type StateTransitionCallbacks,
  type EditType,
  type EditInfo,
} from "./checker-state-machine.ts";
import { EventManager, type EventCallbacks } from "./event-manager.ts";
import {
  ErrorHighlighter,
  type HighlightingCallbacks,
} from "./error-highlighter.ts";
import {
  ConfigManager,
  type ConfigurationCallbacks,
} from "./config-manager.ts";
import {
  QuillBridgeInstance,
  registerQuillBlots,
  QuillBridge,
} from "./quill-bridge-instance.ts";
import { atomicTextReplace } from "./editor-utils.ts";

// ConfigManager now handles available languages

export class GrammarChecker {
  public state: EditorState;
  private checkingContext: CheckingContext | null = null;
  public isHighlighting: boolean = false;
  private previousText: string = ""; // Track previous text for edit detection

  // Configuration management
  private configManager: ConfigManager;

  // Editor instance
  private editor: QuillBridgeInstance; // Quill instance

  // Cursor management
  private cursorManager: CursorManager;

  // Suggestion management
  public suggestionManager: SuggestionManager;

  // Text analysis
  public textAnalyzer: TextAnalyzer;

  // State machine
  public stateMachine: CheckerStateMachine;

  // Event management
  public eventManager: EventManager;

  // Error highlighting
  public errorHighlighter: ErrorHighlighter;

  // Line checking coordination
  private pendingLineChecks: Map<number, Promise<void>> = new Map();

  // Debounce timers for line checking (per-line debouncing)
  private lineDebounceTimers: Map<number, number> = new Map();
  private readonly LINE_CHECK_DEBOUNCE_MS = 500; // Wait 500ms after last keystroke

  // ConfigManager now handles API creation

  /**
   * Create a new GrammarChecker instance.
   *
   * @param editor - Quill editor instance to use for the grammar checker.
   * @param configManager - Configuration manager instance.
   * @param cursorManager - Cursor manager instance.
   * @param suggestionManager - Suggestion manager instance.
   * @param textAnalyzer - Text analyzer instance.
   * @param stateMachine - Checker state machine instance.
   * @param eventManager - Event manager instance.
   */
  constructor(
    editor: QuillBridgeInstance,
    configManager: ConfigManager,
    cursorManager: CursorManager,
    suggestionManager: SuggestionManager,
    textAnalyzer: TextAnalyzer,
    stateMachine: CheckerStateMachine,
    eventManager: EventManager,
    errorHighlighter: ErrorHighlighter
  ) {
    this.state = {
      lastCheckedContent: "",
      errors: [],
      isChecking: false,
      errorSpans: [],
    };

    this.configManager = configManager;
    this.editor = editor;
    this.cursorManager = cursorManager;
    this.suggestionManager = suggestionManager;
    this.textAnalyzer = textAnalyzer;
    this.stateMachine = stateMachine;
    this.eventManager = eventManager;
    this.errorHighlighter = errorHighlighter;

    // Initialize previous text tracking for edit detection
    this.previousText = this.editor.getText();

    // Ensure editor root is focusable
    this.editor.root.setAttribute("aria-label", "Grammar editor");
    // Disable native browser spellcheck inside Quill editor
    try {
      this.editor.root.setAttribute("spellcheck", "false");
    } catch (_err) {
      // ignore
    }
  }

  async initializeLanguages(): Promise<void> {
    return await this.configManager.initializeLanguages();
  }

  public handleTextChange(_source: string, currentText: string): void {
    // Skip processing during highlighting or if any line checks are pending
    const shouldProcessEdit =
      this.stateMachine.getCurrentState() !== "highlighting" &&
      this.pendingLineChecks.size === 0;

    if (!shouldProcessEdit) {
      // Skip processing but still update previousText to prevent stale state
      console.debug(
        `🔄 Text change while ${this.stateMachine.getCurrentState()} or ${
          this.pendingLineChecks.size
        } line checks pending, ignoring edit processing but updating baseline`
      );
      this.previousText = currentText;
      return;
    }

    // Use the new edit detection approach
    this.stateMachine.handleEdit(this.previousText, currentText);

    // Update previous text for next comparison
    this.previousText = currentText;
  }

  /**
   * Handle detected edit operations
   */
  public handleEditDetected(editType: EditType, editInfo: EditInfo): void {
    console.log(
      `🚨 MAIN.TS handleEditDetected called with ${editType}`,
      editInfo
    );
    console.debug(`📝 Handling ${editType}:`, editInfo);

    try {
      console.log(`🔍 Switch statement executing for ${editType}`);
      switch (editType) {
        case "single-line-edit":
          console.log(`🎯 Entering single-line-edit case`);
          console.log(
            `🔍 editInfo.lineNumber:`,
            editInfo.lineNumber,
            `(type: ${typeof editInfo.lineNumber})`
          );
          if (editInfo.lineNumber !== undefined) {
            console.log(
              `🎯 Line-specific check for line ${editInfo.lineNumber}`
            );
            console.log(`🚀 About to call handleSingleLineEdit`);
            this.handleSingleLineEdit(editInfo.lineNumber);
            console.log(`✅ handleSingleLineEdit call completed`);
          } else {
            console.warn(
              "Single line edit detected but line number not provided"
            );
            this.textAnalyzer.checkGrammar(); // Fallback to full check
          }
          break;
        case "newline-creation":
          console.debug(
            `Newline created at line ${editInfo.lineNumber}, split at position ${editInfo.splitPosition}`
          );
          // For newlines, we need to check both the split line and the new line
          if (editInfo.lineNumber !== undefined) {
            this.handleNewlineEdit(editInfo.lineNumber).catch((err) => {
              console.error(`❌ Error in newline edit handler:`, err);
            });
          }
          break;
        case "line-deletion":
          console.debug(`Line deleted/merged at line ${editInfo.lineNumber}`);
          // When lines are deleted, invalidate cache and check surrounding context
          if (editInfo.lineNumber !== undefined) {
            this.handleLineDeletion(editInfo.lineNumber).catch((err) => {
              console.error(`❌ Error in line deletion handler:`, err);
            });
          }
          break;
        case "multi-line-edit":
          console.debug(
            `Multi-line edit from line ${editInfo.startLine} to ${editInfo.endLine}`
          );
          // For multi-line edits, we fall back to full checking for now
          // Could be optimized to check only affected line range
          this.textAnalyzer.checkGrammar();
          break;
        case "paste":
        case "cut":
          console.debug(`${editType} operation detected`);
          // Paste/cut operations affect potentially multiple lines, use full check
          this.textAnalyzer.checkGrammar();
          break;
      }
    } catch (error) {
      console.error(`❌ Error in handleEditDetected:`, error);
      // Fallback to full check if something goes wrong
      this.textAnalyzer.checkGrammar();
    }
  }
  /**
   * Handle single line edit with line-specific checking (debounced)
   */
  private handleSingleLineEdit(lineNumber: number): void {
    console.log(`🎯 handleSingleLineEdit ENTERED for line ${lineNumber}`);

    // Clear any existing debounce timer for this line
    const existingTimer = this.lineDebounceTimers.get(lineNumber);
    if (existingTimer !== undefined) {
      console.log(`⏱️ Clearing existing debounce timer for line ${lineNumber}`);
      clearTimeout(existingTimer);
    }

    // Set a new debounce timer
    const timerId = setTimeout(() => {
      console.log(`⏰ Debounce timer fired for line ${lineNumber}`);
      this.lineDebounceTimers.delete(lineNumber);

      // Check if there's already a pending check for this line
      if (this.pendingLineChecks.has(lineNumber)) {
        console.debug(
          `⏸️ Line ${lineNumber} check already in progress, skipping`
        );
        return;
      }

      console.log(`🔄 Starting line check for line ${lineNumber}`);
      // Use recheckModifiedLine which handles everything robustly
      const checkPromise = this.recheckModifiedLine(lineNumber);
      this.pendingLineChecks.set(lineNumber, checkPromise);

      checkPromise
        .then(() => {
          // Update EventManager with current errors for click handling
          this.eventManager.updateErrors(this.state.errors);
          this.updateErrorCount(this.state.errors.length);
        })
        .finally(() => {
          this.pendingLineChecks.delete(lineNumber);
        });
    }, this.LINE_CHECK_DEBOUNCE_MS);

    this.lineDebounceTimers.set(lineNumber, timerId);
    console.log(
      `⏱️ Set debounce timer for line ${lineNumber} (${this.LINE_CHECK_DEBOUNCE_MS}ms)`
    );
  }

  /**
   * Handle newline creation by checking affected lines
   */
  private async handleNewlineEdit(lineNumber: number): Promise<void> {
    try {
      console.debug(`📄 Handling newline at line ${lineNumber}`);

      // Use recheckModifiedLine for both lines affected by the split
      await Promise.all([
        this.recheckModifiedLine(lineNumber),
        this.recheckModifiedLine(lineNumber + 1),
      ]);

      // Update EventManager with current errors for click handling
      this.eventManager.updateErrors(this.state.errors);
      this.updateErrorCount(this.state.errors.length);

      console.debug(
        `✅ Newline handling complete for lines ${lineNumber}-${lineNumber + 1}`
      );

      // Cancel any pending debounce since line-specific check completed successfully
      this.stateMachine.cancelPendingCheck();
    } catch (error) {
      console.error(`❌ Newline handling failed:`, error);
      this.textAnalyzer.checkGrammar();
    }
  }

  /**
   * Handle line deletion by invalidating cache and checking context
   */
  private async handleLineDeletion(lineNumber: number): Promise<void> {
    try {
      console.debug(`🗑️ Handling line deletion at ${lineNumber}`);

      // Use atomic check + highlight for lines around the deletion point
      const currentText = this.editor.getText();
      const lines = currentText.split("\n");

      const checkPromises = [];
      if (lineNumber < lines.length) {
        checkPromises.push(
          this.textAnalyzer.checkAndHighlightLine(
            lineNumber,
            this.errorHighlighter
          )
        );
      }

      if (lineNumber > 0) {
        checkPromises.push(
          this.textAnalyzer.checkAndHighlightLine(
            lineNumber - 1,
            this.errorHighlighter
          )
        );
      }

      await Promise.all(checkPromises);

      console.debug(`✅ Line deletion handling complete`);

      // Cancel any pending debounce since line-specific check completed successfully
      this.stateMachine.cancelPendingCheck();
    } catch (error) {
      console.error(`❌ Line deletion handling failed:`, error);
      this.textAnalyzer.checkGrammar();
    }
  }

  public async handleIntelligentPasteCheck(
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
              const response = await this.configManager
                .getCurrentApi()
                .checkText(
                  lineWithNewline,
                  this.configManager.getCurrentLanguage()
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
  public onStateExit(state: CheckerState): void {
    switch (state) {
      case "checking":
        // Abort any ongoing check
        this.textAnalyzer.clearCheckingContext();
        this.state.isChecking = false;
        break;
    }
  }

  public onStateEntry(state: CheckerState): void {
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

  public performGrammarCheck(): void {
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

  public updateStatus(status: string, isChecking: boolean): void {
    const domElements = this.configManager.getDOMElements();
    domElements.statusText.textContent = status;
    domElements.statusDisplay.className = isChecking
      ? "status checking"
      : "status complete";

    // Add/remove spinner
    const existingSpinner = domElements.statusDisplay.querySelector(".spinner");
    if (isChecking && !existingSpinner) {
      const spinner = document.createElement("div");
      spinner.className = "spinner";
      domElements.statusDisplay.appendChild(spinner);
    } else if (!isChecking && existingSpinner) {
      existingSpinner.remove();
    }
  }

  public updateErrorCount(count: number): void {
    const domElements = this.configManager.getDOMElements();
    domElements.errorCount.textContent = `${count} ${
      count === 1 ? "error" : "errors"
    }`;
    domElements.errorCount.className =
      count > 0 ? "error-count has-errors" : "error-count";
  }

  public showErrorMessage(message: string): void {
    // Simple alert for now - in a full implementation, you'd want a nicer notification system
    alert(`Error: ${message}`);
  }

  public applySuggestion(error: CheckerError, suggestion: string): void {
    try {
      // Mark that we're applying a suggestion to prevent undo detection interference
      this.eventManager.setSuggestionApplicationState(true);

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

      // Apply the suggestion atomically to prevent spacing issues
      const start = error.start_index;

      // Get current text to verify boundaries
      const currentText = this.editor.getText();
      const errorText = currentText.substring(start, start + originalLength);

      console.log(`Expected error text: "${error.error_text}"`);
      console.log(`Actual text at position: "${errorText}"`);

      // Clear formatting first
      this.editor.formatText(
        start,
        originalLength,
        error.error_code === "typo" ? "grammar-typo" : "grammar-other",
        false
      );

      // Use atomic text replacement to prevent intermediate state issues
      atomicTextReplace(this.editor, start, originalLength, suggestion);

      // Set cursor position after the replaced text
      const newCursorPosition = start + newLength;
      try {
        this.editor.setSelection(newCursorPosition, 0);
      } catch (_selErr) {
        // If selection fails, at least focus the editor
        this.editor.focus();
      }

      // Clear the suggestion application flag before async operations
      this.eventManager.setSuggestionApplicationState(false);

      // Intelligent re-checking: only check the modified line and adjust indices
      // Use a more reliable async approach
      this.performIntelligentCorrection(
        error,
        suggestion,
        lineInfo,
        lengthDifference
      );
    } catch (err) {
      console.error("Error applying suggestion:", err);
      // Ensure we clear the flag even on error
      this.eventManager.setSuggestionApplicationState(false);
      // Fallback to full recheck
      this.state.lastCheckedContent = "";
      this.errorHighlighter.clearErrors();
      this.textAnalyzer.checkGrammar();
    }
  }

  private async performIntelligentCorrection(
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

      // Only recheck the modified line - use immediate async to avoid setTimeout timing issues
      await this.recheckModifiedLine(lineInfo.lineNumber);

      // Update EventManager with the new error positions so click handlers work correctly
      this.eventManager.updateErrors(this.state.errors);

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

  public async recheckModifiedLine(lineNumber: number): Promise<void> {
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
        const response = await this.configManager
          .getCurrentApi()
          .checkText(lineWithNewline, this.configManager.getCurrentLanguage());

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

        // Always re-highlight the entire error set to ensure removed errors are cleared
        // This is important when a line goes from having errors to having none
        this.errorHighlighter.highlightErrors(this.state.errors);

        console.log(
          `Line ${lineNumber} recheck complete. Found ${adjustedErrors.length} errors.`
        );
      }
    } catch (error) {
      console.error(`Error rechecking line ${lineNumber}:`, error);
    }
  }

  setLanguage(language: SupportedLanguage): void {
    this.configManager.setLanguage(language);
  }

  handleLanguageChange(language: SupportedLanguage, api: CheckerApi): void {
    console.debug("🔄 Handling language change to", language);

    // Update text analyzer with new API and language
    this.textAnalyzer.updateApi(api);
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
    // Register custom Quill blots for error highlighting
    registerQuillBlots();

    // Create the Quill editor
    const editorContainer = document.getElementById("editor") as HTMLElement;
    const editor = QuillBridge.create(editorContainer, {
      theme: "snow",
      modules: {
        toolbar: [
          [{ header: [1, 2, false] }],
          ["bold", "italic", "underline"],
          ["link", "clean"],
        ],
      },
    });

    // Create the configuration manager with callbacks
    // Note: Callbacks reference grammarChecker methods, which we'll set up after instantiation
    let grammarCheckerInstance: GrammarChecker | null = null;

    const configCallbacks: ConfigurationCallbacks = {
      onLanguageChanged: (language: SupportedLanguage, api: CheckerApi) => {
        grammarCheckerInstance?.handleLanguageChange(language, api);
      },
      onConfigurationInitialized: () => {
        console.log("🔧 Configuration initialized successfully");
      },
      onLanguageInitializationError: (error: unknown) => {
        console.warn("⚠️ Language initialization failed:", error);
      },
    };

    const configManager = new ConfigManager(configCallbacks);

    // Create the cursor manager
    const cursorManager = new CursorManager(editor);

    // Create the suggestion manager with callbacks
    // Note: These callbacks will be bound to grammarChecker methods after it's created
    let grammarCheckerRef: GrammarChecker | null = null;
    const suggestionCallbacks: SuggestionCallbacks = {
      onSuggestionApplied: (error: CheckerError, suggestion: string) => {
        grammarCheckerRef?.applySuggestion(error, suggestion);
      },
      onClearErrors: () => {
        if (grammarCheckerRef) {
          grammarCheckerRef.state.lastCheckedContent = "";
          grammarCheckerRef.errorHighlighter.clearErrors();
        }
      },
      onCheckGrammar: () => {
        grammarCheckerRef?.textAnalyzer.checkGrammar();
      },
      onRecheckLine: (lineNumber: number) => {
        grammarCheckerRef?.recheckModifiedLine(lineNumber);
      },
    };
    const suggestionManager = new SuggestionManager(
      editor,
      suggestionCallbacks
    );

    // Create the text analyzer with callbacks
    const textAnalysisCallbacks: TextAnalysisCallbacks = {
      onErrorsFound: (errors: CheckerError[], lineNumber?: number) => {
        if (lineNumber !== undefined) {
          grammarCheckerRef?.errorHighlighter.highlightLineErrors(errors);
        } else {
          if (grammarCheckerRef) {
            grammarCheckerRef.state.errors = errors;
            grammarCheckerRef.eventManager.updateErrors(errors);
          }
        }
      },
      onUpdateErrorCount: (count: number) => {
        grammarCheckerRef?.updateErrorCount(count);
      },
      onUpdateStatus: (status: string, isChecking: boolean) => {
        grammarCheckerRef?.updateStatus(status, isChecking);
      },
      onShowErrorMessage: (message: string) => {
        grammarCheckerRef?.showErrorMessage(message);
      },
    };
    const textAnalyzer = new TextAnalyzer(
      configManager.getCurrentApi(),
      editor,
      textAnalysisCallbacks,
      configManager.getCurrentLanguage()
    );

    // Create the state machine with callbacks
    const stateTransitionCallbacks: StateTransitionCallbacks = {
      onStateEntry: (state: CheckerState) => {
        grammarCheckerRef?.onStateEntry(state);
      },
      onStateExit: (state: CheckerState) => {
        grammarCheckerRef?.onStateExit(state);
      },
      onCheckRequested: () => {
        grammarCheckerRef?.performGrammarCheck();
      },
      onEditDetected: (editType: EditType, editInfo: EditInfo) => {
        console.log(
          `🚨 CALLBACK onEditDetected called with ${editType}`,
          editInfo
        );
        grammarCheckerRef?.handleEditDetected(editType, editInfo);
      },
    };
    const stateMachine = new CheckerStateMachine(
      configManager.getAutoCheckDelay(),
      stateTransitionCallbacks
    );

    // Create the event manager with callbacks
    const eventCallbacks: EventCallbacks = {
      onTextChange: (source: string, currentText: string) => {
        grammarCheckerRef?.handleTextChange(source, currentText);
      },
      onLanguageChange: (language: SupportedLanguage) => {
        grammarCheckerRef?.setLanguage(language);
      },
      onClearEditor: () => {
        grammarCheckerRef?.clearEditor();
      },
      onErrorClick: (
        errorNode: HTMLElement,
        matching: CheckerError,
        index: number,
        length: number,
        event: MouseEvent
      ) => {
        grammarCheckerRef?.suggestionManager.showSuggestionTooltip(
          errorNode,
          matching,
          index,
          length,
          event
        );
      },
      onErrorRightClick: (
        x: number,
        y: number,
        matchingError: CheckerError
      ) => {
        grammarCheckerRef?.suggestionManager.showContextMenu(
          x,
          y,
          matchingError
        );
      },
      onIntelligentPasteCheck: (
        prePasteSelection: { index: number; length: number },
        prePasteText: string,
        pastedContent: string
      ) => {
        grammarCheckerRef?.handleIntelligentPasteCheck(
          prePasteSelection,
          prePasteText,
          pastedContent
        );
      },
    };
    const domElements = configManager.getDOMElements();
    const eventManager = new EventManager(
      editor,
      domElements.clearButton,
      eventCallbacks
    );

    // Create the error highlighter with callbacks
    const highlightingCallbacks: HighlightingCallbacks = {
      onHighlightingStart: () => {
        if (grammarCheckerRef) {
          grammarCheckerRef.isHighlighting = true;
          grammarCheckerRef.eventManager.setHighlightingState(true);
        }
      },
      onHighlightingComplete: () => {
        if (grammarCheckerRef) {
          grammarCheckerRef.isHighlighting = false;
          grammarCheckerRef.eventManager.setHighlightingState(false);
          grammarCheckerRef.stateMachine.onHighlightingComplete();
        }
      },
      onErrorsCleared: () => {
        if (grammarCheckerRef) {
          grammarCheckerRef.state.errors = [];
          grammarCheckerRef.eventManager.updateErrors([]);
          grammarCheckerRef.state.errorSpans = [];
          grammarCheckerRef.updateErrorCount(0);
        }
      },
    };
    const errorHighlighter = new ErrorHighlighter(
      editor,
      cursorManager,
      highlightingCallbacks
    );

    // Create the grammar checker with all dependencies
    const grammarChecker = new GrammarChecker(
      editor,
      configManager,
      cursorManager,
      suggestionManager,
      textAnalyzer,
      stateMachine,
      eventManager,
      errorHighlighter
    );
    grammarCheckerInstance = grammarChecker;
    grammarCheckerRef = grammarChecker;

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
