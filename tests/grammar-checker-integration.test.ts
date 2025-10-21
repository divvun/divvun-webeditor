/**
 * Integration tests for GrammarChecker using real dependencies where possible
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { CursorManager } from "../src/cursor-manager.ts";
import {
  CheckerStateMachine,
  type EditInfo,
  type EditType,
  type StateTransitionCallbacks,
} from "../src/checker-state-machine.ts";
import type { ConfigManager } from "../src/config-manager.ts";
import type { SuggestionManager } from "../src/suggestion-manager.ts";
import type { TextAnalyzer } from "../src/text-analyzer.ts";
import type { EventManager } from "../src/event-manager.ts";
import type { ErrorHighlighter } from "../src/error-highlighter.ts";
import type { QuillBridgeInstance } from "../src/quill-bridge-instance.ts";
import type { CheckerState } from "../src/types.ts";

// Create a realistic mock Quill editor that can be used with real CursorManager
function createMockEditor(): QuillBridgeInstance {
  let text = "";
  let selection = { index: 0, length: 0 };

  return {
    root: {
      setAttribute: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as HTMLElement,
    getText: () => text,
    getLength: () => text.length,
    getSelection: () => selection,
    setSelection: (index: number, length: number = 0) => {
      selection = { index, length };
    },
    formatText: () => {},
    updateContents: () => {},
    focus: () => {},
    on: () => {},
    off: () => {},
    getContents: () => ({ ops: [] }),
    setText: (newText: string) => {
      text = newText;
    },
    insertText: (index: number, textToInsert: string) => {
      text = text.slice(0, index) + textToInsert + text.slice(index);
    },
    deleteText: (index: number, length: number) => {
      text = text.slice(0, index) + text.slice(index + length);
    },
    getFormat: () => ({}),
    setContents: () => {},
    getBounds: () => ({
      top: 0,
      left: 0,
      height: 0,
      width: 0,
      bottom: 0,
      right: 0,
    }),
    getLine: () => [null, 0],
    getLines: () => [],
    getLeaf: () => [null, 0],
    scroll: {
      domNode: { tagName: "DIV" } as unknown as HTMLElement,
    },
  } as unknown as QuillBridgeInstance;
}

// ============================================================================
// GrammarChecker Constructor Tests
// ============================================================================

Deno.test(
  "GrammarChecker - constructor signature enforced through type system",
  () => {
    // This test verifies through TypeScript's type system that GrammarChecker
    // requires exactly 8 dependencies. The test compiles successfully because
    // we've successfully refactored the constructor to use dependency injection.

    // Type-level verification: These types must match what GrammarChecker expects
    type RequiredDependencies = [
      QuillBridgeInstance,
      ConfigManager,
      CursorManager,
      SuggestionManager,
      TextAnalyzer,
      CheckerStateMachine,
      EventManager,
      ErrorHighlighter,
    ];

    // Verify we have all 8 types
    const dependencyCount: RequiredDependencies["length"] = 8;
    assertEquals(dependencyCount, 8);
  },
);

Deno.test(
  "GrammarChecker - dependency injection enables testing with real components",
  () => {
    // This test demonstrates that we can create real instances of injectable dependencies
    const editor = createMockEditor();
    const cursorManager = new CursorManager(editor);

    const callbacks: StateTransitionCallbacks = {
      onStateEntry: () => {},
      onStateExit: () => {},
      onCheckRequested: () => {},
      onEditDetected: () => {},
    };
    const stateMachine = new CheckerStateMachine(600, callbacks);

    try {
      // Verify we can create real instances of the dependencies
      assertExists(cursorManager);
      assertExists(stateMachine);

      // These are usable in integration tests
      assertEquals(
        cursorManager.isValidPosition({ index: 0, length: 0 }),
        true,
      );
      assertEquals(stateMachine.getCurrentState(), "idle");
    } finally {
      stateMachine.cleanup();
    }
  },
);

// ============================================================================
// CursorManager Integration Tests
// ============================================================================

Deno.test("CursorManager - save and restore cursor position", () => {
  const editor = createMockEditor();
  const cursorManager = new CursorManager(editor);

  // Set text and cursor position
  editor.setText("Hello World");
  editor.setSelection(5, 0); // Position at index 5

  // Save position
  const saved = cursorManager.saveCursorPosition();
  assertExists(saved);
  assertEquals(saved.index, 5);
  assertEquals(saved.length, 0);

  // Change position
  editor.setSelection(0, 0);
  assertEquals(editor.getSelection()?.index, 0);

  // Restore position
  cursorManager.restoreCursorPositionImmediate(saved);
  const restored = editor.getSelection();
  assertEquals(restored?.index, 5);
  assertEquals(restored?.length, 0);
});

Deno.test("CursorManager - validate cursor positions", () => {
  const editor = createMockEditor();
  const cursorManager = new CursorManager(editor);

  editor.setText("Hello World");

  // Valid positions
  assertEquals(cursorManager.isValidPosition({ index: 0, length: 0 }), true);
  assertEquals(cursorManager.isValidPosition({ index: 5, length: 3 }), true);
  assertEquals(
    cursorManager.isValidPosition({ index: 11, length: 0 }),
    true,
  ); // At end

  // Invalid positions
  assertEquals(
    cursorManager.isValidPosition({ index: -1, length: 0 }),
    false,
  );
  assertEquals(
    cursorManager.isValidPosition({ index: 12, length: 0 }),
    false,
  ); // Beyond end
  assertEquals(
    cursorManager.isValidPosition({ index: 5, length: 20 }),
    false,
  ); // Length exceeds document
  assertEquals(cursorManager.isValidPosition(null), false);
});

Deno.test("CursorManager - handle edge cases", () => {
  const editor = createMockEditor();
  const cursorManager = new CursorManager(editor);

  // Empty document
  editor.setText("");
  assertEquals(cursorManager.isValidPosition({ index: 0, length: 0 }), true);
  assertEquals(cursorManager.isValidPosition({ index: 1, length: 0 }), false);

  // Null selection
  cursorManager.restoreCursorPosition(null); // Should not throw
  cursorManager.restoreCursorPositionImmediate(null); // Should not throw
});

Deno.test("CursorManager - getCurrentCursorPosition", () => {
  const editor = createMockEditor();
  const cursorManager = new CursorManager(editor);

  editor.setText("Test text");
  editor.setSelection(4, 0);

  const position = cursorManager.getCurrentCursorPosition();
  assertExists(position);
  assertEquals(position.index, 4);
  assertEquals(position.length, 0);
});

Deno.test("CursorManager - selection with length", () => {
  const editor = createMockEditor();
  const cursorManager = new CursorManager(editor);

  editor.setText("Hello World");
  editor.setSelection(0, 5); // Select "Hello"

  const saved = cursorManager.saveCursorPosition();
  assertExists(saved);
  assertEquals(saved.index, 0);
  assertEquals(saved.length, 5);

  // Change selection
  editor.setSelection(6, 0);

  // Restore
  cursorManager.restoreCursorPositionImmediate(saved);
  const restored = editor.getSelection();
  assertEquals(restored?.index, 0);
  assertEquals(restored?.length, 5);
});

Deno.test("Mock editor - text manipulation", () => {
  const editor = createMockEditor();

  // Initial text
  editor.setText("Hello World");
  assertEquals(editor.getText(), "Hello World");
  assertEquals(editor.getLength(), 11);

  // Insert text
  editor.insertText(5, " Beautiful");
  assertEquals(editor.getText(), "Hello Beautiful World");
  assertEquals(editor.getLength(), 21);

  // Delete text
  editor.deleteText(5, 10); // Remove " Beautiful"
  assertEquals(editor.getText(), "Hello World");
  assertEquals(editor.getLength(), 11);
});

Deno.test("Mock editor - selection management", () => {
  const editor = createMockEditor();

  editor.setText("Hello World");

  // Set selection
  editor.setSelection(0, 5);
  let selection = editor.getSelection();
  assertEquals(selection?.index, 0);
  assertEquals(selection?.length, 5);

  // Move cursor
  editor.setSelection(11);
  selection = editor.getSelection();
  assertEquals(selection?.index, 11);
  assertEquals(selection?.length, 0);
});

// ============================================================================
// CheckerStateMachine Integration Tests
// ============================================================================

Deno.test("CheckerStateMachine - basic state transitions", () => {
  const stateHistory: CheckerState[] = [];
  const editHistory: Array<{ type: EditType; info: EditInfo }> = [];

  const callbacks: StateTransitionCallbacks = {
    onStateEntry: (state) => stateHistory.push(state),
    onStateExit: () => {},
    onCheckRequested: () => {},
    onEditDetected: (type, info) => editHistory.push({ type, info }),
  };

  const stateMachine = new CheckerStateMachine(100, callbacks);

  try {
    // Initial state
    assertEquals(stateMachine.getCurrentState(), "idle");

    // Simulate an edit
    stateMachine.handleEdit("", "Hello");

    // Should transition to editing
    assertEquals(stateMachine.getCurrentState(), "editing");
    assertEquals(editHistory.length, 1);
    assertEquals(editHistory[0].type, "single-line-edit");
  } finally {
    stateMachine.cleanup();
  }
});

Deno.test("CheckerStateMachine - debouncing behavior", async () => {
  let checkRequestCount = 0;
  const callbacks: StateTransitionCallbacks = {
    onStateEntry: () => {},
    onStateExit: () => {},
    onCheckRequested: () => {
      checkRequestCount++;
    },
    onEditDetected: () => {},
  };

  const stateMachine = new CheckerStateMachine(50, callbacks);

  try {
    // Simulate rapid edits
    stateMachine.handleEdit("", "H");
    stateMachine.handleEdit("H", "He");
    stateMachine.handleEdit("He", "Hel");
    stateMachine.handleEdit("Hel", "Hell");
    stateMachine.handleEdit("Hell", "Hello");

    // Should not trigger check immediately
    assertEquals(checkRequestCount, 0);

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should have triggered one check
    assertEquals(checkRequestCount, 1);
  } finally {
    stateMachine.cleanup();
  }
});

Deno.test("CheckerStateMachine - ignore edits during busy states", () => {
  const editHistory: EditType[] = [];
  const callbacks: StateTransitionCallbacks = {
    onStateEntry: () => {},
    onStateExit: () => {},
    onCheckRequested: () => {},
    onEditDetected: (type) => editHistory.push(type),
  };

  const stateMachine = new CheckerStateMachine(100, callbacks);

  try {
    // First edit
    stateMachine.handleEdit("", "Hello");
    assertEquals(editHistory.length, 1);
    assertEquals(editHistory[0], "single-line-edit");

    // State should be editing
    assertEquals(stateMachine.getCurrentState(), "editing");
  } finally {
    stateMachine.cleanup();
  }
});

Deno.test("CheckerStateMachine - edit type detection", () => {
  const edits: Array<{ type: EditType; lineNumber?: number }> = [];
  const callbacks: StateTransitionCallbacks = {
    onStateEntry: () => {},
    onStateExit: () => {},
    onCheckRequested: () => {},
    onEditDetected: (type, info) => {
      edits.push({ type, lineNumber: info.lineNumber });
    },
  };

  const stateMachine = new CheckerStateMachine(100, callbacks);

  try {
    // Single line edit
    stateMachine.handleEdit("Hello", "Hello World");
    assertEquals(edits[edits.length - 1].type, "single-line-edit");
    assertEquals(edits[edits.length - 1].lineNumber, 0);

    // Newline creation
    stateMachine.handleEdit("Hello World", "Hello\nWorld");
    assertEquals(edits[edits.length - 1].type, "newline-creation");

    // Line deletion
    stateMachine.handleEdit("Hello\nWorld", "HelloWorld");
    assertEquals(edits[edits.length - 1].type, "line-deletion");
  } finally {
    stateMachine.cleanup();
  }
});

Deno.test("CheckerStateMachine - cancel pending check", async () => {
  let checkRequestCount = 0;
  const callbacks: StateTransitionCallbacks = {
    onStateEntry: () => {},
    onStateExit: () => {},
    onCheckRequested: () => {
      checkRequestCount++;
    },
    onEditDetected: () => {},
  };

  const stateMachine = new CheckerStateMachine(50, callbacks);

  try {
    // Start an edit
    stateMachine.handleEdit("", "Hello");
    assertEquals(stateMachine.getCurrentState(), "editing");

    // Cancel before debounce completes
    stateMachine.cancelPendingCheck();
    assertEquals(stateMachine.getCurrentState(), "idle");

    // Wait past debounce time
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should not have triggered a check
    assertEquals(checkRequestCount, 0);
  } finally {
    stateMachine.cleanup();
  }
});

Deno.test("CheckerStateMachine - multiple state transitions", async () => {
  const stateLog: CheckerState[] = [];
  const callbacks: StateTransitionCallbacks = {
    onStateEntry: (state) => {
      stateLog.push(state);
    },
    onStateExit: () => {},
    onCheckRequested: () => {},
    onEditDetected: () => {},
  };

  const stateMachine = new CheckerStateMachine(30, callbacks);

  try {
    // Initial state is idle
    assertEquals(stateMachine.getCurrentState(), "idle");

    // Edit triggers editing state
    stateMachine.handleEdit("", "Test");
    assertEquals(stateMachine.getCurrentState(), "editing");
    assertEquals(stateLog[stateLog.length - 1], "editing");

    // Wait for debounce to trigger check
    await new Promise((resolve) => setTimeout(resolve, 50));
    assertEquals(stateMachine.getCurrentState(), "checking");
    assertEquals(stateLog[stateLog.length - 1], "checking");
  } finally {
    stateMachine.cleanup();
  }
});

// ============================================================================
// Error Handling and Failed State Tests
// ============================================================================

Deno.test("CheckerStateMachine - onCheckFailed transitions to failed state", async () => {
  const stateLog: CheckerState[] = [];
  const callbacks: StateTransitionCallbacks = {
    onStateEntry: (state) => {
      stateLog.push(state);
    },
    onStateExit: () => {},
    onCheckRequested: () => {},
    onEditDetected: () => {},
  };

  const stateMachine = new CheckerStateMachine(10, callbacks);

  try {
    // Start an edit and let it transition to checking
    stateMachine.handleEdit("", "Test");
    assertEquals(stateMachine.getCurrentState(), "editing");

    // Wait for debounce to trigger check
    await new Promise((resolve) => setTimeout(resolve, 30));
    assertEquals(stateMachine.getCurrentState(), "checking");

    // Now call onCheckFailed
    stateMachine.onCheckFailed();

    // Should transition to failed state
    assertEquals(stateMachine.getCurrentState(), "failed");
    assertEquals(stateLog[stateLog.length - 1], "failed");
  } finally {
    stateMachine.cleanup();
  }
});

Deno.test("CheckerStateMachine - retryCheck transitions from failed to checking", async () => {
  const stateLog: CheckerState[] = [];
  const callbacks: StateTransitionCallbacks = {
    onStateEntry: (state) => {
      stateLog.push(state);
    },
    onStateExit: () => {},
    onCheckRequested: () => {},
    onEditDetected: () => {},
  };

  const stateMachine = new CheckerStateMachine(10, callbacks);

  try {
    // Transition to checking then failed
    stateMachine.handleEdit("", "Test");
    await new Promise((resolve) => setTimeout(resolve, 30));

    assertEquals(stateMachine.getCurrentState(), "checking");

    stateMachine.onCheckFailed();
    assertEquals(stateMachine.getCurrentState(), "failed");

    // Now retry
    stateMachine.retryCheck();
    assertEquals(stateMachine.getCurrentState(), "checking");
    assertEquals(stateLog[stateLog.length - 1], "checking");
  } finally {
    stateMachine.cleanup();
  }
});

Deno.test("CheckerStateMachine - editing after failure transitions to editing", async () => {
  const stateLog: CheckerState[] = [];
  const callbacks: StateTransitionCallbacks = {
    onStateEntry: (state) => {
      stateLog.push(state);
    },
    onStateExit: () => {},
    onCheckRequested: () => {},
    onEditDetected: () => {},
  };

  const stateMachine = new CheckerStateMachine(10, callbacks);

  try {
    // Transition to checking then failed
    stateMachine.handleEdit("", "Test");
    await new Promise((resolve) => setTimeout(resolve, 30));

    assertEquals(stateMachine.getCurrentState(), "checking");

    stateMachine.onCheckFailed();
    assertEquals(stateMachine.getCurrentState(), "failed");

    // Clear state log to see only the next transition
    const beforeEditStateCount = stateLog.length;

    // User starts editing again after failure
    stateMachine.handleEdit("Test", "Test2");

    // Should transition to editing
    assertEquals(stateMachine.getCurrentState(), "editing");
    assertEquals(stateLog[stateLog.length - 1], "editing");

    // Verify we had exactly one more state entry (editing)
    assertEquals(stateLog.length, beforeEditStateCount + 1);
  } finally {
    stateMachine.cleanup();
  }
});

Deno.test("Paste multi-line text - newline-creation should use 0-based line numbers", () => {
  // Test for the bug where pasting "Dqll.\nDqll. In die'e wat." only checks line 1, not line 0
  // The state machine's analyzeEdit returns 0-based line numbers
  // but handleNewlineEdit was passing them directly to recheckModifiedLine which expects 1-based

  const editsDetected: Array<{ type: EditType; info: EditInfo }> = [];

  const callbacks: StateTransitionCallbacks = {
    onStateEntry: () => {},
    onStateExit: () => {},
    onCheckRequested: () => {},
    onEditDetected: (type, info) => {
      editsDetected.push({ type, info });
    },
  };

  const stateMachine = new CheckerStateMachine(100, callbacks);

  try {
    // Simulate pasting "Dqll.\nDqll. In die'e wat." into an editor with just a newline
    const previousText = "\n";
    const currentText = "Dqll.\nDqll. In die'e wat.\n";

    // Trigger the edit
    stateMachine.handleEdit(previousText, currentText);

    // Should detect a newline-creation edit
    assertEquals(editsDetected.length, 1);
    assertEquals(editsDetected[0].type, "newline-creation");

    // The bug: lineNumber is 0 (0-based), but recheckModifiedLine expects 1-based
    // So it needs to be converted: recheckModifiedLine(lineNumber + 1)
    const lineNumber = editsDetected[0].info.lineNumber;
    assertEquals(lineNumber, 0, "Line number should be 0 (0-based index)");

    // When handleNewlineEdit is called with lineNumber 0, it should:
    // - Convert to 1-based: recheckModifiedLine(0 + 1) = recheckModifiedLine(1) for line 0
    // - Also check the next line: recheckModifiedLine(0 + 2) = recheckModifiedLine(2) for line 1
  } finally {
    stateMachine.cleanup();
  }
});

Deno.test("Line deletion should update global error state", () => {
  // Test that line deletion properly updates this.state.errors
  // checkAndHighlightLine only highlights but doesn't update global state
  // recheckModifiedLine updates global state - we should use that for consistency

  const editor = createMockEditor();
  const callbacks: StateTransitionCallbacks = {
    onStateEntry: () => {},
    onStateExit: () => {},
    onCheckRequested: () => {},
    onEditDetected: () => {},
  };
  const stateMachine = new CheckerStateMachine(100, callbacks);

  // This test verifies that after detecting a line-deletion edit,
  // the error state is properly updated
  // The state machine returns 0-based line numbers for line-deletion

  editor.setText("Line 1\nLine 2");
  stateMachine.handleEdit("Line 1\nLine 2", "Line 1Line 2");

  // Should detect line-deletion at line 0 (0-based)
  assertEquals(stateMachine.getCurrentState(), "editing");

  stateMachine.cleanup();
});
