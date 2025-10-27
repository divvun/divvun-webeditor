/**
 * Tests for CheckerStateMachine edit detection and debouncing
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  CheckerStateMachine,
  type EditInfo,
  type StateTransitionCallbacks,
} from "../src/checker-state-machine.ts";

// Helper function to create mock callbacks
function createMockCallbacks() {
  const calls: { method: string; args: unknown[] }[] = [];

  const callbacks: StateTransitionCallbacks = {
    onStateEntry: (state) =>
      calls.push({ method: "onStateEntry", args: [state] }),
    onStateExit: (state) =>
      calls.push({ method: "onStateExit", args: [state] }),
    onEditDetected: (editType, editInfo) =>
      calls.push({ method: "onEditDetected", args: [editType, editInfo] }),
    onCheckRequested: () =>
      calls.push({ method: "onCheckRequested", args: [] }),
    onCancelCheck: () => calls.push({ method: "onCancelCheck", args: [] }),
  };

  return { callbacks, calls };
}

// Helper to delay in tests
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.test("CheckerStateMachine - Single Line Edit Detection", () => {
  const { callbacks, calls } = createMockCallbacks();
  const stateMachine = new CheckerStateMachine(500, callbacks);

  // Simulate typing "Hello"
  const previousText = "";
  const currentText = "Hello";

  stateMachine.handleEdit(previousText, currentText);

  // Should detect single-line-edit
  const editDetectedCall = calls.find(
    (call) => call.method === "onEditDetected",
  );
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
  const editDetectedCall = calls.find(
    (call) => call.method === "onEditDetected",
  );
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
  const editDetectedCall = calls.find(
    (call) => call.method === "onEditDetected",
  );
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
  const editDetectedCall = calls.find(
    (call) => call.method === "onEditDetected",
  );
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
  const editCalls = calls.filter((call) => call.method === "onEditDetected");
  assertEquals(editCalls.length, 5);

  const checkCalls = calls.filter((call) => call.method === "onCheckRequested");
  assertEquals(checkCalls.length, 0); // No checking yet due to debouncing

  // Wait for debounce to complete
  await delay(150);

  // Now should have triggered a check
  const finalCheckCalls = calls.filter(
    (call) => call.method === "onCheckRequested",
  );
  assertEquals(finalCheckCalls.length, 1);

  // Cleanup
  stateMachine.cleanup();
});

Deno.test("CheckerStateMachine - Edit During Checking Cancels Check", async () => {
  const { callbacks, calls } = createMockCallbacks();
  const stateMachine = new CheckerStateMachine(50, callbacks); // Short delay for testing

  // Start an edit that will transition to checking after debounce
  stateMachine.handleEdit("", "Hello");

  // Wait for debounce to trigger transition to checking
  await delay(60);

  // Now state should be "checking" - clear calls
  calls.length = 0;

  // Edit while in checking state - this should CANCEL the check and transition to editing
  stateMachine.handleEdit("Hello", "Hello World");

  // Should detect the edit (new behavior - no longer ignored)
  const editCalls = calls.filter((call) => call.method === "onEditDetected");
  assertEquals(editCalls.length, 1);

  // Should also call onCancelCheck
  const cancelCalls = calls.filter((call) => call.method === "onCancelCheck");
  assertEquals(cancelCalls.length, 1);

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
  const editDetectedCall = calls.find(
    (call) => call.method === "onEditDetected",
  );
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
  const initialText =
    "Dqll. Mun leat stuoris.\nHearrgiis leat máŋga meattáhusa.";

  // Edit only line 2 (append text)
  const editedText =
    "Dqll. Mun leat stuoris.\nHearrgiis leat máŋga meattáhusa. New text.";

  stateMachine.handleEdit(initialText, editedText);

  // Should detect single-line-edit on line 1 (0-indexed = 1)
  const editDetectedCall = calls.find(
    (call) => call.method === "onEditDetected",
  );
  assertEquals(editDetectedCall?.args[0], "single-line-edit");

  const editInfo = editDetectedCall?.args[1] as EditInfo;
  assertEquals(editInfo.lineNumber, 1); // Line 2 (0-indexed = 1)
  assertEquals(editInfo.lengthChange, 10); // " New text." added

  // The key insight: editing line 2 is correctly isolated to line 1 (0-indexed)
  // This means error highlighting can be line-specific and won't interfere with other lines

  // Cleanup
  stateMachine.cleanup();
});

Deno.test(
  "CheckerStateMachine - Rapid Multi-line Edits Don't Reset Each Other",
  async () => {
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
    const editCalls = calls.filter((call) => call.method === "onEditDetected");
    assertEquals(editCalls.length, 5); // All 5 edits detected

    // Should only transition to editing state once (not reset between line edits)
    const stateEntryCalls = calls.filter(
      (call) => call.method === "onStateEntry" && call.args[0] === "editing",
    );
    assertEquals(stateEntryCalls.length, 1); // Only one transition to editing

    // Wait for debounce
    await delay(120);

    // Should eventually trigger one check after all rapid edits
    const checkCalls = calls.filter(
      (call) => call.method === "onCheckRequested",
    );
    assertEquals(checkCalls.length, 1);

    // Cleanup
    stateMachine.cleanup();
  },
);

Deno.test(
  "CheckerStateMachine - Edits During Checking Cancel The Check",
  async () => {
    const { callbacks, calls } = createMockCallbacks();
    const stateMachine = new CheckerStateMachine(100, callbacks); // Short delay for testing

    // With the simplified state machine, checking includes highlighting
    // When user continues typing while checking is in progress, the check is cancelled

    // 1. Start with initial edit that will trigger checking
    stateMachine.handleEdit("", "Dqll");

    // Wait for check to start
    await delay(120);

    // Clear calls to focus on what happens during checking
    calls.length = 0;

    // 2. Edit while in checking state - this CANCELS the check and processes the edit
    stateMachine.handleEdit("Dqll", "Dqll. Mun leat");

    // Should detect the edit (new behavior - no longer ignored)
    const editCalls = calls.filter((call) => call.method === "onEditDetected");
    assertEquals(editCalls.length, 1); // Edit processed

    // Should also call onCancelCheck (at least once)
    const cancelCalls = calls.filter((call) => call.method === "onCancelCheck");
    assertEquals(
      cancelCalls.length >= 1,
      true,
      "Should have at least one cancel call",
    );

    // 3. Complete the cancelled check (should be ignored)
    stateMachine.onCheckComplete();

    // Clear calls to test next edit
    calls.length = 0;

    // 4. Now try editing again (should work as normal)
    stateMachine.handleEdit("Dqll. Mun leat", "Dqll. Mun leat stuoris.");

    // This edit should be detected
    const finalEditCalls = calls.filter(
      (call) => call.method === "onEditDetected",
    );
    assertEquals(finalEditCalls.length, 1); // Edit detected after checking complete

    const editInfo = finalEditCalls[0]?.args[1] as EditInfo;
    assertEquals(editInfo.lineNumber, 0);
    assertEquals(editInfo.lengthChange > 0, true); // Should be a positive length change

    // Cleanup
    stateMachine.cleanup();
  },
);

Deno.test("CheckerStateMachine - Checking State Cancellation", async () => {
  const { callbacks, calls } = createMockCallbacks();
  const stateMachine = new CheckerStateMachine(50, callbacks); // Very short delay

  // Test the new behavior: edits during checking cancel the check and transition to editing

  // 1. User types quickly: "Dql" (triggers check)
  stateMachine.handleEdit("", "D");
  stateMachine.handleEdit("D", "Dq");
  stateMachine.handleEdit("Dq", "Dql");

  // Wait for debounce -> check starts
  await delay(60);

  // At this point state should be "checking"
  const stateAfterCheck = calls.filter(
    (call) => call.method === "onStateEntry" && call.args[0] === "checking",
  );
  assertEquals(stateAfterCheck.length, 1);

  // Clear calls
  calls.length = 0;

  // 2. User continues typing during checking - these now CANCEL the check
  stateMachine.handleEdit("Dql", "Dqll"); // Cancels check, processes edit
  stateMachine.handleEdit("Dqll", "Dqll."); // Processes normally (already in editing)

  // Edits during checking should now be processed (cancel behavior)
  const processedEdits = calls.filter((call) =>
    call.method === "onEditDetected"
  );
  assertEquals(processedEdits.length, 2); // Both edits processed

  // Should have called onCancelCheck (at least once when first edit cancelled the check)
  const cancelCalls = calls.filter((call) => call.method === "onCancelCheck");
  assertEquals(
    cancelCalls.length >= 1,
    true,
    "Should have at least one cancel call",
  );

  // 3. Complete the cancelled check (should be ignored)
  stateMachine.onCheckComplete();

  // Clear calls to test next edit
  calls.length = 0;

  // 4. Subsequent edits should work normally
  stateMachine.handleEdit("Dqll.", "Dqll. Fixed");

  const workingEdit = calls.filter((call) => call.method === "onEditDetected");
  assertEquals(workingEdit.length, 1); // Edit works after highlighting complete

  // Cleanup
  stateMachine.cleanup();
});

Deno.test(
  "CheckerStateMachine - PreviousText Baseline Maintenance With Cancellation",
  async () => {
    // This test verifies that previousText is maintained correctly
    // when edits cancel checking (new behavior)

    const { callbacks, calls } = createMockCallbacks();

    // Create a mock main.ts handleTextChange function to test the integration
    let mockPreviousText = "";
    const mockStateMachine = new CheckerStateMachine(50, callbacks); // Short delay

    const mockHandleTextChange = (currentText: string) => {
      // Process all edits - the state machine handles cancellation
      mockStateMachine.handleEdit(mockPreviousText, currentText);
      mockPreviousText = currentText;
    };

    // Scenario: User types "Dql" → checking starts → user continues typing (cancels check)

    // 1. User types "Dql"
    mockHandleTextChange("Dql");
    assertEquals(mockPreviousText, "Dql");
    assertEquals(mockStateMachine.getCurrentState(), "editing");

    // 2. Simulate checking starting
    await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for debounce
    assertEquals(mockStateMachine.getCurrentState(), "checking");

    // 3. User continues typing "Dqll. Mun leat..." DURING checking - this CANCELS the check
    mockHandleTextChange("Dqll. Mun leat...");

    // 4. CRITICAL TEST: previousText should be updated AND state should be editing
    assertEquals(mockPreviousText, "Dqll. Mun leat...");
    assertEquals(mockStateMachine.getCurrentState(), "editing"); // Cancelled, now editing

    // 5. The cancelled check completes (should be ignored since we're in editing state)
    mockStateMachine.onCheckComplete();
    assertEquals(mockStateMachine.getCurrentState(), "editing"); // Still editing (check was cancelled)

    // 6. User makes another edit - this should work correctly with updated baseline
    mockHandleTextChange("Dqll. Mun leat... and more");
    assertEquals(mockPreviousText, "Dqll. Mun leat... and more");
    assertEquals(mockStateMachine.getCurrentState(), "editing");

    // 7. Verify the state machine processed the edit correctly
    // (no stale previousText causing wrong edit detection)
    const newEditCalls = calls.filter(
      (call) => call.method === "onEditDetected",
    );
    assertEquals(newEditCalls.length >= 1, true); // At least one edit should be detected

    // Cleanup
    mockStateMachine.cleanup();
  },
);

Deno.test(
  "CheckerStateMachine - Multi-line Error Isolation Issue",
  async () => {
    // This test reproduces the issue where editing line 2 causes errors on line 1 to disappear

    const { callbacks, calls } = createMockCallbacks();
    const stateMachine = new CheckerStateMachine(50, callbacks); // Short delay

    // Scenario: Line 1 has errors, user moves to line 2 and starts typing
    // Expected: Line 1 errors should remain, only line 2 should be rechecked

    // 1. User completes first line with errors: "Dqll mun leat stuoris."
    stateMachine.handleEdit("", "Dqll mun leat stuoris.");
    assertEquals(stateMachine.getCurrentState(), "editing");

    // 2. Wait for checking to complete on line 1
    await new Promise((resolve) => setTimeout(resolve, 100));
    stateMachine.onCheckComplete(); // Simulate errors found on line 1
    stateMachine.onHighlightingComplete(); // Errors now highlighted on line 1
    assertEquals(stateMachine.getCurrentState(), "idle");

    // Clear previous calls to focus on the issue
    calls.length = 0;

    // 3. User adds newline and moves to line 2
    stateMachine.handleEdit(
      "Dqll mun leat stuoris.",
      "Dqll mun leat stuoris.\n",
    );
    assertEquals(stateMachine.getCurrentState(), "editing");

    // Verify this was detected as newline creation
    const newlineCall = calls.find((call) => call.method === "onEditDetected");
    assertEquals(newlineCall?.args[0], "newline-creation");

    // 4. User starts typing on line 2: "H"
    calls.length = 0; // Clear to focus on line 2 edits
    stateMachine.handleEdit(
      "Dqll mun leat stuoris.\n",
      "Dqll mun leat stuoris.\nH",
    );

    // This should be detected as single-line-edit on line 1 (the new line)
    const line2EditCall = calls.find(
      (call) => call.method === "onEditDetected",
    );
    assertEquals(line2EditCall?.args[0], "single-line-edit");

    const editInfo = line2EditCall?.args[1] as EditInfo;
    assertEquals(editInfo.lineNumber, 1); // Should be line 1 (0-indexed line 2)

    // 5. The critical issue: This line 2 edit should NOT affect line 1 errors
    // In the real app, this triggers a full document grammar check which clears line 1 highlights

    // Wait for checking
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The issue is that onCheckRequested is called, which in the real app:
    // 1. Sends the ENTIRE document text for grammar checking
    // 2. The response includes errors for both lines
    // 3. But error-highlighter.ts clears ALL existing highlights before applying new ones
    // 4. If the grammar service doesn't return line 1 errors in this response, line 1 highlights disappear

    const checkRequestedCalls = calls.filter(
      (call) => call.method === "onCheckRequested",
    );
    assertEquals(checkRequestedCalls.length >= 1, true); // Grammar check should be requested

    // This test documents the current behavior - the real fix needs to be in:
    // 1. Either making grammar checking line-specific, OR
    // 2. Making error highlighting preserve errors for unchanged lines

    stateMachine.cleanup();
  },
);

Deno.test(
  "cancelPendingCheck should clear timeout and transition to idle from editing",
  async () => {
    const { callbacks, calls } = createMockCallbacks();
    const stateMachine = new CheckerStateMachine(150, callbacks);

    // Start an edit that should create a debounce timer
    stateMachine.handleEdit("hello", "hello!");

    // Should be in editing state
    assertEquals(stateMachine.getCurrentState(), "editing");

    // Cancel the pending check (simulates line-specific check completing)
    stateMachine.cancelPendingCheck();

    // Should transition to idle immediately
    assertEquals(stateMachine.getCurrentState(), "idle");

    // Wait longer than the debounce delay to verify timer was cancelled
    await delay(200);

    // Should still be idle (timer was cancelled)
    assertEquals(stateMachine.getCurrentState(), "idle");

    // Should not have triggered onCheckRequested
    const checkRequestedCalls = calls.filter(
      (call) => call.method === "onCheckRequested",
    );
    assertEquals(checkRequestedCalls.length, 0);

    stateMachine.cleanup();
  },
);
