/**
 * Tests for CheckerStateMachine edit detection and debouncing
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { 
  CheckerStateMachine, 
  type StateTransitionCallbacks,
  type EditInfo 
} from "../src/checker-state-machine.ts";

// Helper function to create mock callbacks
function createMockCallbacks() {
  const calls: { method: string; args: unknown[] }[] = [];
  
  const callbacks: StateTransitionCallbacks = {
    onStateEntry: (state) => calls.push({ method: "onStateEntry", args: [state] }),
    onStateExit: (state) => calls.push({ method: "onStateExit", args: [state] }),
    onEditDetected: (editType, editInfo) => calls.push({ method: "onEditDetected", args: [editType, editInfo] }),
    onCheckRequested: () => calls.push({ method: "onCheckRequested", args: [] }),
  };
  
  return { callbacks, calls };
}

// Helper to delay in tests
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

Deno.test("CheckerStateMachine - Single Line Edit Detection", () => {
  const { callbacks, calls } = createMockCallbacks();
  const stateMachine = new CheckerStateMachine(500, callbacks);
  
  // Simulate typing "Hello"
  const previousText = "";
  const currentText = "Hello";
  
  stateMachine.handleEdit(previousText, currentText);
  
  // Should detect single-line-edit
  const editDetectedCall = calls.find(call => call.method === "onEditDetected");
  assertEquals(editDetectedCall?.args[0], "single-line-edit");
  
  const editInfo = editDetectedCall?.args[1] as EditInfo;
  assertEquals(editInfo.lineNumber, 0);
  assertEquals(editInfo.lengthChange, 5);
  
  // Cleanup
  stateMachine.cleanup();
});

Deno.test("CheckerStateMachine - Newline Creation Detection", () => {
  const { callbacks, calls } = createMockCallbacks();
  const stateMachine = new CheckerStateMachine(500, callbacks);
  
  // Simulate pressing Enter in middle of text
  const previousText = "Hello World";
  const currentText = "Hello\nWorld";
  
  stateMachine.handleEdit(previousText, currentText, 5); // cursor at position 5
  
  // Should detect newline-creation
  const editDetectedCall = calls.find(call => call.method === "onEditDetected");
  assertEquals(editDetectedCall?.args[0], "newline-creation");
  
  const editInfo = editDetectedCall?.args[1] as EditInfo;
  assertEquals(editInfo.lineNumber, 0); // Line where split occurred
  assertEquals(editInfo.splitPosition, 5);
  
  // Cleanup
  stateMachine.cleanup();
});

Deno.test("CheckerStateMachine - Line Deletion Detection", () => {
  const { callbacks, calls } = createMockCallbacks();
  const stateMachine = new CheckerStateMachine(500, callbacks);
  
  // Simulate deleting newline (joining lines)
  const previousText = "Hello\nWorld";
  const currentText = "HelloWorld";
  
  stateMachine.handleEdit(previousText, currentText);
  
  // Should detect line-deletion
  const editDetectedCall = calls.find(call => call.method === "onEditDetected");
  assertEquals(editDetectedCall?.args[0], "line-deletion");
  
  const editInfo = editDetectedCall?.args[1] as EditInfo;
  assertEquals(editInfo.lengthChange, -1); // One less character (the newline)
  
  // Cleanup
  stateMachine.cleanup();
});

Deno.test("CheckerStateMachine - Multi-line Edit Detection", () => {
  const { callbacks, calls } = createMockCallbacks();
  const stateMachine = new CheckerStateMachine(500, callbacks);
  
  // Simulate editing multiple lines
  const previousText = "Line 1\nLine 2\nLine 3";
  const currentText = "Line 1 Modified\nLine 2 Changed\nLine 3";
  
  stateMachine.handleEdit(previousText, currentText);
  
  // Should detect multi-line-edit
  const editDetectedCall = calls.find(call => call.method === "onEditDetected");
  assertEquals(editDetectedCall?.args[0], "multi-line-edit");
  
  const editInfo = editDetectedCall?.args[1] as EditInfo;
  assertEquals(editInfo.startLine, 0);
  assertEquals(editInfo.endLine, 1);
  
  // Cleanup
  stateMachine.cleanup();
});

Deno.test("CheckerStateMachine - Debouncing Behavior", async () => {
  const { callbacks, calls } = createMockCallbacks();
  const stateMachine = new CheckerStateMachine(100, callbacks); // Short delay for testing
  
  // Simulate rapid typing
  stateMachine.handleEdit("", "H");
  stateMachine.handleEdit("H", "He");
  stateMachine.handleEdit("He", "Hel");
  stateMachine.handleEdit("Hel", "Hell");
  stateMachine.handleEdit("Hell", "Hello");
  
  // Should have multiple edit detections but no checking yet
  const editCalls = calls.filter(call => call.method === "onEditDetected");
  assertEquals(editCalls.length, 5);
  
  const checkCalls = calls.filter(call => call.method === "onCheckRequested");
  assertEquals(checkCalls.length, 0); // No checking yet due to debouncing
  
  // Wait for debounce to complete
  await delay(150);
  
  // Now should have triggered a check
  const finalCheckCalls = calls.filter(call => call.method === "onCheckRequested");
  assertEquals(finalCheckCalls.length, 1);
  
  // Cleanup
  stateMachine.cleanup();
});

Deno.test("CheckerStateMachine - Ignore Edits During Busy States", async () => {
  const { callbacks, calls } = createMockCallbacks();
  const stateMachine = new CheckerStateMachine(50, callbacks); // Short delay for testing
  
  // Start an edit that will transition to checking after debounce
  stateMachine.handleEdit("", "Hello");
  
  // Wait for debounce to trigger transition to checking
  await delay(60);
  
  // Now state should be "checking" - clear calls
  calls.length = 0;
  
  // Try to edit while in checking state
  stateMachine.handleEdit("Hello", "Hello World");
  
  // Should not detect any edits while busy
  const editCalls = calls.filter(call => call.method === "onEditDetected");
  assertEquals(editCalls.length, 0);
  
  // Cleanup
  stateMachine.cleanup();
});

Deno.test("CheckerStateMachine - Complex Text Changes", () => {
  const { callbacks, calls } = createMockCallbacks();
  const stateMachine = new CheckerStateMachine(500, callbacks);
  
  // Simulate a complex change (insertion at beginning)
  const previousText = "\n";
  const currentText = "D\n";
  
  stateMachine.handleEdit(previousText, currentText);
  
  // Should detect single-line-edit (insertion on line 0)
  const editDetectedCall = calls.find(call => call.method === "onEditDetected");
  assertEquals(editDetectedCall?.args[0], "single-line-edit");
  
  const editInfo = editDetectedCall?.args[1] as EditInfo;
  assertEquals(editInfo.lineNumber, 0);
  assertEquals(editInfo.lengthChange, 1);
  
  // Cleanup
  stateMachine.cleanup();
});

Deno.test("CheckerStateMachine - Multi-line Text Error Isolation", () => {
  const { callbacks, calls } = createMockCallbacks();
  const stateMachine = new CheckerStateMachine(500, callbacks); // Longer delay to avoid interference
  
  // Simulate the scenario where "errors in the first line flash when I do edits in the second line"
  // This tests that editing line 2 should be detected as isolated to that line
  
  // Start with existing multi-line text
  const initialText = "Dqll. Mun leat stuoris.\nHearrgiis leat máŋga meattáhusa.";
  
  // Edit only line 2 (append text)
  const editedText = "Dqll. Mun leat stuoris.\nHearrgiis leat máŋga meattáhusa. New text.";
  
  stateMachine.handleEdit(initialText, editedText);
  
  // Should detect single-line-edit on line 1 (0-indexed = 1)
  const editDetectedCall = calls.find(call => call.method === "onEditDetected");
  assertEquals(editDetectedCall?.args[0], "single-line-edit");
  
  const editInfo = editDetectedCall?.args[1] as EditInfo;
  assertEquals(editInfo.lineNumber, 1); // Line 2 (0-indexed = 1)
  assertEquals(editInfo.lengthChange, 10); // " New text." added
  
  // The key insight: editing line 2 is correctly isolated to line 1 (0-indexed)
  // This means error highlighting can be line-specific and won't interfere with other lines
  
  // Cleanup
  stateMachine.cleanup();
});

Deno.test("CheckerStateMachine - Rapid Multi-line Edits Don't Reset Each Other", async () => {
  const { callbacks, calls } = createMockCallbacks();
  const stateMachine = new CheckerStateMachine(100, callbacks); // Short delay for testing
  
  // Test that rapid edits on different lines don't interfere with each other's error states
  
  // Rapid edits on line 1
  stateMachine.handleEdit("", "D");
  stateMachine.handleEdit("D", "Dq");  
  stateMachine.handleEdit("Dq", "Dql");
  
  // Then switch to editing line 2 while line 1 is still in editing state
  stateMachine.handleEdit("Dql\n", "Dql\nH");
  stateMachine.handleEdit("Dql\nH", "Dql\nHe");
  
  // Should detect line-specific edits
  const editCalls = calls.filter(call => call.method === "onEditDetected");
  assertEquals(editCalls.length, 5); // All 5 edits detected
  
  // Should only transition to editing state once (not reset between line edits)
  const stateEntryCalls = calls.filter(call => 
    call.method === "onStateEntry" && call.args[0] === "editing"
  );
  assertEquals(stateEntryCalls.length, 1); // Only one transition to editing
  
  // Wait for debounce
  await delay(120);
  
  // Should eventually trigger one check after all rapid edits
  const checkCalls = calls.filter(call => call.method === "onCheckRequested");
  assertEquals(checkCalls.length, 1);
  
  // Cleanup
  stateMachine.cleanup();
});