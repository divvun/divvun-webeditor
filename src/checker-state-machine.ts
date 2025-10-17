/**
 * Manages the state machine for grammar checking lifecycle.
 * Handles transitions between idle, editing, timeout, checking, and highlighting states.
 */

import { CheckerState } from "./types.ts";

export interface StateTransitionCallbacks {
  onStateEntry: (state: CheckerState) => void;
  onStateExit: (state: CheckerState) => void;
  onCheckRequested: () => void;
}

export class CheckerStateMachine {
  private currentState: CheckerState = "idle";
  private checkTimeout: ReturnType<typeof setTimeout> | null = null;
  private autoCheckDelay: number;
  private callbacks: StateTransitionCallbacks;

  constructor(autoCheckDelay: number, callbacks: StateTransitionCallbacks) {
    this.autoCheckDelay = autoCheckDelay;
    this.callbacks = callbacks;
  }

  getCurrentState(): CheckerState {
    return this.currentState;
  }

  /**
   * Handle text change events and transition states accordingly
   */
  handleTextChange(): void {
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
        // Interrupt current check and go back to editing
        this.transitionTo("editing", "editing-during-check");
        break;
      case "highlighting":
        // Can't interrupt highlighting, but note the editing
        break;
    }

    // If now in editing state, start the timeout
    if (this.currentState === "editing") {
      this.transitionTo("timeout", "editing-finished");
    }
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
      case "timeout":
        // Clear timeout if exiting before it expires
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
    switch (state) {
      case "idle":
        // No setup needed for idle
        break;
      case "editing":
        // Clear any pending timeouts when entering editing
        if (this.checkTimeout) {
          clearTimeout(this.checkTimeout);
          this.checkTimeout = null;
        }
        break;
      case "timeout":
        // Start the timeout for checking
        this.checkTimeout = setTimeout(() => {
          this.transitionTo("checking", "timeout-expired");
        }, this.autoCheckDelay);
        break;
      case "checking":
        // Request grammar check to be performed
        this.callbacks.onCheckRequested();
        break;
      case "highlighting":
        // Highlighting state entered - no immediate action needed
        break;
    }

    // Notify callback
    this.callbacks.onStateEntry(state);
  }
}
