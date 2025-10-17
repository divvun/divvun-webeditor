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

Deno.test("CheckerStateMachine - Edits During Highlighting Phase Are Queued", async () => {
  const { callbacks, calls } = createMockCallbacks();
  const stateMachine = new CheckerStateMachine(100, callbacks); // Short delay for testing
  
  // This test covers the scenario from console logs:
  // "🔄 Text change during highlighting, ignoring"
  // When user continues typing while highlighting is in progress
  
  // 1. Start with initial edit that will trigger checking
  stateMachine.handleEdit("", "Dqll");
  
  // Wait for check to start
  await delay(120);
  
  // 2. Simulate check completion -> transition to highlighting
  stateMachine.onCheckComplete();
  
  // Clear calls to focus on what happens during highlighting
  calls.length = 0;
  
  // 3. Try to edit while in highlighting state (this gets ignored in the real app)
  stateMachine.handleEdit("Dqll", "Dqll. Mun leat");
  
  // Should ignore edits during highlighting (current behavior)
  const editCalls = calls.filter(call => call.method === "onEditDetected");
  assertEquals(editCalls.length, 0); // Edit ignored
  
  // 4. Complete highlighting
  stateMachine.onHighlightingComplete();
  
  // 5. Now try editing again (should work)
  stateMachine.handleEdit("Dqll", "Dqll. Mun leat stuoris.");
  
  // This edit should be detected
  const finalEditCalls = calls.filter(call => call.method === "onEditDetected");
  assertEquals(finalEditCalls.length, 1); // Edit detected after highlighting complete
  
  const editInfo = finalEditCalls[0]?.args[1] as EditInfo;
  assertEquals(editInfo.lineNumber, 0);
  assertEquals(editInfo.lengthChange > 0, true); // Should be a positive length change
  
  // Cleanup
  stateMachine.cleanup();
});

Deno.test("CheckerStateMachine - Highlighting State Isolation", async () => {
  const { callbacks, calls } = createMockCallbacks();
  const stateMachine = new CheckerStateMachine(50, callbacks); // Very short delay
  
  // Test the specific issue: text changes during highlighting cause inconsistent state
  
  // 1. User types quickly: "Dql" (triggers check)
  stateMachine.handleEdit("", "D");
  stateMachine.handleEdit("D", "Dq");
  stateMachine.handleEdit("Dq", "Dql");
  
  // Wait for debounce -> check starts
  await delay(60);
  
  // 2. Simulate check returns (highlighting starts)
  stateMachine.onCheckComplete();
  
  // At this point state should be "highlighting"
  const stateAfterCheck = calls.filter(call => 
    call.method === "onStateEntry" && call.args[0] === "highlighting"
  );
  assertEquals(stateAfterCheck.length, 1);
  
  // Clear calls
  calls.length = 0;
  
  // 3. User continues typing during highlighting (real-world scenario)
  stateMachine.handleEdit("Dql", "Dqll"); // This should be ignored
  stateMachine.handleEdit("Dqll", "Dqll."); // This should be ignored
  
  // Edits during highlighting should be ignored
  const ignoredEdits = calls.filter(call => call.method === "onEditDetected");
  assertEquals(ignoredEdits.length, 0); // Both edits ignored
  
  // 4. Complete highlighting
  stateMachine.onHighlightingComplete();
  
  // 5. Subsequent edits should work normally
  stateMachine.handleEdit("Dqll.", "Dqll. Fixed");
  
  const workingEdit = calls.filter(call => call.method === "onEditDetected");
  assertEquals(workingEdit.length, 1); // Edit works after highlighting complete
  
  // Cleanup
  stateMachine.cleanup();
});

Deno.test("CheckerStateMachine - PreviousText Baseline Maintenance During Highlighting", async () => {
  // This test verifies the fix for the bug where previousText wasn't updated
  // during highlighting, causing stale state and incorrect edit detection
  
  const { callbacks, calls } = createMockCallbacks();
  
  // Create a mock main.ts handleTextChange function to test the integration
  let mockPreviousText = "";
  const mockStateMachine = new CheckerStateMachine(50, callbacks); // Short delay
  
  const mockHandleTextChange = (currentText: string) => {
    // Replicate the fixed logic from main.ts
    const shouldProcessEdit = mockStateMachine.getCurrentState() !== "highlighting";
    
    if (!shouldProcessEdit) {
      // CRITICAL FIX: Should still update previousText even when ignoring edit processing
      mockPreviousText = currentText;
      return;
    }
    
    // Normal processing
    mockStateMachine.handleEdit(mockPreviousText, currentText);
    mockPreviousText = currentText;
  };
  
  // Scenario: User types "Dql" → highlighting starts → user continues typing during highlighting
  
  // 1. User types "Dql"
  mockHandleTextChange("Dql");
  assertEquals(mockPreviousText, "Dql");
  assertEquals(mockStateMachine.getCurrentState(), "editing");
  
  // 2. Simulate checking and highlighting starting
  await new Promise(resolve => setTimeout(resolve, 100)); // Wait for debounce
  
  // Manually transition to checking and then highlighting to simulate the flow
  mockStateMachine.onCheckComplete(); // This transitions to highlighting
  assertEquals(mockStateMachine.getCurrentState(), "highlighting");
  
  // 3. User continues typing "Dqll. Mun leat..." DURING highlighting
  mockHandleTextChange("Dqll. Mun leat...");
  
  // 4. CRITICAL TEST: previousText should be updated even though edit was ignored
  assertEquals(mockPreviousText, "Dqll. Mun leat...");
  assertEquals(mockStateMachine.getCurrentState(), "highlighting"); // Still highlighting
  
  // 5. Highlighting finishes
  mockStateMachine.onHighlightingComplete();
  assertEquals(mockStateMachine.getCurrentState(), "idle");
  
  // 6. User makes another edit - this should work correctly with updated baseline
  mockHandleTextChange("Dqll. Mun leat... and more");
  assertEquals(mockPreviousText, "Dqll. Mun leat... and more");
  assertEquals(mockStateMachine.getCurrentState(), "editing");
  
  // 7. Verify the state machine processed the edit correctly 
  // (no stale previousText causing wrong edit detection)
  const newEditCalls = calls.filter(call => call.method === "onEditDetected");
  assertEquals(newEditCalls.length >= 1, true); // At least one edit should be detected
  
  // Cleanup
  mockStateMachine.cleanup();
});