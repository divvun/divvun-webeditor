/**
 * Manages the state machine for grammar checking lifecycle.
 * Handles transitions between idle, editing, timeout, checking, and highlighting states.
 */

import { CheckerState } from "./types.ts";

export interface StateTransitionCallbacks {
  onStateEntry: (state: CheckerState) => void;
  onStateExit: (state: CheckerState) => void;
  onCheckRequested: () => void;
  onEditDetected: (editType: EditType, editInfo: EditInfo) => void;
}

export type EditType =
  | "single-line-edit" // Typing/deleting within one line
  | "newline-creation" // Pressing Enter, splitting a line
  | "line-deletion" // Backspace at line start, joining lines
  | "multi-line-edit" // Selection spanning multiple lines
  | "paste" // Paste operation
  | "cut"; // Cut operation

export interface EditInfo {
  lineNumber?: number; // Primary affected line
  startLine?: number; // For multi-line operations
  endLine?: number; // For multi-line operations
  lengthChange: number; // Character difference (+/-)
  splitPosition?: number; // For newline creation
  previousText?: string; // For analysis
  currentText?: string; // For analysis
}

export class CheckerStateMachine {
  private currentState: CheckerState = "idle";
  private checkTimeout: ReturnType<typeof setTimeout> | null = null;
  private autoCheckDelay: number;
  private callbacks: StateTransitionCallbacks;
  private pendingEditInfo: ({ type: EditType } & EditInfo) | null = null;

  constructor(autoCheckDelay: number, callbacks: StateTransitionCallbacks) {
    this.autoCheckDelay = autoCheckDelay;
    this.callbacks = callbacks;
  }

  getCurrentState(): CheckerState {
    return this.currentState;
  }

  /**
   * Handle edit operations with intelligent type detection
   */
  handleEdit(
    previousText: string,
    currentText: string,
    cursorPosition?: number,
  ): void {
    // Ignore edits if we're in a busy state
    if (
      this.currentState === "checking" ||
      this.currentState === "highlighting"
    ) {
      console.log(`🚫 Edit ignored - state is ${this.currentState}`);
      return;
    }

    // Analyze the edit
    const editInfo = this.analyzeEdit(
      previousText,
      currentText,
      cursorPosition,
    );

    console.log(`📝 Edit detected: ${editInfo.type}`, editInfo);

    // Store pending edit info for debounced processing
    this.pendingEditInfo = editInfo;

    // Immediately notify callback about the edit
    this.callbacks.onEditDetected(editInfo.type, editInfo);

    // Only start debouncing if we're not already in editing state
    if (this.currentState !== "editing") {
      // Transition to editing state
      this.transitionTo("editing", "edit-detected");
      // Start debounced checking
      this.startEditDebounce();
    }
    // If already editing, the existing debounce timer continues running
  }

  /**
   * Process the pending edit after debounce period
   */
  private processPendingEdit(): void {
    if (this.pendingEditInfo) {
      console.debug(
        `📝 Processing debounced edit: ${this.pendingEditInfo.type}`,
        this.pendingEditInfo,
      );

      // Notify the callback with edit information
      this.callbacks.onEditDetected(
        this.pendingEditInfo.type,
        this.pendingEditInfo,
      );

      // Clear pending edit
      this.pendingEditInfo = null;
    }
  }

  /**
   * Analyze the type of edit that occurred
   */
  private analyzeEdit(
    previousText: string,
    currentText: string,
    cursorPosition?: number,
  ): { type: EditType } & EditInfo {
    const prevLines = previousText.split("\n");
    const currLines = currentText.split("\n");
    const lengthChange = currentText.length - previousText.length;

    // Detect newline creation (line count increased)
    if (currLines.length > prevLines.length) {
      const lineNumber = this.findChangedLine(prevLines, currLines);
      return {
        type: "newline-creation",
        lineNumber,
        lengthChange,
        splitPosition: cursorPosition,
        previousText,
        currentText,
      };
    }

    // Detect line deletion (line count decreased)
    if (currLines.length < prevLines.length) {
      const lineNumber = this.findChangedLine(prevLines, currLines);
      return {
        type: "line-deletion",
        lineNumber,
        lengthChange,
        previousText,
        currentText,
      };
    }

    // Same line count - single line edit or multi-line edit
    const changedLines = this.findAllChangedLines(prevLines, currLines);

    if (changedLines.length === 1) {
      return {
        type: "single-line-edit",
        lineNumber: changedLines[0],
        lengthChange,
        previousText,
        currentText,
      };
    } else {
      return {
        type: "multi-line-edit",
        startLine: Math.min(...changedLines),
        endLine: Math.max(...changedLines),
        lengthChange,
        previousText,
        currentText,
      };
    }
  }

