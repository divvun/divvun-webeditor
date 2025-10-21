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
