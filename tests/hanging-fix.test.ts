/**
 * Integration test for the hanging fix
 * Tests the exact scenario reported by the user where typing "Dáll. Mun leat stuoris."
 * would hang on "Updating highlights 0 errors"
 */

import { assertEquals } from "jsr:@std/assert@1";
import { CheckerStateMachine } from "../src/checker-state-machine.ts";

// Helper function to simulate realistic timing
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mock callbacks to track state machine behavior
function createMockCallbacks() {
  const calls: { method: string; args: unknown[] }[] = [];

  return {
    calls,
    callbacks: {
      onStateEntry: (state: string) =>
        calls.push({ method: "onStateEntry", args: [state] }),
      onStateExit: (state: string) =>
        calls.push({ method: "onStateExit", args: [state] }),
      onEditDetected: (editType: string, editInfo: unknown) =>
        calls.push({ method: "onEditDetected", args: [editType, editInfo] }),
      onCheckRequested: () =>
        calls.push({ method: "onCheckRequested", args: [] }),
    },
  };
}

Deno.test(
  "User scenario: typing 'Dáll. Mun leat stuoris.' should not hang",
  async () => {
    const { callbacks, calls } = createMockCallbacks();
    const stateMachine = new CheckerStateMachine(300, callbacks); // 300ms debounce

    // Simulate typing the problematic text character by character
    const progressiveTexts = [
      "",
      "D",
      "Dá",
      "Dál",
      "Dáll",
      "Dáll.",
      "Dáll. ",
      "Dáll. M",
      "Dáll. Mu",
      "Dáll. Mun",
      "Dáll. Mun ",
      "Dáll. Mun l",
      "Dáll. Mun le",
      "Dáll. Mun lea",
      "Dáll. Mun leat",
      "Dáll. Mun leat ",
      "Dáll. Mun leat s",
      "Dáll. Mun leat st",
      "Dáll. Mun leat stu",
      "Dáll. Mun leat stuo",
      "Dáll. Mun leat stuor",
      "Dáll. Mun leat stuori",
      "Dáll. Mun leat stuoris",
      "Dáll. Mun leat stuoris.",
    ];

    let previousText = "";

    for (let i = 1; i < progressiveTexts.length; i++) {
      const currentText = progressiveTexts[i];

      // Simulate edit
      stateMachine.handleEdit(previousText, currentText);

      // Should be in editing state after each keystroke
      assertEquals(stateMachine.getCurrentState(), "editing");

      // Simulate line-specific check completing quickly (faster than debounce)
      await delay(50); // Line check takes 50ms (much less than 300ms debounce)

      // This simulates the fix - line-specific check calls cancelPendingCheck()
      stateMachine.cancelPendingCheck();

      // Should transition to idle immediately when line check completes
      assertEquals(stateMachine.getCurrentState(), "idle");

      previousText = currentText;

      // Small delay between keystrokes
      await delay(10);
    }

    // Wait for any remaining timers
    await delay(400);

    // Verify no hanging occurred - state should be idle, not stuck in "checking" or "highlighting"
    assertEquals(stateMachine.getCurrentState(), "idle");

    // Count how many times onCheckRequested was called
    const checkRequestedCalls = calls.filter(
      (call) => call.method === "onCheckRequested",
    );

    // With the fix, onCheckRequested should be called 0 times because
    // line-specific checks cancel the debounce timer
    assertEquals(checkRequestedCalls.length, 0);

    console.log(
      `✅ Typed "${
        progressiveTexts[progressiveTexts.length - 1]
      }" successfully without hanging`,
    );
    console.log(
      `📊 onCheckRequested calls: ${checkRequestedCalls.length} (should be 0 with fix)`,
    );

    stateMachine.cleanup();
  },
);

Deno.test(
  "Without fix simulation: debounce timer would cause hanging",
  async () => {
    const { callbacks, calls } = createMockCallbacks();
    const stateMachine = new CheckerStateMachine(100, callbacks); // Short debounce for test

    // Simulate typing without calling cancelPendingCheck (simulates old buggy behavior)
    stateMachine.handleEdit("", "Dáll. Mun leat stuoris.");

    // Should be in editing state
    assertEquals(stateMachine.getCurrentState(), "editing");

    // Wait for debounce timer to fire
    await delay(150);

    // Without cancelPendingCheck(), the debounce timer transitions to "checking"
    assertEquals(stateMachine.getCurrentState(), "checking");

    // This would normally trigger onCheckRequested which in the real app
    // could cause hanging if not handled properly
    const checkRequestedCalls = calls.filter(
      (call) => call.method === "onCheckRequested",
    );
    assertEquals(checkRequestedCalls.length, 1);

    console.log("📈 Without fix: debounce timer triggered full document check");

    stateMachine.cleanup();
  },
);