  /**
   * Find which line changed when line count differs
   */
  private findChangedLine(prevLines: string[], currLines: string[]): number {
    const minLength = Math.min(prevLines.length, currLines.length);

    for (let i = 0; i < minLength; i++) {
      if (prevLines[i] !== currLines[i]) {
        return i;
      }
    }

    // Change was at the end
    return minLength;
  }

  /**
   * Find all lines that changed when line count is the same
   */
  private findAllChangedLines(
    prevLines: string[],
    currLines: string[],
  ): number[] {
    const changedLines: number[] = [];

    for (let i = 0; i < Math.max(prevLines.length, currLines.length); i++) {
      const prevLine = prevLines[i] || "";
      const currLine = currLines[i] || "";

      if (prevLine !== currLine) {
        changedLines.push(i);
      }
    }

    return changedLines;
  }

  /**
   * Start debounced checking after edit
   */
  private startEditDebounce(): void {
    // Clear any existing timeout
    if (this.checkTimeout) {
      clearTimeout(this.checkTimeout);
      this.checkTimeout = null;
    }

    // Start new timeout for checking (callback already called immediately)
    this.checkTimeout = setTimeout(() => {
      this.transitionTo("checking", "edit-debounce-complete");
    }, this.autoCheckDelay);
  }

  /**
   * Signal that checking has completed successfully
   */
  onCheckComplete(): void {
    if (this.currentState === "checking") {
      this.transitionTo("highlighting", "check-complete");
    }
  }

  /**
   * Signal that checking has failed
   */
  onCheckFailed(): void {
    if (this.currentState === "checking") {
      this.transitionTo("idle", "check-failed");
    }
  }

  /**
   * Signal that highlighting has completed
   */
  onHighlightingComplete(): void {
    if (this.currentState === "highlighting") {
      this.transitionTo("idle", "highlighting-complete");
    }
  }

  /**
   * Cancel pending debounce when line-specific check completes successfully
   * This prevents unnecessary full document checks when line-level checking is sufficient
   */
  cancelPendingCheck(): void {
    if (this.checkTimeout) {
      clearTimeout(this.checkTimeout);
      this.checkTimeout = null;

      // If we're still in editing state and had a pending check,
      // we can transition to idle since line-specific check completed
      if (this.currentState === "editing") {
        this.transitionTo("idle", "line-specific-check-complete");
      }
    }
  }

  /**
   * Force transition to idle state (for cleanup)
   */
  forceIdle(): void {
    this.transitionTo("idle", "force-idle");
  }

  /**
   * Clean up any pending timeouts
   */
  cleanup(): void {
    if (this.checkTimeout) {
      clearTimeout(this.checkTimeout);
      this.checkTimeout = null;
    }
  }

  private transitionTo(newState: CheckerState, _trigger: string): void {
    if (this.currentState === newState) {
      return;
    }

    // Exit current state
    this.onStateExit(this.currentState);

    // Change state
    this.currentState = newState;

    // Enter new state
    this.onStateEntry(newState);
  }

  private onStateExit(state: CheckerState): void {
    switch (state) {
      case "idle":
        // No cleanup needed
        break;
      case "editing":
        // Clear any pending timeouts when leaving editing
        if (this.checkTimeout) {
          clearTimeout(this.checkTimeout);
          this.checkTimeout = null;
        }
        break;
      case "checking":
        // Clear any pending timeouts
        if (this.checkTimeout) {
          clearTimeout(this.checkTimeout);
          this.checkTimeout = null;
        }
        break;
      case "highlighting":
        // No cleanup needed for highlighting
        break;
    }

    // Notify callback
    this.callbacks.onStateExit(state);
  }

  private onStateEntry(state: CheckerState): void {
    console.log(`🔄 State transition: → ${state}`);
    switch (state) {
      case "idle":
        // No setup needed for idle
        break;
      case "editing":
        // Editing state entered - debouncing will be handled by startEditDebounce
        break;
      case "checking":
        // Request grammar check to be performed
        console.log(`🔍 Requesting grammar check...`);
        this.callbacks.onCheckRequested();
        break;
      case "highlighting":
        // Highlighting state entered - no immediate action needed
        console.log(`🎨 Starting highlighting...`);
        break;
    }

    // Notify callback
    this.callbacks.onStateEntry(state);
  }
}
