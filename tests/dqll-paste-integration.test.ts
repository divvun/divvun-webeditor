/**
 * Integration test to debug the "Dqll." highlighting issue
 * When pasting "Dqll.", only "qll." gets highlighted
 */

import { assertEquals } from "jsr:@std/assert@1";
import { TextAnalyzer } from "../src/text-analyzer.ts";
import { GrammarCheckerAPI } from "../src/api.ts";
import type { CheckerError } from "../src/types.ts";

// Mock editor
class MockEditor {
  private content = "";

  setText(text: string): void {
    this.content = text;
  }

  getText(): string {
    return this.content;
  }

  getLength(): number {
    return this.content.length;
  }
}

// Mock callbacks
function createMockCallbacks() {
  const calls: { method: string; args: unknown[] }[] = [];

  return {
    callbacks: {
      onUpdateStatus: (status: string, isChecking: boolean) =>
        calls.push({ method: "onUpdateStatus", args: [status, isChecking] }),
      onUpdateErrorCount: (count: number) =>
        calls.push({ method: "onUpdateErrorCount", args: [count] }),
      onErrorsFound: (errors: CheckerError[], lineNumber?: number) =>
        calls.push({ method: "onErrorsFound", args: [errors, lineNumber] }),
      onShowErrorMessage: (message: string) =>
        calls.push({ method: "onShowErrorMessage", args: [message] }),
    },
    calls,
  };
}

Deno.test({
  name:
    "INTEGRATION: Paste 'Dqll.' - check actual API response and error indices",
  ignore: false, // Set to true to skip if API is down
  async fn() {
    const mockEditor = new MockEditor();
    const realAPI = new GrammarCheckerAPI();
    const { callbacks } = createMockCallbacks();

    const analyzer = new TextAnalyzer(realAPI, mockEditor, callbacks, "se");

    // Simulate pasting "Dqll." into editor (editor adds newline)
    mockEditor.setText("Dqll.\n");

    console.log("📋 Text in editor:", JSON.stringify(mockEditor.getText()));
    console.log("📏 Editor text length:", mockEditor.getLength());

    // Check line 0 (this is what happens when text is pasted)
    const errors = await analyzer.checkLineForStateManagement(0);

    console.log("\n🔍 Errors returned:");
    errors.forEach((error, i) => {
      console.log(`  Error ${i}:`, {
        text: error.error_text,
        start: error.start_index,
        end: error.end_index,
        highlighted_text: mockEditor.getText().substring(
          error.start_index,
          error.end_index,
        ),
      });
    });

    // Verify we got errors
    assertEquals(errors.length > 0, true, "Should have at least one error");

    if (errors.length > 0) {
      const error = errors[0];

      // The error text should be "Dqll"
      assertEquals(error.error_text, "Dqll", "Error text should be 'Dqll'");

      // The indices should highlight "Dqll" (positions 0-4)
      assertEquals(error.start_index, 0, "Should start at index 0");
      assertEquals(error.end_index, 4, "Should end at index 4");

      // Verify the actual text being highlighted
      const highlightedText = mockEditor.getText().substring(
        error.start_index,
        error.end_index,
      );
      assertEquals(
        highlightedText,
        "Dqll",
        "Should highlight 'Dqll', not 'qll.'",
      );
    }
  },
});

Deno.test({
  name: "INTEGRATION: Check what API returns for 'Dqll.\\n'",
  ignore: false,
  async fn() {
    const api = new GrammarCheckerAPI();

    console.log("\n🌐 Testing API with 'Dqll.\\n'");
    const response = await api.checkText("Dqll.\n", "se");

    console.log("📦 API Response:");
    console.log("  text:", JSON.stringify(response.text));
    console.log("  text.length:", response.text.length);
    console.log("  errors:", response.errs.length);

    response.errs.forEach((error, i) => {
      console.log(`\n  Error ${i}:`, {
        error_text: error.error_text,
        start_index: error.start_index,
        end_index: error.end_index,
        title: error.title,
      });

      if (response.text) {
        console.log(
          "    Highlighted text from response.text:",
          JSON.stringify(
            response.text.substring(error.start_index, error.end_index),
          ),
        );
      }
    });
  },
});
