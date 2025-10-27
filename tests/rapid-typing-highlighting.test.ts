/**
 * Test for highlighting synchronization issues during rapid typing
 *
 * Bug scenario:
 * 1. Paste text with error on line 1
 * 2. Add newlines to move text down
 * 3. Start rapid typing on empty lines above
 * 4. During typing, old error positions are highlighted (moving backwards)
 * 5. After typing stops, highlights correct themselves
 *
 * Root cause: Highlighting uses stale error positions during rapid text changes
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import { CheckerStateMachine } from "../src/checker-state-machine.ts";
import { ConfigManager } from "../src/config-manager.ts";
import { CursorManager } from "../src/cursor-manager.ts";
import { ErrorHighlighter } from "../src/error-highlighter.ts";
import { EventManager } from "../src/event-manager.ts";
import { QuillBridgeInstance } from "../src/quill-bridge-instance.ts";
import { SuggestionManager } from "../src/suggestion-manager.ts";
import { TextAnalyzer } from "../src/text-analyzer.ts";
import { TextChecker } from "../src/text-checker.ts";
import type { CheckerError, SupportedLanguage } from "../src/types.ts";

// Mock DOM elements
function createMockDOM() {
  const statusText = { textContent: "" };
  const statusDisplay = {
    className: "",
    querySelector: () => null,
    appendChild: () => {},
  };
  const errorCount = { textContent: "", className: "" };
  const retryButton = {
    classList: {
      add: () => {},
      remove: () => {},
    },
  };
  const languageSelect = {
    value: "se",
    options: [],
    addEventListener: () => {},
  };
  const clearButton = { addEventListener: () => {} };
  const editorContainer = document.createElement("div");

  return {
    statusText,
    statusDisplay,
    errorCount,
    retryButton,
    languageSelect,
    clearButton,
    editorContainer,
  };
}

// Mock API for testing
class MockCheckerApi {
  private errors: CheckerError[] = [];

  setErrors(errors: CheckerError[]) {
    this.errors = errors;
  }

  async checkText(text: string): Promise<CheckerError[]> {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Return errors based on the text content
    // Look for "mearredii" and return an error if found
    const errorIndex = text.indexOf("mearredii");
    if (errorIndex !== -1) {
      return [{
        error_text: "mearredii",
        start_index: errorIndex,
        end_index: errorIndex + 9,
        error_code: "typo",
        title: "Spelling error",
        description: "Did you mean 'mearridii'?",
        suggestions: ["mearridii"],
      }];
    }

    return [];
  }

  async checkLine(_line: string): Promise<CheckerError[]> {
    return this.errors;
  }
}

Deno.test("Rapid typing should not cause highlight position regression", async () => {
  const domElements = createMockDOM();
  const mockApi = new MockCheckerApi();

  // Create editor instance
  const editor = new QuillBridgeInstance(domElements.editorContainer);

  // Create configuration manager
  const availableLanguages: SupportedLanguage[] = ["se"];
  const configManager = new ConfigManager(
    domElements as unknown as {
      statusText: HTMLElement;
      statusDisplay: HTMLElement;
      errorCount: HTMLElement;
      retryButton: HTMLElement;
      languageSelect: HTMLSelectElement;
      clearButton: HTMLElement;
      editorContainer: HTMLElement;
    },
    availableLanguages,
    () => Promise.resolve(mockApi as any),
  );

  configManager.setLanguage("se");

  // Create other dependencies
  const cursorManager = new CursorManager(editor);
  const suggestionManager = new SuggestionManager(
    editor,
    domElements.editorContainer,
  );
  const eventManager = new EventManager(editor, suggestionManager);

  // Create state machine
  const stateMachine = new CheckerStateMachine(500, {
    onStateEntry: (state) => textChecker.onStateEntry(state),
    onStateExit: (state) => textChecker.onStateExit(state),
    onCheckRequested: () => textChecker.performTextCheck(),
    onEditDetected: (editType, editInfo) =>
      textChecker.handleEditDetected(editType, editInfo),
  });

  // Create error highlighter
  const errorHighlighter = new ErrorHighlighter(editor, cursorManager, {
    onHighlightingStart: () => {
      // With simplified state machine, highlighting is part of "checking"
      // No separate state transition needed
    },
    onHighlightingComplete: () => stateMachine.onHighlightingComplete(),
    onErrorsCleared: () => {},
    onHighlightingAborted: () => stateMachine.onHighlightingAborted(),
  });

  // Create text analyzer
  const textAnalyzer = new TextAnalyzer(
    editor,
    mockApi as any,
    "se",
    errorHighlighter,
    stateMachine,
  );

  // Create text checker
  const textChecker = new TextChecker(
    editor,
    configManager,
    cursorManager,
    suggestionManager,
    textAnalyzer,
    stateMachine,
    eventManager,
    errorHighlighter,
  );

  // Step 1: Insert text with error on first line
  const textWithError = "Mannan vahkkus mearredii ge SáB jahkečoahkkin";
  editor.setText(textWithError);

  // Wait for check to complete
  await new Promise((resolve) => setTimeout(resolve, 600));

  // Verify error is detected
  assertEquals(textChecker.state.errors.length, 1);
  const initialError = textChecker.state.errors[0];
  assertEquals(initialError.error_text, "mearredii");
  const initialErrorStart = initialError.start_index;

  console.log("Initial error position:", initialErrorStart);

  // Step 2: Add two newlines at the beginning
  editor.setText("\n\n" + textWithError);

  // Wait for check to complete
  await new Promise((resolve) => setTimeout(resolve, 600));

  // Error should have moved down by 2 characters (2 newlines)
  assertEquals(textChecker.state.errors.length, 1);
  const movedError = textChecker.state.errors[0];
  assertEquals(movedError.start_index, initialErrorStart + 2);

  console.log("Error position after newlines:", movedError.start_index);

  // Step 3: Simulate rapid typing on the first line
  // This is the critical test - during rapid typing, we should NOT see
  // the error highlight move backwards to old positions

  const rapidTypingStates: number[] = [];

  // Type several characters rapidly
  for (let i = 0; i < 10; i++) {
    const currentText = editor.getText();
    editor.setText("x" + currentText);

    // Capture error position immediately after each keystroke
    if (textChecker.state.errors.length > 0) {
      rapidTypingStates.push(textChecker.state.errors[0].start_index);
    }

    // Small delay to simulate typing speed (but faster than debounce)
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // Wait for final check to complete
  await new Promise((resolve) => setTimeout(resolve, 600));

  // Verify final error position is correct
  assertEquals(textChecker.state.errors.length, 1);
  const finalError = textChecker.state.errors[0];

  // Final position should be: initial + 2 newlines + 10 typed chars
  const expectedFinalPosition = initialErrorStart + 2 + 10;

  console.log("Error positions during typing:", rapidTypingStates);
  console.log("Final error position:", finalError.start_index);
  console.log("Expected final position:", expectedFinalPosition);

  // The bug manifests as: during typing, error positions might be stale
  // Check if any intermediate positions were LESS than they should be
  // (indicating the highlight moved backwards)
  let minPositionSeen = Infinity;
  for (const pos of rapidTypingStates) {
    if (pos < minPositionSeen) {
      minPositionSeen = pos;
    }
  }

  // The minimum position seen during typing should not be less than
  // the position after adding the newlines
  const minExpectedPosition = initialErrorStart + 2;

  if (minPositionSeen < minExpectedPosition) {
    console.error(
      `BUG: Error highlight moved backwards during typing! ` +
        `Min position: ${minPositionSeen}, Expected minimum: ${minExpectedPosition}`,
    );
  }

  // Final position should be correct
  assertEquals(
    finalError.start_index,
    expectedFinalPosition,
    "Final error position should account for all edits",
  );
});
